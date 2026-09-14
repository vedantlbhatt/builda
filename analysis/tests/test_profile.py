"""The corpus profile: the numbers, the refusals to produce a number, and the facts.

Every case here is one a person could recompute by hand from the events in the test.
The refusals matter as much as the values: a metric whose sample is too small, or whose
input is structurally absent, must come back None with a reason rather than 0.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
import unittest

from analysis import profile as pf
from analysis.digest import Ev

HOUR = 3600.0
DAY = 24 * HOUR
#: 2026-09-01 09:00:00 UTC, a Tuesday. Every timestamp below is an offset from it.
T0 = dt.datetime(2026, 9, 1, 9, 0, tzinfo=dt.UTC).timestamp()


def has_dash(text: str) -> bool:
    """`plain.has_dash`, the one definition of a dash (docs/overnight-engine.md 1.1): an em
    dash, an en dash, or a hyphen with space on both sides."""
    from analysis import plain

    return plain.has_dash(text)


def ev(n, ts, kind, text="", tool=None, added=None):
    return Ev(n, ts, kind, text, tool=tool, added=added)


def session(
    events,
    *,
    session_id="s",
    start=T0,
    end=None,
    attended=HOUR,
    autonomous=0.0,
    tz=0,
    tokens=None,
):
    return pf.session_fact_from_events(
        session_id=session_id,
        events=events,
        started_at=start,
        ended_at=end if end is not None else start + attended + autonomous,
        attended_seconds=attended,
        autonomous_seconds=autonomous,
        tz_offset_minutes=tz,
        output_tokens_by_model=tokens or {},
    )


def prompt_session(texts, *, opener="assistant", **kw):
    """One session: each prompt answered by `opener` and then a tool call."""
    events, n, t = [], 0, 0.0
    for text in texts:
        events.append(ev(n, kw.get("start", T0) + t, "prompt", text))
        n, t = n + 1, t + 60
        events.append(
            ev(n, kw.get("start", T0) + t, opener, "ok", tool="Bash" if opener == "tool" else None)
        )
        n, t = n + 1, t + 60
        events.append(ev(n, kw.get("start", T0) + t, "tool", "ls", tool="Bash"))
        n, t = n + 1, t + 60
    return session(events, **kw)


class Corrective(unittest.TestCase):
    def test_the_two_hand_checked_false_positives_stay_unflagged(self):
        """MEASURED on the container corpus: bare `not` and bare `stop` flagged these two
        directives as corrections. Both markers were narrowed; both must stay clean."""
        self.assertEqual(
            pf.correction_markers("Yeah do all of that and keep working do not stop until tested"),
            [],
        )
        self.assertEqual(pf.correction_markers("status <100 words whats done and whats not"), [])

    def test_real_redirects_are_flagged(self):
        for text in (
            "It's in builder do you not see it",
            "Dude I mean literally everything. Go back to my original prompt",
            "why no railway deploy? what is cline?",
            "wtf it should work with just the app",
        ):
            self.assertTrue(pf.is_corrective(text), text)

    def test_a_marker_past_the_window_does_not_flag_a_long_brief(self):
        brief = " ".join(["build the uploader and keep going"] * 10) + " no"
        self.assertEqual(pf.correction_markers(brief), [])


class MetricsFromEvents(unittest.TestCase):
    def test_planning_ratio_counts_prose_first_against_tool_first(self):
        prose = prompt_session(["plan the sync"] * 6, opener="assistant", session_id="a")
        tools = prompt_session(["do it"] * 3, opener="tool", session_id="b", start=T0 + 4 * HOUR)
        p = pf.corpus_profile([prose, tools, session([], session_id="c", start=T0 + 9 * HOUR)])
        m = p["metrics"]["planning_ratio"]
        self.assertEqual((m["planning_prompts"], m["execution_prompts"]), (6, 3))
        self.assertEqual(m["value"], 2.0)

    def test_planning_ratio_is_none_when_nothing_went_straight_to_a_tool(self):
        """The suggested (assistant turns before the first EDIT) form is exactly this on
        the container corpus: a zero denominator, which is not a number."""
        p = pf.corpus_profile(
            [
                prompt_session(["a"] * 5, session_id="a"),
                prompt_session(["b"] * 5, session_id="b", start=T0 + 4 * HOUR),
                session([], session_id="c", start=T0 + 9 * HOUR),
            ]
        )
        m = p["metrics"]["planning_ratio"]
        self.assertIsNone(m["value"])
        self.assertIn("zero denominator", m["reason"])

    def test_steer_rate_counts_an_interrupt_and_its_redirect_once(self):
        events = [
            ev(0, T0, "prompt", "build the uploader"),
            ev(1, T0 + 10, "assistant", "on it"),
            ev(2, T0 + 20, "interrupt"),
            ev(3, T0 + 30, "prompt", "no, stop, do the other one"),  # corrective AND after
            ev(4, T0 + 40, "assistant", "ok"),
            ev(5, T0 + 50, "prompt", "why are we using swift"),  # corrective on its own
            ev(6, T0 + 60, "assistant", "ok"),
            ev(7, T0 + 70, "prompt", "keep going"),
            ev(8, T0 + 80, "assistant", "ok"),
            ev(9, T0 + 90, "prompt", "and push it"),
            ev(10, T0 + 100, "assistant", "ok"),
        ]
        p = pf.corpus_profile([session(events)])
        m = p["metrics"]["steer_rate"]
        self.assertEqual((m["interrupts"], m["corrective_prompts"]), (1, 1))
        self.assertEqual(m["value"], round(2 / 5, 3))

    def test_prompt_shape(self):
        texts = ["one two three"] * 3 + ["a much longer prompt " * 5] * 3
        p = pf.corpus_profile([prompt_session(texts)])
        self.assertEqual(p["metrics"]["short_prompt_share"]["value"], 0.5)
        self.assertIsNotNone(p["metrics"]["median_prompt_chars"]["value"])

    def test_iteration_depth_and_tool_totals(self):
        p = pf.corpus_profile([prompt_session(["a", "b", "c", "d", "e"])])
        self.assertEqual(p["totals"]["total_tool_calls"], 5)
        self.assertEqual(p["metrics"]["iteration_depth"]["value"], 1.0)

    def test_tool_calls_per_prompt_reads_the_attended_sittings_on_both_sides(self):
        """FOUND IN THE CAPTURE (2026-09-14): 11.7 on the card and 12.4 on the trend for one
        window. An unattended run sends no prompt, so its tool calls answer none of them: 5
        prompts and 5 calls with a person there, 40 calls in a run nobody was at, is 1 call a
        prompt, never 9."""
        at = prompt_session(["a", "b", "c", "d", "e"], session_id="at")
        run_events = [ev(100 + i, T0 + 7200 + i * 30, "tool", "ls", tool="Bash") for i in range(40)]
        run = dataclasses.replace(
            session(run_events, session_id="run", start=T0 + 7200, attended=0.0, autonomous=HOUR),
            unattended=True,
        )
        p = pf.corpus_profile([at, run])
        self.assertEqual(p["totals"]["total_tool_calls"], 45)
        self.assertEqual(p["metrics"]["iteration_depth"]["value"], 1.0)
        self.assertEqual(pf.tool_calls_per_prompt([at, run])["value"], 1.0)

    def test_the_card_and_the_metric_are_one_number(self):
        from analysis import wrapped as wr

        facts = [prompt_session(["a"] * (3 + i), session_id=f"s{i}", start=T0 + i * 7200) for i in range(pf.MIN_SESSIONS + 1)]
        run_events = [ev(900 + i, T0 + 90_000 + i * 30, "tool", "ls", tool="Bash") for i in range(60)]
        facts.append(
            dataclasses.replace(
                session(run_events, session_id="run", start=T0 + 90_000, attended=0.0, autonomous=HOUR),
                unattended=True,
            )
        )
        card = wr._prompts_per_session(facts)
        self.assertEqual(card["extras"]["tool_calls_per_prompt"], pf.corpus_profile(facts)["metrics"]["iteration_depth"]["value"])

    def test_code_velocity_refuses_zero_rather_than_reporting_it(self):
        events = [ev(i, T0 + i * 60, "tool", "ls", tool="Bash") for i in range(10)]
        p = pf.corpus_profile([session(events, attended=2 * HOUR)])
        m = p["metrics"]["code_velocity"]
        self.assertIsNone(m["value"])
        self.assertIn("would read as", m["reason"])

    def test_code_velocity_is_lines_over_active_hours(self):
        events = [
            ev(i, T0 + i * 60, "tool", "cat > a.py <<'EOF'", tool="Bash", added=30)
            for i in range(10)
        ]
        p = pf.corpus_profile([session(events, attended=2 * HOUR)])
        self.assertEqual(p["metrics"]["code_velocity"]["value"], 150.0)

    def test_code_velocity_needs_something_behind_the_number(self):
        """MEASURED on the proof database: 33 attributed lines over 4.4 hours read as 7.6
        lines an hour, while the same seven sittings credit 2,300 lines when the
        transcripts are read. 7.6 is a wrong number, not a small one."""
        events = [ev(0, T0, "tool", "cat > a.py <<'EOF'", tool="Bash", added=33)]
        p = pf.corpus_profile([session(events, attended=2 * HOUR)])
        m = p["metrics"]["code_velocity"]
        self.assertIsNone(m["value"])
        self.assertIn("too little to read as a rate", m["reason"])

    def test_a_line_total_too_large_to_be_an_artefact_is_a_rate_even_uncounted(self):
        """The stored rows carry one line total and no tool names, so the writes behind it
        cannot be counted. 2,000 lines over 2 hours is still a rate; 33 is not."""
        big = pf.SessionFact(
            session_id="a",
            started_at=T0,
            ended_at=T0 + 2 * HOUR,
            active_seconds=2 * HOUR,
            attended_seconds=2 * HOUR,
            autonomous_seconds=0,
            lines_added_agent=2000,
            lines_basis=pf.LINES_UPLOADED,
            write_events=None,
        )
        small = dataclasses.replace(big, lines_added_agent=33)
        self.assertEqual(pf.corpus_profile([big])["metrics"]["code_velocity"]["value"], 1000.0)
        refused = pf.corpus_profile([small])["metrics"]["code_velocity"]
        self.assertIsNone(refused["value"])
        self.assertIn("cannot be counted here", refused["reason"])


class Clocks(unittest.TestCase):
    def test_night_share_splits_a_session_across_the_clock(self):
        """20:00 to 02:00 local: two evening hours, four night ones, so 4/6 of the active
        time is night even though the session started in the evening."""
        start = dt.datetime(2026, 9, 1, 20, 0, tzinfo=dt.UTC).timestamp()
        s = session([], start=start, end=start + 6 * HOUR, attended=6 * HOUR)
        p = pf.corpus_profile([s])
        self.assertAlmostEqual(p["metrics"]["night_share"]["value"], round(4 / 6, 3), places=2)

    def test_peak_hour_is_the_local_hour_holding_the_most_active_time(self):
        start = dt.datetime(2026, 9, 1, 14, 0, tzinfo=dt.UTC).timestamp()
        long_at_two = session([], session_id="a", start=start, end=start + HOUR, attended=HOUR)
        short_at_nine = session(
            [], session_id="b", start=start + 7 * HOUR, end=start + 7 * HOUR + 600, attended=600
        )
        p = pf.corpus_profile([long_at_two, short_at_nine])
        self.assertEqual(p["metrics"]["peak_hour"]["value"], 14)

    def test_the_local_day_starts_at_four_in_the_morning(self):
        two_am = dt.datetime(2026, 9, 2, 2, 0, tzinfo=dt.UTC).timestamp()
        self.assertEqual(pf.local_day(two_am, 0), dt.date(2026, 9, 1))
        five_am = dt.datetime(2026, 9, 2, 5, 0, tzinfo=dt.UTC).timestamp()
        self.assertEqual(pf.local_day(five_am, 0), dt.date(2026, 9, 2))

    def test_streak_counts_consecutive_local_days(self):
        days = [session([], session_id=str(i), start=T0 + i * 24 * HOUR) for i in (0, 1, 2, 5)]
        p = pf.corpus_profile(days)
        self.assertEqual(p["metrics"]["longest_streak_days"]["value"], 3)
        self.assertEqual(p["sample"]["days"], 4)

    def test_an_unattended_run_never_bridges_a_streak(self):
        """docs/overnight-engine.md 5.4: attended days 1 and 3, an unattended run on day 2.
        The streak is 1, not 3. MEASURED on the real corpus: 21 before, 11 after."""
        facts = [
            session([], session_id="d1", start=T0),
            dataclasses.replace(
                session([], session_id="d2", start=T0 + DAY, attended=0.0, autonomous=HOUR),
                unattended=True,
            ),
            session([], session_id="d3", start=T0 + 2 * DAY),
        ]
        m = pf.corpus_profile(facts)["metrics"]["longest_streak_days"]
        self.assertEqual(m["value"], 1)
        self.assertEqual(m["basis"], "local_days_at_04h_attended")
        self.assertEqual(m["n"], 2, "n is the attended days the streak was read from")

    def test_days_built_still_counts_the_unattended_day(self):
        """`sample.days` stays "days built": unattended runs count toward hours."""
        facts = [
            session([], session_id="d1", start=T0),
            dataclasses.replace(
                session([], session_id="d2", start=T0 + DAY, attended=0.0, autonomous=HOUR),
                unattended=True,
            ),
        ]
        self.assertEqual(pf.corpus_profile(facts)["sample"]["days"], 2)

    def test_a_day_with_zero_attended_seconds_is_not_attended_under_either_definition(self):
        """`capture/sessions.build_payload` only calls a sitting unattended above a minimum
        length, so a short unattended run can arrive with `unattended=False` and no attended
        seconds. It must not bridge a streak either."""
        facts = [
            session([], session_id="d1", start=T0),
            session([], session_id="d2", start=T0 + DAY, attended=0.0, autonomous=600.0),
            session([], session_id="d3", start=T0 + 2 * DAY),
        ]
        self.assertEqual(pf.corpus_profile(facts)["metrics"]["longest_streak_days"]["value"], 1)

    def test_a_streak_with_nobody_present_is_refused_with_a_reason(self):
        robot = dataclasses.replace(
            session([], session_id="r", attended=0.0, autonomous=HOUR), unattended=True
        )
        m = pf.corpus_profile([robot])["metrics"]["longest_streak_days"]
        self.assertIsNone(m["value"])
        self.assertIn("unattended run never counts toward a streak", m["reason"])
        empty = pf.corpus_profile([])["metrics"]["longest_streak_days"]
        self.assertIsNone(empty["value"])
        self.assertEqual(empty["reason"], "no sessions")

    def test_the_streak_fact_says_you_were_there(self):
        facts = [session([], session_id=str(i), start=T0 + i * DAY) for i in range(3)]
        texts = [f["text"] for f in pf.corpus_profile(facts)["facts"]]
        self.assertIn("3 days in a row with a session you were at", texts)

    def test_autonomy_score_is_the_second_clock_over_both(self):
        s = session([], attended=HOUR, autonomous=3 * HOUR)
        self.assertEqual(pf.corpus_profile([s])["metrics"]["autonomy_score"]["value"], 0.75)


class Refusals(unittest.TestCase):
    def test_a_small_sample_returns_none_with_a_reason(self):
        p = pf.corpus_profile([session([ev(0, T0, "prompt", "hi")], attended=60)])
        for key in ("avg_prompt_chars", "autonomy_score", "night_share", "code_velocity"):
            self.assertIsNone(p["metrics"][key]["value"], key)
            self.assertTrue(p["metrics"][key]["reason"], key)
        self.assertIn("avg_prompt_chars", p["sample"]["missing"])

    def test_no_sessions_at_all_is_empty_rather_than_an_error(self):
        p = pf.corpus_profile([])
        self.assertEqual(p["totals"]["total_sessions"], 0)
        self.assertIsNone(p["archetype"]["name"])
        self.assertFalse(p["sample"]["enough_sessions"])

    def test_tool_diversity_is_refused_on_an_allowlisted_tool_map(self):
        facts = [
            pf.SessionFact(
                session_id=str(i),
                started_at=T0 + i * HOUR,
                ended_at=T0 + (i + 1) * HOUR,
                active_seconds=HOUR,
                attended_seconds=HOUR,
                autonomous_seconds=0,
                tool_calls={"Bash": 20, "Read": 5},
                tool_basis=pf.TOOLS_ALLOWLIST,
            )
            for i in range(4)
        ]
        m = pf.corpus_profile(facts)["metrics"]["tool_diversity"]
        self.assertIsNone(m["value"])
        self.assertIn("only the names of common tools", m["reason"])

    def test_the_reasons_a_person_reads_carry_no_engine_words(self):
        """`sample.missing` is printed on the phone as it is (What this cannot see). FOUND IN
        THE CAPTURE (2026-09-14): "bucketed to an allowlist" and "the strip marks are deduped
        for rendering" were on screen."""
        facts = [
            pf.SessionFact(
                session_id=str(i),
                started_at=T0 + i * HOUR,
                ended_at=T0 + (i + 1) * HOUR,
                active_seconds=HOUR,
                attended_seconds=HOUR,
                autonomous_seconds=0,
                tool_calls={"Bash": 20, "Read": 5},
                tool_basis=pf.TOOLS_ALLOWLIST,
            )
            for i in range(4)
        ]
        missing = pf.corpus_profile(facts)["sample"]["missing"]
        self.assertIn("night_commit_share", missing)
        for key, reason in missing.items():
            for word in ("allowlist", "bucket", "dedup", "digest", "render", "corpus", "strip"):
                self.assertNotIn(word, reason.lower(), f"{key}: {reason}")

    def test_a_model_with_no_output_tokens_is_not_in_the_mix(self):
        s = session([], tokens={"claude-opus-5": 100, "<synthetic>": 0})
        mix = pf.corpus_profile([s])["model_mix"]
        self.assertEqual([m["model"] for m in mix], ["claude-opus-5"])


