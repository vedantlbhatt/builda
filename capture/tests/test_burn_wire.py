"""python3 -m unittest capture.tests.test_burn_wire

The per session `burn` and `title_ids` blocks (contract v4, the orchestrator's addendum):
numbers and enums computed on the machine by `analysis.burn` and `analysis.vocab` over the
session window, so the phone can write "This session used 48.2M tokens, ..." and "Debugged
a failing test suite" from ids and say what Python says.

`capture.sessions.session_burn` is `burn.session_wire(burn.session_report(...))`, the one
producer of the block, over the sitting's own events and turns (a pooled sitting can span
two files, where `burn_report` reads one). `BurnReportParity` holds it to `burn_report` over
the same bytes, field by field, so the uploaded block and the sentences `explain` writes
can never be about two different reports.
"""

from __future__ import annotations

import datetime as dt
import json
import pathlib
import tempfile
import unittest

from analysis import burn, digest, vocab
from analysis.tests import transcripts as tr
from capture import sessions
from capture.discover import Transcript
from capture.tests import spec_walk

ROOT = pathlib.Path(__file__).resolve().parents[2]
CONTRACT = json.loads((ROOT / "privacy" / "upload-contract.json").read_text())
CWD = tr.CWD


def many_stretches() -> tr.Builder:
    """Six prompts, so six segments. Every message carries 115 tokens (`tr.USAGE`), so a
    segment costs 115 per message: 230, 115, 1,265, 230, 115, 230. The median is 230 and
    the third, eleven messages (three failing test runs, six reads, an edit, a commit), is
    the one spike at 1,265 / 230 = 5.5x. The fifth only reads (barren); the sixth runs a
    script that could have written something the transcript does not show (unreadable)."""
    b = tr.Builder()
    b.prompt(0, "zqx sentinel prompt: look at the auth flow")
    b.read(5, f"{CWD}/src/a.py")
    b.read(10, f"{CWD}/src/b.py")
    b.prompt(100, "now the login page")
    b.read(105, f"{CWD}/src/login.py")
    b.prompt(200, "fix the failing tests")
    for i in range(3):
        b.bash(210 + 10 * i, "pytest -q", fail=211 + 10 * i)
    for i in range(6):
        b.read(250 + 5 * i, f"{CWD}/src/r{i}.py")
    b.edit(300, f"{CWD}/src/a.py", added=12, removed=3)
    b.bash(310, 'git commit -m "zqx sentinel subject"', ok=311)
    b.prompt(400, "and the docs")
    b.create(405, "/tmp/zqx_sentinel_dir/zqx_secret.py", 4)
    b.read(410, f"{CWD}/docs/x.md")
    b.prompt(500, "what else reads the token?")
    b.read(505, f"{CWD}/src/token.py")
    b.prompt(600, "regenerate the client")
    b.bash(605, "zqxcmd --flag")
    b.bash(610, "python3 scripts/gen.py")
    return b


class _Burn(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, b: tr.Builder, **kw) -> pathlib.Path:
        return tr.write_transcript(b.records, self.root, **kw)

    def wire(self, path: pathlib.Path) -> dict:
        return sessions.session_burn(digest.load_claude_code_events(path), burn.load_turns(path))

    def walk(self, obj: str, value) -> list[str]:
        return spec_walk.errors(value, CONTRACT["objects"][obj], objects=CONTRACT["objects"], enums=CONTRACT["enums"])


