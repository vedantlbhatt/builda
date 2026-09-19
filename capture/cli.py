"""`python -m capture pair`, `sync`, `live`, `report`, `narrative` and `quotes`; `demo --publish`
and `demo --delete` are capture/demo_publish.py, dispatched from `main`."""

from __future__ import annotations

import argparse
import datetime as dt
import functools
import json
import os
import pathlib
import shutil
import socket
import sys
import time
import zoneinfo

from . import CLIENT_VERSION, ROOT, harnesses, identity, repo, sessions
from . import client as cl
from .discover import iter_root_transcripts
from .tuning import LIVE_UPLOAD_MIN_INTERVAL_SEC, PAIR_TIMEOUT_SEC

DEFAULT_ROOT = "~/.claude/projects"


def _server(arg: str | None) -> str:
    return (arg or os.environ.get("BUILDER_API_URL") or cl.DEFAULT_SERVER).rstrip("/")


def _tz(arg: str | None) -> dt.tzinfo:
    """The zone the 04:00 rule runs in. A cloud container is UTC; set `BUILDER_TZ` (or
    `--tz`) to your home zone or a robot's overnight hours land on the wrong day."""
    name = arg or os.environ.get("BUILDER_TZ") or os.environ.get("TZ")
    if name:
        try:
            return zoneinfo.ZoneInfo(name)
        except (zoneinfo.ZoneInfoNotFoundError, ValueError):
            print(f"warning: unknown time zone {name!r}; using the system zone", file=sys.stderr)
    return dt.datetime.now().astimezone().tzinfo or dt.UTC


def _box(code: str) -> list[str]:
    inner = f"    {code}    "
    bar = "─" * len(inner)
    blank = " " * len(inner)
    return [f"┌{bar}┐", f"│{blank}│", f"│{inner}│", f"│{blank}│", f"└{bar}┘"]


# ----------------------------------------------------------------------------- pair


def cmd_pair(a: argparse.Namespace) -> int:
    server = _server(a.server)
    c = cl.Client(server)

    if a.resume:
        return _resume_pending(c, quiet=False)

    if cl.capture_key() is not None:
        print("\n  BUILDER_CAPTURE_KEY is set: `sync` uses it and needs no pairing. Pairing anyway.")
    existing = cl.read_json(cl.credentials_path())
    if existing and existing.get("refresh_token"):
        print("\n  Already paired. Pairing again replaces the stored tokens.")
    machine_id = cl.machine_identity(existing)
    label = (
        a.label or os.environ.get("BUILDER_DEVICE_LABEL") or f"Claude Code ({socket.gethostname()})"
    )

    start = c.device_start(machine_id, label)
    pending = {
        "server": server,
        "machine_id": machine_id,
        "label": label,
        "device_code": start["device_code"],
        "user_code": start["user_code"],
        "interval": int(start.get("interval", 5)),
        "expires_at": time.time() + int(start.get("expires_in", PAIR_TIMEOUT_SEC)),
    }
    cl.write_private_json(cl.pending_path(), pending)

    deep_link = f"builder://pair?code={start['user_code']}"
    print()
    print("  Open Builder on your phone → Settings → Scan code, and enter:")
    print()
    for line in _box(start["user_code"]):
        print(f"      {line}")
    print()
    print(f"  or open {start.get('verification_uri', server + '/pair')} where you are signed in.")
    print()
    print(f"  Deep link:  {deep_link}")
    print()
    if a.no_wait:
        print("  Not waiting. `python -m capture sync` (or `pair --resume`) completes the")
        print("  pairing once you approve; the code expires in 15 minutes.")
        return 0
    print("  Waiting for approval (code expires in 15 minutes)…")
    try:
        c.await_pairing(pending, pending["interval"])
    except cl.PairingTimedOut as e:
        print(f"\n  {e}")
        return 1
    print(f"\n  Paired. This machine is linked as “{label}”. Run `python -m capture sync`.")
    return 0


def _resume_pending(c: cl.Client, quiet: bool) -> int:
    """Finish a `pair --no-wait` with a single poll. Returns 0 when paired."""
    pending = cl.read_json(cl.pending_path())
    if not pending or not pending.get("device_code"):
        if not quiet:
            print("  No pending pairing. Run `python -m capture pair`.")
        return 1
    if time.time() > float(pending.get("expires_at", 0)):
        cl.pending_path().unlink(missing_ok=True)
        if not quiet:
            print("  The pending pairing code expired. Run `python -m capture pair` again.")
        return 1
    try:
        r = c.device_poll_once(pending["device_code"])
    except cl.HTTPFailure as e:
        if not quiet:
            print(f"  Pairing poll failed: {e}")
        return 1
    if r.get("status") == "ok" and r.get("access_token"):
        c.complete_pairing(pending, r)
        if not quiet:
            print(f"  Paired as “{pending.get('label')}”.")
        return 0
    if not quiet:
        print(f"  Still waiting for approval of code {pending.get('user_code')}.")
    return 2


# ----------------------------------------------------------------------------- sync


