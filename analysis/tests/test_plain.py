"""The shared words: a file's role, numbers said out loud, and the one definition of a dash.

`docs/overnight-engine.md` section 1. `live.py`, `vocab.py` and `wrapped.py` all speak
through these, so a rule that drifted here would reword three surfaces at once. The two
fields `load_claude_code_events` now stamps on `digest.Ev` are tested here too, because
the promise that goes with them (the digest text does not move) is about the digest, not
about the module that reads them.
"""

from __future__ import annotations

import dataclasses
import json
import pathlib
import tempfile
import unittest

from analysis import digest, languages, plain, shipped

REPO = pathlib.Path(__file__).resolve().parents[2]
LIVE_PATH = REPO / "spec" / "fixtures" / "live_path"


class RoleOf(unittest.TestCase):
    #: One path per role, and the rule each one exercises.
    ONE_PER_ROLE = {
        "dependency": "/repo/mobile/bun.lock",
        "migration": "/repo/server/migrations/0003_rls.sql",
        "test": "/repo/analysis/tests/test_live.py",
        "docs": "/repo/docs/overnight-engine.md",
        "style": "/repo/web/site.css",
        "build": "/repo/Makefile",
        "config": "/repo/mobile/app.json",
        "source": "/repo/analysis/live.py",
        "unknown": "/repo/assets/logo.zzz",
    }

    def test_one_path_per_role(self):
        for role, path in self.ONE_PER_ROLE.items():
            self.assertEqual(plain.role_of(path), role, path)
        self.assertEqual(set(self.ONE_PER_ROLE), set(plain.ROLES))

    def test_spec_is_configuration_not_a_test(self):
        """This repository's `spec/` holds JSON specs. A `spec` segment rule would have
        made the strip spec a test file."""
        self.assertEqual(plain.role_of("spec/strip.v1.json"), "config")
        self.assertEqual(plain.role_of(str(REPO / "spec" / "strip.v1.json")), "config")

    def test_first_match_wins(self):
        # A manifest under tests/ is still the dependency list.
        self.assertEqual(plain.role_of("/r/tests/package.json"), "dependency")
        # A migration written in Python is a migration before it is source.
        self.assertEqual(plain.role_of("/r/server/0012_add_posts.py"), "migration")
        self.assertEqual(plain.role_of("/r/alembic/versions/abc.py"), "migration")
        # Docs under a test directory are the test suite's.
        self.assertEqual(plain.role_of("/r/tests/README.md"), "test")
        # A workflow YAML is the build setup, not configuration.
        self.assertEqual(plain.role_of("/r/.github/workflows/ci.yml"), "build")

    def test_test_file_names(self):
        for name in (
            "test_x.py",
            "x_test.py",
            "x_test.go",
            "a.test.ts",
            "a.spec.tsx",
            "a.test.js",
            "FooTests.swift",
            "FooTest.swift",
            "FooTest.java",
            "FooTest.kt",
        ):
            self.assertEqual(plain.role_of(f"/r/src/{name}"), "test", name)
        self.assertEqual(plain.role_of("/r/src/__tests__/a.ts"), "test")
        self.assertEqual(plain.role_of("/r/src/testing.py"), "source")

    def test_config_shapes(self):
        for path in ("/r/.env", "/r/.eslintrc", "/r/vite.config.ts", "/r/metro.config.cjs", "/r/a.plist"):
            self.assertEqual(plain.role_of(path), "config", path)

    def test_windows_separators_and_case(self):
        self.assertEqual(plain.role_of(r"C:\r\Tests\a.py"), "test")
        self.assertEqual(plain.role_of("/r/DOCS/INDEX.MD"), "docs")

    def test_it_reads_the_modules_that_own_the_names(self):
        """One rule, one list: the dependency names are `languages.GENERATED_NAMES` and
        `shipped.MANIFESTS`, never a third copy."""
        for name in (*languages.GENERATED_NAMES, *shipped.MANIFESTS):
            self.assertEqual(plain.role_of(f"/r/{name}"), "dependency", name)

    def test_empty_is_unknown(self):
        self.assertEqual(plain.role_of(""), "unknown")
        self.assertEqual(plain.role_of("/r/"), "unknown")


class Numbers(unittest.TestCase):
    def test_spoken(self):
        self.assertEqual(
            [plain.spoken(n) for n in (0, 1, 6, 11, 20, 21, 34, 1000)],
            ["zero", "one", "six", "eleven", "twenty", "21", "34", "1000"],
        )

    def test_ordinal(self):
        self.assertEqual(
            [plain.ordinal(n) for n in (1, 2, 3, 10, 11, 12, 13, 21, 22, 23, 101, 111, 0)],
            [
                "first",
                "second",
                "third",
                "tenth",
                "11th",
                "12th",
                "13th",
                "21st",
                "22nd",
                "23rd",
                "101st",
                "111th",
                "0th",
            ],
        )


