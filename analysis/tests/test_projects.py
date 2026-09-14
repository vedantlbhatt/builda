"""PROJECTS (`analysis/projects.py`, docs/projects.md): the report's blocks asked of one
repository at a time.

What each class holds, in the order a wrong number would reach a phone:

  * OneFunctionEach: a project is the report of a machine that had only that project. The
    money, burn, stack, cards, languages and commit graph of project A over a cut holding A
    and B are EXACTLY the report's own blocks over a cut holding only A. That is the whole
    "no second copy" claim, tested as an equivalence rather than asserted in a docstring.
  * TwoScopes: history is every sitting however old, window is the report's window; a
    project with nothing in the window keeps its history and a null window.
  * EverySittingOnce: every sitting is in one project or unresolved, in both scopes, and
    the shares of attended time add up.
  * TheStage, Momentum, Streaks: each lifecycle rule at its boundary, each labelled
    threshold, and an unattended run never extending a streak.
  * CommitsAndAgents: a commit is assisted only by a sitting in its own repository; two
    checkouts of one repository are one project and each commit once; an agent is its
    dispatcher's project's only.
  * Comparisons: the sample floor, the ratio and share bars, the zero forms, the tie rule.
  * CostPerCommit: every refusal and the answered arithmetic.
  * WhatMayTravel: no name, path, prompt, subject or manifest string in the block; every
    string an enum, a clock or a 64 hex key; the block's keys are the spec's at every
    level; the tables the enums copy are pinned both ways.
  * Copy: no dash in any template, every template filled by the fixture, the fixture the
    phone is pinned to is what gen_copy writes today.
  * EndToEnd: synthetic transcripts in two real git repositories and a home directory,
    through the real parser, `corpus.cut` and the report, commits dated by hand.
"""

from __future__ import annotations

import contextlib
import dataclasses
import datetime as dt
import hashlib
import importlib.util
import io
import json
import os
import pathlib
import subprocess
import tempfile
import types
import unittest

from analysis import agents as ag
from analysis import contributions as co
from analysis import corpus as cp
from analysis import languages as lang
from analysis import patterns as pat
from analysis import plain, pricing
from analysis import profile as pf
from analysis import projects as pj
from analysis import report as rp
from analysis import report_blocks as rb
from analysis import trends as tr
from analysis import wrapped as wr
from analysis.tests import corpus_fixture as cf
from analysis.tests import projects_fixture as pfx
from analysis.tests.projects_fixture import (
    CHECKOUT,
    NOW,
    build,
    hand_cut,
    key,
    ride,
    span,
    two_projects,
    two_projects_commits,
)

ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = json.loads((ROOT / "spec/report.v1.json").read_text())
CONTRACT = json.loads((ROOT / "privacy/upload-contract.json").read_text())
DAY = cf.DAY
T0 = cf.T0


def by_key(block: dict) -> dict[str, dict]:
    return {p["key"]: p for p in block["projects"]}


# ============================================================================ the tests
class OneFunctionEach(unittest.TestCase):
    """A project is the report of a machine that had only that project."""

    @classmethod
    def setUpClass(cls):
        cls.both = two_projects()
        cls.block = pj.block(cls.both, 30)
        # The same zebraride sittings, commits and agents, on a machine with nothing else.
        only = [(ride(f"r{i}", T0 + i * DAY, autonomous=600.0 * i), "zebraride") for i in range(6)]
        commits = {CHECKOUT["zebraride"]: [c for c in two_projects_commits()[CHECKOUT["zebraride"]]]}
        cls.alone = hand_cut(
            only,
            now=NOW,
            commits=commits,
            spans=[(span("r-agent", T0 + 30), "r0"), (span("r-agent-2", T0 + 40), "r0")],
            deps={CHECKOUT["zebraride"]: ("react", "zebrapath-kit")},
        )
        cls.report, _ = rp.from_corpus(cls.alone, 30)
        cls.ride = by_key(cls.block)[key("zebraride")]["window"]

    def test_money_burn_and_stack_are_the_reports_own_blocks(self):
        for name in ("money", "burn", "stack"):
            self.assertEqual(self.ride[name], self.report[name], name)

    def test_the_cards_are_the_reports_own_cards_less_the_three_about_words(self):
        want = [c for c in self.report["wrapped"]["cards"] if c["id"] in pj.PROJECT_CARDS]
        self.assertEqual(self.ride["cards"], want)
        self.assertEqual([c["id"] for c in self.ride["cards"]], list(pj.PROJECT_CARDS))
        self.assertNotIn("go_to_prompt", pj.PROJECT_CARDS)

    def test_the_commit_graph_is_the_reports_graph(self):
        mine, theirs = self.ride["commits"], self.report["contributions"]
        for k in ("assisted", "alone", "active_days", "longest_streak", "current_streak"):
            self.assertEqual(mine[k], theirs[k], k)
        self.assertEqual([d["day"][:10] for d in mine["days"]], [d["day"] for d in theirs["days"]])

    def test_quality_and_languages_are_the_reports_numbers_with_codes_for_words(self):
        q, want = self.ride["quality"], self.report["quality"]
        for k in ("runs", "passed", "failed", "first_try_rate", "time_to_green"):
            self.assertEqual(q[k], want[k], k)
        lg, lw = self.ride["languages"], self.report["languages"]
        self.assertEqual((lg["lines"], lg["generated_lines_excluded"]), (lw["lines"], lw["generated_lines_excluded"]))
        self.assertEqual(
            [(r["language"], r["lines"], r["files"], r["share"]) for r in lg["languages"]],
            [(r["name"], r["lines"], r["files"], r["share"]) for r in lw["languages"]],
        )

    def test_the_agents_are_the_reports_agents(self):
        self.assertEqual(self.ride["agents"], self.report["agents"])
        self.assertEqual(self.ride["agents"]["agents"], 2)

    def test_the_scores_are_the_profiles_archetype_rules(self):
        prof = pf.corpus_profile(cp.window(self.alone, 30).facts, now=NOW)
        self.assertEqual(self.ride["scores"], [rb._score(s) for s in prof["archetype"]["scores"]])
        self.assertEqual([s["name"] for s in self.ride["scores"]], [r["name"] for r in pf.ARCHETYPE_RULES])

    def test_a_machine_with_one_project_gives_it_all_of_your_time(self):
        solo = pj.block(self.alone, 30)
        self.assertEqual(solo["projects"][0]["window"]["share_of_attended"], 1.0)


