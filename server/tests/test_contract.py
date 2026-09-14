"""The wire contract, asserted from the server's side of the trust boundary.

The client's guarantee is structural — it encodes through a generated key enum with no
synthesized Codable, so an undeclared field is unrepresentable. These tests are the other
half: even a hostile or stale client must not be able to push a field into Postgres.
"""

import base64
import copy
import json
import re
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from pydantic import ValidationError

from builder import live_spec, quotes_spec
from builder.contract import (
    CONTRACT_VERSION,
    ENUM_VALUES,
    OBJECT_ENUM_VALUES,
    TOOL_CALL_KEYS,
    SessionUpload,
)
from builder.routes.sync import sanity_gate

REPO = Path(__file__).resolve().parents[2]
CONTRACT_JSON = REPO / "privacy" / "upload-contract.json"
ANALYSIS_JSON = REPO / "spec" / "analysis.v1.json"
LIVE_JSON = REPO / "spec" / "live.v1.json"
REPORT_JSON = REPO / "spec" / "report.v1.json"
PUBLISHED = Path(__file__).resolve().parents[1] / "builder" / "static" / "upload-fields.json"
MIGRATIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
LIVE_TYPES_TS = REPO / "mobile" / "modules" / "builder-live" / "src" / "BuilderLive.types.ts"

#: A complete SessionAnalysis, every field populated, every enum a legal value. Shared
#: with test_sync.py so the document that validates here is the one that round-trips
#: through Postgres there.
SAMPLE_ANALYSIS: dict = {
    "analysis_version": 1,
    "model": "claude-opus-5",
    "generated_at": "2026-08-15T10:05:00Z",
    "digest_hash": "e" * 64,
    "digest_coverage": 1.0,
    "headline": "Wired the sync endpoint to the two-clock session fields",
    "summary": (
        "Added attended and autonomous seconds to the upload contract and the server. "
        "Ended on a green suite."
    ),
    "highlights": ["two clocks on every payload", "the sanity gate checks they sum to active"],
    "outcome": "shipped",
    "build_style": {
        "planning": "light",
        "iteration": "linear",
        "steering": "guided",
        "verification": "ran_tests",
        "scope_control": "held",
        "architecture_note": None,
    },
    "dimensions": [
        {"dimension": d, "score": 70, "rationale": "grounded in the digest"}
        for d in ["steering", "execution", "engineering", "product_instinct", "planning"]
    ],
    "archetype": "architect",
    "decision_patterns": [
        {
            "pattern": "asks for the measurement before the constant",
            "prompt_excerpt": "what does the corpus say before we pick a number",
            "effect": None,
        }
    ],
    "prompting": {
        "tone": "terse",
        "specificity": 80,
        "correction_share": 0.1,
        "question_share": 0.2,
        "note": None,
    },
    "growth_edge": ["write the negative test before the migration"],
    "tags": ["sync", "contract"],
    "confidence": 0.8,
    "contains_sensitive": False,
}


def valid_payload(**overrides) -> SessionUpload:
    started = datetime(2026, 8, 15, 9, 0, tzinfo=UTC)
    # A strip whose non-idle share matches active_seconds, or the strip/active gate fires.
    cols = bytes([0b0000_0010] * 1024)
    base = {
        "client_session_id": "a" * 64,
        "machine_id": "b" * 64,
        "content_hash": "c" * 64,
        "client_version": "0.1.0",
        "sessionizer_version": 1,
        "active_calc_version": 1,
        "harness": "claude_code",
        "agent_observed_at": started + timedelta(hours=2),
        "client_clock_offset_ms": 0,
        "started_at": started,
        "ended_at": started + timedelta(hours=1),
        "active_seconds": 3600,
        "idle_seconds": 0,
        "tz_offset_minutes": -420,
        "time_quality": "ok",
        "state": "final",
        "end_reason": "idle_gap",
        "attended_seconds": 3600,
        "autonomous_seconds": 0,
        "presence_count": 10,
        "unattended": False,
        "visible": True,
        "notable": True,
        "strip_columns": base64.b64encode(cols).decode(),
        "strip_marks": [],
        "timeline_fidelity": "full",
        "human_prompt_count": 10,
        "prompt_count_basis": "typed_promptsource",
        "tool_calls": {"Bash": 100},
        "files_touched": 5,
        "files_created": 1,
        "lines_added_agent": 200,
        "lines_removed_agent": 10,
        "commit_count": 2,
        "commit_insertions": 150,
        "commit_deletions": 20,
        "human_edit_events": 1,
        "agent_line_bucket": "nine_in_ten",
        "attrib_confidence": "high",
        "tokens_reported": True,
        "tokens": {
            "input": 100,
            "output": 200,
            "cache_read": 5000,
            "cache_w5m": 10,
            "cache_w1h": 20,
        },
        "abandoned_branch_tokens": 0,
        "token_dedupe": "message_id",
        "token_scope": "parent_aggregated",
        "token_coverage": "complete",
        "models": [{"model_id": "claude-opus-5[1m]", "output_token_share": 1.0}],
        "model_state": "known",
        "repo_hash": "d" * 64,
        "repo_pepper_version": 1,
        "repo_id_basis": "origin",
    }
    base.update(overrides)
    return SessionUpload(**base)


def test_undeclared_fields_are_rejected():
    """extra='forbid' is the belt to the client's braces.

    The client cannot represent an undeclared field; this ensures a modified or
    third-party client cannot either.
    """
    with pytest.raises(ValidationError):
        valid_payload(prompt_text="how do I center a div")

    with pytest.raises(ValidationError):
        valid_payload(file_paths=["/Users/me/secret/project/main.swift"])


def test_never_list_fields_have_no_home_in_the_model():
    """The things we promise never leave must not even be nameable."""
    forbidden = [
        "prompt",
        "prompt_text",
        "content",
        "diff",
        "patch",
        "structured_patch",
        "file_path",
        "file_paths",
        "file_name",
        "cwd",
        "branch",
        "branch_name",
        "commit_message",
        "commit_sha",
        "origin_url",
        "hostname",
        "ip",
        "mcp_servers",
        "command",
        "stdout",
    ]
    declared = set(SessionUpload.model_fields)
    assert declared.isdisjoint(forbidden), declared & set(forbidden)


def test_published_field_list_matches_the_model():
    """The file the privacy page tells people to `curl` must match reality.

    If these diverge, the verification command on /privacy fails in public — which is
    worse than not offering one.
    """
    published = set(json.loads(PUBLISHED.read_text())["fields"])
    declared = set(SessionUpload.model_fields)
    assert published == declared, {
        "declared_not_published": declared - published,
        "published_not_declared": published - declared,
    }


def test_contract_version_matches_source():
    source = json.loads(CONTRACT_JSON.read_text())
    assert source["version"] == CONTRACT_VERSION


def test_public_only_fields_are_marked_as_such():
    source = json.loads(CONTRACT_JSON.read_text())
    public_only = {f["name"] for f in source["fields"] if f["modes"] == ["public"]}
    assert public_only == {"repo_name", "title", "title_source"}


def test_enum_values_are_enforced():
    with pytest.raises(ValidationError):
        valid_payload(harness="cursor")  # the real value is cursor_ide
    assert "cursor_ide" in ENUM_VALUES["harness"]
    # The full list, pinned.
    assert sorted(ENUM_VALUES["harness"]) == [
        "aider",
        "claude_code",
        "cline",
        "codex",
        "cursor_agent",
        "cursor_ide",
        "gemini_cli",
        "opencode",
    ]
    for value in ("gemini_cli", "cline", "opencode", "aider"):
        assert valid_payload(harness=value).harness == value

    # 'flat' must not be a legal token scope: it would let the ~3x subagent overcount
    # into the database wearing a legitimate label.
    assert "flat" not in ENUM_VALUES["token_scope"]
    with pytest.raises(ValidationError):
        valid_payload(token_scope="flat")


