"""Burn forensics: the dedup rule, the refusals, and the attribution of a spike.

Every case is one a person could recompute by hand from the records in the test. The
three that matter most are the ones that protect against a plausible wrong number:

* usage repeated across a message's content blocks must be counted ONCE (1.878x is the
  measured inflation if it is not),
* a harness that writes no token counts must be refused, never reported as zero,
* a session with too few segments must refuse to name a spike rather than let the median
  be one of the three segments it is comparing against.
"""

from __future__ import annotations

import datetime as dt
import json
import pathlib
import tempfile
import unittest

from analysis import burn
from analysis.digest import Ev

#: 2026-09-01 09:00:00 UTC. Every timestamp below is an offset from it.
T0 = dt.datetime(2026, 9, 1, 9, 0, tzinfo=dt.UTC)


def iso(offset_s: float) -> str:
    return (T0 + dt.timedelta(seconds=offset_s)).isoformat().replace("+00:00", "Z")


def user_prompt(offset_s: float, text: str) -> dict:
    return {
        "type": "user",
        "timestamp": iso(offset_s),
        "message": {"role": "user", "content": [{"type": "text", "text": text}]},
        "promptSource": "typed",
    }


def assistant(
    offset_s: float,
    mid: str,
    *,
    usage: dict | None = None,
    blocks: list | None = None,
    model: str = "claude-opus-5",
) -> dict:
    return {
        "type": "assistant",
        "timestamp": iso(offset_s),
        "message": {
            "role": "assistant",
            "id": mid,
            "model": model,
            "usage": usage or {},
            "content": blocks or [{"type": "text", "text": "ok"}],
        },
    }


def tool_use(tid: str, name: str, inp: dict) -> dict:
    return {"type": "tool_use", "id": tid, "name": name, "input": inp}


def tool_result(offset_s: float, tid: str, content: str, is_error: bool = False) -> dict:
    return {
        "type": "user",
        "timestamp": iso(offset_s),
        "message": {
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": tid,
                    "content": content,
                    "is_error": is_error,
                }
            ],
        },
    }


def write_transcript(records: list[dict]) -> pathlib.Path:
    fd = tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False)
    for r in records:
        fd.write(json.dumps(r) + "\n")
    fd.close()
    return pathlib.Path(fd.name)


USAGE = {
    "input_tokens": 1000,
    "output_tokens": 200,
    "cache_creation_input_tokens": 50,
    "cache_read_input_tokens": 8000,
}


class UsageDeduplication(unittest.TestCase):
    """Claude Code repeats the identical `usage` object on every content-block record for
    one message. Summing records inflates by 1.878x on the reference corpus."""

    def test_one_message_written_as_three_records_is_counted_once(self):
        path = write_transcript(
            [
                user_prompt(0, "go"),
                assistant(1, "msg_a", usage=USAGE, blocks=[{"type": "text", "text": "one"}]),
                assistant(
                    1, "msg_a", usage=USAGE, blocks=[tool_use("t1", "Read", {"file_path": "/a.py"})]
                ),
                assistant(
                    1, "msg_a", usage=USAGE, blocks=[tool_use("t2", "Read", {"file_path": "/b.py"})]
                ),
            ]
        )
        turns = burn.load_turns(path)
        self.assertEqual(len(turns), 1)
        self.assertEqual(turns[0].total, 1000 + 200 + 50 + 8000)

    def test_tool_calls_from_every_record_of_the_message_are_kept(self):
        """Usage is deduplicated; the tool calls are not. They are different records of one
        message and each carries a distinct call."""
        path = write_transcript(
            [
                user_prompt(0, "go"),
                assistant(1, "msg_a", usage=USAGE, blocks=[tool_use("t1", "Read", {})]),
                assistant(1, "msg_a", usage=USAGE, blocks=[tool_use("t2", "Task", {})]),
            ]
        )
        turns = burn.load_turns(path)
        self.assertEqual(len(turns), 1)
        self.assertEqual(sorted(turns[0].tools), ["Read", "Task"])

    def test_distinct_message_ids_are_summed(self):
        path = write_transcript(
            [
                user_prompt(0, "go"),
                assistant(1, "msg_a", usage=USAGE),
                assistant(2, "msg_b", usage=USAGE),
            ]
        )
        turns = burn.load_turns(path)
        self.assertEqual(len(turns), 2)
        self.assertEqual(sum(t.total for t in turns), 2 * (1000 + 200 + 50 + 8000))