class TwoScopes(unittest.TestCase):
    def test_history_reads_every_sitting_and_the_window_only_its_own(self):
        """A sitting 60 days before the clock is in the project's history and in no window
        half: the window rule (`corpus.window`) holds inside a project too."""
        old = ride("old", NOW - 60 * DAY)
        c = hand_cut([(old, "zebraride"), *[(ride(f"r{i}", T0 + i * DAY), "zebraride") for i in range(3)]], now=NOW)
        p = pj.block(c, 30)["projects"][0]
        self.assertEqual((p["history"]["sessions"], p["window"]["sessions"]), (4, 3))
        self.assertEqual(p["history"]["first_at"], pf._iso(NOW - 60 * DAY))
        self.assertGreaterEqual(dt.datetime.fromisoformat(p["window"]["first_at"].replace("Z", "+00:00")).timestamp(), NOW - 30 * DAY)
        # The calendar distance runs over the old sitting too: 60 days back to T0 + 2 days.
        self.assertEqual(p["history"]["spans_days"], (pf.local_day(T0 + 2 * DAY, 0) - pf.local_day(NOW - 60 * DAY, 0)).days + 1)

    def test_a_project_with_nothing_in_the_window_keeps_its_history_and_a_null_window(self):
        c = hand_cut(
            [(ride("old", NOW - 50 * DAY), "builder"), (ride("new", NOW - DAY), "zebraride")],
            now=NOW,
        )
        block = pj.block(c, 30)
        self.assertEqual([p["key"] for p in block["projects"]], [key("zebraride"), key("builder")])
        dormant = block["projects"][1]
        self.assertIsNone(dormant["window"])
        self.assertEqual((dormant["history"]["sessions"], dormant["history"]["stage"]), (1, "dormant"))
        self.assertEqual(dormant["rank"], 2)

    def test_the_block_says_its_window_and_how_far_history_reaches(self):
        block = pj.block(two_projects(), 30)
        self.assertEqual(block["window_days"], 30)
        self.assertEqual(block["history_first_at"], pf._iso(T0))
        self.assertEqual(block["history_sessions"], 12)


