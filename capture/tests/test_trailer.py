"""python3 -m unittest capture.tests.test_trailer

The trailer on the Mac (docs/trailers.md), every rule that can be held without Node, ffmpeg or a
model:

- the facts: a day turns at 04:00, a calendar is a level a day and absent when nothing landed, a
  number carries its words, "since the last demo" is said only when there was one, the title comes
  from the owner, then an allowed name, then a build post that names no repository;
- the cut: a first cut has a scene for each thing the facts can show and none for anything else,
  every cut is held to the spec and the facts, and a difference is said as codes in the spec's
  sentences, none with a dash;
- the director: the notes the rules can read, several in one note, a refusal for what a cut cannot
  do, a version to go back to, and the gate over a model's cut: bounds held, arrivals kept, a
  number the project never gave refused, a repository's name refused, the owner's own words kept;
- the pins: the project's arrival order is the phone's FNV-1a, the crew ring is design/tokens.json's.
"""

from __future__ import annotations

import datetime as dt
import json
import pathlib
import unittest

from capture.trailer import cut as cutmod
from capture.trailer import direct, facts, tables

ROOT = pathlib.Path(__file__).resolve().parents[2]
UTC = dt.UTC


def at(y, mo, d, h=12, mi=0) -> int:
    return int(dt.datetime(y, mo, d, h, mi, tzinfo=UTC).timestamp())


def some_facts(**over) -> dict:
    f = {
        "version": 1,
        "project_key": "ab" * 32,
        "title": {"text": "Widget", "source": "person"},
        "line": {"text": "a widget for everyone", "source": "person"},
        "cta": None,
        "hue": "tide",
        "creature": "fox",
        "demo": {
            "device": "iphone-17-pro",
            "video": "/demo.mp4",
            "beats": [{"start": 0, "end": 2, "tap": [0.5, 0.5], "change": 1, "label": "one"}, {"start": 2, "end": 5, "tap": None, "change": None, "label": "two"}],
            "stills": [],
        },
        "numbers": {"commits": facts.number(212, "commits"), "days_built": facts.number(19, "days built")},
        "days": {"levels": [0, 1, 2] * 28, "since": "since aug 8"},
        "changelog": ["Add the map", "Make the list faster", "Fix the pin"],
        "since_last_demo": True,
        "languages": [],
    }
    f.update(over)
    return f


class Facts(unittest.TestCase):
    def test_a_day_turns_at_four_in_the_morning(self):
        self.assertEqual(facts.local_day(at(2026, 9, 10, 3, 59), UTC), dt.date(2026, 9, 9))
        self.assertEqual(facts.local_day(at(2026, 9, 10, 4, 0), UTC), dt.date(2026, 9, 10))

    def test_a_calendar_is_twelve_weeks_from_a_monday_with_a_level_a_day(self):
        today = dt.date(2026, 9, 27)  # a Sunday
        times = [at(2026, 9, 21)] + [at(2026, 9, 22)] * 3 + [at(2026, 9, 27)] * 12
        cal = facts.calendar(times, today, UTC)
        self.assertEqual(len(cal["levels"]), 12 * 7)
        start = today - dt.timedelta(days=today.weekday()) - dt.timedelta(weeks=11)
        self.assertEqual(start.weekday(), 0)
        idx = lambda d: (d - start).days  # noqa: E731
        self.assertEqual(cal["levels"][idx(dt.date(2026, 9, 21))], 1)
        self.assertEqual(cal["levels"][idx(dt.date(2026, 9, 22))], 2)
        self.assertEqual(cal["levels"][idx(dt.date(2026, 9, 27))], 5)
        self.assertEqual(cal["since"], "since sep 21")
        self.assertIsNone(facts.calendar([at(2025, 1, 1)], today, UTC), "nothing in the window is no scene, not an empty one")

    def test_numbers_carry_their_words_and_since_is_said_only_when_there_was_a_demo(self):
        n = facts.git_numbers([at(2026, 9, 1), at(2026, 9, 1, 14), at(2026, 9, 2)], None, UTC)
        self.assertEqual(n["commits"], {"value": 3, "text": "3", "unit": "commits"})
        self.assertEqual(n["days_built"]["value"], 2)
        self.assertNotIn("commits_since", n)
        n = facts.git_numbers([at(2026, 9, 1)], 1, UTC)
        self.assertEqual(n["commits"]["unit"], "commit")
        self.assertEqual(n["commits_since"]["unit"], "commit since the last demo")
        self.assertEqual(facts.number(1204, "commits")["text"], "1,204")

    def test_hours_come_only_from_the_report_and_only_a_whole_hour_or_more(self):
        self.assertEqual(facts.report_numbers(None), {})
        self.assertEqual(facts.report_numbers({"history": {"attended_seconds": 1800, "sessions": 0}}), {})
        n = facts.report_numbers({"history": {"attended_seconds": 7260, "sessions": 9}})
        self.assertEqual(n["hours"]["text"], "2")
        self.assertEqual(n["sessions"]["unit"], "sessions")

    def test_the_title_is_typed_then_allowed_then_a_build_post_that_names_nothing(self):
        leaks = lambda texts: [t for t in texts if "secret-repo" in t]  # noqa: E731
        self.assertEqual(facts.choose_title(typed="  Widget ", allowed=("x",), shipped=None, leaks=leaks), {"text": "Widget", "source": "person"})
        self.assertEqual(facts.choose_title(typed=None, allowed=("RideGT",), shipped=None, leaks=leaks)["text"], "RideGT")
        self.assertEqual(facts.choose_title(typed=None, allowed=(), shipped={"what": "a bus app"}, leaks=leaks), {"text": "a bus app", "source": "model"})
        self.assertEqual(facts.choose_title(typed=None, allowed=(), shipped={"what": "secret-repo v2"}, leaks=leaks)["text"], facts.FALLBACK_TITLE)


