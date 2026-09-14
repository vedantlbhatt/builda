"""Tokens, call by call (`analysis/calls.py`): the series the session page draws.

Every case is one a person could recompute by hand from the records in it. The ones that
matter most protect against a plausible wrong number:

* a message's usage repeated on every content block is ONE call (1.878x if it is not), and
  the points sum to exactly the tokens burn counts for the same window;
* a call is flagged as writing an expired cache again only after a gap in ITS OWN
  transcript, measured across the sitting's start, never on the sitting's clock (on this
  machine no sitting holds a gap of an hour between two of its own calls, so a rule that
  looked inside the window flagged nothing anywhere);
* a harness that writes no counts is refused with every number null, never a chart of
  zeros, and a model the price table does not know refuses the dollars, never $0.
"""

from __future__ import annotations

import datetime as dt
import json
import pathlib
import tempfile
import unittest

from analysis import burn, calls, pricing

#: 2026-09-01 09:00:00 UTC. Every offset below is seconds from it.
T0 = dt.datetime(2026, 9, 1, 9, 0, tzinfo=dt.UTC).timestamp()
REPO = pathlib.Path(__file__).resolve().parents[2]
CONTRACT = json.loads((REPO / "privacy" / "upload-contract.json").read_text())
_TMP = tempfile.TemporaryDirectory(prefix="test_calls_")
_N = iter(range(1_000_000))


def tearDownModule():
    _TMP.cleanup()