def test_every_contract_harness_exists_in_the_postgres_enum():
    """A contract value the `harness` TYPE does not know is a 500 on every upload.

    MEASURED, 2026-09-06: adding `opencode` and `aider` to the contract regenerated the
    Pydantic model, the Swift enum and the TypeScript union, and all three accepted an
    `aider` payload. The database did not — `invalid input value for enum harness: "aider"`
    on the INSERT, after validation had already passed. The contract generator cannot see a
    Postgres type, so a contract change that adds an enum value is ALWAYS also a migration,
    and this reads the migrations rather than trusting a comment to be remembered.
    """
    labels: set[str] = set()
    versions = Path(__file__).resolve().parents[1] / "alembic" / "versions"
    for path in sorted(versions.glob("*.py")):
        text_ = path.read_text()
        # 0001 creates the type; every later migration grows it with ADD VALUE.
        for m in re.finditer(r"CREATE TYPE harness AS ENUM \(([^)]*)\)", text_):
            labels |= set(re.findall(r"'([a-z_]+)'", m.group(1)))
        if "ALTER TYPE harness ADD VALUE" in text_:
            for m in re.finditer(r"NEW_VALUES = \(([^)]*)\)", text_):
                labels |= set(re.findall(r'"([a-z_]+)"', m.group(1)))
    missing = sorted(set(ENUM_VALUES["harness"]) - labels)
    assert not missing, f"harness values with no migration: {missing}"


def test_contract_keeps_the_v3_boundary_fields_and_enums():
    """v2 added live snapshots and the two clocks; v3 added `feedback`; v4 changed none of
    them. The server's cache-schema names (open, idle, finalizing) are not wire states:
    only what the Mac actually uploads is legal."""
    assert CONTRACT_VERSION == 4
    assert sorted(ENUM_VALUES["state"]) == ["final", "live"]
    assert sorted(ENUM_VALUES["end_reason"]) == [
        "cleared",
        "day_boundary",
        "human_returned",
        "idle_gap",
        "still_running",
        "switched_repo",
    ]
    for bad_state in ("open", "idle", "finalizing"):
        with pytest.raises(ValidationError):
            valid_payload(state=bad_state)
    with pytest.raises(ValidationError):
        valid_payload(end_reason="timeout")

    p = valid_payload(state="live", end_reason="still_running")
    assert p.state == "live"
    # All five boundary fields are required; a v1 client that omits them is a 422, not a
    # row of silent zeros.
    for missing in (
        "attended_seconds",
        "autonomous_seconds",
        "presence_count",
        "end_reason",
        "unattended",
    ):
        data = valid_payload().model_dump()
        del data[missing]
        with pytest.raises(ValidationError):
            SessionUpload(**data)


def test_analysis_validates_a_full_document_and_rejects_a_nested_extra_key():
    """`analysis` is the one prose field, and its shape is closed at every level: an
    undeclared key three objects deep is as unstorable as one at the top."""
    p = valid_payload(analysis=SAMPLE_ANALYSIS)
    assert p.analysis is not None
    assert p.analysis.model_dump(mode="json") == SAMPLE_ANALYSIS

    nested_extra = {
        **SAMPLE_ANALYSIS,
        "build_style": {**SAMPLE_ANALYSIS["build_style"], "vibe": "good"},
    }
    with pytest.raises(ValidationError):
        valid_payload(analysis=nested_extra)

    with pytest.raises(ValidationError):
        valid_payload(analysis={**SAMPLE_ANALYSIS, "raw_prompts": ["how do I center a div"]})

    # Bounded on the way in: the excerpt cap is what keeps "short verbatim quote" true.
    too_long = {
        **SAMPLE_ANALYSIS,
        "decision_patterns": [
            {"pattern": "p", "prompt_excerpt": "x" * 161, "effect": None},
        ],
    }
    with pytest.raises(ValidationError):
        valid_payload(analysis=too_long)

    # Absent and null are both legal, and both mean "no analysis".
    assert valid_payload().analysis is None
    assert valid_payload(analysis=None).analysis is None


def test_published_leaf_paths_cover_every_analysis_scalar():
    """The verification command walks every scalar path of a real payload. If a nested
    analysis path is missing from `leaf_paths`, the first person to run it in public sees
    "sent but not declared" on correct output — the failure the CLAUDE.md note describes.

    Reproduce the command's jq/sed pipeline over the sample document and require every
    path it yields to be published."""
    leaf_paths = set(json.loads(PUBLISHED.read_text())["leaf_paths"])

    def scalar_paths(value, at: str) -> list[str]:
        if isinstance(value, dict):
            return [p for k, v in value.items() for p in scalar_paths(v, f"{at}.{k}")]
        if isinstance(value, list):
            # The command strips list indices mid-path and trailing.
            return [p for v in value for p in scalar_paths(v, at)]
        return [at]

    actual = set(scalar_paths(SAMPLE_ANALYSIS, "analysis"))
    assert actual, "the sample should produce scalar paths"
    assert actual <= leaf_paths, {"sent_but_not_declared": sorted(actual - leaf_paths)}

    # And the walker did not invent paths the spec does not have.
    spec = json.loads(ANALYSIS_JSON.read_text())
    top = {f["name"] for f in spec["fields"]}
    assert {p.split(".")[1] for p in leaf_paths if p.startswith("analysis.")} == top


# --------------------------------------------------------------------- sanity gates


def test_gate_rejects_active_exceeding_elapsed():
    p = valid_payload(active_seconds=7200)
    assert "exceeds span" in (sanity_gate(p) or "")


def test_gate_rejects_undeduplicated_tokens():
    """The 1.878x content-block overcount, arriving unlabelled."""
    p = valid_payload(token_dedupe="none")
    assert "token_dedupe" in (sanity_gate(p) or "")


def test_gate_rejects_tokens_on_a_harness_that_reports_none():
    """Cursor writes {0,0} locally. Absent must stay absent, never become zero."""
    p = valid_payload(tokens_reported=False)
    assert "tokens_reported is false" in (sanity_gate(p) or "")


def test_gate_rejects_prompt_inflation():
    """More prompts than tool calls means the typed-prompt filter broke — the naive count
    over-reports by ~13x."""
    p = valid_payload(human_prompt_count=500, tool_calls={"Bash": 10})
    assert "exceeds tool_calls" in (sanity_gate(p) or "")


def test_gate_accepts_a_short_conversation_and_still_catches_the_inflation_bug():
    """The four real corpus sittings the gate rejected (6 prompts to 2 calls, 5 to 2, 4 to 2,
    2 to 1) pass; the bug the gate is for (every tool result counted as a prompt) puts the
    prompt count above the tool count on every session with a typed prompt, and is still
    refused from `PROMPT_GATE_MIN_TOOL_CALLS` calls up."""
    from builder.routes.sync import PROMPT_GATE_MIN_TOOL_CALLS

    conversations = (
        (6, {"Bash": 2}),
        (5, {"Bash": 1, "other": 1}),
        (4, {"Bash": 2}),
        (2, {"Bash": 1}),
    )
    for prompts, tools in conversations:
        assert sanity_gate(valid_payload(human_prompt_count=prompts, tool_calls=tools)) is None
    floor = PROMPT_GATE_MIN_TOOL_CALLS
    # a broken filter over a sitting of `floor` calls and one typed prompt reads floor + 1
    p = valid_payload(human_prompt_count=floor + 1, tool_calls={"Bash": floor})
    assert "exceeds tool_calls" in (sanity_gate(p) or "")
    assert sanity_gate(valid_payload(human_prompt_count=floor, tool_calls={"Bash": floor})) is None


def test_gate_rejects_wrong_sized_strip():
    p = valid_payload(strip_columns=base64.b64encode(bytes([0] * 512)).decode())
    assert "512 bytes" in (sanity_gate(p) or "")


def test_gate_rejects_reserved_bits():
    """Bits 4-7 are reserved. A non-zero one means a client is writing a field we have
    not defined, and accepting it would burn the only expansion room the format has."""
    cols = bytearray([0b0000_0010] * 1024)
    cols[7] = 0b1000_0010
    p = valid_payload(strip_columns=base64.b64encode(bytes(cols)).decode())
    assert "reserved bits" in (sanity_gate(p) or "")


def test_gate_rejects_strip_disagreeing_with_active_time():
    """A strip built from a different event set than the session it describes is the
    hardest client bug to notice by eye, so the server checks they agree."""
    p = valid_payload(strip_columns=base64.b64encode(bytes([0] * 1024)).decode())
    assert "strip disagrees" in (sanity_gate(p) or "")


