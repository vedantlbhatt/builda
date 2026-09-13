"""Transcripts in, contract v2 payloads out.

The pipeline, and where each step's rules live:

1. **records** — `measure_boundaries.load_records` (the reference) reads each root
   transcript with its partial-line rule and `classify`; the `extra` hook carries the
   record uuid, `sessionId`, `message.id`, usage, model and `subtype` alongside, so tokens
   and identities come from the same parse as the boundaries.
2. **pooling** — by the transcript's LINEAGE: the project directory the file lives in,
   with every record of one native session id folded into that id's dominant directory
   (`measure_boundaries.fold_by_session_lineage`). NOT by the repository each record's
   `cwd` resolves to. Claude Code stamps the shell's current cwd on every record, so a
   conversation whose shell `cd`s between home and a repo scatters across two keys —
   MEASURED on the container corpus: 332 cwd runs in one 2,231-record session, all 15
   human prompts under `/home/user` and 833 assistant records under the repo — and pooled
   per record that one sitting uploaded as TWO overlapping sessions, one with the prompts
   and no commits, one with the commits and "0 prompts typed". The repository is an
   attribute of the session (the dominant resolvable cwd, `Session.repo`), never the
   partition key. Two conversations back to back in one directory are one sitting.
3. **sessionize** — `measure_boundaries.sessionize_pools`, unchanged: every pool sees the
   human session starts of the others (rule `switched_repo`), and the idle-gap threshold
   is fitted to the pool's presence intervals (`tau="auto"`, v3) or given. Output sessions
   cover the time-sorted pool contiguously, so each session's records are recovered by
   slicing at the cumulative `records` counts; an assertion checks the slices tile the pool.
4. **the open session** — the last session in a pool is `still_running` (or `cleared`,
   which is final where it stands). Younger than the tau in force it is LIVE (uploaded only with `--live`, or finalized with
   `--finalize` when the container is about to disappear); older, it ended on an idle gap
   nobody was there to observe, and it is finalized the way the reference finalizes an
   idle-gap cut: the boundary gap credited, capped, to whichever clock was running, and
   `ended_at` extended by the same amount so active never exceeds elapsed.
5. **counts** — `analysis.digest.load_claude_code_events` supplies tool calls, edit-tool
   line deltas, human edits and compactions; nothing here re-parses tool inputs.
6. **tokens** — deduped on `message.id` across the sitting's files (a resumed transcript
   copies the old one's messages), first record in file order carries the usage,
   `<synthetic>` and sidechain records excluded (`token_ledger`).

**Every branch is treated as live.** The engine excludes records off the surviving DAG
branch from lines, tool counts and the strip, and reports their tokens as
`abandoned_branch_tokens`. Capture does not, and reports 0 there. MEASURED on a remote
transcript (harness 2.1.x) in which nothing was ever rewound: 51 fork points, of which 40
were a tool result and the NEXT assistant record both parented to the same `tool_use`
record and 11 were a `system`/assistant pair — the harness writes siblings without a
rewind. A single-chain walk from the newest leaf classed 35 of 599 assistant records, 14
tool calls and 18 of 216 authoritative usage records (8%) as abandoned work. On that
evidence the filter would subtract real work from ordinary sessions to catch rewinds that
are rare in this surface; the omission is the smaller lie, and it is labelled.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
import pathlib
import time
from collections import Counter

from analysis import digest

from . import identity, repo, strip
from .discover import Transcript
from .reference import mb
from .tuning import (
    ACTIVE_CALC_VERSION,
    ACTIVE_GAP_CAP_SEC,
    COUNTED_MIN_ACTIVE_SEC,
    COUNTED_MIN_MEANINGFUL_EVENTS,
    NOTABLE_MIN_ACTIVE_SEC,
    REPO_PEPPER_VERSION,
    SESSIONIZER_VERSION,
    SYNTHETIC_MODEL_SENTINEL,
    TAU_AUTONOMOUS_SEC,
    TAU_COMMIT_ATTRIBUTION_SEC,
)

#: The tool names that keep their own key on the wire.
UPLOADED_TOOLS = ("Read", "Edit", "Write", "Bash")

#: Where every other call goes: an MCP tool (`mcp__<server>__<tool>`, whose name would say
#: which service you use) to `mcp_other`, anything else to `other`. The contract has always
#: said so ("unknown and MCP names bucket to mcp_other / other"), and v4 made the six keys
#: data (`tool_calls.values`, `TOOL_CALL_KEYS`): an undeclared key is a 422.
TOOL_BUCKETS = ("mcp_other", "other")

#: The whole wire vocabulary of `tool_calls`, in the contract's order. Restated rather than
#: read from `privacy/upload-contract.json` because the server-only image does not ship
#: `privacy/`; `capture/tests/test_contract.py` pins it to the contract both ways.
TOOL_CALL_KEYS = (*UPLOADED_TOOLS, *TOOL_BUCKETS)

#: Every other harness's names for the same four acts.
#:
#: MEASURED off `spec/fixtures/{codex,gemini,cline,opencode,aider}` on 2026-09-06, which is
#: what each real writer produced. Without this a Codex session that ran a hundred commands
#: uploads `tool_calls: {}` and the phone says you reached for nothing, which is a plausible
#: wrong number rather than a missing one.
#:
#: A name that is not here used to be DROPPED, and that was a second plausible wrong number
#: (docs/overnight-integration.md 5.1): a sitting of WebSearch, ToolSearch or MCP calls
#: uploaded fewer tool calls than it made, and could fall under its prompt count, which the
#: server's `sanity_gate` rejects as a broken prompt filter. Now every call is bucketed
#: (`uploaded_tool_counts`). MEASURED on `~/.builder-overnight/corpus` (2026-09-13), the
#: five of 158 real sittings the gate rejected: ONE was this (3 prompts; 1 Bash, 1
#: ToolSearch and 3 PostHog MCP calls, of which 1 was counted) and is accepted now. The other
#: four have more typed prompts than tool calls with every call counted, checked against
#: the raw JSONL (6 against 2, 5 against 2, 4 against 2, 2 against 1): conversations, not a
#: broken filter, and the gate still rejects them (server/builder/routes/sync.py).
#: RECORDED, NOT FIXED: the Mac stores four tool columns (`SyncCommand.swift`) and still
#: drops the rest, so a sitting synced from the Mac carries fewer calls than the same
#: sitting from capture until its local schema grows the two buckets.
TOOL_ALIASES: dict[str, dict[str, str]] = {
    "codex": {"exec_command": "Bash", "shell": "Bash", "apply_patch": "Edit"},
    "gemini_cli": {
        "run_shell_command": "Bash",
        "read_file": "Read",
        "write_file": "Write",
        "replace": "Edit",
    },
    "cline": {
        "execute_command": "Bash",
        "read_file": "Read",
        "write_to_file": "Write",
        "replace_in_file": "Edit",
    },
    "opencode": {"bash": "Bash", "read": "Read", "write": "Write", "edit": "Edit"},
    "aider": {"run": "Bash", "apply_edit": "Edit"},
}


def tool_bucket(tool: str, harness: str) -> str:
    """The `tool_calls` key one call counts under: its own name when it is one of
    `UPLOADED_TOOLS` or a harness's alias for one, `mcp_other` for an MCP tool, `other` for
    everything else (WebSearch, WebFetch, ToolSearch, Task, Agent, Grep, Glob, TodoWrite,
    ExitPlanMode, Skill, Aider's `commit`, opencode's `websearch`)."""
    if tool in UPLOADED_TOOLS:
        return tool
    aliased = TOOL_ALIASES.get(harness, {}).get(tool)
    if aliased is not None:
        return aliased
    return "mcp_other" if tool.startswith("mcp__") else "other"


def uploaded_tool_counts(events: list[digest.Ev], harness: str) -> dict[str, int]:
    """`{TOOL_CALL_KEYS: n}` for one session, whatever tool wrote it. Every tool call counts
    exactly once (`tool_bucket`), so the total is the session's tool calls; a key with no
    calls is absent, not 0."""
    counts: Counter[str] = Counter()
    for e in events:
        if e.kind != "tool" or not e.tool:
            continue
        counts[tool_bucket(e.tool, harness)] += 1
    return dict(counts)

#: What the engine calls "meaningful": prompts, tool calls and human edits
#: (`EventKind.isMeaningful`), the count `Tuning.countedMinMeaningfulEvents` reads.
_MEANINGFUL_EV_KINDS = frozenset({"prompt", "tool", "human_edit"})


def is_counted(s) -> bool:
    """Whether a sitting is big enough to be one at all. THE ONE DEFINITION.

    It decides `visible` on the wire, which decides the population every server-side
    aggregate runs over, so anything measuring this machine's corpus has to use the same
    rule or it describes a different person than the phone does. It was written out twice
    — here and in `analysis/__main__.py` — and the second copy drifting is how the report
    came to attribute seven commits to sessions the phone does not show.
    """
    active = s.attended + s.autonomous
    meaningful = sum(1 for e in s.events if e.kind in _MEANINGFUL_EV_KINDS)
    return active >= COUNTED_MIN_ACTIVE_SEC or meaningful >= COUNTED_MIN_MEANINGFUL_EVENTS


# ----------------------------------------------------------------------------- records


def _extra(r: dict, line: int) -> dict:
    """What capture needs per record beyond what the boundary rules read."""
    msg = r.get("message") if isinstance(r.get("message"), dict) else {}
    usage = msg.get("usage") if isinstance(msg.get("usage"), dict) else None
    model = msg.get("model") if isinstance(msg.get("model"), str) and msg.get("model") else None
    return {
        "line": line,
        "uuid": r.get("uuid") if isinstance(r.get("uuid"), str) else None,
        "session_id": r.get("sessionId") if isinstance(r.get("sessionId"), str) else None,
        "msg_id": (msg.get("id") or r.get("requestId")) if r.get("type") == "assistant" else None,
        "usage": usage if r.get("type") == "assistant" else None,
        "model": model,
        "subtype": r.get("subtype") if isinstance(r.get("subtype"), str) else None,
        "sidechain": bool(r.get("isSidechain")),
        # WHICH AGENT wrote this record. Claude Code stamps a stable `agentId` per agent
        # instance and an `attributionAgent` naming its TYPE (general-purpose,
        # workflow-subagent, Explore). MEASURED on this container: 119 distinct agent ids
        # across 12,236 sidechain records. Everything downstream that counts tokens still
        # excludes sidechains, because the parent's Agent tool result already reports them
        # in aggregate (CLAUDE.md); these two fields are how the DELEGATION can be
        # described without double counting the work.
        "agent_id": r.get("agentId") if isinstance(r.get("agentId"), str) else None,
        "agent_type": (
            r.get("attributionAgent") if isinstance(r.get("attributionAgent"), str) else None
        ),
        # Links a subagent's records back to the Agent tool call that spawned it.
        "spawned_by": (
            r.get("sourceToolAssistantUUID")
            if isinstance(r.get("sourceToolAssistantUUID"), str)
            else None
        ),
    }


@dataclasses.dataclass
class Source:
    transcript: Transcript
    source_id: str
    records: list[dict]
    events: list[digest.Ev]


def load_source(t: Transcript) -> Source:
    src_id = identity.source_id(t.descriptor)
    records = mb.load_records(t.path, extra=_extra)
    for r in records:
        r["source_id"] = src_id
        r["path"] = str(t.path)
    events = digest.load_claude_code_events(t.path)
    return Source(t, src_id, records, events)


# ----------------------------------------------------------------------------- pooling


def pool_key(project_dir: str, harness: str = "claude_code") -> str:
    """The lineage key: harness and project directory. Never a cwd (module docstring).

    The harness leads so two tools working in the same directory are two lineages. They
    are: a Codex rollout and a Claude Code transcript in one repo are two sittings that
    happen to share a folder, and folding them together would credit one tool's idle gap
    to the other's active time."""
    return f"{harness}|dir:{project_dir}"