class EverySittingOnce(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.c = two_projects()
        cls.block = pj.block(cls.c, 30)

    def test_every_sitting_is_in_one_project_or_unresolved(self):
        b = self.block
        self.assertEqual(sum(p["history"]["sessions"] for p in b["projects"]) + b["unresolved"]["history_sessions"], len(self.c.facts))
        in_window = [f for f in self.c.facts if f.started_at >= NOW - 30 * DAY]
        self.assertEqual(sum(p["window"]["sessions"] for p in b["projects"]) + b["unresolved"]["sessions"], len(in_window))
        self.assertEqual(b["unresolved"]["history_sessions"], 1)
        self.assertEqual(b["projects_total"], 2)

    def test_the_windows_total_is_what_every_share_is_out_of(self):
        """The block says the total its shares divide by, so the phone never sums a capped list
        to say how much "all of it" is."""
        b = self.block
        in_window = [f for f in self.c.facts if f.started_at >= NOW - 30 * DAY]
        self.assertEqual(b["window_attended_seconds"], round(sum(f.attended_seconds for f in in_window)))
        for p in b["projects"]:
            self.assertAlmostEqual(p["window"]["share_of_attended"], p["window"]["attended_seconds"] / b["window_attended_seconds"], delta=0.001)

    def test_the_windows_total_counts_the_projects_past_the_cap(self):
        sittings = [(ride(f"s{i}", T0 + i * 3600), f"p{i}") for i in range(pj.MAX_PROJECTS + 3)]
        where = {f"p{i}": f"/w/p{i}" for i in range(pj.MAX_PROJECTS + 3)}
        c = hand_cut(sittings, now=NOW, checkout=where)
        block = pj.block(c, 30)
        listed = sum(p["window"]["attended_seconds"] for p in block["projects"]) + block["unresolved"]["attended_seconds"]
        self.assertEqual(block["window_attended_seconds"], round(sum(f.attended_seconds for f in c.facts)))
        self.assertGreater(block["window_attended_seconds"], listed)

    def test_the_shares_of_attended_time_add_up_with_the_unresolved(self):
        b = self.block
        total = sum(p["window"]["attended_seconds"] for p in b["projects"]) + b["unresolved"]["attended_seconds"]
        shares = sum(p["window"]["share_of_attended"] for p in b["projects"]) + b["unresolved"]["attended_seconds"] / total
        self.assertAlmostEqual(shares, 1.0, delta=0.002)

    def test_most_of_your_time_ranks_first(self):
        ranks = [(p["rank"], p["window"]["attended_seconds"]) for p in self.block["projects"]]
        self.assertEqual([r for r, _ in ranks], [1, 2])
        self.assertGreaterEqual(ranks[0][1], ranks[1][1])

    def test_the_cap_is_never_silent(self):
        sittings = [(ride(f"s{i}", T0 + i * 3600), f"p{i}") for i in range(pj.MAX_PROJECTS + 3)]
        where = {f"p{i}": f"/w/p{i}" for i in range(pj.MAX_PROJECTS + 3)}
        block = pj.block(hand_cut(sittings, now=NOW, checkout=where), 30)
        self.assertEqual((len(block["projects"]), block["projects_total"]), (pj.MAX_PROJECTS, pj.MAX_PROJECTS + 3))


class TheStage(unittest.TestCase):
    """Each rule at its boundary. The thresholds are judgement calls (docs/projects.md)."""

    def test_dormant_at_two_weeks_of_silence(self):
        self.assertEqual(pj._stage(pj.DORMANT_AFTER_DAYS, 60, 0, 5), "quiet_two_weeks")
        self.assertEqual(pj._stage(pj.DORMANT_AFTER_DAYS - 1, 60, 1, 5), "quiet_a_week")

    def test_winding_down_at_a_week_of_silence(self):
        self.assertEqual(pj._stage(pj.WINDING_AFTER_DAYS, 60, 1, 5), "quiet_a_week")
        self.assertEqual(pj._stage(pj.WINDING_AFTER_DAYS - 1, 60, 8, 8), "steady")

    def test_winding_down_when_the_fortnight_halves(self):
        self.assertEqual(pj._stage(1, 60, 1, pj.CADENCE_MIN_PRIOR_DAYS), "cadence_halved")
        # Half exactly is not under half; and one day against three is not a fall.
        self.assertEqual(pj._stage(1, 60, 2, 4), "steady")
        self.assertEqual(pj._stage(1, 60, 1, pj.CADENCE_MIN_PRIOR_DAYS - 1), "steady")

    def test_starting_inside_the_first_fortnight_unless_it_is_already_quiet(self):
        self.assertEqual(pj._stage(0, 0, 1, 0), "new_this_fortnight")
        self.assertEqual(pj._stage(0, pj.STARTING_WITHIN_DAYS - 1, 5, 0), "new_this_fortnight")
        self.assertEqual(pj._stage(0, pj.STARTING_WITHIN_DAYS, 5, 0), "steady")
        self.assertEqual(pj._stage(8, 10, 2, 0), "quiet_a_week")

    def test_every_rule_names_a_stage_and_every_stage_has_a_rule(self):
        self.assertEqual(set(pj.STAGE_OF_RULE), set(pj.STAGE_RULES))
        self.assertEqual(set(pj.STAGE_OF_RULE.values()), set(pj.STAGES))

    def test_the_stage_is_read_on_the_cuts_clock_at_the_day_boundary(self):
        """A sitting at 02:00 belongs to the day before (04:00 boundary): `days_since_last`
        is 1 at 10:00 the next day, and 0 the same night."""
        night = dt.datetime(2026, 9, 10, 2, 0, tzinfo=dt.UTC).timestamp()
        c = hand_cut([(ride("n", night, attended=600.0), "zebraride")], now=night + 8 * 3600)
        h = pj.block(c, 30)["projects"][0]["history"]
        self.assertEqual(h["days_since_last"], 1)
        c = hand_cut([(ride("n", night, attended=600.0), "zebraride")], now=night + 3600)
        self.assertEqual(pj.block(c, 30)["projects"][0]["history"]["days_since_last"], 0)


def fact(i: int, start: float, attended: float = 1800.0, unattended: bool = False) -> pf.SessionFact:
    return pf.SessionFact(
        session_id=f"f{i}", started_at=start, ended_at=start + attended + 60, active_seconds=attended + (600 if unattended else 0),
        attended_seconds=0.0 if unattended else attended, autonomous_seconds=600.0 if unattended else 0.0, unattended=unattended,
    )  # fmt: skip


class Momentum(unittest.TestCase):
    """The week against the week before, through `trends.compare` and nothing else."""

    def week(self, n_before: int, n_now: int, before: float = 1800.0, now: float = 1800.0) -> dict:
        facts = [fact(i, NOW - 10 * DAY + i * 3600, before) for i in range(n_before)]
        facts += [fact(100 + i, NOW - 3 * DAY + i * 3600, now) for i in range(n_now)]
        return pj._momentum(facts, NOW)

    def test_below_the_trend_floor_there_is_no_direction(self):
        m = self.week(tr.MIN_SESSIONS - 1, 9)
        self.assertEqual((m["direction"], m["move"], m["reason"], m["needed"]), (None, None, "below_session_floor", tr.MIN_SESSIONS))
        self.assertEqual((m["sessions_before"], m["sessions"]), (tr.MIN_SESSIONS - 1, 9))

    def test_the_noise_floor_is_the_trends_own(self):
        steady = self.week(4, 4, before=1000.0, now=1000.0 * (1 + tr.MIN_MOVE) - 1)
        self.assertEqual(steady["direction"], "steady")
        up = self.week(4, 4, before=1000.0, now=1000.0 * (1 + tr.MIN_MOVE) + 1)
        self.assertEqual(up["direction"], "up")
        self.assertAlmostEqual(up["move"], tr.MIN_MOVE, places=2)

    def test_nothing_with_you_there_before_is_a_refusal_not_an_infinite_rise(self):
        facts = [fact(i, NOW - 10 * DAY + i * 3600, unattended=True) for i in range(4)]
        facts += [fact(100 + i, NOW - 3 * DAY + i * 3600) for i in range(4)]
        m = pj._momentum(facts, NOW)
        self.assertEqual((m["direction"], m["reason"], m["attended_seconds_before"]), (None, "nothing_before", 0))

    def test_the_copy_says_week_so_the_span_is_seven_days(self):
        self.assertEqual(pj.MOMENTUM_DAYS, 7)
        self.assertIn("week", pj.MOMENTUM_SENTENCES["up"])


class Streaks(unittest.TestCase):
    def test_an_unattended_run_never_bridges_a_projects_streak(self):
        sittings = [
            (ride("a", T0, attended=1800.0), "zebraride"),
            (cf.Sitting("robot", T0 + DAY, attended=0.0, autonomous=3600.0, unattended=True).tool(0, "ls").tool(3000, "ls"), "zebraride"),
            (ride("c", T0 + 2 * DAY, attended=1800.0), "zebraride"),
        ]
        h = pj.block(hand_cut(sittings, now=T0 + 2 * DAY + 3600), 30)["projects"][0]["history"]
        self.assertEqual((h["longest_streak_days"], h["current_streak_days"], h["active_days"]), (1, 1, 3))

    def test_a_streak_is_current_through_yesterday_and_not_the_day_before(self):
        sittings = [(ride(f"s{i}", T0 + i * DAY), "zebraride") for i in range(3)]
        h = pj.block(hand_cut(sittings, now=T0 + 3 * DAY + 3600), 30)["projects"][0]["history"]
        self.assertEqual((h["longest_streak_days"], h["current_streak_days"]), (3, 3))
        h = pj.block(hand_cut(sittings, now=T0 + 4 * DAY + 3600), 30)["projects"][0]["history"]
        self.assertEqual(h["current_streak_days"], 0)


class Weeks(unittest.TestCase):
    """The week axis and each project's sittings on it (`_week_axis`, `_weekly`, `_weeks`):
    what the phone's rivers and rank race draw, and nothing a week could not say."""

    @staticmethod
    def days(block: dict) -> list[dt.date]:
        return [dt.date.fromisoformat(w["week"][:10]) for w in block["weeks"]]

    def test_the_axis_is_mondays_through_this_week_and_never_before_the_first_sitting(self):
        b = pj.block(two_projects(), 30)
        weeks = self.days(b)
        self.assertEqual(weeks[0], pj.week_of(pf.local_day(T0, 0)))
        self.assertEqual(weeks[-1], pj.week_of(pf.local_day(NOW, 0)))
        self.assertTrue(all(w.weekday() == 0 for w in weeks))
        self.assertEqual([(y - x).days for x, y in zip(weeks, weeks[1:], strict=False)], [7] * (len(weeks) - 1))
        self.assertTrue(all(w["week"].endswith("T00:00:00Z") for w in b["weeks"]))

    def test_a_long_history_is_cut_to_the_last_weeks_and_its_old_sittings_stay_in_history(self):
        c = hand_cut([(ride("old", NOW - 200 * DAY), "zebraride"), (ride("new", NOW - DAY), "zebraride")], now=NOW)
        b = pj.block(c, 30)
        self.assertEqual(len(b["weeks"]), pj.WEEKS)
        h = b["projects"][0]["history"]
        self.assertEqual((h["sessions"], sum(w["sessions"] for w in h["weeks"])), (2, 1))
        # History reaches back past the first week on the axis, so that week is whole.
        self.assertEqual(b["weeks"][0]["days"], 7)

    def test_every_project_reads_on_the_same_weeks_every_week_present(self):
        b = pj.block(two_projects(), 30)
        axis = [w["week"] for w in b["weeks"]]
        for p in b["projects"]:
            self.assertEqual([w["week"] for w in p["history"]["weeks"]], axis)

    def test_the_weeks_add_up_to_history_and_the_axis_to_every_sitting(self):
        c = two_projects()
        b = pj.block(c, 30)
        for p in b["projects"]:
            h, ws = p["history"], p["history"]["weeks"]
            self.assertEqual(sum(w["sessions"] for w in ws), h["sessions"])
            self.assertAlmostEqual(sum(w["attended_seconds"] for w in ws), h["attended_seconds"], delta=len(ws))
            self.assertAlmostEqual(sum(w["active_seconds"] for w in ws), h["active_seconds"], delta=len(ws))
        # The axis counts every sitting, the one in no repository included.
        self.assertEqual(sum(w["sessions"] for w in b["weeks"]), len(c.facts))
        self.assertEqual(sum(w["sessions"] for w in b["weeks"]), sum(p["history"]["sessions"] for p in b["projects"]) + 1)
        self.assertAlmostEqual(sum(w["attended_seconds"] for w in b["weeks"]), sum(f.attended_seconds for f in c.facts), delta=len(b["weeks"]))

    def test_a_sitting_belongs_to_the_week_of_its_local_day_at_four(self):
        """Monday 03:30 is still Sunday's local day, so that sitting is last week's; an hour
        later is this week's. The first week counts from the first sitting's day, the current
        one through today."""
        monday = dt.datetime(2026, 9, 7, 3, 30, tzinfo=dt.UTC).timestamp()
        c = hand_cut(
            [(ride("early", monday), "zebraride"), (ride("late", monday + 3600), "zebraride")],
            now=monday + 3 * DAY + 2 * 3600,
        )
        b = pj.block(c, 30)
        weeks = b["projects"][0]["history"]["weeks"]
        self.assertEqual([w["week"][:10] for w in weeks], ["2026-08-31", "2026-09-07"])
        self.assertEqual([w["sessions"] for w in weeks], [1, 1])
        self.assertEqual([w["days"] for w in b["weeks"]], [1, 4])

    def test_a_quiet_week_is_a_measured_zero_and_a_week_history_never_reached_is_not_there(self):
        sittings = [
            (ride("r0", T0), "zebraride"),
            (ride("r1", T0 + 14 * DAY), "zebraride"),
            (build("b0", T0 + 14 * DAY + 6 * 3600), "builder"),
        ]
        b = pj.block(hand_cut(sittings, now=T0 + 15 * DAY), 30)
        self.assertEqual(self.days(b)[0], pj.week_of(pf.local_day(T0, 0)))
        by = by_key(b)
        self.assertEqual([w["sessions"] for w in by[key("zebraride")]["history"]["weeks"]], [1, 0, 1])
        # Builder's first sitting is in the third week; the two before it are measured zeroes.
        self.assertEqual([w["attended_seconds"] for w in by[key("builder")]["history"]["weeks"]], [0, 0, 1800])

    def test_no_sitting_is_no_axis(self):
        self.assertEqual(pj._week_axis([], dt.date(2026, 9, 13)), [])
        self.assertEqual(pj._weeks([], [], dt.date(2026, 9, 13)), [])

    def test_the_order_within_a_week_is_the_phones_to_draw(self):
        """No rank travels: the server drops an excluded project from the list, and a rank
        written here would keep its place in every week it led."""
        b = pj.block(two_projects(), 30)
        for p in b["projects"]:
            for w in p["history"]["weeks"]:
                self.assertEqual(set(w), {"week", "sessions", "attended_seconds", "active_seconds"})


class CommitsAndAgents(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.c = two_projects()
        cls.block = pj.block(cls.c, 30)
        cls.p = by_key(cls.block)

    def test_a_commit_is_assisted_only_by_a_sitting_in_its_own_repository(self):
        """The commit that landed while only a builder sitting ran is zebraride's own: the
        corpus graph calls it assisted (a sitting was running), the project calls it alone."""
        ride_ = self.p[key("zebraride")]["window"]["commits"]
        self.assertEqual((ride_["assisted"], ride_["alone"]), (3, 2))
        builder = self.p[key("builder")]["window"]["commits"]
        self.assertEqual((builder["assisted"], builder["alone"]), (1, 0))
        corpus = self.c.contributions
        self.assertEqual(corpus.assisted, 5)
        self.assertEqual(sum(p["window"]["commits"]["assisted"] + p["window"]["commits"]["alone"] for p in self.block["projects"]), corpus.total)
        self.assertLessEqual(sum(p["window"]["commits"]["assisted"] for p in self.block["projects"]), corpus.assisted)

    def test_two_checkouts_of_one_repository_are_one_project_and_each_commit_once(self):
        """One origin cloned into two directories the transcripts ran in: the same commits
        sit in both checkouts' logs, and the project counts each once."""
        same = [(T0 + 60, "fix: zebrasubject"), (T0 + DAY + 60, "feat: zebrasubject")]
        sittings = [(ride("a", T0), "zebraride", "/w/one"), (ride("b", T0 + DAY), "zebraride", "/w/two")]
        c = hand_cut(sittings, now=NOW, commits={"/w/one": same, "/w/two": [*same, (T0 + DAY + 90, "feat: only here")]})
        block = pj.block(c, 30)
        self.assertEqual(block["projects_total"], 1)
        commits = block["projects"][0]["window"]["commits"]
        self.assertEqual((commits["assisted"], commits["alone"]), (3, 0))
        self.assertEqual(len(c.commits), 5, "the corpus log holds both checkouts' copies")

    def test_an_agent_is_its_dispatchers_projects_only(self):
        """The two agents r0 sent are zebraride's and the one b0 sent is builder's: never
        all three in both."""
        self.assertEqual(self.p[key("zebraride")]["window"]["agents"]["agents"], 2)
        self.assertEqual(self.p[key("builder")]["window"]["agents"]["agents"], 1)

    def test_simultaneous_agents_in_two_projects_stay_apart(self):
        sittings = [(ride("a", T0), "zebraride"), (build("b", T0), "builder")]
        spans = [(span("x", T0 + 10), "a"), (span("y", T0 + 10), "b"), (span("z", T0 + 11), "b")]
        p = by_key(pj.block(hand_cut(sittings, now=NOW, spans=spans), 30))
        self.assertEqual((p[key("zebraride")]["window"]["agents"]["agents"], p[key("builder")]["window"]["agents"]["agents"]), (1, 2))

    def test_no_agent_is_null_and_not_a_block_of_zeroes(self):
        p = by_key(pj.block(two_projects(spans=[]), 30))
        self.assertIsNone(p[key("zebraride")]["window"]["agents"])

    def test_no_commit_read_is_null_and_not_a_graph_of_nothing(self):
        p = by_key(pj.block(two_projects(commits={}), 30))
        self.assertIsNone(p[key("zebraride")]["window"]["commits"])

    def test_the_harness_mix_names_the_contracts_tools(self):
        sittings = [(ride("a", T0), "zebraride"), (ride("b", T0 + DAY), "zebraride")]
        c = hand_cut(sittings, now=NOW)
        c.kept[1].harness = "codex"
        mix = pj.block(c, 30)["projects"][0]["window"]["harnesses"]
        self.assertEqual(sorted(h["harness"] for h in mix), ["claude_code", "codex"])
        self.assertEqual(sum(h["sessions"] for h in mix), 2)


class Comparisons(unittest.TestCase):
    A, B, C = key("a"), key("b"), key("c")

    def rows(self, a, b, na=pat.MIN_GROUP, nb=pat.MIN_GROUP):
        return [(self.A, 1, a, na), (self.B, 2, b, nb)]

    def test_under_the_sample_floor_it_refuses_with_the_floor(self):
        c = pj._comparison("steer_rate", self.rows(0.8, 0.2, nb=pat.MIN_GROUP - 1))
        self.assertEqual((c["reason"], c["projects"], c["needed"], c["high"], c["ratio"]), ("fewer_than_two_projects", 1, pat.MIN_GROUP, None, None))

    def test_a_metric_its_own_floor_refused_does_not_qualify(self):
        c = pj._comparison("steer_rate", self.rows(0.8, None))
        self.assertEqual((c["reason"], c["projects"]), ("fewer_than_two_projects", 1))

    def test_the_ratio_bar_is_the_findings_lift(self):
        under = pj._comparison("tool_calls_per_prompt", self.rows(1.39, 1.0))
        self.assertEqual(under["reason"], "within_noise")
        self.assertEqual((under["high_value"], under["low_value"]), (1.39, 1.0))
        at = pj._comparison("tool_calls_per_prompt", self.rows(pat.MIN_LIFT, 1.0))
        self.assertIsNone(at["reason"])
        self.assertEqual((at["high"], at["low"], at["ratio"]), (self.A, self.B, 1.4))

    def test_the_share_bar_is_points_not_a_ratio(self):
        """2% against 1% is a 2x lift and means nothing."""
        tiny = pj._comparison("night_share", self.rows(0.02, 0.01))
        self.assertEqual(tiny["reason"], "within_noise")
        real = pj._comparison("night_share", self.rows(0.36, 0.2))
        self.assertIsNone(real["reason"])
        self.assertEqual(real["gap"], 0.16)

    def test_a_measured_zero_has_its_own_form_where_the_sentence_has_one(self):
        c = pj._comparison("steer_rate", self.rows(0.3, 0.0))
        self.assertEqual((c["reason"], c["ratio"], c["low_value"]), (None, None, 0.0))
        self.assertIn("not once", pj.comparison_sentence(c, {self.A: "one", self.B: "two"}))
        # Lines an hour has no zero form: its own floor refuses 0 lines, so a 0 is no side.
        v = pj._comparison("code_velocity", self.rows(600.0, 0.0))
        self.assertEqual((v["reason"], v["projects"]), ("fewer_than_two_projects", 1))

    def test_the_extremes_are_compared_and_a_tie_goes_to_more_of_your_time(self):
        rows = [(self.A, 1, 2.0, 9), (self.B, 2, 5.0, 9), (self.C, 3, 2.0, 9)]
        c = pj._comparison("prompts_per_session", rows)
        self.assertEqual((c["high"], c["low"], c["projects"]), (self.B, self.C, 3))

    def test_two_floors_are_never_divided(self):
        """MEASURED (the constant's comment): 44 of builder's 66 test commands survive the
        digest's cut against 338 of RideGT's 718, so a ratio of the two floors said 2.1 where
        the full commands say 1.5. Both floors travel; no ratio, no gap, no difference."""
        for metric in ("test_runs_per_hour", "code_velocity"):
            c = pj._comparison(metric, self.rows(10.42, 4.84))
            self.assertEqual((c["reason"], c["ratio"], c["gap"]), ("floors_only", None, None), metric)
            self.assertEqual((c["high_value"], c["low_value"]), (10.42, 4.84))
            said = pj.comparison_sentence(c, {self.A: "one", self.B: "two"})
            self.assertIn("at least 10.4", said)
            self.assertNotIn("times", said)
        floors = {m for m, s in pj.COMPARISONS.items() if s.get("floor") == "yes"}
        self.assertEqual(floors, {"test_runs_per_hour", "code_velocity"})
        self.assertTrue(all("times" not in pj.COMPARISONS[m] for m in floors))

    def test_every_metric_once_in_order_and_each_value_from_a_block_the_project_carries(self):
        block = pj.block(two_projects(), 30)
        self.assertEqual([c["metric"] for c in block["comparisons"]], list(pj.COMPARISON_METRICS))
        p = by_key(block)
        ride_w, build_w = p[key("zebraride")]["window"], p[key("builder")]["window"]
        steer = next(c for c in block["comparisons"] if c["metric"] == "steer_rate")
        card = {c["id"]: c for c in ride_w["cards"]}["change_course"]
        values = {steer["high_value"], steer["low_value"]}
        self.assertIn(card["value"], values)
        usd = next(c for c in block["comparisons"] if c["metric"] == "usd_per_active_hour")
        self.assertEqual({usd["high_value"], usd["low_value"]}, {ride_w["money"]["usd_per_active_hour"], build_w["money"]["usd_per_active_hour"]})


class CostPerCommit(unittest.TestCase):
    def money(self, usd=100.0, unpriced=0) -> dict:
        return {"usd": usd, "unpriced_sessions": unpriced}

    def facts(self, commits: list[int], basis=pf.COMMITS_GIT_LOG) -> list[pf.SessionFact]:
        return [dataclasses.replace(fact(i, T0 + i * DAY), commit_count=k, commit_basis=basis) for i, k in enumerate(commits)]

    def test_dollars_over_the_commits_the_same_sittings_claimed(self):
        c = pj._cost_per_commit(self.money(100.0), self.facts([3, 2, 3]))
        self.assertEqual((c["usd"], c["commits"], c["reason"]), (12.5, 8, None))

    def test_each_refusal_in_order(self):
        self.assertEqual(pj._cost_per_commit(self.money(None), self.facts([9]))["reason"], "no_price")
        self.assertEqual(pj._cost_per_commit(self.money(unpriced=1), self.facts([9]))["reason"], "unpriced_sessions")
        self.assertEqual(pj._cost_per_commit(self.money(), self.facts([9], pf.COMMITS_TOOL_CALLS))["reason"], "commits_not_from_git")
        floor = pj._cost_per_commit(self.money(), self.facts([2, 2]))
        self.assertEqual((floor["reason"], floor["needed"], floor["usd"], floor["commits"]), ("below_commit_floor", co.MIN_COMMITS, None, 4))


class WhatMayTravel(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.result = pj.build(two_projects(), 30)
        cls.block = pj.wire(cls.result)
        cls.text = json.dumps(cls.block)

    def test_no_name_path_prompt_subject_or_manifest_string_travels(self):
        # Not "builder": the block's card ids say builder_type. The builder checkout's path
        # is caught by "/w/".
        for word in (*cf.SENTINELS, "zebraride", "zebrapath-kit", "/w/", "github.com"):
            self.assertNotIn(word, self.text, word)
        # ...and the names are right there on the machine, for the printer.
        self.assertIn("zebraride", [p.name for p in self.result["projects"]])

    def test_every_string_is_an_enum_value_a_clock_or_a_repository_key(self):
        values = {v for vs in SPEC["enums"].values() for v in vs}
        seen = 0

        def walk(obj):
            nonlocal seen
            if isinstance(obj, str):
                seen += 1
                if obj in values or (len(obj) == 64 and set(obj) <= set("0123456789abcdef")):
                    return
                dt.datetime.fromisoformat(obj.replace("Z", "+00:00"))
                self.assertTrue(obj.endswith("Z"), obj)
            elif isinstance(obj, dict):
                for v in obj.values():
                    walk(v)
            elif isinstance(obj, list):
                for v in obj:
                    walk(v)

        walk(self.block)
        self.assertGreater(seen, 50)

    def test_the_blocks_keys_are_the_specs_at_every_level(self):
        objects = SPEC["objects"]

        def walk(obj, name):
            spec = {f["name"]: f for f in objects[name]}
            if name != "ReportWrappedExtras":
                self.assertEqual(set(obj), set(spec), name)
            for k, v in obj.items():
                f = spec[k]
                if v is None:
                    self.assertTrue(f.get("nullable"), f"{name}.{k} is null and not nullable")
                elif f["type"] == "object":
                    walk(v, f["item"])
                elif f["type"] == "list" and f["item"] in objects:
                    self.assertLessEqual(len(v), f["max_items"], f"{name}.{k}")
                    for item in v:
                        walk(item, f["item"])
                elif f["type"] == "enum":
                    self.assertIn(v, SPEC["enums"][f["values"]], f"{name}.{k}")
                elif f["type"] == "double":
                    self.assertTrue(0 <= v <= 1, f"{name}.{k} = {v}")

        walk(self.block, "ReportProjects")

    def test_the_door_takes_the_block(self):
        """The generated Pydantic door, when pydantic is here (the server's venv)."""
        if importlib.util.find_spec("pydantic") is None:
            self.skipTest("pydantic is not installed for this interpreter")
        import sys

        spec = importlib.util.spec_from_file_location("_report_spec_door", ROOT / "server/builder/report_spec.py")
        mod = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = mod  # the models' postponed annotations resolve through it
        try:
            spec.loader.exec_module(mod)
            mod.ReportProjects(**self.block)
            # And a name where a key goes is refused at the door.
            named = json.loads(json.dumps(self.block))
            named["projects"][0]["key"] = "zebraride"
            with self.assertRaises(Exception):
                mod.ReportProjects(**named)
        finally:
            sys.modules.pop(spec.name, None)

    def test_the_tables_the_enums_copy_are_pinned_both_ways(self):
        E = SPEC["enums"]
        self.assertEqual(E["project_stage"], list(pj.STAGES))
        self.assertEqual(E["project_stage_rule"], list(pj.STAGE_RULES))
        self.assertEqual(E["momentum_refusal"], list(pj.MOMENTUM_REFUSALS))
        self.assertEqual(E["clock_refusal"], list(pj.CLOCK_REFUSALS))
        self.assertEqual(E["quality_refusal"], list(pj.QUALITY_REFUSALS))
        self.assertEqual(E["language_refusal"], list(pj.LANGUAGE_REFUSALS))
        self.assertEqual(E["cost_refusal"], list(pj.COST_REFUSALS))
        self.assertEqual(E["comparison_metric"], list(pj.COMPARISON_METRICS))
        self.assertEqual(E["comparison_refusal"], list(pj.COMPARISON_REFUSALS))
        self.assertEqual(E["language"], list(dict.fromkeys([*lang.EXTENSIONS.values(), *lang.BY_NAME.values(), "other"])))
        harness = next(f["values"] for f in CONTRACT["fields"] if f["name"] == "harness")
        self.assertEqual(E["harness"], harness)

    def test_every_refusal_code_has_its_template(self):
        for code in (*pj.QUALITY_REFUSALS, *pj.LANGUAGE_REFUSALS, *pj.CLOCK_REFUSALS, *pj.COST_REFUSALS):
            self.assertIn(code, pj.PROJECT_REFUSALS)
        self.assertEqual(set(pj.PROJECT_REFUSALS), {*pj.QUALITY_REFUSALS, *pj.LANGUAGE_REFUSALS, *pj.CLOCK_REFUSALS, *pj.COST_REFUSALS})
        self.assertEqual(set(pj.MOMENTUM_REFUSALS) | {"up", "down", "steady"}, set(pj.MOMENTUM_SENTENCES))

    def test_the_caps_hold_their_tables(self):
        caps = {(o, f["name"]): f.get("max_items") for o, fs in SPEC["objects"].items() for f in fs}
        self.assertEqual(caps[("ReportProjects", "projects")], pj.MAX_PROJECTS)
        self.assertEqual(caps[("ReportProjects", "comparisons")], len(pj.COMPARISON_METRICS))
        self.assertEqual(caps[("ReportProjectWindow", "cards")], len(pj.PROJECT_CARDS))
        self.assertEqual(caps[("ReportProjectWindow", "scores")], len(pf.ARCHETYPE_RULES))
        self.assertEqual(caps[("ReportProjectLanguages", "languages")], lang.TOP_N + 1)
        self.assertGreaterEqual(caps[("ReportProjectWindow", "harnesses")], len(SPEC["enums"]["harness"]))
        self.assertEqual(caps[("ReportProjectCommits", "days")], rp.MAX_DAYS)
        self.assertEqual(caps[("ReportProjects", "weeks")], pj.WEEKS)
        self.assertEqual(caps[("ReportProjectHistory", "weeks")], pj.WEEKS)


class Copy(unittest.TestCase):
    def strings(self, obj):
        if isinstance(obj, str):
            yield obj
        elif isinstance(obj, dict):
            for v in obj.values():
                yield from self.strings(v)
        elif isinstance(obj, (list, tuple)):
            for v in obj:
                yield from self.strings(v)

    def test_no_template_carries_a_dash(self):
        for table in (
            pj.COMPARISONS, pj.COMPARISON_REFUSALS, pj.PROJECT_REFUSALS, pj.STAGE_DISPLAY,
            pj.STAGE_SENTENCES, pj.LAST_SESSION, pj.MOMENTUM_SENTENCES,
        ):  # fmt: skip
            for s in self.strings(table):
                self.assertFalse(plain.has_dash(s), s)

    def test_the_fixture_reaches_every_metric_form_rule_state_and_code(self):
        es = pfx.entries()
        comp = [e["input"] for e in es if e["kind"] == "comparison"]
        floors = {m for m, s in pj.COMPARISONS.items() if s.get("floor") == "yes"}
        self.assertEqual({c["metric"] for c in comp if c["reason"] is None}, set(pj.COMPARISON_METRICS) - floors)
        self.assertEqual({c["metric"] for c in comp if c["reason"] == "floors_only"}, floors)
        self.assertEqual({c["reason"] for c in comp} - {None}, set(pj.COMPARISON_REFUSALS))
        nones = {c["metric"] for c in comp if c["reason"] is None and c["ratio"] is None and pj.COMPARISONS[c["metric"]]["kind"] == "ratio"}
        self.assertEqual(nones, {m for m, s in pj.COMPARISONS.items() if "none" in s})
        self.assertEqual({e["input"]["stage_rule"] for e in es if e["kind"] == "stage"}, set(pj.STAGE_RULES))
        states = {e["input"]["reason"] or e["input"]["direction"] for e in es if e["kind"] == "momentum"}
        self.assertEqual(states, set(pj.MOMENTUM_SENTENCES))
        self.assertEqual({e["input"]["reason"] for e in es if e["kind"] == "refusal"}, set(pj.PROJECT_REFUSALS))
        for e in es:
            self.assertFalse(plain.has_dash(e["sentence"]), e["sentence"])
            self.assertNotIn("None", e["sentence"])

    def test_the_fixtures_inputs_are_the_specs_shapes(self):
        objects = SPEC["objects"]
        comparison = {f["name"] for f in objects["ReportProjectComparison"]}
        momentum = {f["name"] for f in objects["ReportProjectMomentum"]}
        history = {f["name"] for f in objects["ReportProjectHistory"]}
        for e in pfx.entries():
            if e["kind"] == "comparison":
                self.assertEqual(set(e["input"]), comparison)
            elif e["kind"] == "momentum":
                self.assertEqual(set(e["input"]), momentum)
            elif e["kind"] == "stage":
                self.assertLessEqual(set(e["input"]), history)

    def test_the_committed_fixture_is_what_gen_copy_writes(self):
        spec = importlib.util.spec_from_file_location("gen_copy", ROOT / "scripts/gen_copy.py")
        gen = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gen)
        on_disk = json.loads((ROOT / "spec/fixtures/projects/sentences.json").read_text())
        self.assertEqual(on_disk, json.loads(json.dumps(gen.project_entries())))
        block = json.loads((ROOT / "spec/fixtures/projects/block.json").read_text())
        self.assertEqual(block, json.loads(json.dumps(pfx.block())))

    def test_twice_is_said_once_the_ratio_says_two(self):
        self.assertEqual(pj.times_words(2.0), "twice")
        self.assertEqual(pj.times_words(2.04), "twice")
        self.assertEqual(pj.times_words(2.15), "2.1 times")  # the double below 2.15, as Python rounds it
        self.assertEqual(pj.times_words(10.08), "10.1 times")


# ======================================================================== end to end
def git(cwd: pathlib.Path, *args: str, at: float | None = None) -> None:
    env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.invalid",
        "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.invalid",
        "GIT_CONFIG_NOSYSTEM": "1", "HOME": str(cwd),
    }  # fmt: skip
    if at is not None:
        env["GIT_AUTHOR_DATE"] = env["GIT_COMMITTER_DATE"] = f"@{int(at)} +0000"
    subprocess.run(
        ["git", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", *args],
        cwd=cwd, env=env, check=True, capture_output=True, text=True,
    )  # fmt: skip


def repo(base: pathlib.Path, name: str, origin: str, commits: list[tuple[float, str]]) -> pathlib.Path:
    d = base / name
    d.mkdir()
    git(d, "init", "-q")
    git(d, "remote", "add", "origin", origin)
    for i, (at, subject) in enumerate(sorted(commits)):
        (d / f"f{i}.txt").write_text(f"{i}\n")
        git(d, "add", f"f{i}.txt")
        git(d, "commit", "-q", "-m", subject, at=at)
    return d


E2E_NOW = 1_789_300_000.0  # 2026-09-13 11:46:40 UTC


class EndToEnd(unittest.TestCase):
    """Synthetic transcripts through the real parser and `corpus.cut`: two repositories
    with origins and dated commits, and a sitting in a directory that is no repository."""

    @classmethod
    def setUpClass(cls):
        from analysis.tests import test_cli as tc
        from capture import identity
        from capture import repo as cap_repo
        from capture.tuning import REPO_HASH_PREFIX, REPO_PEPPER

        cls.tmp = tempfile.TemporaryDirectory()
        base = pathlib.Path(os.path.realpath(cls.tmp.name))
        d = lambda k: E2E_NOW - k * DAY  # noqa: E731
        ride_commits = [
            (d(60), "zebrasubject first"),
            (d(3) + 7, "fix: zebrasubject in the sitting"),
            (d(10), "zebrasubject on a quiet day"),
            (d(2) + 6 * 3600 + 5, "zebrasubject while only builder ran"),
        ]
        cls.ride = repo(base, "RideGT", "https://github.com/me/zebraride.git", ride_commits)
        cls.builder = repo(base, "builder", "git@github.com:me/builder.git", [(d(60), "init"), (d(2) + 6 * 3600 + 9, "feat: schema")])
        home = base / "home"
        home.mkdir()
        projects = base / "projects"
        # One native session id per transcript: capture folds every record of one id into
        # one lineage, so three files sharing the helper's default id would be one pool.
        sids = {n: f"5b1f6c2e-0000-4000-8000-0000000000{n}" for n in ("a1", "b1", "c1")}
        rec = []
        for k in (45, 3, 2, 1):
            rec += tc.records(d(k), sid=sids["a1"], ids=f"r{k}", cwd=str(cls.ride))
        tc.write(projects, rec, project="-ride", sid=sids["a1"])
        tc.write(projects, tc.records(d(2) + 6 * 3600, sid=sids["b1"], ids="b", cwd=str(cls.builder)), project="-builder", sid=sids["b1"])
        tc.write(projects, tc.records(d(1) + 3600, sid=sids["c1"], ids="h", cwd=str(home)), project="-home", sid=sids["c1"])
        cls.keys = {
            "ride": identity.repo_hash(cap_repo.normalize_origin("https://github.com/me/zebraride.git"), REPO_PEPPER, REPO_HASH_PREFIX),
            "builder": identity.repo_hash("github.com/me/builder", REPO_PEPPER, REPO_HASH_PREFIX),
        }
        before = os.environ.pop("BUILDER_CAPTURE_EXCLUDE", None)
        try:
            cls.c = cp.cut_root(projects, tz=dt.UTC, now=E2E_NOW)
            os.environ["BUILDER_CAPTURE_EXCLUDE"] = "github.com/me/builder"
            cls.excluded = cp.cut_root(projects, tz=dt.UTC, now=E2E_NOW)
        finally:
            os.environ.pop("BUILDER_CAPTURE_EXCLUDE", None)
            if before is not None:
                os.environ["BUILDER_CAPTURE_EXCLUDE"] = before
        cls.result = pj.build(cls.c, 30)
        cls.block = pj.wire(cls.result)
        cls.p = by_key(cls.block)
        cls.projects = projects

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_each_repository_is_one_project_under_the_key_its_sessions_upload(self):
        self.assertEqual(set(self.p), set(self.keys.values()))
        self.assertEqual(self.block["unresolved"]["history_sessions"], 1)
        self.assertEqual(self.block["unresolved"]["sessions"], 1)

    def test_history_holds_the_old_sitting_and_the_window_does_not(self):
        r = self.p[self.keys["ride"]]
        self.assertEqual((r["history"]["sessions"], r["window"]["sessions"]), (4, 3))
        self.assertEqual(self.p[self.keys["builder"]]["history"]["sessions"], 1)

    def test_commits_come_from_git_and_are_split_by_this_projects_sittings(self):
        """In the window: the commit inside a RideGT sitting is assisted; the quiet day's
        and the one that landed while only builder ran are alone; the old one is outside."""
        r = self.p[self.keys["ride"]]["window"]["commits"]
        self.assertEqual((r["assisted"], r["alone"]), (1, 2))
        b = self.p[self.keys["builder"]]["window"]["commits"]
        self.assertEqual((b["assisted"], b["alone"]), (1, 0))

    def test_the_stage_and_the_names_stay_where_they_belong(self):
        r = self.p[self.keys["ride"]]
        self.assertEqual((r["history"]["stage"], r["history"]["days_since_last"]), ("active", 1))
        self.assertEqual(r["window"]["harnesses"][0]["harness"], "claude_code")
        names = {p.key: p.name for p in self.result["projects"]}
        self.assertEqual(names[self.keys["ride"]], "zebraride")
        self.assertNotIn("zebraride", json.dumps(self.block))
        self.assertNotIn("RideGT", json.dumps(self.block))

    def test_the_report_carries_the_same_block(self):
        doc, _ = rp.from_corpus(self.c, 30)
        self.assertEqual(doc["projects"], self.block)
        self.assertEqual(doc["report_version"], 3)

    def test_an_excluded_repository_is_no_project_at_all(self):
        block = pj.block(self.excluded, 30)
        self.assertEqual({p["key"] for p in block["projects"]}, {self.keys["ride"]})
        self.assertNotIn(self.keys["builder"], json.dumps(block))

    def test_the_cli_prints_the_block_and_names_only_on_the_terminal(self):
        import argparse

        from analysis import __main__ as cli

        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            cli._projects(argparse.Namespace(path=str(self.projects), days=None, json=False, wire=True))
        # The cut's clock is the wall clock here, so only the shape is compared.
        wire = json.loads(out.getvalue())
        self.assertEqual({p["key"] for p in wire["projects"]}, set(self.keys.values()))
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            cli._print_projects(self.result)
        text = out.getvalue()
        self.assertIn("zebraride", text)
        self.assertIn("HOW THE PROJECTS COMPARE", text)
        for line in text.splitlines():
            self.assertFalse(plain.has_dash(line), line)
            self.assertNotIn("None", line)


if __name__ == "__main__":
    unittest.main()
