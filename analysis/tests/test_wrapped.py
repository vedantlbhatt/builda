"""The fifteen wrapped cards: every answer computable by hand, every refusal with a reason.

The corpus here is built in memory, one `Sitting` at a time, through
`profile.session_fact_from_events` (the same builder `__main__._corpus_facts` uses), so a
fixture can never drift from the code that reads it and the real corpus stays out of git.
Sentinel words are planted in prompts (`zebracorn`), paths (`zebrapath`) and commit subjects
(`zebrasubject`) so the privacy split can be checked by searching for them.

`run()` is the only way a test builds a result, and it checks the house rules on every one:
twelve keys a card, the refusal shape (a code exactly when there is a reason), a digit in every answered sentence, and no dash in any
string the module wrote. So every scenario below is also a dash test and a digit test.
"""

from __future__ import annotations

import copy
import dataclasses
import datetime as dt
import json
import pathlib
import unittest

from analysis import agents as ag
from analysis import contributions as co
from analysis import patterns as pat
from analysis import plain
from analysis import profile as pf
from analysis import wrapped as wr
from analysis.digest import Ev

# The corpus builder lives in `corpus_fixture.py` (it is also what `scripts/gen_copy.py`
# renders the phone's card fixtures from); every name is re-exported here, so the other
# suites that build on this one (`test_cli.py` reads `tw.corpus`) are unchanged.
from analysis.tests.corpus_fixture import (  # noqa: F401
    D0,
    DAY,
    RICH_COMMITS,
    RICH_SUBJECTS,
    SENTINELS,
    Sitting,
    T0,
    attended_trio,
    contributions_on,
    corpus,
    day,
    fan,
    rich,
    rich_kw,
)


# ------------------------------------------------------------------ the house rules
def _strings(obj):
    if isinstance(obj, str):
        yield obj
    elif isinstance(obj, dict):
        for k, v in obj.items():
            yield str(k)
            yield from _strings(v)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            yield from _strings(v)


def check_house_rules(tc: unittest.TestCase, result: dict) -> None:
    tc.assertEqual(set(result), {"cards", "quotes", "sample"})
    tc.assertEqual([c["id"] for c in result["cards"]], list(wr.CARD_IDS))
    for c in result["cards"]:
        tc.assertEqual(tuple(c), wr.CARD_KEYS, c["id"])
        tc.assertIsInstance(c["extras"], dict, c["id"])
        tc.assertIsInstance(c["n"], int, c["id"])
        tc.assertIsInstance(c["basis"], str, c["id"])
        tc.assertEqual(c["question"], wr.QUESTIONS[c["id"]])
        if c["reason"] is None:
            tc.assertIsNotNone(c["value"], c["id"])
            tc.assertIsInstance(c["display"], str, c["id"])
            tc.assertIsInstance(c["sentence"], str, c["id"])
            tc.assertRegex(c["sentence"], r"\d", f"{c['id']}: {c['sentence']!r} has no digit")
        else:
            tc.assertIsInstance(c["reason"], str, c["id"])
            tc.assertTrue(c["reason"].strip(), c["id"])
            tc.assertIsNone(c["value"], c["id"])
            tc.assertIsNone(c["display"], c["id"])
            tc.assertIsNone(c["sentence"], c["id"])
        # A code exactly when there is a reason, and the reason IS the code's template
        # filled from the card's own numbers, so the phone words it the same way.
        tc.assertEqual(c["code"] is None, c["reason"] is None, c["id"])
        if c["code"] is not None:
            tc.assertIn(c["code"], wr.REFUSALS, c["id"])
            tc.assertEqual(
                c["reason"],
                wr.refusal_text(c["code"], n=c["n"], needed=c["needed"], extras=c["extras"]),
                c["id"],
            )
        else:
            tc.assertIsNone(c["needed"], c["id"])
        # Every string the module wrote. Quotes are the person's own words and exempt, as
        # `prompt_excerpt` is (docs/analysis.md), so they are not walked here.
        for s in _strings(
            {k: c[k] for k in ("question", "display", "sentence", "reason", "extras")}
        ):
            tc.assertFalse(plain.has_dash(s), f"{c['id']}: {s!r}")
    for s in _strings(result["sample"]):
        tc.assertFalse(plain.has_dash(s), s)


class WrappedCase(unittest.TestCase):
    def run_wrapped(self, *sittings: Sitting, **kw) -> dict:
        facts, sessions = corpus(*sittings)
        result = wr.wrapped(facts, sessions, **kw)
        check_house_rules(self, result)
        return result

    def card(self, *sittings: Sitting, cid: str, **kw) -> dict:
        return by_id(self.run_wrapped(*sittings, **kw), cid)


def by_id(result: dict, cid: str) -> dict:
    return next(c for c in result["cards"] if c["id"] == cid)


# =================================================================== the shape
class Shape(WrappedCase):
    def test_fifteen_ids_in_the_briefs_order(self):
        self.assertEqual(
            wr.CARD_IDS,
            (
                "builder_type",
                "shipped",
                "work_style",
                "longest_session",
                "agents_at_once",
                "go_to_prompt",
                "streak",
                "change_course",
                "crash_out",
                "prompt_length",
                "deep_sessions",
                "time_put_in",
                "cryptic_prompt",
                "prompts_per_session",
                "kind_of_work",
            ),
        )
        self.assertEqual(len(set(wr.CARD_IDS)), 15)

    def test_the_questions_are_the_briefs(self):
        self.assertEqual(tuple(wr.QUESTIONS), wr.CARD_IDS)
        self.assertEqual(wr.QUESTIONS["builder_type"], "Which kind of builder are you?")
        # A hyphen inside a word is not a dash (`plain.DASH`): Paxel's own "go-to".
        self.assertEqual(wr.QUESTIONS["go_to_prompt"], "What's your go-to prompt?")
        self.assertFalse(plain.has_dash(wr.QUESTIONS["go_to_prompt"]))
        self.assertEqual(wr.QUESTIONS["deep_sessions"], "How do you work?")
        self.assertEqual(wr.QUESTIONS["prompts_per_session"], "How much do you talk to your agent?")
        self.assertEqual(wr.QUESTIONS["kind_of_work"], "What kind of work is it?")

    def test_the_card_keys(self):
        self.assertEqual(
            wr.CARD_KEYS,
            (
                "id",
                "question",
                "value",
                "unit",
                "display",
                "sentence",
                "basis",
                "n",
                "needed",
                "reason",
                "code",
                "extras",
            ),
        )

    def test_the_rich_corpus_answers_every_card(self):
        result = self.run_wrapped(*rich(), **rich_kw())
        refused = {c["id"]: c["reason"] for c in result["cards"] if c["reason"]}
        self.assertEqual(refused, {})

    def test_the_sample(self):
        result = self.run_wrapped(*rich(), **rich_kw())
        s = result["sample"]
        self.assertEqual(set(s), set(wr.SAMPLE_KEYS) | {"attended_sessions"})
        self.assertEqual(s["sessions"], 4)
        self.assertEqual(s["attended_sessions"], 3)
        self.assertEqual(s["prompts_with_text"], 9)
        self.assertEqual(s["active_hours"], 4.75)
        self.assertEqual(s["days"], 4)
        self.assertEqual(s["spans_days"], 4)
        self.assertEqual(s["first_at"], "2026-09-01T15:00:00Z")

    def test_facts_and_sessions_must_be_parallel(self):
        facts, sessions = corpus(*rich())
        with self.assertRaises(ValueError):
            wr.wrapped(facts, sessions[:-1])
        with self.assertRaises(ValueError):
            wr.wrapped(facts, list(reversed(sessions)))

    def test_a_profile_passed_in_is_the_one_used(self):
        facts, sessions = corpus(*rich())
        P = pf.corpus_profile(facts)
        P["totals"]["total_hours"] = 99.5
        card = by_id(wr.wrapped(facts, sessions, profile=P), "time_put_in")
        self.assertEqual(card["value"], 99.5)


