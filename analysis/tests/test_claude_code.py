"""python3 -m unittest analysis.tests.test_claude_code

Line credit for the two ways a Claude Code agent writes a file from scratch, held to what
REAL sessions wrote (Claude Code 2.1.261, `claude -p`, 2026-09-05) and to what git said
about the same files. Both records below are the real ones with paths shortened.

* `Write` → `toolUseResult: {"type": "create", "content": …}`: hello.py's content ends in
  a newline; `wc -l` says 6 and the next commit said `6 insertions(+)`. The digest said 7.
* Bash heredoc followed by more commands on the same line: the file has 2 lines and the
  commit said `2 insertions(+)`. The digest said 3 — it counted the terminator line.
"""

from __future__ import annotations

import json
import os
import pathlib
import tempfile
import unittest

from analysis import digest

HELLO = (
    "#!/usr/bin/env python3\n\ndef main():\n    print('hi')\n\nif __name__ == '__main__': main()\n"
)
HEREDOC_CMD = (
    "mkdir -p tests && cat > tests/test_fail.py <<'EOF'\n"
    "def test_fail():\n    assert 1 == 2\nEOF\n"
    "git add -A && git commit -m 'add failing test'"
)


def _write(lines: list[dict]) -> pathlib.Path:
    fd, name = tempfile.mkstemp(suffix=".jsonl")
    with os.fdopen(fd, "w") as f:
        for r in lines:
            f.write(json.dumps(r) + "\n")
    return pathlib.Path(name)


def _tool_use(ts: str, tid: str, name: str, inp: dict) -> dict:
    return {
        "type": "assistant",
        "timestamp": ts,
        "uuid": f"u-{tid}",
        "sessionId": "s",
        "message": {
            "id": f"msg_{tid}",
            "model": "claude-sonnet-5",
            "role": "assistant",
            "content": [{"type": "tool_use", "id": tid, "name": name, "input": inp}],
            "usage": {"input_tokens": 2, "output_tokens": 10},
        },
    }


def _tool_result(ts: str, tid: str, content: str, tur) -> dict:
    return {
        "type": "user",
        "timestamp": ts,
        "uuid": f"r-{tid}",
        "sessionId": "s",
        "message": {
            "role": "user",
            "content": [{"tool_use_id": tid, "type": "tool_result", "content": content}],
        },
        "toolUseResult": tur,
    }


class WriteCreateLines(unittest.TestCase):
    def test_trailing_newline_is_not_an_extra_line(self):
        path = _write(
            [
                _tool_use(
                    "2026-09-05T17:42:38.000Z",
                    "toolu_1",
                    "Write",
                    {"file_path": "/repo/hello.py", "content": HELLO},
                ),
                _tool_result(
                    "2026-09-05T17:42:41.156Z",
                    "toolu_1",
                    "File created successfully at: /repo/hello.py",
                    {
                        "type": "create",
                        "filePath": "/repo/hello.py",
                        "content": HELLO,
                        "structuredPatch": [],
                    },
                ),
            ]
        )
        try:
            events = digest.load_claude_code_events(path)
        finally:
            path.unlink()
        w = next(e for e in events if e.tool == "Write")
        self.assertEqual((w.added, w.removed, w.path), (6, 0, "/repo/hello.py"))
        self.assertEqual(HELLO.count("\n"), 6)  # what `wc -l` and git counted

    def test_unterminated_last_line_still_counts(self):
        path = _write(
            [
                _tool_use("2026-09-05T17:42:38.000Z", "t", "Write", {"file_path": "/r/a"}),
                _tool_result(
                    "2026-09-05T17:42:39.000Z",
                    "t",
                    "ok",
                    {"type": "create", "filePath": "/r/a", "content": "one\ntwo"},
                ),
                _tool_use("2026-09-05T17:42:40.000Z", "e", "Write", {"file_path": "/r/b"}),
                _tool_result(
                    "2026-09-05T17:42:41.000Z",
                    "e",
                    "ok",
                    {"type": "create", "filePath": "/r/b", "content": ""},
                ),
            ]
        )
        try:
            events = digest.load_claude_code_events(path)
        finally:
            path.unlink()
        added = {e.path: e.added for e in events if e.kind == "tool"}
        self.assertEqual(added, {"/r/a": 2, "/r/b": 0})


