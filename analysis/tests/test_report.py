"""The builder report: what may travel, what must be refused, and what the spec says.

Every case here corresponds to a way this document could be wrong on somebody's phone
without anything raising. Three of them are about the wire itself: a field the spec does
not have is a 422 nobody can act on, a prompt in the payload is a broken promise, and a
number that came back null and was rendered as zero is a lie with no error attached.
"""

from __future__ import annotations

import json
import pathlib
import unittest

from analysis import agents as ag
from analysis import report as rp
from analysis import trends as tr

SPEC = json.loads((pathlib.Path(__file__).resolve().parents[2] / "spec/report.v1.json").read_text())


def span(start, end, aid="a", kind="general-purpose", tools=1, landed=0):
    return ag.AgentSpan(
        agent_id=aid,
        agent_type=kind,
        asked="find the thing",
        started_at=start,
        ended_at=end,
        records=3,
        tool_calls=tools,
        landed=landed,
        failures=0,
    )


def trend(metric="test_runs_per_hour", before=2.0, now=4.0):
    return tr.Trend(
        metric=metric,
        label=tr.LABEL.get(metric, metric),
        before=before,
        now=now,
        move=(now - before) / before,
        direction="up" if now > before else "down",
        good=True,
        sessions_before=5,
        sessions_now=6,
    )


class Shape(unittest.TestCase):
    """The document's keys are the spec's keys, at every level.

    `report_spec.py` forbids extras at the door, so a block that grows a field here and
    not in spec/report.v1.json is a 422 on a real upload — discovered by a user, months
    after anybody touched this, with no way for them to act on it.
    """

    def top_level_names(self):
        return {f["name"] for f in SPEC["fields"]}

    def object_names(self, name):
        return {f["name"] for f in SPEC["objects"][name]}

    def test_an_empty_report_has_exactly_the_specs_top_level_fields(self):
        self.assertEqual(set(rp.build()), self.top_level_names())

    def test_a_full_report_has_exactly_the_specs_fields_in_every_block(self):
        fo = ag.fanout([span(0, 100), span(50, 150, "b")], 200)
        doc = rp.build(trends=[trend()], fanout=fo, sessions=[])
        self.assertEqual(set(doc), self.top_level_names())
        self.assertEqual(set(doc["agents"]), self.object_names("ReportAgents"))
        self.assertEqual(set(doc["trends"][0]), self.object_names("ReportTrend"))
        self.assertEqual(set(doc["agents"]["by_type"][0]), self.object_names("ReportAgentType"))

    def test_the_language_block_has_exactly_the_specs_fields(self):
        import datetime as dt

        from analysis import patterns as pat
        from analysis.digest import Ev

        events = [Ev(1, 0.0, "tool", "", tool="Write", added=300, path="/r/a.py")]
        s = pat.SessionEvents(
            session_id="s",
            started_at=0.0,
            ended_at=60.0,
            active_seconds=60.0,
            attended_seconds=60.0,
            tz_offset_minutes=0,
            events=events,
        )
        doc = rp.build(sessions=[s])
        assert dt  # the import is what makes this a real session, not decoration
        self.assertEqual(set(doc["languages"]), self.object_names("ReportLanguages"))
        self.assertEqual(set(doc["languages"]["languages"][0]), self.object_names("ReportLanguage"))

    def test_the_version_matches_the_spec(self):
        """Two places hold this number and `scripts/gen_report.py` copies the spec's into
        both generated halves; a module that stamped a different one would store documents
        claiming rules they were not built by."""
        self.assertEqual(rp.REPORT_VERSION, SPEC["version"])

    def test_the_v2_blocks_are_appended_nullable_objects_so_a_v1_document_still_validates(self):
        """A report an older capture sent has none of the five, or none of the six, and it
        must still be stored: every one is nullable, the version 2 blocks come after every
        v1 field, and the version 3 block after them."""
        fields = SPEC["fields"]
        names = [f["name"] for f in fields]
        appended = (*rp.V2_BLOCKS, *rp.V3_BLOCKS)
        self.assertEqual(tuple(names[-len(appended) :]), appended)
        self.assertEqual(names[-len(appended) - 1], "languages")
        for f in fields[-len(appended) :]:
            self.assertEqual(f["type"], "object", f["name"])
            self.assertTrue(f.get("nullable"), f"{f['name']} must be nullable")

    def test_a_block_this_machine_does_not_compute_is_null_and_never_zeroes(self):
        """A null block means "not computed here" and nothing else. An empty wrapped deck
        or a money block of zeroes would say this person built nothing and spent
        nothing, which is a claim nobody measured."""
        fo = ag.fanout([span(0, 100), span(50, 150, "b")], 200)
        for doc in (rp.build(), rp.build(trends=[trend()], fanout=fo)):
            for block in (*rp.V2_BLOCKS, *rp.V3_BLOCKS):
                self.assertIn(block, doc)
                self.assertIsNone(doc[block], block)

    def test_generated_at_is_utc_and_ends_in_z(self):
        self.assertTrue(rp.build()["generated_at"].endswith("Z"))


