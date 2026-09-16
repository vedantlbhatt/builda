"""The gate: what it removes, what it corrects, and what it refuses to invent.

A constrained decoder guarantees the SHAPE of a plan and nothing at all about whether it is true.
Everything here is the part that runs after it, and every rule can only remove or correct.
"""

from __future__ import annotations

import unittest

from drops import plan as dp

TEXT = (
    "5 Claude Skills that every beginner needs to install. It’s hard to learn AI and Claude "
    "as a beginner. Before you start working in Claude here are 5 beginner Claude skills that "
    "will get you ahead of 90% of people. \U0001F680"
)


def move(**over) -> dict:
    return {
        "move_kind": "install",
        "title": "Install it",
        "intent": "Install the skills the video points at.",
        "evidence": "5 beginner Claude skills that will get you ahead of 90% of people",
        "target": "this_machine",
        "effort": "minutes",
        "source": None,
        **over,
    }


def plan(**over) -> dict:
    return {
        "kind": "skill",
        "title": "Five skills",
        "summary": "A creator points at five beginner skills.",
        "confidence": 30,
        "refusal": None,
        "moves": [move()],
        "recipe": None,
        "tags": ["claude"],
        **over,
    }


class EvidenceTests(unittest.TestCase):
    def test_a_verbatim_span_survives(self):
        out, counts = dp.gate(plan(), TEXT)
        self.assertEqual(len(out["moves"]), 1)
        self.assertEqual(counts["evidence_dropped"], 0)

    def test_a_paraphrase_does_not(self):
        out, counts = dp.gate(plan(moves=[move(evidence="five skills for beginners to install")]), TEXT)
        self.assertEqual(out["moves"], [])
        self.assertEqual(counts["evidence_dropped"], 1)

    def test_an_emoji_is_not_evidence(self):
        """MEASURED: a correct move was discarded because the model wrote a different shrimp."""
        out, _ = dp.gate(plan(moves=[move(evidence="Before you start working in Claude \U0001F92F")]), TEXT)
        self.assertEqual(len(out["moves"]), 1)

    def test_a_curly_quote_is_not_evidence_either(self):
        out, _ = dp.gate(plan(moves=[move(evidence="It's hard to learn AI and Claude as a beginner")]), TEXT)
        self.assertEqual(len(out["moves"]), 1)

    def test_three_words_is_the_floor(self):
        """Under four words a span matches almost anything and is not evidence of anything."""
        out, _ = dp.gate(plan(moves=[move(evidence="Claude")]), TEXT)
        self.assertEqual(out["moves"], [])


class TargetTests(unittest.TestCase):
    def test_where_a_move_happens_follows_from_what_it_is(self):
        """MEASURED on the live board: SIX of six `apply` moves came back `this_machine`, so every
        repository change would have run in a scratch directory and the phone's repository picker
        would never have been reachable."""
        for kind, want in dp._TARGET_FOR.items():
            out, counts = dp.gate(plan(moves=[move(move_kind=kind, target="none")]), TEXT)
            if not out["moves"]:
                continue
            self.assertEqual(out["moves"][0]["target"], want, kind)
            self.assertEqual(counts["target_fixed"], 0 if want == "none" else 1, kind)

    def test_evaluate_keeps_the_target_it_was_given(self):
        """The one kind whose answer is genuinely the model's: trying something out can mean a
        throwaway clone or the repository you would actually use it in."""
        for target in ("this_machine", "existing_repo"):
            out, counts = dp.gate(plan(moves=[move(move_kind="evaluate", target=target)]), TEXT)
            self.assertEqual(out["moves"][0]["target"], target)
            self.assertEqual(counts["target_fixed"], 0)

    def test_a_target_the_spec_does_not_know_lands_somewhere_real(self):
        out, _ = dp.gate(plan(moves=[move(move_kind="evaluate", target="the_cloud")]), TEXT)
        self.assertEqual(out["moves"][0]["target"], "none")


class SourceTests(unittest.TestCase):
    def test_a_source_that_is_a_sentence_is_removed_and_the_move_survives(self):
        bad = {"source_kind": "github", "ref": "the one from the video", "url": "https://github.com/a/b"}
        out, counts = dp.gate(plan(moves=[move(source=bad)]), TEXT)
        self.assertEqual(len(out["moves"]), 1)
        self.assertIsNone(out["moves"][0]["source"])
        self.assertEqual(counts["source_dropped"], 1)

    def test_a_source_that_is_not_https_is_removed(self):
        bad = {"source_kind": "github", "ref": "a/b", "url": "http://github.com/a/b"}
        out, _ = dp.gate(plan(moves=[move(source=bad)]), TEXT)
        self.assertIsNone(out["moves"][0]["source"])

    def test_a_real_source_survives_whole(self):
        good = {"source_kind": "github", "ref": "anthropics/claude-code", "url": "https://github.com/anthropics/claude-code"}
        out, _ = dp.gate(plan(moves=[move(source=good)]), TEXT)
        self.assertEqual(out["moves"][0]["source"], good)


class KindTests(unittest.TestCase):
    def test_a_recipe_with_no_method_keeps_its_kind_and_loses_its_recipe(self):
        out, _ = dp.gate(plan(kind="recipe", recipe={"ingredients": [], "steps": []}), TEXT)
        self.assertEqual(out["kind"], "recipe")
        self.assertIsNone(out["recipe"])

    def test_a_recipe_block_on_a_drop_that_is_not_one_is_dropped(self):
        out, _ = dp.gate(plan(kind="skill", recipe={"ingredients": [{"item": "x"}], "steps": [{"text": "y"}]}), TEXT)
        self.assertIsNone(out["recipe"])

    def test_no_moves_and_no_refusal_becomes_a_refusal(self):
        out, _ = dp.gate(plan(moves=[]), TEXT)
        self.assertEqual(out["kind"], "unknown")
        self.assertEqual(out["refusal"], "not_about_building")

    def test_a_complete_recipe_needs_no_move(self):
        full = {"ingredients": [{"item": "garlic", "quantity": "4 cloves"}], "steps": [{"text": "chop"}]}
        out, _ = dp.gate(plan(kind="recipe", moves=[], recipe=full), TEXT)
        self.assertEqual(out["kind"], "recipe")
        self.assertIsNone(out["refusal"])

    def test_a_kind_the_spec_does_not_know_is_an_error_not_a_guess(self):
        with self.assertRaises(dp.PlanError):
            dp.gate(plan(kind="vlog"), TEXT)


class DashTests(unittest.TestCase):
    def test_a_dash_is_rewritten_everywhere_but_the_evidence(self):
        out, counts = dp.gate(plan(summary="A skill — five of them — to install"), TEXT)
        self.assertNotIn("—", out["summary"])
        self.assertGreater(counts["dashes"], 0)

    def test_the_evidence_is_never_rewritten(self):
        """It is verbatim by definition, and rewriting it would fail the rule that admitted it."""
        text = TEXT + " and here is a dash — in the caption itself"
        ev = "here is a dash — in the caption itself"
        out, _ = dp.gate(plan(moves=[move(evidence=ev)]), text)
        self.assertEqual(out["moves"][0]["evidence"], ev)


if __name__ == "__main__":
    unittest.main()