def dominant_repo(records: list[dict]) -> repo.RepoIdentity | None:
    """The repository most of a session's resolvable records were stamped with — an
    attribute of the session, decided after the cut. Ties go to the earliest seen."""
    counts: Counter[str] = Counter()
    first: dict[str, repo.RepoIdentity] = {}
    for r in sorted(records, key=lambda r: r["ts"]):
        ident = repo.identity_for(r.get("cwd"))
        if ident is None:
            continue
        counts[ident.identity] += 1
        first.setdefault(ident.identity, ident)
    if not counts:
        return None
    best = max(counts.values())
    for key in first:  # insertion order == earliest seen
        if counts[key] == best:
            return first[key]
    return None


# ----------------------------------------------------------------------------- sessions


@dataclasses.dataclass
class Session:
    """One cut of one pool, with the records and digest events inside it."""

    pool: str
    repo: repo.RepoIdentity | None
    records: list[dict]  # time-sorted, as the reference sorted them
    events: list[digest.Ev]
    started_at: float
    ended_at: float
    attended: float
    autonomous: float
    prompts: int
    presence: int
    end_reason: str
    state: str  # "live" | "final"

    @property
    def harness(self) -> str:
        """Which tool wrote this sitting. Read back off the pool key, which is built from
        it, so the payload's `harness` and the lineage it was cut in can never disagree."""
        return self.pool.split("|", 1)[0]

    @property
    def last_record_ts(self) -> float:
        return self.records[-1]["ts"]

    @property
    def first_record(self) -> dict:
        return self.records[0]

    @property
    def client_session_id(self) -> str:
        first = self.first_record
        native = first.get("uuid") or f"l{first['line']}"
        return identity.client_session_id(identity.event_uid(first["source_id"], native))

    @property
    def transcript_path(self) -> pathlib.Path:
        """The file holding most of this session's records — what `--analyze` digests."""
        by_path = Counter(r["path"] for r in self.records)
        return pathlib.Path(by_path.most_common(1)[0][0])


