"""`python -m capture live`: tail running Claude Code transcripts into the hook's route.

The hook channel (docs/hooks-capture.md) is one entry in `~/.claude/settings.json` that
runs `hook.sh` on every prompt and every stop. This does what `hook.sh` does, from a
terminal, with nothing installed into Claude Code: every few seconds it posts each
transcript's new COMPLETE lines to `POST /v1/ingest/transcript` with the same headers, and
the server cuts the sessions with the one pipeline both channels share (capture's own
sessionizer and payload builder, and `analysis.live` for a session still running). So a
sitting watched this way and the same sitting later posted by the hook or synced by
`capture sync` are one row (docs/overnight-integration.md section 4).

Rules, each from something that already went wrong once:

* A partial trailing line is NEVER sent (CLAUDE.md, the first trap): a transcript is
  appended to while it is read, and the last line is routinely half written. Each post
  runs from the offset to the last newline; the rest waits for the next tick.
* The offset is the SERVER's (`next_offset` in every answer), kept in
  `<credentials dir>/live-offsets/<session id>` (0700 directory, 0600 file), never
  `hook.sh`'s `~/.builder/offsets`, so the watcher and an installed hook cannot move each
  other's place. A 409 ("gap: resend from next_offset") resends from the server's byte.
* No new bytes for `heartbeat` seconds posts an EMPTY tail at the current offset: the
  server re-cuts on its own clock, so "idle" and "waiting on you for N minutes" advance
  while the agent is quiet.
* A tail larger than the route takes in one request (`MAX_POST_BYTES`) is not cut in two:
  the route retires a conversation whose sessions are all final, and a first half cut on
  its own reads as ended. It is reported ONCE and skipped, and not read again until the
  file is replaced (it can only grow).
* A post that fails is tried again after `backoff`: 5 s, doubling, at most 300 s. Never
  on every tick: a server answering 500 was sent a 6.9 MB transcript 12 times a minute.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
import json
import os
import pathlib
import re
import sys
import time

from . import client as cl
from . import repo

#: `routes/ingest.py MAX_BYTES`: the most one request may carry, after inflating. Restated
#: (capture never imports the server); `capture/tests/test_live_watch.py` reads the route's
#: source and pins the two together.
MAX_POST_BYTES = 64 * 1024 * 1024

#: What `X-Builder-Hook` says for a post from this watcher. The route finalizes an open
#: session only on `SessionEnd`; anything else leaves the idle rule to decide, which is
#: right for a person who may still type.
HOOK_NAME = "Watch"

#: A post that failed (a network error, a 5xx, the offset moving twice) is tried again
#: after this long, doubling with every failure in a row up to `BACKOFF_MAX_SEC`, and a
#: post that succeeds starts over. FOUND IN REVIEW (2026-09-13): a server answering 500 to
#: one 6.9 MB transcript was sent it on every 5 s tick, 12 posts and 89,092,800 bytes in a
#: minute, forever. UNMEASURED JUDGEMENT CALL: the first retry is the next tick at the
#: default `--every` of 5 s, so one dropped connection costs what it did before.
BACKOFF_FIRST_SEC = 5.0
#: The longest wait between two tries. UNMEASURED JUDGEMENT CALL: five minutes is the
#: ceiling the review asked for; at it a failing transcript is tried 12 times an hour where
#: it was tried 720, and a server that recovers hears from the watcher within five minutes.
BACKOFF_MAX_SEC = 300.0


def backoff(failures: int) -> float:
    """Seconds to wait after `failures` posts in a row failed: `BACKOFF_FIRST_SEC`, doubled
    per further failure, never over `BACKOFF_MAX_SEC`. The exponent stops growing long
    before a float would overflow, so a watcher left failing for a week still answers."""
    return min(BACKOFF_MAX_SEC, BACKOFF_FIRST_SEC * 2 ** min(max(0, failures - 1), 32))


def offsets_dir() -> pathlib.Path:
    """Where the watcher keeps each transcript's offset: beside the credentials."""
    return cl.credentials_path().parent / "live-offsets"


