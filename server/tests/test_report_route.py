"""The measured builder report over the wire, AS builder_app.

The server computes none of this and cannot: the document rests on subagent sidecar
transcripts, shell command text, prompt text and commit times, none of which the contract
puts on the wire. So it is responsible for exactly three things, and each has a case here:
that a document the spec does not describe cannot be stored, that a null stays null, and
that one person's numbers are invisible to everybody else.

The isolation test is a real negative test rather than one that passes for the wrong
reason (0004, and the write-isolation lesson in CLAUDE.md): the victim's row is seeded as
the OWNER, and read back, so it is provably there before the attacker fails to see it.

Version 2 (docs/overnight-integration.md section 1) appends five blocks in which no field
is a string: the door is the last place a rendered sentence, a quote or an id nobody
declared can be stopped, so each of those has a refusal case here, and a version 1
document an older capture sends must still be stored.
"""

import copy
import datetime as dt

import pytest
from test_sync import (  # noqa: F401 - fixtures are picked up by name
    TEST_DB,
    _pair,
    app_env,
    client,
    created_users,
    paired,
)

pytestmark = pytest.mark.skipif(not TEST_DB, reason="set BUILDER_TEST_DB to run")

_SHARED_FIXTURES = (app_env, client, created_users, paired)

#: The real version 1 shape, taken from `python -m analysis report` over this container's
#: own corpus, so the fixture cannot describe a document the builder does not produce. An
#: older capture still sends exactly this, with no version 2 block in it.
REPORT_V1 = {
    "report_version": 1,
    "generated_at": "2026-09-06T16:49:55Z",
    "window_days": 7,
    "trend_headline": (
        "How often you test is up 100% on the 7 days before, which is the way you want it."
    ),
    "coverage": {
        "window_days": 30,
        "spans_days": 2,
        "active_days": 2,
        "sessions": 21,
        "first_at": "2026-09-05T04:55:33Z",
        "last_at": "2026-09-06T22:26:13Z",
    },
    "trends": [
        {
            "metric": "test_runs_per_hour",
            "label": "how often you test",
            "before": 2.0,
            "now": 4.0,
            "move": 1.0,
            "direction": "up",
            "good": True,
            "sessions_before": 5,
            "sessions_now": 6,
        }
    ],
    "agents": {
        "agents": 53,
        "produced": 51,
        "max_concurrent": 8,
        "agent_seconds": 42752.0,
        "wall_seconds": 69562.2,
        "busy_seconds": 14581.2,
        "parallelism": 2.93,
        "by_type": [
            {"name": "general-purpose", "agents": 52},
            {"name": "Explore", "agents": 1},
        ],
    },
    "contributions": {
        "assisted": 96,
        "alone": 8,
        "active_days": 2,
        "longest_streak": 2,
        "current_streak": 2,
        "days": [
            {"day": "2026-09-05", "assisted": 92, "alone": 0},
            {"day": "2026-09-06", "assisted": 4, "alone": 8},
        ],
    },
    "quality": {
        "runs": 41,
        "passed": 36,
        "failed": 5,
        "first_try_rate": 0.878,
        "time_to_green": {
            "n": 3,
            "median_seconds": 117,
            "worst_seconds": 466,
            "median_attempts": 2,
        },
        "reason": None,
    },
    "languages": {
        "lines": 10280,
        "generated_lines_excluded": 0,
        "languages": [
            {"name": "Python", "lines": 7942, "files": 45, "share": 0.773},
            {"name": "TypeScript", "lines": 922, "files": 11, "share": 0.09},
        ],
        "reason": None,
    },
    "prompting": {
        "attempts": 35,
        "clean": 8,
        "costly": 27,
        "clean_share": 0.229,
        "reason": None,
    },
}