class Archetype(unittest.TestCase):
    def _corpus(self, night: bool) -> list[pf.SessionFact]:
        hour = 22 if night else 10
        out = []
        for i in range(4):
            start = dt.datetime(2026, 9, 1 + i, hour, tzinfo=dt.UTC).timestamp()
            out.append(session([], session_id=str(i), start=start, attended=4 * HOUR))
        return out

    def test_night_owl_wins_on_its_threshold_and_names_its_runners_up(self):
        a = pf.corpus_profile(self._corpus(night=True))["archetype"]
        self.assertEqual(a["name"], "night_owl")
        self.assertEqual(a["metric"], "night_share")
        self.assertGreater(a["confidence"], 0)
        self.assertLessEqual(len(a["runners_up"]), 2)
        # Every rule reports its score, including the ones that could not be computed.
        self.assertEqual(len(a["scores"]), len(pf.ARCHETYPE_RULES))

    def test_no_rule_met_means_no_archetype(self):
        a = pf.corpus_profile(self._corpus(night=False))["archetype"]
        self.assertIsNone(a["name"])
        self.assertEqual(a["reason"], "no archetype rule met its threshold")

    def test_the_archetype_object_has_one_shape_whether_or_not_a_rule_won(self):
        won = pf.corpus_profile(self._corpus(night=True))["archetype"]
        lost = pf.corpus_profile(self._corpus(night=False))["archetype"]
        self.assertEqual(set(won), set(lost))
        self.assertIsNone(lost["metric"])

    def test_two_sessions_is_not_a_profile(self):
        a = pf.corpus_profile(self._corpus(night=True)[:2])["archetype"]
        self.assertIsNone(a["name"])
        self.assertIn("fewer than", a["reason"])


