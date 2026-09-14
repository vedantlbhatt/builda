"""The builder profile: an aggregate of session analyses, per person, AS builder_app.

docs/analysis.md: a profile is an honest aggregate of sessions, never one run's
impression. These tests seed real analyses through `/v1/sync/sessions:batch` — varying the
dimension scores, archetypes, tags and build style across four sessions with a known order
— and check that the means, the modal archetype, the sign of the trend and the tag counts
are the ones a person could recompute by hand. Then: two sessions is not a profile, live
snapshots and sessions outside the window do not count, and another user's analyses never
enter the aggregate even when the query names their id.

Same harness as test_sync.py, whose fixtures are reused directly.
"""

import copy
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from test_contract import SAMPLE_ANALYSIS
from test_sync import (  # noqa: F401 - fixtures are picked up by name
    TEST_DB,
    _live,
    _pair,
    _payload,
    _upload,
    app_env,
    client,
    created_users,
    paired,
)

pytestmark = pytest.mark.skipif(not TEST_DB, reason="set BUILDER_TEST_DB to run")

# pytest finds the imported fixtures through this module's namespace. Referencing them
# once here is what tells the linter the test parameters below do not shadow unused names.
_SHARED_FIXTURES = (app_env, client, created_users, paired)

DIMENSIONS = ("steering", "execution", "engineering", "product_instinct", "planning")


def _analysis(*scores: int, **overrides) -> dict:
    """SAMPLE_ANALYSIS with the five dimension scores (in DIMENSIONS order) and any
    top-level overrides."""
    a = copy.deepcopy(SAMPLE_ANALYSIS)
    a["dimensions"] = [
        {"dimension": d, "score": s, "rationale": "grounded in the digest"}
        for d, s in zip(DIMENSIONS, scores, strict=True)
    ]
    a.update(overrides)
    return a


def _session_at(days_ago: int, analysis: dict, **overrides) -> dict:
    started = datetime.now(UTC).replace(microsecond=0) - timedelta(days=days_ago)
    return _payload(
        started_at=started,
        ended_at=started + timedelta(hours=1),
        analysis=analysis,
        **overrides,
    )


#: Oldest first. steering rises across the four (60,60 -> 80,80: trend +20), execution
#: falls (90,90 -> 70,70: -20), engineering is flat at 50.
FOUR = [
    _session_at(
        10,
        _analysis(
            60,
            90,
            50,
            40,
            40,
            archetype="architect",
            tags=["sync", "contract"],
            build_style={**SAMPLE_ANALYSIS["build_style"], "planning": "light"},
            prompting={**SAMPLE_ANALYSIS["prompting"], "specificity": 60, "tone": "terse"},
            decision_patterns=[
                {
                    "pattern": "Asks for the measurement before the constant",
                    "prompt_excerpt": "what does the corpus say",
                    "effect": None,
                }
            ],
            confidence=0.6,
        ),
    ),
    _session_at(
        7,
        _analysis(
            60,
            90,
            50,
            50,
            50,
            archetype="architect",
            tags=["sync"],
            build_style={**SAMPLE_ANALYSIS["build_style"], "planning": "light"},
            prompting={**SAMPLE_ANALYSIS["prompting"], "specificity": 70, "tone": "neutral"},
            decision_patterns=[],
            confidence=0.8,
        ),
    ),
    _session_at(
        4,
        _analysis(
            80,
            70,
            50,
            60,
            60,
            archetype="explorer",
            tags=["sync", "contract", "maps"],
            build_style={**SAMPLE_ANALYSIS["build_style"], "planning": "plan_mode"},
            prompting={**SAMPLE_ANALYSIS["prompting"], "specificity": 80, "tone": "terse"},
            decision_patterns=[
                {
                    "pattern": "asks for the measurement before the constant",
                    "prompt_excerpt": "measure it first",
                    "effect": None,
                },
                {"pattern": "names the file", "prompt_excerpt": "in Tuning.swift", "effect": None},
            ],
            confidence=0.9,
        ),
    ),
    _session_at(
        1,
        _analysis(
            80,
            70,
            50,
            70,
            70,
            archetype=None,  # too short to say: counted as analysed, not as an archetype
            tags=[],
            build_style={**SAMPLE_ANALYSIS["build_style"], "planning": "light"},
            prompting={**SAMPLE_ANALYSIS["prompting"], "specificity": 90, "tone": "neutral"},
            decision_patterns=[],
            confidence=0.7,
        ),
    ),
]


