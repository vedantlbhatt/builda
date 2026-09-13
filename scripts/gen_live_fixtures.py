#!/usr/bin/env python3
"""Generate spec/fixtures/live/content_state.json: the Live Activity's two halves, pinned.

The Lock Screen card is written twice, by `server/builder/live_push.content_state` (the
Python half, for an APNs `liveactivity` push) and by `mobile/src/live/surface.ts toState`
(the phone's half, for an activity it updates in the foreground). Python is the reference
(docs/overnight-integration.md section 0, rule 4): this script runs every scenario
transcript through the PRODUCER'S OWN PATH, the one the hook channel and `capture sync
--live` take, and writes, per case, the stored `live` block, the engine's sentence, and the
card Python computes from it. The phone's half is then held to the same values, as strip
conformance holds the Mac's.

    scenario transcript -> capture cut -> capture.sessions.build_payload
                        -> capture.sessions.attach_live         (the stored `live` block)
                        -> analysis.live.sentence               (renderLiveSentence)
                        -> live_push.content_state(row, stats, live, ...)   (toState)

Every case is a real engine output. Three things vary around it, each chosen so the
fixture pins a rule a single scenario could not:

  * the ETA: most cases compare against a history that answers it (`HISTORY`), so
    `progress` and `etaEpoch` are numbers; one refuses `no_history`, one `repo_unresolved`;
  * the clocks: the session row's `updated_at` is `ROW_LAG_SEC` OLDER than the state's
    `computed_at` (a heartbeat re-cut refreshes the live row and leaves the session row
    alone), so a card anchored on the wrong one is off by that much, and the push is made
    `PUSH_LAG_SEC` after the state was computed, so `updatedEpoch` is the push's clock;
  * the variants: `names` (the opt in basenames are on the row, and the card must not carry
    one), `map_cut` (the engine's own map cut, with its cap lowered so the case stays small:
    a count over a cut map is refused, `filesChanged` -1), and `final` (the `end` push's
    card, from the final row and no live state).

Standard library only, like every generator here: CI's `make gen` runs it on a bare Python.
The pydantic door check on every case's `live` block is in `server/tests/test_live_push.py`.
The output is byte stable: fixed clocks, a fixed salt, and ids derived from case names.
"""

from __future__ import annotations

import contextlib
import datetime as dt
import hashlib
import json
import pathlib
import sys
import tempfile
import uuid

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "spec" / "fixtures" / "live" / "content_state.json"

#: The scenarios the fixture covers: every verdict the engine can reach, a pending tool,
#: a turn handed back with background work out, every decision kind, and a harness that
#: reads through the shell (docs/overnight-engine.md
#: section 6, `tests/transcripts.py`).
SCENARIOS = (
    "starting",
    "converging",
    "circling_failures",
    "circling_churn",
    "lost",
    "waiting_question",
    "waiting_on_background",
    "done_after_commit",
    "pending_long_tool",
    "decisions_all",
    "blind_codex_like",
)

#: What the ETA matches history on: a stand in for the `repo_hash` the server keys stored
#: sessions by (`builder_profile.eta_history`), 64 hex like the real one.
REPO_KEY = hashlib.sha256(b"gen_live_fixtures repository").hexdigest()

#: Twelve finished, attended sessions on that repository, by active seconds: enough for the
#: engine's `ETA_MIN_SESSIONS` (10) to answer a young session and to refuse one that has
#: already outlived most of them (`too_few_survivors`, circling_failures at 281 s).
HISTORY_ACTIVE_SECONDS = (120, 180, 240, 300, 360, 420, 480, 540, 600, 900, 1200, 1800)

#: The session row is this much older than the live state (see the module docstring).
ROW_LAG_SEC = 90
#: The push is made this long after the state was computed.
PUSH_LAG_SEC = 30

#: The map cap for the `map_cut` case: the engine's `MAX_MAP_FILES` lowered for one call,
#: so its own cut (the one the 400 cap and the server's slim list body make) is exercised
#: without a 400 row case.
CUT_MAP_FILES = 2