class TheRichCorpusByHand(WrappedCase):
    """Every card over `rich()`, against the counts in its docstring."""

    @classmethod
    def setUpClass(cls):
        facts, sessions = corpus(*rich())
        cls.result = wr.wrapped(facts, sessions, quotes=True, **rich_kw())

    def c(self, cid):
        return by_id(self.result, cid)

    def test_house_rules(self):
        check_house_rules(self, self.result)

    def test_builder_type_is_director(self):
        c = self.c("builder_type")
        self.assertEqual((c["value"], c["display"]), ("director", "Director"))
        self.assertEqual(c["sentence"], "60% of your build time runs without you.")
        self.assertEqual(c["extras"]["metric"], "autonomy_score")
        self.assertEqual(c["extras"]["metric_value"], 0.596)  # 10200 / 17100
        self.assertIsNone(c["extras"]["closest"])
        self.assertEqual(c["n"], 4)

    def test_shipped(self):
        c = self.c("shipped")
        self.assertEqual(c["value"], 285)
        self.assertEqual(c["display"], "285 lines written, 6 commits")
        # What `contributions.split` counts: a commit in a session's window or in the
        # lookback before it, never "while an agent was working" (FOUND IN REVIEW).
        self.assertEqual(c["sentence"], "3 of those commits landed during a session or in the 30 minutes before one.")
        self.assertEqual(c["extras"], {"commits": 6, "assisted": 3, "alone": 3})
        self.assertEqual(
            c["basis"], "project_edit_tools_and_credited_shell_writes+git_log_distinct_commits"
        )

    def test_work_style_hands_it_off(self):
        c = self.c("work_style")
        self.assertEqual((c["value"], c["display"]), ("hand_off", "You hand it off."))
        self.assertEqual(c["sentence"], "60% of your build time runs without you.")
        self.assertEqual(
            c["extras"], {"autonomy": 0.596, "median_prompts": 2.0, "steer_rate": 0.222}
        )
        self.assertEqual(c["n"], 3)

    def test_longest_session(self):
        c = self.c("longest_session")
        self.assertEqual(c["value"], 3900)
        self.assertEqual(c["display"], "1h 05m")
        self.assertEqual(c["sentence"], "The longest of 3 sessions with you there.")
        self.assertEqual(
            c["extras"], {"active_seconds": 4500, "started_at": "2026-09-01T15:00:00Z"}
        )

    def test_agents_at_once(self):
        c = self.c("agents_at_once")
        self.assertEqual((c["value"], c["display"]), (1, "1 session at once"))
        self.assertEqual(c["sentence"], "Counted from first action to last across 4 sessions.")
        self.assertEqual(c["extras"], {"subagents_peak": None, "subagents": None})

    def test_go_to_prompt(self):
        c = self.c("go_to_prompt")
        self.assertEqual(c["value"], 3)
        self.assertEqual(c["display"], "Sent 3 times across 3 sessions")
        self.assertEqual(c["sentence"], "3 words you keep coming back to.")
        self.assertEqual(c["extras"], {"sessions": 3, "words": 3})
        self.assertEqual(c["n"], 8)
        q = self.result["quotes"]["go_to_prompt"]
        self.assertEqual(
            q, {"text": "run zebracorn tests", "session_id": "c", "ts": T0 + 2 * DAY, "seconds_in": 0}
        )

    def test_streak(self):
        c = self.c("streak")
        self.assertEqual((c["value"], c["display"]), (2, "2 days straight"))
        self.assertEqual(c["sentence"], "2 days in all had a commit and a session with you there.")
        self.assertEqual(c["extras"], {"commit_days": 3, "attended_days": 3, "both_days": 2})

    def test_change_course(self):
        c = self.c("change_course")
        self.assertEqual(c["value"], 0.222)  # (1 interrupt + 1 correction) / 9
        self.assertEqual(c["display"], "22% of the time")
        self.assertEqual(c["sentence"], "1 interrupt and 1 correction across 9 prompts.")
        self.assertEqual(c["extras"], {"interrupts": 1, "corrective_prompts": 1})

    def test_crash_out(self):
        c = self.c("crash_out")
        # 3 profanity + 2 x 3 shouted words + 2 for `???` + 1 marker (exasperation)
        self.assertEqual(c["value"], 12)
        # A fact, never a label: the day and time it was sent (T0 + 60 s, a Tuesday).
        self.assertEqual(c["display"], "A Tuesday, at 3:01pm")
        self.assertEqual(c["sentence"], "Sent 1 minute into that session. We have all been there.")
        self.assertEqual(
            c["extras"]["parts"],
            {"profanity": 1, "caps_words": 3, "bang_runs": 1, "markers": 1, "stretches": 0},
        )
        self.assertEqual(self.result["quotes"]["crash_out"]["session_id"], "a")

    def test_prompt_length(self):
        c = self.c("prompt_length")
        # words 3, 7, 5, 2, 3, 3, 13, 3: mean 39 / 8, median of the middle two 3s
        self.assertEqual(c["value"], 4.9)
        self.assertEqual(c["display"], "4.9 words on average")
        self.assertEqual(c["sentence"], "Mostly terse. Half of them run 3 words or fewer.")
        self.assertEqual(c["extras"], {"median": 3.0})

    def test_deep_sessions(self):
        c = self.c("deep_sessions")
        self.assertEqual((c["value"], c["display"]), (1, "1 deep session"))
        # One deep session is not an average (FOUND IN REVIEW).
        self.assertEqual(c["sentence"], "It ran 65 minutes with you there.")
        self.assertEqual(c["extras"], {"avg_minutes": 65, "longest_minutes": 65})

    def test_time_put_in(self):
        c = self.c("time_put_in")
        self.assertEqual(c["value"], 4.75)
        self.assertEqual(c["display"], "4.8 hours across 4 sessions")
        self.assertEqual(c["sentence"], "1.9 of those hours with you there.")
        self.assertEqual(c["extras"], {"attended_hours": 1.9, "attended_overlap_hours": 0.0})

    def test_cryptic_prompt(self):
        c = self.c("cryptic_prompt")
        self.assertEqual(c["value"], 0.53)  # 10 of 19 token characters
        self.assertEqual(c["display"], "A prompt of 20 characters")
        self.assertEqual(c["sentence"], "Somehow the agent knew. 3 tool calls followed.")
        self.assertEqual(c["n"], 8)

    def test_prompts_per_session(self):
        c = self.c("prompts_per_session")
        self.assertEqual(c["value"], 3.0)
        self.assertEqual(c["display"], "3 prompts a session")
        # 14 tool calls in the three attended sessions over their 9 prompts. The profile's
        # 1.8 counts the unattended run's 2 calls over prompts it never had (FOUND IN
        # REVIEW: 12.1 against 11.4 on the corpus).
        self.assertEqual(c["sentence"], "1.6 tool calls for every prompt you send.")
        self.assertEqual(c["extras"], {"median": 2.0, "tool_calls_per_prompt": 1.6})

    def test_kind_of_work_on_commit_labels(self):
        c = self.c("kind_of_work")
        self.assertEqual((c["value"], c["basis"]), ("fix", "commit_subject_labels"))
        self.assertEqual(c["display"], "Mostly fixes.")
        self.assertEqual(c["sentence"], "12 fixes and 9 features in 35 commits.")
        self.assertEqual(c["n"], 21)
        self.assertEqual(c["extras"]["counts"], {"feature": 9, "fix": 12})
        self.assertEqual(c["extras"]["coverage"], 0.6)
        self.assertEqual(c["extras"]["role_lines"], {"test": 40, "source": 225, "docs": 20})
        self.assertIsNone(c["extras"]["commit_reason"])


# =================================================================== refusals
class Refusals(WrappedCase):
    def test_an_empty_corpus_refuses_every_card_with_a_reason(self):
        result = self.run_wrapped()
        for c in result["cards"]:
            self.assertIsNotNone(c["reason"], c["id"])
        reasons = {c["id"]: c["reason"] for c in result["cards"]}
        self.assertEqual(reasons["builder_type"], "fewer than 3 sessions")
        self.assertEqual(reasons["shipped"], "no sessions")
        self.assertEqual(reasons["work_style"], "0 sessions with you there, 3 needed")
        self.assertEqual(reasons["agents_at_once"], "no sessions")
        self.assertEqual(reasons["time_put_in"], "no sessions")
        self.assertEqual(reasons["prompt_length"], "0 prompts typed in your own words, 5 needed")
        self.assertEqual(
            reasons["kind_of_work"],
            "no commit subjects were read; 0 attributable lines, 200 needed",
        )
        self.assertEqual(result["quotes"], {})

    def test_the_attended_floor_is_one_sentence_on_three_cards(self):
        two = attended_trio()[:2] + [
            Sitting("u", T0 + 5 * DAY, attended=0.0, autonomous=900.0, unattended=True).tool(0)
        ]
        result = self.run_wrapped(*two)
        for cid in ("work_style", "deep_sessions", "prompts_per_session"):
            self.assertEqual(
                by_id(result, cid)["reason"], "2 sessions with you there, 3 needed"
            )
            self.assertEqual(by_id(result, cid)["n"], 2)

    def test_one_attended_session_is_singular(self):
        result = self.run_wrapped(attended_trio()[0])
        self.assertEqual(
            by_id(result, "work_style")["reason"], "1 session with you there, 3 needed"
        )


# =================================================================== 1 builder_type
def with_archetype(facts, **metric_values) -> dict:
    """A real profile whose archetype is `profile.archetype` over the given metric values."""
    P = copy.deepcopy(pf.corpus_profile(facts))
    metrics = {r["metric"]: {"value": metric_values.get(r["metric"])} for r in pf.ARCHETYPE_RULES}
    P["archetype"] = pf.archetype(metrics, P["sample"])
    return P