def iso(offset: float) -> str:
    return dt.datetime.fromtimestamp(T0 + offset, dt.UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def call(
    at: float,
    mid: str,
    *,
    read: int = 0,
    write: int = 0,
    fresh: int = 0,
    out: int = 0,
    w1h: int | None = None,
    model: str = "claude-opus-5",
    blocks: int = 1,
) -> list[dict]:
    """One assistant message as Claude Code writes it: one record per content block, every
    one carrying the same usage. `w1h` adds the `cache_creation` breakdown, that much of the
    write at the one hour TTL and the rest at five minutes."""
    usage = {
        "input_tokens": fresh,
        "output_tokens": out,
        "cache_creation_input_tokens": write,
        "cache_read_input_tokens": read,
    }
    if w1h is not None:
        usage["cache_creation"] = {"ephemeral_5m_input_tokens": write - w1h, "ephemeral_1h_input_tokens": w1h}
    return [
        {
            "type": "assistant",
            "timestamp": iso(at),
            "message": {
                "id": mid,
                "role": "assistant",
                "model": model,
                "usage": dict(usage),
                "content": [{"type": "text", "text": f"zqx sentinel reply {b}"}],
            },
        }
        for b in range(blocks)
    ]


def prompt(at: float) -> dict:
    return {
        "type": "user",
        "timestamp": iso(at),
        "promptSource": "typed",
        "message": {"role": "user", "content": [{"type": "text", "text": "zqx sentinel prompt"}]},
    }


def write(records: list[dict], sid: str | None = None) -> pathlib.Path:
    """`records` as a root transcript, `<project>/<uuid>.jsonl`."""
    sid = sid or f"00000000-0000-4000-8000-{next(_N):012d}"
    d = pathlib.Path(_TMP.name) / "-nonexistent-repo"
    d.mkdir(parents=True, exist_ok=True)
    path = d / f"{sid}.jsonl"
    path.write_text("".join(json.dumps({"sessionId": sid, **r}) + "\n" for r in records))
    return path


def growing(n: int, *, start: float = 0, step: float = 30, prefix: str = "m", w1h: bool = True) -> list[dict]:
    """`n` calls a conversation makes: the first writes 50,000 tokens, each after it re-reads
    everything so far and writes 1,000 more, and writes back 200."""
    out: list[dict] = []
    for i in range(n):
        write_n = 50_000 if i == 0 else 1_000
        read_n = 0 if i == 0 else 50_000 + 1_000 * (i - 1)
        out += call(start + i * step, f"{prefix}{i}", read=read_n, write=write_n, fresh=3, out=200, w1h=write_n if w1h else None)
    return out


def block(paths, start: float = 0, end: float = 1e9) -> dict:
    return calls.session_calls([pathlib.Path(p) for p in paths], T0 + start, T0 + end)


class OneReader(unittest.TestCase):
    def test_a_message_repeated_on_every_content_block_is_one_call(self):
        """Claude Code writes one record per content block and repeats the identical usage
        on each; summing records inflates by 1.878x on the real corpus."""
        recs = growing(6)
        recs += call(400, "m-repeated", read=60_000, write=500, fresh=2, out=900, w1h=500, blocks=4)
        w = block([write(recs)])
        self.assertEqual(w["calls"], 7)
        last = w["points"][-1]
        self.assertEqual((last["cache_read"], last["cache_write"], last["input"], last["output"]), (60_000, 500, 2, 900))

    def test_the_points_sum_to_the_tokens_burn_counts_for_the_window(self):
        path = write([prompt(0), *growing(9), *call(900, "late", read=5, write=5)])
        w = block([path], 0, 600)
        turns = burn.turns_for_window([path], T0, T0 + 600)
        drawn = sum(p["cache_read"] + p["cache_write"] + p["input"] + p["output"] for p in w["points"])
        self.assertEqual(drawn, sum(t.total for t in turns))
        self.assertEqual(w["calls"], 9)  # the call after the window is not this sitting's

    def test_a_resumed_copy_is_one_set_of_calls(self):
        """A resumed transcript begins with a COPY of the old one's messages; the sitting
        pools both files and each message is still one call."""
        old = growing(6)
        a = write(old)
        b = write([*old, *call(400, "new", read=56_000, write=700, out=10, w1h=700)])
        for order in ([a, b], [b, a]):
            w = block(order)
            self.assertEqual(w["calls"], 7)
            self.assertEqual(sum(p["cache_read"] for p in w["points"]), 50_000 + 51_000 + 52_000 + 53_000 + 54_000 + 56_000)

    def test_a_synthetic_placeholder_is_not_a_call(self):
        """`<synthetic>`: an interrupt or an API error Claude Code writes itself, no usage."""
        recs = growing(5) + call(300, "fake", model="<synthetic>")
        self.assertEqual(block([write(recs)])["calls"], 5)

    def test_the_one_hour_part_of_a_write_is_read_off_the_usage(self):
        path = write(call(0, "m", write=900, w1h=600) + call(5, "n", write=40))
        got = {t.msg_id: (t.cache_create, t.cache_create_1h) for t in burn.load_turns(path)}
        self.assertEqual(got, {"m": (900, 600), "n": (40, 0)})


class Points(unittest.TestCase):
    def test_one_bar_per_call_up_to_the_cap(self):
        w = block([write(growing(calls.MAX_POINTS, step=2))])
        self.assertEqual((w["calls"], w["per_point"], len(w["points"])), (240, 1, 240))
        self.assertEqual([p["at"] for p in w["points"][:3]], [0, 2, 4])

    def test_past_the_cap_consecutive_calls_are_summed_evenly(self):
        """500 calls: 3 to a point (ceil(500 / 240)), 167 points, the last holding 2."""
        recs = growing(500, step=2)
        w = block([write(recs)])
        self.assertEqual((w["calls"], w["per_point"], len(w["points"])), (500, 3, 167))
        turns = sorted(burn.load_turns(write(recs)), key=lambda t: t.ts)
        self.assertEqual(w["points"][1]["cache_read"], sum(t.cache_read for t in turns[3:6]))
        self.assertEqual(w["points"][1]["at"], 6)
        self.assertEqual(w["points"][-1]["output"], 2 * 200)
        self.assertEqual(sum(p["cache_write"] for p in w["points"]), sum(t.cache_create for t in turns))
        self.assertLessEqual(len(w["points"]), calls.MAX_POINTS)

    def test_one_call_past_the_cap_halves_the_points(self):
        w = block([write(growing(241, step=2))])
        self.assertEqual((w["per_point"], len(w["points"])), (2, 121))

    def test_seconds_are_from_the_sitting_start(self):
        w = calls.session_calls([write(growing(5, start=100))], T0 + 40, T0 + 1_000)
        self.assertEqual([p["at"] for p in w["points"]], [60, 90, 120, 150, 180])


class Refusals(unittest.TestCase):
    def test_no_counts_is_a_refusal_and_every_number_is_null(self):
        recs = growing(8)
        for r in recs:
            r["message"]["usage"] = {}
        w = block([write(recs)])
        self.assertEqual(w["reason"], "no_token_counts")
        for k in ("calls", "per_point", "points", "lifetime_seconds", "rewrites", "rewrite_calls", "usd_cache_read", "usd_output", "price_reason"):
            self.assertIsNone(w[k], k)
        self.assertEqual(w["calls_needed"], calls.MIN_CALLS)

    def test_a_harness_burn_does_not_read_is_no_counts_not_zero(self):
        """Cursor writes {0, 0} on every row; Cline, opencode and Aider are outside
        `burn.USAGE_READERS`. Nothing is read, so nothing is drawn, and nothing is 0."""
        w = calls.wire([], started_at=T0)
        self.assertEqual((w["reason"], w["calls"], w["points"]), ("no_token_counts", None, None))

    def test_under_the_floor_says_how_many_and_draws_nothing(self):
        w = block([write(growing(calls.MIN_CALLS - 1))])
        self.assertEqual((w["reason"], w["calls"], w["points"], w["calls_needed"]), ("too_few_calls", 4, None, 5))
        self.assertIsNone(w["usd_cache_read"])
        w = block([write(growing(calls.MIN_CALLS))])
        self.assertIsNone(w["reason"])
        self.assertEqual(len(w["points"]), 5)


class Rewrites(unittest.TestCase):
    def test_a_call_back_after_an_hour_that_writes_most_of_it_again_is_flagged(self):
        """The owner's example, RideGT `0a050ea3` call 124: 68 minutes after call 123, 26,448
        tokens re-read (the prefix other sessions keep warm) and 140,553 written again."""
        recs = growing(6) + call(150 + 4_095, "back", read=26_448, write=140_553, fresh=2, out=398, w1h=140_553)
        w = block([write(recs)])
        self.assertEqual(w["lifetime_seconds"], 3600)
        self.assertEqual(w["rewrites"], [{"call": 7, "away_seconds": 4_095, "written": 140_553}])
        self.assertEqual(w["rewrite_calls"], 1)

    def test_the_gap_is_measured_to_the_previous_call_in_its_transcript_across_the_sitting_start(self):
        """The sitting starts at the return: its first call has no call before it on the
        sitting's clock, and the one before it in the transcript is 68 minutes back."""
        recs = growing(6) + call(150 + 4_095, "back", read=26_448, write=140_553, w1h=140_553)
        recs += call(150 + 4_110, "next", read=167_001, write=918, w1h=918)
        recs += call(150 + 4_120, "n2", read=167_919, write=766, w1h=766)
        recs += call(150 + 4_130, "n3", read=168_685, write=455, w1h=455)
        recs += call(150 + 4_140, "n4", read=169_140, write=440, w1h=440)
        w = block([write(recs)], 150 + 4_000)
        self.assertEqual(w["calls"], 5)
        self.assertEqual(w["rewrites"], [{"call": 1, "away_seconds": 4_095, "written": 140_553}])
        # Without the files, the same window flags nothing: absent, never a wrong call.
        turns = burn.turns_for_window([write(recs)], T0 + 4_150, T0 + 1e9)
        self.assertEqual(calls.wire(turns, started_at=T0 + 4_150)["rewrites"], [])

    def test_a_conversations_first_call_is_a_first_write_not_a_rewrite(self):
        w = block([write(growing(6))])
        self.assertEqual((w["rewrites"], w["rewrite_calls"]), ([], 0))

    def test_neither_half_alone_is_a_rewrite(self):
        """Back after an hour and re-reading the cache (it outlived its hour: 5 such calls on
        this machine), and a big write with no gap before it (a model switch, a compaction)."""
        recs = growing(6)
        recs += call(150 + 3_700, "reread", read=55_000, write=400, w1h=400)
        recs += call(150 + 3_710, "bigwrite", read=1_000, write=90_000, w1h=90_000)
        self.assertEqual(block([write(recs)])["rewrites"], [])

    def test_an_hour_on_the_nose_is_not_past_the_lifetime(self):
        recs = growing(6) + call(150 + 3_600, "edge", read=1_000, write=90_000, w1h=90_000)
        self.assertEqual(block([write(recs)])["rewrites"], [])

    def test_one_conversation_away_while_another_works_is_flagged_in_its_own_time(self):
        """A sitting pools every conversation in one directory: B's calls fill A's hour on
        the sitting's clock (`fafec44e` call 211 on this machine, 81 minutes away)."""
        a = write(growing(5, prefix="a") + call(120 + 4_000, "a-back", read=20_000, write=70_000, w1h=70_000))
        b = write(growing(150, start=150, step=28, prefix="b"))
        w = block([a, b])
        back = next(r for r in w["rewrites"])
        self.assertEqual((back["away_seconds"], back["written"]), (4_000, 70_000))
        turns = burn.turns_for_window([a, b], T0, T0 + 1e9)
        self.assertEqual(calls.calls_of(turns)[back["call"] - 1].msg_id, "a-back")
        # On the sitting's clock the call before it was seconds earlier.
        order = calls.calls_of(turns)
        self.assertLess(order[back["call"] - 1].ts - order[back["call"] - 2].ts, 60)

    def test_a_sitting_that_wrote_at_five_minutes_is_held_to_five_minutes(self):
        recs = growing(6, w1h=False) + call(150 + 600, "back", read=2_000, write=60_000)
        w = block([write(recs)])
        self.assertEqual(w["lifetime_seconds"], 300)
        self.assertEqual([r["away_seconds"] for r in w["rewrites"]], [600])

    def test_nothing_written_to_a_cache_flags_nothing(self):
        recs = []
        for i in range(6):
            recs += call(i * 5_000, f"g{i}", fresh=40_000, out=100)
        w = block([write(recs)])
        self.assertEqual((w["lifetime_seconds"], w["rewrites"], w["rewrite_calls"]), (None, [], 0))

    def test_the_list_keeps_the_calls_that_wrote_the_most_and_counts_them_all(self):
        recs = growing(5)
        at = 200.0
        for i in range(calls.MAX_REWRITES + 2):
            at += 3_700
            recs += call(at, f"r{i}", read=100, write=10_000 + i, w1h=10_000 + i)
        w = block([write(recs)])
        self.assertEqual(w["rewrite_calls"], 14)
        self.assertEqual(len(w["rewrites"]), calls.MAX_REWRITES)
        self.assertEqual([r["written"] for r in w["rewrites"]], [10_000 + i for i in range(2, 14)])
        self.assertEqual([r["call"] for r in w["rewrites"]], sorted(r["call"] for r in w["rewrites"]))


class Prices(unittest.TestCase):
    def test_each_call_is_priced_on_its_own_model_and_its_own_ttl(self):
        recs = growing(4)
        recs += call(200, "fable", read=1_000_000, write=100_000, fresh=10, out=2_000, w1h=40_000, model="claude-fable-5-1")
        w = block([write(recs)])
        opus, fable = pricing.PRICES["claude-opus-5"], pricing.PRICES["claude-fable-5-1"]
        reads = (50_000 + 51_000 + 52_000) * opus.cache_read + 1_000_000 * fable.cache_read
        self.assertAlmostEqual(w["usd_cache_read"], reads / 1e6, places=9)
        writes = (50_000 + 3 * 1_000) * opus.cache_write_1h + 40_000 * fable.cache_write_1h + 60_000 * fable.cache_write_5m
        self.assertAlmostEqual(w["usd_cache_write"], writes / 1e6, places=9)
        self.assertAlmostEqual(w["usd_output"], (4 * 200 * opus.output + 2_000 * fable.output) / 1e6, places=9)
        self.assertAlmostEqual(w["usd_input"], (4 * 3 * opus.input + 10 * fable.input) / 1e6, places=9)
        self.assertIsNone(w["price_reason"])

    def test_a_model_the_table_does_not_know_refuses_the_dollars_not_the_chart(self):
        recs = growing(5) + call(300, "x", read=10, out=10, model="gpt-5-codex")
        w = block([write(recs)])
        self.assertEqual(w["price_reason"], pricing.BASIS_UNKNOWN_MODEL)
        for k in ("usd_cache_read", "usd_cache_write", "usd_input", "usd_output"):
            self.assertIsNone(w[k])
        self.assertEqual(len(w["points"]), 6)

    def test_a_call_with_no_tokens_prices_nothing_and_refuses_nothing(self):
        recs = growing(5) + call(300, "empty", model="some-unknown-model")
        self.assertIsNone(block([write(recs)])["price_reason"])


class TheWire(unittest.TestCase):
    def test_every_key_is_the_contracts_and_none_carries_a_word(self):
        declared = {f["name"] for f in CONTRACT["objects"]["SessionCallTokens"]}
        point = {f["name"] for f in CONTRACT["objects"]["SessionCallPoint"]}
        rewrite = {f["name"] for f in CONTRACT["objects"]["SessionCallRewrite"]}
        recs = growing(6) + call(150 + 4_095, "back", read=26_448, write=140_553, w1h=140_553)
        for w in (block([write(recs)]), calls.wire([], started_at=T0), block([write(growing(2))])):
            self.assertEqual(set(w), declared)
            for p in w["points"] or []:
                self.assertEqual(set(p), point)
                self.assertTrue(all(isinstance(v, int) and not isinstance(v, bool) for v in p.values()), p)
            for r in w["rewrites"] or []:
                self.assertEqual(set(r), rewrite)
            blob = json.dumps(w)
            for local in ("zqx", "sentinel", "opus", "claude", "/", "nonexistent"):
                self.assertNotIn(local, blob)

    def test_the_constants_are_the_contracts(self):
        enums = CONTRACT["enums"]
        self.assertEqual(list(calls.REFUSALS), enums["call_tokens_refusal"])
        self.assertEqual(list(calls.PRICE_REFUSALS), enums["call_price_refusal"])
        caps = {f["name"]: f.get("max_items") for f in CONTRACT["objects"]["SessionCallTokens"]}
        self.assertEqual((caps["points"], caps["rewrites"]), (calls.MAX_POINTS, calls.MAX_REWRITES))


if __name__ == "__main__":
    unittest.main()