class Facts(unittest.TestCase):
    def _profile(self):
        events = [
            ev(0, T0, "prompt", "why are we using swift"),
            ev(1, T0 + 10, "assistant", "because"),
            ev(2, T0 + 20, "tool", "cat > a.py <<'EOF'", tool="Bash", added=500),
            ev(3, T0 + 30, "prompt", "no, do the other one"),
            ev(4, T0 + 40, "tool", "ls", tool="Bash"),
            ev(5, T0 + 50, "prompt", "keep going"),
            ev(6, T0 + 60, "assistant", "ok"),
            ev(7, T0 + 70, "prompt", "and push"),
            ev(8, T0 + 80, "assistant", "ok"),
            ev(9, T0 + 90, "prompt", "ship it"),
            ev(10, T0 + 100, "assistant", "ok"),
        ]
        facts = [
            session(events, session_id="a", attended=2 * HOUR, tokens={"claude-opus-5": 1000}),
            session([], session_id="b", start=T0 + 30 * HOUR, attended=HOUR, autonomous=HOUR),
            session([], session_id="c", start=T0 + 60 * HOUR, attended=HOUR),
        ]
        return pf.corpus_profile(facts)

    def test_no_user_facing_string_contains_a_dash_the_user_hates(self):
        """The rule is absolute: em dashes, en dashes and spaced hyphens never reach a
        person."""
        p = self._profile()
        strings = [f["text"] for f in p["facts"]]
        strings += [str(v.get("reason")) for v in p["metrics"].values()]
        strings.append(str(p["archetype"].get("reason")))
        for s in strings:
            self.assertNotIn("—", s)
            self.assertNotIn("–", s)
            self.assertFalse(has_dash(s), s)

    def test_facts_are_ranked_by_distance_from_a_documented_baseline(self):
        p = self._profile()
        scores = [f["unusualness"] for f in p["facts"]]
        self.assertEqual(scores, sorted(scores, reverse=True))
        for f in p["facts"]:
            # One shape for every fact: `baseline` is a key even when it is null.
            self.assertEqual(
                {"id", "text", "value", "unit", "unusualness", "baseline"} - set(f), set()
            )

    def test_every_ranked_fact_names_a_number_in_its_sentence(self):
        for f in self._profile()["facts"]:
            self.assertTrue(any(ch.isdigit() for ch in f["text"]), f["text"])

    def test_the_model_default_fact_names_the_model(self):
        texts = [f["text"] for f in self._profile()["facts"]]
        self.assertTrue(any("You default to Opus" in t for t in texts), texts)


if __name__ == "__main__":
    unittest.main()


class CommitsCannotSimplyBeSummed(unittest.TestCase):
    """Two sessions running at once in one repo both count the commits in the overlap.

    MEASURED on this container, 2026-09-06: eleven Claude Code sessions summed to 98
    commits where `git log` over the same day counted 75. One session ran 05:45 to 05:57
    entirely inside another running 04:55 to 06:17; two more sat inside a third; and two
    23:0x sessions covered the same three commits. The per-session number is right, and it
    is the SUM that is the wrong number, which is exactly the failure this repo names first.
    """

    @staticmethod
    def _fact(session_id: str, start: float, end: float, commits: int, repo: str | None):
        return pf.SessionFact(
            session_id=session_id,
            started_at=start,
            ended_at=end,
            active_seconds=end - start,
            attended_seconds=end - start,
            autonomous_seconds=0.0,
            commit_count=commits,
            commit_basis=pf.COMMITS_GIT_LOG,
            repo=repo,
        )

    def test_disjoint_windows_in_one_repo_sum_exactly(self):
        day = 1_780_000_000.0
        far = day + 4 * pf.COMMIT_ATTRIBUTION_SEC
        p = pf.corpus_profile(
            [self._fact("a", day, day + 600, 5, "r1"), self._fact("b", far, far + 600, 4, "r1")]
        )
        self.assertEqual(p["totals"]["total_commits"], 9)
        self.assertEqual(p["totals"]["commit_basis"], pf.COMMITS_GIT_LOG)

    def test_an_overlap_in_one_repo_refuses_the_total(self):
        day = 1_780_000_000.0
        p = pf.corpus_profile(
            [
                self._fact("a", day, day + 4_800, 19, "r1"),
                # 05:45 inside 04:55 to 06:17, the real shape from the container.
                self._fact("b", day + 3_000, day + 3_700, 6, "r1"),
            ]
        )
        # None, never 0: a zero here reads as "you committed nothing".
        self.assertIsNone(p["totals"]["total_commits"])
        self.assertEqual(p["totals"]["commit_basis"], pf.COMMITS_OVERLAPPING)

    def test_the_attribution_lookback_counts_as_overlap(self):
        # `capture/sessions.py` asks git from `started_at - 1800`, so two sessions half an
        # hour apart in one repo are still both claiming the commits in between.
        day = 1_780_000_000.0
        p = pf.corpus_profile(
            [
                self._fact("a", day, day + 600, 3, "r1"),
                self._fact("b", day + 900, day + 1_500, 3, "r1"),
            ]
        )
        self.assertIsNone(p["totals"]["total_commits"])

    def test_overlapping_sessions_in_DIFFERENT_repos_still_sum(self):
        # Two repos cannot share a commit, so there is nothing to double count.
        day = 1_780_000_000.0
        p = pf.corpus_profile(
            [self._fact("a", day, day + 4_800, 19, "r1"), self._fact("b", day + 3_000, day + 3_700, 6, "r2")]
        )
        self.assertEqual(p["totals"]["total_commits"], 25)


class WhereEachSessionStands(unittest.TestCase):
    """`default_model`, `shipping_day` and `session_rank`: the three the profile leads on.

    Each is a place a plausible wrong answer would be easy. The model that "did most of
    the work" is a token share and not a count of how often it was picked; the day the
    most code landed is not the day with the most hours; and a ranking on elapsed time
    hands the record to a robot, which is the mistake this repo has already made once.
    """

    @staticmethod
    def _fact(sid, start, attended, active, lines, model_tokens, unattended=False):
        return pf.SessionFact(
            session_id=sid,
            started_at=start,
            ended_at=start + active,
            active_seconds=active,
            attended_seconds=attended,
            autonomous_seconds=active - attended,
            lines_added_agent=lines,
            lines_basis=pf.LINES_EDIT_AND_SHELL if lines else pf.LINES_ABSENT,
            output_tokens_by_model=model_tokens,
            unattended=unattended,
        )

    def test_the_default_model_is_the_one_that_wrote_the_most(self):
        day = 1_780_000_000.0
        p = pf.corpus_profile([
            self._fact('a', day, 600, 600, 10, {'small': 100, 'big': 900}),
            self._fact('b', day + 100_000, 600, 600, 10, {'big': 200}),
        ])
        self.assertEqual(p['metrics']['default_model']['value'], 'big')
        self.assertAlmostEqual(p['metrics']['default_model']['share'], 1100 / 1200, places=3)

    def test_no_tokens_at_all_refuses_rather_than_naming_one(self):
        # Every harness but Claude Code uploads `tokens_reported: false`, so this is the
        # normal case for a Codex or an Aider corpus, not an edge one.
        day = 1_780_000_000.0
        p = pf.corpus_profile([self._fact('a', day, 600, 600, 10, {})])
        self.assertIsNone(p['metrics']['default_model']['value'])
        self.assertIn('output tokens', p['metrics']['default_model']['reason'])

    def test_the_shipping_day_is_lines_not_hours(self):
        # A long day that produced nothing is not the day you shipped. These two days are
        # deliberately opposite: the first is four times longer and wrote a tenth as much.
        day = 1_780_000_000.0
        long_quiet = self._fact('a', day, 14_400, 14_400, 20, {'m': 10})
        short_busy = self._fact('b', day + 86_400, 3_600, 3_600, 900, {'m': 10})
        p = pf.corpus_profile([long_quiet, short_busy])
        self.assertEqual(p['metrics']['shipping_day']['value'], short_busy.local_day.isoformat())
        self.assertEqual(p['metrics']['busiest_day']['value'], long_quiet.local_day.isoformat())

    def test_the_ranking_is_attended_and_a_robot_cannot_win_it(self):
        # CLAUDE.md, "Rank sessions by duration alone": the longest session in the
        # reference corpus had ZERO typed prompts. Here the longest by elapsed time is an
        # unattended run and it is not in the ranking at all; second place goes to the
        # session with more ATTENDED time, not more active time.
        day = 1_780_000_000.0
        robot = self._fact('robot', day, 0, 20_000, 5_000, {'m': 10}, unattended=True)
        long_active = self._fact('mixed', day + 100_000, 1_200, 9_000, 100, {'m': 10})
        attended = self._fact('human', day + 200_000, 3_000, 3_000, 100, {'m': 10})
        p = pf.corpus_profile([robot, long_active, attended])
        self.assertEqual([r['session_id'] for r in p['session_rank']], ['human', 'mixed'])
        self.assertEqual(p['ranked_sessions'], 2)
        self.assertEqual(p['session_rank'][0]['rank'], 1)
        self.assertEqual(p['session_rank'][0]['attended_seconds'], 3_000)
        # The robot still counted toward the hours; it just cannot hold a record.
        self.assertGreater(p['totals']['total_hours'], 8)

    def test_a_day_the_agent_spent_alone_is_never_the_busiest(self):
        """The phone reads `busiest_day` as "the day you were at it longest", a record, so
        attended time decides it. MEASURED on the real corpus (2026-09-13): by ACTIVE time
        2026-09-12 came within 72 seconds of 2026-08-18 (9.43 h against 9.45 h) with 3.14 h
        of it in unattended runs; by attended time it is 5.42 h against 8.64 h. Here a
        ten hour overnight run and one attended hour share a day, against three attended
        hours on the next: active time names the robot's day, attended time the person's."""
        day = 1_780_000_000.0
        robot = self._fact('robot', day, 0, 36_000, 0, {}, unattended=True)
        evening = self._fact('evening', day + 7_200, 3_600, 3_600, 0, {})
        next_day = self._fact('next', day + 86_400 + 3_600, 10_800, 10_800, 0, {})
        self.assertEqual(robot.local_day, evening.local_day, 'the shape this test is about')
        self.assertNotEqual(robot.local_day, next_day.local_day)
        m = pf.corpus_profile([robot, evening, next_day])['metrics']['busiest_day']
        self.assertEqual(m['value'], next_day.local_day.isoformat())
        self.assertEqual((m['attended_seconds'], m['active_seconds']), (10_800, 10_800))
        self.assertEqual((m['basis'], m['n']), ('local_days_at_04h_attended', 2))

    def test_a_corpus_of_robots_has_no_busiest_day_and_says_why(self):
        day = 1_780_000_000.0
        m = pf.corpus_profile([self._fact('robot', day, 0, 36_000, 0, {}, unattended=True)])[
            'metrics'
        ]['busiest_day']
        self.assertIsNone(m['value'])
        self.assertIn('unattended run never decides a record', m['reason'])
        self.assertEqual(pf.corpus_profile([])['metrics']['busiest_day']['reason'], 'no active time')