class BuilderType(WrappedCase):
    def c(self, **values):
        facts, sessions = corpus(*attended_trio())
        result = wr.wrapped(facts, sessions, profile=with_archetype(facts, **values))
        check_house_rules(self, result)
        return by_id(result, "builder_type")

    def test_each_winner_has_its_sentence(self):
        cases = {
            "planning_ratio": (
                3.0,
                "architect",
                "Architect",
                "3 prompts get a plan for every one that goes straight to work.",
            ),
            "code_velocity": (
                600.0,
                "velocity_machine",
                "Velocity machine",
                "600 lines an hour while the agent runs.",
            ),
            # The profile's test rate is a floor (its basis says so), and so is the sentence.
            "test_runs_per_hour": (
                3.2,
                "quality_guardian",
                "Quality guardian",
                "At least 3.2 test runs an hour, at least one every 19 minutes.",
            ),
            "night_share": (
                0.45,
                "night_owl",
                "Night owl",
                "45% of your build time lands between 10pm and 4am.",
            ),
            "autonomy_score": (
                0.62,
                "director",
                "Director",
                "62% of your build time runs without you.",
            ),
            "steer_rate": (
                0.43,
                "skeptic",
                "Skeptic",
                "4 in 10 prompts stop or redirect the agent.",
            ),
        }
        facts, _ = corpus(*attended_trio())
        bases = {m: b["basis"] for m, b in pf.corpus_profile(facts)["metrics"].items()}
        for metric, (v, name, display, sentence) in cases.items():
            with self.subTest(metric=metric):
                c = self.c(**{metric: v})
                self.assertEqual(
                    (c["value"], c["display"], c["sentence"]), (name, display, sentence)
                )
                self.assertEqual((c["extras"]["metric"], c["extras"]["metric_value"]), (metric, v))
                self.assertEqual(c["extras"]["metric_basis"], bases[metric])
                self.assertEqual(c["basis"], "archetype_rules")
                self.assertEqual(c["unit"], "archetype")

    def test_a_rate_that_rounds_to_a_whole_number_carries_no_trailing_zero(self):
        """FOUND IN REVIEW: `profile._n` checked for a whole number before rounding, so
        4.96 printed "At least 5.0 test runs an hour"."""
        self.assertEqual(
            wr._archetype_sentence("quality_guardian", 4.96, at_least=True),
            "At least 5 test runs an hour, at least one every 12 minutes.",
        )
        self.assertEqual(
            wr._archetype_sentence("architect", 2.96),
            "3 prompts get a plan for every one that goes straight to work.",
        )

    def test_a_fast_tester_is_at_least_one_a_minute_or_more(self):
        self.assertEqual(
            self.c(test_runs_per_hour=60.0)["sentence"],
            "At least 60 test runs an hour, at least one a minute.",
        )
        self.assertEqual(
            self.c(test_runs_per_hour=200.0)["sentence"],
            "At least 200 test runs an hour, more than one a minute.",
        )

    def test_a_test_rate_floor_is_said_as_a_floor(self):
        """GROUND TRUTH, 2026-09-13, `~/.builder-overnight/corpus` (156 counted sessions).

        The card said "4.7 test runs an hour, about one every 13 minutes" from
        `test_runs_per_hour` 4.72, whose basis is `test_commands_in_the_digest_lower_bound`.
        Recounted from the raw transcripts: 829 Bash commands run a test (the
        `quality.TEST_CMD` pattern over the full command) against 420 whose first 160
        characters show one, which is all the digest keeps. The true rate is about 9.7 an
        hour, one every 6 minutes, so the card's number is a floor and must say so.
        """
        c = self.c(test_runs_per_hour=4.72)
        self.assertEqual(c["extras"]["metric_basis"], pf.TEST_RUNS_LOWER_BOUND)
        self.assertEqual(
            c["sentence"], "At least 4.7 test runs an hour, at least one every 13 minutes."
        )
        # The same number under a basis that is not a floor keeps the plain sentence.
        facts, sessions = corpus(*attended_trio())
        P = with_archetype(facts, test_runs_per_hour=4.72)
        P["metrics"]["test_runs_per_hour"]["basis"] = "test_commands_read_in_full"
        c = by_id(wr.wrapped(facts, sessions, profile=P), "builder_type")
        self.assertEqual(c["sentence"], "4.7 test runs an hour, about one every 13 minutes.")
        self.assertEqual(c["extras"]["metric_basis"], "test_commands_read_in_full")

    def test_every_floor_the_profile_labels_ends_with_the_suffix(self):
        # The card reads the metric's own label, so the label has to keep this shape.
        for basis in (pf.TEST_RUNS_LOWER_BOUND, pf.COMMITS_TOOL_CALLS):
            with self.subTest(basis=basis):
                self.assertTrue(wr._is_lower_bound(basis))
        for basis in (pf.COMMITS_GIT_LOG, pf.LINES_ABSENT, None, ""):
            with self.subTest(basis=basis):
                self.assertFalse(wr._is_lower_bound(basis))

    def test_the_generalist_names_its_closest_rule(self):
        # planning 1.2 / 2.4 scores 0.25, tests 2.4 / 3.0 scores 0.4: nothing met its bar.
        # The test rate is a floor, so the share of the way there is one too.
        c = self.c(planning_ratio=1.2, test_runs_per_hour=2.4)
        self.assertEqual((c["value"], c["display"]), ("generalist", "Generalist"))
        self.assertEqual(
            c["sentence"],
            "No single pattern dominates. Closest is Quality guardian, at least 80% of the way "
            "there.",
        )
        self.assertEqual(
            c["extras"]["closest"],
            {
                "name": "quality_guardian",
                "metric": "test_runs_per_hour",
                "value": 2.4,
                "threshold": 3.0,
                "score": 0.4,
            },
        )
        self.assertEqual(c["extras"]["metric_basis"], pf.TEST_RUNS_LOWER_BOUND)
        self.assertIsNone(c["reason"])

    def test_the_generalists_closest_ties_by_name(self):
        c = self.c(night_share=0.28, steer_rate=0.28)  # both score 0.35
        self.assertEqual(c["extras"]["closest"]["name"], "night_owl")
        self.assertIn("Closest is Night owl, 70% of the way there.", c["sentence"])

    def test_nearly_there_never_reads_as_all_the_way(self):
        # 0.3985 / 0.4 is 99.6%, which rounds to 100 on a card that says nothing dominates.
        c = self.c(steer_rate=0.3985)
        self.assertEqual(c["value"], "generalist")
        self.assertIn("99% of the way there", c["sentence"])

    def test_every_score_null_refuses(self):
        c = self.c()
        self.assertEqual(c["reason"], "none of the six archetype metrics could be computed")

    def test_below_min_sessions_it_is_the_archetypes_own_reason(self):
        c = self.card(*attended_trio()[:2], cid="builder_type")
        self.assertEqual(c["reason"], "fewer than 3 sessions")


# =================================================================== 2 shipped
class Shipped(WrappedCase):
    def test_without_contributions_it_counts_lines_alone(self):
        c = self.card(*rich(), cid="shipped")
        self.assertEqual(c["display"], "285 lines")
        self.assertEqual(c["sentence"], "Counted across 4 sessions from edits and shell writes.")
        self.assertEqual(c["extras"], {"commits": None, "assisted": None, "alone": None})
        self.assertEqual(c["basis"], "project_edit_tools_and_credited_shell_writes")

    def test_commits_are_distinct_shas_never_the_profile_sum(self):
        facts, sessions = corpus(*rich())
        P = pf.corpus_profile(facts)
        P["totals"]["total_commits"] = 999
        c = by_id(wr.wrapped(facts, sessions, profile=P, **rich_kw()), "shipped")
        self.assertEqual(c["display"], "285 lines written, 6 commits")

    def test_zero_lines_refuses_rather_than_saying_you_wrote_nothing(self):
        c = self.card(*attended_trio(), cid="shipped")
        # What was counted, in the profile's own words: never a cause nobody measured.
        self.assertEqual(c["reason"], pf.no_lines_reason(3))
        self.assertEqual(
            c["reason"],
            "none of the 3 sessions has a line the agent wrote into a project file that can "
            "be counted, and 0 would read as nothing written",
        )
        self.assertEqual(c["n"], 3)
        facts, _ = corpus(*attended_trio())
        self.assertEqual(pf.corpus_profile(facts)["metrics"]["code_velocity"]["reason"], c["reason"])

    def test_lines_in_claude_codes_own_files_are_not_shipped(self):
        """FOUND IN REVIEW, MEASURED on the corpus: 13,663 of the card's 64,747 lines were
        written into Claude Code's scratchpad and memory notes (an absolute path under its
        state, or a relative heredoc after `cd` into it), and 907 more were a resumed
        transcript's copies. Neither shipped."""
        scratch = "/private/tmp/claude-501/-repo/8f7c2a4e-0000-4000-8000-000000000001/scratchpad"
        s = (
            Sitting("s")
            .prompt(0, "go")
            .edit(5, "/r/app.py", 10)
            .edit(6, f"{scratch}/probe.py", 40)
            .edit(7, "/Users/me/.claude/projects/-r/memory/notes.md", 30)
            .tool(8, f"cd {scratch} && cat > part.html <<'EOF'", added=50, removed=0, path="part.html")
        )
        c = self.card(s, cid="shipped")
        self.assertEqual((c["value"], c["display"]), (10, "10 lines"))
        kind = self.card(s, cid="kind_of_work")
        self.assertEqual(kind["extras"]["role_lines"], {"source": 10})

    def test_one_line_and_one_commit_are_singular(self):
        s = Sitting("s").prompt(0, "go").edit(5, "/r/a.py", 1)
        c = self.card(s, cid="shipped", contributions=contributions_on({day(0): (1, 0)}))
        self.assertEqual(c["display"], "1 line written, 1 commit")


# =================================================================== 3 work_style
class WorkStyle(WrappedCase):
    def test_dialogue(self):
        c = self.card(*attended_trio((5, 6, 7)), cid="work_style")
        self.assertEqual((c["value"], c["display"]), ("dialogue", "A back and forth."))
        self.assertEqual(c["sentence"], "You work in dialogue, 6 prompts a session.")
        self.assertEqual(c["extras"]["autonomy"], 0.0)

    def steering_trio(self):
        out = []
        for i in range(3):
            out.append(
                Sitting(f"s{i}", T0 + i * DAY)
                .prompt(0, "add a login page")
                .tool(10)
                .interrupt(20)
                .prompt(30, "use the blue button")
                .tool(40)
            )
        return out

    def test_steering(self):
        # 3 interrupts over 6 prompts; the redirects typed after them are the same act.
        c = self.card(*self.steering_trio(), cid="work_style")
        self.assertEqual((c["value"], c["display"]), ("steering", "Hands on the wheel."))
        self.assertEqual(c["sentence"], "5 in 10 prompts stop or redirect it.")

    def test_in_ten_rounds_half_up_the_way_the_percentage_does(self):
        """`round(0.45 * 10)` is 4, half to even, beside a "45%" card; 0.55 and 0.65 both
        read 6 (FOUND IN REVIEW). One rule for every "in 10": `profile.in_ten`."""
        self.assertEqual([pf.in_ten(v) for v in (0.44, 0.45, 0.55, 0.65, 0.05, 0.0, 1.0)], [4, 5, 6, 7, 1, 0, 10])

    def test_one_shot(self):
        c = self.card(*attended_trio(), cid="work_style")
        self.assertEqual((c["value"], c["display"]), ("one_shot", "Short and direct."))
        self.assertEqual(c["sentence"], "2 prompts a session, then it runs.")

    def test_a_rule_whose_metric_is_none_is_skipped_not_read_as_zero(self):
        facts, sessions = corpus(*self.steering_trio())
        P = pf.corpus_profile(facts)
        P["metrics"]["autonomy_score"]["value"] = None
        self.assertEqual(
            by_id(wr.wrapped(facts, sessions, profile=P), "work_style")["value"], "steering"
        )
        P["metrics"]["steer_rate"].update(value=None, reason="prompt text is not stored here")
        result = wr.wrapped(facts, sessions, profile=P)
        c = by_id(result, "work_style")
        self.assertEqual(c["value"], "one_shot")
        self.assertEqual(c["extras"], {"autonomy": None, "median_prompts": 2.0, "steer_rate": None})
        # Worded from the card's own code, never the profile's words, which are written
        # for the server too ("not stored server side" is false on this machine).
        cc = by_id(result, "change_course")
        self.assertEqual(cc["code"], "no_prompt_text")
        self.assertEqual(cc["reason"], "no prompt carried text or an interrupt count to read")

    def test_a_refusal_with_no_reason_is_a_crash_not_a_silent_card(self):
        facts, sessions = corpus(*self.steering_trio())
        P = pf.corpus_profile(facts)
        P["metrics"]["steer_rate"].update(value=None, reason=None)
        with self.assertRaises(ValueError):
            wr.wrapped(facts, sessions, profile=P)

    def test_the_thresholds_are_read_from_the_archetype_rules(self):
        self.assertEqual(wr._rule_threshold("director"), 0.5)
        self.assertEqual(wr._rule_threshold("skeptic"), 0.4)