class WhatTheNumbersRestOn(unittest.TestCase):
    """A window is a QUESTION; coverage is how much of it the machine could answer.

    THE BUG THIS EXISTS FOR, and I walked into it myself: a fresh container answered a
    thirty day question with two days of transcripts and said nothing about the
    difference. "109 commits, none written alone" then reads as a fact about a person when
    it is a fact about a container that had existed since Tuesday. No number anywhere in
    the document would have caught it.
    """

    def profile(self, *, spans, active, sessions=10):
        return {
            "sample": {
                "spans_days": spans,
                "days": active,
                "sessions": sessions,
                "first_at": "2026-09-05T04:55:33Z",
                "last_at": "2026-09-06T22:26:13Z",
            }
        }

    def test_the_window_asked_for_travels_beside_what_was_found(self):
        got = rp.build(profile=self.profile(spans=2, active=2), window_days=30)["coverage"]
        self.assertEqual(got["window_days"], 30)
        self.assertEqual(got["spans_days"], 2)

    def test_days_you_built_is_not_how_far_back_the_transcripts_go(self):
        """Two sittings a month apart are 2 active days across 30, and reading one as the
        other is exactly how this went wrong. Both numbers, separately, always."""
        got = rp.build(profile=self.profile(spans=30, active=2), window_days=30)["coverage"]
        self.assertEqual(got["active_days"], 2)
        self.assertEqual(got["spans_days"], 30)

    def test_the_block_matches_the_spec(self):
        got = rp.build(profile=self.profile(spans=2, active=2))
        self.assertEqual(
            set(got["coverage"]),
            {f["name"] for f in SPEC["objects"]["ReportCoverage"]},
        )

    def test_no_profile_is_null_rather_than_a_block_of_zeroes(self):
        """Zeroes here would say "you have never built anything", which is a far worse
        sentence than saying nothing."""
        self.assertIsNone(rp.build()["coverage"])

    def test_there_is_no_verdict_and_no_threshold_in_the_document(self):
        """The honest thing is not a warning at some ratio somebody picked. It is printing
        what was asked for beside what was found; 30 against 2 needs no adjective, and a
        boolean here would be a judgement the client could not overrule."""
        got = rp.build(profile=self.profile(spans=2, active=2), window_days=30)["coverage"]
        for key in got:
            self.assertNotIn(key, ("partial", "warning", "enough", "reason"))


