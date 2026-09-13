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
  its own reads as ended. It is reported and skipped.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
import os
import pathlib
import sys
import time

from . import client as cl

#: `routes/ingest.py MAX_BYTES`: the most one request may carry, after inflating. Restated
#: (capture never imports the server); `capture/tests/test_live_watch.py` reads the route's
#: source and pins the two together.
MAX_POST_BYTES = 64 * 1024 * 1024

#: What `X-Builder-Hook` says for a post from this watcher. The route finalizes an open
#: session only on `SessionEnd`; anything else leaves the idle rule to decide, which is
#: right for a person who may still type.
HOOK_NAME = "Watch"


def offsets_dir() -> pathlib.Path:
    """Where the watcher keeps each transcript's offset: beside the credentials."""
    return cl.credentials_path().parent / "live-offsets"


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
    ):
        self.client = client
        self.tz = tz
        self.heartbeat = heartbeat
        self.clock = clock
        self.say = say
        self.offsets = offsets or offsets_dir()
        self.tails: dict[pathlib.Path, Tail] = {}

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
            try:
                r = self._post(t)
            except cl.HTTPFailure as e:
                # A network error or a 5xx is one line and the next tick tries again; the
                # offset did not move, so nothing is lost.
                self.say(f"{t.sid[:8]}  not sent: {e}")
                continue
            if r is not None:
                out.append(r)
        return out

    def _post(self, t: Tail) -> dict | None:
        now = self.clock()
        try:
            body, size = complete_tail(t.path, t.offset)
        except OSError as e:
            self.say(f"{t.sid[:8]}  cannot read the transcript: {e.strerror or e}")
            return None
        if size < t.offset:
            # The file is shorter than what was sent: it was replaced. The client's view
            # wins at the route (an offset below its end replaces from there), so resend it.
            t.offset = 0
            body, size = complete_tail(t.path, 0)
        if len(body) > MAX_POST_BYTES:
            self.say(
                f"{t.sid[:8]}  {len(body):,} B of new lines is more than one post carries "
                f"({MAX_POST_BYTES:,} B); not sent"
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

    `fa5eaa46  +18,204 B  live  Handing work to three helper agents  needs you 5`

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
