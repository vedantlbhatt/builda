"""python3 -m unittest capture.tests.test_dry_run

`--dry-run` prints every byte that would be sent and sends nothing — the command the
privacy page tells people to run. Proven against a listening server that records every
request: after a dry run its log is empty. The live-snapshot limiter and the
`/v1/sync/known` skip are exercised against the same server.

Two transcripts: a boundary fixture (two finished sittings, dated 2026-03) and a
synthetic one whose last record is seconds old, which is the only way to have a session
the clock still calls live.
"""

from __future__ import annotations

import contextlib
import datetime as dt
import io
import json
import os
import pathlib
import shutil
import tempfile
import time
import unittest

from capture import cli
from capture import client as cl
from capture.tests._fake_server import FakeBuilder

ROOT = pathlib.Path(__file__).resolve().parents[2]
FIX = ROOT / "spec" / "fixtures" / "boundaries"
UUID = "00000000-0000-4000-8000-000000000001"
UUID_LIVE = "00000000-0000-4000-8000-000000000002"


def _iso(ts: float) -> str:
    return dt.datetime.fromtimestamp(ts, dt.UTC).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def write_live_transcript(path: pathlib.Path, now: float, seconds: int = 400) -> None:
    """A sitting that started `seconds` ago and is still going: one remote prompt, then
    agent chatter every 8 s (with usage and unique message ids) up to a moment ago."""
    recs = []
    t = now - seconds
    recs.append(
        {
            "type": "user",
            "uuid": "u-0",
            "parentUuid": None,
            "sessionId": UUID_LIVE,
            "timestamp": _iso(t),
            "cwd": "/nonexistent/proj",
            "promptSource": "sdk",
            "origin": {"kind": "human"},
            "message": {"role": "user", "content": "go"},
        }
    )
    n = 0
    t += 5
    while t < now - 2:
        n += 1
        recs.append(
            {
                "type": "assistant",
                "uuid": f"a-{n}",
                "parentUuid": "u-0" if n == 1 else f"a-{n - 1}",
                "sessionId": UUID_LIVE,
                "timestamp": _iso(t),
                "cwd": "/nonexistent/proj",
                "message": {
                    "role": "assistant",
                    "model": "claude-sonnet-5",
                    "id": f"msg_{n}",
                    "content": [{"type": "tool_use", "id": f"tu_{n}", "name": "Bash", "input": {}}],
                    "usage": {"input_tokens": 10, "output_tokens": 3},
                },
            }
        )
        t += 8
    path.write_text("".join(json.dumps(r, separators=(",", ":")) + "\n" for r in recs))