#: The five version 2 blocks, in the wire shape of docs/overnight-integration.md 1.4,
#: widened so every object and every kind of nullable field is sent at least once. The burn
#: numbers are the profile's MEASURED 2.9% on the real corpus; every other number shows
#: SHAPE ONLY and is not a measurement of anybody. The machine sends only the extras keys a
#: card sets; the stored dump carries every key, null where unset.
V2_BLOCKS = {
    "wrapped": {
        "prompts_with_text": 926,
        "attended_sessions": 132,
        "cards": [
            {
                "id": "builder_type",
                "value": None,
                "value_id": "quality_guardian",
                "unit": "archetype",
                "basis": "archetype_rules",
                "n": 155,
                "needed": None,
                "reason": None,
                "extras": {
                    "confidence": 0.44,
                    "metric": "test_runs_per_hour",
                    "metric_value": 4.72,
                    "metric_lower_bound": True,
                    "runners_up": [
                        {
                            "name": "velocity_machine",
                            "metric": "code_velocity",
                            "value": 764.1,
                            "threshold": 487.0,
                            "score": 0.785,
                        }
                    ],
                },
            },
            {
                "id": "shipped",
                "value": 50177,
                "value_id": None,
                "unit": "lines",
                "basis": "project_edit_tools_and_credited_shell_writes",
                "n": 158,
                "needed": None,
                "reason": None,
                "extras": {
                    "commits": 247,
                    "assisted": 232,
                    "alone": 15,
                    "commits_basis": "git_log_distinct_commits",
                },
            },
            {
                "id": "longest_session",
                "value": 11160,
                "value_id": None,
                "unit": "seconds",
                "basis": "attended_seconds_rank",
                "n": 132,
                "needed": None,
                "reason": None,
                "extras": {"active_seconds": 12040, "started_at": "2026-08-21T14:02:11Z"},
            },
            {
                "id": "prompt_length",
                "value": None,
                "value_id": None,
                "unit": "words",
                "basis": "words_per_prompt",
                "n": 3,
                "needed": 5,
                "reason": "below_prompt_floor",
                "extras": {"median": None},
            },
            {
                # LOCAL whole on the machine: only id, unit, basis, n and reason travel.
                "id": "crash_out",
                "value": None,
                "value_id": None,
                "unit": "score",
                "basis": "profanity_caps_punctuation_markers",
                "n": 923,
                "needed": None,
                "reason": None,
                "extras": {},
            },
            {
                "id": "time_put_in",
                "value": 84.9,
                "value_id": None,
                "unit": "hours",
                "basis": "active_seconds",
                "n": 158,
                "needed": None,
                "reason": None,
                "extras": {"attended_hours": 74.5, "attended_overlap_hours": 1.2},
            },
            {
                "id": "kind_of_work",
                "value": None,
                "value_id": "source",
                "unit": "kind",
                "basis": "lines_by_file_role",
                "n": 50177,
                "needed": None,
                "reason": None,
                "extras": {
                    "kinds": [{"kind": "fix", "commits": 14}, {"kind": "feature", "commits": 11}],
                    "classified": 25,
                    "commits": 247,
                    "coverage": 0.101,
                    "role_lines": [
                        {"role": "source", "lines": 34873},
                        {"role": "test", "lines": 11089},
                    ],
                    "commit_refusal": "low_label_coverage",
                    "lines": 50177,
                    "lines_needed": 200,
                },
            },
        ],
    },
    "money": {
        "usd": 1873.42,
        "basis": "anthropic_api_list_price",
        "reason": None,
        "prices_read_on": "2026-09-06T00:00:00Z",
        "priced_sessions": 152,
        "unpriced_sessions": 0,
        "usd_per_active_hour": 22.1,
        "usd_without_a_commit": 19.8,
        "share_without_a_commit": 0.011,
        "tokens": {
            "input": 812201,
            "output": 9912330,
            "cache_read": 3900112034,
            "cache_w5m": 201334551,
            "cache_w1h": 0,
        },
        "token_sessions": 152,
        "lines_added": 50177,
        "lines_removed": 9021,
        "lines_basis": "project_edit_tools_and_credited_shell_writes",
        "by_model": [
            {
                "model": "claude-opus-4-8",
                "usd": 1502.2,
                "output_tokens": 9120433,
                "sessions": 97,
                "sessions_dominated": 88,
                "commits": 201,
                "usd_per_commit": 6.83,
            },
            {
                "model": "claude-sonnet-4-6",
                "usd": 371.22,
                "output_tokens": 791897,
                "sessions": 60,
                "sessions_dominated": 55,
                "commits": 0,
                "usd_per_commit": None,
            },
        ],
    },
    "burn": {
        "share": 0.029,
        "barren_tokens": 120070737,
        "tokens": 4168469723,
        "unreadable_tokens": 1192481138,
        "sessions": 156,
        "needed": None,
        "reason": None,
        "causes": [
            {"cause": "context_replay", "tokens": 101000000, "share": 0.841, "segments": 58},
            {"cause": "error_loop", "tokens": 9100000, "share": 0.076, "segments": 12},
        ],
    },
    "vocab": {
        "terms": [
            {"id": "commit", "count": 412, "sessions": 88, "first_seen": "2026-06-02T14:11:07Z"},
            {
                "id": "test_suite",
                "count": 398,
                "sessions": 71,
                "first_seen": "2026-06-02T14:20:31Z",
            },
            {"id": "migration", "count": 17, "sessions": 6, "first_seen": "2026-06-11T09:02:44Z"},
        ],
        "locked": 71,
        "catalog_size": 74,
        "sessions": 155,
        "shell_calls": 9085,
        "shell_calls_cut": 312,
        "reason": None,
    },
    "stack": {
        "items": [
            {
                "id": "postgres",
                "category": "database",
                "evidence": "command",
                "sessions": 14,
                "first_seen": "2026-06-11T09:02:44Z",
            },
            # Only a manifest names it: no session touched it, so no clock and 0 sessions.
            {
                "id": "react_native",
                "category": "framework",
                "evidence": "manifest",
                "sessions": 0,
                "first_seen": None,
            },
        ],
        "sessions": 155,
        "manifests": 38,
        "shell_calls": 9085,
        "shell_calls_cut": 312,
        "reason": None,
    },
}