class AttributeCommits(unittest.TestCase):
    """`git log` per session window, first-claim across the overlaps.

    The lister is injected, so these cases are about the attribution rule and not about
    git. The rule exists because several agents run at once in one repository and every
    window reaches `COMMIT_ATTRIBUTION_SEC` back before its start.
    """

    @staticmethod
    def lister(commits):
        def fn(root, since, until):
            return [(sha, ts) for sha, ts in commits if since <= ts <= until]

        return fn

    def facts(self, *windows):
        return [
            session(
                [],
                session_id=f"s{i}",
                start=T0 + start,
                end=T0 + end,
                attended=float(end - start),
            )
            for i, (start, end) in enumerate(windows)
        ]

    def test_a_commit_in_two_overlapping_windows_is_counted_once(self):
        # Two sessions running at the same time in one repo, one commit in the overlap.
        facts = self.facts((0, 2 * HOUR), (HOUR, 3 * HOUR))
        out = pf.attribute_commits(
            facts, ["/repo", "/repo"], self.lister([("a" * 40, T0 + 1.5 * HOUR)])
        )
        self.assertEqual([f.commit_count for f in out], [1, 0])
        self.assertEqual(sum(f.commit_count for f in out), 1)

    def test_every_fact_is_restamped_with_the_git_log_basis(self):
        out = pf.attribute_commits(self.facts((0, HOUR)), ["/repo"], self.lister([]))
        self.assertEqual(out[0].commit_basis, pf.COMMITS_GIT_LOG)
        self.assertEqual(out[0].commit_times, ())

    def test_a_session_with_no_repository_is_left_alone(self):
        before = self.facts((0, HOUR))[0]
        out = pf.attribute_commits([before], [None], self.lister([("a" * 40, T0)]))
        self.assertEqual(out[0].commit_basis, before.commit_basis)
        self.assertEqual(out[0].commit_count, before.commit_count)

    def test_the_lookback_reaches_before_the_session_started(self):
        # A commit 10 minutes before the first prompt is this session's work.
        out = pf.attribute_commits(
            self.facts((0, HOUR)), ["/repo"], self.lister([("a" * 40, T0 - 600)])
        )
        self.assertEqual(out[0].commit_count, 1)
        self.assertGreater(pf.COMMIT_ATTRIBUTION_SEC, 600)

    def test_a_mismatched_roots_list_is_an_error_not_a_silent_misattribution(self):
        with self.assertRaises(ValueError):
            pf.attribute_commits(self.facts((0, HOUR), (HOUR, 2 * HOUR)), ["/repo"], self.lister([]))


class Spend(unittest.TestCase):
    """Dollars at list prices, the per-model comparison, and the refusals.

    The dollar figure is the number most likely to be quoted out loud and the one a
    reader has the least ability to check, so what it refuses to say matters more than
    what it says.
    """

    @staticmethod
    def priced(sid, model, output, commits=0, tokens=None, **kw):
        f = session([], session_id=sid, **kw)
        return dataclasses.replace(
            f,
            output_tokens_by_model={model: output},
            tokens=tokens or pf.pricing.Tokens(output=output),
            commit_count=commits,
            commit_basis=pf.COMMITS_GIT_LOG,
            repo=sid,
        )

    def corpus(self, n=10):
        # Sonnet does the cheap volume, Opus the expensive few.
        out = [
            self.priced(f"s{i}", "claude-sonnet-5", 1_000_000, commits=2, start=T0 + i * 86400)
            for i in range(n)
        ]
        out += [
            self.priced(f"o{i}", "claude-opus-5", 1_000_000, commits=1, start=T0 + (n + i) * 86400)
            for i in range(3)
        ]
        return out

    def test_the_total_is_the_price_table_read_back(self):
        p = pf.corpus_profile(self.corpus())
        # 10 Sonnet sessions at $10 of output + 3 Opus at $25.
        self.assertAlmostEqual(p["metrics"]["spend_usd"]["value"], 10 * 10.0 + 3 * 25.0, places=2)
        self.assertEqual(p["metrics"]["spend_usd"]["basis"], pf.pricing.BASIS_LIST_PRICE)

    def test_the_unit_says_list_prices_so_nobody_reads_it_as_a_bill(self):
        p = pf.corpus_profile(self.corpus())
        self.assertIn("list price", p["metrics"]["spend_usd"]["unit"])

    def test_a_corpus_with_no_token_counts_is_refused_not_zeroed(self):
        p = pf.corpus_profile([session([], session_id=f"s{i}") for i in range(10)])
        self.assertIsNone(p["metrics"]["spend_usd"]["value"])
        self.assertEqual(p["metrics"]["spend_usd"]["basis"], pf.pricing.BASIS_TOKENS_ABSENT)
        self.assertEqual(p["model_costs"], [])

    def test_a_model_with_no_published_price_takes_its_session_out_not_the_corpus(self):
        corpus = self.corpus() + [self.priced("x", "some-other-model", 1_000_000)]
        p = pf.corpus_profile(corpus)
        self.assertAlmostEqual(p["metrics"]["spend_usd"]["value"], 175.0, places=2)
        self.assertEqual(p["metrics"]["spend_usd"]["unpriced_sessions"], 1)
        self.assertNotIn("some-other-model", [r["model"] for r in p["model_costs"]])

    def test_the_model_table_is_ordered_by_what_it_cost(self):
        rows = pf.corpus_profile(self.corpus())["model_costs"]
        self.assertEqual([r["model"] for r in rows], ["Sonnet 5", "Opus 5"])
        self.assertGreater(rows[0]["usd"], rows[1]["usd"])

    def test_dollars_per_commit_compares_the_models(self):
        rows = {r["model"]: r for r in pf.corpus_profile(self.corpus())["model_costs"]}
        # Sonnet: $100 over 20 commits. Opus: $75 over 3.
        self.assertAlmostEqual(rows["Sonnet 5"]["usd_per_commit"], 5.0, places=2)
        self.assertAlmostEqual(rows["Opus 5"]["usd_per_commit"], 25.0, places=2)

    def test_a_mixed_session_credits_its_commits_to_nobody(self):
        """MEASURED: crediting a session's commits to every model in it summed three
        models to 134 commits where git counted 85, and made every one look cheap."""
        mixed = dataclasses.replace(
            self.priced("mix", "claude-opus-5", 1_000_000, commits=50),
            output_tokens_by_model={"claude-opus-5": 500_000, "claude-sonnet-5": 500_000},
        )
        rows = {r["model"]: r for r in pf.corpus_profile(self.corpus() + [mixed])["model_costs"]}
        self.assertEqual(rows["Opus 5"]["commits"], 3, "a 50/50 session credits neither model")
        self.assertEqual(rows["Sonnet 5"]["commits"], 20)

    def test_a_session_one_model_wrote_most_of_does_credit_it(self):
        dominated = dataclasses.replace(
            self.priced("dom", "claude-opus-5", 1_000_000, commits=7),
            output_tokens_by_model={"claude-opus-5": 900_000, "claude-sonnet-5": 100_000},
        )
        rows = {r["model"]: r for r in pf.corpus_profile(self.corpus() + [dominated])["model_costs"]}
        self.assertEqual(rows["Opus 5"]["commits"], 10)
        self.assertEqual(rows["Opus 5"]["sessions_dominated"], 4)

    def test_the_sittings_that_shipped_nothing_carry_their_share(self):
        corpus = self.corpus() + [
            self.priced(f"q{i}", "claude-opus-5", 1_000_000, commits=0, start=T0 + (20 + i) * 86400)
            for i in range(2)
        ]
        m = pf.corpus_profile(corpus)["metrics"]["spend_without_a_commit_usd"]
        self.assertAlmostEqual(m["value"], 50.0, places=2)
        self.assertEqual(m["sessions"], 2)

    def test_seven_priced_sessions_is_too_few_to_call_a_share(self):
        m = pf.corpus_profile(self.corpus(n=4))["metrics"]["spend_without_a_commit_usd"]
        self.assertIsNone(m["value"])
        self.assertIn("needed", m["reason"])

    def test_a_cache_heavy_session_is_not_billed_at_the_input_rate(self):
        cheap = self.priced(
            "c",
            "claude-opus-5",
            1_000,
            tokens=pf.pricing.Tokens(input=1_000, output=1_000, cache_read=5_000_000),
        )
        p = pf.corpus_profile([cheap] + self.corpus())
        # 5M cache reads at $0.50/M is $2.50, not $25.
        delta = p["metrics"]["spend_usd"]["value"] - 175.0
        self.assertLess(delta, 3.0)