def test_gate_rejects_clocks_that_do_not_sum_to_active():
    """attended + autonomous is active by construction on the client. A mismatch means
    the two were computed from different event sets."""
    p = valid_payload(attended_seconds=3000, autonomous_seconds=0)
    assert "active_seconds is 3600" in (sanity_gate(p) or "")
    # A rounding second is fine.
    assert sanity_gate(valid_payload(attended_seconds=3599, autonomous_seconds=0)) is None
    assert sanity_gate(valid_payload(attended_seconds=1800, autonomous_seconds=1800)) is None


def test_gate_pins_unattended_to_presence():
    """The 5h40m robot: zero presence over a notable span must arrive as unattended, or
    it is a personal record again. And a session with a presence signal is a sitting."""
    p = valid_payload(presence_count=0, unattended=False, active_seconds=3600)
    assert "presence_count is 0" in (sanity_gate(p) or "")
    assert sanity_gate(valid_payload(presence_count=0, unattended=True)) is None

    p = valid_payload(presence_count=3, unattended=True)
    assert "unattended is true with presence_count 3" in (sanity_gate(p) or "")

    # Below the notable floor the flag is not read by anything, so it is not pinned.
    started = datetime(2026, 8, 15, 9, 0, tzinfo=UTC)
    short = valid_payload(
        presence_count=0,
        unattended=False,
        active_seconds=600,
        attended_seconds=600,
        ended_at=started + timedelta(minutes=10),
    )
    assert sanity_gate(short) is None


def test_gate_requires_state_and_end_reason_to_agree():
    assert "does not agree" in (sanity_gate(valid_payload(state="live")) or "")
    assert "does not agree" in (
        sanity_gate(valid_payload(state="final", end_reason="still_running")) or ""
    )
    assert sanity_gate(valid_payload(state="live", end_reason="still_running")) is None


def test_gate_gives_a_young_live_snapshot_strip_grace_only():
    """A 60-second-old live session has a nearly empty strip; the 25% tolerance would
    reject nearly every first snapshot. Above the grace window a live payload is held to
    the same rule as a final one, and every other strip check applies regardless."""
    started = datetime(2026, 8, 15, 9, 0, tzinfo=UTC)
    empty = base64.b64encode(bytes([0] * 1024)).decode()
    young = valid_payload(
        state="live",
        end_reason="still_running",
        active_seconds=120,
        attended_seconds=120,
        ended_at=started + timedelta(minutes=2),
        strip_columns=empty,
    )
    assert sanity_gate(young) is None

    grown = valid_payload(state="live", end_reason="still_running", strip_columns=empty)
    assert "strip disagrees" in (sanity_gate(grown) or "")

    bad_size = valid_payload(
        state="live",
        end_reason="still_running",
        active_seconds=120,
        attended_seconds=120,
        ended_at=started + timedelta(minutes=2),
        strip_columns=base64.b64encode(bytes([0] * 512)).decode(),
    )
    assert "512 bytes" in (sanity_gate(bad_size) or "")


def test_gate_rejects_title_without_repo_name():
    """Titles are public-repo-only. A title on an anonymous session means the client's
    mode allowlist was not applied."""
    p = valid_payload(repo_name=None, title="Wired up Stripe webhooks")
    assert "without repo_name" in (sanity_gate(p) or "")


def test_valid_payload_passes():
    assert sanity_gate(valid_payload()) is None


# ------------------------------------------------------------------------ contract v4
#
# docs/overnight-integration.md section 2 and its addendum: the tool map allowlist as data,
# `live` and the opt-in `live_names` (spec/live.v1.json), the session objects `burn` and
# `title_ids`, and the `quotes` document. Every enum below copies a Python table, and the
# tests at the end of this section pin each copy to its table in both directions.

#: A LiveState with every field populated and every list non-empty, so a scalar walk of it
#: reaches every leaf path the spec can produce (the verification command's view).
SAMPLE_LIVE: dict = {
    "live_version": 1,
    "computed_at": "2026-09-13T07:41:05Z",
    "activity": {
        "kind": "editing",
        "role": "source",
        "attempt": 2,
        "since_s": 212,
        "files": 1,
        "calls": 3,
        "file_id": "3f9a0c1d2e4b5a69",
    },
    "verdict": {
        "state": "circling",
        "basis": "causes:file_churn_with_failures",
        "reason": None,
        "file_id": "3f9a0c1d2e4b5a69",
        "evidence": {
            "window_calls": 12,
            "errors_now": 3,
            "errors_before": 1,
            "new_files": 0,
            "checkpoints": 4,
            "repeats": 1,
            "churn_writes": 4,
            "fail_run": 2,
            "blind_edits": 0,
            "stuck_s": 340,
            "files_changed": 2,
            "commits": 0,
            "background": 0,
        },
    },
    "eta": {
        "elapsed_s": 5412,
        "typical_s": None,
        "p25_s": None,
        "p75_s": None,
        "remaining_s": None,
        "n": 5,
        "needed": 10,
        "unattended": False,
        "basis": "finished_sessions_same_repo_that_ran_at_least_this_long",
        "reason": "too_few_sessions",
    },
    "decisions": [{"kind": "added_dependency", "ts": 1757748660.2, "event_n": 41, "count": 1}],
    "needs_you": {"score": 64, "reason": "circling"},
    "map": {
        "files": [
            {
                "id": "3f9a0c1d2e4b5a69",
                "dir_id": "0a1b2c3d4e5f6071",
                "role": "source",
                "depth": 1,
                "reads": 2,
                "edits": 4,
                "last_read_ts": 1757748660.2,
                "last_edit_ts": 1757749001.9,
            }
        ],
        "files_total": 25,
    },
    "timelapse": [{"t": 0, "file_id": "3f9a0c1d2e4b5a69", "kind": "read"}],
    "sample": {"events": 412, "tool_calls": 131, "segments": 9, "tokens": 12900311},
}

SAMPLE_LIVE_NAMES: dict = {"files": [{"id": "3f9a0c1d2e4b5a69", "name": "auth.py"}]}

#: A session burn block with every field populated, and a title.
SAMPLE_BURN: dict = {
    "tokens": 12900311,
    "cache_read_share": 0.9451,
    "barren_share": 0.0312,
    "unreadable_share": 0.12,
    "segments": 9,
    "lines_added": 412,
    "lines_removed": 38,
    "files_changed": 6,
    "commits": 2,
    "reason": None,
    "spikes": [
        {
            "tokens": 9100000,
            "multiple": 7.4,
            "barren": False,
            "lines_added": 40,
            "lines_removed": 3,
            "seconds": 1840,
            "causes": [
                {"cause": "context_replay", "n": 8600000, "tokens": 8600000, "repeat": None},
                {"cause": "repeated_call", "n": 3, "tokens": 60586, "repeat": "shell"},
            ],
            "files_changed": 2,
            "commits": 1,
            "unreadable": False,
        }
    ],
    "spikes_needed": 5,
}

#: A session call_tokens block with every field populated: 7 calls, one to a point, the first
#: a return to an expired cache (RideGT `0a050ea3` call 124's numbers), priced on Opus 5.
SAMPLE_CALL_TOKENS: dict = {
    "reason": None,
    "calls": 7,
    "calls_needed": 5,
    "per_point": 1,
    "points": [
        {"at": 4, "cache_read": 26448, "cache_write": 140553, "input": 2, "output": 398},
        {"at": 14, "cache_read": 167001, "cache_write": 918, "input": 2, "output": 669},
        {"at": 22, "cache_read": 167919, "cache_write": 766, "input": 2, "output": 238},
        {"at": 31, "cache_read": 168685, "cache_write": 455, "input": 2, "output": 223},
        {"at": 40, "cache_read": 169140, "cache_write": 440, "input": 2, "output": 247},
        {"at": 52, "cache_read": 169580, "cache_write": 284, "input": 2, "output": 427},
        {"at": 184, "cache_read": 169864, "cache_write": 826, "input": 2, "output": 756},
    ],
    "lifetime_seconds": 3600,
    "rewrites": [{"call": 1, "away_seconds": 4095, "written": 140553}],
    "rewrite_calls": 1,
    "usd_cache_read": 0.5193185,
    "usd_cache_write": 2.88484,
    "usd_input": 0.00007,
    "usd_output": 0.0739,
    "price_reason": None,
}