#: (scenario, variant, eta, creature, running count). `eta` is "history", "no_history"
#: (no history supplied) or "no_repo" (no repository key). "unicorn" is not a creature: the
#: card draws Bit for it, as `normalizeCreature` does.
CASES = (
    ("starting", "live", "history", "crab", 0),
    ("converging", "live", "history", "octopus", 1),
    ("circling_failures", "live", "history", "dog", 2),
    ("circling_churn", "live", "history", "cat", 0),
    ("lost", "live", "no_history", "owl", 0),
    ("waiting_question", "live", "history", "fox", 1),
    # The agent waiting on its own background jobs: working, never needs you, no alert
    # (`surface.waitsOnBackground`), and the engine's "Waiting on two background tasks".
    ("waiting_on_background", "live", "history", "owl", 0),
    ("done_after_commit", "live", "history", "whale", 0),
    ("pending_long_tool", "live", "history", "bee", 3),
    ("decisions_all", "live", "history", "bit", 0),
    ("blind_codex_like", "live", "no_repo", "unicorn", 0),
    ("circling_churn", "names", "history", "cat", 1),
    ("converging", "map_cut", "history", "octopus", 0),
    ("done_after_commit", "final", "history", "whale", 0),
    ("circling_churn", "final", "history", "fox", 0),
)


def _paths() -> None:
    for p in (str(ROOT), str(ROOT / "server")):
        if p not in sys.path:
            sys.path.insert(0, p)


def missing_inputs() -> list[str]:
    """What this generator is still waiting on, by name. Empty when it can run."""
    _paths()
    missing: list[str] = []
    try:
        from analysis.tests import transcripts
    except ImportError:
        missing.append("analysis/tests/transcripts.py (the scenario builders)")
    else:
        absent = [s for s in SCENARIOS if not callable(getattr(transcripts, s, None))]
        if absent:
            missing.append("analysis/tests/transcripts.py scenarios " + ", ".join(absent))
    from analysis import live

    for name in ("wire", "wire_names", "eta_history", "session_state"):
        if not callable(getattr(live, name, None)):
            missing.append(f"analysis.live.{name}")
    try:
        from builder import live_push
    except ImportError:
        missing.append("server/builder/live_push.py")
    else:
        if not callable(getattr(live_push, "content_state", None)):
            missing.append("server/builder/live_push.content_state")
    return missing