def test_four_analysed_sessions_aggregate_the_way_a_person_would_recompute(client, paired):
    uid, headers = paired
    assert _upload(client, headers, *FOUR)["accepted"] == 4

    bp = client.get("/v1/profile", headers=headers).json()["builder_profile"]
    assert bp is not None
    assert bp["sessions_analysed"] == 4
    assert bp["window_days"] == 90
    assert bp["confidence_mean"] == pytest.approx(0.75)

    dims = bp["dimensions"]
    assert set(dims) == set(DIMENSIONS)
    assert dims["steering"] == {"mean": 70.0, "sessions": 4, "trend": 20.0}
    assert dims["execution"] == {"mean": 80.0, "sessions": 4, "trend": -20.0}
    assert dims["engineering"] == {"mean": 50.0, "sessions": 4, "trend": 0.0}
    # Rising by ten a session: recent half (60,70) minus older half (40,50).
    assert dims["product_instinct"]["trend"] == 20.0

    # Modal over the three sessions that had one; the null does not dilute the share.
    assert bp["archetype"] == {
        "modal": "architect",
        "share": pytest.approx(2 / 3, abs=1e-3),
        "with_archetype": 3,
        "distribution": {"architect": 2, "explorer": 1},
    }

    assert bp["build_style"]["planning"]["mode"] == "light"
    assert bp["build_style"]["planning"]["share"] == 0.75
    assert bp["build_style"]["planning"]["distribution"] == {"light": 3, "plan_mode": 1}
    # The other four keys were the sample's value on every session.
    for key, value in [
        ("iteration", "linear"),
        ("steering", "guided"),
        ("verification", "ran_tests"),
        ("scope_control", "held"),
    ]:
        assert bp["build_style"][key] == {"mode": value, "share": 1.0, "distribution": {value: 4}}

    assert bp["prompting"]["specificity_mean"] == 75.0
    assert bp["prompting"]["correction_share_mean"] == pytest.approx(0.1)
    assert bp["prompting"]["question_share_mean"] == pytest.approx(0.2)
    assert bp["prompting"]["tone_distribution"] == {"neutral": 2, "terse": 2}

    assert bp["tags"] == [
        {"tag": "sync", "sessions": 3},
        {"tag": "contract", "sessions": 2},
        {"tag": "maps", "sessions": 1},
    ]

    # Case-folded grouping, display casing and example from the most recent occurrence.
    assert bp["decision_patterns"] == [
        {
            "pattern": "asks for the measurement before the constant",
            "sessions": 2,
            "example": "measure it first",
        },
        {"pattern": "names the file", "sessions": 1, "example": "in Tuning.swift"},
    ]

    # The standalone route serves the same object, with the count beside it.
    alone = client.get("/v1/profile/builder", headers=headers).json()
    assert alone["builder_profile"] == bp
    assert alone["sessions_analysed"] == 4 and alone["min_sessions"] == 3
    assert alone["window_days"] == 90


def test_live_snapshots_and_sessions_outside_the_window_do_not_count(client, paired):
    uid, headers = paired
    _upload(client, headers, *FOUR)

    # A live checkpoint with an analysis describes work in progress: excluded.
    live_started = datetime.now(UTC).replace(microsecond=0) - timedelta(minutes=30)
    _upload(client, headers, _live(live_started, 20, analysis=SAMPLE_ANALYSIS))
    assert client.get("/v1/profile/builder", headers=headers).json()["sessions_analysed"] == 4

    # 200 days ago: outside the default 90, inside 365.
    old = _session_at(200, _analysis(10, 10, 10, 10, 10))
    _upload(client, headers, old)
    default = client.get("/v1/profile/builder", headers=headers).json()
    assert default["sessions_analysed"] == 4
    assert default["builder_profile"]["dimensions"]["engineering"]["mean"] == 50.0
    wide = client.get("/v1/profile/builder?window_days=365", headers=headers).json()
    assert wide["sessions_analysed"] == 5
    assert wide["builder_profile"]["dimensions"]["engineering"]["mean"] == 42.0

    assert client.get("/v1/profile/builder?window_days=366", headers=headers).status_code == 422
    assert client.get("/v1/profile/builder?window_days=0", headers=headers).status_code == 422