class NothingToSay(unittest.TestCase):
    """Null is not zero, in every block. An empty chart reads as 'you did nothing'."""

    def test_no_agents_is_null_and_not_a_block_of_zeroes(self):
        self.assertIsNone(rp.build()["agents"])
        self.assertIsNone(rp.build(fanout=ag.fanout([], 100))["agents"])

    def test_no_sessions_refuses_quality_and_prompting_rather_than_reporting_none_run(self):
        doc = rp.build()
        self.assertIsNone(doc["quality"])
        self.assertIsNone(doc["prompting"])

    def test_no_trends_means_no_headline(self):
        self.assertIsNone(rp.build()["trend_headline"])

    def test_a_headline_follows_the_window_it_was_given(self):
        """The bug this catches shipped once: the sentence said "on last month" whatever
        the window was, so a one day comparison announced a monthly trend."""
        week = rp.build(trends=[trend()], window_days=7)["trend_headline"]
        month = rp.build(trends=[trend()], window_days=30)["trend_headline"]
        self.assertNotIn("month", week)
        self.assertIn("month", month)
        self.assertNotEqual(week, month)


class Agents(unittest.TestCase):
    def test_concurrency_survives_a_corpus_with_long_quiet_stretches(self):
        """MEASURED, and the reason `parallelism` is over busy seconds: this container's
        53 agents did 11.9 hours of work in a 19.3 hour stretch, and agent-over-wall
        reported 0.61x for a run whose peak was eight at once."""
        fo = ag.fanout([span(0, 100, "a"), span(0, 100, "b")], 100_000)
        block = rp.build(fanout=fo)["agents"]
        self.assertEqual(block["parallelism"], 2.0)
        self.assertEqual(block["busy_seconds"], 100)
        self.assertEqual(block["wall_seconds"], 100_000)

    def test_produced_is_the_fanouts_own_count_not_a_second_one(self):
        fo = ag.fanout([span(0, 10, "a", tools=2), span(0, 10, "b", tools=0)], 10)
        self.assertEqual(rp.build(fanout=fo)["agents"]["produced"], fo.produced)

    def test_types_are_ranked_and_capped(self):
        """Every type the enum names, most common first; the spec's cap holds the list."""
        kinds = [*ag.BUILTIN_AGENT_TYPES, None, "k-made-up"]
        spans = [span(0, 10, f"a{i}", kind=kinds[i % len(kinds)]) for i in range(40)]
        by_type = rp.build(fanout=ag.fanout(spans, 10))["agents"]["by_type"]
        self.assertLessEqual(len(by_type), rp.MAX_AGENT_TYPES)
        self.assertEqual(sorted(t["name"] for t in by_type), sorted(ag.AGENT_TYPES))
        counts = [t["agents"] for t in by_type]
        self.assertEqual(counts, sorted(counts, reverse=True))
        self.assertEqual(sum(counts), 40)

    def test_a_custom_agents_name_never_travels(self):
        """FOUND IN REVIEW (2026-09-13): `by_type` carried the name an agent's author typed
        into `.claude/agents/<name>.md`, free text, into the uploaded report. MEASURED
        before the fix: `[{"name": "acme-payroll-migrator", "agents": 3}]`; after, two
        custom names and one built in read `[custom 2, general-purpose 1]`, and the spec's
        `agent_type` enum is `agents.AGENT_TYPES`, so the server refuses any other name."""
        spans = [
            span(0, 10, "a", kind="acme-payroll-migrator"),
            span(0, 10, "b", kind="zebra-release-bot"),
            span(0, 10, "c", kind="general-purpose"),
        ]
        block = rp.build(fanout=ag.fanout(spans, 10))["agents"]
        self.assertEqual(block["by_type"], [{"name": "custom", "agents": 2}, {"name": "general-purpose", "agents": 1}])
        self.assertNotIn("acme", json.dumps(block))
        self.assertEqual(SPEC["enums"]["agent_type"], list(ag.AGENT_TYPES))
        name = next(f for f in SPEC["objects"]["ReportAgentType"] if f["name"] == "name")
        self.assertEqual((name["type"], name["values"]), ("enum", "agent_type"))


