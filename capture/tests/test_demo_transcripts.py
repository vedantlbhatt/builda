"""python3 -m unittest capture.tests.test_demo_transcripts

The commands a project's own Claude Code transcripts ran, through capture's reader and its
repository resolver (no second parser): which worked, which failed, where each ran, what a `cd`
inside a line changes, and that a command the digest cut short is never offered.
"""

from __future__ import annotations

import datetime as dt
import json
import pathlib
import tempfile
import unittest

from capture.demo import transcripts as tx
from capture.demo.project import from_checkout
from capture.tests import _demo_fixtures as fx


def _iso(ts: float) -> str:
    return dt.datetime.fromtimestamp(ts, dt.UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


class Transcript:
    """A root transcript built call by call: a Bash tool_use, then its result."""

    def __init__(self, sid: str):
        self.sid = sid
        self.recs: list[dict] = []
        self.t = fx.T0
        self.n = 0

    def call(self, command: str, cwd: str, error: bool = False, tool: str = "Bash", path: str | None = None) -> None:
        self.n += 1
        tid = f"tu_{self.n}"
        inp = {"command": command} if tool == "Bash" else {"file_path": path}
        self.recs.append({
            "type": "assistant", "uuid": f"a{self.n}", "parentUuid": None, "sessionId": self.sid,
            "timestamp": _iso(self.t), "cwd": cwd,
            "message": {"role": "assistant", "model": "claude-x", "id": f"m{self.n}",
                        "content": [{"type": "tool_use", "id": tid, "name": tool, "input": inp}]},
        })  # fmt: skip
        self.t += 3
        self.recs.append({
            "type": "user", "uuid": f"r{self.n}", "parentUuid": f"a{self.n}", "sessionId": self.sid,
            "timestamp": _iso(self.t), "cwd": cwd,
            "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": tid,
                        "content": "Error: it broke" if error else "ok", "is_error": error}]},
        })  # fmt: skip
        self.t += 3

    def write(self, path: pathlib.Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("".join(json.dumps(r) + "\n" for r in self.recs))


class Harvest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        base = pathlib.Path(cls.tmp.name).resolve()
        cls.app = fx.repo(base / "app", {"mobile/package.json": "{}", "backend/main.py": ""}, origin="https://github.com/acme/app.git")
        cls.other = fx.repo(base / "other", {"x.txt": "x"}, origin="https://github.com/acme/secret-thing.git")
        root = base / "projects"
        t = Transcript("11111111-1111-4111-8111-111111111111")
        app = str(cls.app)
        t.call("cd mobile && bun install", app)
        t.call("bun install 2>&1", f"{app}/mobile")
        t.call("npx expo run:ios --device X", f"{app}/mobile", error=True)
        t.call("npx expo run:ios --device X", f"{app}/mobile")
        t.call("cd backend\npython -m uvicorn main:app --port 5001 > /tmp/log 2>&1", app)
        t.call("ls", str(cls.other))  # another repository's command: not this project's
        t.call("cd /tmp && make", app)  # a cd out of the checkout ends the line's commands
        t.call("npm test " + "x" * 200, app)  # the digest cuts it: the tail is gone
        t.call("", app, tool="Read", path=f"{app}/shots/home.png")
        # A sitting that started at home and cd'd in is still this project's, record by record.
        t.write(root / "-home" / "11111111-1111-4111-8111-111111111111.jsonl")
        cls.project = from_checkout(cls.app)
        cls.ev = tx.harvest(cls.project.identity, root)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def row(self, command: str, subdir: str):
        return next((s for s in self.ev.commands if s.command == command and s.subdir == subdir), None)

    def test_a_cd_inside_the_line_moves_the_command(self):
        r = self.row("bun install", "mobile")
        self.assertIsNotNone(r)
        # `cd mobile && bun install` from the top and `bun install 2>&1` inside mobile/ are one
        # row: redirections change nothing about what ran.
        self.assertEqual((r.ok, r.failed), (2, 0))

    def test_worked_and_failed_are_counted_apart(self):
        r = self.row("npx expo run:ios --device X", "mobile")
        self.assertEqual((r.ok, r.failed), (1, 1))

    def test_a_multi_line_command_is_split_and_its_redirection_dropped(self):
        self.assertIsNotNone(self.row("python -m uvicorn main:app --port 5001", "backend"))

    def test_other_repositories_are_not_this_projects_commands_but_are_named(self):
        self.assertIsNone(next((s for s in self.ev.commands if s.command == "ls"), None))
        self.assertEqual([i for i, _ in self.ev.others], ["github.com/acme/secret-thing"])

    def test_a_cd_out_of_the_checkout_ends_the_line(self):
        self.assertIsNone(next((s for s in self.ev.commands if s.command == "make"), None))

    def test_a_command_the_digest_cut_is_never_offered(self):
        self.assertFalse([s for s in self.ev.commands if s.command.startswith("npm test")])

    def test_images_the_sessions_read_are_kept_for_the_fallback(self):
        self.assertEqual([p for p, _ in self.ev.images], [f"{self.app}/shots/home.png"])

    def test_counts(self):
        self.assertEqual((self.ev.transcripts_read, self.ev.transcripts_matched), (1, 1))

    def test_normalize(self):
        self.assertEqual(tx.normalize("npm  run dev 2>&1 > out.txt"), "npm run dev")
        self.assertEqual(tx.normalize("pod install &>/dev/null"), "pod install")


if __name__ == "__main__":
    unittest.main()