class Cut(unittest.TestCase):
    def test_a_first_cut_shows_what_the_facts_can_and_nothing_else(self):
        c = cutmod.first_cut(some_facts())
        self.assertEqual([s["kind"] for s in c["scenes"]], ["open", "screens", "figure", "days", "changelog", "end"])
        self.assertEqual(cutmod.validate(c, some_facts()), [])
        bare = some_facts(numbers={}, days=None, changelog=["one"], demo={"device": None, "video": None, "beats": [], "stills": []})
        c = cutmod.first_cut(bare)
        self.assertEqual([s["kind"] for s in c["scenes"]], ["open", "end"])
        self.assertGreaterEqual(c["seconds"], tables.SECONDS["min"])

    def test_the_figure_prefers_hours_then_commits(self):
        f = some_facts()
        self.assertEqual(next(s for s in cutmod.first_cut(f)["scenes"] if s["kind"] == "figure")["figure"], "commits")
        f["numbers"]["hours"] = facts.number(40, "hours with you there")
        self.assertEqual(next(s for s in cutmod.first_cut(f)["scenes"] if s["kind"] == "figure")["figure"], "hours")

    def test_validate_refuses_what_the_spec_or_the_facts_do_not_allow(self):
        f = some_facts()
        c = cutmod.first_cut(f)
        for mutate, why in (
            (lambda x: x.update(seconds=99), "seconds"),
            (lambda x: x.update(hue="teal"), "hue"),
            (lambda x: x["scenes"].reverse(), "opens"),
            (lambda x: x["scenes"].insert(2, {**cutmod.scene("stack", "rain", f)}), "stack"),
            (lambda x: next(s for s in x["scenes"] if s["kind"] == "figure").update(figure="hours"), "number"),
            (lambda x: next(s for s in x["scenes"] if s["kind"] == "screens").update(beats=[0, 7]), "beat"),
            (lambda x: x.update(title={"text": "x" * 61, "source": "person"}), "title"),
        ):
            bad = json.loads(json.dumps(c))
            mutate(bad)
            self.assertTrue(cutmod.validate(bad, f), why)

    def test_a_difference_is_codes_in_the_spec_sentences_with_no_dash(self):
        f = some_facts()
        a = cutmod.first_cut(f)
        b = json.loads(json.dumps(a))
        b.update(seconds=12, hue="ember", mood="none")
        b["scenes"] = [s for s in b["scenes"] if s["kind"] != "days"]
        changes = cutmod.diff(a, b)
        self.assertEqual([c["code"] for c in changes], ["seconds", "hue", "mood", "scene_removed"])
        said = [cutmod.say(c) for c in changes]
        self.assertIn("the sound is off now", said)
        self.assertIn("took out the days built", said)
        for s in said:
            self.assertFalse(any(d in s for d in "—–―−"), s)

    def test_the_project_order_is_the_phone_fnv(self):
        # mobile/src/motion/pixelMotion.ts fnv, run under node on 2026-09-28.
        for s, want in (("", 2166136261), ("a", 3826002220), ("RideGT", 551180548)):
            self.assertEqual(cutmod.fnv(s), want)

    def test_the_arrivals_and_the_crew_are_the_app_own(self):
        text = (ROOT / "mobile/src/motion/pixelMotion.ts").read_text()
        for name in tables.ENUMS["arrival"]:
            self.assertIn(f"'{name}'", text)
        from capture.trailer import make

        tokens = json.loads((ROOT / "design/tokens.json").read_text())
        ring = tokens["spectrum"]["crew"]["ring"]
        self.assertIn(make.crew_creature("ab" * 32), ring)
        self.assertNotEqual(make.crew_creature("cd" * 32), "bit")