class Refusals(unittest.TestCase):
    """A number that is absent must say so. Reporting zero would be a claim about the
    session instead of a fact about the harness."""

    def test_a_harness_with_no_token_counts_is_refused_not_zeroed(self):
        """Cursor writes {0, 0} on all 14,565 message rows; usage is accounted server side."""
        path = write_transcript(
            [
                user_prompt(0, "go"),
                assistant(1, "msg_a", usage={"input_tokens": 0, "output_tokens": 0}),
                assistant(2, "msg_b", usage={"input_tokens": 0, "output_tokens": 0}),
            ]
        )
        rep = burn.burn_report(path)
        self.assertFalse(rep["harness_records_usage"])
        self.assertIsNone(rep["totals"]["tokens"]["value"])
        self.assertIn("reason", rep["totals"]["tokens"])
        self.assertTrue(any("token counts" in m for m in rep["sample"]["missing"]))

    def test_too_few_segments_refuses_to_name_a_spike(self):
        """With three segments the median IS one of them, so every session would report a
        spike or none depending on parity."""
        recs = [user_prompt(0, "first")]
        for i in range(3):
            recs.append(user_prompt(i * 10 + 1, f"prompt {i}"))
            recs.append(assistant(i * 10 + 2, f"m{i}", usage=USAGE))
        path = write_transcript(recs)
        rep = burn.burn_report(path)
        self.assertEqual(rep["spikes"], [])
        self.assertTrue(any("fewer than" in m for m in rep["sample"]["missing"]))

    def test_tokens_per_line_refuses_when_no_lines_changed(self):
        path = write_transcript(
            [user_prompt(0, "just look around"), assistant(1, "m0", usage=USAGE)]
        )
        rep = burn.burn_report(path)
        self.assertIsNone(rep["totals"]["tokens_per_line"]["value"])
        self.assertIn("reason", rep["totals"]["tokens_per_line"])


class Segmentation(unittest.TestCase):
    def test_work_before_the_first_prompt_is_not_dropped(self):
        """A resumed session, a `claude -p` run or an autonomous kickoff has agent work
        before any typed prompt. The first version dropped it and reported zero cost on
        every unattended run."""
        path = write_transcript(
            [
                assistant(0, "m0", usage=USAGE),
                assistant(5, "m1", usage=USAGE),
            ]
        )
        rep = burn.burn_report(path)
        self.assertGreaterEqual(rep["sample"]["segments"], 1)
        self.assertEqual(rep["totals"]["tokens"]["value"], 2 * (1000 + 200 + 50 + 8000))

    def test_each_prompt_opens_a_segment(self):
        recs = []
        for i in range(4):
            recs.append(user_prompt(i * 100, f"task {i}"))
            recs.append(assistant(i * 100 + 1, f"m{i}", usage=USAGE))
        path = write_transcript(recs)
        rep = burn.burn_report(path)
        self.assertEqual(rep["sample"]["segments"], 4)
        self.assertEqual(rep["segments"][2]["prompt"], "task 2")


