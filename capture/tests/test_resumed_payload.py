"""python3 -m unittest capture.tests.test_resumed_payload

A RESUMED sitting through the uploader. Claude Code's new transcript begins with a copy of
the old one's records (the same uuid, timestamp, message id and usage under a new session
id), and the sessionizer pools both files into one sitting. The corpus cut has read each
event once since the review that found it (`corpus.distinct`); the payload did not, and its
token ledger keyed on `(source, message.id)`, so the copy counted twice there and nowhere
else: one sitting, two answers, on the wire.
"""

from __future__ import annotations

import copy
import datetime as dt
import pathlib
import tempfile
import unittest

from analysis import corpus as cp
from analysis.tests import test_live as tl
from analysis.tests.test_cli import SITTING_TOKENS, records, write
from capture import sessions as cap

OLD = "5b1f6c2e-0000-4000-8000-00000000aaaa"
NEW = "5b1f6c2e-0000-4000-8000-00000000bbbb"


class ResumedSitting(unittest.TestCase):
    def test_the_payload_counts_the_copy_once_and_agrees_with_its_burn(self):
        """The suite's own resumed sitting (`test_cli.test_a_resumed_copy_is_counted_once`):
        two sittings' worth of distinct work, 6 tool calls, 2 prompts, 920 tokens. MEASURED
        before the fix, `build_payload`: tool calls 9, human_prompt_count 3, token buckets
        1,380 beside the same payload's `burn.tokens` 920. After: 6, 2, and 920 twice."""
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            first = records(tl.T0, sid=OLD, ids="a")
            write(root, first, sid=OLD)
            copied = [dict(r, sessionId=NEW) for r in copy.deepcopy(first)]
            more = records(tl.T0 + 60, sid=NEW, ids="b")
            more[0]["parentUuid"] = copied[-1]["uuid"]
            write(root, copied + more, sid=NEW)
            found = cp.transcripts(root)
            sittings = [
                s
                for s in cap.sessionize_sources([cap.load_source(t) for t in found], dt.UTC, now=tl.T0 + 86400)
                if s.state == "final"
            ]
            self.assertEqual(len(sittings), 1, "the two files are one sitting")
            p = cap.build_payload(sittings[0], dt.UTC, "m" * 64, "test")
        self.assertEqual(sum(p["tool_calls"].values()), 6)
        self.assertEqual(p["human_prompt_count"], 2)
        self.assertEqual(sum(p["tokens"].values()), 2 * SITTING_TOKENS)
        self.assertEqual(p["burn"]["tokens"], 2 * SITTING_TOKENS)

    def test_the_ledger_reads_a_message_once_across_a_sittings_files(self):
        """The copy is the same message id in a second source. MEASURED before the fix:
        3,000 output tokens for two messages of 1,000; after, 2,000."""
        u = {"input_tokens": 10, "output_tokens": 1000, "cache_read_input_tokens": 50000,
             "cache_creation_input_tokens": 2000}  # fmt: skip
        recs = [
            {"source_id": "a", "line": 1, "msg_id": "msg_01", "usage": u, "model": "claude-opus-4-8"},
            {"source_id": "b", "line": 1, "msg_id": "msg_01", "usage": u, "model": "claude-opus-4-8"},
            {"source_id": "b", "line": 2, "msg_id": "msg_02", "usage": u, "model": "claude-opus-4-8"},
        ]
        led = cap.token_ledger(recs)
        self.assertEqual(
            led.buckets, {"input": 20, "output": 2000, "cache_read": 100000, "cache_w5m": 4000, "cache_w1h": 0}
        )


if __name__ == "__main__":
    unittest.main()