# =================================================================== 4 longest_session
class LongestSession(WrappedCase):
    def test_attended_time_decides_the_record(self):
        c = self.card(
            Sitting("a", T0, attended=3000.0).prompt(0, "go"),
            Sitting("b", T0 + DAY, attended=5000.0).prompt(0, "go"),
            Sitting("robot", T0 + 2 * DAY, attended=0.0, autonomous=20000.0, unattended=True).tool(
                0
            ),
            cid="longest_session",
        )
        self.assertEqual(c["value"], 5000)
        self.assertEqual(c["display"], "1h 23m")
        self.assertEqual(c["sentence"], "The longest of 2 sessions with you there.")
        self.assertEqual(c["n"], 2)

    def test_one_session_is_not_the_longest_of_one(self):
        c = self.card(Sitting("a", T0, attended=3000.0).prompt(0, "go"), cid="longest_session")
        self.assertEqual(c["sentence"], "Counted over 1 session with you there.")

    def test_only_unattended_runs_refuse(self):
        c = self.card(
            Sitting("robot", T0, attended=0.0, autonomous=20000.0, unattended=True).tool(0),
            cid="longest_session",
        )
        self.assertEqual(
            c["reason"], "no session had you present, and an unattended run cannot hold a record"
        )


# =================================================================== 5 agents_at_once
class AgentsAtOnce(WrappedCase):
    def test_overlapping_sessions(self):
        c = self.card(
            Sitting("a", T0).tool(0).tool(1000),
            Sitting("b", T0 + 500).tool(0).tool(1000),
            Sitting("c", T0 + 2000).tool(0).tool(1000),
            cid="agents_at_once",
        )
        self.assertEqual((c["value"], c["display"]), (2, "2 sessions at once"))
        self.assertEqual(c["sentence"], "Counted from first action to last across 3 sessions.")

    def test_idle_credit_never_creates_concurrency(self):
        # A's window runs to +5000 on trailing idle credit; its last event is at +1000.
        a = Sitting("a", T0, end=T0 + 5000).tool(0).tool(1000)
        b = Sitting("b", T0 + 2000).tool(0).tool(1000)
        self.assertLess(b.start, a.end)
        self.assertEqual(self.card(a, b, cid="agents_at_once")["value"], 1)

    def test_a_handoff_at_one_instant_is_not_two_at_once(self):
        c = self.card(
            Sitting("a", T0).tool(0).tool(1000),
            Sitting("b", T0 + 1000).tool(0).tool(1000),
            cid="agents_at_once",
        )
        self.assertEqual(c["value"], 1)

    def test_a_session_too_short_to_overlap_still_ran(self):
        c = self.card(Sitting("a", T0).tool(0), cid="agents_at_once")
        self.assertEqual((c["value"], c["n"]), (1, 1))

    def test_helper_agents_from_the_fanout(self):
        kw = {"fanout": fan(4, 7)}
        c = self.card(*rich(), cid="agents_at_once", **kw)
        # The rich corpus's sittings are a day apart: one at once, so not "inside them".
        self.assertEqual((c["display"], c["sentence"]), ("1 session at once", "Up to 4 helper agents ran at the same moment."))
        both = self.card(
            Sitting("a", T0, attended=1800.0).prompt(0, "go").tool(1000),
            Sitting("b", T0 + 500, attended=1800.0).prompt(0, "go").tool(1000),
            cid="agents_at_once",
            **kw,
        )
        self.assertEqual(
            (both["display"], both["sentence"]),
            ("2 sessions at once", "Inside them, up to 4 helper agents ran at the same moment."),
        )
        self.assertEqual(c["extras"], {"subagents_peak": 4, "subagents": 7})
        c = self.card(*rich(), cid="agents_at_once", fanout=fan(1, 1))
        self.assertEqual(c["sentence"], "Counted from first action to last across 4 sessions.")
        self.assertEqual(c["extras"], {"subagents_peak": 1, "subagents": 1})

    def test_peak_concurrency_is_the_fanout_sweep(self):
        self.assertEqual(ag.peak_concurrency([]), (0, 0.0))
        self.assertEqual(ag.peak_concurrency([(0, 10), (5, 15), (20, 21)]), (2, 15.0))
        self.assertEqual(ag.peak_concurrency([(0, 10), (10, 20)]), (1, 20.0))


# =================================================================== 6 go_to_prompt
class GoToPrompt(WrappedCase):
    def test_a_prompt_repeated_inside_one_session_is_not_a_go_to_prompt(self):
        s = Sitting("a")
        for i in range(5):
            s.prompt(10 * i, "commit it")
        c = self.card(s, Sitting("b", T0 + DAY).prompt(0, "something else"), cid="go_to_prompt")
        self.assertEqual(c["reason"], "no prompt was sent in more than one session")
        self.assertEqual(c["n"], 6)

    def test_normalisation(self):
        c = self.card(
            Sitting("a").prompt(0, "Run the tests!"),
            Sitting("b", T0 + DAY).prompt(0, "run   the TESTS"),
            cid="go_to_prompt",
        )
        self.assertEqual((c["value"], c["display"]), (2, "Sent 2 times across 2 sessions"))

    def test_more_sessions_beats_more_sends(self):
        a, b, c3 = Sitting("a"), Sitting("b", T0 + DAY), Sitting("c", T0 + 2 * DAY)
        for s in (a, b, c3):
            s.prompt(0, "ship it")
        for _ in range(3):
            a.prompt(100 + _, "keep going please")
            b.prompt(100 + _, "keep going please")
        card = self.card(a, b, c3, cid="go_to_prompt")
        self.assertEqual(card["extras"], {"sessions": 3, "words": 2})
        self.assertEqual(card["value"], 3)

    def test_then_more_sends_then_more_words_then_first_use(self):
        a, b = Sitting("a"), Sitting("b", T0 + DAY)
        # X: 2 sessions, 3 sends. Y: 2 sessions, 2 sends, more words.
        a.prompt(0, "go").prompt(5, "go")
        b.prompt(0, "go")
        a.prompt(10, "please run the whole suite")
        b.prompt(10, "please run the whole suite")
        self.assertEqual(self.card(a, b, cid="go_to_prompt")["extras"], {"sessions": 2, "words": 1})

        a, b = Sitting("a"), Sitting("b", T0 + DAY)
        a.prompt(0, "go").prompt(10, "please run the whole suite")
        b.prompt(0, "go").prompt(10, "please run the whole suite")
        self.assertEqual(self.card(a, b, cid="go_to_prompt")["extras"], {"sessions": 2, "words": 5})

        a, b = Sitting("a"), Sitting("b", T0 + DAY)
        a.prompt(0, "check the logs").prompt(10, "ship the build")
        b.prompt(0, "ship the build").prompt(10, "check the logs")
        result = self.run_wrapped(a, b, quotes=True)
        # Equal on sessions, sends and words; "check the logs" was used first (T0 + 0).
        self.assertEqual(result["quotes"]["go_to_prompt"]["text"], "check the logs")

    def test_the_quote_is_the_most_recent_original(self):
        result = self.run_wrapped(
            Sitting("a").prompt(0, "Run the tests!"),
            Sitting("b", T0 + DAY).prompt(0, "run   the TESTS"),
            quotes=True,
        )
        self.assertEqual(
            result["quotes"]["go_to_prompt"],
            {"text": "run the TESTS", "session_id": "b", "ts": T0 + DAY, "seconds_in": 0},
        )

    def test_slash_commands_pastes_and_redacted_prompts_are_never_go_to(self):
        tb = (
            'Traceback (most recent call last):\n  File "a.py", line 3, in <module>\n'
            "ValueError: bad"
        )
        sittings = []
        for i in range(3):
            sittings.append(
                Sitting(f"s{i}", T0 + i * DAY)
                .prompt(0, "/compact")
                .prompt(10, "use key [redacted] please")
                .prompt(20, tb)
            )
        result = self.run_wrapped(*sittings, quotes=True)
        c = by_id(result, "go_to_prompt")
        self.assertEqual(c["reason"], "no prompt was sent in more than one session")
        self.assertEqual(c["n"], 0)
        self.assertNotIn("go_to_prompt", result["quotes"])

    def test_punctuation_alone_is_not_one_prompt(self):
        c = self.card(
            Sitting("a").prompt(0, "???"),
            Sitting("b", T0 + DAY).prompt(0, "!!!"),
            cid="go_to_prompt",
        )
        self.assertIsNotNone(c["reason"])


# =================================================================== 7 streak
class Streak(WrappedCase):
    def test_an_unattended_day_never_bridges_a_streak(self):
        sittings = [
            Sitting("d0", T0).prompt(0, "go"),
            Sitting("d1", T0 + DAY, attended=0.0, autonomous=3600.0, unattended=True).tool(0),
            Sitting("d2", T0 + 2 * DAY).prompt(0, "go"),
        ]
        commits = contributions_on({day(0): (1, 0), day(1): (1, 0), day(2): (1, 0)})
        c = self.card(*sittings, cid="streak", contributions=commits)
        self.assertEqual((c["value"], c["display"]), (1, "1 day straight"))
        self.assertEqual(c["sentence"], "2 days in all had a commit and a session with you there.")
        self.assertEqual(c["extras"], {"commit_days": 3, "attended_days": 2, "both_days": 2})

    def test_attended_every_day_is_a_run(self):
        sittings = [Sitting(f"d{i}", T0 + i * DAY).prompt(0, "go") for i in range(3)]
        commits = contributions_on({day(0): (1, 0), day(1): (0, 1), day(2): (2, 0), day(4): (1, 0)})
        c = self.card(*sittings, cid="streak", contributions=commits)
        self.assertEqual((c["value"], c["display"]), (3, "3 days straight"))
        self.assertEqual(c["sentence"], "3 days in all had a commit and a session with you there.")

    def test_a_day_needs_both_a_commit_and_you(self):
        # Commits on day 5 only; the sitting is day 0. Measured, so zero is printed.
        c = self.card(
            Sitting("d0").prompt(0, "go"),
            cid="streak",
            contributions=contributions_on({day(5): (0, 1)}),
        )
        self.assertEqual((c["value"], c["display"]), (0, "No streak yet"))
        self.assertEqual(c["sentence"], "1 day had a commit, none alongside a session with you there.")
        self.assertIsNone(c["reason"])

    def test_days_start_at_four_in_the_morning(self):
        # 03:30 on 2 September is still 1 September, the day of the commit.
        late = dt.datetime(2026, 9, 2, 3, 30, tzinfo=dt.UTC).timestamp()
        c = self.card(
            Sitting("late", late).prompt(0, "go"),
            cid="streak",
            contributions=contributions_on({day(0): (1, 0)}),
        )
        self.assertEqual(c["value"], 1)

    def test_no_commit_history_refuses(self):
        c = self.card(*rich(), cid="streak")
        self.assertEqual(
            c["reason"],
            "no commit history could be read for the repositories these sessions ran in",
        )