class HeredocLines(unittest.TestCase):
    def test_terminator_and_following_commands_are_not_content(self):
        self.assertEqual(digest._bash_file_effect(HEREDOC_CMD), ("tests/test_fail.py", 2))

    def test_heredoc_that_ends_the_command(self):
        cmd = "cat > a.py <<'EOF'\nx = 1\ny = 2\nz = 3\nEOF"
        self.assertEqual(digest._bash_file_effect(cmd), ("a.py", 3))
        # Tab-indented `<<-` terminator, unquoted delimiter, append mode.
        cmd = "cat >> b.txt <<-END\n\tline\n\tEND\necho done"
        self.assertEqual(digest._bash_file_effect(cmd), ("b.txt", 1))

    def test_truncated_heredoc_counts_what_is_there(self):
        # No terminator (the command was cut off): count the body lines present.
        self.assertEqual(digest._bash_file_effect("cat > c <<'EOF'\na\nb\n"), ("c", 2))
        self.assertEqual(digest._bash_file_effect("cat > c <<'EOF'\n"), ("c", 0))

    def test_non_heredoc_writes_unchanged(self):
        self.assertEqual(digest._bash_file_effect("sed -i 's/a/b/' src/x.py"), ("src/x.py", None))
        self.assertEqual(digest._bash_file_effect("printf 'x\\n' >> hello.py"), (None, None))


class AHeredocBodyIsData(unittest.TestCase):
    """A heredoc body can contain anything, including text that looks like a command.

    FOUND BY RUNNING IT on this repository's own corpus. CLAUDE.md contains the sentence
    "`analysis/digest.py` has read `cat > path <<'EOF'` writes since it was written", and
    that file is edited through `python3 - <<'PY' … PY`. The outer opener is not a `cat`
    or a `tee`, so the old scan walked straight past it, found the quoted `cat > path
    <<'EOF'` inside the PROSE, and attributed 134 lines to a file literally named `path`
    on a corpus of 10,487 attributable lines. A file that has never existed.
    """

    def test_a_command_quoted_inside_a_body_is_not_a_write(self):
        cmd = (
            "python3 - <<PY\n"
            "s = \"cat > path <<'EOF'\"\n"
            "more\n"
            "lines\n"
            "PY"
        )
        self.assertEqual(digest._bash_file_effect(cmd), (None, None))

    def test_a_sed_quoted_inside_a_body_is_not_a_write_either(self):
        cmd = "python3 - <<PY\nsed -i s/a/b/ inner.py\nPY"
        self.assertEqual(digest._bash_file_effect(cmd), (None, None))

    def test_a_real_write_after_a_skipped_body_is_still_found(self):
        """Skipping is not stopping. The body ends and the command resumes."""
        cmd = "python3 - <<PY\nprint(1)\nPY\ncat > real.py <<'EOF'\nx = 1\ny = 2\nEOF"
        self.assertEqual(digest._bash_file_effect(cmd), ("real.py", 2))

    def test_a_here_string_takes_no_body_and_hides_nothing(self):
        """`<<<` is a here-STRING: one line, no terminator. Treating it as a heredoc opener
        would swallow the rest of the command looking for a delimiter that never comes."""
        cmd = "grep x <<< 'hello'\ncat > b.py <<'EOF'\nz = 3\nEOF"
        self.assertEqual(digest._bash_file_effect(cmd), ("b.py", 1))

    def test_an_unterminated_outer_body_hides_everything_after_it(self):
        """Which is correct: if the terminator never arrives, the rest of the command IS
        the body, and nothing in it is a command this parser may read."""
        cmd = "python3 - <<PY\ncat > x.py <<'EOF'\nnever terminated"
        self.assertEqual(digest._bash_file_effect(cmd), (None, None))