#: The burn block a payload carrying SAMPLE_CALL_TOKENS carries beside it: burn counts the same
#: window's tokens, and the gate holds the chart's points to it.
SAMPLE_BURN_FOR_CALLS: dict = {
    **SAMPLE_BURN,
    "tokens": sum(
        p["cache_read"] + p["cache_write"] + p["input"] + p["output"]
        for p in SAMPLE_CALL_TOKENS["points"]
    ),
}

#: The same block refused for a short sitting: how many calls, and nothing drawn.
SAMPLE_CALL_TOKENS_REFUSED: dict = {
    "reason": "too_few_calls",
    "calls": 3,
    "calls_needed": 5,
    "per_point": None,
    "points": None,
    "lifetime_seconds": None,
    "rewrites": None,
    "rewrite_calls": None,
    "usd_cache_read": None,
    "usd_cache_write": None,
    "usd_input": None,
    "usd_output": None,
    "price_reason": None,
}

SAMPLE_TITLE_IDS: dict = {
    "verb": "refactored",
    "object": "source",
    "n": 3,
    "modules": 2,
    "reason": None,
}
#: A refused title (vocab.session_title's `code`): no verb, no object, the reason why.
SAMPLE_TITLE_REFUSAL: dict = {
    "verb": None,
    "object": None,
    "n": None,
    "modules": None,
    "reason": "below_checkpoint_density",
}

SAMPLE_QUOTES: dict = {
    "quotes_version": 1,
    "generated_at": "2026-09-13T08:00:00Z",
    "quotes": [
        {
            "card": "cryptic_prompt",
            "text": "ok now the other one",
            "client_session_id": "a" * 64,
            "sent_at": "2026-09-12T21:04:00Z",
            "seconds_in": 1260,
            "tool_calls_after": 7,
            "corrected": False,
        }
    ],
}


def _scalar_paths(value, at: str) -> list[str]:
    """The verification command's jq/sed pipeline: every scalar path, list indices
    stripped mid-path and trailing."""
    if isinstance(value, dict):
        return [p for k, v in value.items() for p in _scalar_paths(v, f"{at}.{k}" if at else k)]
    if isinstance(value, list):
        return [p for v in value for p in _scalar_paths(v, at)]
    return [at]


def _analysis():
    """The analysis package, importable from the server's tests as test_ingest does."""
    if str(REPO) not in sys.path:
        sys.path.insert(0, str(REPO))
    import analysis

    return analysis


def _contract() -> dict:
    return json.loads(CONTRACT_JSON.read_text())


def _live_spec() -> dict:
    return json.loads(LIVE_JSON.read_text())


def test_contract_is_v4():
    """One version everywhere it is written: the source, the generated door, the page the
    privacy check fetches."""
    assert _contract()["version"] == 4
    assert CONTRACT_VERSION == 4
    assert json.loads(PUBLISHED.read_text())["version"] == 4
    assert live_spec.LIVE_VERSION == _live_spec()["version"] == 1


def test_toolmap_keys_outside_the_contract_are_rejected():
    """The contract always said unknown and MCP tool names bucket to mcp_other / other.
    v4 makes the door keep that promise: a raw tool name is a 422, not a stored key."""
    source = next(f for f in _contract()["fields"] if f["name"] == "tool_calls")
    assert source["values"] == TOOL_CALL_KEYS
    assert json.loads(PUBLISHED.read_text())["tool_call_keys"] == source["values"]

    allowed = {k: 10 for k in TOOL_CALL_KEYS}
    assert valid_payload(tool_calls=allowed).tool_calls == allowed
    for raw in ("WebSearch", "ToolSearch", "Grep", "mcp__posthog__exec", "Task"):
        with pytest.raises(ValidationError):
            valid_payload(tool_calls={"Bash": 90, raw: 10})


def test_live_state_validates_a_full_document_and_closes_every_level():
    p = valid_payload(state="live", end_reason="still_running", live=SAMPLE_LIVE)
    assert p.live is not None
    assert p.live.model_dump(mode="json") == SAMPLE_LIVE
    assert valid_payload().live is None

    def broken(mutate) -> dict:
        doc = copy.deepcopy(SAMPLE_LIVE)
        mutate(doc)
        return doc

    rejected = {
        # A path, a basename or a hash of the wrong length is never a file id.
        "path as file id": broken(
            lambda d: d["activity"].update(file_id="/tmp/zqx_sentinel_dir/zqx_secret.py")
        ),
        "basename as map id": broken(lambda d: d["map"]["files"][0].update(id="zqx_secret.py")),
        "20 hex id": broken(lambda d: d["timelapse"][0].update(file_id="3f9a0c1d2e4b5a6901ab")),
        # No sentence, no names, no decision detail: the phone renders words from ids.
        "sentence": broken(lambda d: d.update(sentence="Editing zqx_secret.py")),
        "names": broken(lambda d: d.update(names={"files": {}})),
        "decision detail": broken(lambda d: d["decisions"][0].update(detail="redis")),
        "nested extra": broken(lambda d: d["verdict"]["evidence"].update(command="zqxcmd --flag")),
        "unknown enum": broken(lambda d: d["activity"].update(kind="vibing")),
        "prose refusal": broken(lambda d: d["eta"].update(reason="5 finished sessions, 10 needed")),
        "score above 100": broken(lambda d: d["needs_you"].update(score=101)),
        "naive clock": broken(lambda d: d.update(computed_at="2026-09-13T07:41:05")),
        "601 frames": broken(lambda d: d.update(timelapse=d["timelapse"] * 601)),
        "5 decisions": broken(lambda d: d.update(decisions=d["decisions"] * 5)),
    }
    for label, doc in rejected.items():
        with pytest.raises(ValidationError):
            valid_payload(state="live", end_reason="still_running", live=doc)
            pytest.fail(f"accepted: {label}")


def test_live_names_carry_a_bounded_basename_and_nothing_else():
    p = valid_payload(
        state="live", end_reason="still_running", live=SAMPLE_LIVE, live_names=SAMPLE_LIVE_NAMES
    )
    assert p.live_names.model_dump(mode="json") == SAMPLE_LIVE_NAMES
    with pytest.raises(ValidationError):
        valid_payload(live_names={"files": [{"id": "3f9a0c1d2e4b5a69", "name": "x" * 121}]})
    with pytest.raises(ValidationError):
        extra = {"id": "3f9a0c1d2e4b5a69", "name": "a.py", "dir": "src"}
        valid_payload(live_names={"files": [extra]})


def test_the_live_spec_carries_one_free_string_and_it_is_the_opt_in_basename():
    """Everything on the live wire is an enum, a number, a clock or a salted id. The one
    string is LiveName.name, inside the opt-in `live_names`, and it has a cap."""
    s = _live_spec()
    strings = [
        (owner, f["name"])
        for owner, fs in [*s["objects"].items(), ("LiveState", s["fields"])]
        for f in fs
        if f["type"] == "string" or (f["type"] == "list" and f.get("item") == "string")
    ]
    assert strings == [("LiveName", "name")]
    assert live_spec.LIVE_MAX_LENGTHS["name"] == 120


def test_published_leaf_paths_cover_every_live_scalar():
    leaf_paths = set(json.loads(PUBLISHED.read_text())["leaf_paths"])
    actual = set(_scalar_paths({"live": SAMPLE_LIVE, "live_names": SAMPLE_LIVE_NAMES}, ""))
    assert actual <= leaf_paths, {"sent_but_not_declared": sorted(actual - leaf_paths)}
    # And the walker invented nothing: every published live path is one the sample reaches.
    declared = {p for p in leaf_paths if p.split(".")[0] in ("live", "live_names")}
    assert declared == actual, {"declared_but_unreachable": sorted(declared - actual)}


def test_published_leaf_paths_cover_burn_and_title_ids():
    leaf_paths = set(json.loads(PUBLISHED.read_text())["leaf_paths"])
    actual = set(_scalar_paths({"burn": SAMPLE_BURN, "title_ids": SAMPLE_TITLE_IDS}, ""))
    actual |= set(_scalar_paths({"title_ids": SAMPLE_TITLE_REFUSAL}, ""))
    assert actual <= leaf_paths, {"sent_but_not_declared": sorted(actual - leaf_paths)}
    declared = {p for p in leaf_paths if p.split(".")[0] in ("burn", "title_ids")}
    assert declared == actual, {"declared_but_unreachable": sorted(declared - actual)}