def test_two_analysed_sessions_is_not_a_profile(client, paired):
    """docs/analysis.md: do not compute an archetype from one run. Null, with the count
    beside it so the phone can say how far off the person is."""
    uid, headers = paired
    _upload(client, headers, *FOUR[:2])

    assert client.get("/v1/profile", headers=headers).json()["builder_profile"] is None
    alone = client.get("/v1/profile/builder", headers=headers).json()
    assert alone["builder_profile"] is None
    assert (alone["sessions_analysed"], alone["min_sessions"], alone["window_days"]) == (2, 3, 90)
    # The computed corpus is a different object with a different floor: it needs sessions,
    # not analyses. Two of them is still under `MIN_SESSIONS`, so it names no archetype.
    assert alone["corpus"]["totals"]["total_sessions"] == 2
    assert alone["corpus"]["archetype"]["name"] is None

    # The third one tips it.
    _upload(client, headers, FOUR[2])
    assert client.get("/v1/profile/builder", headers=headers).json()["sessions_analysed"] == 3
    assert client.get("/v1/profile", headers=headers).json()["builder_profile"] is not None


def test_another_users_analyses_never_enter_the_aggregate(client, created_users):
    """RLS on session_analysis, as builder_app. Through the route, and then through the
    aggregate itself with the OTHER user's id in the query and the viewer set to this
    one — the case where a `user_id = :u` filter alone would leak."""
    from builder.builder_profile import builder_profile
    from builder.db import db_session

    uid_a, headers_a = _pair(client, created_users)
    uid_b, headers_b = _pair(client, created_users)
    _upload(client, headers_b, *FOUR)

    assert client.get("/v1/profile/builder", headers=headers_b).json()["sessions_analysed"] == 4
    a = client.get("/v1/profile/builder", headers=headers_a).json()
    assert a["builder_profile"] is None and a["sessions_analysed"] == 0

    with db_session(viewer_id=uid_a) as db:
        assert builder_profile(db, uid_b, 90) == (None, 0)
    with db_session(viewer_id=uid_b) as db:
        assert builder_profile(db, uid_b, 90)[1] == 4


# ------------------------------------------------------------------ computed corpus
#: The FOUR fixtures above are the sample payload four times over: one hour each, all
#: attended, 10 prompts, 100 Bash calls, 200 agent lines, 2 commits, 200 output tokens on
#: one model. Every number below is that, times four.
def test_the_corpus_metrics_are_computed_from_the_sessions_not_from_any_analysis(client, paired):
    uid, headers = paired
    _upload(client, headers, *FOUR)

    corpus = client.get("/v1/profile/builder", headers=headers).json()["corpus"]
    assert corpus["totals"] == {
        "total_sessions": 4,
        "total_hours": 4.0,
        "total_prompts": 40,
        "total_lines_added": 800,
        # 10 a session, from the stored `lines_removed_agent` (5.2): summed like the added
        # lines, so the money view can put red beside green.
        "total_lines_removed": 40,
        "total_commits": 8,
        "commit_basis": "git_log_window",
        "total_tool_calls": 400,
    }
    m = corpus["metrics"]
    assert m["iteration_depth"]["value"] == 10.0  # 400 tool calls over 40 prompts
    assert m["autonomy_score"]["value"] == 0.0  # every one of the four was attended
    # 800 agent lines over 4 active hours. The uploaded rows cannot say WHICH tool wrote
    # them (both clients fold `cat > f <<'EOF'` into one number), so the rate rests on the
    # line total being too large to be an artefact rather than on a count of writes.
    assert m["code_velocity"]["value"] == 200.0
    assert m["code_velocity"]["basis"] == "uploaded_agent_lines"
    assert corpus["model_mix"] == [
        {"model": "claude-opus-5[1m]", "output_tokens": 800, "share": 1.0}
    ]
    assert corpus["sample"]["sessions"] == 4
    assert corpus["sample"]["prompts"] == 40


def test_what_the_server_cannot_see_is_null_with_a_reason_rather_than_zero(client, paired):
    """Prompt text, interrupts, real tool names and commit times never leave the machine
    (privacy/upload-contract.json). The metrics that rest on them must say so."""
    uid, headers = paired
    _upload(client, headers, *FOUR)

    corpus = client.get("/v1/profile/builder", headers=headers).json()["corpus"]
    m, missing = corpus["metrics"], corpus["sample"]["missing"]
    for key in (
        "avg_prompt_chars",
        "median_prompt_chars",
        "short_prompt_share",
        "planning_ratio",
        "steer_rate",
        "night_commit_share",
        "tool_diversity",
    ):
        assert m[key]["value"] is None, key
        assert missing[key], key
    assert "not stored server side" in missing["steer_rate"]
    assert "only the names of common tools" in missing["tool_diversity"]
    # And no fact is ever built on a metric that is null.
    ids = {f["id"] for f in corpus["facts"]}
    assert ids.isdisjoint({"steer_rate", "planning_ratio", "avg_prompt_chars"})