class OneRoundingRule(unittest.TestCase):
    """`plain.half_up`: a tie AWAY from zero, read off the number as it is written. THE rule
    for every number a person reads. FOUND IN THE CAPTURE (2026-09-14): "18% of instructions
    landed clean" for 120 of 647, a share sent as 0.185 and rounded half to even."""

    def test_the_landed_clean_share_is_nineteen_percent(self):
        self.assertEqual(plain.pct(0.185), "19%")
        self.assertEqual(plain.pct(120 / 647), "19%")

    def test_a_tie_rounds_up_not_to_the_even_digit(self):
        self.assertEqual(plain.pct(0.125), "13%")
        self.assertEqual(plain.pct(0.625), "63%")
        self.assertEqual(plain.rounded(2.5), 3)
        self.assertEqual(plain.rounded(0.5), 1)
        self.assertEqual(plain.rounded(6.25, 1), 6.3)
        self.assertEqual(plain.rounded(-2.5), -3)

    def test_the_number_as_written_not_the_double_under_it(self):
        # 2.675 and 0.285 are stored a hair under themselves; a person reads the digits.
        self.assertEqual(plain.rounded(2.675, 2), 2.68)
        self.assertEqual(plain.pct(0.285), "29%")
        self.assertEqual(str(plain.half_up(1234.55, 1)), "1234.6")

    def test_the_decimal_point_moves_in_decimal(self):
        self.assertEqual(plain.half_up(12_500, scale=-3), 13)
        self.assertEqual(str(plain.half_up(3_631_450_000, 1, scale=-6)), "3631.5")

    def test_not_a_tie_goes_to_the_nearer_side(self):
        self.assertEqual(plain.pct(0.1849), "18%")
        self.assertEqual(plain.pct(0.004), "0%")
        self.assertEqual(plain.rounded(0.18547, 3), 0.185)

    def test_the_types_round_gives(self):
        self.assertIsInstance(plain.rounded(2.4), int)
        self.assertIsInstance(plain.rounded(2.4, 1), float)
        # A count rounded to places is still that count: never 0.0 on the wire.
        self.assertEqual(json.dumps(plain.rounded(0, 2)), "0")
        self.assertEqual(json.dumps(plain.rounded(7, 1)), "7")

    def test_it_refuses_what_is_not_a_number(self):
        for bad in (float("nan"), float("inf")):
            with self.assertRaises(ValueError):
                plain.half_up(bad)

    #: Every module that says a number a person reads, on the Mac or on the phone. Parsers
    #: (timestamps, not numbers anyone reads) and the digest (the model's input) are not here.
    SAYS_NUMBERS = (
        "agents", "brag", "burn", "calls", "contributions", "corpus", "feedback", "languages",
        "live", "narrative", "patterns", "playbook", "pricing", "profile", "projects",
        "quality", "report", "report_blocks", "shipped", "trends", "vocab", "wrapped",
        "__main__",
    )

    def test_no_module_that_says_a_number_rounds_on_its_own(self):
        import re

        bare = re.compile(r"(?<![\w.])round\(")
        fmt = re.compile(r"\{[^{}]*:[,]?\.\d[f%]\}")
        for name in self.SAYS_NUMBERS:
            src = (REPO / "analysis" / f"{name}.py").read_text()
            code = "\n".join(
                line.split("#", 1)[0] for line in src.splitlines() if not line.lstrip().startswith(("#", '"', "`"))
            )
            self.assertIsNone(bare.search(code), f"{name}.py rounds with round(), not plain.rounded")
            if name in ("burn", "profile", "pricing", "projects"):
                self.assertIsNone(fmt.search(code), f"{name}.py rounds in a format spec, not plain.half_up")


class Dashes(unittest.TestCase):
    def test_what_is_a_dash(self):
        for text in ("a " + chr(0x2014) + " b", "a" + chr(0x2013) + "b", "a - b", "a -- b"):
            self.assertTrue(plain.has_dash(text), repr(text))

    def test_what_is_not(self):
        for text in ("read-only", "--json", "a-b", "3 -1", "under a minute"):
            self.assertFalse(plain.has_dash(text), repr(text))

    def test_no_word_this_module_owns_has_one(self):
        for nouns in plain.ROLE_NOUN.values():
            for n in (1, 2, 21):
                for text in nouns:
                    self.assertFalse(plain.has_dash(text.format(n=plain.spoken(n))))
        for n in range(0, 40):
            self.assertFalse(plain.has_dash(plain.spoken(n)))
            self.assertFalse(plain.has_dash(plain.ordinal(n)))
        self.assertEqual(set(plain.ROLE_NOUN), set(plain.ROLES))