def _finalize_open(s: dict, recs: list[dict], now: float) -> None:
    """Apply the reference's idle-gap credit to a `still_running` session.

    The gap from the last record to `now` is credited like any other gap — capped at
    `activeGapCapSec`, to whichever clock was running at the last record — and `ended_at`
    is extended by the same amount, exactly as `sessionize` does when a later record
    reveals the gap. Credit is a property of the pool, not of where the cut lands.
    """
    last_ts = recs[-1]["ts"]
    gap = max(0.0, now - last_ts)
    credit = min(gap, ACTIVE_GAP_CAP_SEC)
    last_presence = max((r["ts"] for r in recs if r["presence"]), default=None)
    autonomous = last_presence is None or (last_ts - last_presence) > TAU_AUTONOMOUS_SEC
    s["active"] += credit
    if autonomous:
        s["autonomous"] += credit
    else:
        s["attended"] += credit
    s["ended_at"] = last_ts + credit
    s["end_reason"] = "idle_gap"


def sessionize_sources(
    sources: list[Source],
    tz: dt.tzinfo,
    now: float | None = None,
    finalize_open: bool = False,
    tau: str | float = "auto",
    report: dict | None = None,
) -> list[Session]:
    """Cut every pool with the reference and attach records and events to each session.

    `tau` is `"auto"` (fit to the presence intervals of every pool together — the v3 rule,
    falling back to 900 s below 200 intervals or when the fit is not bimodal), or seconds.
    `report`, when given, receives `tau` and the `TauFit` so the CLI can print it.
    """
    now = time.time() if now is None else now
    keyed: list[tuple[str, dict]] = []
    events_by_source: dict[str, list[digest.Ev]] = {}
    for src in sources:
        events_by_source[src.source_id] = src.events
        key = pool_key(src.transcript.project_dir, src.transcript.harness)
        keyed.extend((key, r) for r in src.records)
    pools = mb.fold_by_session_lineage(keyed)

    tau_value, fit = mb.resolve_tau(tau, pools)
    if report is not None:
        report["tau"] = tau_value
        report["fit"] = fit
    cuts = mb.sessionize_pools(pools, tz, tau=tau_value)

    out: list[Session] = []
    for key, recs in pools.items():
        cut = cuts[key]
        ordered = sorted(recs, key=lambda r: r["ts"])  # the reference's own sort, stable
        assert sum(s["records"] for s in cut) == len(ordered), "sessions must tile the pool"
        src_ids = {r["source_id"] for r in recs}
        pool_events = sorted(
            (e for sid in src_ids for e in events_by_source[sid]), key=lambda e: e.ts
        )
        offset = 0
        for i, s in enumerate(cut):
            members = ordered[offset : offset + s["records"]]
            offset += s["records"]
            state = "final"
            if s["end_reason"] == "still_running":
                age = now - members[-1]["ts"]
                if age < tau_value and not finalize_open:
                    state = "live"
                else:
                    _finalize_open(s, members, now)
            lo, hi = members[0]["ts"], members[-1]["ts"]
            evs = [e for e in pool_events if lo <= e.ts <= hi]
            out.append(
                Session(
                    pool=key,
                    repo=dominant_repo(members),
                    records=members,
                    events=evs,
                    started_at=s["started_at"],
                    ended_at=s["ended_at"],
                    attended=s["attended"],
                    autonomous=s["autonomous"],
                    prompts=s["prompts"],
                    presence=s["presence"],
                    end_reason=s["end_reason"],
                    state=state,
                )
            )
    out.sort(key=lambda s: s.started_at)
    return out