class IsAttendedAndLongestRun(unittest.TestCase):
    """The two rules other modules import (docs/overnight-engine.md 1.4), written once."""

    @staticmethod
    def _fact(attended: float, unattended: bool) -> pf.SessionFact:
        return pf.SessionFact(
            session_id="s",
            started_at=T0,
            ended_at=T0 + HOUR,
            active_seconds=HOUR,
            attended_seconds=attended,
            autonomous_seconds=HOUR - attended,
            unattended=unattended,
        )

    def test_attended_means_present_and_not_flagged(self):
        self.assertTrue(pf.is_attended(self._fact(600.0, False)))
        self.assertFalse(pf.is_attended(self._fact(600.0, True)))
        # `unattended` with the build_payload definition (too short to be flagged): no
        # presence means no attended seconds, and that alone keeps it out.
        self.assertFalse(pf.is_attended(self._fact(0.0, False)))

    def test_longest_run_counts_consecutive_calendar_days(self):
        d = dt.date
        self.assertEqual(pf.longest_run([]), 0)
        self.assertEqual(pf.longest_run([d(2026, 9, 1)]), 1)
        self.assertEqual(
            pf.longest_run([d(2026, 9, 1), d(2026, 9, 2), d(2026, 9, 3), d(2026, 9, 5)]), 3
        )
        self.assertEqual(pf.longest_run([d(2026, 9, 1), d(2026, 9, 3), d(2026, 9, 5)]), 1)

    def test_longest_run_crosses_month_and_year_ends(self):
        d = dt.date
        self.assertEqual(pf.longest_run([d(2026, 8, 31), d(2026, 9, 1)]), 2)
        self.assertEqual(pf.longest_run([d(2025, 12, 31), d(2026, 1, 1), d(2026, 1, 2)]), 3)

    def test_longest_run_does_not_trust_its_input_order(self):
        """A repeated day reads as a gap of zero and would reset the run: a plausible wrong
        streak rather than an error, so the input is sorted and deduplicated."""
        d = dt.date
        days = [d(2026, 9, 3), d(2026, 9, 1), d(2026, 9, 2), d(2026, 9, 2)]
        self.assertEqual(pf.longest_run(days), 3)

    def test_the_ranking_uses_the_same_rule(self):
        """A session flagged attended but with no attended seconds cannot hold a record."""
        facts = [
            self._fact(600.0, False),
            dataclasses.replace(self._fact(0.0, False), session_id="zero"),
        ]
        p = pf.corpus_profile(facts)
        self.assertEqual(p["ranked_sessions"], 1)
        self.assertEqual([r["session_id"] for r in p["session_rank"]], ["s"])