def _cleared(events):
    return [dataclasses.replace(e, result_ts=None, stop_reason=None) for e in events]


class TheTwoEvFields(unittest.TestCase):
    """`result_ts` and `stop_reason` (docs/overnight-engine.md 1.2)."""

    def test_the_digest_text_does_not_move(self):
        """Neither field is read by `stats` or `render`: over every live path fixture the
        digest is byte identical with the fields and with them cleared."""
        paths = sorted(LIVE_PATH.glob("*.jsonl"))
        self.assertGreaterEqual(len(paths), 3)
        for path in paths:
            events = digest.load_claude_code_events(path)
            built = digest.build(path)
            text, _ = digest.render(_cleared(events), {"harness": "claude_code"})
            self.assertEqual(built["text"], text, path.name)
            self.assertEqual(built["stats"], digest.stats(_cleared(events)), path.name)

    def test_stamped_from_the_records(self):
        recs = [
            {
                "type": "user",
                "timestamp": "2026-09-13T10:00:00Z",
                "promptSource": "typed",
                "message": {"role": "user", "content": "run it"},
            },
            {
                "type": "assistant",
                "timestamp": "2026-09-13T10:00:05Z",
                "message": {
                    "id": "m1",
                    "stop_reason": "tool_use",
                    "content": [
                        {"type": "tool_use", "id": "t1", "name": "Bash", "input": {"command": "ls"}},
                        {"type": "tool_use", "id": "t2", "name": "Bash", "input": {"command": "false"}},
                    ],
                },
            },
            {
                "type": "user",
                "timestamp": "2026-09-13T10:00:09Z",
                "message": {
                    "role": "user",
                    "content": [
                        {"type": "tool_result", "tool_use_id": "t2", "content": "boom", "is_error": True},
                        {"type": "tool_result", "tool_use_id": "t1", "content": "a b"},
                    ],
                },
            },
            {
                "type": "assistant",
                "timestamp": "2026-09-13T10:00:12Z",
                "message": {
                    "id": "m2",
                    "stop_reason": "end_turn",
                    "content": [{"type": "text", "text": "Done."}],
                },
            },
            {
                "type": "assistant",
                "timestamp": "2026-09-13T10:00:13Z",
                "message": {"id": "m3", "stop_reason": 7, "content": [{"type": "text", "text": "x"}]},
            },
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp) / "t.jsonl"
            path.write_text("".join(json.dumps(r) + "\n" for r in recs))
            events = digest.load_claude_code_events(path)
        tools = [e for e in events if e.kind == "tool"]
        said = [e for e in events if e.kind == "assistant"]
        t9 = digest._ts("2026-09-13T10:00:09Z")
        # Both calls answered at +9, the failing one and the ok one, paired on the id.
        self.assertEqual([e.result_ts for e in tools], [t9, t9])
        self.assertEqual([e.stop_reason for e in tools], ["tool_use", "tool_use"])
        # A stop reason that is not a string is not read (type check at every level).
        self.assertEqual([e.stop_reason for e in said], ["end_turn", None])
        self.assertTrue(all(e.result_ts is None for e in said))

    def test_other_loaders_leave_them_none(self):
        e = digest.Ev(0, 1.0, "tool", tool="shell")
        self.assertIsNone(e.result_ts)
        self.assertIsNone(e.stop_reason)


if __name__ == "__main__":
    unittest.main()


class OneListOfDashes(unittest.TestCase):
    def test_run_rewrites_exactly_what_has_dash_catches(self):
        """FOUND IN REVIEW: `run._DASHES` held four characters and `plain.DASH` two, so a
        horizontal bar or a minus sign passed `has_dash` while `run` rewrote it."""
        from analysis import run

        self.assertIs(run._dashes(), plain.DASH_CHARS)
        for ch in plain.DASH_CHARS:
            self.assertTrue(plain.has_dash(f"a {ch} b"), hex(ord(ch)))
            self.assertTrue(plain.has_dash(f"a{ch}b"), hex(ord(ch)))
        for ok in ("go-to", "10-character", "end-to-end", "read-only", "--json"):
            self.assertFalse(plain.has_dash(ok), ok)
