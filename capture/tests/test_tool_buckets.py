"""python3 -m unittest capture.tests.test_tool_buckets

docs/overnight-integration.md 5.1: `tool_calls` kept only Read, Edit, Write and Bash and
DROPPED every other call, so a sitting of web searches or MCP calls uploaded fewer tool
calls than it made, and could fall under its prompt count, which the server's `sanity_gate`
rejects as a broken prompt filter. The contract always said "unknown and MCP names bucket
to mcp_other / other"; now capture keeps the promise, and every call counts exactly once.

MEASURED on `~/.builder-overnight/corpus` (2026-09-13): of the five real sittings the gate
rejected, one was this and is accepted now; the other four have more typed prompts than
tool calls with every call counted (checked against the raw JSONL), which no count on this
side can or should change.
"""

from __future__ import annotations

import datetime as dt
import json
import pathlib
import tempfile
import unittest

from analysis.tests import transcripts as tr
from capture import sessions
from capture.discover import Transcript

ROOT = pathlib.Path(__file__).resolve().parents[2]
CONTRACT = json.loads((ROOT / "privacy" / "upload-contract.json").read_text())


class Buckets(unittest.TestCase):
    def test_websearch_toolsearch_and_mcp_calls_bucket_to_other_and_mcp_other(self):
        cases = {
            ("Read", "claude_code"): "Read",
            ("Bash", "claude_code"): "Bash",
            ("WebSearch", "claude_code"): "other",
            ("WebFetch", "claude_code"): "other",
            ("ToolSearch", "claude_code"): "other",
            ("Task", "claude_code"): "other",
            ("Agent", "claude_code"): "other",
            ("Grep", "claude_code"): "other",
            ("Glob", "claude_code"): "other",
            ("TodoWrite", "claude_code"): "other",
            ("ExitPlanMode", "claude_code"): "other",
            ("Skill", "claude_code"): "other",
            ("mcp__posthog__exec", "claude_code"): "mcp_other",
            ("mcp__claude_ai_Slack__slack_send_message", "claude_code"): "mcp_other",
            ("exec_command", "codex"): "Bash",
            ("apply_patch", "codex"): "Edit",
            ("write_to_file", "cline"): "Write",
            ("websearch", "opencode"): "other",
            ("commit", "aider"): "other",
        }
        for (tool, harness), want in cases.items():
            self.assertEqual(sessions.tool_bucket(tool, harness), want, (tool, harness))
            self.assertIn(want, CONTRACT["fields"][[f["name"] for f in CONTRACT["fields"]].index("tool_calls")]["values"])

    def test_every_call_counts_exactly_once(self):
        from analysis.digest import Ev

        names = ["Read", "Edit", "WebSearch", "mcp__x__y", "ToolSearch", "Bash", "Bash"]
        events = [Ev(i, float(i), "tool", "", tool=n) for i, n in enumerate(names)]
        events.append(Ev(9, 9.0, "prompt", "hi"))
        counts = sessions.uploaded_tool_counts(events, "claude_code")
        self.assertEqual(counts, {"Read": 1, "Edit": 1, "other": 2, "mcp_other": 1, "Bash": 2})
        self.assertEqual(sum(counts.values()), len(names))
        self.assertNotIn("Write", counts, "a key with no calls is absent, not 0")

    def test_a_short_websearch_session_clears_the_prompt_gate(self):
        """Three prompts and three WebSearch calls: `tool_calls` was `{}` (nothing counted),
        and with the web searches dropped a sitting like this with a single Read would read
        1 tool call against 3 prompts, which `sanity_gate` rejects. Now it is 3 against 3."""
        b = tr.Builder()
        for i in range(3):
            b.prompt(100 * i, f"look up thing {i}")
            b.call(100 * i + 5, "WebSearch", {"query": f"thing {i}"}, ok=100 * i + 8, out="results")
        with tempfile.TemporaryDirectory() as tmp:
            path = tr.write_transcript(b.records, pathlib.Path(tmp))
            src = sessions.load_source(Transcript(path.parent.name, path))
            [s] = sessions.sessionize_sources([src], dt.UTC, now=tr.T0 + 7200)
            p = sessions.build_payload(s, dt.UTC, "1" * 64, "test")
        self.assertEqual(p["human_prompt_count"], 3)
        self.assertEqual(p["tool_calls"], {"other": 3})
        # server/builder/routes/sync.py sanity_gate, the check that rejected these.
        total = sum(p["tool_calls"].values())
        self.assertFalse(p["human_prompt_count"] > total and total > 0)


if __name__ == "__main__":
    unittest.main()
