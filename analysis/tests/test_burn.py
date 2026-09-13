"""Burn forensics: the dedup rule, the refusals, the attribution of a spike, and the
sentence that names it.

Every case is one a person could recompute by hand from the records in the test. The ones
that matter most protect against a plausible wrong number:

* usage repeated across a message's content blocks must be counted ONCE (1.878x is the
  measured inflation if it is not),
* a harness that writes no token counts must be refused, never reported as zero, and a
  harness this module does not read yet must be refused for THAT reason,
* a session with too few segments must refuse to name a spike rather than let the median
  be one of the three segments it is comparing against,
* a cause is blamed only for the tokens it can claim. MEASURED on the live transcript: a
  9.1M token spike was blamed on "4 helper agents" when 93% of it was re-reading the
  conversation, and the helpers' own tokens are in no burn number at all.
"""

from __future__ import annotations

import collections
import datetime as dt
import json
import pathlib
import tempfile
import unittest

from analysis import burn, digest, gemini, live
from analysis.tests import burn_fixture
from analysis.digest import Ev

#: 2026-09-01 09:00:00 UTC. Every timestamp below is an offset from it.
T0 = dt.datetime(2026, 9, 1, 9, 0, tzinfo=dt.UTC)

#: Every transcript a test writes lands here, and the directory goes when the module ends.
_TMP = tempfile.TemporaryDirectory(prefix="test_burn_")
_COUNTER = iter(range(1_000_000))


def tearDownModule():
    _TMP.cleanup()


REPO = pathlib.Path(__file__).resolve().parents[2]
CODEX_FIXTURE = REPO / "spec" / "fixtures" / "codex" / "real_tools_mock_model.jsonl"
GEMINI_FIXTURE = REPO / "spec" / "fixtures" / "gemini" / "synthetic_session.jsonl"


def has_dash(text: str) -> bool:
    """`plain.has_dash`, the one definition of a dash (docs/overnight-engine.md 1.1): an em
    dash, an en dash, or a hyphen with space on both sides."""
    from analysis import plain

    return plain.has_dash(text)


def iso(offset_s: float) -> str:
    return (T0 + dt.timedelta(seconds=offset_s)).isoformat().replace("+00:00", "Z")


def ts(offset_s: float) -> float:
    return (T0 + dt.timedelta(seconds=offset_s)).timestamp()


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