# ----------------------------------------------------------------------------- tokens


@dataclasses.dataclass
class Ledger:
    reported: bool
    buckets: dict[str, int] | None
    models: list[dict]
    coverage: str


def token_ledger(records: list[dict]) -> Ledger:
    """`TokenAccountant.ledger` over ONE SITTING's records: the first record per
    `message.id` in (source, line) order is authoritative; sidechain and `<synthetic>`
    records never contribute.

    Keyed on the message id alone across the sitting, not `(source, message.id)`: a
    resumed transcript BEGINS WITH A COPY of the old one's records (the same message id
    and usage under a new session id), the sitting pools both files, and a per source key
    counted every copied message twice. A message id is the API's own id for one response,
    so two files carrying it carry one response; `analysis.burn.turns_for_window` reads
    each message once across a sitting's files by the same rule, so the payload's buckets
    and its own burn block now count one set of messages. FOUND IN REVIEW (2026-09-13): the
    suite's resumed sitting uploaded 1,380 tokens beside a burn block of 920; on the real
    corpus 5 of 158 sittings, three of them exactly 2x (burn.py's measurement)."""
    seen: set[str] = set()
    b = {"input": 0, "output": 0, "cache_read": 0, "cache_w5m": 0, "cache_w1h": 0}
    out_by_model: Counter[str] = Counter()
    saw = False
    for r in sorted(records, key=lambda r: (r["source_id"], r["line"])):
        u = r.get("usage")
        mid = r.get("msg_id")
        if not u or not mid or r.get("sidechain") or r.get("model") == SYNTHETIC_MODEL_SENTINEL:
            continue
        if mid in seen:
            continue
        seen.add(mid)
        saw = True
        cc = u.get("cache_creation") if isinstance(u.get("cache_creation"), dict) else {}
        w5 = cc.get("ephemeral_5m_input_tokens")
        if w5 is None:
            w5 = u.get("cache_creation_input_tokens")
        one = {
            "input": _int(u.get("input_tokens")),
            "output": _int(u.get("output_tokens")),
            "cache_read": _int(u.get("cache_read_input_tokens")),
            "cache_w5m": _int(w5),
            "cache_w1h": _int(cc.get("ephemeral_1h_input_tokens")),
        }
        for k in b:
            b[k] += one[k]
        if r.get("model"):
            out_by_model[r["model"]] += one["output"]
    if not saw:
        return Ledger(False, None, [], "partial")
    total = max(sum(out_by_model.values()), 1)
    models = [
        {"model_id": m, "output_token_share": round(n / total, 4)}
        for m, n in out_by_model.most_common()
    ]
    return Ledger(True, b, models, "complete")