# =================================================================== 8 change_course
class ChangeCourse(WrappedCase):
    def test_the_refusal_is_said_from_the_counts_on_this_machine(self):
        """The profile's reason is written for the server too ("not stored server side",
        false on the Mac that read every prompt, and "1 prompts"); the card says what it
        counted (FOUND IN REVIEW)."""
        c = self.card(
            Sitting("a").prompt(0, "go").prompt(5, "more").prompt(9, "again").prompt(12, "ok"),
            cid="change_course",
        )
        self.assertEqual(c["reason"], "4 prompts with text, 5 needed")
        self.assertEqual(c["n"], 4)
        one = self.card(Sitting("a").prompt(0, "go"), cid="change_course")
        self.assertEqual(one["reason"], "1 prompt with text, 5 needed")
        none = self.card(Sitting("a").tool(0), cid="change_course")
        self.assertEqual(none["reason"], "0 prompts with text, 5 needed")


# =================================================================== 9 crash_out
class CrashOut(WrappedCase):
    def test_the_parts_by_hand(self):
        parts = wr._crash_parts("ugh this is SO BROKEN!!! fix it")
        self.assertEqual(
            parts, {"profanity": 1, "caps_words": 1, "bang_runs": 1, "markers": 0, "stretches": 0}
        )
        self.assertEqual(wr._crash_score(parts), 7)
        self.assertEqual(wr._crash_parts("noooooo whyyyy")["stretches"], 2)

    def test_acronyms_are_not_shouting(self):
        self.assertEqual(wr._caps_words("the API JSON CORS SQL HTTPS README is down"), 0)
        self.assertEqual(wr._caps_words("WHY is the API DOWN"), 2)

    def test_each_signal_is_capped_and_the_maximum_is_46(self):
        self.assertEqual(len(pf._CORRECTION_MARKERS), 11)
        top = {"profanity": 9, "caps_words": 9, "bang_runs": 9, "markers": 11, "stretches": 9}
        self.assertEqual(wr._crash_score(top), 46)
        self.assertEqual(wr._caps_words("AAA BBB CCC DDD EEE FFF GGG"), 7)

    def test_ties_go_to_the_earliest(self):
        angry = "WHAT THE FUCK is this???"
        result = self.run_wrapped(
            Sitting("later", T0 + DAY).prompt(30, angry),
            Sitting("first", T0).prompt(30, angry),
            quotes=True,
        )
        self.assertEqual(result["quotes"]["crash_out"]["session_id"], "first")

    def test_a_prompt_at_the_start_has_a_digit_in_its_sentence(self):
        c = self.card(Sitting("a").prompt(0, "WHAT THE FUCK is this???"), cid="crash_out")
        self.assertEqual(
            c["sentence"], "Sent less than 1 minute into that session. We have all been there."
        )

    def test_minutes_into_the_session(self):
        c = self.card(Sitting("a").prompt(720, "WHAT THE FUCK is this???"), cid="crash_out")
        self.assertEqual(
            c["sentence"], "Sent 12 minutes into that session. We have all been there."
        )

    def test_calm_prompts_refuse(self):
        c = self.card(
            Sitting("a").prompt(0, "no that is wrong").prompt(5, "please add the API route"),
            cid="crash_out",
        )
        self.assertEqual(c["reason"], "no prompt read as a crash out")
        self.assertEqual(c["n"], 2)

    def test_a_prompt_that_carried_a_secret_is_never_the_crash_out(self):
        c = self.card(
            Sitting("a").prompt(0, "WHAT THE FUCK key [redacted] FAILED???"), cid="crash_out"
        )
        self.assertEqual((c["reason"], c["n"]), ("no prompt read as a crash out", 0))

    def test_a_pasted_traceback_is_never_the_crash_out(self):
        tb = "Traceback (most recent call last):\nFAILED FAILED FAILED!!!\nValueError: WHY WHY"
        c = self.card(Sitting("a").prompt(0, tb), cid="crash_out")
        self.assertEqual((c["reason"], c["n"]), ("no prompt read as a crash out", 0))


# =================================================================== 10 prompt_length
class PromptLength(WrappedCase):
    def c(self, *word_counts: int, extra=()):
        s = Sitting("a")
        for i, w in enumerate(word_counts):
            s.prompt(i, " ".join(["word"] * w))
        for i, text in enumerate(extra):
            s.prompt(100 + i, text)
        return self.card(s, cid="prompt_length")

    def test_the_labels_turn_on_the_median(self):
        self.assertEqual(
            self.c(1, 2, 9, 30, 50)["sentence"], "Mostly terse. Half of them run 9 words or fewer."
        )
        self.assertEqual(
            self.c(1, 2, 10, 30, 50)["sentence"],
            "Mostly conversational. Half of them run 10 words or fewer.",
        )
        self.assertEqual(
            self.c(1, 2, 40, 60, 80)["sentence"],
            "Mostly detailed briefs. Half of them run 40 words or fewer.",
        )

    def test_the_mean(self):
        c = self.c(1, 2, 9, 30, 50)
        self.assertEqual((c["value"], c["display"]), (18.4, "18.4 words on average"))
        self.assertEqual(c["extras"], {"median": 9.0})

    def test_slash_commands_do_not_count_toward_the_floor(self):
        c = self.c(3, 3, 3, 3, extra=("/model", "/effort high"))
        self.assertEqual(c["reason"], "4 prompts typed in your own words, 5 needed")


# =================================================================== 11 deep_sessions
class DeepSessions(WrappedCase):
    def test_sessions_past_an_hour_with_you_present(self):
        c = self.card(*attended_trio(attended=(3600.0, 5400.0, 1200.0)), cid="deep_sessions")
        self.assertEqual((c["value"], c["display"]), (2, "2 deep sessions"))
        self.assertEqual(c["sentence"], "Averaging 75 minutes of focus each.")
        self.assertEqual(c["extras"], {"avg_minutes": 75, "longest_minutes": 90})

    def test_a_long_unattended_run_is_not_deep(self):
        robot = Sitting(
            "robot", T0 + 9 * DAY, attended=0.0, autonomous=36000.0, unattended=True
        ).tool(0)
        c = self.card(*attended_trio(attended=(3000.0, 1200.0, 600.0)), robot, cid="deep_sessions")
        self.assertEqual((c["value"], c["display"]), (0, "No session past an hour yet"))
        self.assertEqual(c["sentence"], "Your longest ran 50 minutes.")
        self.assertIsNone(c["extras"]["avg_minutes"])

    def test_just_under_an_hour_never_reads_as_an_hour_on_either_card(self):
        """FOUND IN REVIEW: a longest session of 3,585 s is not deep (under 3,600), and the
        cards said "No session past an hour yet. Your longest ran 60 minutes." beside a
        longest session of "1h 00m". Both floor: 59 minutes."""
        trio = attended_trio(attended=(3585.0, 1200.0, 600.0))
        deep = self.card(*trio, cid="deep_sessions")
        self.assertEqual((deep["value"], deep["sentence"]), (0, "Your longest ran 59 minutes."))
        self.assertEqual(deep["extras"]["longest_minutes"], 59)
        longest = self.card(*attended_trio(attended=(3585.0, 1200.0, 600.0)), cid="longest_session")
        self.assertEqual(longest["display"], "59 minutes")

    def test_one_deep_session_is_not_an_average(self):
        c = self.card(*attended_trio(attended=(4500.0, 1200.0, 600.0)), cid="deep_sessions")
        self.assertEqual((c["display"], c["sentence"]), ("1 deep session", "It ran 75 minutes with you there."))


# =================================================================== 12 time_put_in
class TimePutIn(WrappedCase):
    def test_one_hour_is_singular(self):
        c = self.card(*attended_trio(attended=(1200.0, 1200.0, 1200.0)), cid="time_put_in")
        self.assertEqual(c["display"], "1 hour across 3 sessions")
        self.assertEqual(c["sentence"], "1 of those hours with you there.")

    def test_sessions_that_ran_at_once_say_how_much_may_be_counted_twice(self):
        """A correct per session number can be an incorrect corpus total (CLAUDE.md). Two
        sittings with you there, 09:00 to 10:00 and 09:30 to 10:30: their attended hours
        sum to 2, and up to half an hour of it is one person counted twice. FOUND IN
        REVIEW, MEASURED on the corpus: up to 1.19 h of 74.5."""
        a = Sitting("a", T0, attended=3600.0, end=T0 + 3600).prompt(0, "go")
        b = Sitting("b", T0 + 1800, attended=3600.0, end=T0 + 5400).prompt(0, "go")
        c = Sitting("c", T0 + DAY, attended=600.0, end=T0 + DAY + 600).prompt(0, "go")
        card = self.card(a, b, c, cid="time_put_in")
        self.assertEqual(card["extras"]["attended_overlap_hours"], 0.5)
        self.assertEqual(
            card["sentence"],
            "2.2 of those hours with you there, up to 0.5 of them in sessions that ran at the same time.",
        )