def tool_result(
    offset_s: float, tid: str, content: str, is_error: bool = False, tur: dict | None = None
) -> dict:
    rec = {
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
    if tur is not None:
        rec["toolUseResult"] = tur
    return rec


def write_transcript(records: list[dict], suffix: str = ".jsonl") -> pathlib.Path:
    path = pathlib.Path(_TMP.name) / f"t{next(_COUNTER)}{suffix}"
    with path.open("w") as fd:
        for r in records:
            fd.write(json.dumps(r) + "\n")
    return path


USAGE = {
    "input_tokens": 1000,
    "output_tokens": 200,
    "cache_creation_input_tokens": 50,
    "cache_read_input_tokens": 8000,
}
USAGE_TOTAL = 1000 + 200 + 50 + 8000

# ---- segments built by hand, for the attribution rule itself -----------------------


def turn(at: float, fresh: int = 0, *, cache: int = 0, ids=(), mid: str | None = None) -> burn.Turn:
    return burn.Turn(
        ts=at,
        msg_id=mid or f"m{at}",
        model="claude-opus-5",
        input_tokens=fresh,
        output_tokens=0,
        cache_create=0,
        cache_read=cache,
        tools=[],
        tool_ids=list(ids),
    )


def call(at: float, name: str, tid: str | None, text: str = "", path=None, added=None) -> Ev:
    return Ev(0, at, "tool", text, tool=name, path=path, added=added, tool_id=tid)


def failed(at: float, tid: str) -> Ev:
    return Ev(0, at, "result_error", "Error: boom", tool="Bash", ok=False, tool_id=tid)


def seg(turns, events) -> burn.Segment:
    return burn.Segment(
        index=0, start_ts=0.0, end_ts=100.0, prompt="go", turns=list(turns), events=list(events)
    )


# ---- Codex and Gemini writers, the shapes their loaders verify ----------------------


def codex_rollout(items: list[tuple[float, str, dict]]) -> pathlib.Path:
    """A rollout: `session_meta` first (how `detect_harness` knows it), then `items` as
    `(offset, type, payload)`."""
    recs = [
        {
            "timestamp": iso(0),
            "type": "session_meta",
            "payload": {"id": "s", "timestamp": iso(0), "cwd": "/repo"},
        },
        {"timestamp": iso(0.5), "type": "turn_context", "payload": {"model": "gpt-5"}},
    ]
    recs += [{"timestamp": iso(o), "type": t, "payload": p} for o, t, p in items]
    return write_transcript(recs)


def codex_usage(inp: int, cached: int, out: int, total: int | None = None, write: int = 0) -> dict:
    return {
        "input_tokens": inp,
        "cached_input_tokens": cached,
        "cache_write_input_tokens": write,
        "output_tokens": out,
        "reasoning_output_tokens": 0,
        "total_tokens": inp + out if total is None else total,
    }


def codex_call(cid: str, cmd: str = "ls") -> dict:
    return {
        "type": "function_call",
        "name": "exec_command",
        "arguments": json.dumps({"cmd": cmd}),
        "call_id": cid,
    }


def gemini_recording(messages: list[dict]) -> pathlib.Path:
    meta = {
        "sessionId": "5d2c1a0e-0000-4c2d-9e8f-7a6b5c4d3e2f",
        "projectHash": "ab" * 32,
        "startTime": iso(0),
        "lastUpdated": iso(0),
        "kind": "main",
    }
    return write_transcript([meta, *messages])


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
        self.assertEqual(turns[0].total, USAGE_TOTAL)

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
        self.assertEqual(sum(t.total for t in turns), 2 * USAGE_TOTAL)


class TurnToolIds(unittest.TestCase):
    """`Turn.tool_ids` is what lets a cause claim the turns that issued its calls. They are
    the ids the digest stamps on `Ev.tool_id`, so the two sides meet."""

    def test_the_ids_of_every_record_of_a_message_are_kept_in_order(self):
        path = write_transcript(
            [
                user_prompt(0, "go"),
                assistant(1, "msg_a", usage=USAGE, blocks=[tool_use("t1", "Read", {})]),
                assistant(1, "msg_a", usage=USAGE, blocks=[tool_use("t2", "Task", {})]),
            ]
        )
        self.assertEqual(burn.load_turns(path)[0].tool_ids, ["t1", "t2"])

    def test_a_block_written_twice_is_one_call(self):
        block = tool_use("t1", "Bash", {"command": "ls"})
        path = write_transcript(
            [
                user_prompt(0, "go"),
                assistant(1, "msg_a", usage=USAGE, blocks=[block]),
                assistant(1, "msg_a", usage=USAGE, blocks=[block]),
            ]
        )
        t = burn.load_turns(path)[0]
        self.assertEqual((t.tools, t.tool_ids), (["Bash"], ["t1"]))

    def test_content_that_is_a_plain_string_carries_no_calls(self):
        """CLAUDE.md: `.message.content` is a plain String on 3,299 records."""
        rec = assistant(1, "msg_a", usage=USAGE)
        rec["message"]["content"] = "just text"
        t = burn.load_turns(write_transcript([user_prompt(0, "go"), rec]))[0]
        self.assertEqual((t.tools, t.tool_ids, t.total), ([], [], USAGE_TOTAL))


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

    def test_a_harness_this_module_does_not_read_is_refused_for_that_reason(self):
        """Cline and opencode DO write token counts. Telling their users "this harness
        does not write token counts to disk" was false; the gap is in this module."""
        task = pathlib.Path(_TMP.name) / f"cline_task_{next(_COUNTER)}"
        task.mkdir()
        (task / "ui_messages.json").write_text(
            json.dumps(
                [
                    {"ts": int(ts(0) * 1000), "type": "say", "say": "task", "text": "fix it"},
                    {"ts": int(ts(1) * 1000), "type": "say", "say": "text", "text": "on it"},
                ]
            )
        )
        self.assertEqual(burn.load_turns(task), [])
        rep = burn.burn_report(task)
        self.assertEqual(rep["harness"], "cline")
        self.assertFalse(rep["harness_records_usage"])
        self.assertEqual(
            rep["sample"]["missing"], ["burn forensics does not read cline token counts yet"]
        )
        self.assertEqual(
            rep["totals"]["tokens"]["reason"], "burn forensics does not read cline token counts yet"
        )
        self.assertEqual(burn.explain(rep), ["Cost is not shown for this tool yet."])

    def test_a_reader_harness_with_no_counts_yet_blames_the_transcript_not_the_tool(self):
        """A Codex rollout killed before its first response (the real writer's first
        records) has no usage. Codex writes counts; this file just has none."""
        path = codex_rollout([(1, "event_msg", {"type": "user_message", "message": "say hi"})])
        rep = burn.burn_report(path)
        self.assertEqual(rep["harness"], "codex")
        self.assertFalse(rep["harness_records_usage"])
        self.assertEqual(
            rep["sample"]["missing"],
            ["this transcript does not record token counts, so cost cannot be attributed"],
        )
        self.assertEqual(
            burn.explain(rep),
            ["This transcript does not record token counts, so cost cannot be shown."],
        )

    def test_without_counts_a_cause_is_still_named_but_claims_nothing(self):
        """Three failing calls on a transcript with no counts: the error loop is real and is
        listed, but what it cost is absent, never 0."""
        path = write_transcript(
            [
                user_prompt(0, "go"),
                assistant(
                    1,
                    "m",
                    usage={"input_tokens": 0},
                    blocks=[tool_use(f"e{i}", "Bash", {"command": f"cmd {i}"}) for i in range(3)],
                ),
                *[tool_result(2 + i, f"e{i}", "Error: no", True) for i in range(3)],
            ]
        )
        rep = burn.burn_report(path)
        row = rep["causes"][0]
        self.assertEqual((row["cause"], row["segments"]), ("error_loop", 1))
        self.assertIsNone(row["attributed_tokens"])
        self.assertIsNone(row["attributed_share"])
        self.assertIsNone(row["share_of_session"])
        seg_cause = rep["segments"][0]["causes"][0]
        self.assertEqual((seg_cause["tokens"], seg_cause["share"]), (None, None))

    def test_the_usage_readers_are_the_three_adapters(self):
        self.assertEqual(burn.USAGE_READERS, frozenset({"claude_code", "codex", "gemini"}))


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
        self.assertEqual(rep["totals"]["tokens"]["value"], 2 * USAGE_TOTAL)

    def test_each_prompt_opens_a_segment(self):
        recs = []
        for i in range(4):
            recs.append(user_prompt(i * 100, f"task {i}"))
            recs.append(assistant(i * 100 + 1, f"m{i}", usage=USAGE))
        path = write_transcript(recs)
        rep = burn.burn_report(path)
        self.assertEqual(rep["sample"]["segments"], 4)
        self.assertEqual(rep["segments"][2]["prompt"], "task 2")

    def test_the_window_applies_to_turns_as_well_as_events(self):
        """Only events were windowed, so every turn after `end` was filed into the last
        segment and reported as its cost."""
        path = write_transcript(
            [
                user_prompt(0, "go"),
                assistant(1, "m0", usage=USAGE),
                assistant(100, "m1", usage=USAGE),
            ]
        )
        rep = burn.burn_report(path, end=ts(50))
        self.assertEqual(rep["totals"]["tokens"]["value"], USAGE_TOTAL)
        self.assertEqual(rep["sample"]["turns"], 1)

    def test_a_turn_older_than_every_event_is_still_counted(self):
        """A turn's time is its message's FIRST record, often a thinking block written
        seconds before the tool call the digest turns into an event. Segment 0 opened at
        the first EVENT, so a window that starts mid conversation dropped that turn from
        every segment and every total. MEASURED on the real corpus (2026-09-13, 156
        counted sessions): 20 turns, 8,902,171 tokens, fell into no segment; one session
        lost 762,339 of its 3,052,559 (25%). After the fix the module's segment tokens
        equal the in window usage read by hand from the raw JSONL, 4,168,469,723."""
        path = write_transcript(
            [
                assistant(0, "m0", usage=USAGE, blocks=[{"type": "thinking", "thinking": "hm"}]),
                assistant(2, "m0", usage=USAGE, blocks=[tool_use("r", "Read", {"file_path": "/a.py"})]),
                assistant(10, "m1", usage=USAGE),
            ]
        )
        events = digest.load_events(path)
        turns = burn.load_turns(path)
        self.assertLess(turns[0].ts, events[0].ts, "the shape this test is about")
        self.assertEqual(sum(s.tokens for s in burn.segments(events, turns)), 2 * USAGE_TOTAL)
        self.assertEqual(burn.session_burn_detail(events, turns)["tokens"], 2 * USAGE_TOTAL)
        self.assertEqual(burn.burn_report(path)["totals"]["tokens"]["value"], 2 * USAGE_TOTAL)

    def test_a_turn_before_the_first_prompt_opens_its_own_segment(self):
        events = [Ev(0, 10.0, "prompt", "go"), Ev(1, 11.0, "assistant", "ok")]
        segs = burn.segments(events, [turn(5.0, 100), turn(11.0, 50)])
        self.assertEqual([(s.prompt, s.tokens) for s in segs], [("", 100), ("go", 50)])

    def test_a_first_prompt_older_than_every_turn_needs_no_empty_segment(self):
        events = [Ev(0, 10.0, "prompt", "go"), Ev(1, 11.0, "assistant", "ok")]
        segs = burn.segments(events, [turn(11.0, 50)])
        self.assertEqual([(s.index, s.prompt, s.tokens) for s in segs], [(0, "go", 50)])


class Attribution(unittest.TestCase):
    """`Segment.attribution`: what each present cause can claim, recomputable by hand.
    Fresh tokens are `input + output + cache_create`; `turn(at, fresh)` puts all of them in
    input, so a turn's fresh tokens are the number written beside it."""

    def test_context_replay_claims_every_cache_read(self):
        s = seg([turn(1, 50, cache=450), turn(2, 50, cache=450)], [])
        self.assertEqual(s.attribution(), {"context_replay": 900})
        self.assertEqual(s.causes()[0]["share"], 0.9)

    def test_a_fanout_claims_only_the_turns_that_dispatched_helpers(self):
        s = seg(
            [turn(1, 1000, ids=["a1", "a2"]), turn(2, 300, ids=["r1"])],
            [
                call(1, "Task", "a1"),
                call(1, "Task", "a2"),
                call(2, "Read", "r1", "/x.py", path="/x.py"),
            ],
        )
        self.assertEqual(s.attribution(), {"subagent_fanout": 1000})
        c = s.causes()[0]
        self.assertEqual((c["cause"], c["n"], c["tokens"], c["share"]), ("subagent_fanout", 2, 1000, 0.769))

    def test_an_error_loop_claims_the_turns_whose_calls_failed(self):
        s = seg(
            [
                turn(1, 100, ids=["b1"]),
                turn(2, 200, ids=["b2"]),
                turn(3, 400, ids=["b3"]),
                turn(4, 800, ids=["b4"]),
            ],
            [
                call(1, "Bash", "b1", "cmd one"),
                failed(1.5, "b1"),
                call(2, "Bash", "b2", "cmd two"),
                failed(2.5, "b2"),
                call(3, "Bash", "b3", "cmd three"),
                call(4, "Bash", "b4", "cmd four"),
                failed(4.5, "b4"),
            ],
        )
        self.assertEqual(s.attribution(), {"error_loop": 100 + 200 + 800})
        self.assertEqual(s.causes()[0]["share"], round(1100 / 1500, 3))

    def test_a_turn_with_several_failing_calls_is_claimed_once(self):
        s = seg(
            [turn(1, 100, ids=["b1", "b2", "b3"])],
            [
                call(1, "Bash", "b1", "one"),
                call(1, "Bash", "b2", "two"),
                call(1, "Bash", "b3", "three"),
                failed(2, "b1"),
                failed(2, "b2"),
                failed(2, "b3"),
            ],
        )
        self.assertEqual(s.attribution()["error_loop"], 100)

    def test_a_repeat_claims_the_second_and_later_copies_only(self):
        fresh = {1: 10, 2: 20, 3: 40, 4: 80}
        s = seg(
            [turn(i, f, ids=[f"c{i}"]) for i, f in fresh.items()],
            [call(i, "Bash", f"c{i}", "npm  test") for i in fresh],
        )
        self.assertEqual(s.attribution(), {"repeated_call": 20 + 40 + 80})
        c = s.causes()[0]
        self.assertEqual((c["n"], c["tool"], c["share"]), (4, "Bash", round(140 / 150, 3)))

    def test_churn_claims_the_second_and_later_writes_to_the_churned_file(self):
        """Distinct command texts, so the writes are churn and not also a repeat."""
        s = seg(
            [turn(i, f, ids=[f"w{i}"]) for i, f in ((1, 1), (2, 2), (3, 4), (4, 8), (5, 16))],
            [call(i, "Bash", f"w{i}", f"cat > a.py <<'EOF' v{i}", path="a.py", added=5) for i in (1, 2, 3, 4)]
            + [call(5, "Bash", "w5", "cat > b.py <<'EOF'", path="b.py", added=5)],
        )
        self.assertEqual(s.attribution(), {"file_churn": 2 + 4 + 8})
        self.assertEqual(s.causes()[0]["share"], round(14 / 31, 3))

    def test_compaction_claims_the_first_turn_after_each_compaction_once(self):
        """Compactions at 10 and 11 both land on the turn at 12, which is claimed once; the
        one at 50 lands on the turn at 60; the one at 90 has no turn after it."""
        s = seg(
            [turn(5, 1), turn(12, 10), turn(15, 100), turn(60, 1000)],
            [Ev(0, at, "compaction") for at in (10, 11, 50, 90)],
        )
        self.assertEqual(s.attribution(), {"compaction": 10 + 1000})

    def test_a_turn_at_the_same_instant_as_the_compaction_is_the_one_after_it(self):
        """"At or after": the turn stamped with the compaction's own second rebuilt it."""
        s = seg([turn(12, 10), turn(15, 100)], [Ev(0, 12, "compaction")])
        self.assertEqual(s.attribution(), {"compaction": 10})

    def test_investigation_claims_the_turns_that_read(self):
        """The turn that only ran `ls` is not reading a file and is not claimed."""
        reads = [call(1 if i < 4 else 2, "Read", f"r{i}", f"/f{i}.py", path=f"/f{i}.py") for i in range(8)]
        s = seg(
            [
                turn(1, 100, ids=[f"r{i}" for i in range(4)]),
                turn(2, 200, ids=[f"r{i}" for i in range(4, 8)]),
                turn(3, 400),
                turn(4, 800, ids=["x1"]),
            ],
            reads + [call(4, "Bash", "x1", "ls")],
        )
        self.assertEqual(s.attribution(), {"investigated": 300})
        self.assertEqual(s.causes()[0]["share"], round(300 / 1500, 3))

    def test_claims_overlap_and_none_exceeds_the_segment(self):
        """The helper's own call failed: that turn is claimed by both causes."""
        s = seg(
            [turn(1, 500, ids=["a1"]), turn(2, 100, ids=["b1", "b2"])],
            [
                call(1, "Task", "a1"),
                failed(1.5, "a1"),
                call(2, "Bash", "b1", "one"),
                call(2, "Bash", "b2", "two"),
                failed(2.5, "b1"),
                failed(2.5, "b2"),
            ],
        )
        claims = s.attribution()
        self.assertEqual(claims, {"subagent_fanout": 500, "error_loop": 600})
        for v in claims.values():
            self.assertLessEqual(v, s.tokens)
        self.assertGreater(sum(claims.values()), s.tokens)

    def test_causes_keep_their_order_and_gain_tokens_and_share(self):
        s = seg(
            [turn(1, 100, cache=9000, ids=["a1", "b1", "b2", "b3"])],
            [
                call(1, "Task", "a1"),
                call(1, "Bash", "b1", "x"),
                call(1, "Bash", "b2", "x"),
                call(1, "Bash", "b3", "x"),
                failed(2, "b1"),
                failed(2, "b2"),
                failed(2, "b3"),
                Ev(0, 3, "compaction"),
            ],
        )
        causes = s.causes()
        self.assertEqual(
            [c["cause"] for c in causes],
            ["subagent_fanout", "error_loop", "repeated_call", "context_replay", "compaction"],
        )
        for c in causes:
            self.assertLessEqual({"cause", "detail", "n", "tokens", "share"}, set(c))
            self.assertEqual(c["share"], round(c["tokens"] / s.tokens, 3))

    def test_a_segment_with_no_tokens_claims_none_rather_than_zero(self):
        """No turns at all: a claim of 0 would read as "this cost nothing"."""
        s = seg([], [call(1, "Task", "a1")])
        c = s.causes()[0]
        self.assertEqual(c["cause"], "subagent_fanout")
        self.assertIsNone(c["tokens"])
        self.assertIsNone(c["share"])
        self.assertIsNone(s.dominant_cause())


class Dominance(unittest.TestCase):
    def test_the_cause_that_claims_the_most_is_dominant_not_the_first_listed(self):
        s = seg(
            [turn(1, 500, ids=["a1"]), turn(2, 100, ids=["b1", "b2"])],
            [
                call(1, "Task", "a1"),
                failed(1.5, "a1"),
                call(2, "Bash", "b1", "one"),
                call(2, "Bash", "b2", "two"),
                failed(2.5, "b1"),
                failed(2.5, "b2"),
            ],
        )
        self.assertEqual(s.causes()[0]["cause"], "subagent_fanout")
        self.assertEqual(s.dominant_cause()["cause"], "error_loop")

    def test_ties_go_to_list_order(self):
        s = seg(
            [turn(1, 500, ids=["a1", "b1", "b2", "b3"])],
            [
                call(1, "Task", "a1"),
                call(1, "Bash", "b1", "one"),
                call(1, "Bash", "b2", "two"),
                call(1, "Bash", "b3", "three"),
                failed(2, "b1"),
                failed(2, "b2"),
                failed(2, "b3"),
            ],
        )
        self.assertEqual(s.attribution(), {"subagent_fanout": 500, "error_loop": 500})
        self.assertEqual(s.dominant_cause()["cause"], "subagent_fanout")

    def test_a_cause_that_claims_nothing_is_never_dominant(self):
        """The Task call is in the segment but no turn issued it (a harness without ids):
        naming it would blame a cost on something that is not in the number."""
        s = seg([turn(1, 100)], [call(1, "Task", "a1")])
        self.assertEqual(s.attribution(), {"subagent_fanout": 0})
        self.assertIsNone(s.dominant_cause())

    def test_every_segment_row_carries_its_dominant_cause(self):
        path = write_transcript([user_prompt(0, "go"), assistant(1, "m0", usage=USAGE)])
        row = burn.burn_report(path)["segments"][0]
        self.assertEqual(row["dominant"]["cause"], "context_replay")
        self.assertEqual(row["dominant"]["tokens"], 8000)


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

    @staticmethod
    def _spike_sentence(rep: dict) -> str:
        found = [s for s in burn.explain(rep) if s.startswith("The most expensive stretch")]
        assert len(found) == 1, found
        return found[0]

    FRESH = {
        "input_tokens": 200_000,
        "output_tokens": 5_000,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
    }

    def test_a_subagent_fanout_is_named_as_the_cause(self):
        rep = self._corpus(
            heavy_usage=self.FRESH,
            heavy_blocks=[tool_use(f"t{i}", "Task", {"prompt": "go"}) for i in range(7)],
        )
        self.assertTrue(rep["spikes"], "the expensive segment should be a spike")
        top = rep["spikes"][0]
        self.assertEqual(top["subagents"], 7)
        self.assertEqual(top["causes"][0]["cause"], "subagent_fanout")
        self.assertEqual(top["causes"][0]["n"], 7)
        # The helpers' edits are in their own sidecars, which this module never reads, so
        # the stretch is unreadable and is not told it wrote nothing (`Segment.barren`).
        self.assertEqual(
            self._spike_sentence(rep),
            "The most expensive stretch cost 205k tokens, 100% of it on the turns that handed "
            "work to 7 helper agents, and whether it changed any file cannot be read from "
            "this transcript.",
        )

    def test_seven_task_calls_and_ninety_percent_cache_reads_names_re_reading(self):
        """THE fix (docs/overnight-engine.md 5.1). The helpers' tokens are in no number
        here; the turn that dispatched them claims its 20k fresh tokens, and re-reading
        the conversation claims 180k."""
        rep = self._corpus(
            heavy_usage={
                "input_tokens": 20_000,
                "output_tokens": 0,
                "cache_creation_input_tokens": 0,
                "cache_read_input_tokens": 180_000,
            },
            heavy_blocks=[tool_use(f"t{i}", "Task", {"prompt": f"part {i}"}) for i in range(7)],
        )
        top = rep["spikes"][0]
        self.assertEqual([c["cause"] for c in top["causes"]], ["subagent_fanout", "context_replay"])
        self.assertEqual(top["dominant"]["cause"], "context_replay")
        sentence = self._spike_sentence(rep)
        self.assertEqual(
            sentence,
            "The most expensive stretch cost 200k tokens, 90% of it re-reading the "
            "conversation so far, and whether it changed any file cannot be read from this "
            "transcript.",
        )
        self.assertNotIn("helper", sentence)

    def test_one_helper_reads_as_one(self):
        rep = self._corpus(heavy_usage=self.FRESH, heavy_blocks=[tool_use("t0", "Task", {})])
        self.assertIn(
            "on the turn that handed work to 1 helper agent,", self._spike_sentence(rep)
        )

    def test_a_spike_that_wrote_nothing_is_marked_barren(self):
        rep = self._corpus(
            heavy_usage=self.FRESH,
            heavy_blocks=[{"type": "text", "text": "a long answer and no tool at all"}],
        )
        top = rep["spikes"][0]
        self.assertTrue(top["barren"])
        self.assertFalse(top["unreadable"])
        self.assertFalse(top["produced_work"])
        self.assertGreater(rep["totals"]["barren_token_share"]["value"], 0.5)

    def test_a_spike_that_handed_work_to_a_helper_is_unreadable_not_barren(self):
        """The helper's edits live in its sidecar, which this module never reads (CLAUDE.md,
        "Globbing"), so "nothing was written" would be a claim about the parser. This used
        to be the barren example; the roadmap's own headline sentence ("split the work
        across 9 helper agents ... and nothing was written") is exactly this shape."""
        rep = self._corpus(
            heavy_usage=self.FRESH,
            heavy_blocks=[tool_use("t0", "Task", {"prompt": "go"})],
        )
        top = rep["spikes"][0]
        self.assertFalse(top["barren"])
        self.assertTrue(top["unreadable"])
        self.assertEqual(top["unreadable_calls"], 1)
        # only the six cheap talk only segments (220 tokens each) are barren
        self.assertEqual([r["tokens"] for r in rep["barren"]], [220] * 6)
        self.assertEqual(rep["totals"]["barren_token_share"]["barren_tokens"], 1_320)
        self.assertGreater(rep["totals"]["unreadable_token_share"]["value"], 0.5)
        self.assertEqual(rep["totals"]["unreadable_token_share"]["unreadable_tokens"], 205_000)

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
        """Four identical failing `npm test` calls from one turn: the error loop and the
        repeat claim the same turn, and the tie goes to the one listed first."""
        extra = [tool_result(1002 + i, f"e{i}", "Error: ENOENT no such file", True) for i in range(4)]
        rep = self._corpus(
            heavy_usage=self.FRESH,
            heavy_blocks=[tool_use(f"e{i}", "Bash", {"command": "npm test"}) for i in range(4)],
            heavy_extra=extra,
        )
        top = rep["spikes"][0]
        kinds = [c["cause"] for c in top["causes"]]
        self.assertIn("error_loop", kinds)
        self.assertIn("repeated_call", kinds)
        self.assertEqual(top["dominant"]["cause"], "error_loop")
        # `npm test` can write (snapshots, coverage, caches) and the digest cannot see it.
        self.assertEqual(
            self._spike_sentence(rep),
            "The most expensive stretch cost 205k tokens, 100% of it on 4 failing tool calls "
            "and the retries after them, and whether it changed any file cannot be read from "
            "this transcript.",
        )

    def test_an_error_loop_on_a_command_that_only_reads_wrote_nothing(self):
        extra = [tool_result(1002 + i, f"g{i}", "Exit code 2 grep: a.py: No such file", True) for i in range(3)]
        rep = self._corpus(
            heavy_usage=self.FRESH,
            heavy_blocks=[tool_use(f"g{i}", "Bash", {"command": "grep -n x a.py"}) for i in range(3)],
            heavy_extra=extra,
        )
        self.assertTrue(rep["spikes"][0]["barren"])
        self.assertTrue(self._spike_sentence(rep).endswith(", and nothing was written."))

    def test_a_repeated_shell_command_is_called_a_command(self):
        rep = self._corpus(
            heavy_usage=self.FRESH,
            heavy_blocks=[tool_use(f"l{i}", "Bash", {"command": "ls -la"}) for i in range(3)],
        )
        self.assertEqual(
            self._spike_sentence(rep),
            "The most expensive stretch cost 205k tokens, 100% of it on running the same "
            "command 3 times, and nothing was written.",
        )

    def test_repeated_edits_to_one_file_are_not_called_a_command(self):
        """An Edit's digest text is its path, so three edits to one file share a signature.
        MEASURED on the real corpus: 38 of the 41 repeats were file tools like this."""
        patch = {"structuredPatch": [{"lines": ["+x"]}]}
        rep = self._corpus(
            heavy_usage=self.FRESH,
            heavy_blocks=[
                tool_use(f"d{i}", "Edit", {"file_path": "/repo/a.py", "old_string": f"{i}"})
                for i in range(3)
            ],
            heavy_extra=[tool_result(1002 + i, f"d{i}", "ok", tur=patch) for i in range(3)],
        )
        top = rep["spikes"][0]
        self.assertEqual(top["dominant"]["tool"], "Edit")
        self.assertEqual(
            self._spike_sentence(rep),
            "The most expensive stretch cost 205k tokens, 100% of it on editing the same file "
            "3 times, and it wrote 3 lines.",
        )

    def test_a_cause_less_spike_says_its_cost_and_nothing_it_cannot_back(self):
        rep = self._corpus(
            heavy_usage=self.FRESH, heavy_blocks=[{"type": "text", "text": "a long answer"}]
        )
        self.assertIsNone(rep["spikes"][0]["dominant"])
        self.assertEqual(
            self._spike_sentence(rep),
            "The most expensive stretch cost 205k tokens, and nothing was written.",
        )

    def test_only_the_most_expensive_spike_is_called_the_most_expensive(self):
        """The first version walked down to the first spike with a cause, printing the
        second spike's cost under the first one's name."""
        rep = self._corpus(heavy_usage=self.FRESH, heavy_blocks=[{"type": "text", "text": "long"}])
        first = dict(rep["spikes"][0], tokens=500_000, dominant=None)
        rep = dict(rep, spikes=[first, rep["spikes"][0]])
        self.assertEqual(
            self._spike_sentence(rep),
            "The most expensive stretch cost 500k tokens, and nothing was written.",
        )

    def test_the_rollup_carries_what_each_cause_can_claim(self):
        rep = self._corpus(
            heavy_usage={
                "input_tokens": 20_000,
                "output_tokens": 0,
                "cache_creation_input_tokens": 0,
                "cache_read_input_tokens": 180_000,
            },
            heavy_blocks=[tool_use(f"t{i}", "Task", {}) for i in range(7)],
        )
        rows = {r["cause"]: r for r in rep["causes"]}
        total = rep["totals"]["tokens"]["value"]
        # every cheap segment is 100 of 220 cache reads: 45%, under the 70% bar
        self.assertEqual(rows["subagent_fanout"]["attributed_tokens"], 20_000)
        self.assertEqual(rows["context_replay"]["attributed_tokens"], 180_000)
        self.assertEqual(rows["subagent_fanout"]["tokens"], 200_000)
        self.assertEqual(rows["subagent_fanout"]["attributed_share"], round(20_000 / total, 3))


class Verdicts(unittest.TestCase):
    """What a stretch produced, never a number it does not have."""

    ROW = {"barren": False, "lines_added": 0, "lines_removed": 0, "files_touched": 0, "commits": 0}

    def test_each_kind_of_work_is_said_the_way_it_happened(self):
        cases = [
            ({"barren": True}, "nothing was written"),
            ({"lines_added": 1}, "it wrote 1 line"),
            ({"lines_added": 1726, "lines_removed": 6}, "it wrote 1,726 lines"),
            ({"lines_removed": 3}, "it removed 3 lines"),
            # an edit whose result carried no patch, or a `sed -i`: a file, no count
            # (`patterns._touched`, the one rule `live` reads too).
            ({"files_touched": 1}, "it changed 1 file"),
            ({"commits": 2}, "it made 2 commits"),
            ({"unreadable": True}, burn.UNREADABLE_VERDICT),
        ]
        for patch, want in cases:
            self.assertEqual(burn._verdict({**self.ROW, **patch}), want, patch)

    def test_a_refused_commit_made_no_commit(self):
        """MEASURED on the real corpus (2026-09-13): of 148 visible `git commit` calls, 2
        were answered by an error, and one stretch whose only visible work was one of them
        ("Changes not staged for commit", exit 1) read "it made 1 commit". It ran nine
        other calls the digest cannot see into, so it is unreadable, not productive."""
        commit = _shell('git commit -q -m "$(cat <<\'EOF\' ⏎ Remove PostHog', "c")
        refused = Ev(0, 2.0, "result_error", "Exit code 1 Changes not staged for commit", tool="Bash", ok=False, tool_id="c")
        script = _shell("python3 - <<'PY' ⏎ drop the sdk", "p")
        s = seg([turn(1, 571_645, ids=["c", "p"])], [script, commit, refused])
        self.assertEqual(s.commits, 0)
        self.assertEqual((s.produced_work, s.barren, s.unreadable), (False, False, True))
        landed = seg([turn(1, 10, ids=["c"])], [commit])
        self.assertEqual(landed.commits, 1)
        self.assertTrue(landed.produced_work)

    def test_a_sed_touch_is_a_changed_file_and_a_rejected_edit_is_not(self):
        """FOUND IN REVIEW (2026-09-13): four rules answered "which files did this change"
        and disagreed. A stretch whose only change was a `sed -i` read "whether it changed
        any file cannot be read" here while `live`'s map drew the file as edited; and a
        rejected Edit counted as a file touched here while `live` said it changed nothing.
        One rule now, `patterns._touched`, less the calls an error answered."""
        sed = call(1.0, "Bash", "s", "sed -i 's/a/b/' src/x.py", path="src/x.py")
        s = seg([turn(1, 100, ids=["s"])], [sed])
        self.assertEqual((s.files_touched, s.produced_work, s.unreadable), (1, True, False))
        self.assertEqual(burn._verdict(burn._segment_row(s, 100)), "it changed 1 file")
        rejected = call(1.0, "Edit", "e", "/r/a.py", path="/r/a.py")
        s = seg([turn(1, 100, ids=["e"])], [rejected, failed(2.0, "e")])
        self.assertEqual((s.files_touched, s.produced_work), (0, False))

    def test_a_failed_commit_with_no_call_ids_made_no_commit(self):
        """Aider writes its shell and error events with no call id. The failed commit rule
        paired on ids only and counted `git commit` answered "nothing to commit" as a
        commit, while `live` (adjacency) counted none (FOUND IN REVIEW). One rule now,
        `burn.failed_calls`."""
        commit = Ev(0, 1.0, "tool", 'git commit -m "wip"', tool="run")
        refused = Ev(0, 2.0, "result_error", "nothing to commit, working tree clean", tool="run", ok=False)
        s = seg([turn(1, 100)], [commit, refused])
        self.assertEqual(s.commits, 0)
        self.assertEqual(live.ERROR_LOOP_MIN_ERRORS, burn.ERROR_LOOP_MIN_ERRORS)
        self.assertIs(live._failed_calls, burn.failed_calls)

    def test_a_verdict_never_counts_zero_commits(self):
        """The fallback used to be "it made {commits} commits", which printed "it made 0
        commits" for a row with no work that was not barren: a zero where the truth is
        that no work was seen."""
        self.assertEqual(burn._verdict(self.ROW), "nothing was written")
        self.assertNotIn("0 commits", burn._verdict({**self.ROW, "unreadable": True}))

    def test_a_positive_share_is_never_printed_as_zero(self):
        self.assertEqual(burn._share_words(0.004), "under 1%")
        self.assertEqual(burn._share_words(0.0), "0%")
        self.assertEqual(burn._share_words(0.5), "50%")
        self.assertEqual(burn._share_words(0.9451), "95%")

    def test_a_share_short_of_all_is_never_printed_as_all(self):
        """MEASURED on the real corpus (2026-09-13): 5 of 32 spike sentences read "100% of
        it re-reading the conversation so far" at 99.5% to 99.8%. The largest spike,
        159,754,580 tokens, had 371,256 that were not re-reading at all."""
        self.assertEqual(burn._share_words(159_383_324 / 159_754_580), "over 99%")
        self.assertEqual(burn._share_words(0.995), "over 99%")
        self.assertEqual(burn._share_words(0.9949), "99%")
        self.assertEqual(burn._share_words(1.0), "100%")
        report = {
            "sample": {"events": 1},
            "harness_records_usage": True,
            "totals": {
                "tokens": {"value": 159_754_580},
                "lines_added": {"value": 0},
                "lines_removed": {"value": 0},
                "cache_read_share": {"value": 0.998, "cache_read_tokens": 159_383_324},
                "barren_token_share": {"value": None},
            },
            "spikes": [
                {
                    "tokens": 159_754_580,
                    "barren": True,
                    "dominant": {"cause": "context_replay", "n": 1, "tokens": 159_383_324},
                }
            ],
        }
        said = burn.explain(report)
        self.assertTrue(said[1].startswith("Over 99% of that was the conversation"), said[1])
        self.assertIn("159.8M tokens, over 99% of it re-reading", said[2])


class TheFirstSentence(unittest.TestCase):
    """`explain`'s headline and its shares, from the rules `_verdict` uses for one stretch.
    FOUND IN REVIEW (2026-09-13): 17 corpus transcripts read "changed 0 lines (and removed
    0)", some beside "it made 4 commits" or an unreadable share of all of it; a session
    that only removed lines read "changed 0 lines (and removed 40)"; and "About 100%"
    printed for a 0.996 share under a numbers block saying "over 99%"."""

    def report(self, **totals) -> dict:
        base = {
            "harness": "claude_code",
            "harness_records_usage": True,
            "sample": {"events": 3, "segments": 1, "turns": 1, "missing": []},
            "totals": {
                "tokens": {"value": 1_200_000},
                "cache_read_share": {"value": 0.1, "cache_read_tokens": 120_000},
                "lines_added": {"value": 0},
                "lines_removed": {"value": 0},
                "files_touched": {"value": 0},
                "barren_token_share": {"value": 0.0, "barren_tokens": 0},
                "unreadable_token_share": {"value": 0.0, "unreadable_tokens": 0},
            },
            "segments": [],
            "spikes": [],
        }
        for k, v in totals.items():
            if k == "segments":
                base["segments"] = v
            else:
                base["totals"][k] = v
        return base

    def test_lines_are_added_and_removed_never_changed(self):
        rep = self.report(lines_removed={"value": 40})
        self.assertEqual(burn.explain(rep)[0], "This session used 1.2M tokens, added 0 lines and removed 40.")

    def test_no_line_count_is_never_a_zero(self):
        committed = self.report(segments=[{"commits": 4, "unreadable": False}])
        self.assertEqual(burn.explain(committed)[0], "This session used 1.2M tokens and made 4 commits.")
        touched = self.report(files_touched={"value": 2})
        self.assertEqual(
            burn.explain(touched)[0], "This session used 1.2M tokens and changed 2 files with no line count."
        )
        unseen = self.report(segments=[{"unreadable": True}])
        self.assertEqual(
            burn.explain(unseen)[0],
            "This session used 1.2M tokens, and whether it changed any file cannot be read from this transcript.",
        )
        for rep in (committed, touched, unseen):
            self.assertNotIn("0 lines", burn.explain(rep)[0])

    def test_a_share_near_the_ends_is_said_as_the_numbers_block_says_it(self):
        rep = self.report(barren_token_share={"value": 0.996, "barren_tokens": 1_195_200})
        self.assertTrue(
            any(line.startswith("Over 99% went into stretches where nothing was written.") for line in burn.explain(rep))
        )
        rep = self.report(unreadable_token_share={"value": 0.42, "unreadable_tokens": 504_000})
        self.assertIn(
            "About 42% went into stretches whose commands or helper agents may have changed files "
            "this transcript does not show.",
            burn.explain(rep),
        )

    def test_the_replay_detail_and_the_spike_sentence_say_one_number(self):
        """`:.0%` printed "100% of the cost was replaying" above "over 99% of it re-reading"
        about one 159,754,580 token stretch (5 corpus transcripts)."""
        s = seg([turn(1, 1, cache=997)], [call(1.0, "Read", "r", "/a.py", path="/a.py")])
        detail = next(c["detail"] for c in s.causes() if c["cause"] == "context_replay")
        self.assertEqual(detail, "over 99% of the cost was replaying conversation already in context")


class PlainLanguage(unittest.TestCase):
    """docs/analysis.md: no dashes in any string a person reads. The rule is absolute."""

    def test_no_dashes_in_any_phrase_template_at_any_count(self):
        tables = [burn._CAUSE_SENTENCES, burn._CAUSE_SENTENCES_ONE, burn._REPEAT_SENTENCES]
        for table in tables:
            for template in table.values():
                for n in (1, 3, 1234):
                    self.assertFalse(has_dash(template.format(n=n)), template)

    def test_every_cause_has_a_phrase(self):
        causes = {
            "subagent_fanout",
            "error_loop",
            "repeated_call",
            "file_churn",
            "context_replay",
            "compaction",
            "investigated",
        }
        self.assertEqual(set(burn._CAUSE_SENTENCES), causes)
        for kind in ("shell", "edit", "read", "other"):
            self.assertIn(kind, burn._REPEAT_SENTENCES)

    def test_a_refused_harness_says_so_in_one_sentence(self):
        path = write_transcript(
            [user_prompt(0, "go"), assistant(1, "m", usage={"input_tokens": 0})]
        )
        lines = burn.explain(burn.burn_report(path))
        self.assertEqual(len(lines), 1)
        self.assertIn("does not record token counts", lines[0])

    def test_the_summary_names_tokens_and_what_was_written(self):
        """A session whose one stretch was proven barren (it only talked) says so; it is
        never told it "changed 0 lines", a zero the headline did not measure."""
        path = write_transcript(
            [
                user_prompt(0, "go"),
                assistant(1, "m", usage=USAGE),
            ]
        )
        lines = burn.explain(burn.burn_report(path))
        self.assertEqual(lines[0], "This session used 9k tokens, and nothing was written.")

    def test_the_summary_says_one_line_not_one_lines(self):
        path = write_transcript(
            [
                user_prompt(0, "go"),
                assistant(1, "m", usage=USAGE, blocks=[tool_use("w", "Write", {"file_path": "/a.py"})]),
                tool_result(2, "w", "ok", tur={"type": "create", "content": "x = 1\n"}),
            ]
        )
        self.assertEqual(
            burn.explain(burn.burn_report(path))[0],
            "This session used 9k tokens, added 1 line and removed 0.",
        )

    def test_every_string_every_report_can_produce_is_free_of_dashes(self):
        """Every sentence, refusal, reason and cause detail, across every path: usage and
        none, a harness outside the readers, an empty file, each dominant cause."""
        reports = list(_every_report())
        self.assertGreaterEqual(len(reports), 10)
        for rep in reports:
            strings = list(burn.explain(rep)) + list(rep["sample"]["missing"])
            strings += [m.get("reason") or "" for m in rep["totals"].values()]
            for row in rep["segments"]:
                strings += [c["detail"] for c in row["causes"]]
            for s in strings:
                self.assertFalse(has_dash(s), s)


def _every_report():
    """One report per path through `burn_report` and `explain`."""
    t = SpikesAndCauses()
    fresh = SpikesAndCauses.FRESH
    yield t._corpus(heavy_usage=fresh, heavy_blocks=[tool_use(f"t{i}", "Task", {}) for i in range(7)])
    yield t._corpus(heavy_usage=fresh, heavy_blocks=[tool_use("t0", "Task", {})])
    yield t._corpus(
        heavy_usage={**fresh, "cache_read_input_tokens": 3_000_000},
        heavy_blocks=[tool_use("t0", "Task", {})],
    )
    yield t._corpus(
        heavy_usage=fresh,
        heavy_blocks=[tool_use(f"e{i}", "Bash", {"command": "npm test"}) for i in range(4)],
        heavy_extra=[tool_result(1002 + i, f"e{i}", "Error: x", True) for i in range(4)],
    )
    yield t._corpus(heavy_usage=fresh, heavy_blocks=[tool_use(f"l{i}", "Bash", {"command": "ls"}) for i in range(3)])
    yield t._corpus(
        heavy_usage=fresh,
        heavy_blocks=[tool_use(f"r{i}", "Read", {"file_path": f"/f{i}.py"}) for i in range(8)],
    )
    yield t._corpus(
        heavy_usage=fresh,
        heavy_blocks=[tool_use(f"r{i}", "Read", {"file_path": "/same.py"}) for i in range(3)],
    )
    yield t._corpus(
        heavy_usage=fresh,
        heavy_blocks=[
            tool_use(f"w{i}", "Bash", {"command": f"cat > a.py <<'EOF'\nv{i}\nEOF"}) for i in range(4)
        ],
    )
    yield t._corpus(
        heavy_usage=fresh,
        heavy_blocks=[{"type": "text", "text": "long"}],
        heavy_extra=[
            {"type": "system", "subtype": "compact_boundary", "timestamp": iso(1000.5)},
        ],
    )
    yield t._corpus(heavy_usage=fresh, heavy_blocks=[{"type": "text", "text": "long"}])
    yield burn.burn_report(write_transcript([]))
    yield burn.burn_report(
        write_transcript([user_prompt(0, "go"), assistant(1, "m", usage={"input_tokens": 0})])
    )
    yield burn.burn_report(
        codex_rollout([(1, "event_msg", {"type": "user_message", "message": "say hi"})])
    )
    yield burn.burn_report(CODEX_FIXTURE)
    yield burn.burn_report(GEMINI_FIXTURE)


class TurnsForWindowAndSessionBurn(unittest.TestCase):
    """The corpus rollup's two inputs (docs/overnight-engine.md 5.3)."""

    def test_the_window_is_inclusive_and_one_message_is_counted_once_across_files(self):
        """A resumed session's new transcript begins with a COPY of the old one's records
        (the same message id, timestamp and usage), and the sessionizer pools both files
        into one sitting. FOUND IN REVIEW, MEASURED on the corpus: 5 of 158 sittings were
        counted twice over the copies, three of them exactly 2x (8,234,650 tokens against
        4,117,325 distinct), 25,528,872 tokens across the corpus. The first file to carry an
        id keeps it; the window is inclusive at both ends."""
        a = write_transcript(
            [assistant(10, "m1", usage=USAGE), assistant(30, "m2", usage=USAGE), assistant(31, "m3", usage=USAGE)]
        )
        b = write_transcript(
            [assistant(10, "m1", usage=USAGE), assistant(20, "m4", usage=USAGE), assistant(9, "m0", usage=USAGE)]
        )
        got = burn.turns_for_window([a, b], ts(10), ts(30))
        self.assertEqual([(t.msg_id, t.ts) for t in got], [("m1", ts(10)), ("m4", ts(20)), ("m2", ts(30))])
        self.assertEqual(sum(t.total for t in got), 3 * USAGE_TOTAL)

    def test_a_resumed_copy_never_doubles_a_sittings_tokens(self):
        """The same pair read the other way round keeps the same totals: which file holds
        the original is not a thing the count may depend on."""
        records = [assistant(10, "m1", usage=USAGE), assistant(20, "m2", usage=USAGE)]
        old = write_transcript(records)
        new = write_transcript([*records, assistant(40, "m3", usage=USAGE)])
        for order in ([old, new], [new, old]):
            got = burn.turns_for_window(order, ts(0), ts(100))
            self.assertEqual([t.msg_id for t in got], ["m1", "m2", "m3"])
            self.assertEqual(sum(t.total for t in got), 3 * USAGE_TOTAL)

    def test_a_path_listed_twice_is_read_once(self):
        a = write_transcript([assistant(10, "m1", usage=USAGE)])
        calls: list[pathlib.Path] = []

        def loader(p):
            calls.append(p)
            return burn.load_turns(p)

        got = burn.turns_for_window([a, a, str(a)], ts(0), ts(100), loader=loader)
        self.assertEqual(len(calls), 1)
        self.assertEqual(len(got), 1)

    def test_session_burn_is_segment_tokens_and_the_barren_part(self):
        """Segment one wrote a file on 1,000 tokens; segment two only talked, on 3,000."""
        events = [
            Ev(0, 0, "prompt", "write it"),
            Ev(1, 1, "tool", "cat > a.py <<'EOF'", tool="Bash", path="a.py", added=10, tool_id="w"),
            Ev(2, 10, "prompt", "now explain it"),
            Ev(3, 11, "assistant", "sure"),
        ]
        turns = [turn(1, 1000, ids=["w"]), turn(11, 3000)]
        d = burn.session_burn_detail(events, turns)
        self.assertEqual((d["tokens"], d["barren"]), (4000, 3000))

    def test_session_burn_refuses_without_counts_or_events(self):
        events = [Ev(0, 0, "prompt", "go"), Ev(1, 1, "assistant", "ok")]
        self.assertIsNone(burn.session_burn_detail(events, [turn(1, 0)]))
        self.assertIsNone(burn.session_burn_detail(events, []))
        self.assertIsNone(burn.session_burn_detail([], [turn(1, 1000)]))

    def test_the_detail_splits_barren_from_unreadable(self):
        """Segment one wrote a file (1,000), two only talked (3,000), three rewrote a file
        through a `python3 - <<'PY'` script the digest cannot read (5,000). Before the rule
        three was barren too and the pair read (9,000, 8,000)."""
        events = [
            Ev(0, 0, "prompt", "write it"),
            Ev(1, 1, "tool", "cat > a.py <<'EOF'", tool="Bash", path="a.py", added=10, tool_id="w"),
            Ev(2, 10, "prompt", "now explain it"),
            Ev(3, 11, "assistant", "sure"),
            Ev(4, 20, "prompt", "rename the flag"),
            Ev(5, 21, "tool", "python3 - <<'PY' ⏎ p = 'a.py'", tool="Bash", tool_id="p"),
        ]
        turns = [turn(1, 1000, ids=["w"]), turn(11, 3000), turn(21, 5000, ids=["p"])]
        self.assertEqual(
            burn.session_burn_detail(events, turns),
            {"tokens": 9000, "barren": 3000, "unreadable": 5000, "causes": {}},
        )


    def test_session_burn_detail_attributes_barren_tokens_to_causes(self):
        """The report's burn block names what the barren tokens went on, so the detail sums
        `Segment.attribution` over the BARREN segments and nothing else: a cause in a
        segment that wrote something is not spend that changed nothing."""
        events = [
            Ev(0, 0, "prompt", "write it"),
            Ev(1, 1, "tool", "cat > a.py <<'EOF'", tool="Bash", path="a.py", added=10, tool_id="w"),
            Ev(2, 10, "prompt", "how does auth work"),
            *[Ev(3 + i, 11 + i, "tool", f"f{i}.py", tool="Read", path=f"f{i}.py", tool_id=f"r{i}") for i in range(8)],
            Ev(20, 30, "prompt", "and again"),
            Ev(21, 31, "assistant", "It checks the cookie."),
        ]
        turns = [
            turn(1, 1000, cache=9000, ids=["w"]),
            turn(11, 3000, cache=500, ids=[f"r{i}" for i in range(8)]),
            turn(31, 200, cache=4000),
        ]
        d = burn.session_burn_detail(events, turns)
        self.assertEqual((d["tokens"], d["barren"]), (17_700, 7_700))
        # The written segment's context replay (9,000) is not barren spend; the reading
        # segment's reads (3,000 fresh) and the last segment's replay (4,000) are.
        self.assertEqual(d["causes"], {"investigated": (3_000, 1), "context_replay": (4_000, 1)})
        for tokens, _segments in d["causes"].values():
            self.assertLessEqual(tokens, d["barren"])


class SessionWire(unittest.TestCase):
    """The session upload's `burn` block (contract v4 `SessionBurn`), from `session_report`."""

    def test_the_report_over_a_file_is_the_report_over_its_events_and_turns(self):
        recs = [user_prompt(0, "go"), assistant(1, "m1", usage=USAGE)]
        path = write_transcript(recs)
        from_file = burn.burn_report(path)
        from_parts = burn.session_report(
            digest.load_events(path), burn.load_turns(path), harness="claude_code"
        )
        self.assertEqual(from_file, from_parts)

    def test_absent_is_null_and_every_share_is_unrounded(self):
        s = next(x for x in burn_fixture.scenarios() if x.name == "replay")
        w = burn.session_wire(s.report())
        self.assertEqual(w["cache_read_share"], 9_723_000 / 10_600_000)
        self.assertIsNone(w["reason"])
        self.assertEqual(w["spikes_needed"], burn.MIN_SEGMENTS_FOR_SPIKES)
        top = w["spikes"][0]
        self.assertEqual(top["causes"][0]["cause"], "context_replay")  # the dominant cause first
        self.assertEqual([c["cause"] for c in top["causes"]], ["context_replay", "subagent_fanout", "error_loop"])
        for name, reason, spikes in (("empty", "not_segmented", None), ("no_counts", "no_token_counts", None)):
            w = burn.session_wire(next(x for x in burn_fixture.scenarios() if x.name == name).report())
            self.assertEqual((w["reason"], w["tokens"], w["cache_read_share"], w["spikes"]), (reason, None, None, spikes))
        empty = burn.session_wire(next(x for x in burn_fixture.scenarios() if x.name == "empty").report())
        self.assertEqual((empty["lines_added"], empty["commits"], empty["segments"]), (None, None, 0))

    def test_too_few_segments_is_null_and_enough_with_no_spike_is_empty(self):
        short = burn.session_wire(next(x for x in burn_fixture.scenarios() if x.name == "short").report())
        self.assertIsNone(short["spikes"])
        even = burn_fixture.Burnable("even")
        for i in range(6):
            even.prompt(100 * i).turn(100 * i + 1, fresh=1_000).say(100 * i + 2)
        w = burn.session_wire(even.report())
        self.assertEqual((w["segments"], w["spikes"]), (6, []))

    def test_a_repeat_is_said_by_what_repeated_and_nothing_else_carries_a_tool(self):
        churn = burn.session_wire(next(x for x in burn_fixture.scenarios() if x.name == "churn").report())
        causes = churn["spikes"][0]["causes"]
        self.assertEqual([(c["cause"], c["repeat"]) for c in causes], [("repeated_call", "edit"), ("file_churn", None)])
        text = json.dumps(churn)
        for leaked in ("Button.tsx", "/repo", "Edit", "pytest"):
            self.assertNotIn(leaked, text)

    def test_every_fixture_summary_is_explain_over_the_same_report(self):
        for s in burn_fixture.scenarios():
            rep = s.report()
            self.assertTrue(burn.explain(rep), s.name)
            for line in burn.explain(rep):
                self.assertFalse(has_dash(line), line)


def _shell(text: str, tid: str = "s", path=None, added=None) -> Ev:
    return Ev(0, 1.0, "tool", text, tool="Bash", tool_id=tid, path=path, added=added)


class Unreadable(unittest.TestCase):
    """"Nothing was written" is proven, never assumed (module docstring, rule 5).

    MEASURED on the real corpus (2026-09-13). Calling every segment with no VISIBLE work
    barren put 1,309,078,925 of 4,159,567,552 tokens (31.5%) under "nothing was written";
    538,299,660 of those sat in segments whose scripts rewrote files, one a 7.5M token
    stretch that rewrote `AdBanner.js` twice through `python3 - <<'EOF'`. With the rule,
    120,070,737 of 4,168,469,723 (2.9%) are barren and 1,192,481,138 (28.6%) unreadable,
    and all 63 shell calls left inside barren segments were read back in full: every one
    only reads. On the live transcript the "clone" stretch (`git clone`) and the "run on
    sim" stretch (`npx expo start --ios`) were barren before; only "hello" is now."""

    def test_the_commands_that_only_read(self):
        for text in (
            "ls -la",
            "cd /repo ⏎ sed -n '1254,1275p' mobile/src/screens/HomeScreen.js",
            'grep -rn "rank_limit" mobile/src | head -12',
            'grep -rn "a|b" src/ 2>/dev/null | head -20',
            "git status --short && echo \"---\" && git diff --stat",
            "git -C /repo log --oneline -8 && git stash list",
            "git branch -a | head -20",
            "df -h / 2>/dev/null | awk 'NR==1 {print}'",
            'for c in e63c8ba 0b6e41a; do echo "== $c"; git show --stat --oneline $c | head -8; done',
            'echo "clean=$(git status --porcelain | wc -l | tr -d \' \')"',
            "curl -s http://localhost:5001/api/health > /dev/null 2>&1",
            "X=1 timeout 5 cat a.txt",
            "awk -F: '{print $1}' /etc/passwd",
            "git log --format='%h %s' -5",
        ):
            self.assertTrue(burn._shell_reads_only(text), text)
            self.assertFalse(burn._could_write_unseen(_shell(text)), text)

    def test_the_commands_that_could_write(self):
        for text in (
            "python3 - <<'PY' ⏎ open('a.py', 'w').write(s) ⏎ PY",
            "cd ~/projects && git clone https://github.com/x/y.git && ls -la y",
            "npx expo start --ios 2>&1",
            "echo done > status.txt",
            "grep -n x a.py 2> errors.log",
            'echo "$(rm -rf build)"',
            "ls `rm -rf build`",
            "git checkout -- mobile/src/utils/routeOrdering.js",
            "git stash",
            "git branch -D old",
            "find . -name '*.pyc' -delete",
            "curl -s -o page.html https://example.com",
            "sed -i 's/a/b/' notes",
            "make build",
            "./scripts/fix.sh",
            "cd /repo && cat a.py && python3 -c 'print(1)'",
            "grep -rn x src/ | head …[+120]",  # cut at COMMAND_MAX: the tail is not here
            "awk '{print > \"out.txt\"}' a.log",  # a write from inside the program
            "sed -n 's/a/b/w out.txt' a.txt",
        ):
            self.assertFalse(burn._shell_reads_only(text), text)
            self.assertTrue(burn._could_write_unseen(_shell(text)), text)

    def test_a_write_the_digest_already_counted_is_work_not_unreadable(self):
        e = _shell("cat > a.py <<'EOF'", path="a.py", added=3)
        self.assertFalse(burn._could_write_unseen(e))

    def test_an_edit_the_digest_names_no_file_for_is_unreadable_not_barren(self):
        """MEASURED on this machine's real Codex rollout (2026-03-28, 39 segments, 40.3M
        tokens): the writer wraps every `apply_patch` output as `{"output": "Success. ..."}`,
        the loader read all 52 successful patches (4,153 added lines by hand) as failures
        with no path, and burn called 22 of the 39 segments barren. A patch call is an
        attempt to write, never proof that nothing was."""
        patch = Ev(0, 1.0, "tool", "scripts/process_scan.py", tool="apply_patch", tool_id="p")
        self.assertTrue(burn._could_write_unseen(patch))
        s = seg([turn(1, 500, ids=["p"])], [patch, failed(2, "p")])
        self.assertEqual((s.produced_work, s.barren, s.unreadable), (False, False, True))
        named = Ev(0, 1.0, "tool", "a.py", tool="Edit", path="/repo/a.py", tool_id="e")
        self.assertFalse(burn._could_write_unseen(named))

    def test_tools_other_than_the_shell(self):
        def tool(name: str) -> Ev:
            return Ev(0, 1.0, "tool", "", tool=name, tool_id="t")

        for name in ("Read", "Grep", "Glob", "WebSearch", "WebFetch", "ToolSearch", "TodoWrite"):
            self.assertFalse(burn._could_write_unseen(tool(name)), name)
        # A helper's edits are in its sidecar; an MCP tool can do anything; an edit tool is
        # work the digest sees.
        for name in ("Task", "Agent", "mcp__plugin_posthog_posthog__exec", "EnterWorktree"):
            self.assertTrue(burn._could_write_unseen(tool(name)), name)
        self.assertFalse(
            burn._could_write_unseen(Ev(0, 1.0, "tool", "", tool="Edit", path="/a.py", tool_id="e"))
        )
        self.assertFalse(burn._could_write_unseen(Ev(0, 1.0, "assistant", "python3 x.py")))

    def test_the_segment_is_unreadable_and_says_so(self):
        s = seg([turn(1, 7_500_000, ids=["p"])], [_shell("python3 - <<'EOF' ⏎ p = 'AdBanner.js'", "p")])
        self.assertFalse(s.produced_work)
        self.assertFalse(s.barren)
        self.assertTrue(s.unreadable)
        self.assertEqual(s.unreadable_calls, 1)
        row = burn._segment_row(s, 1_000.0)
        self.assertEqual(burn._verdict(row), burn.UNREADABLE_VERDICT)

    def test_a_segment_with_visible_work_is_neither(self):
        s = seg(
            [turn(1, 100, ids=["w", "p"])],
            [_shell("cat > a.py <<'EOF'", "w", path="a.py", added=4), _shell("python3 x.py", "p")],
        )
        self.assertEqual((s.produced_work, s.barren, s.unreadable), (True, False, False))

    def test_reading_is_investigated_only_when_nothing_else_could_have_written(self):
        reads = [call(i, "Read", f"r{i}", path=f"/f{i}.py") for i in range(8)]
        self.assertIn("investigated", [c["cause"] for c in seg([turn(1, 10)], reads).causes()])
        mixed = reads + [_shell("python3 fix.py", "p")]
        self.assertNotIn("investigated", [c["cause"] for c in seg([turn(1, 10)], mixed).causes()])

    def test_the_report_carries_both_shares_and_explain_names_the_unreadable_one(self):
        path = write_transcript(
            [
                user_prompt(0, "fix the banner"),
                assistant(
                    1,
                    "m0",
                    usage=USAGE,
                    blocks=[tool_use("p", "Bash", {"command": "python3 - <<'EOF'\nopen('a.js','w')\nEOF"})],
                ),
                tool_result(2, "p", "machinery replaced"),
                user_prompt(10, "thanks"),
                assistant(11, "m1", usage={"input_tokens": 100}),
            ]
        )
        rep = burn.burn_report(path)
        t = rep["totals"]
        self.assertEqual(t["unreadable_token_share"]["unreadable_tokens"], USAGE_TOTAL)
        self.assertEqual(t["barren_token_share"]["barren_tokens"], 100)
        self.assertEqual(t["unreadable_token_share"]["n"], 1)
        self.assertEqual([r["index"] for r in rep["barren"]], [1])
        said = burn.explain(rep)
        self.assertIn(
            "About 99% went into stretches whose commands or helper agents may have changed "
            "files this transcript does not show.",
            said,
        )
        self.assertFalse(any("nothing was written" in s for s in said))


class NoZerosWhereCountsAreAbsent(unittest.TestCase):
    def test_segment_rows_and_the_rollup_carry_none_not_zero_without_counts(self):
        """A harness that records no counts (Cursor writes {0, 0} on all 14,565 rows) left
        every segment row reading `tokens: 0` and every cause rollup `tokens: 0`: a stretch
        that "cost nothing" rather than one nobody counted."""
        path = write_transcript(
            [
                user_prompt(0, "go"),
                assistant(
                    1,
                    "m",
                    usage={"input_tokens": 0},
                    blocks=[tool_use(f"e{i}", "Bash", {"command": f"ls {i}"}) for i in range(3)],
                ),
                *[tool_result(2 + i, f"e{i}", "Error: no", True) for i in range(3)],
            ]
        )
        rep = burn.burn_report(path)
        row = rep["segments"][0]
        self.assertEqual(
            (row["tokens"], row["output_tokens"], row["cache_read"], row["cost_per_line"]),
            (None, None, None, None),
        )
        self.assertFalse(row["barren"])
        self.assertIsNone(rep["causes"][0]["tokens"])
        self.assertIsNone(rep["totals"]["unreadable_token_share"]["value"])
        self.assertIsNone(rep["totals"]["barren_token_share"]["barren_tokens"])
        self.assertIsNone(rep["totals"]["cache_read_share"]["cache_read_tokens"])


class RoundedOnce(unittest.TestCase):
    def test_a_share_in_a_sentence_is_rounded_from_its_integers(self):
        """MEASURED on the live transcript: 20,054,958 cache reads of 21,009,013 tokens is
        95.46%. The report's value is 0.955 (3 dp), and `explain` rounded that again to
        "96%", one point off the truth."""
        report = {
            "sample": {"events": 1},
            "harness_records_usage": True,
            "totals": {
                "tokens": {"value": 21_009_013},
                "lines_added": {"value": 1_893},
                "lines_removed": {"value": 6},
                "cache_read_share": {"value": 0.955, "cache_read_tokens": 20_054_958},
                "barren_token_share": {"value": 0.002, "barren_tokens": 49_605},
            },
            "spikes": [],
        }
        said = burn.explain(report)
        self.assertTrue(said[1].startswith("95% of that was the conversation"), said[1])
        # a report dict without the integer (an older shape) still reads its own value
        del report["totals"]["cache_read_share"]["cache_read_tokens"]
        self.assertTrue(burn.explain(report)[1].startswith("96%"))

    def test_a_count_just_under_a_million_is_not_a_thousand_k(self):
        self.assertEqual(burn._human(999_499), "999k")
        self.assertEqual(burn._human(999_500), "1.0M")
        self.assertEqual(burn._human(1_000_000), "1.0M")
        self.assertEqual(burn._human(17_684_205), "17.7M")
        self.assertEqual(burn._human(950), "950")


class CodexTurns(unittest.TestCase):
    """`_codex_turns`, against the real writer's fixture and hand-made rollouts."""

    def test_the_real_writer_fixture(self):
        """codex-cli 0.153.4 against a mock model: 6 responses, 7,635 tokens, 2,500 of them
        cached input (codex.py docstring, MEASURED over the same file)."""
        counters = collections.Counter()
        turns = burn._codex_turns(CODEX_FIXTURE, counters)
        self.assertEqual(len(turns), 6)
        self.assertEqual(sum(t.total for t in turns), 7_635)
        self.assertEqual(sum(t.cache_read for t in turns), 2_500)
        self.assertEqual([t.total for t in turns], [1020, 1121, 1222, 1323, 1424, 1525])
        self.assertEqual([t.input_tokens for t in turns], [1000, 600, 700, 800, 900, 1000])
        self.assertEqual([t.msg_id for t in turns], [f"resp_{i}" for i in range(6)])
        self.assertEqual(
            [t.tool_ids for t in turns], [["call_1"], ["call_2"], ["call_3"], ["call_4"], ["call_5"], []]
        )
        self.assertEqual(turns[1].tools, ["apply_patch"])
        self.assertEqual({t.model for t in turns}, {"gpt-5"})
        self.assertEqual(counters["total_mismatch"], 0)
        self.assertEqual(burn.load_turns(CODEX_FIXTURE), turns)

    def test_every_codex_fixture_agrees_with_the_loaders_own_cumulative_total(self):
        """Two independent readings of one file must agree: the per response turns summed,
        and the writer's own cumulative `total_token_usage` as `codex.usage` reads it. The
        synthetic fixture has no `token_usage_record` and exercises the fallback."""
        from analysis import codex

        fixtures = sorted((REPO / "spec" / "fixtures" / "codex").glob("*.jsonl"))
        self.assertGreaterEqual(len(fixtures), 3)
        for f in fixtures:
            final = codex.usage(f)["final_total_token_usage"]
            want = final["total_tokens"] if final else 0
            self.assertEqual(sum(t.total for t in burn._codex_turns(f)), want, f.name)

    def test_a_response_recorded_twice_is_counted_once(self):
        u = codex_usage(1000, 0, 100)
        path = codex_rollout(
            [
                (1, "response_item", codex_call("c1")),
                (2, "token_usage_record", {"response_id": "r1", "usage": u}),
                (3, "token_usage_record", {"response_id": "r1", "usage": u}),
            ]
        )
        counters = collections.Counter()
        turns = burn._codex_turns(path, counters)
        self.assertEqual([(t.msg_id, t.total, t.tool_ids) for t in turns], [("r1", 1100, ["c1"])])
        self.assertEqual(counters["usage_record_duplicate"], 1)

    def test_a_record_without_a_response_id_is_kept_and_counted(self):
        path = codex_rollout([(2, "token_usage_record", {"usage": codex_usage(10, 0, 1)})])
        counters = collections.Counter()
        turns = burn._codex_turns(path, counters)
        self.assertEqual([t.total for t in turns], [11])
        self.assertEqual(counters["usage_record_without_response_id"], 1)

    def test_cache_writes_come_out_of_input_so_the_total_still_matches(self):
        """`input_tokens` includes both cached and written cache (the second ASSUMED)."""
        path = codex_rollout(
            [(2, "token_usage_record", {"response_id": "r", "usage": codex_usage(1000, 300, 50, write=200)})]
        )
        t = burn._codex_turns(path)[0]
        self.assertEqual(
            (t.input_tokens, t.cache_read, t.cache_create, t.output_tokens, t.total),
            (500, 300, 200, 50, 1050),
        )

    def test_a_total_that_disagrees_is_counted_never_raised_or_corrected(self):
        path = codex_rollout(
            [(2, "token_usage_record", {"response_id": "r", "usage": codex_usage(100, 0, 10, total=999)})]
        )
        counters = collections.Counter()
        self.assertEqual(burn._codex_turns(path, counters)[0].total, 110)
        self.assertEqual(counters["total_mismatch"], 1)

    def test_without_usage_records_token_count_events_are_read_only_when_they_grew(self):
        """An older writer: no `token_usage_record`. The second event repeats the first's
        `info` (a rate limit refresh) and must not count the response twice."""

        def tc(total, last):
            return {
                "type": "token_count",
                "info": {"total_token_usage": {"total_tokens": total}, "last_token_usage": last},
            }

        path = codex_rollout(
            [
                (1, "response_item", codex_call("c1")),
                (2, "event_msg", tc(1100, codex_usage(1000, 0, 100))),
                (3, "event_msg", tc(1100, codex_usage(1000, 0, 100))),
                (4, "event_msg", {"type": "token_count", "info": None}),
                (5, "response_item", {"type": "local_shell_call", "id": "ls1", "action": {"command": ["ls"]}}),
                (6, "event_msg", tc(2400, codex_usage(1200, 600, 100))),
            ]
        )
        counters = collections.Counter()
        turns = burn._codex_turns(path, counters)
        self.assertEqual(
            [(t.msg_id, t.total, t.cache_read, t.tools, t.tool_ids) for t in turns],
            [("tc0", 1100, 0, ["exec_command"], ["c1"]), ("tc1", 1300, 600, ["shell"], ["ls1"])],
        )
        self.assertEqual(counters["token_count_unchanged"], 1)
        self.assertEqual(counters["basis_token_count_fallback"], 1)

    def test_the_report_reads_a_codex_rollout(self):
        path = codex_rollout(
            [
                (1, "event_msg", {"type": "user_message", "message": "list the files"}),
                (2, "response_item", codex_call("c1")),
                (3, "token_usage_record", {"response_id": "r1", "usage": codex_usage(1000, 800, 20)}),
            ]
        )
        rep = burn.burn_report(path)
        self.assertEqual(rep["harness"], "codex")
        self.assertTrue(rep["harness_records_usage"])
        self.assertEqual(rep["totals"]["tokens"]["value"], 1020)
        self.assertEqual(rep["totals"]["cache_read_share"]["value"], round(800 / 1020, 3))


class GeminiTurns(unittest.TestCase):
    """`_gemini_turns`, against the synthetic recording and hand-made ones."""

    def test_the_synthetic_recording_counts_each_message_once(self):
        """g1 is written three times (twice with tokens), g_wrong is rewound away, and g4
        has no timestamp. Four turns, 51,862 tokens; summing every line reads 75,042."""
        counters = collections.Counter()
        turns = burn._gemini_turns(GEMINI_FIXTURE, counters)
        self.assertEqual(len(turns), 4)
        self.assertEqual(sum(t.total for t in turns), 51_862)
        self.assertEqual(gemini.scan(GEMINI_FIXTURE).usage["naive_sum_all_records"]["total"], 75_042)
        self.assertEqual({t.msg_id for t in turns}, {"g1", "g2", "g3", "g4"})
        g1 = next(t for t in turns if t.msg_id == "g1")
        self.assertEqual(g1.tool_ids, [f"c{i}" for i in range(1, 9)])
        self.assertEqual((g1.input_tokens, g1.output_tokens, g1.cache_read), (9000, 160, 0))
        # g4 has no timestamp: the session start, the rule `gemini._derive` applies too
        g4 = next(t for t in turns if t.msg_id == "g4")
        self.assertEqual(g4.ts, dt.datetime(2025, 11, 4, 9, 0, tzinfo=dt.UTC).timestamp())
        self.assertEqual(counters["message_no_timestamp"], 1)
        self.assertEqual(counters["total_mismatch"], 0)
        self.assertEqual(burn.load_turns(GEMINI_FIXTURE), turns)

    def test_every_gemini_fixture_agrees_with_the_loaders_own_deduplicated_total(self):
        fixtures = [
            f
            for f in sorted((REPO / "spec" / "fixtures" / "gemini").glob("*.json*"))
            if not f.name.endswith(".expected.json")
        ]
        self.assertGreaterEqual(len(fixtures), 4)
        for f in fixtures:
            want = gemini.usage(f)["deduped_by_message_id"]["total"]
            self.assertEqual(sum(t.total for t in burn._gemini_turns(f)), want, f.name)

    def test_the_field_mapping(self):
        """input 1,000 of which 600 cached, 50 tool prompt tokens, 30 output and 20
        thoughts: fresh input 450, output 50, cache read 600, total 1,100."""
        tokens = {"input": 1000, "cached": 600, "tool": 50, "output": 30, "thoughts": 20, "total": 1100}
        path = gemini_recording(
            [
                {"id": "u1", "timestamp": iso(1), "type": "user", "content": "do it"},
                {"id": "g1", "timestamp": iso(2), "type": "gemini", "content": "ok", "model": "gemini-2.5-pro",
                 "tokens": {**tokens, "input": 5, "total": 5}},
                {"id": "g1", "timestamp": iso(2), "type": "gemini", "content": "ok", "model": "gemini-2.5-pro",
                 "tokens": tokens,
                 "toolCalls": [{"id": "k1", "name": "read_file", "args": {"file_path": "/a.py"}, "status": "success"}]},
                {"id": "g2", "timestamp": iso(3), "type": "gemini", "content": "no counts here"},
            ]
        )
        counters = collections.Counter()
        turns = burn._gemini_turns(path, counters)
        self.assertEqual(len(turns), 1, "a later copy replaces the earlier; no tokens, no turn")
        t = turns[0]
        self.assertEqual(
            (t.input_tokens, t.output_tokens, t.cache_read, t.cache_create, t.total),
            (450, 50, 600, 0, 1100),
        )
        self.assertEqual((t.tools, t.tool_ids, t.model), (["read_file"], ["k1"], "gemini-2.5-pro"))
        self.assertEqual(counters["total_mismatch"], 0)

    def test_a_total_that_disagrees_is_counted(self):
        path = gemini_recording(
            [{"id": "g1", "timestamp": iso(2), "type": "gemini", "content": "ok",
              "tokens": {"input": 10, "output": 1, "total": 99}}]
        )
        counters = collections.Counter()
        self.assertEqual(burn._gemini_turns(path, counters)[0].total, 11)
        self.assertEqual(counters["total_mismatch"], 1)

    def test_the_report_reads_a_gemini_recording(self):
        rep = burn.burn_report(GEMINI_FIXTURE)
        self.assertEqual(rep["harness"], "gemini")
        self.assertTrue(rep["harness_records_usage"])
        self.assertEqual(rep["totals"]["tokens"]["value"], 51_862)


class EmptyAndBroken(unittest.TestCase):
    def test_an_empty_transcript_does_not_raise(self):
        path = write_transcript([])
        rep = burn.burn_report(path)
        self.assertEqual(rep["sample"]["segments"], 0)

    def test_an_empty_transcript_has_the_same_shape_and_says_so_plainly(self):
        """It is not a harness that writes no counts: there was nothing to read."""
        empty = burn.burn_report(write_transcript([]))
        full = burn.burn_report(write_transcript([user_prompt(0, "go"), assistant(1, "m", usage=USAGE)]))
        self.assertEqual(set(empty), set(full))
        self.assertEqual(set(empty["totals"]), set(full["totals"]))
        self.assertIsNone(empty["totals"]["lines_added"]["value"])
        self.assertTrue(empty["totals"]["lines_added"]["reason"])
        self.assertEqual(
            burn.explain(empty),
            ["Nothing in this transcript could be read yet, so there is no cost to show."],
        )

    def test_a_partial_trailing_line_is_never_consumed(self):
        """Transcripts are appended to while being read; the last line is routinely half
        written, and a writer can stop between a record's last brace and its newline.

        The trailing record here is COMPLETE, valid JSON with no newline, so only the
        `endswith(b"\\n")` guard keeps it out. FOUND IN REVIEW (2026-09-13): the old
        version wrote half a record, which the JSON decoder skipped on its own, and the
        test passed with the guard deleted (CLAUDE.md: a negative test that cannot reach
        the code it claims to test passes for the wrong reason)."""
        path = pathlib.Path(_TMP.name) / f"partial{next(_COUNTER)}.jsonl"
        with path.open("w") as fd:
            fd.write(json.dumps(user_prompt(0, "go")) + "\n")
            fd.write(json.dumps(assistant(1, "m0", usage=USAGE)) + "\n")
            fd.write(json.dumps(assistant(2, "m1", usage=USAGE)))  # whole, but no newline
        turns = burn.load_turns(path)
        self.assertEqual([t.msg_id for t in turns], ["m0"])

    def test_a_malformed_line_in_the_middle_is_skipped(self):
        path = pathlib.Path(_TMP.name) / f"malformed{next(_COUNTER)}.jsonl"
        with path.open("w") as fd:
            fd.write(json.dumps(user_prompt(0, "go")) + "\n")
            fd.write("{not json at all\n")
            fd.write(json.dumps(assistant(1, "m0", usage=USAGE)) + "\n")
        self.assertEqual(len(burn.load_turns(path)), 1)

    def test_a_missing_file_is_no_turns_not_an_error(self):
        missing = pathlib.Path(_TMP.name) / "never_written.jsonl"
        self.assertEqual(burn.load_turns(missing), [])


if __name__ == "__main__":
    unittest.main()