def _int(v) -> int:
    return v if isinstance(v, int) and not isinstance(v, bool) else 0


# ----------------------------------------------------------------------------- attribution


def attribution(agent_added: int, git_ins: int, git_commits: int, human_edits: int):
    """`TokenAccountant.attribution`: a LOWER BOUND bucket, never a percentage."""
    if git_commits <= 0 or git_ins <= 0:
        if agent_added == 0:
            return "unknown", "none"
        return ("almost_all_agent" if human_edits == 0 else "nine_in_ten"), "low"
    ratio = agent_added / max(git_ins, 1)
    confidence = "medium" if agent_added > git_ins else "high"
    if ratio < 0.5:
        bucket = "mostly_you"
    elif ratio < 0.75:
        bucket = "about_half"
    elif ratio < 0.9:
        bucket = "three_in_four"
    elif ratio < 0.97:
        bucket = "nine_in_ten"
    else:
        bucket = "almost_all_agent"
    return bucket, confidence


# ----------------------------------------------------------------------------- payload


def _iso(ts: float) -> str:
    return (
        dt.datetime.fromtimestamp(ts, dt.UTC)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def build_payload(
    s: Session,
    tz: dt.tzinfo,
    machine_id: str,
    client_version: str,
    observed_at: float | None = None,
    analysis: dict | None = None,
    turns_loader=None,
) -> dict:
    """Exactly the contract fields, anonymous mode: no `repo_name`, `title` or
    `title_source` — which repositories are public is a Mac-side setting.

    The two clocks are rounded the same way and the headline is their SUM, never rounded
    independently: the server rejects `attended + autonomous != active` beyond a second.

    `burn` and `title_ids` (v4) are computed here, like `feedback`, so every path that
    builds a payload carries them: `capture sync` and the hook channel alike.
    `turns_loader` is a memoised `analysis.burn.load_turns` for a caller that builds many
    payloads from one set of transcripts (`cli.build_payloads`); without one each payload
    reads its own files. `live` is NOT computed here: it moves with the clock, not the
    bytes, and is attached after the hash (`attach_live`).
    """
    from analysis import patterns as pat

    observed_at = time.time() if observed_at is None else observed_at
    attended = round(s.attended)
    autonomous = round(s.autonomous)
    active = attended + autonomous
    wall = s.ended_at - s.started_at

    # EACH EVENT ONCE, before anything is counted (`patterns.distinct_events`, the rule the
    # corpus cut applies as `corpus.distinct` and `session_burn` applies to its own block).
    # A resumed transcript begins with a copy of the old one's records and the sitting pools
    # both files, so every count below read the copies twice. FOUND IN REVIEW (2026-09-13),
    # the suite's own resumed sitting through this function: tool calls 9 where there were
    # 6, prompts 3 where there were 2, and tokens 1,380 beside its own burn block's 920.
    s = dataclasses.replace(s, events=pat.distinct_events(s.events))
    # The reference's prompt count (`measure_boundaries`: a `prompt` record), each record
    # once: a copied record keeps its uuid, and a record with no uuid is never merged.
    prompts = len(
        {r.get("uuid") or (r["source_id"], r["line"]) for r in s.records if r["kind"] == "prompt"}
    )

    tool_counts = uploaded_tool_counts(s.events, s.harness)
    meaningful = sum(1 for e in s.events if e.kind in _MEANINGFUL_EV_KINDS)
    human_edits = sum(1 for e in s.events if e.kind == "human_edit")
    # Every event that carries a line count, exactly as `TokenAccountant.agentLines`
    # sums them: Edit's structuredPatch, Write's created content, AND a Bash heredoc's
    # body (`ShellFileEffect` on the Swift side, `_bash_file_effect` here). Restricting
    # this to the edit tools is what made the same session read "+0 lines" on the card
    # while the analyst was told "+2450" from the digest, which reads heredocs.
    # MEASURED on this repository's container corpus, 17 root transcripts, 2026-09-06:
    # 2,452 of 2,458 attributable lines came through the shell.
    added = sum(e.added or 0 for e in s.events)
    removed = sum(e.removed or 0 for e in s.events)
    # `Set(evs.compactMap(\.targetPath))` on the Mac: any event naming a file touched it,
    # a shell write and a human edit included.
    touched = {e.path for e in s.events if e.path}

    counted = is_counted(s)
    unattended = s.presence == 0 and active >= NOTABLE_MIN_ACTIVE_SEC
    notable = counted and attended >= NOTABLE_MIN_ACTIVE_SEC and not unattended

    git = repo.WindowStats()
    if s.repo is not None:
        git = repo.window_stats(
            s.repo.common_root, s.started_at - TAU_COMMIT_ATTRIBUTION_SEC, s.ended_at
        )
    bucket, confidence = attribution(added, git.insertions, git.commits, human_edits)

    ledger = token_ledger(s.records)
    cols, marks = strip.build(s.records, s.started_at, s.ended_at)

    tz_offset = dt.datetime.fromtimestamp(s.started_at, tz).utcoffset() or dt.timedelta(0)

    p: dict = {
        "client_session_id": s.client_session_id,
        "machine_id": machine_id,
        "content_hash": "",  # filled below
        "client_version": client_version,
        "sessionizer_version": SESSIONIZER_VERSION,
        "active_calc_version": ACTIVE_CALC_VERSION,
        "harness": s.harness,
        "agent_observed_at": _iso(observed_at),
        "client_clock_offset_ms": 0,
        "started_at": _iso(s.started_at),
        "ended_at": _iso(s.ended_at),
        "active_seconds": active,
        "idle_seconds": max(0, int(wall - active)),
        "tz_offset_minutes": int(tz_offset.total_seconds() // 60),
        "time_quality": "ok",
        "state": s.state,
        "end_reason": s.end_reason,
        "attended_seconds": attended,
        "autonomous_seconds": autonomous,
        "presence_count": s.presence,
        "unattended": unattended,
        "visible": counted,
        "notable": notable,
        "strip_columns": strip.encode_columns(cols),
        "strip_marks": marks,
        "timeline_fidelity": "full",
        "human_prompt_count": prompts,
        "prompt_count_basis": "typed_promptsource",
        "tool_calls": tool_counts,
        "files_touched": len(touched),
        # The engine uploads 0 here today (SessionDeriver writes `n_files_created = 0`);
        # capture matches it rather than introduce a number the Mac never sends.
        "files_created": 0,
        "lines_added_agent": added,
        "lines_removed_agent": removed,
        "commit_count": git.commits,
        "commit_insertions": git.insertions,
        "commit_deletions": git.deletions,
        "human_edit_events": human_edits,
        "agent_line_bucket": bucket,
        "attrib_confidence": confidence,
        "tokens_reported": ledger.reported,
        # Every branch is counted as live (module doc); nothing is reported as abandoned.
        "abandoned_branch_tokens": 0,
        "token_dedupe": "message_id",
        "token_scope": "parent_aggregated",
        "token_coverage": ledger.coverage,
        "models": ledger.models,
        "model_state": "known",
        "repo_pepper_version": REPO_PEPPER_VERSION,
        "repo_id_basis": s.repo.basis if s.repo else "origin",
    }
    if ledger.reported:
        p["tokens"] = ledger.buckets
    if s.repo is not None:
        p["repo_hash"] = s.repo.hash
    if analysis is not None:
        p["analysis"] = analysis
    notes = _feedback(s)
    if notes is not None:
        p["feedback"] = notes
    spent = session_burn_of(s, loader=turns_loader)
    if spent is not None:
        p["burn"] = spent
    title = title_ids(s)
    if title is not None:
        p["title_ids"] = title
    p["content_hash"] = content_hash(p)
    return p


# ----------------------------------------------------------------------------- burn


def session_burn(events: list[digest.Ev], turns: list, harness: str = "claude_code") -> dict:
    """The contract v4 `burn` block (`SessionBurn`) for one sitting's events and usage:
    `analysis.burn.session_wire` over `burn.session_report`, THE ONE producer of the block.
    `burn_report` is the same report over one file; `session_report` takes events and turns
    already in hand, which is what a pooled sitting (records from several files, a resumed
    transcript) and the hook channel's in memory cut have. So `burn.explain` and the phone
    read one document whichever way the session was loaded
    (`spec/fixtures/burn/session.json` pins the phone's sentences to `explain`).

    Each event once (`patterns.distinct_events`, the corpus cut's rule): a resumed
    transcript's copy of the old one's records reaches the pooled sitting twice, and every
    count read off the events would count it twice. `harness` is the ANALYSIS name
    (`capture.harnesses.analysis_name`): it decides which refusal is true.

    Numbers, bools and enums only; absent is null, never 0 (the contract's docs):
    `capture/tests/test_burn_wire.py` holds the block to `burn_report` over the same bytes.
    """
    from analysis import burn as bn
    from analysis import patterns as pat

    report = bn.session_report(pat.distinct_events(events), list(turns), harness=harness)
    return bn.session_wire(report)


def session_burn_of(s: Session, loader=None) -> dict | None:
    """`session_burn` for a cut sitting: its usage from every file its records came from,
    windowed to it and each message once (`burn.turns_for_window`, the rule the corpus cut
    uses). None when the engine is not deployed beside capture (the older server-only
    image) or a file cannot be read: the field is then "not computed", which the contract
    says null means, never a refusal it did not make."""
    try:
        from analysis import burn as bn
    except ImportError:  # pragma: no cover - deployment shape, not logic
        return None
    from .harnesses import analysis_name

    kw = {} if loader is None else {"loader": loader}
    paths = sorted({r["path"] for r in s.records})
    try:
        turns = bn.turns_for_window(paths, s.started_at, s.ended_at, **kw)
    except (OSError, ValueError):
        return None
    return session_burn(s.events, turns, harness=analysis_name(s.harness))


# ----------------------------------------------------------------------------- title


def title_ids(s: Session) -> dict | None:
    """The contract v4 `title_ids` block: `analysis.vocab.session_title`'s verb, object and
    numbers, never its words (the phone renders "Debugged a failing test suite" from the
    ids) and never `names=True` (the one LOCAL title, with a directory name in it).

    A REFUSAL (no tool calls, a parser blind spot, writes that name no file, only Claude
    Code's own files written) is a document with no verb and the refusal's code in
    `reason`, as a burn refusal is `burn.reason`. FOUND IN THE ADVERSARIAL REVIEW
    (2026-09-13): it was None, which also means "not computed", so the server kept a live
    cut's title after the same sitting's final cut refused one. None now means only that
    the engine is not deployed beside capture. An answer says `reason: null`: every declared
    key is on the wire, as burn's are (the payload's hash moves once for a titled sitting)."""
    try:
        from analysis import patterns as pat
        from analysis import vocab
    except ImportError:  # pragma: no cover - deployment shape, not logic
        return None
    t = vocab.session_title(
        pat.SessionEvents(
            session_id=s.client_session_id,
            started_at=s.started_at,
            ended_at=s.ended_at,
            active_seconds=s.attended + s.autonomous,
            attended_seconds=s.attended,
            tz_offset_minutes=0,
            events=s.events,
        )
    )
    if t["verb"] is None:
        return {"verb": None, "object": None, "n": None, "modules": None, "reason": t["code"]}
    return {
        "verb": t["verb"],
        "object": t["object"],
        "n": t["count"],
        "modules": t["modules"],
        "reason": None,
    }


# ----------------------------------------------------------------------------- live


def attach_live(
    p: dict,
    s: Session,
    *,
    now: float,
    history: list | None,
    salt: str,
    repo_key: str | None = None,
    names: bool = False,
    loader=None,
) -> dict:
    """Attach contract v4 `live` (and, only with `names`, `live_names`) to a LIVE session's
    payload, AFTER `build_payload` hashed it: `content_hash` stays the hash of the payload
    without them, because the live block moves with the clock and not with the bytes
    (docs/overnight-integration.md 3.2; `_VOLATILE` excludes them too, so a re-hash agrees).

    The state is `analysis.live.session_state`, the one computation `capture sync --live`,
    the hook channel and `python -m analysis live` share; `repo_key` is what the ETA matches
    `history` on (the common root here, `repo_hash` on the server). Returns the LOCAL state,
    which carries the sentence a terminal prints; never upload it.
    """
    from analysis import live as lv

    if s.state != "live":
        raise ValueError("a live block belongs on a live payload only (the server's gate refuses one on a final)")
    st = lv.session_state(
        s, now=now, history=history, salt=salt, repo_key=repo_key, names=names, loader=loader
    )
    p["live"] = lv.wire(st)
    if names:
        named = lv.wire_names(st)
        if named is not None:
            p["live_names"] = named
    return st


def _feedback(s: Session) -> list[dict] | None:
    """What this sitting cost that the person would not have chosen, for the card.

    NOT a parameter like `analysis`, and the difference is the point: an analysis costs a
    model call, so the caller decides whether to pay for it. This is arithmetic over
    events already in memory, so every path that builds a payload gets it — sync, the hook
    channel, and the fixtures the contract test walks — and there is no way to end up with
    a card that has it in one and not the other.

    `analysis/` sits beside `capture/` and the repo-root Dockerfile copies both, but the
    older server-only image has only one; `hook_ingest._capture` already handles that
    shape the same way. A deployment without it uploads no feedback rather than failing to
    upload the session.
    """
    try:
        from analysis import feedback as fb
    except ImportError:  # pragma: no cover - deployment shape, not logic
        return None
    return fb.wire(s)


#: Fields that change on every run without the session changing. Excluded from the hash so
#: an unchanged session is `unchanged` on the server and skipped by `/v1/sync/known`. The
#: live block (`live`, `live_names`) moves with the CLOCK: "waiting on you for N minutes"
#: advances with no new byte, so it is resent on the live interval (`cli.cmd_sync`), never
#: because the hash moved (docs/overnight-integration.md 3.2).
_VOLATILE = frozenset(
    {"content_hash", "agent_observed_at", "client_clock_offset_ms", "live", "live_names"}
)


def content_hash(payload: dict) -> str:
    """sha256 over the canonical JSON of everything that can change.

    The whole payload, not a hand-picked list of fields, and the Mac does the same
    (`SyncCommand`: `Hashing.sha256Hex(encoder().encode(upload))`). It has to: a field
    left off such a list can never make a session look changed, so it would come back
    `unchanged` forever and never reach the phone. The analysis is the field that would
    have been forgotten first, since it arrives on a LATER run than the session it
    describes.
    """
    import json

    body = {k: v for k, v in payload.items() if k not in _VOLATILE}
    return identity.sha256_hex(json.dumps(body, sort_keys=True, separators=(",", ":")))