class WhatMayTravel(unittest.TestCase):
    """The contract, checked where the document is BUILT.

    privacy/upload-contract.json is enforced by a hand-written serializer on the Swift
    side and by `extra='forbid'` here, but neither of those can tell a number from a
    sentence somebody typed. `analysis/playbook.py` holds prompt TEXT on purpose — that
    is what it prints on the machine — and `_prompting` is the only function that reads
    it and is also uploaded.
    """

    def test_the_prompting_block_is_five_numbers_and_no_words(self):
        names = {f["name"] for f in SPEC["objects"]["ReportPrompting"]}
        self.assertEqual(names, {"attempts", "clean", "costly", "clean_share", "reason"})

    def test_no_field_in_the_spec_carries_free_text_from_a_transcript(self):
        """Every string in this document comes from a fixed table in this repository: a
        metric key, a label from `trends.LABEL`, a subagent type the harness named, an
        ISO date, or a refusal reason a module wrote. A field that carried an excerpt
        would have to be added here deliberately, and this test is where somebody would
        have to argue for it."""
        allowed = {
            "metric", "label", "direction",  # ReportTrend
            "name",  # ReportAgentType and ReportLanguage: a subagent type, a language
            "day",  # ReportDay: an ISO date
            "reason",  # a refusal, written by a module in this package
            "trend_headline",  # trends.headline, from LABEL and two numbers
            "generated_at",
            # ReportCoverage: the first and last sitting, as timestamps. A clock reading
            # is not free text and cannot carry a word anybody typed — and the session
            # start and end times are already on the wire for every session, so these two
            # are a restatement of what the server has rather than anything new.
            "first_at",
            "last_at",
            # Version 2 (docs/overnight-integration.md 1.6). Every one of these is an ENUM
            # whose values are a fixed table in this repository, which the door checks:
            "id",  # a Wrapped card, a glossary term, a stack item (CARD_IDS, CATALOG, STACK)
            "value_id",  # a Wrapped answer that is an id: an archetype, a work style, a kind
            "unit",  # what a card's value counts, an identifier that is never rendered
            "basis",  # the rule a card or a price came from
            "commits_basis",  # how the shipped card counted commits
            "commit_refusal",  # why commit labels could not decide the kind of work card
            "lines_basis",  # what the money block's line counts were read from
            "kind",  # a commit kind, from wrapped.KINDS
            "role",  # a file role, from plain.ROLES: a path's shape, never the path
            "model",  # a row of pricing.PRICES
            "cause",  # a burn cause, from analysis/burn.py
            "category",  # a stack category
            "evidence",  # which kind of evidence put a stack item there
            # `metric` and `name` above are enums inside ReportArchetypeScore: an
            # archetype metric and an archetype, both from profile.ARCHETYPE_RULES.
            # And three CLOCKS, which cannot carry a word anybody typed:
            "started_at",  # when the longest session started; already on the wire per session
            "first_seen",  # when a glossary term or a stack item was first met
            "prices_read_on",  # the day the price table was read, from pricing.PRICES_READ_ON
            # Version 3, the projects block (docs/projects.md). Four more ENUMS from fixed
            # tables and one more CLOCK; a project itself travels as a `sha256hex` key, a
            # type this test does not count because no word can pass its pattern:
            "stage",  # projects.STAGES
            "stage_rule",  # projects.STAGE_RULES
            "language",  # a name languages.EXTENSIONS or BY_NAME gives an extension
            "harness",  # the upload contract's own harness enum
            "history_first_at",  # the earliest sitting on the machine, a clock
            # The projects block's week axis and each project's weeks on it: one more CLOCK,
            # a Monday as the local day at midnight UTC, the spelling a commit day has.
            "week",
        }
        strings = {
            f["name"]
            for fs in list(SPEC["objects"].values()) + [SPEC["fields"]]
            for f in fs
            if f["type"] in ("string", "enum", "datetime")
        }
        self.assertEqual(strings - allowed, set())

    def test_the_v2_blocks_carry_only_enums_numbers_and_clocks(self):
        """Inside wrapped, money, burn, vocab, stack and projects there is no string field
        at all.

        The v1 blocks carry a few bounded strings a module wrote (a refusal in words, a
        trend label). Versions 2 and 3 carry none: the phone renders every question,
        answer, sentence and refusal from ids and numbers (docs/overnight-engine.md rule
        5), so a `string` here could only be a sentence, a quote, a path or a repository
        name on its way off the machine, and the door would store it. Every `reason` is an
        enum code, and a project is its `sha256hex` key.
        """
        seen: set[str] = set()
        todo = [f["item"] for f in SPEC["fields"] if f["name"] in (*rp.V2_BLOCKS, *rp.V3_BLOCKS)]
        while todo:
            name = todo.pop()
            if name in seen:
                continue
            seen.add(name)
            for f in SPEC["objects"][name]:
                where = f"{name}.{f['name']}"
                self.assertNotEqual(f["type"], "string", f"{where} is free text")
                if f["type"] == "list":
                    # A list of strings would be free text by the back door.
                    self.assertIn(f["item"], SPEC["objects"], f"{where} is a list of scalars")
                if f["name"] == "reason":
                    self.assertEqual(f["type"], "enum", f"{where} is a refusal in words")
                if f["type"] in ("object", "list"):
                    todo.append(f["item"])
        # The walk reached every block and what they hold, not a subset of it.
        self.assertIn("ReportWrappedExtras", seen)
        self.assertIn("ReportArchetypeScore", seen)
        self.assertIn("ReportStackItem", seen)
        # The projects block, and the three version 1 objects it reuses (agents, their
        # types, the time to green), none of which carries a string either.
        self.assertIn("ReportProjectDay", seen)
        self.assertIn("ReportProjectComparison", seen)
        self.assertLessEqual({"ReportAgents", "ReportAgentType", "ReportGreen"}, seen)
        # And the two week objects the rivers and the rank race are drawn from.
        self.assertLessEqual({"ReportProjectsWeek", "ReportProjectWeek"}, seen)
        self.assertEqual(len(seen), 35)