# =================================================================== 13 cryptic_prompt
class CrypticPrompt(WrappedCase):
    def test_gibberish_tokens(self):
        for token, expected in (
            ("sdfgh", True),
            ("qwrtzsdfgh", True),
            # Letters and digits interleaved are an identifier, never gibberish.
            ("Q7ZK2M9X4P", False),
            ("ab12cd34", False),
            ("abc123", False),  # one letter to digit switch
            ("rhythm", False),  # y counts as a vowel
            ("a1b", False),  # under four characters
            ("hello", False),
        ):
            with self.subTest(token=token):
                self.assertEqual(wr._gibberish(token), expected)

    def test_hashes_urls_paths_versions_and_long_tokens_are_never_cryptic(self):
        for text in (
            "3f2a9c1",
            "deadbeefcafe",
            "http://a1b2.io",
            "see a1b2c3/d4e5",
            "mail x9@y8.io",
            "bump to v1.2x3",
            "a1b2c3d4e5f6g7h8i9j0",
            "12345678",
            "x=1y2z3",
        ):
            with self.subTest(text=text):
                self.assertFalse(wr._cryptic_candidate(text))
        self.assertTrue(wr._cryptic_candidate("sdfgh jklqw"))
        # One token is never a candidate: a letters only password is a keyboard mash's
        # shape (FOUND IN REVIEW: `xkcdmbrptw` was crowned).
        self.assertFalse(wr._cryptic_candidate("sdfghjklqw"))
        self.assertFalse(wr._cryptic_candidate("xkcdmbrptw"))

    def test_only_words_of_four_characters_count_toward_the_two(self):
        """A short label is not a second word (FOUND IN THE ADVERSARIAL REVIEW: `pw` in
        front of a password made it two tokens and the card crowned it)."""
        for text in ("pw xkcdmbrptw", "pin is qwrtzxcvbn", "ok go", "a b c dfghj"):
            with self.subTest(text=text):
                self.assertFalse(wr._cryptic_candidate(text))
        for text in ("sdfgh jklqw", "asdf ghjkl", "why did this fail"):
            with self.subTest(text=text):
                self.assertTrue(wr._cryptic_candidate(text))
        self.assertEqual(wr.CRYPTIC_MIN_TOKEN_CHARS, wr.CRYPTIC_MIN_CHARS)

    def test_an_identifier_is_never_the_cryptic_prompt(self):
        """GROUND TRUTH, 2026-09-13, `~/.builder-overnight/corpus` (156 counted sessions).

        The card once quoted a ten character value the person had pasted in reply to a
        request for an account identifier, letters and digits interleaved. It was the only
        one of 413 candidates to qualify, and the same text also formed a go-to prompt group
        (2 sessions, 2 sends). brief.md: "the cryptic prompt filter must drop IDs, OTPs and
        tokens". Now: 0 of 410 candidates qualify and the card refuses. (The value below is
        synthetic, of the same shape.)
        """
        a = Sitting("a").prompt(0, "team Q7ZK2M9X4P").tool(5).tool(6).prompt(50, "thanks")
        b = Sitting("b", T0 + DAY).prompt(0, "team Q7ZK2M9X4P").tool(5)
        result = self.run_wrapped(a, b, quotes=True)
        c = by_id(result, "cryptic_prompt")
        self.assertEqual(c["n"], 0)
        self.assertEqual(
            c["reason"],
            "no short prompt with 2 or more words of 4 or more characters to read (4 to 80 characters, no path, link or hash)",
        )
        g = by_id(result, "go_to_prompt")
        self.assertEqual((g["reason"], g["n"]), ("no prompt was sent in more than one session", 1))
        self.assertEqual(result["quotes"], {})
        self.assertNotIn("Q7ZK2M9X4P", json.dumps(result))

    def test_the_most_cryptic_and_what_the_agent_did(self):
        s = Sitting("a").prompt(0, "sdfgh jklqw").tool(5).tool(6).prompt(50, "thanks")
        c = self.card(s, cid="cryptic_prompt")
        self.assertEqual((c["value"], c["display"]), (1.0, "A prompt of 11 characters"))
        self.assertEqual(c["sentence"], "Somehow the agent knew. 2 tool calls followed.")
        self.assertEqual(c["n"], 1)  # "thanks" is one word, never a candidate
        self.assertEqual(c["basis"], "vowelless_runs")

    def test_when_you_corrected_it(self):
        s = Sitting("a").prompt(0, "sdfgh jklqw").tool(5).prompt(50, "no that is wrong")
        c = self.card(s, cid="cryptic_prompt")
        self.assertEqual(c["sentence"], "11 characters, and it had a go anyway.")

    def test_one_tool_call_is_singular(self):
        s = Sitting("a").prompt(0, "asdf ghjkl").tool(5)
        self.assertEqual(
            self.card(s, cid="cryptic_prompt")["sentence"],
            "Somehow the agent knew. 1 tool call followed.",
        )

    def test_ties_go_to_the_shorter_then_the_earlier(self):
        result = self.run_wrapped(
            Sitting("a").prompt(0, "zxcvb nmlkjhg").prompt(10, "bcdfg hjklm"),
            Sitting("b", T0 - DAY).prompt(0, "qwrtz psdfg"),
            quotes=True,
        )
        q = result["quotes"]["cryptic_prompt"]
        self.assertEqual((q["text"], q["session_id"]), ("qwrtz psdfg", "b"))

    def test_english_refuses(self):
        c = self.card(
            Sitting("a").prompt(0, "why did this fail").prompt(5, "rhythm and blues"),
            cid="cryptic_prompt",
        )
        # The refusal names the bar and how many prompts met the length rule, never "not
        # cryptic enough" (FOUND IN REVIEW).
        self.assertEqual(
            (c["reason"], c["n"]),
            ("none of the 2 short prompts was mostly keyboard mash (five letters in a row with no vowel)", 2),
        )


# =================================================================== 14 prompts_per_session
class PromptsPerSession(WrappedCase):
    def test_a_session_nobody_was_at_is_not_a_conversation(self):
        robot = Sitting(
            "robot", T0 + 9 * DAY, attended=0.0, autonomous=900.0, unattended=True
        ).tool(0)
        c = self.card(*attended_trio((1, 1, 1)), robot, cid="prompts_per_session")
        # 3 prompts is under MIN_PROMPTS, so the tool call rate refuses and the median speaks.
        self.assertEqual((c["value"], c["display"]), (1.0, "1 prompt a session"))
        self.assertEqual(c["sentence"], "Half your sessions have 1 or fewer.")
        self.assertEqual(c["extras"], {"median": 1.0, "tool_calls_per_prompt": None})


# =================================================================== 15 kind_of_work
class KindOfWork(WrappedCase):
    def test_classify_subject(self):
        cases = {
            "feat: add login": "feature",
            "fix(auth)!: token refresh": "fix",
            "tests: cover the parser": "test",
            "ci: pin ruff": "build",
            "Docs: explain the wire": "docs",
            "perf: cache the sweep": "perf",
            "revert: the last one": "revert",
            "chore: bump deps": "chore",
            "style: format": "style",
            "build: eas profile": "build",
            "refactor: split module": "refactor",
            "Fix six defects an adversarial review confirmed": "fix",
            "Added the streak card": "feature",
            "Auth: fix the viewer-less RLS bootstrap": "fix",
            "mobile/src: rename the tab": "refactor",
            "README tweaks": "docs",
            "Bump expo to 52": "chore",
            "Rollback the migration": "revert",
            "Real tool output: run the real writers": None,
            "Looked at it in a browser, and four things were wrong": None,
            "feat:no space": None,
            "": None,
        }
        for subject, kind in cases.items():
            with self.subTest(subject=subject):
                self.assertEqual(wr.classify_subject(subject), kind)

    def test_refuses_at_nine_percent_and_the_fallback_basis_is_named(self):
        subjects = ["fix: a thing"] * 21 + ["Prose about the day"] * 211
        c = self.card(*rich(), cid="kind_of_work", commit_subjects=subjects)
        self.assertEqual((c["value"], c["basis"]), ("source", "lines_by_file_role"))
        self.assertEqual(c["display"], "Mostly source code.")
        # 225 / 285 and 40 / 285
        self.assertEqual(
            c["sentence"], "79% of agent lines went to source files, 14% to test files."
        )
        self.assertEqual(c["n"], 285)
        self.assertEqual(
            c["extras"]["commit_reason"],
            "21 of 232 commit subjects say what kind of change they are, 60% needed",
        )
        self.assertEqual(c["extras"]["coverage"], 0.091)

    def test_answers_at_sixty_percent_over_twenty(self):
        subjects = ["fix: x"] * 11 + ["feat: y"] * 10 + ["prose"] * 14  # 21 of 35
        c = self.card(*rich(), cid="kind_of_work", commit_subjects=subjects)
        self.assertEqual(c["basis"], "commit_subject_labels")
        self.assertEqual(c["sentence"], "11 fixes and 10 features in 35 commits.")

    def test_just_under_sixty_percent_falls_back(self):
        subjects = ["fix: x"] * 20 + ["prose"] * 14  # 20 of 34 is 58.8%
        c = self.card(*rich(), cid="kind_of_work", commit_subjects=subjects)
        self.assertEqual(c["basis"], "lines_by_file_role")

    def test_under_twenty_labelled_falls_back_even_at_full_coverage(self):
        c = self.card(*rich(), cid="kind_of_work", commit_subjects=["fix: x"] * 19)
        self.assertEqual(c["basis"], "lines_by_file_role")
        self.assertEqual(
            c["extras"]["commit_reason"],
            "19 of 19 commit subjects say what kind of change they are, 20 needed",
        )

    def test_one_kind(self):
        c = self.card(*rich(), cid="kind_of_work", commit_subjects=["docs: x"] * 20)
        self.assertEqual((c["value"], c["display"]), ("docs", "Mostly docs changes."))
        self.assertEqual(c["sentence"], "20 docs changes in 20 commits.")

    def test_both_bases_failing_joins_both_reasons(self):
        s = Sitting("a").prompt(0, "go").edit(5, "/r/a.py", 50)
        c = self.card(s, cid="kind_of_work", commit_subjects=["Prose"] * 5)
        self.assertEqual(
            c["reason"],
            "0 of 5 commit subjects say what kind of change they are, 20 needed; "
            "50 attributable lines, 200 needed",
        )
        self.assertEqual(c["extras"]["role_lines"], {"source": 50})

    def test_generated_files_are_nobodys_kind_of_work(self):
        s = (
            Sitting("a")
            .prompt(0, "go")
            .edit(5, "/r/bun.lock", 3000, tool="Write")
            .edit(6, "/r/tests/test_a.py", 250, tool="Write")
        )
        c = self.card(s, cid="kind_of_work")
        self.assertEqual((c["value"], c["display"]), ("test", "Mostly tests."))
        self.assertEqual(c["sentence"], "100% of agent lines went to test files.")
        self.assertEqual(c["extras"]["commit_reason"], "no commit subjects were read")

    def test_every_role_has_a_display_and_a_word(self):
        self.assertEqual(set(wr.ROLE_DISPLAY), set(plain.ROLES))
        self.assertEqual(set(wr.ROLE_WORD), set(plain.ROLES))
        self.assertEqual(set(wr._KIND_NOUN), set(wr.KINDS))