def _iso(ts: float) -> str:
    return dt.datetime.fromtimestamp(ts, dt.UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def _history(profile, t0: float) -> list:
    """The finished sessions an ETA compares against, in the shape `live.eta_history` and
    `builder_profile.eta_history` build (id, clocks, repository key, attended)."""
    out = []
    for i, active in enumerate(HISTORY_ACTIVE_SECONDS):
        start = t0 - 86400 * (i + 1)
        out.append(
            profile.SessionFact(
                session_id=f"history-{i:02d}",
                started_at=start,
                ended_at=start + active,
                active_seconds=active,
                attended_seconds=active,
                autonomous_seconds=0,
                repo=REPO_KEY,
                unattended=False,
            )
        )
    return out


@contextlib.contextmanager
def _map_cap(live, cap: int | None):
    """The engine's map cap, lowered for one case and always put back."""
    if cap is None:
        yield
        return
    saved = live.MAX_MAP_FILES
    live.MAX_MAP_FILES = cap
    try:
        yield
    finally:
        live.MAX_MAP_FILES = saved


def _produce(scenario, *, eta: str, names: bool, cap: int | None):
    """The scenario at its own `now`, through the producer's path: the cut, the payload,
    and `attach_live` (which computes the state inside the directory it reads)."""
    from analysis import live, profile
    from analysis.tests import transcripts
    from capture import identity
    from capture import sessions as cap_sessions
    from capture.discover import Transcript

    now = transcripts.T0 + scenario.now
    history = _history(profile, transcripts.T0) if eta != "no_history" else None
    repo_key = REPO_KEY if eta != "no_repo" else None
    with tempfile.TemporaryDirectory(prefix="gen-live-fixtures-") as tmp:
        path = scenario.write(pathlib.Path(tmp))
        src = cap_sessions.load_source(Transcript(path.parent.name, path))
        cut = cap_sessions.sessionize_sources([src], dt.UTC, now=now)
        if not cut or cut[-1].state != "live":
            raise SystemExit(f"gen_live_fixtures.py: scenario {scenario.name} is not live at its now")
        s = cut[-1]
        p = cap_sessions.build_payload(s, dt.UTC, identity.machine_id("gen_live_fixtures"), "fixture/1", now)
        with _map_cap(live, cap):
            cap_sessions.attach_live(
                p, s, now=now, history=history, salt=transcripts.SALT, repo_key=repo_key, names=names
            )
    return p, now


def _case(name: str, variant: str, eta: str, creature: str, running: int) -> dict:
    from analysis.tests import transcripts

    from builder import live_push as lp

    scenario = transcripts.SCENARIOS[name]()
    p, computed = _produce(
        scenario,
        eta=eta,
        names=variant == "names",
        cap=CUT_MAP_FILES if variant == "map_cut" else None,
    )
    final = variant == "final"
    now = computed + PUSH_LAG_SEC
    stats = {
        "lines_added_agent": p["lines_added_agent"],
        "lines_removed_agent": p["lines_removed_agent"],
        "commit_count": p["commit_count"],
    }
    row = {
        "id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"builder/gen_live_fixtures/{name}/{variant}")),
        "harness": p["harness"],
        "repo_name": None,
        "started_at": p["started_at"],
        "ended_at": p["ended_at"],
        "updated_at": _iso(computed - ROW_LAG_SEC),
        "state": "final" if final else "live",
        "stats": stats,
    }
    if variant == "names":
        # On the row as `GET /v1/sessions/{id}` serves it with File names on; the card
        # must render the same sentence as without them.
        row["live_names"] = p["live_names"]
    live = None if final else p["live"]
    if final:
        running = 0  # a finished card counts nothing else (`surface.toState`, done)
    state = lp.content_state(row, stats, live, creature=creature, running_count=running, now=now)
    phase = state["phase"]
    spoken = lp.clamp_sentence(lp.sentence_of(row, live, phase, now))
    return {
        "name": name,
        "variant": variant,
        "row": row,
        "live": live,
        "ctx": {"nowMs": int(round(now * 1000)), "creature": creature, "runningCount": running},
        "sentence": None if live is None else lp.render(live),
        "spoken": spoken,
        "content_state": state,
        "relevance": lp.relevance_of(state, live),
        "alert": lp.alert_for(row, spoken) if phase == "needsYou" else None,
    }


def build() -> dict:
    from builder import live_push as lp

    return {
        "doc": (
            "The Live Activity card for real engine states, computed by "
            "server/builder/live_push.content_state (the reference). The phone's "
            "surface.toState(row, live, ctx) must equal content_state, "
            "renderLiveSentence(live) must equal sentence, sentenceOf must equal spoken, "
            "relevanceOf must equal relevance, and alertFor must equal alert on a needs you "
            "card. GENERATED by scripts/gen_live_fixtures.py; never hand edit."
        ),
        "keys": list(lp.CONTENT_STATE_KEYS),
        "constants": {
            "SENTENCE_MAX": lp.SENTENCE_MAX,
            "STALE_SECONDS": lp.STALE_SECONDS,
            "DISMISS_AFTER_SECONDS": lp.DISMISS_AFTER_SECONDS,
            "RELEVANCE_NEEDS_YOU": lp.RELEVANCE_NEEDS_YOU,
            "RELEVANCE_DEFAULT": lp.RELEVANCE_DEFAULT,
            "RELEVANCE_DONE": lp.RELEVANCE_DONE,
            "PRIVATE_REPO": lp.PRIVATE_REPO,
            "ROW_LAG_SEC": ROW_LAG_SEC,
            "PUSH_LAG_SEC": PUSH_LAG_SEC,
        },
        "cases": [_case(*c) for c in CASES],
    }


def main() -> int:
    print("gen_live_fixtures.py")
    missing = missing_inputs()
    if missing:
        print("  not generated yet, waiting on: " + "; ".join(missing))
        return 0
    doc = build()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n")
    print(f"  {OUT.relative_to(ROOT)}: {len(doc['cases'])} cases")
    return 0


if __name__ == "__main__":
    sys.exit(main())