class Director(unittest.TestCase):
    def setUp(self):
        self.f = some_facts()
        self.c = cutmod.first_cut(self.f)
        self.leaks = lambda texts: [t for t in texts if "secret-repo" in t]

    def ask(self, note, **kw):
        return direct.answer(note, self.c, self.f, {1: self.c}, self.leaks, use_model=False, **kw)

    def said(self, note):
        a = self.ask(note)
        return a.refusal or [cutmod.say(c) for c in a.changes]

    def test_what_the_rules_read(self):
        s = self.c["seconds"]
        self.assertEqual(self.said("make it 12 seconds"), [f"{s} s became 12 s"])
        self.assertEqual(self.said("way shorter"), [f"{s} s became {round(s * 0.6)} s"])
        self.assertEqual(self.said("make it orange"), ["the colour is ember now"])
        self.assertEqual(self.said("snappier please"), ["the pace went from 1 to 1.15"])
        self.assertEqual(self.said("use the owl"), ["the owl is on it now"])
        self.assertEqual(self.said('call it "Widget Pro"'), ["the title reads “Widget Pro”"])
        self.assertEqual(self.said('end with "free on the App Store"'), ["the last card says “free on the App Store”"])
        self.assertEqual(self.said("no music"), ["the sound is off now"])
        self.assertEqual(self.said("hard cuts"), ["scenes change by a straight cut now"])
        self.assertEqual(self.said("hold the phone still"), ["the camera is still now"])
        self.assertEqual(self.said("only the first 1 screens"), ["the screens hold 1 beats now"])

    def test_several_asks_in_one_note_and_lists_of_scenes(self):
        got = self.said("drop the calendar and the list of changes, then make it purple")
        self.assertEqual(sorted(got), sorted(["the colour is iris now", "took out the days built", "took out the list of changes"]))
        self.assertIn("it opens on the number now", self.said("start with the number"))

    def test_what_a_cut_cannot_do_is_refused_with_its_code(self):
        self.assertEqual(self.ask("film the settings screen too").refusal, "needs_new_capture")
        self.assertEqual(self.ask("something poetic about the ocean").refusal, "not_understood")
        self.assertEqual(self.ask("make it teal").refusal, "nothing_to_change", "the trailer is already tide")
        self.assertEqual(self.ask("go back to version 9").refusal, "no_such_version")
        self.assertEqual(self.ask('call it "' + "x" * 70 + '"').refusal, "over_limit")
        for code in ("needs_new_capture", "not_understood", "nothing_to_change", "no_such_version", "over_limit"):
            self.assertIn(code, tables.REFUSALS)

    def test_a_version_comes_back_as_a_new_version(self):
        a = self.ask("make it orange")
        v2 = a.cut
        back = direct.answer("go back to version 1", v2, self.f, {1: self.c, 2: v2}, self.leaks, use_model=False)
        self.assertEqual(back.cut["version"], 3)
        self.assertEqual(back.cut["hue"], "tide")
        self.assertEqual(back.changes[0], {"code": "reverted", "before": None, "after": "1"})
        undo = direct.answer("undo", v2, self.f, {1: self.c, 2: v2}, self.leaks, use_model=False)
        self.assertEqual(undo.cut["hue"], "tide")

    def test_the_gate_holds_a_model_cut(self):
        m = json.loads(json.dumps(self.c))
        m["scenes"][1]["weight"] = 7
        m["scenes"][1]["arrival"] = "spiral" if m["scenes"][1]["arrival"] != "spiral" else "rain"
        m["seconds"] = 90
        new, code = direct.gate(self.c, m, self.f, "give the screens room", self.leaks)
        self.assertIsNone(code)
        self.assertEqual(new["scenes"][1]["weight"], tables.WEIGHT["max"])
        self.assertEqual(new["seconds"], tables.SECONDS["max"])
        self.assertEqual(new["scenes"][1]["arrival"], self.c["scenes"][1]["arrival"], "an arrival no change can name is kept")

        m = json.loads(json.dumps(self.c))
        m["cta"] = {"text": "loved by 10,000 riders", "source": "model"}
        self.assertEqual(direct.gate(self.c, m, self.f, "make the ending sell it", self.leaks)[1], "invented_number")
        self.assertIsNone(direct.gate(self.c, m, self.f, "say we have 10,000 riders", self.leaks)[1], "the owner's own number")
        m["cta"] = {"text": "212 commits in", "source": "model"}
        self.assertIsNone(direct.gate(self.c, m, self.f, "mention the work", self.leaks)[1], "a number the project gave")
        m["cta"] = {"text": "from secret-repo", "source": "model"}
        self.assertEqual(direct.gate(self.c, m, self.f, "say where it is from", self.leaks)[1], "names_a_repository")
        m["cta"] = {"text": "made in a weekend — honestly", "source": "person"}
        new, code = direct.gate(self.c, m, self.f, "made in a weekend — honestly", self.leaks)
        self.assertIsNone(code)
        self.assertNotIn("—", new["cta"]["text"])

    def test_a_model_may_not_pass_its_words_off_as_the_owner(self):
        m = json.loads(json.dumps(self.c))
        m["line"] = {"text": "the best widget ever made", "source": "person"}
        new, code = direct.gate(self.c, m, self.f, "make the line punchier", self.leaks)
        self.assertIsNone(code)
        self.assertEqual(new["line"]["source"], "model")


if __name__ == "__main__":
    unittest.main()