def test_the_facts_are_ranked_second_person_sentences_with_no_dashes(client, paired):
    uid, headers = paired
    _upload(client, headers, *FOUR)

    facts = client.get("/v1/profile/builder", headers=headers).json()["corpus"]["facts"]
    assert facts, "four sessions should produce at least one fact"
    assert [f["unusualness"] for f in facts] == sorted(
        (f["unusualness"] for f in facts), reverse=True
    )
    for f in facts:
        assert {"id", "text", "value", "unit"} <= set(f)
        assert "\u2014" not in f["text"] and "\u2013" not in f["text"]
        # Every fact carries its number, except the peak hour at 0 or 12, which `profile._hour`
        # spells "midnight" and "noon". The sessions start at now minus whole days, so this
        # test failed only when the suite ran in those hours (seen 2026-09-13: "at noon").
        spelled = f["id"] == "peak_hour" and f["value"] in (0, 12)
        assert spelled or any(ch.isdigit() for ch in f["text"]), f["text"]
    assert any(f["text"].startswith("You default to Opus") for f in facts)


def test_a_line_total_too_small_to_be_a_rate_is_refused(client, paired):
    """The trap this metric exists to avoid, in the shape the proof database has: 11 lines
    across three sessions reads as a tidy "3.7 lines an hour" and means nothing. The
    module's floor catches it, and the reason says the writes cannot be counted here."""
    uid, headers = paired
    _upload(
        client,
        headers,
        *[
            _session_at(
                d,
                _analysis(50, 50, 50, 50, 50),
                tool_calls={"Bash": 50},
                lines_added_agent=4,
            )
            for d in (5, 3, 1)
        ],
    )

    m = client.get("/v1/profile/builder", headers=headers).json()["corpus"]["metrics"]
    assert m["code_velocity"]["value"] is None
    assert "too small a total" in m["code_velocity"]["reason"]
    assert not any(f["id"] == "code_velocity" for f in _facts(client, headers))


def _facts(client, headers) -> list:
    return client.get("/v1/profile/builder", headers=headers).json()["corpus"]["facts"]


def test_a_live_snapshot_is_not_part_of_the_corpus(client, paired):
    """A live row's numbers move every minute; folding them in would make the profile
    disagree with itself between two pulls, exactly as on the rest of the profile."""
    uid, headers = paired
    _upload(client, headers, *FOUR)
    started = datetime.now(UTC).replace(microsecond=0) - timedelta(minutes=30)
    _upload(client, headers, _live(started, 20))

    corpus = client.get("/v1/profile/builder", headers=headers).json()["corpus"]
    assert corpus["totals"]["total_sessions"] == 4


def test_another_users_sessions_never_enter_the_corpus(client, created_users):
    """RLS on `sessions` and `session_stats`, as builder_app, through the route."""
    uid_a, headers_a = _pair(client, created_users)
    uid_b, headers_b = _pair(client, created_users)
    _upload(client, headers_b, *FOUR)

    assert (
        client.get("/v1/profile/builder", headers=headers_b).json()["corpus"]["totals"][
            "total_sessions"
        ]
        == 4
    )
    a = client.get("/v1/profile/builder", headers=headers_a).json()["corpus"]
    assert a["totals"]["total_sessions"] == 0
    assert a["archetype"]["name"] is None


# ------------------------------------------------------------ spend from the stored buckets
#: Big enough that a rounding to cents cannot hide a missing bucket: 1.2M input, 300k
#: output, 40M cache reads and 1M of cache writes split across the two TTLs.
BUCKETS = {
    "input": 1_200_000,
    "output": 300_000,
    "cache_read": 40_000_000,
    "cache_w5m": 900_000,
    "cache_w1h": 100_000,
}


def _priced(days_ago: int, **overrides) -> dict:
    started = datetime.now(UTC).replace(microsecond=0) - timedelta(days=days_ago)
    return _payload(
        **{"started_at": started, "ended_at": started + timedelta(hours=1), "tokens": BUCKETS}
        | overrides
    )