class BurnReportParity(_Burn):
    def test_every_number_is_burn_reports_over_the_same_bytes(self):
        path = self.write(many_stretches())
        w = self.wire(path)
        rep = burn.burn_report(path)
        t = rep["totals"]
        self.assertIsNone(w["reason"])
        self.assertEqual(w["tokens"], t["tokens"]["value"])
        self.assertEqual(w["segments"], rep["sample"]["segments"])
        self.assertEqual(w["segments"], 6)
        self.assertEqual(round(w["cache_read_share"], 3), t["cache_read_share"]["value"])
        self.assertEqual(round(w["barren_share"], 3), t["barren_token_share"]["value"])
        self.assertEqual(round(w["unreadable_share"], 3), t["unreadable_token_share"]["value"])
        # Unrounded: the integers the report divides, so the phone rounds once.
        self.assertEqual(w["cache_read_share"], t["cache_read_share"]["cache_read_tokens"] / w["tokens"])
        self.assertEqual(w["barren_share"], t["barren_token_share"]["barren_tokens"] / w["tokens"])
        self.assertEqual(w["unreadable_share"], t["unreadable_token_share"]["unreadable_tokens"] / w["tokens"])
        self.assertGreater(w["barren_share"], 0)
        self.assertGreater(w["unreadable_share"], 0)
        self.assertEqual((w["lines_added"], w["lines_removed"]), (t["lines_added"]["value"], t["lines_removed"]["value"]))
        self.assertEqual(w["files_changed"], t["files_touched"]["value"])
        self.assertEqual(w["commits"], sum(r["commits"] for r in rep["segments"]))
        self.assertEqual(w["spikes_needed"], burn.MIN_SEGMENTS_FOR_SPIKES)

    def test_the_spikes_are_burn_reports_with_the_dominant_cause_first(self):
        path = self.write(many_stretches())
        w = self.wire(path)
        rep = burn.burn_report(path)
        self.assertEqual([s["tokens"] for s in w["spikes"]], [r["tokens"] for r in rep["spikes"][:3]])
        self.assertEqual(len(w["spikes"]), 1)
        [spike], [row] = w["spikes"], rep["spikes"]
        self.assertEqual(spike["multiple"], row["multiple_of_median"])
        self.assertEqual(spike["multiple"], 5.5)
        for key, theirs in (
            ("barren", "barren"),
            ("lines_added", "lines_added"),
            ("lines_removed", "lines_removed"),
            ("files_changed", "files_touched"),
            ("commits", "commits"),
            ("unreadable", "unreadable"),
        ):
            self.assertEqual(spike[key], row[theirs], key)
        self.assertEqual(spike["seconds"], int(row["seconds"]))
        # causes[0] is the one `explain` names, and its share is the one it prints.
        dom = row["dominant"]
        self.assertEqual((spike["causes"][0]["cause"], spike["causes"][0]["tokens"]), (dom["cause"], dom["tokens"]))
        self.assertEqual({c["cause"] for c in spike["causes"]}, {c["cause"] for c in row["causes"]} & {c["cause"] for c in spike["causes"]})
        tokens = [c["tokens"] or 0 for c in spike["causes"]]
        self.assertEqual(tokens, sorted(tokens, reverse=True))
        self.assertIn("error_loop", {c["cause"] for c in spike["causes"]})

    def test_a_sitting_cut_by_capture_carries_the_same_block(self):
        path = self.write(many_stretches())
        src = sessions.load_source(Transcript(path.parent.name, path))
        [s] = sessions.sessionize_sources([src], dt.UTC, now=tr.T0 + 7200)
        self.assertEqual(sessions.session_burn_of(s), self.wire(path))
        p = sessions.build_payload(s, dt.UTC, "1" * 64, "test")
        self.assertEqual(p["burn"], self.wire(path))


class Refusals(_Burn):
    def test_under_five_segments_spikes_are_null_never_empty(self):
        b = tr.Builder().prompt(0, "one")
        b.read(5, f"{CWD}/a.py")
        b.prompt(100, "two")
        b.read(105, f"{CWD}/b.py")
        w = self.wire(self.write(b))
        self.assertEqual((w["segments"], w["spikes"], w["spikes_needed"]), (2, None, 5))
        self.assertIsNotNone(w["tokens"])

    def test_enough_segments_and_none_clears_the_bar_is_an_empty_list(self):
        b = tr.Builder()
        for i in range(5):
            b.prompt(100 * i, f"step {i}")
            b.read(100 * i + 5, f"{CWD}/s{i}.py")
        w = self.wire(self.write(b))
        self.assertEqual((w["segments"], w["spikes"]), (5, []))

    def test_no_token_counts_is_a_refusal_with_the_work_still_counted(self):
        b = many_stretches()
        for r in b.records:
            if r["type"] == "assistant":
                r["message"]["usage"] = {}
        w = self.wire(self.write(b))
        self.assertEqual(w["reason"], "no_token_counts")
        for k in ("tokens", "cache_read_share", "barren_share", "unreadable_share", "spikes"):
            self.assertIsNone(w[k], k)
        self.assertEqual(w["lines_added"], 16)  # 12 edited, 4 in the created file
        self.assertEqual(w["segments"], 6)

    def test_no_events_is_not_segmented_and_every_count_is_null(self):
        w = sessions.session_burn([], [])
        self.assertEqual((w["reason"], w["segments"]), ("not_segmented", 0))
        for k in ("tokens", "lines_added", "lines_removed", "files_changed", "commits", "spikes"):
            self.assertIsNone(w[k], k)

    def test_every_refusal_is_a_contract_code(self):
        self.assertTrue({"no_token_counts", "not_segmented", "nothing_inside_segments"} <= set(CONTRACT["enums"]["burn_refusal"]))


