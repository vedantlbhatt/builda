#!/usr/bin/env python3
"""The `builder://debug/live?payload=<JSON>` link (app/debug/live.tsx) for a real running
session, or for one of the Lock Screen states the fixtures in src/live/fixtures.ts do not have.

    python3 mobile/scripts/sim/live_payload.py self TRANSCRIPT [--record OUT.json] [--fresh] [--as-running]
    python3 mobile/scripts/sim/live_payload.py state lost|circling|over-typical|working-eta|finished
    python3 mobile/scripts/sim/live_payload.py replay live-self-1.json [--record OUT.json]

Prints the link on stdout. Nothing here maps anything to the Lock Screen: the link carries
what the server would hand the phone (a session row and the engine's `live_state` in its
`wire()` form) and the app runs its own `src/live/surface.ts` over it, the path a real poll
takes. `--record` also writes what the engine said and what `surface.ts` makes of it
(`live_state.ts`, run under bun over the same rows) next to the screenshots.

`self` runs exactly `python3 -m analysis live TRANSCRIPT --json` and cuts the transcript with
the uploader's own `capture.sessions` to get the row the uploader would send for that sitting
(started_at, the two clocks, files touched, lines and commits). The surfaces no longer read
`stats.files_touched` (it counts reads); the files a card calls "changed" are the engine map's
rows with an edit, and the record keeps both counts beside each other. The row's `repo_name`
is the repository's last path segment: the uploader is anonymous (no repo_name), so the phone
itself would say "private repo" until the repo is marked public on the Mac.

The link carries only the fields the phone reads (`phone_live`, and the row fields
`surface.ts` and `format.ts` use), so it stays under the router's limit (`LINK_MAX`); the
record keeps the engine's whole output, verbatim, beside it.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import subprocess
import sys
import time
import urllib.parse

HERE = pathlib.Path(__file__).resolve().parent
MOBILE = HERE.parent.parent
REPO = MOBILE.parent
sys.path.insert(0, str(REPO))

MIN = 60


def iso(ts: float) -> str:
    return dt.datetime.fromtimestamp(ts, dt.UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


#: MEASURED on the iPhone 16 Pro / iOS 18.2 simulator, 2026-09-13: a 2,037 character link
#: reached the route and a 2,458 character one never did (iOS delivers it, `UIOpenURLAction`
#: is in the log, and the router drops it with a LogBox warning); a 2,550 one once arrived cut
#: short. So the link carries only what `surface.ts` reads, and a longer one is refused here
#: rather than dropped there. The record keeps the engine's output verbatim.
LINK_MAX = 2000


def link(payload: dict) -> str:
    raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    # `:` and `,` are legal in a query (RFC 3986 pchar and sub-delims) and JSON is full of them.
    url = "builder://debug/live?payload=" + urllib.parse.quote(raw, safe=":,")
    if len(url) > LINK_MAX:
        sys.exit(f"the link is {len(url)} characters, over the {LINK_MAX} the router accepts")
    return url


def phone_live(state: dict) -> dict:
    """The blocks of `live.wire(state)` that `src/live/surface.ts` and `sentence.ts` read, and
    only their fields: activity, the verdict's state, evidence, basis and file, the ETA's three
    numbers, needs_you, and of the map what the phone reads from it: the rows the sentence can
    name (the verdict's and the activity's file, by id, for their role) and every row with an
    edit (`filesChangedOf` counts those; a row with none changes nothing it counts, so it is
    left out, and an unnamed row's 16 character id becomes a short one). `wire()` itself also
    drops `names`, `sentence` and decision details."""
    v = state.get("verdict") or {}
    e = state.get("eta") or {}
    named = {(state.get("activity") or {}).get("file_id"), v.get("file_id")} - {None}
    rows = (state.get("map") or {}).get("files") or []
    files = []
    for i, r in enumerate(rows):
        edits = int(r.get("edits") or 0)
        if r.get("id") in named or edits > 0:
            rid = r["id"] if r.get("id") in named else f"e{i}"
            files.append({"id": rid, "role": r["role"], "edits": edits})
    return {
        "activity": state.get("activity"),
        "verdict": {k: v.get(k) for k in ("state", "evidence", "basis", "file_id")} if v else None,
        "eta": {k: e.get(k) for k in ("elapsed_s", "typical_s", "remaining_s")} if e else None,
        "needs_you": state.get("needs_you"),
        "map": {"files": files},
    }


# ------------------------------------------------------------------ self


def engine(transcript: pathlib.Path) -> dict:
    run = subprocess.run(
        [sys.executable, "-m", "analysis", "live", str(transcript), "--json"],
        cwd=REPO,
        capture_output=True,
        text=True,
    )
    if run.returncode != 0:
        sys.exit(f"analysis live failed ({run.returncode}): {run.stderr.strip()}")
    return json.loads(run.stdout)


def uploader_row(transcript: pathlib.Path, session_id: str, at: float) -> dict | None:
    """The contract payload the uploader would send for this sitting at `at`."""
    from capture import discover
    from capture import sessions as cap

    t = discover.Transcript(project_dir=transcript.parent.name, path=transcript)
    tz = dt.datetime.now().astimezone().tzinfo
    for s in cap.sessionize_sources([cap.load_source(t)], tz, now=at):
        if s.client_session_id == session_id:
            return cap.build_payload(s, tz, machine_id="sim-capture", client_version="sim-capture", observed_at=at)
    return None


def self_payload(transcript: pathlib.Path, fresh: bool, as_running: bool = False) -> tuple[dict, dict]:
    """`as_running`: a sitting that has ended is sent as it stood when it ended, as a LIVE row, so
    there is an activity for the real link (the final row) to end with its finished card."""
    doc = engine(transcript)
    entry = doc["sessions"][0] if doc["sessions"] else doc.get("ended")
    if entry is None:
        sys.exit(f"nothing to show: {doc.get('reason')}")
    running = bool(doc["sessions"])
    st = entry["state"]
    sid = st["session_id"]
    at = doc["now"] if running else entry.get("ended_at", doc["now"])
    up = uploader_row(transcript, sid, doc["now"])
    if up is None:
        sys.exit(f"the uploader's cut has no sitting {sid[:12]}")
    map_rows = (st.get("map") or {}).get("files") or []
    files_map = len(map_rows)
    files_changed = sum(1 for r in map_rows if int(r.get("edits") or 0) > 0)
    repo = entry["repo"].rsplit("/", 1)[-1] if entry.get("repo") else None
    # Only the row fields `surface.ts` and `format.ts` read (the route fills the rest).
    row = {
        "id": sid,
        "harness": up["harness"],
        "repo_name": repo,
        "started_at": up["started_at"],
        "ended_at": up["ended_at"],
        # When the engine's numbers were taken: `etaEpochOf` anchors on it.
        "updated_at": iso(at),
        "active_seconds": up["active_seconds"],
        "autonomous_seconds": up["autonomous_seconds"],
        "unattended": up["unattended"],
        "notable": up["notable"],
        "state": "live" if running or as_running else "final",
        "stats": {
            "human_prompt_count": up["human_prompt_count"],
            "files_touched": up["files_touched"],
            "lines_added_agent": up["lines_added_agent"],
            "lines_removed_agent": up["lines_removed_agent"],
            "commit_count": up["commit_count"],
        },
    }
    payload = {"sessions": [{"session": row, "live": phone_live(st)}], "fresh": fresh}
    record = {
        "running": running,
        "row_state": row["state"],
        "engine": doc,
        "uploader": {
            k: up[k]
            for k in (
                "client_session_id", "state", "end_reason", "started_at", "ended_at", "active_seconds",
                "attended_seconds", "autonomous_seconds", "presence_count", "unattended", "notable",
                "human_prompt_count", "files_touched", "lines_added_agent", "lines_removed_agent",
                "commit_count",
            )
        },
        "files_touched": {"map": files_map, "uploader": up["files_touched"]},
        "files_changed": {"map_rows_with_an_edit": files_changed},
    }
    return payload, record


# ------------------------------------------------------------------ replay


def replay_payload(record_path: pathlib.Path) -> tuple[dict, dict]:
    """A moment `self` recorded, sent again: the engine's state exactly as that record kept it
    and the row it sent, through today's `phone_live`. For a state the live session is not in
    right now, e.g. live-self-1 (2026-09-13 04:23): its turn had ended with one background task
    out, which the first build called "needs you"."""
    rec = json.loads(record_path.read_text())
    doc = rec["engine"]
    entry = doc["sessions"][0] if doc["sessions"] else doc.get("ended")
    if entry is None:
        sys.exit(f"{record_path} holds no engine state")
    row = rec["payload"]["sessions"][0]["session"]
    payload = {"sessions": [{"session": row, "live": phone_live(entry["state"])}], "fresh": True}
    return payload, {"replayed_from": str(record_path), "recorded_at": rec.get("captured_at"), "engine": doc}


# ------------------------------------------------------------------ states the fixtures lack

EV0 = {
    "window_calls": 25, "errors_now": 0, "errors_before": 0, "new_files": 0, "checkpoints": 0,
    "repeats": 0, "churn_writes": 0, "fail_run": 0, "blind_edits": 0, "stuck_s": 0,
    "files_changed": 0, "commits": 0,
}


def ridegt_eta(elapsed_min: float) -> dict:
    """RideGT's real ETA block: 61 finished sessions that ran this long, median 20.9 minutes."""
    typical = round(20.9 * MIN)
    elapsed = round(elapsed_min * MIN)
    return {
        "elapsed_s": elapsed, "typical_s": typical, "p25_s": 9 * MIN, "p75_s": round(44.1 * MIN),
        "remaining_s": max(0, typical - elapsed), "n": 61,
        "basis": "finished_sessions_same_repo_that_ran_at_least_this_long", "reason": None,
    }


def row(sid: str, repo: str, harness: str, minutes: float, now: float, files: int, added: int) -> dict:
    return {
        "id": sid, "harness": harness, "repo_name": repo,
        "started_at": iso(now - minutes * MIN), "ended_at": iso(now - 20), "updated_at": iso(now - 20),
        "active_seconds": round(minutes * MIN), "autonomous_seconds": 0, "notable": True,
        "stats": {"human_prompt_count": 9, "files_touched": files, "lines_added_agent": added, "commit_count": 0},
    }


def state_payload(name: str) -> dict:
    now = time.time()

    def live(sid, activity, verdict, eta, score, reason, changed=0, read_only=0):
        # The map the engine would send: `changed` files with an edit, `read_only` with none.
        files = [{"id": f"{sid[:6]}{i:02d}", "role": "source", "reads": 1, "edits": 2} for i in range(changed)]
        files += [{"id": f"{sid[:6]}r{i:02d}", "role": "source", "reads": 2, "edits": 0} for i in range(read_only)]
        return {"session_id": sid, "activity": activity, "verdict": verdict, "eta": eta,
                "needs_you": {"score": score, "reason": reason}, "map": {"files": files}, "decisions": []}

    def act(kind, role, attempt=0, since=40, files=0, calls=1):
        return {"kind": kind, "role": role, "attempt": attempt, "since_s": since, "files": files,
                "calls": calls, "file_id": None}

    def verdict(state, basis, **ev):
        return {"state": state, "evidence": {**EV0, **ev}, "basis": basis, "reason": None, "file_id": None}

    if name == "working-eta":
        # Twelve minutes into a run that typically takes 21: an ETA the engine stands behind.
        sid, minutes, files, added = "debug-tramline", 12, 9, 214
        lv = live(sid, act("editing", "source", attempt=3, since=95, files=1, calls=3),
                  verdict("converging", "error_rate_down_and_new_files", errors_now=1, errors_before=3, new_files=2, checkpoints=1),
                  ridegt_eta(minutes), 5, "running_fine", changed=3, read_only=6)
        harness = "claude_code"
    elif name == "circling":
        # Stuck on one failing command for six minutes, still inside the typical run.
        sid, minutes, files, added = "debug-tramline-codex", 14, 11, 96
        lv = live(sid, act("testing", "test", since=20),
                  verdict("circling", "consecutive_failures", errors_now=6, errors_before=2, fail_run=5, stuck_s=6 * MIN + 12),
                  ridegt_eta(minutes), 66, "circling", changed=4, read_only=7)
        harness = "codex"
    elif name == "over-typical":
        # 34 minutes into a run that typically takes 21: the ring stays full, the caption says so.
        sid, minutes, files, added = "debug-tramline-long", 34, 15, 388
        lv = live(sid, act("editing", "source", since=70, files=2, calls=4),
                  verdict("converging", "error_rate_down_and_new_files", errors_now=0, errors_before=2, new_files=1, checkpoints=2),
                  ridegt_eta(minutes), 5, "running_fine", changed=7, read_only=8)
        harness = "claude_code"
    elif name == "finished":
        # working-eta's session (the same id, so the planner sees it MOVE) after its turn ended
        # with the work landed: the engine's done verdict while the row is still live. Finished,
        # not looked at yet: the card ends as finished, never "needs you", and the widget lists
        # it as finished. Send working-eta first, so there is a card to finish: the same start
        # (a card's attributes are fixed when it starts), so the widget's "ran" and the card's agree.
        sid, minutes, files, added = "debug-tramline", 12, 9, 214
        lv = live(sid, act("waiting_on_you", "unknown", since=3 * MIN, calls=0),
                  verdict("done", "turn_ended", files_changed=3, commits=1, checkpoints=2),
                  ridegt_eta(minutes), 31, "finished_unreviewed", changed=3, read_only=6)
        harness = "claude_code"
        return {"sessions": [{"session": row(sid, "tramline", harness, minutes, now, files, added), "live": phone_live(lv)}],
                "widget": True}
    elif name == "lost":
        # Editing files it never read: the engine's `lost` rule at its threshold.
        sid, minutes, files, added = "debug-tramline-lost", 19, 13, 162
        lv = live(sid, act("editing", "source", since=30, files=4, calls=4),
                  verdict("lost", "edits_to_unread_files", blind_edits=4, errors_now=2, errors_before=1),
                  # `_needs_you`: 55 + 5 for each blind file beyond LOST_MIN_BLIND_FILES (3).
                  ridegt_eta(minutes), 60, "lost", changed=6, read_only=7)
        harness = "claude_code"
    else:
        sys.exit(f"no state {name!r}: working-eta, circling, over-typical, lost, finished")
    return {"sessions": [{"session": row(sid, "tramline", harness, minutes, now, files, added), "live": phone_live(lv)}], "fresh": True}


# ------------------------------------------------------------------ main


def surface(payload: dict) -> dict:
    """What `src/live/surface.ts` makes of the rows, computed under bun by the phone's own code."""
    run = subprocess.run(
        ["bun", str(HERE / "live_state.ts")],
        cwd=MOBILE,
        input=json.dumps(payload),
        capture_output=True,
        text=True,
    )
    if run.returncode != 0:
        return {"error": run.stderr.strip()[-2000:]}
    return json.loads(run.stdout)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("self")
    s.add_argument("transcript")
    s.add_argument("--record")
    s.add_argument("--fresh", action="store_true", help="end every Builder activity first")
    s.add_argument("--as-running", action="store_true", help="an ended sitting as it stood when it ended, as a live row")
    t = sub.add_parser("state")
    t.add_argument("name")
    t.add_argument("--record")
    r = sub.add_parser("replay")
    r.add_argument("from_record")
    r.add_argument("--record")
    a = ap.parse_args()

    if a.cmd == "self":
        payload, record = self_payload(pathlib.Path(a.transcript).expanduser(), a.fresh, a.as_running)
    elif a.cmd == "replay":
        payload, record = replay_payload(pathlib.Path(a.from_record).expanduser())
    else:
        payload, record = state_payload(a.name), {}
    url = link(payload)
    if a.record:
        record = {
            "captured_at": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
            "command": f"python3 -m analysis live {a.transcript} --json" if a.cmd == "self" else None,
            **record,
            "payload": payload,
            "link_bytes": len(url),
            "surface": surface(payload),
        }
        pathlib.Path(a.record).write_text(json.dumps(record, indent=1, ensure_ascii=False, default=str) + "\n")
    print(url)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