class Caps(unittest.TestCase):
    def test_the_contributions_graph_drops_its_oldest_days_not_its_newest(self):
        """A graph missing last week is broken. One missing the same week two years ago
        is a graph."""
        import datetime as dt

        from analysis import contributions as co

        days = tuple(
            co.Day(day=dt.date(2020, 1, 1) + dt.timedelta(days=i), assisted=1, alone=0)
            for i in range(rp.MAX_DAYS + 40)
        )
        c = co.Contributions(
            days=days,
            assisted=len(days),
            alone=0,
            active_days=len(days),
            longest_streak=len(days),
            current_streak=0,
        )
        out = rp.build(contributions=c)["contributions"]["days"]
        self.assertEqual(len(out), rp.MAX_DAYS)
        self.assertEqual(out[-1]["day"], days[-1].day.isoformat())

    def test_trends_are_capped_at_what_the_spec_accepts(self):
        many = [trend(metric=f"m{i}") for i in range(rp.MAX_TRENDS + 10)]
        self.assertEqual(len(rp.build(trends=many)["trends"]), rp.MAX_TRENDS)


class OneDefinition(unittest.TestCase):
    def test_a_counted_session_is_defined_once(self):
        """`visible` on the wire IS `is_counted`, and it decides the population every
        aggregate runs over. It was written out twice, and the second copy drifting moved
        seven of this container's commits from "alone" to "assisted" in a report the phone
        would have shown beside a session list that did not contain those sittings."""
        from capture import sessions as cap

        self.assertTrue(callable(cap.is_counted))
        source = pathlib.Path(cap.__file__).read_text()
        self.assertEqual(source.count("COUNTED_MIN_ACTIVE_SEC"), 2)  # the import and the rule


if __name__ == "__main__":
    unittest.main()