# =================================================================== prompts and quotes
class Quotable(unittest.TestCase):
    def test_what_is_never_quoted(self):
        for text in (
            "",
            "   ",
            None,
            "/model opus",
            "  /effort high",
            "here is the key [redacted] use it",
            'Traceback (most recent call last):\n  File "a.py", line 3\nKeyError: x',
            "TypeError: x is undefined\n    at foo (a.js:1:2)\n    at bar (b.js:3:4)",
            "\n".join(["const a = {b: 1};"] * 8),
            # Identifiers, the shapes measured on the corpus (see `_carries_identifier`).
            # Every value here is synthetic, of the measured shape: a pasted account id,
            # an OAuth callback, a key file's name.
            "Q7ZK2M9X4P",
            "same issue. http://localhost:51275/callback?code=AbCdEfGh1jKlMn0pQ&state=x1y2z3w4",
            "ok: /Users/zebrapath/Downloads/AuthKey_Z9Y8X7W6V5.p8 do it now",
            "revert to a1b2c3d and redeploy",
        ):
            with self.subTest(text=text):
                self.assertFalse(wr.quotable(text))

    def test_an_identifier_is_interleaved_a_word_with_one_digit_is_not(self):
        for token in ("Q7ZK2M9X4P", "a1b2c3d", "9aBcD3eFgH4iJkL5mNoPqR", "Z9Y8X7W6V5", "2hq5"):
            with self.subTest(token=token):
                self.assertTrue(wr._carries_identifier(token))
        for token in ("python3", "gpt4o", "1080p", "sha256", "5min", "v2", "h264", "iOS17"):
            with self.subTest(token=token):
                self.assertFalse(wr._carries_identifier(f"use {token} for this"))

    def test_what_is(self):
        for text in (
            "Error: it broke, why?",  # one error shaped line is somebody describing it
            "\n".join(["this is a line of plain words"] * 8),
            "fix the login page",
        ):
            with self.subTest(text=text):
                self.assertTrue(wr.quotable(text))

    def test_a_numbered_list_is_prose_not_code(self):
        # The shape of four real prompts the unstripped rule threw away: `1)` is not code.
        brief = "\n".join(
            f"{i}) make the map load the stops for route {i} first" for i in range(1, 10)
        )
        self.assertTrue(wr.quotable(brief))
        lettered = "\n".join(f"{c}. keep the header" for c in "abcdefgh")
        self.assertTrue(wr.quotable(lettered))

    def test_a_numbered_code_listing_is_still_a_paste(self):
        listing = "\n".join(f"{i}. const row{i} = load({i});" for i in range(1, 10))
        self.assertFalse(wr.quotable(listing))

    def test_an_indented_terminal_block_is_still_a_paste(self):
        block = "is this true?\n" + "\n".join(f"  line {i} of the agent output" for i in range(8))
        self.assertFalse(wr.quotable(block))

    def test_the_quote_is_cut_at_a_space_inside_the_contracts_cap(self):
        q = wr._quote("word " * 100)
        self.assertLessEqual(len(q), wr.QUOTE_MAX)
        self.assertTrue(q.endswith(wr.ELLIPSIS))
        self.assertTrue(q[:-1].endswith("word"))
        self.assertEqual(wr._quote("a \n\n b\tc"), "a b c")
        self.assertEqual(len(wr._quote("x" * 300)), wr.QUOTE_MAX)

    def test_the_cap_is_the_contracts_excerpt_length(self):
        spec = json.loads(
            (pathlib.Path(__file__).resolve().parents[2] / "spec/analysis.v1.json").read_text()
        )
        self.assertEqual(wr.QUOTE_MAX, spec["max_lengths"]["excerpt"])

    def test_a_dash_the_person_typed_survives_in_their_quote(self):
        a = Sitting("a").prompt(0, "ship it - now")
        b = Sitting("b", T0 + DAY).prompt(0, "ship it - now")
        facts, sessions = corpus(a, b)
        result = wr.wrapped(facts, sessions, quotes=True)
        self.assertEqual(result["quotes"]["go_to_prompt"]["text"], "ship it - now")
        for c in result["cards"]:
            for s in _strings({k: c[k] for k in ("display", "sentence", "reason", "extras")}):
                self.assertFalse(plain.has_dash(s))


class NeverQuoted(WrappedCase):
    """What a quote card must never print, whatever else it is. Each prompt below was
    crowned by one of the three quote cards before the gates (FOUND IN REVIEW, a synthetic
    run, 2026-09-13). Every value is synthetic."""

    SECRETS = (
        "WTF WHY is login STILL BROKEN!!! the prod db password is hunterpass, just use it",
        "log in to staging, the admin password is hunterpass",
        "use the Bearer abcdefghijk header",
        "the api key is abcdefghij",
        "connect to postgres://admin:hunterpass@localhost/app",
    )
    PATHS = (
        "WHY!!! TypeError: Cannot read properties of undefined at /Users/zebrapath/app/index.tsx:42:13",
        "open ~/notes/plan.md and DO IT NOW!!!",
    )
    THEIRS = (
        "Customer email pasted: THIS APP IS GARBAGE!!! Sarah Jones, 404 Elm St",
        "he wrote: WHY IS THIS SO SLOW!!! FIX IT",
        "reply to [email] THIS IS BROKEN!!!",
    )

    def test_a_secret_a_path_or_someone_elses_words_is_never_quoted(self):
        for text in self.SECRETS + self.PATHS + self.THEIRS:
            with self.subTest(text=text):
                self.assertTrue(wr._private(text))
                # Still the person's own words, and still measured.
                if "\n" not in text:
                    self.assertTrue(wr.quotable(text) or wr._carries_identifier(text))

    def test_the_quote_cards_pass_them_over(self):
        for text in self.SECRETS + self.PATHS + self.THEIRS:
            with self.subTest(text=text):
                a = Sitting("a").prompt(0, text).prompt(10, "fix the page")
                b = Sitting("b", T0 + DAY).prompt(0, text).prompt(10, "fix the page")
                result = self.run_wrapped(a, b, quotes=True)
                self.assertNotIn(text, json.dumps(result))
                self.assertIsNotNone(by_id(result, "crash_out")["reason"])
                # The go-to prompt is the one that is safe to show.
                self.assertEqual(result["quotes"]["go_to_prompt"]["text"], "fix the page")
                # Measured all the same: the length card counts it.
                self.assertEqual(by_id(result, "prompt_length")["n"], 4)

    def test_distress_is_never_a_crash_out(self):
        for text in (
            "I HATE MYSELF I AM SO STUPID!!!",
            "I WANT TO DIE!!! nothing works",
            "im so stupid WHY WHY WHY!!!",
        ):
            with self.subTest(text=text):
                c = self.card(Sitting("a").prompt(0, text), cid="crash_out")
                self.assertEqual(c["reason"], "no prompt read as a crash out")
        angry = self.card(Sitting("a").prompt(0, "WHY IS THIS STILL BROKEN!!! ugh"), cid="crash_out")
        self.assertIsNone(angry["reason"])

    def test_one_short_prompt_is_said_as_one(self):
        c = self.card(Sitting("a").prompt(0, "why did this fail"), cid="cryptic_prompt")
        self.assertEqual(
            (c["reason"], c["n"]),
            ("the 1 short prompt was not mostly keyboard mash (five letters in a row with no vowel)", 1),
        )

    def test_a_single_word_is_never_the_cryptic_prompt(self):
        c = self.card(Sitting("a").prompt(0, "xkcdmbrptw").tool(5), cid="cryptic_prompt")
        self.assertIsNotNone(c["reason"])
        self.assertEqual(c["n"], 0)

    #: FOUND IN THE ADVERSARIAL REVIEW (2026-09-13): a letters only password behind a short
    #: label passed all three filters. The label made it two tokens, so it was a cryptic
    #: candidate, the mask knows no letters only secret, and no secret word named it; the
    #: card crowned it and `quotes_upload` sent it. Every value is synthetic.
    LABELLED = (
        "pw xkcdmbrptw",
        "pwd xkcdmbrptw",
        "pin is qwrtzxcvbn",
        "login admin hunterpass",
        "passwd hunterpass",
        "passcode zqxwvbnmp",
    )

    def test_a_labelled_password_is_never_quoted_or_crowned(self):
        for text in self.LABELLED:
            secret = text.split()[-1]
            with self.subTest(text=text):
                self.assertTrue(wr._private(text))
                a = Sitting("a").prompt(0, text).tool(5).prompt(20, "fix the page")
                result = self.run_wrapped(a, quotes=True)
                self.assertNotIn(secret, json.dumps(result))
                doc = wr.quotes_upload(result, generated_at=T0 + 3600)
                self.assertNotIn(secret, json.dumps(doc))


class Quotes(WrappedCase):
    def test_no_quotes_unless_asked(self):
        self.assertEqual(self.run_wrapped(*rich(), **rich_kw())["quotes"], {})

    def test_the_three_quotes_when_asked(self):
        q = self.run_wrapped(*rich(), quotes=True, **rich_kw())["quotes"]
        self.assertEqual(set(q), {"go_to_prompt", "crash_out", "cryptic_prompt"})
        for card, v in q.items():
            extra = {"tool_calls_after", "corrected"} if card == "cryptic_prompt" else set()
            self.assertEqual(set(v), {"text", "session_id", "ts", "seconds_in"} | extra)
        self.assertEqual(q["crash_out"]["text"], "WHAT THE FUCK zebracorn is still broken???")
        self.assertEqual(q["cryptic_prompt"]["text"], "zebracorn qwrtzsdfgh")

    def test_no_display_or_sentence_ever_holds_prompt_text(self):
        result = self.run_wrapped(*rich(), quotes=True, **rich_kw())
        self.assertIn("zebracorn", json.dumps(result["quotes"]))  # the sentinel is really there
        for c in result["cards"]:
            for key in ("display", "sentence", "reason"):
                self.assertNotIn("zebracorn", str(c[key]), c["id"])
            self.assertNotIn("zebracorn", json.dumps(c["extras"]), c["id"])

    def test_paths_and_subjects_appear_nowhere_even_locally(self):
        text = json.dumps(self.run_wrapped(*rich(), quotes=True, **rich_kw()))
        self.assertNotIn("zebrapath", text)
        self.assertNotIn("zebrasubject", text)