def test_published_leaf_paths_cover_call_tokens():
    leaf_paths = set(json.loads(PUBLISHED.read_text())["leaf_paths"])
    actual = set(_scalar_paths({"call_tokens": SAMPLE_CALL_TOKENS}, ""))
    assert actual <= leaf_paths, {"sent_but_not_declared": sorted(actual - leaf_paths)}
    declared = {p for p in leaf_paths if p.split(".")[0] == "call_tokens"}
    assert declared == actual, {"declared_but_unreachable": sorted(declared - actual)}


def test_call_tokens_round_trip_and_close_every_level():
    for block in (SAMPLE_CALL_TOKENS, SAMPLE_CALL_TOKENS_REFUSED):
        p = valid_payload(call_tokens=block)
        assert p.call_tokens.model_dump(mode="json") == block
        assert sanity_gate(p) is None
    assert valid_payload().call_tokens is None

    point = SAMPLE_CALL_TOKENS["points"][0]
    back = SAMPLE_CALL_TOKENS["rewrites"][0]
    for bad in (
        {**SAMPLE_CALL_TOKENS, "reason": "the harness wrote no counts"},
        {**SAMPLE_CALL_TOKENS, "price_reason": "gpt-5-codex"},
        {**SAMPLE_CALL_TOKENS, "model": "claude-opus-5"},
        {**SAMPLE_CALL_TOKENS, "points": [{**point, "model": "claude-opus-5"}]},
        {**SAMPLE_CALL_TOKENS, "points": [{**point, "at": "4s"}]},
        {**SAMPLE_CALL_TOKENS, "points": [point] * 241},
        {**SAMPLE_CALL_TOKENS, "rewrites": [back] * 13},
        {**SAMPLE_CALL_TOKENS, "rewrites": [{**back, "prompt": "zqx sentinel prompt"}]},
    ):
        with pytest.raises(ValidationError):
            valid_payload(call_tokens=bad)


@pytest.mark.parametrize(
    "bad,says",
    [
        (
            {**SAMPLE_CALL_TOKENS_REFUSED, "points": SAMPLE_CALL_TOKENS["points"]},
            "one or the other",
        ),
        ({**SAMPLE_CALL_TOKENS_REFUSED, "reason": "no_token_counts"}, "null exactly when"),
        ({**SAMPLE_CALL_TOKENS, "calls": 9}, "7 points for 9 calls"),
        ({**SAMPLE_CALL_TOKENS, "per_point": 2}, "7 points for 7 calls at 2"),
        (
            {**SAMPLE_CALL_TOKENS, "rewrites": [{"call": 8, "away_seconds": 4095, "written": 1}]},
            "outside",
        ),
        ({**SAMPLE_CALL_TOKENS, "rewrite_calls": 0}, "counts more rewrites"),
        ({**SAMPLE_CALL_TOKENS, "rewrite_calls": 8}, "counts more rewrites"),
        ({**SAMPLE_CALL_TOKENS, "usd_output": None}, "four finite dollar figures"),
        (
            {**SAMPLE_CALL_TOKENS, "price_reason": "model_not_in_price_table"},
            "four finite dollar figures",
        ),
        (
            {**SAMPLE_CALL_TOKENS, "points": list(reversed(SAMPLE_CALL_TOKENS["points"]))},
            "out of time order",
        ),
        # FOUND IN REVIEW (2026-09-13): each of these was accepted.
        ({**SAMPLE_CALL_TOKENS_REFUSED, "calls": 500}, "too_few_calls with 500 calls"),
        ({**SAMPLE_CALL_TOKENS_REFUSED, "calls": -1}, "too_few_calls with -1 calls"),
        ({**SAMPLE_CALL_TOKENS_REFUSED, "calls": None}, "too_few_calls with None calls"),
        ({**SAMPLE_CALL_TOKENS, "calls_needed": 0}, "at least 1"),
        ({**SAMPLE_CALL_TOKENS_REFUSED, "calls_needed": 0}, "at least 1"),
        (
            {**SAMPLE_CALL_TOKENS, "rewrites": [{"call": 1, "away_seconds": -5, "written": 1}]},
            "sooner than the cache expires",
        ),
        (
            {**SAMPLE_CALL_TOKENS, "rewrites": [{"call": 1, "away_seconds": 3600, "written": 1}]},
            "sooner than the cache expires",
        ),
        (
            {**SAMPLE_CALL_TOKENS, "rewrites": [{"call": 1, "away_seconds": 4095, "written": -1}]},
            "wrote more than its own point",
        ),
        (
            {
                **SAMPLE_CALL_TOKENS,
                "rewrites": [{"call": 2, "away_seconds": 4095, "written": 9999}],
            },
            "wrote more than its own point",
        ),
        ({**SAMPLE_CALL_TOKENS, "lifetime_seconds": None}, "no cache lifetime"),
        ({**SAMPLE_CALL_TOKENS, "lifetime_seconds": 1800}, "not a cache lifetime"),
        (
            {
                **SAMPLE_CALL_TOKENS,
                "rewrites": [SAMPLE_CALL_TOKENS["rewrites"][0]] * 2,
                "rewrite_calls": 2,
            },
            "twice or out of call order",
        ),
        ({**SAMPLE_CALL_TOKENS, "usd_cache_read": float("inf")}, "four finite dollar figures"),
        ({**SAMPLE_CALL_TOKENS, "usd_cache_read": float("nan")}, "four finite dollar figures"),
        ({**SAMPLE_CALL_TOKENS, "usd_input": -0.01}, "four finite dollar figures"),
    ],
)
def test_the_gate_refuses_a_call_tokens_block_that_disagrees_with_itself(bad, says):
    """The phone labels every bar "calls a to b" from `per_point` and `calls`: a count that
    disagrees with the points mislabels the whole chart, and the server never sees a
    transcript, so consistency is the one check it has."""
    assert says in (sanity_gate(valid_payload(call_tokens=bad)) or ""), says


def test_the_gate_holds_the_points_to_the_tokens_burn_counts_for_the_same_window():
    """Both blocks are `burn.turns_for_window` over one sitting, so their totals are one number:
    the review recomputed all 160 stored sittings from the raw JSONL and they agree to the token.
    A client whose chart and burn disagree is counting two different sets of calls."""

    def gate(burn):
        return sanity_gate(valid_payload(call_tokens=SAMPLE_CALL_TOKENS, burn=burn)) or ""

    assert gate(SAMPLE_BURN_FOR_CALLS) == ""
    off = {**SAMPLE_BURN_FOR_CALLS, "tokens": SAMPLE_BURN_FOR_CALLS["tokens"] + 1}
    assert "where burn counts" in gate(off)
    # A burn that refused (no token counted) has no total to hold the chart to.
    refused_burn = {**SAMPLE_BURN, "tokens": None, "reason": "not_segmented", "spikes": None}
    assert gate(refused_burn) == ""


def test_the_gates_constants_are_the_contracts_and_the_engines():
    _analysis()
    from analysis import calls

    from builder.routes import sync

    caps = {f["name"]: f.get("max_items") for f in _contract()["objects"]["SessionCallTokens"]}
    assert sync.CALL_POINTS_MAX == caps["points"] == calls.MAX_POINTS
    assert sync.CALL_LIFETIMES == (calls.FIVE_MINUTES_SEC, calls.ONE_HOUR_SEC)


def test_call_tokens_enums_and_caps_are_the_calls_tables_both_ways():
    """`call_tokens_refusal` is `analysis/calls.py` REFUSALS, and every refusal the module
    can return is one of them (read off `_refused(` in its source); `call_price_refusal` is
    pricing's own code; the list caps are the module's constants."""
    _analysis()
    from analysis import calls, pricing

    enums = _contract()["enums"]
    assert enums["call_tokens_refusal"] == list(calls.REFUSALS)
    src = Path(calls.__file__).read_text()
    used = set(re.findall(r"_refused\((REFUSE_\w+)", src))
    assert {getattr(calls, name) for name in used} == set(calls.REFUSALS), used
    assert enums["call_price_refusal"] == list(calls.PRICE_REFUSALS)
    assert list(calls.PRICE_REFUSALS) == [pricing.BASIS_UNKNOWN_MODEL]
    caps = {f["name"]: f.get("max_items") for f in _contract()["objects"]["SessionCallTokens"]}
    assert (caps["points"], caps["rewrites"]) == (calls.MAX_POINTS, calls.MAX_REWRITES)
    assert enums == OBJECT_ENUM_VALUES