#: What the machine sends now: version 2, every block.
REPORT = {**REPORT_V1, "report_version": 2, **V2_BLOCKS}


def _instant(s: str) -> dt.datetime:
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))


def assert_stored(sent, got, path="report"):
    """Every value sent comes back as sent, and every key the sender left out comes back
    null: the stored dump fills the unset nullable keys (a card's extras), and a null
    must never come back as a zero or an empty list."""
    if isinstance(sent, dict):
        assert isinstance(got, dict), f"{path} came back {got!r}"
        for k, v in sent.items():
            assert k in got, f"{path}.{k} was dropped"
            assert_stored(v, got[k], f"{path}.{k}")
        for k in set(got) - set(sent):
            assert got[k] is None, f"{path}.{k} was never sent and came back {got[k]!r}"
    elif isinstance(sent, list):
        assert isinstance(got, list) and len(got) == len(sent), f"{path} came back {got!r}"
        for i, (a, b) in enumerate(zip(sent, got, strict=True)):
            assert_stored(a, b, f"{path}[{i}]")
    elif isinstance(sent, str) and isinstance(got, str) and sent != got:
        # A clock can come back as another spelling of the same instant, and only a clock.
        assert _instant(sent) == _instant(got), f"{path}: {sent!r} came back {got!r}"
    else:
        assert sent == got and (sent is None) == (got is None), (
            f"{path}: {sent!r} came back {got!r}"
        )


def doc(**overrides) -> dict:
    d = copy.deepcopy(REPORT)
    d.update(overrides)
    return d