def _load_state() -> dict:
    return cl.read_json(cl.state_path()) or {"live": {}, "analysis": {}}


def _analysis_for(s: sessions.Session, state: dict, quiet: bool) -> dict | None:
    """Opt-in: `analysis.run.analyze` through the user's own `claude`, once per final
    session, cached in the state file so a re-run of a hook never pays twice."""
    cache = state.setdefault("analysis", {})
    cached = cache.get(s.client_session_id)
    if isinstance(cached, dict):
        return cached
    if not shutil.which("claude"):
        return None
    from analysis import run as rn

    meta = {
        "end_reason": s.end_reason,
        "attended_seconds": round(s.attended),
        "autonomous_seconds": round(s.autonomous),
    }
    if s.repo is not None and s.repo.display_name:
        meta["repo"] = s.repo.display_name
    try:
        res = rn.analyze(s.transcript_path, s.records[0]["ts"], s.last_record_ts, meta)
    except rn.AnalysisError as e:
        if not quiet:
            print(f"  analysis skipped for {s.client_session_id[:8]}: {e}", file=sys.stderr)
        return None
    cache[s.client_session_id] = res["analysis"]
    return res["analysis"]


def discover_sources(a: argparse.Namespace) -> tuple[list, list, list]:
    """Every transcript this machine holds, loaded. Returns (sources, root transcripts, other stores).

    Shared by `sync` and `narrative` so the two cannot cut different corpora. A page that
    described a set of sessions the phone never received would be the same class of bug as
    a wrong number, and harder to see.
    """
    transcripts = iter_root_transcripts(pathlib.Path(a.root).expanduser())
    sources = [sessions.load_source(t) for t in transcripts]
    # Every other tool on this machine, through the same records and the same cut
    # (`capture/harnesses.py`). Opt-out rather than opt-in: a person who installed Builder
    # to see their sessions means all of them, and a store that is not there costs a
    # `Path.exists()`. One unreadable session is skipped, never fatal.
    # Aider writes into the REPOSITORY you ran it in, so the repositories this machine's
    # own transcripts resolved to are where to look. A guess at where somebody keeps code
    # (`~/src`, `~/work`) walks directories nobody asked us to read.
    repo_roots = sorted(
        {
            ident.common_root
            for src in sources
            for r in src.records
            if (ident := repo.identity_for(r.get("cwd"))) is not None and ident.common_root
        }
    )
    other = (
        []
        if getattr(a, "no_other_harnesses", False)
        else harnesses.discover(repo_roots=repo_roots)
    )
    for store in other:
        try:
            sources.append(harnesses.load(store))
        except Exception as e:  # noqa: BLE001 - one bad store must not stop the sync
            if not getattr(a, "quiet", False):
                print(f"  skipped {store.harness} {store.path.name}: {e}", file=sys.stderr)
    return sources, transcripts, other


def build_payloads(a: argparse.Namespace, now: float | None = None) -> tuple[list[dict], dict]:
    """Discover, sessionize, and build every uploadable payload. Returns (payloads, stats)."""
    root = pathlib.Path(a.root).expanduser()
    tz = _tz(a.tz)
    now = time.time() if now is None else now
    sources, transcripts, other = discover_sources(a)
    fit_report: dict = {}
    cut = sessions.sessionize_sources(
        sources, tz, now=now, finalize_open=a.finalize, tau=getattr(a, "tau", "auto"),
        report=fit_report,
    )

    creds = cl.read_json(cl.credentials_path())
    machine_id = cl.machine_identity(creds)
    excluded = repo.excluded_origins()
    state = _load_state()
    # One parse of each transcript's usage however many sittings share it (the per session
    # `burn` block): the corpus cut's measurement, 49.9 s unmemoised against 1.6 s memoised
    # over `~/.claude/projects` (docs/overnight-engine.md, Deviations (fixes)). Local to
    # this run, so a long lived process never answers from a stale parse.
    loader = _turns_loader()
    # The live block's inputs, made once and only when a live payload needs them: the
    # finished sittings of THIS cut that an ETA compares against (`live.eta_history`, no
    # second parse), and the map salt, which never leaves the machine (`identity.map_salt`).
    live_inputs: dict = {}

    def live_history() -> tuple[list, str]:
        if not live_inputs:
            from analysis import live as lv

            kept = [s for s in cut if not _excluded(s, excluded)]
            live_inputs["history"] = lv.eta_history(kept)
            live_inputs["salt"] = identity.map_salt()
        return live_inputs["history"], live_inputs["salt"]

    payloads: list[dict] = []
    stats = {
        "transcripts": len(transcripts),
        "other_harness_sessions": len(other),
        "harnesses": sorted({s.transcript.harness for s in sources}),
        "records": sum(len(s.records) for s in sources),
        "sessions": len(cut),
        "open_skipped": 0,
        "not_visible": 0,
        "excluded": 0,
        "live": 0,
        "final": 0,
        "with_analysis": 0,
        "with_live": 0,
        "tau": fit_report.get("tau"),
        "tau_fit": (
            sessions.mb.describe_fit(fit_report["fit"]) if fit_report.get("fit") else None
        ),
    }
    for s in cut:
        if _excluded(s, excluded):
            stats["excluded"] += 1
            continue
        if s.state == "live" and not a.live:
            stats["open_skipped"] += 1
            continue
        analysis = None
        if a.analyze and s.state == "final":
            analysis = _analysis_for(s, state, a.quiet)
        p = sessions.build_payload(
            s, tz, machine_id, CLIENT_VERSION, now, analysis, turns_loader=loader
        )
        if not p["visible"]:
            stats["not_visible"] += 1
            continue
        if s.state == "live" and s.harness == "claude_code":
            # `analysis.live` reads Claude Code transcripts (its `stop_reason` and
            # `result_ts`, and the background task records); another harness's live
            # sitting uploads without a live block, which is "not computed", never a guess.
            history, salt = live_history()
            sessions.attach_live(
                p,
                s,
                now=now,
                history=history,
                salt=salt,
                names=getattr(a, "live_names", False),
                loader=loader,
            )
            stats["with_live"] += 1
        stats[s.state] += 1
        if analysis is not None:
            stats["with_analysis"] += 1
        payloads.append(p)
    return payloads, {"state": state, **stats}