def test_quotes_leaf_paths_are_published():
    published = json.loads(PUBLISHED.read_text())
    doc = published["documents"]["quotes"]
    assert doc["route"] == "PUT /v1/profile/quotes"
    assert doc["default"] == "off"
    assert set(_scalar_paths(SAMPLE_QUOTES, "")) == set(doc["leaf_paths"])
    # The quotes are a document of their own: none of their paths is a session field.
    assert not {p.split(".")[0] for p in doc["leaf_paths"]} & set(published["fields"])


def test_the_quotes_document_validates_and_caps_every_quote():
    q = quotes_spec.QuotesUpload(**SAMPLE_QUOTES)
    assert q.model_dump(mode="json") == SAMPLE_QUOTES
    one = SAMPLE_QUOTES["quotes"][0]
    for bad in (
        {**SAMPLE_QUOTES, "quotes": [{**one, "text": "x" * 161}]},
        {**SAMPLE_QUOTES, "quotes": [one] * 4},
        {**SAMPLE_QUOTES, "quotes": [{**one, "card": "angriest_prompt"}]},
        {**SAMPLE_QUOTES, "quotes": [{**one, "session": "a" * 64}]},
        {**SAMPLE_QUOTES, "quotes": [{**one, "client_session_id": "not a hash"}]},
        {**SAMPLE_QUOTES, "generated_at": "2026-09-13T08:00:00"},
    ):
        with pytest.raises(ValidationError):
            quotes_spec.QuotesUpload(**bad)
    # The quotes never ride on a session.
    with pytest.raises(ValidationError):
        valid_payload(quotes=SAMPLE_QUOTES["quotes"])


def test_burn_and_title_ids_round_trip_and_close_every_level():
    p = valid_payload(burn=SAMPLE_BURN, title_ids=SAMPLE_TITLE_IDS)
    assert p.burn.model_dump(mode="json") == SAMPLE_BURN
    assert p.title_ids.model_dump(mode="json") == SAMPLE_TITLE_IDS
    assert valid_payload().burn is None and valid_payload().title_ids is None

    # The addendum's shape alone (no additive field) is a complete, valid block.
    minimal = {
        "tokens": None,
        "cache_read_share": None,
        "barren_share": None,
        "segments": 0,
        "reason": "not_segmented",
        "spikes": None,
    }
    assert valid_payload(burn=minimal).burn.reason == "not_segmented"
    bare = {"verb": "looked_around", "object": "codebase", "n": None}
    assert valid_payload(title_ids=bare).title_ids

    spike = SAMPLE_BURN["spikes"][0]
    cause = spike["causes"][0]
    for bad in (
        {**SAMPLE_BURN, "cache_read_share": 1.2},
        {**SAMPLE_BURN, "reason": "no token counts were recorded"},
        {**SAMPLE_BURN, "spikes": [spike] * 4},
        {**SAMPLE_BURN, "prompt": "zqx sentinel prompt"},
        {**SAMPLE_BURN, "spikes": [{**spike, "prompt": "zqx sentinel prompt"}]},
        {**SAMPLE_BURN, "spikes": [{**spike, "causes": [cause] * 4}]},
        {**SAMPLE_BURN, "spikes": [{**spike, "causes": [{**cause, "cause": "vibes"}]}]},
        {**SAMPLE_BURN, "spikes": [{**spike, "causes": [{**cause, "detail": "zqx_secret.py x4"}]}]},
        {**SAMPLE_BURN, "spikes": [{**spike, "causes": [{**cause, "repeat": "Bash"}]}]},
    ):
        with pytest.raises(ValidationError):
            valid_payload(burn=bad)
    for bad in (
        {**SAMPLE_TITLE_IDS, "verb": "vibed"},
        {**SAMPLE_TITLE_IDS, "object": "zqx_sentinel_dir"},
        {**SAMPLE_TITLE_IDS, "title": "Refactored three files across two modules"},
        {**SAMPLE_TITLE_IDS, "n": "three"},
    ):
        with pytest.raises(ValidationError):
            valid_payload(title_ids=bad)


def test_the_session_objects_carry_only_numbers_bools_and_enums():
    """No string field inside `burn` or `title_ids`: every word about them is written on
    the phone from ids, so a string here could only be prose on its way to the wire."""
    objects = _contract()["objects"]
    assert set(objects) == {
        "SessionBurn",
        "SessionBurnSpike",
        "SessionBurnCause",
        "SessionTitleIds",
        "SessionCallTokens",
        "SessionCallPoint",
        "SessionCallRewrite",
    }
    kinds = {f["type"] for fs in objects.values() for f in fs}
    assert kinds <= {"int", "number", "double", "bool", "enum", "list"}, kinds
    for fs in objects.values():
        for f in fs:
            if f["type"] == "list":
                assert f["item"] in objects
            if f["type"] == "double":
                assert "share" in f["doc"]


def test_burn_enums_are_the_burn_tables_both_ways():
    """`burn_cause` is the table of causes burn names (`_CAUSE_SENTENCES`, the phrase per
    cause) AND the set of causes `Segment` can detect, read off its source. `burn_repeat`
    is `_REPEAT_SENTENCES`, the phrase per kind of repeated call, and every tool family
    `_repeat_kind` sorts a call into. A cause burn grows without the contract growing it
    fails here, and so does a contract value burn cannot produce."""
    _analysis()
    from analysis import burn, digest

    enums = _contract()["enums"]
    assert enums["burn_cause"] == list(burn._CAUSE_SENTENCES)
    detected = set(re.findall(r'"cause": "(\w+)"', Path(burn.__file__).read_text()))
    assert detected == set(enums["burn_cause"]), detected ^ set(enums["burn_cause"])

    assert enums["burn_repeat"] == list(burn._REPEAT_SENTENCES)
    families = {
        burn._repeat_kind(next(iter(sorted(digest.SHELL_TOOLS)))),
        burn._repeat_kind(next(iter(sorted(digest.EDIT_TOOLS)))),
        burn._repeat_kind(next(iter(sorted(digest.READ_TOOLS)))),
        burn._repeat_kind("WebSearch"),
        burn._repeat_kind(None),
    }
    assert families == set(enums["burn_repeat"])
    assert enums == OBJECT_ENUM_VALUES


def test_title_enums_are_the_vocab_tables_both_ways():
    """`title_verb` and `title_object` are vocab's own tables, in the order its rules are
    tried. Both ways, read off `session_title` itself: every verb a rule answers with is in
    the table and every verb in the table is some rule's answer; every object is a file
    role (`plain.ROLES`, the rules that name the top role) or one of the literals a rule
    names, and nothing else. The fields `title_ids` is cut from are the ones `vocab.wire`
    keeps for a title."""
    import ast

    _analysis()
    from analysis import plain, vocab

    enums = _contract()["enums"]
    assert enums["title_verb"] == list(vocab.VERBS)
    assert enums["title_object"] == list(vocab.OBJECTS)

    tree = ast.parse(Path(vocab.__file__).read_text())
    fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "session_title")
    answers = [
        n
        for n in ast.walk(fn)
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "answer"
    ]
    verbs = {a.args[1].value for a in answers}
    literal_objects = {a.args[2].value for a in answers if isinstance(a.args[2], ast.Constant)}
    role_objects = [a.args[2].id for a in answers if isinstance(a.args[2], ast.Name)]
    assert len(answers) == len(vocab.VERBS), "one answer per title rule"
    assert verbs == set(enums["title_verb"]), verbs ^ set(enums["title_verb"])
    assert set(role_objects) == {"top"}, role_objects  # `_top_role`: a plain.ROLES value
    assert set(enums["title_object"]) == set(plain.ROLES) | literal_objects
    assert {"verb", "object", "count", "modules"} <= set(vocab._TITLE_WIRE)