class SpikesAndCauses(unittest.TestCase):
    def _corpus(self, *, heavy_usage: dict, heavy_blocks: list, heavy_extra=()) -> dict:
        """Six cheap segments and one expensive one, so the median is well defined."""
        cheap = {
            "input_tokens": 100,
            "output_tokens": 20,
            "cache_creation_input_tokens": 0,
            "cache_read_input_tokens": 100,
        }
        recs: list[dict] = []
        for i in range(6):
            recs.append(user_prompt(i * 100, f"small task {i}"))
            recs.append(assistant(i * 100 + 1, f"c{i}", usage=cheap))
        recs.append(user_prompt(1000, "the expensive one"))
        recs.append(assistant(1001, "heavy", usage=heavy_usage, blocks=heavy_blocks))
        recs.extend(heavy_extra)
        return burn.burn_report(write_transcript(recs))

    def test_a_subagent_fanout_is_named_as_the_cause(self):
        rep = self._corpus(
            heavy_usage={
                "input_tokens": 200_000,
                "output_tokens": 5_000,
                "cache_creation_input_tokens": 0,
                "cache_read_input_tokens": 0,
            },
            heavy_blocks=[tool_use(f"t{i}", "Task", {"prompt": "go"}) for i in range(7)],
        )
        self.assertTrue(rep["spikes"], "the expensive segment should be a spike")
        top = rep["spikes"][0]
        self.assertEqual(top["subagents"], 7)
        self.assertEqual(top["causes"][0]["cause"], "subagent_fanout")
        self.assertEqual(top["causes"][0]["n"], 7)

    def test_a_spike_that_wrote_nothing_is_marked_barren(self):
        rep = self._corpus(
            heavy_usage={
                "input_tokens": 200_000,
                "output_tokens": 5_000,
                "cache_creation_input_tokens": 0,
                "cache_read_input_tokens": 0,
            },
            heavy_blocks=[tool_use("t0", "Task", {"prompt": "go"})],
        )
        top = rep["spikes"][0]
        self.assertTrue(top["barren"])
        self.assertFalse(top["produced_work"])
        self.assertGreater(rep["totals"]["barren_token_share"]["value"], 0.5)

    def test_context_replay_is_named_when_most_of_the_cost_is_cache_reads(self):
        rep = self._corpus(
            heavy_usage={
                "input_tokens": 1_000,
                "output_tokens": 500,
                "cache_creation_input_tokens": 0,
                "cache_read_input_tokens": 300_000,
            },
            heavy_blocks=[{"type": "text", "text": "thinking about it"}],
        )
        top = rep["spikes"][0]
        kinds = [c["cause"] for c in top["causes"]]
        self.assertIn("context_replay", kinds)

    def test_an_error_loop_is_named(self):
        extra = [tool_result(1002 + i, f"e{i}", "Error: ENOENT no such file", True) for i in range(4)]
        rep = self._corpus(
            heavy_usage={
                "input_tokens": 200_000,
                "output_tokens": 5_000,
                "cache_creation_input_tokens": 0,
                "cache_read_input_tokens": 0,
            },
            heavy_blocks=[tool_use(f"e{i}", "Bash", {"command": "npm test"}) for i in range(4)],
            heavy_extra=extra,
        )
        top = rep["spikes"][0]
        kinds = [c["cause"] for c in top["causes"]]
        self.assertIn("error_loop", kinds)
        self.assertIn("repeated_call", kinds)


class PlainLanguage(unittest.TestCase):
    """docs/analysis.md: no dashes in any string a person reads. The rule is absolute."""

    def test_no_dashes_in_any_sentence(self):
        for template in burn._CAUSE_SENTENCES.values():
            self.assertNotIn("—", template)
            self.assertNotIn("–", template)

    def test_a_refused_harness_says_so_in_one_sentence(self):
        path = write_transcript(
            [user_prompt(0, "go"), assistant(1, "m", usage={"input_tokens": 0})]
        )
        lines = burn.explain(burn.burn_report(path))
        self.assertEqual(len(lines), 1)
        self.assertIn("does not record token counts", lines[0])

    def test_the_summary_names_tokens_and_lines(self):
        path = write_transcript(
            [
                user_prompt(0, "go"),
                assistant(1, "m", usage=USAGE),
            ]
        )
        lines = burn.explain(burn.burn_report(path))
        self.assertTrue(any("tokens" in line and "lines" in line for line in lines))

    def test_every_sentence_is_free_of_dashes_on_a_real_report(self):
        recs = []
        for i in range(6):
            recs.append(user_prompt(i * 100, f"task {i}"))
            recs.append(assistant(i * 100 + 1, f"m{i}", usage=USAGE))
        path = write_transcript(recs)
        for line in burn.explain(burn.burn_report(path)):
            self.assertNotIn("—", line)
            self.assertNotIn("–", line)


class EmptyAndBroken(unittest.TestCase):
    def test_an_empty_transcript_does_not_raise(self):
        path = write_transcript([])
        rep = burn.burn_report(path)
        self.assertEqual(rep["sample"]["segments"], 0)

    def test_a_partial_trailing_line_is_never_consumed(self):
        """Transcripts are appended to while being read; the last line is routinely half
        written."""
        fd = tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False)
        fd.write(json.dumps(user_prompt(0, "go")) + "\n")
        fd.write(json.dumps(assistant(1, "m0", usage=USAGE)) + "\n")
        fd.write('{"type": "assistant", "message": {"id": "m1", "usa')  # no newline
        fd.close()
        turns = burn.load_turns(pathlib.Path(fd.name))
        self.assertEqual(len(turns), 1)

    def test_a_malformed_line_in_the_middle_is_skipped(self):
        fd = tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False)
        fd.write(json.dumps(user_prompt(0, "go")) + "\n")
        fd.write("{not json at all\n")
        fd.write(json.dumps(assistant(1, "m0", usage=USAGE)) + "\n")
        fd.close()
        self.assertEqual(len(burn.load_turns(pathlib.Path(fd.name))), 1)


if __name__ == "__main__":
    unittest.main()