def test_spend_is_priced_from_the_stored_token_buckets(client, paired):
    """docs/overnight-integration.md 5.2. The server passed the output split and no
    buckets, so pricing skipped every session and `spend_usd` said "no session reported
    token counts" about sessions that all had. Two sessions, one model, and the dollars
    worked out here by hand from the price table's own rates."""
    from builder.builder_profile import _profile_module

    pricing = _profile_module().pricing
    # THE rounding rule for a number a person reads (`analysis.plain.rounded`, a tie up):
    # an hour at $40.125 is $40.13, where Python's own `round` said $40.12.
    rounded = _profile_module().plain.rounded
    uid, headers = paired
    _upload(client, headers, _priced(3), _priced(2))

    m = client.get("/v1/profile/builder", headers=headers).json()["corpus"]["metrics"]
    p = pricing.PRICES["claude-opus-5"]  # the sample payload's claude-opus-5[1m]
    one = (
        BUCKETS["input"] * p.input
        + BUCKETS["output"] * p.output
        + BUCKETS["cache_read"] * p.cache_read
        + BUCKETS["cache_w5m"] * p.cache_write_5m
        + BUCKETS["cache_w1h"] * p.cache_write_1h
    ) / 1_000_000
    spend = m["spend_usd"]
    assert spend["value"] == rounded(2 * one, 2), spend
    assert spend["n"] == 2 and spend["reason"] is None
    assert spend["basis"] in (pricing.BASIS_LIST_PRICE, "stale_prices")
    assert spend["prices_read_on"] == str(pricing.PRICES_READ_ON)
    assert m["spend_per_hour_usd"]["value"] == rounded(2 * one / 2, 2)


def test_a_corpus_with_no_token_buckets_refuses_as_not_reported(client, paired):
    """Absent is not zero: sessions whose harness reported no counts are refused by basis,
    never priced at $0."""
    uid, headers = paired
    _upload(
        client,
        headers,
        *[_priced(d, tokens_reported=False, tokens=None) for d in (3, 2, 1)],
    )
    spend = client.get("/v1/profile/builder", headers=headers).json()["corpus"]["metrics"][
        "spend_usd"
    ]
    assert spend["value"] is None
    assert spend["basis"] == "tokens_not_reported"
    assert spend["reason"]


def test_model_costs_carry_the_price_table_key(client, paired):
    """The report's `by_model` names a model by its price table key (`priced_model`); the
    server's rows carry the same key beside the display name, from the same function."""
    from builder.builder_profile import _profile_module

    pricing = _profile_module().pricing
    uid, headers = paired
    _upload(client, headers, _priced(3), _priced(2))
    rows = client.get("/v1/profile/builder", headers=headers).json()["corpus"]["model_costs"]
    assert [r["model_id"] for r in rows] == ["claude-opus-5"]
    assert rows[0]["model_id"] in pricing.PRICES
    assert rows[0]["model"] == pricing.family("claude-opus-5")
    assert rows[0]["sessions"] == 2


def _opus_sitting(started: datetime, repo: str) -> dict:
    """One hour, priced, all Opus (the sample's model), ten commits in its git window."""
    return _payload(
        started_at=started,
        ended_at=started + timedelta(hours=1),
        tokens=BUCKETS,
        repo_hash=repo,
        commit_count=10,
    )


def test_per_model_commits_are_refused_when_the_windows_overlap(client, paired):
    """FOUND IN THE ADVERSARIAL REVIEW (2026-09-13, `advrev/num/probes/p_model_commits.py`):
    two sittings in one repository ten minutes apart both asked git about the same commits,
    and the server's per model row summed them (20 for 10) and priced dollars per commit off
    the double count. The machine claims each commit once by its SHA
    (`profile.attribute_commits`); the server stores no SHA, so when the windows overlap,
    the rule that already refuses `totals.total_commits`, both per model fields are null
    with the reason. The dollars are still the dollars."""
    uid, headers = paired
    repo = uuid.uuid4().hex * 2
    t0 = datetime.now(UTC).replace(microsecond=0) - timedelta(days=2)
    _upload(
        client, headers, _opus_sitting(t0, repo), _opus_sitting(t0 + timedelta(minutes=10), repo)
    )
    corpus = client.get("/v1/profile/builder", headers=headers).json()["corpus"]
    assert corpus["totals"]["total_commits"] is None
    assert corpus["totals"]["commit_basis"] == "overlapping_session_windows"
    (row,) = corpus["model_costs"]
    assert (row["commits"], row["usd_per_commit"]) == (None, None), row
    assert row["commits_refusal"] == "overlapping_session_windows"
    assert row["usd"] > 0 and row["sessions"] == 2