def test_title_refusal_is_vocabs_refusal_codes_both_ways():
    """FOUND IN THE ADVERSARIAL REVIEW (2026-09-13): a refused title went on the wire as
    null, which also means "not computed", so a live cut's title could never be cleared by
    the same sitting's refused final cut. A refusal is `title_ids.reason` now, as a burn's
    is `burn.reason`. The codes are vocab's own table, and every `_refused` call in
    `session_title` passes one of them (read off the source), so a new refusal cannot ship
    without a code the contract declares."""
    import ast

    _analysis()
    from analysis import vocab

    enums = _contract()["enums"]
    assert enums["title_refusal"] == list(vocab.TITLE_REFUSALS)
    tree = ast.parse(Path(vocab.__file__).read_text())
    fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "session_title")
    codes = [
        next(k.value.value for k in n.keywords if k.arg == "code")
        for n in ast.walk(fn)
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "_refused"
    ]
    assert sorted(codes) == sorted(vocab.TITLE_REFUSALS), codes


def test_a_title_refusal_round_trips_and_carries_no_title():
    p = valid_payload(title_ids=SAMPLE_TITLE_REFUSAL)
    assert p.title_ids.model_dump(mode="json") == SAMPLE_TITLE_REFUSAL
    for bad in (
        {**SAMPLE_TITLE_REFUSAL, "reason": "the transcript hides the work"},
        {**SAMPLE_TITLE_REFUSAL, "reason": "vibes"},
    ):
        with pytest.raises(ValidationError):
            valid_payload(title_ids=bad)


def test_live_enums_are_the_engine_tables_both_ways():
    """Python is the reference: each live enum is a table in analysis/live.py or
    analysis/plain.py, in the same order, and `verdict_basis` is exactly the bases the
    verdict rules fire with (read off `live._verdict`'s source)."""
    _analysis()
    from analysis import live, plain

    e = _live_spec()["enums"]
    assert e["activity_kind"] == list(live.ACTIVITY_KINDS)
    assert e["plain_role"] == list(plain.ROLES)
    assert e["verdict_state"] == list(live.VERDICT_STATES)
    assert e["decision_kind"] == list(live.DECISION_KINDS)
    assert e["needs_you_reason"] == list(live.NEEDS_YOU_REASONS)
    assert e["frame_kind"] == list(live.FRAME_KINDS)
    assert e["eta_basis"] == [live.ETA_BASIS]
    evidence = next(fs for name, fs in _live_spec()["objects"].items() if name == "LiveEvidence")
    assert [f["name"] for f in evidence] == list(live.EVIDENCE_KEYS)

    src = Path(live.__file__).read_text()
    fired = set(re.findall(r'fire\("\w+", "([^"]+)"\)', src))
    if 'fire("waiting", BACKGROUND_BASIS)' in src:
        fired.add(live.BACKGROUND_BASIS)
    assert fired == set(e["verdict_basis"]), fired ^ set(e["verdict_basis"])
    assert len(e["verdict_basis"]) == len(set(e["verdict_basis"]))


def test_live_activity_enums_are_the_swift_bridge_types():
    """`phase`, `trajectory` and `creature` are the Live Activity's own words, which
    BuilderLive.types.ts mirrors from the Swift ContentState. The server's CHECK lists and
    the push content state read the spec, so the spec must say what the bridge says."""
    ts = LIVE_TYPES_TS.read_text()

    def union(name: str) -> list[str]:
        m = re.search(rf"export type {name} = ([^;]+);", ts)
        assert m, f"{name} not found in {LIVE_TYPES_TS.name}"
        return [v.strip().strip("'\"") for v in m.group(1).split("|")]

    e = _live_spec()["enums"]
    assert e["phase"] == union("Phase")
    assert e["trajectory"] == union("Trajectory")
    assert e["creature"] == union("CreatureId")


#: Postgres CHECK lists that copy a live spec enum (0020 session_live, 0022
#: live_activity_tokens): a contract enum value is always also a migration.
_CHECKED_COLUMNS = {
    "alerted_phase": "phase",
    "last_phase": "phase",
    "last_trajectory": "trajectory",
    "creature": "creature",
}
_CHECK_IN = re.compile(r"CHECK\s*\(\s*(\w+)\s+IN\s*\(([^)]*)\)\s*\)", re.I)


def _check_lists(sql: str) -> dict[str, list[str]]:
    return {m.group(1): re.findall(r"'([^']*)'", m.group(2)) for m in _CHECK_IN.finditer(sql)}


def test_check_list_reader_reads_the_design_doc_shape():
    """The reader below must see a CHECK list written the way the migrations write it, or
    the pin test passes because it read nothing (CLAUDE.md, the negative test lesson)."""
    sql = (
        "alerted_phase text CHECK (alerted_phase IN ('working','needsYou','done','stalled')),\n"
        "creature text NOT NULL CHECK (creature IN ('crab', 'owl', 'bit')),"
    )
    assert _check_lists(sql) == {
        "alerted_phase": ["working", "needsYou", "done", "stalled"],
        "creature": ["crab", "owl", "bit"],
    }


def test_every_live_check_value_is_a_spec_enum():
    e = _live_spec()["enums"]
    found: dict[str, list[str]] = {}
    expected: set[str] = set()
    for path in sorted(MIGRATIONS.glob("*.py")):
        if path.name.startswith("0020_"):
            expected.add("alerted_phase")
        if path.name.startswith("0022_"):
            expected |= {"creature", "last_phase", "last_trajectory"}
        for col, values in _check_lists(path.read_text()).items():
            if col in _CHECKED_COLUMNS:
                found[col] = values
    missing = expected - set(found)
    assert not missing, f"migrations 0020/0022 exist but declare no CHECK list for {missing}"
    if not found:
        pytest.skip("no migration declares a live CHECK list yet (0020 and 0022 are not written)")
    for col, values in found.items():
        assert values == e[_CHECKED_COLUMNS[col]], (col, values)


def test_an_enum_declared_in_two_specs_is_the_same_list():
    """`plain_role` (the live spec and the report), `burn_cause` and `burn_refusal` (the
    contract's objects and the report) are each one Python table declared in two specs.
    One list of codes for one table: a value added in one spec and not the other fails
    here. Every name the contract, the quotes document or the live spec shares with any
    other spec is held to this, and the three above must be among them.

    Not held to it: `archetype`, which spec/analysis.v1.json (the model's per session
    reading) and spec/report.v1.json (profile.ARCHETYPE_RULES) both declare with DIFFERENT
    values, because they are two different lists under one name."""
    mine = {
        "contract": _contract()["enums"],
        "quotes": _contract()["quotes"]["enums"],
        "live": _live_spec()["enums"],
    }
    others = {
        "report": json.loads(REPORT_JSON.read_text())["enums"],
        "analysis": json.loads(ANALYSIS_JSON.read_text())["enums"],
    }
    everything = {**mine, **others}
    compared = set()
    for spec, enums in mine.items():
        for name, values in enums.items():
            for other, other_enums in everything.items():
                if other != spec and name in other_enums:
                    compared.add(name)
                    theirs = other_enums[name]
                    assert values == theirs, f"{name}: {spec} {values} != {other} {theirs}"
    assert {"plain_role", "burn_cause", "burn_refusal"} <= compared, compared


def test_privacy_md_says_what_the_raw_transcript_channel_sends():
    """FOUND IN THE ADVERSARIAL REVIEW (2026-09-13): the public page said "There is no code
    path that sends them" about prompts, file contents and commands, while the Claude Code
    hook and `capture live` send the whole transcript to the account's server. The page is
    the only definition a reader has; it says so now, with the route's own retention."""
    from builder.routes.ingest import RETENTION_DAYS

    text = (REPO / "PRIVACY.md").read_text()
    flat = " ".join(text.split())  # the generator wraps lines; the claims are what matter
    assert "There is no code path that sends them" not in flat
    assert "## The raw transcript channel" in text
    for phrase in (
        "**raw transcript**",
        "python -m capture live",
        "keeps only the fields in the table below",
        f"{RETENTION_DAYS} days",
        "BUILDER_CAPTURE_EXCLUDE",
        "The hook script has no such list",
        "the lines already sent before it moved stay sent",
    ):
        assert phrase in flat, phrase
    readme = (REPO / "README.md").read_text()
    assert "Prompts, code, diffs, file paths and file names never leave your machine." not in readme
    assert "raw transcript" in readme


