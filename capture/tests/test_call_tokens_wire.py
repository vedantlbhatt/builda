"""python3 -m unittest capture.tests.test_call_tokens_wire

The per session `call_tokens` block (contract v4 `SessionCallTokens`): what every call to the
model sent and got back, computed on the machine by `analysis.calls` over the sitting's files,
so the phone can draw one bar per call and say "Call 1, in the first minute: sent 167,003
tokens, 26,448 re-read and 140,555 new."

`capture.sessions.session_calls_of` is `calls.session_calls` over the sitting, the one producer
of the block. These hold it to three things a person could check by hand: its points sum to the
tokens the same payload's `burn` block counts; a call that came back to an expired cache is
flagged even when the break that expired it is the one that ended the sitting before; and the
block is the contract's shape and carries no word.
"""

from __future__ import annotations

import datetime as dt
import json
import pathlib
import tempfile
import unittest

from analysis import calls
from analysis.tests import transcripts as tr
from capture import sessions
from capture.discover import Transcript
from capture.tests import spec_walk

ROOT = pathlib.Path(__file__).resolve().parents[2]
CONTRACT = json.loads((ROOT / "privacy" / "upload-contract.json").read_text())
CWD = tr.CWD

#: The break between the two sittings: longer than the cache's hour and than any idle
#: threshold, so the cut makes two sittings and the second's first call finds the cache gone.
AWAY = 4_200


def _usage(read: int, write: int, out: int = 150) -> dict:
    return {
        "input_tokens": 2,
        "output_tokens": out,
        "cache_creation_input_tokens": write,
        "cache_read_input_tokens": read,
        "cache_creation": {"ephemeral_5m_input_tokens": 0, "ephemeral_1h_input_tokens": write},
    }


def two_sittings() -> tr.Builder:
    """A conversation that works for ten minutes, goes away for 70, and comes back: each
    sitting a prompt and eight calls. The first call writes 40,000 tokens into the cache, each
    after it re-reads everything so far; the call that comes back re-reads the 20,000 token
    prefix other sessions keep warm and writes the rest of the conversation again."""
    b = tr.Builder().prompt(0, "zqx sentinel prompt: look at the auth flow")
    for i in range(8):
        b.read(10 + 60 * i, f"{CWD}/src/a{i}.py")
    back = 10 + 60 * 7 + AWAY
    b.prompt(back - 5, "zqx sentinel prompt: now the login page")
    for i in range(8):
        b.edit(back + 40 * i, f"{CWD}/src/login{i}.py", added=3, removed=1)
    context = 40_000
    first_back = True
    n = 0
    for r in b.records:
        if r["type"] != "assistant":
            continue
        if n == 0:
            r["message"]["usage"] = _usage(0, context)
        elif n == 8 and first_back:
            r["message"]["usage"] = _usage(20_000, context - 20_000 + 900)
            first_back = False
            context += 900
        else:
            r["message"]["usage"] = _usage(context, 900)
            context += 900
        n += 1
    return b


class _Cut(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def cut(self, b: tr.Builder) -> tuple[pathlib.Path, list[sessions.Session]]:
        path = tr.write_transcript(b.records, self.root)
        src = sessions.load_source(Transcript(path.parent.name, path))
        return path, sessions.sessionize_sources([src], dt.UTC, now=tr.T0 + 20_000)

    def walk(self, value) -> list[str]:
        return spec_walk.errors(value, CONTRACT["objects"]["SessionCallTokens"], objects=CONTRACT["objects"], enums=CONTRACT["enums"])


class ThePayload(_Cut):
    def test_each_sitting_carries_the_block_the_one_producer_computes(self):
        path, cut = self.cut(two_sittings())
        self.assertEqual(len(cut), 2)
        for s in cut:
            p = sessions.build_payload(s, dt.UTC, "1" * 64, "test")
            self.assertEqual(p["call_tokens"], calls.session_calls([path], s.started_at, s.ended_at))
            self.assertEqual(p["call_tokens"], sessions.session_calls_of(s))
            self.assertEqual(p["call_tokens"]["calls"], 8)

    def test_the_points_sum_to_the_burn_blocks_tokens(self):
        _path, cut = self.cut(two_sittings())
        for s in cut:
            p = sessions.build_payload(s, dt.UTC, "1" * 64, "test")
            drawn = sum(x["cache_read"] + x["cache_write"] + x["input"] + x["output"] for x in p["call_tokens"]["points"])
            self.assertEqual(drawn, p["burn"]["tokens"])

    def test_the_return_after_the_break_that_ended_the_sitting_before_is_flagged(self):
        """The owner's example has this shape: RideGT `0a050ea3` call 124, 68 minutes after
        call 123, is the first call of the sitting that starts at 13:54."""
        _path, (first, second) = self.cut(two_sittings())
        a = sessions.session_calls_of(first)
        b = sessions.session_calls_of(second)
        self.assertEqual((a["rewrites"], a["rewrite_calls"]), ([], 0))
        self.assertEqual(b["lifetime_seconds"], 3600)
        [back] = b["rewrites"]
        # Call 1 of the second sitting; the call before it is the first sitting's last read,
        # AWAY seconds back, which no window of the second sitting contains.
        self.assertEqual((back["call"], back["away_seconds"]), (1, AWAY))
        self.assertEqual(back["written"], 40_000 + 7 * 900 - 20_000 + 900)

    def test_the_hash_moves_with_the_block(self):
        _path, cut = self.cut(two_sittings())
        s = cut[1]
        p = sessions.build_payload(s, dt.UTC, "1" * 64, "test")
        without = {k: v for k, v in p.items() if k != "call_tokens"}
        self.assertNotEqual(sessions.content_hash(without), p["content_hash"])


class Refusals(_Cut):
    def test_no_counts_is_a_refusal_with_every_number_null(self):
        b = two_sittings()
        for r in b.records:
            if r["type"] == "assistant":
                r["message"]["usage"] = {}
        _path, cut = self.cut(b)
        w = sessions.session_calls_of(cut[0])
        self.assertEqual((w["reason"], w["calls"], w["points"], w["usd_output"]), ("no_token_counts", None, None, None))
        self.assertEqual(self.walk(w), [])

    def test_a_short_sitting_says_how_many_calls_it_had(self):
        b = tr.Builder().prompt(0, "zqx sentinel prompt")
        for i in range(3):
            b.read(10 + 20 * i, f"{CWD}/src/x{i}.py")
        _path, [s] = self.cut(b)
        w = sessions.session_calls_of(s)
        self.assertEqual((w["reason"], w["calls"], w["calls_needed"]), ("too_few_calls", 3, calls.MIN_CALLS))


class Shape(_Cut):
    def test_the_block_is_the_contracts_shape_and_carries_no_word(self):
        path, cut = self.cut(two_sittings())
        for s in cut:
            w = sessions.session_calls_of(s)
            self.assertEqual(self.walk(w), [])
            blob = json.dumps(w)
            for local in ("zqx", "sentinel", "auth", "login", "/nonexistent", "src/", "Read", "Edit", "opus", "claude"):
                self.assertNotIn(local, blob)

    def test_the_generated_door_accepts_the_payload(self):
        door = spec_walk.pydantic_door("contract")
        if door is None:
            self.skipTest("pydantic is not installed here; the walk covers the shape")
        _path, cut = self.cut(two_sittings())
        for s in cut:
            p = sessions.build_payload(s, dt.UTC, "1" * 64, "test")
            got = door.SessionUpload(**p).call_tokens.model_dump(mode="json")
            self.assertEqual(got, p["call_tokens"])


if __name__ == "__main__":
    unittest.main()