def test_per_model_commits_stand_when_no_windows_overlap(client, paired):
    uid, headers = paired
    t0 = datetime.now(UTC).replace(microsecond=0) - timedelta(days=3)
    _upload(
        client,
        headers,
        _opus_sitting(t0, uuid.uuid4().hex * 2),
        _opus_sitting(t0 + timedelta(days=1), uuid.uuid4().hex * 2),
    )
    (row,) = client.get("/v1/profile/builder", headers=headers).json()["corpus"]["model_costs"]
    assert row["commits"] == 20 and row["usd_per_commit"] is not None
    assert row["commits_refusal"] is None


def test_window_days_is_the_query_the_phone_sends(client, paired):
    """docs/overnight-integration.md 5.3: the phone sent `?days=119`, which this route does
    not read, so it always got 90 and nothing said so. `window_days` is the name, it is
    echoed back, and an unknown name changes nothing."""
    uid, headers = paired
    assert (
        client.get("/v1/profile/builder?window_days=30", headers=headers).json()["window_days"]
        == 30
    )
    assert client.get("/v1/profile/builder?days=30", headers=headers).json()["window_days"] == 90


# ------------------------------------------------------------------------ quotes (0021)
QUOTES_DOC = {
    "quotes_version": 1,
    "generated_at": "2026-09-13T08:00:00Z",
    "quotes": [
        {
            "card": "go_to_prompt",
            "text": "run the tests again",
            "client_session_id": "a" * 64,
            "sent_at": "2026-09-12T21:00:00Z",
            "seconds_in": 640,
            "tool_calls_after": None,
            "corrected": None,
        }
    ],
}


def test_quotes_are_served_to_their_owner_only_while_the_switch_is_on(client, created_users):
    """The second opt-in exception, read side. Null by default; a stored document shows
    only while Quote my prompts is on (off deletes it, and the read checks the switch too);
    and another person's profile never carries it. The document is seeded as the owner
    because writing it is `PUT /v1/profile/quotes`'s job, not this route's."""
    import json

    from sqlalchemy import text
    from test_sync import owner_engine

    uid_a, headers_a = _pair(client, created_users)
    uid_b, headers_b = _pair(client, created_users)
    assert client.get("/v1/profile/builder", headers=headers_a).json()["quotes"] is None
    # The session the quote was sent in: a quote is served only while it is on the server.
    held = QUOTES_DOC["quotes"][0]["client_session_id"]
    assert _upload(client, headers_a, _payload(client_session_id=held))["accepted"] == 1

    with owner_engine().begin() as c:
        c.execute(
            text(
                "INSERT INTO builder_quotes (user_id, quotes_version, generated_at, body) "
                "VALUES (:u, 1, now(), CAST(:b AS jsonb))"
            ),
            {"u": uid_a, "b": json.dumps(QUOTES_DOC)},
        )
    assert client.get("/v1/profile/builder", headers=headers_a).json()["quotes"] is None

    with owner_engine().begin() as c:
        c.execute(
            text("INSERT INTO privacy_prefs (user_id, quotes) VALUES (:u, true)"), {"u": uid_a}
        )
    assert client.get("/v1/profile/builder", headers=headers_a).json()["quotes"] == QUOTES_DOC
    assert client.get("/v1/profile/builder", headers=headers_b).json()["quotes"] is None
    # The profile tab's own request never carries them.
    assert "run the tests again" not in client.get("/v1/profile", headers=headers_a).text


def test_the_server_only_rounding_is_the_one_rule():
    """The server only image has no `analysis/`, and its fallback used Python's `round`, a tie
    to the even digit: 72.25 said 72.2 there and 72.3 everywhere else (FOUND IN REVIEW,
    2026-09-14). The fallback is the one rule's arithmetic, held to it here."""
    import random

    from builder import builder_profile as bp

    plain = bp._profile_module().plain
    rng = random.Random(20260914)
    values = [72.25, 0.185, 2.675, 1.005, 0.5, 1.5, 2.5, -0.5, 3929.6, 0.0, 12.345]
    values += [rng.uniform(-1000, 1000) for _ in range(2000)]
    values += [round(rng.uniform(0, 100), 3) for _ in range(2000)]
    for x in values:
        for digits in (None, 0, 1, 2, 3):
            assert bp._half_up(x, digits) == plain.rounded(x, digits), (x, digits)
    assert bp._half_up(72.25, 1) == 72.3
    assert bp._half_up(7, 2) == 7