def _excluded(s: sessions.Session, excluded: set[str]) -> bool:
    """In a repository the person excluded (`BUILDER_CAPTURE_EXCLUDE`): zero uploads, and
    not history for anybody's ETA either."""
    return s.repo is not None and s.repo.identity in excluded


def _turns_loader():
    """`analysis.burn.load_turns`, memoised for one run; None when the engine is not
    deployed beside capture (`build_payload` then computes no burn block)."""
    try:
        from analysis import burn as bn
    except ImportError:  # pragma: no cover - deployment shape, not logic
        return None
    return functools.lru_cache(maxsize=None)(bn.load_turns)


def _corpus(a: argparse.Namespace):
    """Sessionize this machine and measure everything both documents rest on.

    ONE cut, shared by `narrative` and `report`. They describe the same corpus at the same
    moment, and two functions that each sessionize are two functions that will one day
    disagree about how many sessions somebody had — which is the same bug as a wrong
    number, arriving as two screens that contradict each other.

    Returns (facts, events, trends, fanout, contributions).
    """
    from analysis import agents as ag
    from analysis import contributions as co
    from analysis import patterns as pat
    from analysis import profile as pf
    from analysis import trends as tr

    tz = _tz(a.tz)
    now = time.time()
    sources, transcripts, _ = discover_sources(a)
    # Final AND counted: the same population the phone shows and the same one every
    # server-side aggregate runs over (`visible` on the wire is exactly `is_counted`).
    # Without the second half this command measured sittings the app does not display,
    # and MEASURED on this container that moved seven commits from "alone" to "assisted".
    cut = [
        s
        for s in sessions.sessionize_sources(sources, tz, now=now, tau=getattr(a, "tau", "auto"))
        if s.state == "final" and sessions.is_counted(s)
    ]
    facts, events, roots = [], [], []
    for s in cut:
        offset = dt.datetime.fromtimestamp(s.started_at, tz).utcoffset() or dt.timedelta(0)
        minutes = int(offset.total_seconds() // 60)
        roots.append(s.repo.common_root if s.repo else None)
        facts.append(
            pf.session_fact_from_events(
                session_id=s.client_session_id,
                events=s.events,
                started_at=s.started_at,
                ended_at=s.ended_at,
                attended_seconds=s.attended,
                autonomous_seconds=s.autonomous,
                tz_offset_minutes=minutes,
                output_tokens_by_model={},
                unattended=s.presence == 0,
            )
        )
        # Output tokens from the LEDGER (deduped on `(source_id, message.id)`, sidechains
        # excluded), never summed off the events: `Ev.tok_out` is set only on the assistant
        # records that happen to carry usage and MEASURED it reports 39,487 output tokens
        # for 21 hours of real work. None when the harness reports none, which is a refusal
        # rather than a zero (Cursor writes {0, 0} on all 14,565 of its message rows).
        ledger = sessions.token_ledger(s.records)
        cost, dominant = pf.pricing.priced_session(ledger, pf.DOMINANT_SHARE)
        events.append(
            pat.SessionEvents(
                session_id=s.client_session_id,
                started_at=s.started_at,
                ended_at=s.ended_at,
                active_seconds=s.attended + s.autonomous,
                attended_seconds=s.attended,
                tz_offset_minutes=minutes,
                events=s.events,
                output_tokens=(
                    ledger.buckets["output"] if ledger.reported and ledger.buckets else None
                ),
                cost_usd=cost,
                dominant_model=dominant,
            )
        )

    # Commits from `git log` over each session's own window, first-claim across the
    # overlaps, exactly as `python -m analysis narrative` does it. Without this the two
    # commands describe the same corpus with different commit numbers, which is the same
    # bug as one wrong number.
    facts = pf.attribute_commits(facts, roots, repo.commits_in)

    # You against you: the window against the window before it, both the same length.
    days = getattr(a, "days", None) or 30
    edge, floor = now - days * 86400, now - 2 * days * 86400
    recent = [f for f in facts if f.started_at >= edge]
    earlier = [f for f in facts if floor <= f.started_at < edge]
    trends = (
        tr.compare(pf.corpus_profile(earlier), pf.corpus_profile(recent))
        if recent and earlier
        else []
    )

    # Subagents, from the sidecar transcripts every other tool on this machine skips. They
    # never contribute a token, a line or a commit to anything above. Read from the ROOT
    # TRANSCRIPTS rather than from `sources`: sidecar discovery is an allowlist on path
    # shape (`<projectdir>/<uuid>.jsonl` is a root), and the other harnesses have no such
    # shape and no sidecars.
    spans = [sp for t in transcripts for sp in ag.spans(t.path)]
    fanout = (
        ag.fanout(spans, max(s.ended_at for s in spans) - min(s.started_at for s in spans))
        if spans
        else None
    )

    contributions = None
    commit_roots = sorted({r for r in roots if r})
    if commit_roots and facts:
        since = min(f.started_at for f in facts) - co.LOOKBACK_SEC
        commits = [ts for r in commit_roots for _sha, ts in repo.commits_in(r, since, now)]
        if commits:
            contributions = co.split(
                commits,
                [(f.started_at, f.ended_at) for f in facts],
                facts[-1].tz_offset_minutes,
            )
    return facts, events, trends, fanout, contributions


def cmd_narrative(a: argparse.Namespace) -> int:
    """Write the "how you work" page from this machine's transcripts and upload it.

    It is its own command rather than a flag on `sync` because it costs a model call and
    describes the whole corpus: running it on every sync would pay for a document that has
    not changed. `--dry-run` prints it and sends nothing, which is also the only way to
    read it without a server.

    The work itself lives in `analysis`, not here: this command sessionizes with the same
    reference cut `sync` uses, hands the sessions to `analysis.patterns` and
    `analysis.profile`, and posts what `analysis.narrative` returns.
    """
    key = cl.capture_key(a.key)

    from analysis import narrative as nar
    from analysis import patterns as pat
    from analysis import profile as pf

    facts, events, trends, fanout, contributions = _corpus(a)
    found = pat.findings(events)
    if not a.quiet:
        print(
            f"{len(facts)} final session(s), {len(found)} comparative finding(s) cleared "
            f"both bars (both sides need {pat.MIN_GROUP}, the gap needs {pat.MIN_LIFT}x).",
            file=sys.stderr,
        )

    kw = {"model": a.model} if a.model else {}
    # Everything this machine measured, not only the module the prose started from. The
    # first version of this passed `profile` and `findings` alone while `python -m analysis
    # narrative` passed all five, so the same corpus produced two different pages depending
    # on which command wrote it.
    doc = nar.write(
        profile=pf.corpus_profile(facts),
        findings=found,
        trends=trends,
        fanout=fanout,
        contributions=contributions,
        **kw,
    )

    if a.dry_run:
        print(json.dumps(doc, indent=1, ensure_ascii=False))
        print(
            "\ndry run: nothing was sent. This document is prose about YOU, written on "
            "this machine from your own transcripts; read it before you upload it.",
            file=sys.stderr,
        )
        return 0

    c = cl.Client(_server(a.server), key=key)
    if key is None and cl.load_credentials() is None:
        if not a.quiet:
            print("Not paired. Run `python -m capture pair --server URL` first.")
        return 3
    c.put_narrative(doc)
    if not a.quiet:
        dropped = doc["invented_numbers_dropped"]
        print(
            "Uploaded your builder narrative."
            + (f" {dropped} claim(s) were dropped for citing a number nobody measured." if dropped else "")
        )
    return 0


def cmd_report(a: argparse.Namespace) -> int:
    """Measure the builder report from this machine's transcripts and upload it.

    NO MODEL IS CALLED. Every field is a number, which is why this can run on a schedule
    and the narrative cannot, and why `--dry-run` is worth running once before the first
    upload: what it prints is byte for byte what would be sent.

    Five blocks, and the server can compute none of them. Trends need two windows of
    recomputed metrics; agents need the subagent sidecar transcripts; quality needs shell
    command TEXT; prompting needs prompt TEXT; contributions need commit TIMES. The
    contract puts none of that on the wire, so the measuring happens here or nowhere.
    """
    key = cl.capture_key(a.key)
    quotes_on = bool(getattr(a, "quotes", False))
    if quotes_on and _from_corpus() is None:
        # Refused before anything is read: the quotes document is built by the same call
        # that builds the report (docs/overnight-integration.md 1.3), and this checkout's
        # engine does not have it yet. Never a second, local quote picker.
        print(
            "--quotes needs analysis.report.from_corpus, which this checkout's engine does "
            "not have yet; nothing was read or sent.",
            file=sys.stderr,
        )
        return 2

    doc, quotes = _report_documents(a, quotes_on)

    if a.dry_run:
        print(json.dumps(doc, indent=1, ensure_ascii=False))
        if quotes is not None:
            # After the report, so the report above is byte for byte what a run without
            # --quotes sends, and what the quotes flag adds is the second document alone.
            print(json.dumps(quotes, indent=1, ensure_ascii=False))
        print(
            "\ndry run: nothing was sent. Every number above was measured on this machine "
            "from your own transcripts; no prompt, path or command is in it."
            + (
                " The second document is the opt in quotes: up to three of your prompts, "
                "verbatim, sent only with --quotes and only while the account has Quote my "
                "prompts on."
                if quotes is not None
                else ""
            ),
            file=sys.stderr,
        )
        return 0

    c = cl.Client(_server(a.server), key=key)
    if key is None and cl.load_credentials() is None:
        if not a.quiet:
            print("Not paired. Run `python -m capture pair --server URL` first.")
        return 3
    c.put_report(doc)
    if not a.quiet:
        ag_doc = doc.get("agents")
        print(
            f"Uploaded your builder report over {doc['window_days']} days: "
            f"{len(doc['trends'])} trend(s)"
            + (f", {ag_doc['agents']} subagents" if ag_doc else "")
            + "."
        )
    if quotes is not None:
        try:
            c.put_quotes(quotes)
        except cl.QuotesRefused as e:
            # The server's own sentence, which names the switch on the phone.
            print(f"Quotes not sent: {e}")
            return 1
        if not a.quiet:
            n = len(quotes.get("quotes") or [])
            print(f"Uploaded {n} quote{'' if n == 1 else 's'} for your Wrapped cards.")
    return 0


def _from_corpus():
    """`analysis.report.from_corpus` over `analysis.corpus.cut`, when the engine has them
    (docs/overnight-integration.md 1.3: the one corpus cut, so this command and `python -m
    analysis report` build one document), else None."""
    try:
        from analysis import corpus as co
        from analysis import report as rp
    except ImportError:
        return None
    fn = getattr(rp, "from_corpus", None)
    cut = getattr(co, "cut", None)
    return (cut, fn) if callable(fn) and callable(cut) else None


def _report_documents(a: argparse.Namespace, quotes: bool) -> tuple[dict, dict | None]:
    """(the report, the quotes document or None). Through `report.from_corpus` when the
    engine has it; before it lands, the v1 path this command has always taken, which
    builds the same report `python -m analysis report` does and no quotes."""
    from analysis import report as rp

    days = getattr(a, "days", None) or rp.DEFAULT_WINDOW_DAYS
    pair = _from_corpus()
    if pair is not None:
        cut, from_corpus = pair
        sources, transcripts, _ = discover_sources(a)
        corpus = cut(sources, transcripts, _tz(a.tz), time.time(), tau=getattr(a, "tau", "auto"))
        doc, q = from_corpus(corpus, days, quotes=quotes)
        return doc, (q if quotes else None)

    from analysis import profile as pf

    facts, events, trends, fanout, contributions = _corpus(a)
    doc = rp.build(
        # Same profile the narrative reads, so the coverage the phone shows is the
        # coverage the numbers were computed over.
        profile=pf.corpus_profile(facts),
        trends=trends,
        fanout=fanout,
        contributions=contributions,
        sessions=events,
        window_days=days,
    )
    return doc, None


def cmd_quotes(a: argparse.Namespace) -> int:
    """`python -m capture quotes --delete`: the quotes this account stored, gone (DELETE
    /v1/profile/quotes). Turning the phone's switch off deletes them too; this is the same
    thing from the machine that sent them."""
    if not a.delete:
        print("Nothing to do: pass --delete to delete the quotes this account stored.")
        return 2
    key = cl.capture_key(a.key)
    c = cl.Client(_server(a.server), key=key)
    if key is None and cl.load_credentials() is None:
        print("Not paired. Run `python -m capture pair --server URL` first.")
        return 3
    c.delete_quotes()
    print("Deleted the quotes this account stored.")
    return 0


#: `routes/ingest.py _SAFE`, the only session ids and project directory names the route
#: accepts. Checked before the first post so a transcript outside `~/.claude/projects` is
#: one sentence, not a 422 every five seconds. Pinned to the route by
#: capture/tests/test_live_watch.py.
_SAFE_NAME = r"^[A-Za-z0-9._-]{1,200}$"


def cmd_live(a: argparse.Namespace) -> int:
    """Tail running Claude Code transcripts into the hook's route (`capture/watch.py`).

    Nothing is installed into Claude Code: this does what `hook.sh` does, every `--every`
    seconds, and the server computes each running session's live state with the pipeline
    both channels share. `--once` posts one tick and exits."""
    import re

    from analysis import digest

    from . import watch

    if a.every <= 0 or a.heartbeat <= 0 or (a.duration is not None and a.duration <= 0):
        print("--every, --heartbeat and --for take a number of seconds above zero.", file=sys.stderr)
        return 2
    key = cl.capture_key(a.key)
    paths: list[pathlib.Path] = []
    for raw in a.transcript or []:
        p = pathlib.Path(raw).expanduser()
        if not p.is_file():
            print(f"no transcript at {p}", file=sys.stderr)
            return 1
        harness = digest.detect_harness(p)
        if harness != "claude_code":
            print(
                f"live posts Claude Code transcripts only, and {p.name} was written by {harness}.",
                file=sys.stderr,
            )
            return 1
        if not (re.match(_SAFE_NAME, p.stem) and re.match(_SAFE_NAME, p.parent.name)):
            print(
                f"{p} is not where Claude Code keeps a transcript "
                "(<project dir>/<session id>.jsonl, letters, digits, dot, underscore, hyphen)",
                file=sys.stderr,
            )
            return 1
        # This channel sends the transcript's BYTES, so a transcript that ran in a
        # repository the person excluded is refused whole, before any post (`watch.excluded_in`,
        # `analysis.corpus.excluded`'s rule over every record's working directory).
        if watch.excluded_in(watch.complete_tail(p, 0)[0], repo.excluded_origins()):
            print(
                f"{p.name} ran in a repository BUILDER_CAPTURE_EXCLUDE excludes, so live sends "
                "nothing from it.",
                file=sys.stderr,
            )
            return 1
        paths.append(p)
    server = _server(a.server)
    c = cl.Client(server, key=key)
    if key is None and cl.load_credentials() is None:
        print("Not paired. Run `python -m capture pair --server URL` first.")
        return 3
    root = pathlib.Path(a.root).expanduser()
    what = f"{len(paths)} transcript{'' if len(paths) == 1 else 's'}" if paths else f"every transcript under {root} written to in the last hour"
    until = None if a.duration is None else time.time() + a.duration
    print(
        f"watching {what}, every {a.every:g} s, a heartbeat after {a.heartbeat:g} s with "
        f"nothing new, posting to {server}"
        + ("" if a.once else f" for {a.duration:g} s" if until else "; Ctrl+C to stop"),
        file=sys.stderr,
    )
    return watch.run(
        c,
        transcripts=paths,
        root=root,
        tz=_tz(a.tz),
        every=a.every,
        heartbeat=a.heartbeat,
        once=a.once,
        until=until,
    )


def cmd_sync(a: argparse.Namespace) -> int:
    # Resolved first so a malformed key fails before any transcript is read.
    key = cl.capture_key(a.key)
    now = time.time()
    payloads, info = build_payloads(a, now)
    state = info.pop("state")

    summary = (
        f"{info['transcripts']} root transcript(s), {info['records']:,} timestamped records, "
        f"{info['sessions']} session(s): {info['final']} final, {info['live']} live"
        + (f", {info['open_skipped']} open (skipped; pass --live)" if info["open_skipped"] else "")
        + (f", {info['not_visible']} below the visibility floor" if info["not_visible"] else "")
        + (f", {info['excluded']} excluded" if info["excluded"] else "")
        + (f", {info['with_analysis']} with an analysis" if info["with_analysis"] else "")
        + (f", {info['with_live']} with a live state" if info.get("with_live") else "")
        + (f"; auth: capture key {cl.key_prefix(key)}… (no pairing needed)" if key else "")
        + (f"; {info['tau_fit']}" if info.get("tau_fit") else "")
    )

    if a.dry_run:
        if not a.quiet:
            print(json.dumps({"sessions": payloads}, indent=1, sort_keys=True))
        print(f"\ndry run: {summary}.", file=sys.stderr)
        print(
            f"{len(payloads)} session(s) would be sent. Nothing was.\n"
            "Every key above is declared in privacy/upload-contract.json; "
            "capture/tests/test_contract.py walks the nested fields to prove it.",
            file=sys.stderr,
        )
        return 0

    c = cl.Client(_server(a.server), key=key)
    if key is None and cl.load_credentials() is None:
        rc = _resume_pending(c, quiet=a.quiet)
        if rc != 0:
            if not a.quiet:
                print("Not paired. Run `python -m capture pair --server URL` first.")
            return 3

    if not payloads:
        if not a.quiet:
            print(f"Nothing to sync: {summary}.")
        return 0

    try:
        known = c.known_hashes()
    except cl.HTTPFailure as e:
        if not a.quiet:
            print(f"warning: /v1/sync/known failed ({e}); sending everything", file=sys.stderr)
        known = {}

    live_state: dict = state.setdefault("live", {})
    to_send = []
    for p in payloads:
        # A payload carrying `live` is resent although its hash is known: the block moves
        # with the clock, not the bytes ("waiting on you for N minutes" advances with no
        # new record), and `content_hash` is the hash WITHOUT it (docs/overnight-integration.md
        # 3.2). Still at most once per `LIVE_UPLOAD_MIN_INTERVAL_SEC` per session.
        moving = "live" in p
        if not moving and known.get(p["client_session_id"]) == p["content_hash"]:
            continue
        if p["state"] == "live":
            last = live_state.get(p["client_session_id"])
            if last:
                if now - float(last.get("at", 0)) < LIVE_UPLOAD_MIN_INTERVAL_SEC:
                    continue
                if not moving and last.get("hash") == p["content_hash"]:
                    continue
        to_send.append(p)

    if not to_send:
        cl.write_private_json(cl.state_path(), state)
        if not a.quiet:
            print(f"Already up to date: {summary}.")
        return 0

    result = c.upload(to_send)
    rejected_ids = {r.get("client_session_id") for r in result["rejected"]}
    for p in to_send:
        if p["client_session_id"] in rejected_ids:
            continue
        if p["state"] == "live":
            live_state[p["client_session_id"]] = {"at": now, "hash": p["content_hash"]}
        else:
            live_state.pop(p["client_session_id"], None)
    cl.write_private_json(cl.state_path(), state)

    if not a.quiet or result["rejected"]:
        print(f"  {summary}")
        print(f"  accepted   {result['accepted']}")
        print(f"  unchanged  {result['unchanged']}")
        print(f"  live       {sum(1 for p in to_send if p['state'] == 'live')}")
        if result["rejected"]:
            print(f"  rejected   {len(result['rejected'])}")
            for r in result["rejected"][:10]:
                print(f"    {str(r.get('client_session_id', ''))[:8]}  {r.get('reason')}")
    return 1 if result["rejected"] else 0


# ----------------------------------------------------------------------------- main


def make_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="python -m capture",
        description=f"Builder capture {CLIENT_VERSION}: upload Claude Code sessions from anywhere Python runs.",
    )
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser(
        "pair", help="RFC 8628 device flow; stores tokens in ~/.builder/credentials.json"
    )
    p.add_argument("--server", help="API base URL (or BUILDER_API_URL)")
    p.add_argument("--label", help="device label shown in the app")
    p.add_argument(
        "--no-wait", action="store_true", help="print the code and exit; sync completes it"
    )
    p.add_argument("--resume", action="store_true", help="poll a pending --no-wait pairing once")
    p.set_defaults(fn=cmd_pair)

    s = sub.add_parser("sync", help="sessionize the transcript store and upload")
    s.add_argument("--root", default=DEFAULT_ROOT, help=f"transcript root (default {DEFAULT_ROOT})")
    s.add_argument("--server", help="API base URL (or BUILDER_API_URL)")
    s.add_argument(
        "--key",
        help="capture key from Builder → Settings → Cloud capture (or BUILDER_CAPTURE_KEY); "
        "replaces pairing",
    )
    s.add_argument("--tz", help="IANA zone for the 04:00 day rule (or BUILDER_TZ / TZ)")
    s.add_argument(
        "--tau",
        default="auto",
        help="idle-gap threshold: 'auto' fits it to your presence intervals (v3; 900 s "
        "until there are 200 of them and the fit is bimodal), or a number of seconds",
    )
    s.add_argument("--dry-run", action="store_true", help="print the payloads; send nothing")
    s.add_argument(
        "--live",
        action="store_true",
        help="also upload the open session as state=live, with its live state (spec/live.v1.json)",
    )
    s.add_argument(
        "--live-names",
        action="store_true",
        help="OPT IN, with --live: also send the basename of each file on the live map "
        "(stored only while the account has File names on; never a directory)",
    )
    s.add_argument(
        "--finalize",
        action="store_true",
        help="treat the open session as ended now (SessionEnd hook: the container is going away)",
    )
    s.add_argument(
        "--analyze", action="store_true", help="attach an analysis via `claude -p` (opt-in)"
    )
    s.add_argument(
        "--no-other-harnesses",
        action="store_true",
        help="Claude Code only: skip Codex, Gemini CLI, Cline, opencode and Aider",
    )
    s.add_argument("--quiet", action="store_true", help="only print rejections and errors")
    s.set_defaults(fn=cmd_sync)

    n = sub.add_parser(
        "narrative",
        help="write the 'how you work' page from this machine's transcripts and upload it",
    )
    n.add_argument("--root", default=DEFAULT_ROOT, help=f"transcript root (default {DEFAULT_ROOT})")
    n.add_argument("--server", help="API base URL (or BUILDER_API_URL)")
    n.add_argument("--key", help="capture key (or BUILDER_CAPTURE_KEY); replaces pairing")
    n.add_argument("--tz", help="IANA zone for the 04:00 day rule (or BUILDER_TZ / TZ)")
    n.add_argument("--tau", default="auto", help="idle-gap threshold; see `sync --tau`")
    n.add_argument("--model", default=None, help="model for `claude -p` (default: sonnet)")
    n.add_argument("--dry-run", action="store_true", help="print the page; send nothing")
    n.add_argument(
        "--no-other-harnesses",
        action="store_true",
        help="Claude Code only: skip Codex, Gemini CLI, Cline, opencode and Aider",
    )
    n.add_argument("--quiet", action="store_true", help="only print errors")
    n.add_argument(
        "--days",
        type=int,
        default=None,
        help="trend window, and the window before it (default 30)",
    )
    n.set_defaults(fn=cmd_narrative)

    rp = sub.add_parser(
        "report",
        help="measure the builder report from this machine's transcripts and upload it",
    )
    rp.add_argument(
        "--root", default=DEFAULT_ROOT, help=f"transcript root (default {DEFAULT_ROOT})"
    )
    rp.add_argument("--server", help="API base URL (or BUILDER_API_URL)")
    rp.add_argument("--key", help="capture key (or BUILDER_CAPTURE_KEY); replaces pairing")
    rp.add_argument("--tz", help="IANA zone for the 04:00 day rule (or BUILDER_TZ / TZ)")
    rp.add_argument("--tau", default="auto", help="idle-gap threshold; see `sync --tau`")
    rp.add_argument(
        "--days",
        type=int,
        default=None,
        help="the window, and the length of each trend window (default 30)",
    )
    rp.add_argument("--dry-run", action="store_true", help="print the report; send nothing")
    rp.add_argument(
        "--quotes",
        action="store_true",
        help="OPT IN, this run only, never remembered: also send up to three of your prompts, "
        "verbatim, for the Wrapped cards that quote you (stored only while the account has "
        "Quote my prompts on)",
    )
    rp.add_argument(
        "--no-other-harnesses",
        action="store_true",
        help="Claude Code only: skip Codex, Gemini CLI, Cline, opencode and Aider",
    )
    rp.add_argument("--quiet", action="store_true", help="only print errors")
    rp.set_defaults(fn=cmd_report)

    lv = sub.add_parser(
        "live",
        help="tail running Claude Code transcripts into the hook's route; the server works "
        "out what each running session is doing",
    )
    lv.add_argument(
        "--transcript",
        action="append",
        help="a transcript to tail (repeatable); default: every one under --root written "
        "to in the last hour",
    )
    lv.add_argument("--root", default=DEFAULT_ROOT, help=f"transcript root (default {DEFAULT_ROOT})")
    lv.add_argument(
        "--every",
        type=float,
        default=5.0,
        help="seconds between ticks (default 5; UNMEASURED JUDGEMENT CALL, the cadence the "
        "phone's 60 s poll can show)",
    )
    lv.add_argument(
        "--heartbeat",
        type=float,
        default=30.0,
        help="seconds with nothing new before an empty post re-cuts on the server's clock "
        "(default 30; UNMEASURED JUDGEMENT CALL, half the phone's poll)",
    )
    lv.add_argument("--server", help="API base URL (or BUILDER_API_URL)")
    lv.add_argument("--key", help="capture key (or BUILDER_CAPTURE_KEY); replaces pairing")
    lv.add_argument("--tz", help="IANA zone for the 04:00 day rule (or BUILDER_TZ / TZ)")
    lv.add_argument("--once", action="store_true", help="post one tick and exit")
    lv.add_argument(
        "--for",
        dest="duration",
        type=float,
        default=None,
        help="stop after this many seconds (default: until Ctrl+C)",
    )
    lv.set_defaults(fn=cmd_live)

    q = sub.add_parser("quotes", help="delete the quotes this account stored")
    q.add_argument("--delete", action="store_true", help="delete them (DELETE /v1/profile/quotes)")
    q.add_argument("--server", help="API base URL (or BUILDER_API_URL)")
    q.add_argument("--key", help="capture key (or BUILDER_CAPTURE_KEY); replaces pairing")
    q.set_defaults(fn=cmd_quotes)

    # `python -m capture demo`: stills and a short video of a project, running (docs/demos.md).
    from .demo import cli as demo_cli

    demo_cli.add_parser(sub)
    return ap


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    # `demo --publish` and `demo --delete` are capture/demo_publish.py, with a parser of its
    # own, answered before `make_parser` so the `demo` subcommand stays the generator's
    # (capture/demo/, making a demo) and the two never define one flag twice.
    from . import demo_publish
    from .shipkit import cli as shipkit_cli

    # `demo kit|queue|watch|hook` are the ship kit's (capture/shipkit/cli.py), answered first:
    # `demo kit --publish` is the kit's publish, not the demo's.
    if shipkit_cli.claims(args):
        return shipkit_cli.main(args[1:])
    if demo_publish.claims(args):
        return demo_publish.main(args[1:])
    a = make_parser().parse_args(args)
    try:
        return a.fn(a)
    except cl.NotPaired as e:
        print(str(e), file=sys.stderr)
        return 3
    except cl.HTTPFailure as e:
        print(str(e), file=sys.stderr)
        return 4
    except (cl.CaptureKeyRejected, cl.MalformedCaptureKey) as e:
        # One line, no retry: a hook that loops on a revoked key would fill the log with
        # the same sentence every turn and never get anywhere.
        print(str(e), file=sys.stderr)
        return 5
    except KeyboardInterrupt:
        return 130


__all__ = ["ROOT", "build_payloads", "main", "make_parser"]