class _Harness(unittest.TestCase):
    """Two transcripts under a temporary root, a fake server, and paired credentials."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = pathlib.Path(self.tmp.name)
        # An empty HOME, so the other harnesses' default stores (`~/.codex`, `~/.gemini`,
        # ...) are this test's and hold nothing. Without it the test described the machine
        # it ran on: on a Mac with real Codex rollouts, "two finished sittings and one
        # live" came back as seven and one, and six tests failed for a reason that was
        # not in the code.
        self._home = os.environ.get("HOME")
        os.environ["HOME"] = str(base / "home")
        self.root = base / "projects"
        proj = self.root / "-Users-dev-proj"
        proj.mkdir(parents=True)
        shutil.copy(FIX / "attended_afternoon_then_gap.jsonl", proj / f"{UUID}.jsonl")
        live = self.root / "-Users-dev-live"
        live.mkdir()
        write_live_transcript(live / f"{UUID_LIVE}.jsonl", time.time())
        self.creds = base / "builder" / "credentials.json"
        os.environ["BUILDER_CREDENTIALS"] = str(self.creds)
        os.environ["BUILDER_TZ"] = "America/New_York"
        self.server = FakeBuilder()
        self.url = self.server.start()
        access, refresh = self.server.seed()
        cl.write_private_json(
            self.creds,
            {
                "server": self.url,
                "machine_id": "m" * 64,
                "access_token": access,
                "refresh_token": refresh,
            },
        )

    def tearDown(self):
        self.server.stop()
        self.tmp.cleanup()
        if self._home is None:
            os.environ.pop("HOME", None)
        else:
            os.environ["HOME"] = self._home
        os.environ.pop("BUILDER_CREDENTIALS", None)
        os.environ.pop("BUILDER_TZ", None)
        os.environ.pop("BUILDER_CAPTURE_KEY", None)

    def _run(self, *args) -> tuple[int, str, str]:
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = cli.main(["sync", "--root", str(self.root), "--server", self.url, *args])
        return rc, out.getvalue(), err.getvalue()


class DryRun(_Harness):
    def test_dry_run_prints_the_payloads_and_sends_nothing(self):
        rc, out, err = self._run("--dry-run", "--live")
        self.assertEqual(rc, 0)
        doc = json.loads(out)
        states = sorted(p["state"] for p in doc["sessions"])
        self.assertEqual(states, ["final", "final", "live"])
        self.assertIn("Nothing was", err)
        self.assertEqual(self.server.requests, [], "a dry run must not touch the network")

    def test_open_session_is_skipped_without_live(self):
        _, out, err = self._run("--dry-run")
        doc = json.loads(out)
        self.assertEqual([p["state"] for p in doc["sessions"]], ["final", "final"])
        self.assertIn("1 open (skipped; pass --live)", err)

    def test_finalize_turns_the_open_session_final(self):
        _, out, _ = self._run("--dry-run", "--finalize")
        doc = json.loads(out)
        self.assertEqual([p["state"] for p in doc["sessions"]], ["final"] * 3)
        self.assertTrue(all(p["end_reason"] == "idle_gap" for p in doc["sessions"]))

    def test_real_sync_uploads_then_is_up_to_date(self):
        rc, out, err = self._run("--live")
        self.assertEqual(rc, 0, err)
        self.assertEqual(len(self.server.uploads), 1)
        sent = self.server.uploads[0]
        self.assertEqual(sorted(p["state"] for p in sent), ["final", "final", "live"])
        rc, out, err = self._run("--live")
        self.assertEqual(rc, 0)
        self.assertEqual(len(self.server.uploads), 1, "known hashes skip the re-send")
        self.assertIn("Already up to date", out)

    def test_live_snapshot_is_rate_limited_per_session(self):
        """Inside liveUploadMinIntervalSec the live snapshot is not re-sent even when the
        server has forgotten it (a lost server row must not turn into a burst)."""
        self._run("--live")
        self.server.known.clear()
        self._run("--live")
        self.assertEqual(len(self.server.uploads), 2)
        self.assertEqual([p["state"] for p in self.server.uploads[1]], ["final", "final"])
        state = json.loads(cl.state_path().read_text())
        self.assertEqual(len(state["live"]), 1)


class LiveBlock(_Harness):
    """`sync --live` (docs/overnight-integration.md 3.2): the live payload carries its live
    state, its names only with `--live-names`, and a hash that is the payload's WITHOUT
    them, so the block is resent on the live interval and never because the hash moved."""

    def live_payload(self, *args) -> dict:
        rc, out, err = self._run("--dry-run", "--live", *args)
        self.assertEqual(rc, 0, err)
        return next(p for p in json.loads(out)["sessions"] if p["state"] == "live")

    def test_sync_live_attaches_live_and_never_names_without_the_flag(self):
        p = self.live_payload()
        self.assertEqual(p["live"]["live_version"], 1)
        self.assertEqual(p["live"]["eta"]["reason"], "repo_unresolved")
        self.assertNotIn("live_names", p)
        named = self.live_payload("--live-names")
        self.assertIn("live_names", named)
        self.assertEqual(named["content_hash"], p["content_hash"], "the block is not in the hash")
        finals = [q for q in json.loads(self._run("--dry-run", "--live")[1])["sessions"] if q["state"] == "final"]
        self.assertTrue(finals and all("live" not in q for q in finals))

    def test_a_live_payload_is_resent_on_the_interval_although_its_hash_is_known(self):
        self._run("--live")
        [first] = [p for p in self.server.uploads[0] if p["state"] == "live"]
        # The server knows the hash, and the clock has moved past the live interval.
        state = json.loads(cl.state_path().read_text())
        for v in state["live"].values():
            v["at"] -= 61
        cl.write_private_json(cl.state_path(), state)
        self._run("--live")
        self.assertEqual(len(self.server.uploads), 2)
        [again] = self.server.uploads[1]
        self.assertEqual(again["client_session_id"], first["client_session_id"])
        self.assertIn("live", again)

    def test_the_map_salt_is_stable_across_runs_and_never_in_a_payload(self):
        from analysis import __main__ as analysis_cli
        from analysis import live

        from capture import identity

        a = identity.map_salt()
        path = self.creds.with_name("map-salt")
        self.assertEqual(path.read_text().strip(), a)
        self.assertEqual(oct(path.stat().st_mode & 0o777), oct(0o600))
        self.assertEqual(oct(path.parent.stat().st_mode & 0o777), oct(0o700))
        self.assertEqual(identity.map_salt(), a, "stable across runs")
        self.assertGreaterEqual(len(a), live.SALT_MIN_CHARS)
        self.assertEqual(analysis_cli._map_salt(), a, "`python -m analysis live` reads the same file")
        # The raw machine identifier is a fresh random UUID per call on a Mac; the salt is
        # not derived from it, or from anything hashed onto the wire.
        self.assertNotEqual(a, identity.sha256_hex("builder-map-salt:" + identity.raw_machine_identifier()))
        _, out, _ = self._run("--dry-run", "--live", "--live-names")
        self.assertNotIn(a, out)
        path.write_text("short\n")
        self.assertNotEqual(identity.map_salt(), "short", "a short salt is replaced, never used")


class CaptureKeySync(_Harness):
    """`sync` with a capture key: no credentials file, no pairing prompt, the summary says
    which key, and a revoked key is one line on stderr and exit 5 — never a retry."""

    KEY = "bck_" + "q" * 43

    def setUp(self):
        super().setUp()
        self.creds.unlink()  # this container was never paired

    def test_key_uploads_without_pairing_and_names_itself(self):
        self.server.valid_keys.add(self.KEY)
        os.environ["BUILDER_CAPTURE_KEY"] = self.KEY
        rc, out, err = self._run("--live")
        self.assertEqual(rc, 0, err)
        self.assertEqual(len(self.server.uploads), 1)
        self.assertIn("auth: capture key bck_qqqq… (no pairing needed)", out)
        self.assertNotIn(self.KEY, out + err, "the summary names the prefix, never the key")
        self.assertNotIn("Not paired", out + err)
        self.assertFalse(self.creds.exists(), "a key never creates a credentials file")
        tokens = {t for _, _, _, t in self.server.requests}
        self.assertEqual(tokens, {self.KEY})
        self.assertNotIn("/v1/auth/refresh", [p for _, p, _, _ in self.server.requests])

    def test_flag_beats_env(self):
        flag_key = "bck_" + "z" * 43
        self.server.valid_keys.add(flag_key)
        os.environ["BUILDER_CAPTURE_KEY"] = self.KEY  # not valid on the server
        rc, out, err = self._run("--live", "--key", flag_key)
        self.assertEqual(rc, 0, err)
        self.assertEqual({t for _, _, _, t in self.server.requests}, {flag_key})

    def test_revoked_key_is_one_line_exit_5_no_retry(self):
        os.environ["BUILDER_CAPTURE_KEY"] = self.KEY  # never added to valid_keys: revoked
        rc, out, err = self._run("--live")
        self.assertEqual(rc, 5)
        lines = [line for line in err.splitlines() if line.strip()]
        self.assertEqual(len(lines), 1, err)
        self.assertIn("bck_qqqq", lines[0])
        self.assertIn("rejected", lines[0])
        self.assertNotIn(self.KEY, err)
        # /known 401s first; nothing is retried and no upload is attempted after it.
        self.assertEqual([p for _, p, _, _ in self.server.requests], ["/v1/sync/known"])
        self.assertEqual(self.server.uploads, [])

    def test_malformed_key_fails_before_any_request(self):
        os.environ["BUILDER_CAPTURE_KEY"] = "R-this-is-a-refresh-token"
        rc, out, err = self._run("--live")
        self.assertEqual(rc, 5)
        self.assertIn("does not look like a capture key", err)
        self.assertEqual(self.server.requests, [])

    def test_dry_run_with_a_key_still_sends_nothing(self):
        os.environ["BUILDER_CAPTURE_KEY"] = self.KEY
        rc, out, err = self._run("--dry-run", "--live")
        self.assertEqual(rc, 0)
        self.assertEqual(self.server.requests, [])
        self.assertIn("auth: capture key bck_qqqq…", err)


if __name__ == "__main__":
    unittest.main()