def test_a_report_round_trips_through_the_profile(client, paired):
    _, headers = paired
    r = client.put("/v1/profile/report", json=doc(), headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["report_version"] == 2

    got = client.get("/v1/profile/builder", headers=headers).json()["report"]
    assert got["agents"]["parallelism"] == 2.93
    assert got["quality"]["time_to_green"]["median_seconds"] == 117
    assert got["contributions"]["days"][0]["day"] == "2026-09-05"
    assert got["trends"][0]["metric"] == "test_runs_per_hour"
    assert got["languages"]["languages"][0]["name"] == "Python"
    # The window asked for, beside what was actually on the machine. A report that lost
    # this in transit is a report that answers a 30 day question with 2 days and says so
    # nowhere.
    assert got["coverage"]["window_days"] == 30
    assert got["coverage"]["spans_days"] == 2


def test_a_refused_block_stays_null_rather_than_becoming_a_zero(client, paired):
    """The whole point of the refusals. A person whose corpus cannot support a number
    must not be shown one, and the round trip is where a null quietly becomes a 0."""
    _, headers = paired
    thin = doc(
        agents=None,
        contributions=None,
        trends=[],
        trend_headline=None,
        quality={
            "runs": 2,
            "passed": None,
            "failed": None,
            "first_try_rate": None,
            "time_to_green": None,
            "reason": "2 test run(s), 5 needed",
        },
        prompting=None,
        languages={
            "lines": 40,
            "generated_lines_excluded": 3000,
            "languages": None,
            "reason": "40 attributable line(s), 200 needed",
        },
    )
    assert client.put("/v1/profile/report", json=thin, headers=headers).status_code == 200

    got = client.get("/v1/profile/builder", headers=headers).json()["report"]
    assert got["agents"] is None
    assert got["contributions"] is None
    assert got["prompting"] is None
    assert got["quality"]["first_try_rate"] is None
    assert got["quality"]["reason"] == "2 test run(s), 5 needed"
    # A refused split still reports what it EXCLUDED. A person whose line count dropped by
    # three thousand deserves to know where it went.
    assert got["languages"]["languages"] is None
    assert got["languages"]["generated_lines_excluded"] == 3000


def test_a_refused_v2_block_keeps_its_code_and_its_nulls(client, paired):
    """A version 2 refusal is an enum code with its numbers null. Burn's `causes` is null
    exactly when its share is, and `[]` would say a measured nothing; spend refused for
    want of token counts is not a spend of $0."""
    _, headers = paired
    refused = doc(
        wrapped=dict(
            V2_BLOCKS["wrapped"],
            cards=[
                {
                    "id": "streak",
                    "value": None,
                    "value_id": None,
                    "unit": "days",
                    "basis": "days_with_a_commit_and_an_attended_session",
                    "n": 0,
                    "needed": None,
                    "reason": "no_commit_history",
                    "extras": {"commit_days": None, "attended_days": None, "both_days": None},
                }
            ],
        ),
        money=dict(
            V2_BLOCKS["money"],
            usd=None,
            basis=None,
            reason="tokens_not_reported",
            priced_sessions=0,
            usd_per_active_hour=None,
            usd_without_a_commit=None,
            share_without_a_commit=None,
            tokens=None,
            token_sessions=0,
            by_model=[],
        ),
        burn={
            "share": None,
            "barren_tokens": None,
            "tokens": None,
            "unreadable_tokens": None,
            "sessions": 2,
            "needed": 3,
            "reason": "below_session_floor",
            "causes": None,
        },
        vocab=dict(V2_BLOCKS["vocab"], terms=[], locked=None, sessions=0, reason="no_events"),
    )
    r = client.put("/v1/profile/report", json=refused, headers=headers)
    assert r.status_code == 200, r.text

    got = client.get("/v1/profile/builder", headers=headers).json()["report"]
    assert_stored(refused, got)
    assert got["burn"]["causes"] is None
    assert got["burn"]["reason"] == "below_session_floor"
    assert got["money"]["usd"] is None and got["money"]["reason"] == "tokens_not_reported"
    assert got["vocab"]["locked"] is None
    assert got["wrapped"]["cards"][0]["value"] is None


def test_a_v2_report_with_every_block_round_trips(client, paired):
    _, headers = paired
    r = client.put("/v1/profile/report", json=doc(), headers=headers)
    assert r.status_code == 200, r.text

    got = client.get("/v1/profile/builder", headers=headers).json()["report"]
    assert_stored(REPORT, got)
    # A card sends only its own extras and the stored dump carries every key, null where
    # unset, so a reader never meets a key that is sometimes missing.
    extras = got["wrapped"]["cards"][0]["extras"]
    assert extras["runners_up"][0]["name"] == "velocity_machine"
    assert extras["commits"] is None and extras["attended_overlap_hours"] is None
    crash_out = got["wrapped"]["cards"][4]
    assert crash_out["id"] == "crash_out"
    assert crash_out["value"] is None
    assert all(v is None for v in crash_out["extras"].values())
    assert got["stack"]["items"][1]["first_seen"] is None
    assert got["money"]["by_model"][1]["usd_per_commit"] is None


def _built_by_the_machine() -> dict:
    """A report built by `analysis.report.from_corpus`, the one builder `capture report`
    uploads through, over the fixture corpus the engine's own tests use: every block
    filled from the code, not typed here, so a field the builder grows and the spec does
    not is a failure in this file before it is a 422 on anybody's machine."""
    import sys
    from pathlib import Path

    repo = Path(__file__).resolve().parents[2]
    if str(repo) not in sys.path:
        sys.path.insert(0, str(repo))
    from analysis import report as rp
    from analysis.tests import corpus_fixture as cf

    built, _ = rp.from_corpus(cf.rich_corpus(), 30)
    return built


def test_a_report_built_by_the_machine_round_trips(client, paired):
    _, headers = paired
    built = _built_by_the_machine()
    for block in V2_BLOCKS:
        assert built[block] is not None, block
    r = client.put("/v1/profile/report", json=built, headers=headers)
    assert r.status_code == 200, r.text

    got = client.get("/v1/profile/builder", headers=headers).json()["report"]
    assert_stored(built, got)
    assert [c["id"] for c in got["wrapped"]["cards"]][:2] == ["builder_type", "shipped"]
    assert got["money"]["by_model"][0]["model"] == "claude-opus-5"
    assert got["burn"]["causes"][0]["cause"] == "context_replay"


def test_a_v1_report_without_the_new_blocks_still_round_trips(client, paired):
    """An older capture sends version 1, with none of the five. Refusing it would break
    every machine that has not updated; storing it with the blocks null says exactly
    what is true, that that machine does not compute them."""
    _, headers = paired
    old = copy.deepcopy(REPORT_V1)
    assert not set(V2_BLOCKS) & set(old)
    r = client.put("/v1/profile/report", json=old, headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["report_version"] == 1

    got = client.get("/v1/profile/builder", headers=headers).json()["report"]
    assert got["report_version"] == 1
    for block in V2_BLOCKS:
        assert got[block] is None, block
    assert got["agents"]["parallelism"] == 2.93
    assert got["coverage"]["spans_days"] == 2


def test_a_second_report_replaces_the_first(client, paired):
    """One row per person. A report describes a corpus as it stands, and keeping the one
    it replaced would only let a screen show a description of a corpus that is gone."""
    _, headers = paired
    client.put("/v1/profile/report", json=doc(), headers=headers)
    client.put("/v1/profile/report", json=doc(window_days=30), headers=headers)
    got = client.get("/v1/profile/builder", headers=headers).json()["report"]
    assert got["window_days"] == 30


def test_a_field_the_spec_does_not_have_is_refused(client, paired):
    """`extra='forbid'` is the WHOLE of the enforcement here. Unlike the narrative there
    was no constrained decoder upstream that already knew this document's shape: the
    builder is ordinary Python and can grow a key without the spec growing one."""
    _, headers = paired
    bad = doc()
    bad["cost_per_agent_usd"] = 0.42
    assert client.put("/v1/profile/report", json=bad, headers=headers).status_code == 422


def test_a_nested_field_the_spec_does_not_have_is_refused(client, paired):
    """The nested half matters more: a block is where a module would grow a field, and a
    top-level-only check would wave it through."""
    _, headers = paired
    bad = doc()
    bad["agents"] = dict(bad["agents"], tokens=91_000)
    assert client.put("/v1/profile/report", json=bad, headers=headers).status_code == 422


def test_an_enum_value_the_spec_does_not_have_is_refused(client, paired):
    _, headers = paired
    bad = doc()
    bad["trends"] = [dict(bad["trends"][0], direction="sideways")]
    assert client.put("/v1/profile/report", json=bad, headers=headers).status_code == 422


def test_a_label_longer_than_the_spec_allows_is_refused(client, paired):
    """The bounds are enforced here or nowhere: nothing upstream checks a string length."""
    _, headers = paired
    bad = doc()
    bad["trends"] = [dict(bad["trends"][0], label="x" * 200)]
    assert client.put("/v1/profile/report", json=bad, headers=headers).status_code == 422


def _with_card(**card_overrides) -> dict:
    bad = doc()
    cards = copy.deepcopy(bad["wrapped"]["cards"])
    cards[0] = dict(cards[0], **card_overrides)
    bad["wrapped"] = dict(bad["wrapped"], cards=cards)
    return bad


@pytest.mark.parametrize("key", ["question", "display", "sentence"])
def test_a_wrapped_card_carrying_a_sentence_is_refused(client, paired, key):
    """The machine's own card has a question, a display and a sentence; `wrapped.wire`
    drops all three because the phone writes its own words. A card that skipped `wire`
    is a sentence on its way into Postgres, and this is where it stops."""
    _, headers = paired
    bad = _with_card(**{key: "4.7 test runs an hour, about one every 13 minutes."})
    assert client.put("/v1/profile/report", json=bad, headers=headers).status_code == 422


def test_a_quote_inside_the_report_is_refused(client, paired):
    """Quotes are the second opt-in exception and travel in their own document, owner only
    (contract v4 `quotes`). Inside the report they are a prompt with no switch."""
    _, headers = paired
    bad = doc()
    bad["wrapped"] = dict(
        bad["wrapped"],
        quotes={"go_to_prompt": {"text": "zqx sentinel prompt", "ts": 1757749265.0}},
    )
    assert client.put("/v1/profile/report", json=bad, headers=headers).status_code == 422
    # And no field of a card can carry one either: the words are not a declared key.
    bad = _with_card(quote="zqx sentinel prompt")
    assert client.put("/v1/profile/report", json=bad, headers=headers).status_code == 422


def test_a_local_cards_reading_of_what_was_typed_is_refused(client, paired):
    """crash_out and cryptic_prompt keep every number but n on the machine: a crash out
    score's parts and a cryptic prompt's length are readings of the words typed."""
    _, headers = paired
    for local in ({"parts": {"profanity": 2, "caps_words": 3}}, {"length": 10}):
        bad = doc()
        cards = copy.deepcopy(bad["wrapped"]["cards"])
        cards[4] = dict(cards[4], extras=local)
        bad["wrapped"] = dict(bad["wrapped"], cards=cards)
        assert client.put("/v1/profile/report", json=bad, headers=headers).status_code == 422


def test_an_unknown_term_id_is_refused(client, paired):
    """The phone has copy for every term in the catalog and none for anything else; an id
    outside it is either a catalog nobody regenerated or a word from a transcript."""
    _, headers = paired
    bad = doc()
    terms = copy.deepcopy(bad["vocab"]["terms"])
    terms[0]["id"] = "zqx_sentinel_term"
    bad["vocab"] = dict(bad["vocab"], terms=terms)
    assert client.put("/v1/profile/report", json=bad, headers=headers).status_code == 422
    # The same door on the other catalogs: a stack item and a price row.
    bad = doc()
    bad["stack"] = dict(bad["stack"], items=[dict(bad["stack"]["items"][0], id="zqx_sentinel")])
    assert client.put("/v1/profile/report", json=bad, headers=headers).status_code == 422
    bad = doc()
    by_model = [dict(bad["money"]["by_model"][0], model="gpt-zqx")]
    bad["money"] = dict(bad["money"], by_model=by_model)
    assert client.put("/v1/profile/report", json=bad, headers=headers).status_code == 422


def test_a_v2_refusal_in_words_is_refused(client, paired):
    """In version 2 a refusal is a code and the phone writes the sentence. The profile's
    own wording, sent where the code belongs, is a string the phone would print as a
    debug id, so the door refuses it rather than storing it."""
    _, headers = paired
    bad = doc()
    bad["burn"] = dict(
        bad["burn"], share=None, causes=None, reason="no session reported token counts"
    )
    assert client.put("/v1/profile/report", json=bad, headers=headers).status_code == 422
    bad = _with_card(value=None, value_id=None, reason="fewer than 3 sessions")
    assert client.put("/v1/profile/report", json=bad, headers=headers).status_code == 422


def test_a_share_above_one_is_refused_and_a_rate_is_not(client, paired):
    """Shares are bounded 0 to 1 at the door. The steer rate is not a share, because
    interrupts can outnumber prompts, so 1.3 is a real value and must be stored."""
    _, headers = paired
    bad = doc()
    bad["burn"] = dict(bad["burn"], share=1.2)
    assert client.put("/v1/profile/report", json=bad, headers=headers).status_code == 422
    bad = doc()
    causes = copy.deepcopy(bad["burn"]["causes"])
    causes[0]["share"] = -0.1
    bad["burn"] = dict(bad["burn"], causes=causes)
    assert client.put("/v1/profile/report", json=bad, headers=headers).status_code == 422

    ok = _with_card(extras={"steer_rate": 1.3})
    assert client.put("/v1/profile/report", json=ok, headers=headers).status_code == 200


def test_more_cards_than_the_deck_has_is_refused(client, paired):
    _, headers = paired
    bad = doc()
    one = bad["wrapped"]["cards"][0]
    bad["wrapped"] = dict(bad["wrapped"], cards=[one] * 16)
    assert client.put("/v1/profile/report", json=bad, headers=headers).status_code == 422


def test_one_persons_report_is_invisible_to_another(client, created_users, paired):
    _, victim = paired
    assert client.put("/v1/profile/report", json=doc(), headers=victim).status_code == 200
    assert client.get("/v1/profile/builder", headers=victim).json()["report"] is not None

    _, attacker = _pair(client, created_users)
    assert client.get("/v1/profile/builder", headers=attacker).json()["report"] is None


def test_an_attackers_put_writes_their_own_row_and_not_the_victims(client, created_users, paired):
    """The upsert is keyed on the viewer, so there is no id to point at somebody else's."""
    _, victim = paired
    client.put("/v1/profile/report", json=doc(), headers=victim)

    _, attacker = _pair(client, created_users)
    client.put("/v1/profile/report", json=doc(window_days=365), headers=attacker)

    assert client.get("/v1/profile/builder", headers=victim).json()["report"]["window_days"] == 7


def test_the_route_needs_a_device(client):
    assert client.put("/v1/profile/report", json=doc()).status_code == 401
    assert client.get("/v1/profile/builder").status_code == 401