# -- excluded repositories ---------------------------------------------------------------
#
# FOUND IN THE ADVERSARIAL REVIEW (2026-09-13): this channel never read
# `BUILDER_CAPTURE_EXCLUDE`, so a sitting in a repository the person had excluded went to the
# server as its RAW transcript, prompts, file contents and all, while `capture sync` sent
# nothing from it. The rule is `analysis.corpus.excluded`, the one every wire bound path
# applies (one rule, one function). What differs is what it is applied to: `capture sync`
# uploads a CUT sitting's numbers, so a sitting whose dominant repository is excluded is
# dropped; this channel uploads BYTES, so a transcript any record of which ran in an
# excluded repository sends nothing more, because those bytes are that repository's words.

#: A record's working directory, as Claude Code writes it on every record. Unescaped quote
#: before the key, so a prompt that quotes the text `"cwd":` (escaped inside its string) is
#: not read as a record's own; a false match could only refuse more, never send more.
_CWD = re.compile(rb'(?<!\\)"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"')


@dataclasses.dataclass(frozen=True)
class _Where:
    """One working directory, in the shape `corpus.excluded` reads a sitting: by its
    repository (`capture.repo.identity_for`, None outside a git checkout)."""

    repo: repo.RepoIdentity | None


def cwds_of(data: bytes) -> set[str]:
    """The distinct working directories the records in `data` ran in."""
    out: set[str] = set()
    for raw in set(_CWD.findall(data)):
        try:
            cwd = json.loads(b'"' + raw + b'"')
        except ValueError:
            continue
        if isinstance(cwd, str) and cwd:
            out.add(cwd)
    return out


def excluded_in(data: bytes, origins: set[str], seen: set[str] | None = None) -> bool:
    """Did any record in `data` run in a repository `origins` excludes
    (`capture.repo.excluded_origins`)? `seen` holds the directories already resolved and
    found not excluded, so a watched transcript resolves each directory once."""
    if not origins:
        return False
    from analysis import corpus

    seen = set() if seen is None else seen
    for cwd in sorted(cwds_of(data) - seen):
        if corpus.excluded(_Where(repo.identity_for(cwd)), origins):
            return True
        seen.add(cwd)
    return False


#: Said once per transcript, in the terminal of the person who excluded it. It names no
#: repository: the line may be kept in a log, and the variable says which.
EXCLUDED_SENTENCE = (
    "not sent: it ran in a repository BUILDER_CAPTURE_EXCLUDE excludes, so nothing more "
    "from it leaves this machine"
)


def complete_tail(path: pathlib.Path, offset: int) -> tuple[bytes, int]:
    """(the bytes from `offset` to the LAST newline, the file's size). Everything after the
    last newline is a line still being written, and waits."""
    with open(path, "rb") as f:
        f.seek(0, os.SEEK_END)
        size = f.tell()
        if offset >= size:
            return b"", size
        f.seek(offset)
        data = f.read()
    cut = data.rfind(b"\n")
    return (data[: cut + 1] if cut >= 0 else b""), size


@dataclasses.dataclass
class Tail:
    """One transcript being watched."""

    path: pathlib.Path
    offset: int = 0
    #: When the last post was ANSWERED, by the watcher's clock; None before the first.
    last_post: float | None = None
    #: Posts that failed in a row, and the watcher's clock time before which this
    #: transcript is not tried again (`backoff`). None when the last post went through.
    failures: int = 0
    retry_at: float | None = None
    #: The file's size when its new lines were found too big for one post. The offset
    #: cannot move without a post, so the tail only grows, and while the file is at least
    #: this size it is neither read again nor reported again. FOUND IN REVIEW (2026-09-13):
    #: the tail was re-read every tick and the same line printed 12 times a minute.
    oversize_at: int | None = None
    #: How far the transcript has been read for working directories (`excluded_in`), from
    #: byte 0 on the first tick whatever the offset says: a watcher started after the
    #: sitting entered an excluded repository must still see it. The directories already
    #: resolved, and whether one was excluded (then nothing more is sent, heartbeats
    #: included, for as long as this watcher runs).
    scanned: int = 0
    cwds: set[str] = dataclasses.field(default_factory=set)
    excluded: bool = False

    @property
    def sid(self) -> str:
        """The native session id: the transcript's file name, as the hook sends it."""
        return self.path.stem

    @property
    def project_dir(self) -> str:
        return self.path.parent.name