class BarrenTokenShare(unittest.TestCase):
    """The corpus rollup of `burn.session_burn_detail` (docs/overnight-engine.md 5.3)."""

    @staticmethod
    def _fact(i: int, burn: int | None, barren: int | None) -> pf.SessionFact:
        return pf.session_fact_from_events(
            session_id=f"s{i}",
            events=[],
            started_at=T0 + i * DAY,
            ended_at=T0 + i * DAY + HOUR,
            attended_seconds=HOUR,
            autonomous_seconds=0.0,
            tz_offset_minutes=0,
            burn_tokens=burn,
            barren_tokens=barren,
        )

    def test_the_share_is_barren_tokens_over_segment_tokens(self):
        """(1,000, 250) + (3,000, 750) + (4,000, 1,000): 2,000 of 8,000 is 0.25. The
        session with no counts is not in the sample at all."""
        facts = [
            self._fact(0, 1_000, 250),
            self._fact(1, 3_000, 750),
            self._fact(2, 4_000, 1_000),
            self._fact(3, None, None),
        ]
        m = pf.corpus_profile(facts)["metrics"]["barren_token_share"]
        self.assertEqual(m["value"], 0.25)
        self.assertEqual((m["n"], m["unit"], m["basis"]), (3, "share", "burn_segments_that_changed_nothing"))
        self.assertEqual((m["barren_tokens"], m["tokens"]), (2_000, 8_000))
        self.assertIsNone(m["reason"])

    def test_no_session_with_counts_is_refused_not_zeroed(self):
        m = pf.corpus_profile([self._fact(i, None, None) for i in range(4)])["metrics"][
            "barren_token_share"
        ]
        self.assertIsNone(m["value"])
        self.assertEqual(m["reason"], "no session reported token counts")
        self.assertIsNone(m["barren_tokens"])
        self.assertIsNone(m["tokens"])

    def test_a_corpus_with_counts_but_no_segments_is_not_told_it_has_no_counts(self):
        """The server's shape: every session reports output tokens, none can be cut into
        segments (that needs the transcript). "No session reported token counts" would be
        false there."""
        facts = [
            dataclasses.replace(self._fact(i, None, None), output_tokens_by_model={"claude-opus-5": 900})
            for i in range(4)
        ]
        m = pf.corpus_profile(facts)["metrics"]["barren_token_share"]
        self.assertIsNone(m["value"])
        self.assertEqual(
            m["reason"],
            "sessions reported token counts, but none was split into segments, which needs the transcripts",
        )
        with_buckets = [
            dataclasses.replace(self._fact(i, None, None), tokens=pf.pricing.Tokens(output=10))
            for i in range(4)
        ]
        self.assertIn("split into segments", pf.corpus_profile(with_buckets)["metrics"]["barren_token_share"]["reason"])

    def test_two_sessions_with_counts_are_too_few(self):
        m = pf.corpus_profile([self._fact(0, 100, 10), self._fact(1, 100, 30)])["metrics"][
            "barren_token_share"
        ]
        self.assertIsNone(m["value"])
        self.assertEqual(m["reason"], "2 sessions with token counts, 3 needed")
        self.assertEqual((m["barren_tokens"], m["tokens"]), (40, 200))

    def test_a_zero_total_has_nothing_to_divide(self):
        m = pf.corpus_profile([self._fact(i, 0, 0) for i in range(3)])["metrics"][
            "barren_token_share"
        ]
        self.assertIsNone(m["value"])
        self.assertIn("nothing to divide", m["reason"])

    def test_the_fact_names_the_share(self):
        """A floor unless every other token is known to have been judged: MEASURED on the
        real corpus (2026-09-13) the share is 2.9% beside 28.6% no transcript could judge,
        and "3% went into stretches where nothing was written" alone reads as "only 3%"."""
        facts = [self._fact(0, 1_000, 250), self._fact(1, 3_000, 750), self._fact(2, 4_000, 1_000)]
        fact = next(f for f in pf.corpus_profile(facts)["facts"] if f["id"] == "barren_token_share")
        self.assertEqual(
            fact["text"], "At least 25% of your tokens went into stretches where nothing was written"
        )
        self.assertEqual(fact["unusualness"], pf.BARREN_FACT_UNUSUALNESS)
        self.assertEqual(pf.BARREN_FACT_UNUSUALNESS, 0.25)
        self.assertIsNone(fact["baseline"], "no baseline is invented for it")
        judged = [dataclasses.replace(f, unreadable_tokens=0) for f in facts]
        fact = next(f for f in pf.corpus_profile(judged)["facts"] if f["id"] == "barren_token_share")
        self.assertEqual(fact["text"], "25% of your tokens went into stretches where nothing was written")

    def test_no_fact_rests_on_a_refused_share(self):
        ids = {f["id"] for f in pf.corpus_profile([self._fact(0, 100, 10)])["facts"]}
        self.assertNotIn("barren_token_share", ids)

    def test_a_small_share_is_never_zero_and_a_large_one_never_all(self):
        """FOUND IN REVIEW: `_pct(round(x, 3))` printed "At least 0% of your tokens ..." for
        4,000 barren tokens of 3,000,000, and "At least 100%" for a share short of all of it
        while unreadable tokens existed. Said from the integers, as `burn` says a share,
        and never "at least" in front of a bound."""

        def text(barren: int, total: int, unreadable: int | None = None) -> str | None:
            per = [self._fact(i, total // 3, barren // 3) for i in range(3)]
            if unreadable is not None:
                per = [dataclasses.replace(f, unreadable_tokens=unreadable // 3) for f in per]
            facts = pf.corpus_profile(per)["facts"]
            return next((f["text"] for f in facts if f["id"] == "barren_token_share"), None)

        self.assertEqual(text(4_002, 3_000_000), "Under 1% of your tokens went into stretches where nothing was written")
        self.assertEqual(text(2_997_000, 3_000_000, 3_000), "Over 99% of your tokens went into stretches where nothing was written")
        # A measured zero is no fact to point at.
        self.assertIsNone(text(0, 3_000_000))

    def test_the_fields_travel_through_the_builder(self):
        f = self._fact(0, 1_000, 250)
        self.assertEqual((f.burn_tokens, f.barren_tokens), (1_000, 250))
        default = session([])
        self.assertEqual((default.burn_tokens, default.barren_tokens), (None, None))

    def test_burn_to_profile_end_to_end(self):
        """`burn.session_burn_detail` feeds the fact, the fact feeds the share. Each session: a
        segment that wrote a file on 1,000 tokens, then one that only talked, on 3,000.
        Three of them: 9,000 barren of 12,000."""
        from analysis import burn

        def one(i: int) -> pf.SessionFact:
            start = T0 + i * DAY
            events = [
                Ev(0, start, "prompt", "write it"),
                Ev(1, start + 1, "tool", "cat > a.py <<'EOF'", tool="Bash", path="a.py", added=10, tool_id="w"),
                Ev(2, start + 10, "prompt", "now explain it"),
                Ev(3, start + 11, "assistant", "sure"),
            ]
            turns = [
                burn.Turn(start + 1, "m1", "claude-opus-5", 1000, 0, 0, 0, ["Bash"], ["w"]),
                burn.Turn(start + 11, "m2", "claude-opus-5", 3000, 0, 0, 0),
            ]
            spent = burn.session_burn_detail(events, turns)
            total, barren = spent["tokens"], spent["barren"]
            return pf.session_fact_from_events(
                session_id=f"s{i}",
                events=events,
                started_at=start,
                ended_at=start + HOUR,
                attended_seconds=HOUR,
                autonomous_seconds=0.0,
                tz_offset_minutes=0,
                burn_tokens=total,
                barren_tokens=barren,
            )

        m = pf.corpus_profile([one(i) for i in range(3)])["metrics"]["barren_token_share"]
        self.assertEqual((m["value"], m["barren_tokens"], m["tokens"], m["n"]), (0.75, 9_000, 12_000, 3))

    def test_half_a_pair_or_an_impossible_pair_is_refused_at_the_door(self):
        """One without the other is a share with half its inputs; barren above the total
        is a share above 1. Both are refused before any division can happen."""
        for burn, barren in ((1_000, None), (None, 5), (100, 101), (100, -1), (-5, -5)):
            with self.assertRaises(ValueError, msg=(burn, barren)):
                self._fact(0, burn, barren)


class UnreadableTokens(unittest.TestCase):
    """What the corpus could not judge rides beside the barren share (burn.py rule 5).

    MEASURED on the real corpus (2026-09-13, 157 counted sessions, 156 with counts): the
    first cut of `barren_token_share` read 31.6%, because every segment with no VISIBLE
    work counted as barren, including ones that rewrote files through `python3 - <<'PY'`
    scripts. Proven barren is 120,070,737 of 4,168,469,723 tokens (2.9%); another
    1,192,481,138 (28.6%) sit in segments the transcripts cannot judge."""

    @staticmethod
    def _fact(i: int, burn: int, barren: int, unreadable: int | None) -> pf.SessionFact:
        return pf.session_fact_from_events(
            session_id=f"u{i}",
            events=[],
            started_at=T0 + i * DAY,
            ended_at=T0 + i * DAY + HOUR,
            attended_seconds=HOUR,
            autonomous_seconds=0.0,
            tz_offset_minutes=0,
            burn_tokens=burn,
            barren_tokens=barren,
            unreadable_tokens=unreadable,
        )

    def test_the_real_corpus_totals_read_as_a_floor_with_the_unjudged_part_beside_it(self):
        per = [(1_389_489_907, 40_023_579, 397_493_712)] * 2 + [(1_389_489_909, 40_023_579, 397_493_714)]
        m = pf.corpus_profile([self._fact(i, *p) for i, p in enumerate(per)])["metrics"][
            "barren_token_share"
        ]
        self.assertEqual((m["tokens"], m["barren_tokens"]), (4_168_469_723, 120_070_737))
        self.assertEqual(m["unreadable_tokens"], 1_192_481_138)
        self.assertEqual(m["value"], 0.029)

    def test_a_partial_unreadable_count_is_not_summed(self):
        facts = [self._fact(0, 1_000, 100, 500), self._fact(1, 1_000, 100, None), self._fact(2, 1_000, 100, 0)]
        m = pf.corpus_profile(facts)["metrics"]["barren_token_share"]
        self.assertEqual(m["value"], 0.1)
        self.assertIsNone(m["unreadable_tokens"], "one session did not supply it")

    def test_refusals_carry_it_too(self):
        m = pf.corpus_profile([self._fact(0, 100, 10, 50)])["metrics"]["barren_token_share"]
        self.assertIsNone(m["value"])
        self.assertEqual(m["unreadable_tokens"], 50)
        none = pf.corpus_profile([])["metrics"]["barren_token_share"]
        self.assertIsNone(none["unreadable_tokens"])

    def test_an_impossible_unreadable_count_is_refused_at_the_door(self):
        for burn, barren, unreadable in ((100, 10, 91), (100, 10, -1)):
            with self.assertRaises(ValueError, msg=(burn, barren, unreadable)):
                self._fact(0, burn, barren, unreadable)
        with self.assertRaises(ValueError):
            pf.SessionFact(
                session_id="x",
                started_at=T0,
                ended_at=T0 + HOUR,
                active_seconds=HOUR,
                attended_seconds=HOUR,
                autonomous_seconds=0.0,
                unreadable_tokens=5,
            )
        self.assertEqual(self._fact(0, 100, 10, 90).unreadable_tokens, 90)

    def test_burn_to_profile_end_to_end(self):
        """Each session: a written file on 1,000 tokens, talk on 3,000, and a
        `python3 - <<'PY'` rewrite on 5,000. Before the rule the rewrite was barren and the
        share read 8,000 of 9,000; it is 3,000 of 9,000 with 5,000 unjudged."""
        from analysis import burn

        def one(i: int) -> pf.SessionFact:
            start = T0 + i * DAY
            events = [
                Ev(0, start, "prompt", "write it"),
                Ev(1, start + 1, "tool", "cat > a.py <<'EOF'", tool="Bash", path="a.py", added=10, tool_id="w"),
                Ev(2, start + 10, "prompt", "now explain it"),
                Ev(3, start + 11, "assistant", "sure"),
                Ev(4, start + 20, "prompt", "rename the flag"),
                Ev(5, start + 21, "tool", "python3 - <<'PY' ⏎ p = 'a.py'", tool="Bash", tool_id="p"),
            ]
            turns = [
                burn.Turn(start + 1, "m1", "claude-opus-5", 1000, 0, 0, 0, ["Bash"], ["w"]),
                burn.Turn(start + 11, "m2", "claude-opus-5", 3000, 0, 0, 0),
                burn.Turn(start + 21, "m3", "claude-opus-5", 5000, 0, 0, 0, ["Bash"], ["p"]),
            ]
            d = burn.session_burn_detail(events, turns)
            return pf.session_fact_from_events(
                session_id=f"s{i}",
                events=events,
                started_at=start,
                ended_at=start + HOUR,
                attended_seconds=HOUR,
                autonomous_seconds=0.0,
                tz_offset_minutes=0,
                burn_tokens=d["tokens"],
                barren_tokens=d["barren"],
                unreadable_tokens=d["unreadable"],
            )

        m = pf.corpus_profile([one(i) for i in range(3)])["metrics"]["barren_token_share"]
        self.assertEqual(
            (m["value"], m["barren_tokens"], m["unreadable_tokens"], m["tokens"]),
            (0.333, 9_000, 15_000, 27_000),
        )


class Baselines(unittest.TestCase):
    """Five BASELINES were once credited to Paxel (docs/approved-roadmap.md 1.3). Two now
    carry measurements from this repository; three say they have none, and say where they
    did come from: Paxel's own copy for the heavy steerer, an explainx.ai mock for the rest
    (docs/overnight-integration.md 5.5)."""

    #: Sources that state the arithmetic they came from instead of a MEASURED prefix.
    DERIVED = {"night_share", "night_commit_share", "iteration_depth"}
    DERIVED_RULES = {"night_owl", "director"}

    def test_the_two_replaced_by_measurements(self):
        b = pf.BASELINES
        self.assertEqual(b["planning_ratio"]["value"], 2.5)
        self.assertEqual(round(20 / 8, 1), 2.5, "20 prose first against 8 tool first")
        self.assertEqual(b["code_velocity"]["value"], 523.0)
        self.assertEqual(round(2_300 / 4.4), 523, "2,300 lines over 4.4 active hours")
        for key in ("planning_ratio", "code_velocity"):
            self.assertTrue(b[key]["source"].startswith("MEASURED"), key)

    def test_the_three_without_a_measurement_keep_their_values_and_say_so(self):
        b = pf.BASELINES
        self.assertEqual(
            (b["steer_rate"]["value"], b["autonomy_score"]["value"], b["avg_prompt_chars"]["value"]),
            (0.4, 0.82, 156.0),
        )
        self.assertTrue(b["steer_rate"]["source"].startswith(pf.PAXEL_HEAVY_STEERER))
        for key in ("autonomy_score", "avg_prompt_chars"):
            self.assertTrue(b[key]["source"].startswith(pf.EXPLAINX_MOCK), key)

    def test_only_steer_rate_and_skeptic_cite_paxel(self):
        """design-refs/research/paxel.md section 6: of the five figures once credited to
        Paxel, only `steer_rate 0.4` is Paxel's copy (landing card 10), and it describes a
        heavy steerer. Every other source that names Paxel names it as the subject of the
        explainx.ai mock, never as the place a number came from."""
        cites = {
            key for key, b in pf.BASELINES.items() if b["source"].startswith(pf.PAXEL_HEAVY_STEERER)
        } | {r["name"] for r in pf.ARCHETYPE_RULES if r["source"].startswith(pf.PAXEL_HEAVY_STEERER)}
        self.assertEqual(cites, {"steer_rate", "skeptic"})
        for source in [b["source"] for b in pf.BASELINES.values()] + [
            r["source"] for r in pf.ARCHETYPE_RULES
        ]:
            if "Paxel" in source:
                self.assertTrue(
                    source.startswith((pf.PAXEL_HEAVY_STEERER, pf.EXPLAINX_MOCK)), source
                )
        self.assertFalse(hasattr(pf, "PAXEL_UNMEASURED"), "the wrong source is gone")

    def test_the_explainx_numbers_say_where_they_came_from(self):
        """The four: the architect (2.4) and velocity machine (487) thresholds, and the
        autonomy (0.82) and prompt length (156) baselines. No value moved."""
        rules = {r["name"]: r for r in pf.ARCHETYPE_RULES}
        four = [
            (rules["architect"], 2.4),
            (rules["velocity_machine"], 487.0),
            (pf.BASELINES["autonomy_score"], 0.82),
            (pf.BASELINES["avg_prompt_chars"], 156.0),
        ]
        for row, value in four:
            self.assertIn("explainx.ai", row["source"])
            self.assertEqual(row.get("threshold", row.get("value")), value)

    def test_the_scales_did_not_move(self):
        want = {
            "steer_rate": 0.2,
            "planning_ratio": 1.2,
            "code_velocity": 250.0,
            "autonomy_score": 0.25,
            "avg_prompt_chars": 100.0,
        }
        self.assertEqual({k: pf.BASELINES[k]["scale"] for k in want}, want)

    def test_every_baseline_source_is_labelled(self):
        for key, b in pf.BASELINES.items():
            src = b["source"]
            self.assertFalse(src.startswith("Paxel"), key)
            self.assertTrue(
                src.startswith(("MEASURED", "UNMEASURED")) or key in self.DERIVED, (key, src)
            )

    def test_the_archetype_thresholds_did_not_move_and_their_sources_are_labelled(self):
        rules = {r["name"]: r for r in pf.ARCHETYPE_RULES}
        self.assertEqual(rules["architect"]["threshold"], 2.4)
        self.assertEqual(rules["velocity_machine"]["threshold"], 487.0)
        for name in ("architect", "velocity_machine"):
            self.assertTrue(rules[name]["source"].startswith(pf.EXPLAINX_MOCK), name)
        self.assertTrue(rules["skeptic"]["source"].startswith(pf.PAXEL_HEAVY_STEERER))
        for name, r in rules.items():
            self.assertFalse(r["source"].startswith("Paxel"), name)
            self.assertTrue(
                r["source"].startswith(("MEASURED", "UNMEASURED")) or name in self.DERIVED_RULES,
                (name, r["source"]),
            )

    def test_no_source_or_rule_has_a_dash(self):
        for b in pf.BASELINES.values():
            self.assertFalse(has_dash(b["source"]), b["source"])
        for r in pf.ARCHETYPE_RULES:
            self.assertFalse(has_dash(r["source"]), r["source"])
            self.assertFalse(has_dash(r["rule"]), r["rule"])



class IntegrationFixes(unittest.TestCase):
    """docs/overnight-integration.md 5.1, 5.2 and 1.3: the profile half of the report's
    money and burn blocks."""

    def test_top_tools_never_names_a_bucket(self):
        """The contract buckets every tool outside its allowlist into `other` and every MCP
        tool into `mcp_other`. They are calls, so they count toward the denominator; they are
        not tools anybody chose, so "other is 60% of every tool call" is never a fact."""
        f = dataclasses.replace(
            session([], session_id="t"),
            tool_calls={"other": 60, "mcp_other": 10, "Bash": 20, "Read": 10},
            tool_basis=pf.TOOLS_ALLOWLIST,
        )
        p = pf.corpus_profile([f])
        tools = [t["tool"] for t in p["top_tools"]]
        self.assertEqual(tools, ["Bash", "Read"])
        self.assertEqual(p["top_tools"][0]["share"], 0.2)  # 20 of all 100 calls
        self.assertNotIn("top_tool", [x["id"] for x in p["facts"]])  # 20% is under the bar

    def test_lines_removed_are_summed_like_lines_added(self):
        events = [
            Ev(0, T0, "prompt", "trim it"),
            Ev(1, T0 + 1, "tool", "/r/a.py", tool="Edit", path="/r/a.py", added=5, removed=9),
            Ev(2, T0 + 2, "tool", "", tool="Edit", path="/Users/me/.claude/projects/-r/memory/MEMORY.md", added=1, removed=4),
            Ev(3, T0 + 3, "tool", "sed -i 's/a/b/' /r/b.py", tool="Bash", path="/r/b.py", removed=None),
        ]
        f = session(events)
        # Project writes only, as the added lines are counted (`patterns.project_write`).
        self.assertEqual((f.lines_added_agent, f.lines_removed_agent), (5, 9))
        totals = pf.corpus_profile([f, dataclasses.replace(f, session_id="t", lines_removed_agent=3)])["totals"]
        self.assertEqual((totals["total_lines_added"], totals["total_lines_removed"]), (10, 12))

    def test_model_costs_carry_the_price_table_key(self):
        f = dataclasses.replace(
            session([], session_id="m"),
            output_tokens_by_model={"claude-opus-4-8[1m]": 1_000_000},
            tokens=pf.pricing.Tokens(output=1_000_000),
        )
        rows = pf.corpus_profile([f])["model_costs"]
        self.assertEqual([(r["model"], r["model_id"]) for r in rows], [("Opus 4.8", "claude-opus-4-8")])
        self.assertIn(rows[0]["model_id"], pf.pricing.PRICES)
        self.assertEqual(rows[0]["usd"], 25.0)

    def test_an_unpriced_refusal_still_says_how_many_sessions(self):
        f = dataclasses.replace(
            session([], session_id="u"),
            output_tokens_by_model={"gpt-99": 10},
            tokens=pf.pricing.Tokens(output=10),
        )
        m = pf.corpus_profile([f])["metrics"]["spend_usd"]
        self.assertEqual((m["value"], m["basis"], m["unpriced_sessions"]), (None, pf.pricing.BASIS_UNKNOWN_MODEL, 1))
        self.assertEqual(m["reason"], "1 session used a model with no published price here")

    def test_every_barren_refusal_carries_its_code_and_the_template_it_is_worded_from(self):
        cases = [
            ([], pf.BARREN_NO_COUNTS, None),
            ([BarrenTokenShare._fact(0, 100, 10)], pf.BARREN_BELOW_FLOOR, pf.MIN_SESSIONS),
            ([BarrenTokenShare._fact(i, 0, 0) for i in range(3)], pf.BARREN_NOTHING_INSIDE, None),
            (
                [dataclasses.replace(session([], session_id="x"), output_tokens_by_model={"claude-opus-5": 5})],
                pf.BARREN_NOT_SEGMENTED,
                None,
            ),
        ]
        for facts, code, needed in cases:
            with self.subTest(code=code):
                m = pf.corpus_profile(facts)["metrics"]["barren_token_share"]
                self.assertIsNone(m["value"])
                self.assertEqual((m["code"], m["needed"], m["by_cause"]), (code, needed, None))
                self.assertEqual(
                    m["reason"], pf.fill(pf.BARREN_REFUSALS[code], n=m["n"], needed=pf.MIN_SESSIONS)
                )
        self.assertEqual(
            pf.corpus_profile(cases[1][0])["metrics"]["barren_token_share"]["reason"],
            "1 session with token counts, 3 needed",
        )

    def test_barren_causes_sum_across_sessions_and_share_the_barren_tokens(self):
        facts = [
            dataclasses.replace(
                BarrenTokenShare._fact(i, 1_000, 400),
                barren_causes={"context_replay": (300, 1), "investigated": (100 * i, 1)} if i else {"context_replay": (300, 2)},
            )
            for i in range(3)
        ]
        m = pf.corpus_profile(facts)["metrics"]["barren_token_share"]
        self.assertEqual((m["value"], m["code"]), (0.4, None))
        self.assertEqual(
            m["by_cause"],
            [
                {"cause": "context_replay", "tokens": 900, "share": 0.75, "segments": 4},
                {"cause": "investigated", "tokens": 300, "share": 0.25, "segments": 2},
            ],
        )
        # One fact without causes and the corpus says nothing about causes, never a part.
        partial = facts[:2] + [BarrenTokenShare._fact(2, 1_000, 400)]
        self.assertIsNone(pf.corpus_profile(partial)["metrics"]["barren_token_share"]["by_cause"])

    def test_a_cause_that_claims_more_than_the_barren_tokens_is_refused_at_the_door(self):
        with self.assertRaises(ValueError):
            dataclasses.replace(BarrenTokenShare._fact(0, 1_000, 100), barren_causes={"error_loop": (101, 1)})
        with self.assertRaises(ValueError):
            dataclasses.replace(BarrenTokenShare._fact(0, 1_000, 100), barren_causes={"error_loop": (50, 0)})

    def test_fill_is_the_one_template_rule(self):
        self.assertEqual(pf.fill("{n:session}, {needed} needed", n=1, needed=3), "1 session, 3 needed")
        self.assertEqual(pf.fill("{n:session}", n=1234), "1,234 sessions")
        self.assertEqual(pf.fill({"zero": "none", "one": "one", "other": "{n} of them"}, n=0), "none")
        self.assertEqual(pf.fill({"other": "{n} of them"}, n=1), "1 of them")
        self.assertEqual(pf.fill("{a}; {b:line}", a="said", b=2), "said; 2 lines")
        with self.assertRaises(KeyError):
            pf.fill("{n} of {total}", n=1)


class EveryStringThePersonReads(unittest.TestCase):
    """Every fact, every refusal reason, the archetype's reason: across an empty corpus, a
    single short session, a server shaped corpus and a full one."""

    def _profiles(self):
        yield pf.corpus_profile([])
        yield pf.corpus_profile([session([ev(0, T0, "prompt", "hi")], attended=60)])
        yield pf.corpus_profile(
            [
                pf.SessionFact(
                    session_id=str(i),
                    started_at=T0 + i * HOUR,
                    ended_at=T0 + (i + 1) * HOUR,
                    active_seconds=HOUR,
                    attended_seconds=HOUR,
                    autonomous_seconds=0,
                    tool_calls={"Bash": 20},
                    tool_basis=pf.TOOLS_ALLOWLIST,
                    lines_added_agent=4,
                    lines_basis=pf.LINES_UPLOADED,
                    write_events=None,
                )
                for i in range(4)
            ]
        )
        yield pf.corpus_profile(
            [
                dataclasses.replace(
                    session([], session_id="r", attended=0.0, autonomous=2 * HOUR), unattended=True
                )
            ]
        )
        yield pf.corpus_profile([BarrenTokenShare._fact(0, 100, 10), BarrenTokenShare._fact(1, 100, 30)])
        yield pf.corpus_profile([BarrenTokenShare._fact(i, 0, 0) for i in range(3)])
        full = Facts()._profile()
        yield full
        facts = [
            BarrenTokenShare._fact(i, 1_000 * (i + 1), 250 * (i + 1)) for i in range(4)
        ] + [session([], session_id=f"n{i}", start=T0 + (10 + i) * DAY) for i in range(3)]
        yield pf.corpus_profile(facts)

    def test_no_dash_anywhere_a_person_reads(self):
        seen = 0
        for p in self._profiles():
            strings = [f["text"] for f in p["facts"]]
            strings += [v["reason"] for v in p["metrics"].values() if v.get("reason")]
            strings += [v for v in p["sample"]["missing"].values()]
            if p["archetype"]["reason"]:
                strings.append(p["archetype"]["reason"])
            for s in strings:
                seen += 1
                self.assertFalse(has_dash(s), s)
        self.assertGreater(seen, 40, "the check must actually reach the strings")


class ProjectLinesAndPlainNumbers(unittest.TestCase):
    """FOUND IN REVIEW (2026-09-13), each a number or a word a person reads."""

    SCRATCH = "/private/tmp/claude-501/-r/8f7c2a4e-0000-4000-8000-000000000001/scratchpad"

    def test_lines_into_claude_codes_own_files_are_not_agent_lines(self):
        """MEASURED on `~/.builder-overnight/corpus`: 13,663 of 64,747 agent lines were
        written into Claude Code's scratchpad, memory notes and job files. The basis names
        what is counted, so a stored total that still counts them is never read as it."""
        events = [
            Ev(0, T0, "prompt", "go"),
            Ev(1, T0 + 1, "tool", "/r/app.py", tool="Edit", path="/r/app.py", added=12, removed=0),
            Ev(2, T0 + 2, "tool", "", tool="Write", path=f"{self.SCRATCH}/probe.py", added=40, removed=0),
            Ev(3, T0 + 3, "tool", "", tool="Write", path="/Users/me/.claude/projects/-r/memory/MEMORY.md", added=9, removed=0),
            Ev(4, T0 + 4, "tool", f"cd {self.SCRATCH} && cat > part.html <<'EOF'", tool="Bash", path="part.html", added=30, removed=0),
            Ev(5, T0 + 5, "tool", "cat > src/b.py <<'EOF'", tool="Bash", path="src/b.py", added=5, removed=0),
        ]
        f = session(events)
        self.assertEqual((f.lines_added_agent, f.write_events), (17, 2))
        self.assertEqual(f.lines_basis, "project_edit_tools_and_credited_shell_writes")

    def test_a_number_is_rounded_before_it_is_checked_for_a_whole_one(self):
        """`_n(4.96)` checked for a whole number first and printed "5.0"."""
        self.assertEqual([pf._n(x) for x in (4.96, 2.96, 4.94, 1234.0, 0.05)], ["5", "3", "4.9", "1,234", "0.1"])

    def test_one_prompt_is_singular_in_the_steer_refusal(self):
        m = pf.corpus_profile([prompt_session(["go"])])["metrics"]["steer_rate"]
        self.assertEqual(m["reason"], "1 prompt, 5 needed")
        m = pf.corpus_profile([prompt_session(["go", "more"])])["metrics"]["steer_rate"]
        self.assertEqual(m["reason"], "2 prompts, 5 needed")


class ParallelSittingsAndPricedHours(unittest.TestCase):
    """Two corpus numbers the review found wrong in silence (2026-09-13)."""

    TOK = None

    def fact(self, sid, start, end, *, tokens=True):
        from analysis import pricing

        return pf.SessionFact(
            session_id=sid,
            started_at=start,
            ended_at=end,
            active_seconds=end - start,
            attended_seconds=end - start,
            autonomous_seconds=0,
            prompt_count=3,
            output_tokens_by_model={"claude-opus-4-8": 100_000} if tokens else {},
            tokens=pricing.Tokens(input=1000, output=100_000) if tokens else None,
        )

    def test_the_inner_of_two_parallel_sittings_did_not_end_with_no_commit(self):
        """Four pairs of parallel sittings in one repository: the outer one runs two hours,
        the inner one runs inside it and makes all three of the pair's commits. `git log`
        sees them in both windows, and the first claim rule gives them to the outer one.
        MEASURED before the fix: the four inner sittings read "ended with no commit",
        `spend_without_a_commit_usd` $10.02 over 4 sittings, half the spend, and
        `ships_rate` 0.5. After: $0 over 0 sittings and 1.0, while the first claim counts
        (A 3, B 0) still add up to the 12 commits git holds."""
        facts, roots, commits = [], [], []
        for k in range(4):
            t = T0 + k * DAY
            facts += [self.fact(f"A{k}", t, t + 7200), self.fact(f"B{k}", t + 600, t + 3600)]
            roots += ["/repo", "/repo"]
            commits += [(f"sha{k}{j}", t + 1000 + j * 600) for j in range(3)]

        def lister(root, since, until):
            return [c for c in commits if since <= c[1] <= until]

        out = pf.attribute_commits(facts, roots, lister)
        self.assertEqual([f.commit_count for f in out], [3, 0] * 4)
        self.assertEqual([f.commits_in_window for f in out], [3, 3] * 4)
        self.assertEqual(sum(f.commit_count for f in out), 12, "a total still counts each commit once")
        m = pf.corpus_profile(out)["metrics"]
        quiet = m["spend_without_a_commit_usd"]
        self.assertEqual((quiet["value"], quiet["sessions"], quiet["share_of_spend"]), (0, 0, 0.0))
        self.assertEqual((m["ships_rate"]["value"], m["ships_rate"]["shipped_sessions"]), (1.0, 8))

    def test_a_server_fact_reads_its_stored_count_as_the_window_count(self):
        """The server stores the uploader's per window count as `commit_count` and passes
        no `commits_in_window`; the predicate reads what it has."""
        f = dataclasses.replace(self.fact("s", T0, T0 + 3600), commit_count=2, commit_basis=pf.COMMITS_GIT_LOG)
        self.assertTrue(pf.ended_with_a_commit(f))
        self.assertFalse(pf.ended_with_a_commit(dataclasses.replace(f, commit_count=0)))

    def test_dollars_an_hour_are_over_the_hours_that_were_priced(self):
        """One priced Claude Code hour at list price, one Cursor hour with no token counts
        (Cursor writes {0, 0} on every row). MEASURED before the fix: $2.50 spent and
        $1.25 an hour, the Cursor hour in the denominator; after: $2.51 an hour. The hour
        costs $2.505 ($0.005 of input, $2.50 of output), and its cents round half UP
        (`plain.half_up`), where Python's `round` said $2.50 off the double under 2.505."""
        cc = self.fact("cc", T0, T0 + HOUR)
        cursor = self.fact("cu", T0 + 2 * HOUR, T0 + 3 * HOUR, tokens=False)
        m = pf.corpus_profile([cc, cursor])["metrics"]
        self.assertEqual((m["spend_usd"]["value"], m["spend_usd"]["n"]), (2.51, 1))
        self.assertEqual((m["spend_per_hour_usd"]["value"], m["spend_per_hour_usd"]["n"]), (2.51, 1))