class MaskBeforeTheCut(unittest.TestCase):
    """FOUND IN REVIEW (2026-09-13): every loader cut a text and THEN masked it, so a pasted
    private key longer than the cut lost its END line and the key rule never matched; and
    nine common secret shapes went through unchanged. Every value below is synthetic."""

    PEM = (
        "-----BEGIN RSA PRIVATE KEY-----\n"
        + "\n".join("MIIEowIBAAKCAQEA" + "x" * 48 for _ in range(30))
        + "\n-----END RSA PRIVATE KEY-----"
    )

    def test_a_long_pasted_key_is_masked_whole_before_the_cut(self):
        text = "here is the deploy key, use it:\n" + self.PEM
        self.assertGreater(len(text), digest.PROMPT_MAX)
        kept = digest.clip(text, digest.PROMPT_MAX)
        self.assertIn("[redacted]", kept)
        self.assertNotIn("MIIEowIBAAKCAQEA", kept)
        # The old order, for the record: the cut takes the END line, which the whole key
        # rule needs, so only the unterminated rule could have caught what was left.
        self.assertNotIn("-----END", digest._trunc(text, digest.PROMPT_MAX))

    def test_a_key_whose_end_is_gone_is_still_a_key(self):
        cut = self.PEM[:400]
        self.assertEqual(digest.mask("key: " + cut), "key: [redacted]")

    def test_the_shapes_the_mask_let_through(self):
        for secret in (
            "sk_live_" + "a1B2c3D4e5F6g7H8",
            "rk_test_" + "a1B2c3D4e5F6g7H8",
            "AIza" + "B" * 35,
            "glpat-" + "a1B2c3D4e5F6g7H8i9",
            "hf_" + "a1B2c3D4e5F6g7H8i9J0k",
            "npm_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6",
            "SG." + "a" * 22 + "." + "b" * 43,
            "Bearer eyJ0b2tlbiI6InNlY3JldCJ9",
        ):
            with self.subTest(secret=secret):
                masked = digest.mask(f"use {secret} here")
                self.assertNotIn(secret, masked)
                self.assertIn("[redacted]", masked)
        self.assertEqual(digest.mask("the admin password is hunterpass"), "the admin [redacted]")
        self.assertEqual(
            digest.mask("connect to postgres://admin:hunterpass@localhost/app"),
            "connect to postgres://[redacted]localhost/app",
        )
        # Prose is left alone.
        for text in ("the token count is wrong", "fix the password reset page", "http://localhost:8000/health"):
            self.assertEqual(digest.mask(text), text)

    def test_the_loaders_mask_before_they_cut(self):
        text = "WHY!!! " + self.PEM
        path = _write(
            [
                {"type": "user", "timestamp": "2026-09-05T10:00:00Z", "uuid": "p", "sessionId": "s",
                 "promptSource": "typed", "message": {"role": "user", "content": text}},
            ]
        )
        [ev] = digest.load_claude_code_events(path)
        self.assertNotIn("MIIEowIBAAKCAQEA", ev.text)
        self.assertNotIn("MIIEowIBAAKCAQEA", digest.render([ev], {})[0])


class AnyShapeOfRecord(unittest.TestCase):
    """A valid JSON line that is not an object, a message that is a string, a hunk that is
    not a dict: every command that read the transcript crashed (FOUND IN REVIEW; 0 of
    165,452 local lines, so a crash and not a wrong number, but CLAUDE.md: type check at
    every nesting level)."""

    def test_odd_records_are_skipped_and_the_rest_is_read(self):
        path = _write(
            [
                [1, 2, 3],
                "a string",
                {"type": "assistant", "timestamp": "2026-09-05T10:00:01Z", "message": "not a dict"},
                {"type": "user", "timestamp": "2026-09-05T10:00:02Z", "message": "not a dict"},
                {"type": "attachment", "timestamp": "2026-09-05T10:00:03Z", "attachment": "x"},
                {"type": "user", "timestamp": "2026-09-05T10:00:04Z", "origin": "x", "promptSource": "typed",
                 "message": {"role": "user", "content": "fix it"}},
                _tool_use("2026-09-05T10:00:05Z", "t1", "Edit", {"file_path": "/r/a.py"}),
                _tool_result("2026-09-05T10:00:06Z", "t1", "ok", {"structuredPatch": ["not a hunk", {"lines": "x"}]}),
            ]
        )
        evs = digest.load_claude_code_events(path)
        self.assertEqual([e.kind for e in evs], ["prompt", "tool"])

    def test_the_first_result_is_when_the_call_came_back(self):
        """`result_ts` is the FIRST result for a call id; a repeat of it (a resumed copy)
        must not move it later."""
        path = _write(
            [
                _tool_use("2026-09-05T10:00:05Z", "t1", "Bash", {"command": "pytest -q"}),
                _tool_result("2026-09-05T10:00:06Z", "t1", "ok", None),
                _tool_result("2026-09-05T10:01:40Z", "t1", "ok", None),
            ]
        )
        [ev] = digest.load_claude_code_events(path)
        self.assertEqual(ev.result_ts, digest._ts("2026-09-05T10:00:06Z"))


if __name__ == "__main__":
    unittest.main()