class Watcher:
    """Posts each transcript's new complete lines, or a heartbeat, once per `tick`."""

    def __init__(
        self,
        client: cl.Client,
        *,
        tz: dt.tzinfo,
        heartbeat: float = 30.0,
        clock=time.time,
        say=print,
        offsets: pathlib.Path | None = None,
        excluded: set[str] | None = None,
    ):
        self.client = client
        self.tz = tz
        self.heartbeat = heartbeat
        self.clock = clock
        self.say = say
        self.offsets = offsets or offsets_dir()
        self.tails: dict[pathlib.Path, Tail] = {}
        #: The normalized origins `BUILDER_CAPTURE_EXCLUDE` names, read once, as `capture
        #: sync` reads them once per run.
        self.excluded_origins = repo.excluded_origins() if excluded is None else set(excluded)

    def _refused(self, t: Tail, end: int) -> bool:
        """True when `t` ran in an excluded repository anywhere up to byte `end` (the end of
        what is about to be posted). Reads only what it has not read before, and nothing at
        all when no repository is excluded."""
        if t.excluded:
            return True
        if not self.excluded_origins or end <= t.scanned:
            return False
        with open(t.path, "rb") as f:
            f.seek(t.scanned)
            data = f.read(end - t.scanned)
        cut = data.rfind(b"\n")
        if cut < 0:
            return False
        t.scanned += cut + 1
        if excluded_in(data[: cut + 1], self.excluded_origins, t.cwds):
            t.excluded = True
            self.say(f"{t.sid[:8]}  {EXCLUDED_SENTENCE}")
            return True
        return False

    # -- the offset store -------------------------------------------------------------

    def _offset_file(self, sid: str) -> pathlib.Path:
        return self.offsets / sid

    def load_offset(self, sid: str) -> int:
        try:
            text = self._offset_file(sid).read_text().strip()
        except OSError:
            return 0
        return int(text) if text.isdigit() else 0

    def store_offset(self, sid: str, offset: int) -> None:
        self.offsets.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(self.offsets, 0o700)
        except OSError:
            pass
        f = self._offset_file(sid)
        tmp = f.with_name(f".{sid}.tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as out:
            out.write(f"{int(offset)}\n")
        os.chmod(tmp, 0o600)
        os.replace(tmp, f)

    # -- a tick ------------------------------------------------------------------------

    def tz_offset_minutes(self, now: float) -> int:
        off = dt.datetime.fromtimestamp(now, self.tz).utcoffset() or dt.timedelta(0)
        return int(off.total_seconds() // 60)

    def tick(self, paths) -> list[dict]:
        """One pass over `paths`. Returns what each post was answered with (a transcript
        with nothing to send and no heartbeat due posts nothing and returns nothing)."""
        out: list[dict] = []
        for path in paths:
            path = pathlib.Path(path)
            t = self.tails.get(path)
            if t is None:
                t = self.tails[path] = Tail(path, self.load_offset(path.stem))
            now = self.clock()
            if t.retry_at is not None and now < t.retry_at:
                # Backing off (`backoff`): not read, not posted, not reported this tick.
                continue
            try:
                r = self._post(t)
            except cl.HTTPFailure as e:
                # A network error or a 5xx is one line, and the offset did not move, so
                # nothing is lost; the next try waits longer after every failure in a row.
                t.failures += 1
                wait = backoff(t.failures)
                t.retry_at = now + wait
                self.say(f"{t.sid[:8]}  not sent: {e}  trying again in {wait:g} s")
                continue
            if r is not None:
                t.failures, t.retry_at = 0, None
                out.append(r)
        return out

    def _post(self, t: Tail) -> dict | None:
        now = self.clock()
        if t.excluded:
            # An excluded repository's transcript: no lines, and no heartbeat either.
            return None
        if t.oversize_at is not None:
            # Skipped as too big, and it can only have grown: not read again, not said
            # again. A file now SMALLER than that was replaced, and is read afresh.
            try:
                if os.path.getsize(t.path) >= t.oversize_at:
                    return None
            except OSError:
                pass  # the read below says why
            t.oversize_at = None
        try:
            body, size = complete_tail(t.path, t.offset)
        except OSError as e:
            self.say(f"{t.sid[:8]}  cannot read the transcript: {e.strerror or e}")
            return None
        if size < t.offset:
            # The file is shorter than what was sent: it was replaced. The client's view
            # wins at the route (an offset below its end replaces from there), so resend it.
            t.offset = 0
            t.scanned = 0  # and read for working directories afresh
            body, size = complete_tail(t.path, 0)
        if self._refused(t, t.offset + len(body)):
            return None
        if len(body) > MAX_POST_BYTES:
            t.oversize_at = size
            self.say(
                f"{t.sid[:8]}  {len(body):,} B of new lines is more than one post carries "
                f"({MAX_POST_BYTES:,} B); not sent, and not read again unless the file is replaced"
            )
            return None
        due = t.last_post is None or now - t.last_post >= self.heartbeat
        if not body and not due:
            return None
        for attempt in range(2):
            try:
                r = self.client.post_transcript(
                    t.sid,
                    t.project_dir,
                    t.offset,
                    body,
                    HOOK_NAME,
                    self.tz_offset_minutes(now),
                )
                break
            except cl.OffsetConflict as e:
                if attempt:
                    raise cl.HTTPFailure(409, "the offset moved twice in one tick") from e
                nxt = e.next_offset if e.next_offset is not None else self.client.transcript_offset(t.sid)
                t.offset = nxt
                self.store_offset(t.sid, nxt)
                body, _ = complete_tail(t.path, t.offset)
                if self._refused(t, t.offset + len(body)):
                    return None  # the file grew into an excluded repository meanwhile
        sent = len(body)
        nxt = r.get("next_offset")
        t.offset = nxt if isinstance(nxt, int) and not isinstance(nxt, bool) else t.offset + sent
        self.store_offset(t.sid, t.offset)
        t.last_post = now
        for line in describe(t.sid, sent, r):
            self.say(line)
        return r


def describe(sid: str, sent: int, r: dict) -> list[str]:
    """One line per post: the session, the bytes sent, and what the server made of them.

    `8f7c2a4e  +18,204 B  live  Handing work to three helper agents  needs you 5`

    The sentence is the server's `live.sentence` (names off), returned to the machine that
    already holds the transcript and stored nowhere. An older server answers `live` as a
    count and computes no state; that is said as it is. No dash anywhere: two spaces
    separate the columns (CLAUDE.md, no dashes in any string a person reads)."""
    head = f"{sid[:8]}  +{sent:,} B"
    lines: list[str] = []
    live = r.get("live")
    final = r.get("final") or 0
    if isinstance(live, list) and live:
        for e in live:
            sentence = e.get("sentence") or "no live state computed"
            ny = e.get("needs_you") or {}
            score = ny.get("score")
            lines.append(
                f"{head}  live  {sentence}" + (f"  needs you {score}" if score is not None else "")
            )
    elif isinstance(live, int) and not isinstance(live, bool) and live:
        lines.append(f"{head}  live  {live} running (this server computes no live state)")
    elif final:
        lines.append(f"{head}  nothing running  {final} final")
    else:
        # The route reports VISIBLE sittings only (`capture.sessions.is_counted`: 300 s
        # active or 3 meaningful events). An empty answer is either a sitting too small to
        # show yet or a conversation the server retired, and this side cannot tell which,
        # so it claims neither ("nothing running" printed beside a sitting that was).
        lines.append(f"{head}  no visible session")
    for rej in r.get("rejected") or []:
        cid = str(rej.get("client_session_id") or "")[:8]
        lines.append(f"    rejected  {cid}  {rej.get('reason')}")
    return lines


def run(
    client: cl.Client,
    *,
    transcripts: list[pathlib.Path],
    root: pathlib.Path,
    tz: dt.tzinfo,
    every: float,
    heartbeat: float,
    once: bool,
    until: float | None = None,
    sleep=time.sleep,
    clock=time.time,
    say=print,
) -> int:
    """The loop behind `python -m capture live`: the named transcripts, or every root
    transcript under `root` written to within `analysis.live.LIVE_MTIME_SEC` (the widest
    idle threshold the boundary fit returns, so nothing the sessionizer calls live is
    missed), each tick. `until` (a clock time) ends it after the tick that reaches it."""
    from analysis import live as lv

    w = Watcher(client, tz=tz, heartbeat=heartbeat, clock=clock, say=say)
    quiet = False
    while True:
        paths = transcripts or [t.path for t in lv.live_transcripts(root, clock())]
        if not paths and not quiet:
            # Said once when it becomes true, not every tick.
            say(f"no transcript under {root} was written to in the last hour")
        quiet = not paths
        w.tick(paths)
        if once or (until is not None and clock() >= until):
            return 0
        sys.stdout.flush()
        sleep(every)