def test_no_person_read_doc_carries_a_dash():
    """No dashes in any string a person reads (CLAUDE.md). Every field doc lands in
    PRIVACY.md or a generated type's comment, and PRIVACY.md is the public page."""
    _analysis()
    from analysis import plain

    c = _contract()
    docs = [f.get("doc", "") for f in c["fields"]]
    docs += [f.get("doc", "") for fs in c["objects"].values() for f in fs]
    docs += [f.get("doc", "") for fs in c["quotes"]["objects"].values() for f in fs]
    docs += c["quotes"]["doc"]
    m = c["project_media"]
    docs += [f.get("doc", "") for fs in [*m["objects"].values(), m["fields"]] for f in fs]
    docs += [*m["doc"], *m["measured"], m["label_rule"]]
    s = _live_spec()
    docs += [f.get("doc", "") for fs in [*s["objects"].values(), s["fields"]] for f in fs]
    dashed = [d for d in docs if plain.has_dash(d)]
    assert not dashed, dashed

    inside = False
    for line in (REPO / "PRIVACY.md").read_text().splitlines():
        if line.startswith("```"):
            inside = not inside
            continue
        if inside or line.startswith("<!--"):
            continue
        assert not plain.has_dash(line), line


def test_the_grant_flow_check_is_the_auth_table_both_ways():
    """0024's CHECK list is `auth.GRANT_FLOWS`, read off the migration rather than trusted
    to a comment (a value Python writes that Postgres refuses is a 500 on sign in)."""
    from builder import auth

    src = (MIGRATIONS / "0024_device_grant_flow.py").read_text()
    m = re.search(r"^GRANT_FLOWS = \(([^)]*)\)$", src, re.M)
    assert m, "0024 names its CHECK list"
    assert tuple(re.findall(r'"([a-z_]+)"', m.group(1))) == auth.GRANT_FLOWS


# ------------------------------------------------------------ project_media (0026)

#: A complete presign, every field set: what one file of a published demo carries.
SAMPLE_MEDIA_PRESIGN = {
    "publish_id": "0123456789abcdef",
    "kind": "video",
    "content_type": "video/mp4",
    "bytes": 12_000_000,
    "width": 1206,
    "height": 2622,
    "duration_ms": 18000,
    "position": 0,
    "label": "the session page, scrolled to the chart",
    "source": "capture",
    "poster": {"content_type": "image/jpeg", "bytes": 120_000},
}

#: The migration's CHECK columns and the contract enum each one copies.
_MEDIA_CHECKED = {
    "kind": "media_kind",
    "content_type": "media_content_type",
    "source": "media_source",
    "poster_content_type": "poster_content_type",
}


def test_every_project_media_enum_is_the_migrations_check_list_both_ways():
    """A contract enum value is always also a migration (CLAUDE.md): a `source` the Mac
    starts sending, added to the contract alone, would pass the generated door and die on
    the INSERT as a 500. Read off 0026 itself, list for list, order included."""
    enums = _contract()["project_media"]["enums"]
    found = _check_lists((MIGRATIONS / "0026_project_media.py").read_text())
    assert set(_MEDIA_CHECKED) <= set(found), (
        f"0026 declares no CHECK list for {set(_MEDIA_CHECKED) - set(found)}"
    )
    for column, enum in _MEDIA_CHECKED.items():
        assert found[column] == enums[enum], (column, found[column], enums[enum])
    assert set(enums) == set(_MEDIA_CHECKED.values()), "a contract enum with no column"


def test_the_project_media_caps_are_the_migrations_and_the_contracts():
    """The numbers the door enforces are the numbers the table enforces: the largest side,
    the longest video, each type's size cap, the label's length and characters."""
    from builder import media_spec

    m = _contract()["project_media"]
    src = (MIGRATIONS / "0026_project_media.py").read_text()
    num = lambda pattern: int(re.search(pattern, src).group(1))  # noqa: E731
    assert (
        num(r"width\s+integer NOT NULL CHECK \(width BETWEEN 1 AND (\d+)\)") == m["caps"]["pixels"]
    )
    assert num(r"height BETWEEN 1 AND (\d+)") == m["caps"]["pixels"]
    assert num(r"duration_ms BETWEEN 1 AND (\d+)") == m["caps"]["video_ms"]
    assert num(r"bytes\s+bigint NOT NULL CHECK \(bytes BETWEEN 1 AND (\d+)\)") == max(
        t["max_bytes"] for t in m["content_types"].values()
    )
    images = {t["max_bytes"] for t in m["content_types"].values() if t["kind"] == "image"}
    assert {num(r"AND bytes <= (\d+)")} == images
    assert {num(r"poster_bytes BETWEEN 1 AND (\d+)")} == images
    # Written inside an f-string in 0026, so its braces are doubled there.
    label = re.search(r"label ~ '\^(\[[^\]]*\])\{\{1,(\d+)\}\}\$'", src)
    assert label, "0026 bounds the label with a character class and a length"
    assert int(label.group(2)) == m["max_lengths"]["label"]
    assert label.group(1).replace("''", "'") == m["label_pattern"][1:-2], "the same characters"
    # The generated door carries the same numbers (make gen writes them; this reads them).
    assert m["caps"] == media_spec.MEDIA_CAPS
    assert m["content_types"] == media_spec.MEDIA_CONTENT_TYPES
    assert m["label_pattern"] == media_spec.MEDIA_LABEL_PATTERN


def test_project_media_leaf_paths_are_published():
    published = json.loads(PUBLISHED.read_text())
    doc = published["documents"]["project_media"]
    m = _contract()["project_media"]
    assert doc["route"] == "POST /v1/projects/{key}/media:presign" == m["route"]
    assert doc["default"] == "off"
    assert set(_scalar_paths(SAMPLE_MEDIA_PRESIGN, "")) == set(doc["leaf_paths"])
    assert doc["content_types"] == m["content_types"] and doc["caps"] == m["caps"]
    # A presign is a document of its own: none of its paths is a session field, and no
    # session field rides on it.
    assert not {p.split(".")[0] for p in doc["leaf_paths"]} & set(published["fields"])


def test_a_presign_carries_numbers_one_enum_and_a_label_and_nothing_else():
    from builder import media_spec

    doc = media_spec.ProjectMediaPresign(**SAMPLE_MEDIA_PRESIGN)
    assert doc.model_dump(mode="json") == SAMPLE_MEDIA_PRESIGN
    strings = [
        f["name"]
        for fs in [
            *_contract()["project_media"]["objects"].values(),
            _contract()["project_media"]["fields"],
        ]
        for f in fs
        if f["type"] == "string"
    ]
    assert strings == ["label"], "the label is the one free string, and it is capped"
    for bad in (
        {**SAMPLE_MEDIA_PRESIGN, "commit": "a" * 40},
        {**SAMPLE_MEDIA_PRESIGN, "file": "demo.mp4"},
        {
            **SAMPLE_MEDIA_PRESIGN,
            "poster": {"content_type": "image/jpeg", "bytes": 1, "file": "p.jpg"},
        },
        {**SAMPLE_MEDIA_PRESIGN, "source": "generated"},
        {**SAMPLE_MEDIA_PRESIGN, "label": "x" * 81},
        {**SAMPLE_MEDIA_PRESIGN, "publish_id": "0123456789ABCDEF"},
    ):
        with pytest.raises(ValidationError):
            media_spec.ProjectMediaPresign(**bad)


def test_privacy_md_says_what_a_published_demo_sends():
    from builder import project_media

    flat = " ".join((REPO / "PRIVACY.md").read_text().split())
    assert "## Project demos" in (REPO / "PRIVACY.md").read_text()
    for phrase in (
        "nothing sends it until you publish it, one project at a time",
        "`python -m capture demo --publish` prints how many files and how many bytes",
        "at most 8 images",
        "at most one video",
        "each at most 6 MiB",
        "at most 31 seconds and 40 MiB",
        f"stops working after {project_media.READ_URL_SECONDS // 60} minutes",
        "Never the file names, the commit it was taken at, or the project's name",
        "Only you can see a demo, whatever you share",
    ):
        assert phrase in flat, phrase