class Shape(_Burn):
    def test_the_block_is_the_contracts_shape_and_carries_no_word(self):
        path = self.write(many_stretches())
        for value in (self.wire(path), sessions.session_burn([], [])):
            self.assertEqual(self.walk("SessionBurn", value), [])
        blob = json.dumps(self.wire(path))
        for local in ("zqx", "sentinel", "pytest", "auth", "/tmp", "src/", "Read", "Bash"):
            self.assertNotIn(local, blob)

    def test_a_repeated_call_says_what_repeated_and_nothing_else_does(self):
        b = tr.Builder().prompt(0, "go")
        for i in range(4):
            b.bash(10 + 10 * i, "npm run build", ok=11 + 10 * i)
        for i in range(4):
            b.prompt(100 * (i + 1), f"more {i}")
            b.read(100 * (i + 1) + 5, f"{CWD}/x{i}.py")
        seg = burn.segments(*self._events_turns(self.write(b)))[0]
        causes = burn._wire_causes(seg.causes())
        rep = next(c for c in causes if c["cause"] == "repeated_call")
        self.assertEqual((rep["repeat"], rep["n"]), ("shell", 4))
        self.assertTrue(all(c["repeat"] is None for c in causes if c["cause"] != "repeated_call"))

    def _events_turns(self, path):
        return digest.load_claude_code_events(path), burn.load_turns(path)


class TitleIds(_Burn):
    def cut(self, b: tr.Builder):
        path = self.write(b)
        src = sessions.load_source(Transcript(path.parent.name, path))
        [s] = sessions.sessionize_sources([src], dt.UTC, now=tr.T0 + 7200)
        return s

    def test_title_ids_are_the_title_rules_verb_object_and_numbers(self):
        s = self.cut(many_stretches())
        got = sessions.title_ids(s)
        from analysis import patterns

        t = vocab.session_title(
            patterns.SessionEvents(
                session_id="x", started_at=s.started_at, ended_at=s.ended_at, active_seconds=1.0,
                attended_seconds=1.0, tz_offset_minutes=0, events=s.events,
            )
        )
        self.assertEqual(
            got,
            {"verb": t["verb"], "object": t["object"], "n": t["count"], "modules": t["modules"], "reason": None},
        )
        # The failing runs never came back green (no recovery), so the commit and the lines
        # title it: two source files (src/a.py and the created one) in two directories.
        self.assertEqual(got, {"verb": "shipped", "object": "source", "n": 2, "modules": 2, "reason": None})
        self.assertEqual(self.walk("SessionTitleIds", got), [])
        self.assertNotIn("zqx", json.dumps(got))

    def test_a_refused_title_is_a_reason_not_a_null(self):
        """Null on the wire means "not computed" (an image without `analysis/`), and the
        server keeps a stored title when it gets one. A REFUSAL is a document: no verb, no
        object, and `vocab.session_title`'s code."""
        b = tr.Builder().prompt(0, "hello")
        b.say(5, "Hi.")
        got = sessions.title_ids(self.cut(b))
        self.assertEqual(
            got, {"verb": None, "object": None, "n": None, "modules": None, "reason": "no_tool_calls"}
        )
        self.assertEqual(self.walk("SessionTitleIds", got), [])

    def test_the_final_cut_that_refuses_says_so_where_the_live_cut_titled(self):
        """FOUND IN THE ADVERSARIAL REVIEW (2026-09-13, `advrev/code/probes/title_stale.py`):
        14 script calls are too few for the checkpoint bar and get a title; 40 of the same
        call are a sitting whose writes the transcript hides, and the title is refused. The
        wire said null for the refusal, so the server kept the live cut's title forever."""
        from analysis import feedback

        def sitting(calls: int) -> tr.Builder:
            b = tr.Builder().prompt(0, "fix the page")
            for i in range(calls):
                b.bash(10 + 5 * i, "python3 - <<'PY'\np='src/a.py'\nPY")
            return b

        live = sessions.title_ids(self.cut(sitting(feedback.MIN_TOOL_CALLS - 1)))
        final = sessions.title_ids(self.cut(sitting(40)))
        self.assertIsNotNone(live["verb"], live)
        self.assertIsNone(live["reason"])
        self.assertEqual(
            final,
            {"verb": None, "object": None, "n": None, "modules": None, "reason": "below_checkpoint_density"},
        )
        self.assertEqual(self.walk("SessionTitleIds", final), [])

    def test_the_payload_carries_both_blocks(self):
        s = self.cut(many_stretches())
        p = sessions.build_payload(s, dt.UTC, "1" * 64, "test")
        self.assertEqual(p["title_ids"], sessions.title_ids(s))
        self.assertIn("burn", p)


if __name__ == "__main__":
    unittest.main()