# =================================================================== wire
class Wire(WrappedCase):
    def test_sentinels_are_absent_from_the_wire(self):
        result = self.run_wrapped(*rich(), quotes=True, fanout=fan(3, 5), **rich_kw())
        text = json.dumps(wr.wire(result))
        for word in SENTINELS:
            self.assertNotIn(word, text)
        # and the one that is present locally is the one the quote carries
        self.assertIn("zebracorn", json.dumps(result))

    def test_the_wire_shape(self):
        w = wr.wire(self.run_wrapped(*rich(), quotes=True, **rich_kw()))
        self.assertEqual(set(w), {"cards", "sample"})
        self.assertEqual([c["id"] for c in w["cards"]], list(wr.CARD_IDS))
        for c in w["cards"]:
            if c["id"] in ("crash_out", "cryptic_prompt"):
                # Which card and whether it answered: its unit and basis are the card's own
                # constants, and its numbers stay here.
                self.assertEqual(tuple(c), ("id", "unit", "basis", "n", "needed", "reason", "code"))
            else:
                self.assertEqual(tuple(c), wr.WIRE_KEYS)
            for dropped in ("question", "display", "sentence"):
                self.assertNotIn(dropped, c)
        self.assertEqual(w["sample"]["attended_sessions"], 3)

    def test_the_wire_carries_every_number_a_sentence_is_rendered_from(self):
        w = {c["id"]: c for c in wr.wire(self.run_wrapped(*rich(), **rich_kw()))["cards"]}
        self.assertEqual(w["change_course"]["extras"], {"interrupts": 1, "corrective_prompts": 1})
        self.assertEqual(w["deep_sessions"]["extras"]["avg_minutes"], 65)
        self.assertEqual(w["builder_type"]["extras"]["metric_value"], 0.596)
        self.assertEqual(w["prompts_per_session"]["extras"]["tool_calls_per_prompt"], 1.6)
        self.assertEqual(w["time_put_in"]["extras"]["attended_overlap_hours"], 0.0)

    def test_the_wire_is_a_copy(self):
        result = self.run_wrapped(*rich(), **rich_kw())
        w = wr.wire(result)
        w["cards"][1]["extras"]["commits"] = -1
        self.assertEqual(by_id(result, "shipped")["extras"]["commits"], 6)

    def test_a_refused_corpus_still_has_a_wire(self):
        w = wr.wire(self.run_wrapped())
        self.assertTrue(all(c["reason"] for c in w["cards"]))
        json.dumps(w)


# =================================================================== the dash rule
class NoDashes(unittest.TestCase):
    """Every fixed string the module can emit, beside the rendered ones `run_wrapped` checks."""

    def test_every_table(self):
        tables = (
            wr.QUESTIONS,
            wr.ARCHETYPE_DISPLAY,
            wr.WORK_STYLE_DISPLAY,
            wr.ROLE_DISPLAY,
            wr.ROLE_WORD,
            wr._KIND_NOUN,
            wr.REFUSALS,
            wr.KIND_REFUSALS,
        )
        for table in tables:
            for s in _strings(table):
                self.assertFalse(plain.has_dash(s), s)

    def test_every_archetype_sentence(self):
        for name in (
            "architect",
            "velocity_machine",
            "quality_guardian",
            "night_owl",
            "director",
            "skeptic",
        ):
            for v in (0.3, 2.5, 3.0, 45.5, 600.0):
                for at_least in (False, True):
                    s = wr._archetype_sentence(name, v, at_least=at_least)
                    self.assertFalse(plain.has_dash(s), s)
                    self.assertRegex(s, r"\d")
                    self.assertEqual(s.startswith("At least "), at_least, s)

    def test_the_has_dash_check_is_live(self):
        # A guard nobody has ever seen fail is a guard nobody should trust (CLAUDE.md).
        self.assertTrue(plain.has_dash("one — two"))
        self.assertTrue(plain.has_dash("one - two"))



# =================================================================== codes, units, quotes
class RefusalCodes(WrappedCase):
    """docs/overnight-integration.md 1.3: every refusal is a code beside its words, from
    `REFUSALS`, so the phone words it from the wire the way this module does."""

    def test_every_card_has_a_code_exactly_when_it_has_a_reason(self):
        for result in (self.run_wrapped(), self.run_wrapped(*rich(), **rich_kw()), self.run_wrapped(*attended_trio()[:2])):
            for c in result["cards"]:
                self.assertEqual(c["code"] is None, c["reason"] is None, c["id"])
                if c["code"]:
                    self.assertEqual(
                        c["reason"],
                        wr.refusal_text(c["code"], n=c["n"], needed=c["needed"], extras=c["extras"]),
                    )

    def test_the_floors_travel_as_needed(self):
        empty = {c["id"]: c for c in self.run_wrapped()["cards"]}
        self.assertEqual((empty["builder_type"]["code"], empty["builder_type"]["needed"]), ("below_session_floor", 3))
        self.assertEqual((empty["work_style"]["code"], empty["work_style"]["needed"]), ("below_attended_floor", 3))
        self.assertEqual((empty["prompt_length"]["code"], empty["prompt_length"]["needed"]), ("below_own_words_floor", 5))
        self.assertEqual((empty["change_course"]["code"], empty["change_course"]["needed"]), ("below_prompt_floor", 5))
        self.assertEqual((empty["shipped"]["code"], empty["shipped"]["needed"]), ("no_sessions", None))
        kind = empty["kind_of_work"]
        self.assertEqual((kind["code"], kind["needed"], kind["extras"]["commit_code"]), ("neither_kind_basis", None, "no_subjects"))

    def test_the_kind_of_work_refusal_names_both_floors(self):
        subjects = ["fix: the button"] * 5 + ["tidy the notes"] * 5
        c = self.card(*attended_trio(), cid="kind_of_work", commit_subjects=subjects)
        self.assertEqual((c["code"], c["needed"]), ("neither_kind_basis", wr.KIND_MIN_SUBJECTS))
        self.assertEqual(
            c["reason"],
            "5 of 10 commit subjects say what kind of change they are, 20 needed; "
            "0 attributable lines, 200 needed",
        )
        self.assertEqual((c["extras"]["lines"], c["extras"]["lines_needed"]), (0, 200))

    def test_an_unknown_code_is_a_crash_not_a_card(self):
        with self.assertRaises(KeyError):
            wr._refuse("shipped", "lines", "absent", 0, "no_such_code", {})

    def test_a_template_with_a_hole_raises(self):
        with self.assertRaises(KeyError):
            wr.refusal_text("below_attended_floor", n=2, needed=None, extras={})


class Units(WrappedCase):
    def test_units_are_identifiers(self):
        """A unit is never rendered, so it is an identifier: the one with a space in it
        ("prompts per session") would be a value the report spec refuses."""
        for result in (self.run_wrapped(), self.run_wrapped(*rich(), **rich_kw())):
            for c in result["cards"]:
                self.assertRegex(c["unit"], r"^[a-z_]+$", c["id"])
        self.assertEqual(by_id(self.run_wrapped(*rich(), **rich_kw()), "prompts_per_session")["unit"], "prompts_per_session")


class QuotesUpload(WrappedCase):
    """The quotes document (contract v4 `quotes`), THE SECOND OPT-IN EXCEPTION."""

    def upload(self, *sittings, quotes=True, **kw):
        result = self.run_wrapped(*sittings, quotes=quotes, **kw)
        return wr.quotes_upload(result, generated_at=T0 + 10 * DAY)

    def test_quotes_upload_is_empty_without_quotes_true(self):
        doc = self.upload(*rich(), quotes=False, **rich_kw())
        self.assertEqual(doc["quotes"], [])
        self.assertEqual(doc["quotes_version"], wr.QUOTES_VERSION)
        self.assertEqual(doc["generated_at"], "2026-09-11T15:00:00Z")

    def test_the_three_quotes_carry_what_their_sentences_need(self):
        doc = self.upload(*rich(), **rich_kw())
        by_card = {q["card"]: q for q in doc["quotes"]}
        self.assertEqual(list(by_card), list(wr.QUOTE_CARDS))
        for q in doc["quotes"]:
            self.assertEqual(
                set(q),
                {"card", "text", "client_session_id", "sent_at", "seconds_in", "tool_calls_after", "corrected"},
            )
        crash = by_card["crash_out"]
        self.assertEqual((crash["seconds_in"], crash["sent_at"]), (60, "2026-09-01T15:01:00Z"))
        self.assertEqual((crash["tool_calls_after"], crash["corrected"]), (None, None))
        cryptic = by_card["cryptic_prompt"]
        self.assertEqual((cryptic["tool_calls_after"], cryptic["corrected"]), (3, False))
        # The card's sentences are said from these numbers alone.
        self.assertEqual(wr.crash_out_into(crash["seconds_in"]), "1 minute")
        self.assertEqual(
            wr.cryptic_sentence(len(cryptic["text"]), cryptic["tool_calls_after"], cryptic["corrected"]),
            "Somehow the agent knew. 3 tool calls followed.",
        )

    def test_quotes_upload_never_exceeds_160_or_carries_a_mask(self):
        from analysis import digest

        long = " ".join(["please make the settings page load faster on a cold start"] * 6)
        sittings = [
            Sitting(f"l{i}", T0 + i * DAY).prompt(0, long).tool(5, "ls") for i in range(2)
        ]
        doc = self.upload(*sittings)
        self.assertEqual([q["card"] for q in doc["quotes"]], ["go_to_prompt"])
        for q in doc["quotes"]:
            self.assertLessEqual(len(q["text"]), wr.QUOTE_MAX)
            self.assertEqual(digest.mask(q["text"]), q["text"])
            self.assertTrue(wr.quotable(q["text"]))
        # A quote the mask would change is dropped, never rewritten.
        result = self.run_wrapped(*rich(), quotes=True, **rich_kw())
        result["quotes"]["crash_out"]["text"] = "the key is sk-ant-api03-" + "a" * 40
        cards = [q["card"] for q in wr.quotes_upload(result, generated_at=T0)["quotes"]]
        self.assertNotIn("crash_out", cards)

    def test_an_apple_team_id_is_never_quoted(self):
        """A pasted identifier (letters and digits interleaved, the synthetic `Q7ZK2M9X4P`)
        is the one prompt the corpus crowned the most cryptic before `_carries_identifier`:
        it is never quoted on any card, and never measured as the person's words either."""
        sittings = [
            Sitting(f"id{i}", T0 + i * DAY).prompt(0, "Q7ZK2M9X4P").tool(5, "ls").prompt(20, "Q7ZK2M9X4P ok").tool(25, "ls")
            for i in range(3)
        ]
        result = self.run_wrapped(*sittings, quotes=True)
        self.assertNotIn("Q7ZK2M9X4P", json.dumps(result["quotes"]))
        doc = wr.quotes_upload(result, generated_at=T0)
        self.assertNotIn("Q7ZK2M9X4P", json.dumps(doc))
        self.assertFalse(wr.quotable("my team id is Q7ZK2M9X4P"))


if __name__ == "__main__":
    unittest.main()
