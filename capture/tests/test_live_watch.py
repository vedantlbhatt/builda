"""python3 -m unittest capture.tests.test_live_watch

`python -m capture live` does what the Claude Code hook does, from a terminal: it posts
each running transcript's new complete lines to the hook's own route, and the server cuts
them with the pipeline both channels share (docs/overnight-integration.md section 4).

Against a real HTTP listener (`_fake_server.FakeBuilder`, which holds bytes per session and
answers a gap with 409 the way `routes/ingest.py` does), and a transcript that is appended
to between ticks. The rules pinned here each guard a way a watcher silently loses or
corrupts a transcript: a partial trailing line posted and then half repeated, a 409 that
never resumes, an offset kept where an installed hook would move it, a quiet agent whose
"waiting on you for N minutes" never advances.
"""

from __future__ import annotations

import contextlib
import datetime as dt
import gzip
import io
import json
import os
import pathlib
import re
import stat
import tempfile
import unittest

from capture import cli, watch
from capture import client as cl
from capture.tests._fake_server import FakeBuilder

ROOT = pathlib.Path(__file__).resolve().parents[2]
SID = "8f7c2a4e-0000-4000-8000-00000000abcd"
PROJECT = "-Users-me-repo"


def line(i: int, pad: int = 0) -> bytes:
    rec = {"type": "user", "uuid": f"u-{i}", "timestamp": "2026-09-13T07:00:00.000Z", "x": "y" * pad}
    return (json.dumps(rec) + "\n").encode()


class _Watch(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = pathlib.Path(self.tmp.name)
        self.creds = base / "builder" / "credentials.json"
        os.environ["BUILDER_CREDENTIALS"] = str(self.creds)
        self.server = FakeBuilder()
        self.url = self.server.start()
        access, refresh = self.server.seed()
        cl.write_private_json(
            self.creds, {"server": self.url, "machine_id": "m" * 64, "access_token": access, "refresh_token": refresh}
        )
        self.path = base / "projects" / PROJECT / f"{SID}.jsonl"
        self.path.parent.mkdir(parents=True)
        self.now = 1_789_300_000.0
        self.said: list[str] = []
        self.w = watch.Watcher(
            cl.Client(self.url),
            tz=dt.timezone(dt.timedelta(hours=-4)),
            heartbeat=30.0,
            clock=lambda: self.now,
            say=self.said.append,
        )

    def tearDown(self):
        self.server.stop()
        self.tmp.cleanup()
        os.environ.pop("BUILDER_CREDENTIALS", None)

    def append(self, data: bytes) -> None:
        with open(self.path, "ab") as f:
            f.write(data)

    def posts(self) -> list[tuple[dict, bytes]]:
        return self.server.ingest_posts


class CompleteLinesOnly(_Watch):
    def test_the_watcher_sends_only_complete_lines(self):
        """CLAUDE.md, the first trap: the last line is routinely half written. It waits for
        its newline and is then sent whole, once."""
        half = line(2)[:20]
        self.append(line(1) + half)
        self.w.tick([self.path])
        self.assertEqual(self.posts()[-1][1], line(1))
        self.assertEqual(self.server.chunks[SID], line(1))
        self.append(line(2)[20:] + line(3))
        self.now += 5
        self.w.tick([self.path])
        self.assertEqual(self.posts()[-1][1], line(2) + line(3))
        self.assertEqual(self.server.chunks[SID], self.path.read_bytes())
        self.assertEqual(self.w.load_offset(SID), len(self.path.read_bytes()))

    def test_nothing_new_and_no_heartbeat_due_posts_nothing(self):
        self.append(line(1))
        self.w.tick([self.path])
        self.now += 10
        self.assertEqual(self.w.tick([self.path]), [])
        self.assertEqual(len(self.posts()), 1)

    def test_a_replaced_file_is_resent_from_the_start(self):
        self.append(line(1) + line(2))
        self.w.tick([self.path])
        self.path.write_bytes(line(9))  # shorter than what was sent: a new file
        self.now += 5
        self.w.tick([self.path])
        headers, body = self.posts()[-1]
        self.assertEqual((headers["x-builder-offset"], body), ("0", line(9)))
        self.assertEqual(self.server.chunks[SID], line(9))


class Resume(_Watch):
    def test_a_409_resumes_from_the_servers_offset(self):
        """A stored offset ahead of what the server holds (the server lost a chunk, or the
        offset file came from another run): the route answers 409 with the byte it has,
        and the watcher resends from there, in the same tick."""
        self.append(line(1) + line(2) + line(3))
        self.server.chunks[SID] = line(1)
        self.w.store_offset(SID, len(line(1) + line(2)))
        self.w.tick([self.path])
        offsets = [h["x-builder-offset"] for h, _ in self.posts()]
        self.assertEqual(offsets, [str(len(line(1) + line(2))), str(len(line(1)))])
        self.assertEqual(self.posts()[-1][1], line(2) + line(3))
        self.assertEqual(self.server.chunks[SID], self.path.read_bytes())

    def test_the_offset_is_the_servers_and_lives_beside_the_credentials(self):
        self.append(line(1))
        self.w.tick([self.path])
        f = self.creds.parent / "live-offsets" / SID
        self.assertEqual(f.read_text().strip(), str(len(line(1))))
        self.assertEqual(stat.S_IMODE(f.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(f.parent.stat().st_mode), 0o700)
        self.assertNotIn(".builder/offsets", str(f), "never the hook script's own offsets")
        # A fresh watcher (a new run) picks up where the last one was.
        again = watch.Watcher(cl.Client(self.url), tz=dt.UTC, clock=lambda: self.now, say=self.said.append)
        self.append(line(2))
        again.tick([self.path])
        self.assertEqual(self.posts()[-1][0]["x-builder-offset"], str(len(line(1))))


class Heartbeat(_Watch):
    def test_an_idle_tick_sends_an_empty_heartbeat(self):
        """No new bytes for `heartbeat` seconds: an empty post at the current offset, so the
        server re-cuts on its own clock and "waiting on you for N minutes" advances."""
        self.append(line(1))
        self.w.tick([self.path])
        self.now += 29
        self.w.tick([self.path])
        self.assertEqual(len(self.posts()), 1, "not due yet")
        self.now += 1
        self.w.tick([self.path])
        headers, body = self.posts()[-1]
        self.assertEqual((body, headers["x-builder-offset"]), (b"", str(len(line(1)))))
        self.assertEqual(self.server.chunks[SID], line(1), "a heartbeat appends nothing")
        self.now += 30
        self.w.tick([self.path])
        self.assertEqual(len(self.posts()), 3)


class Headers(_Watch):
    def test_the_watcher_posts_the_hook_headers_to_the_hook_route(self):
        """Exactly what `hook.sh` sends (routes/ingest.py HOOK_SCRIPT), with the watcher's
        own hook name, so the route treats it as the hook channel it is."""
        opened: list = []
        real = cl.Client(self.url)

        def opener(req, timeout=60):
            opened.append(req)
            return real._open(req, timeout=timeout)

        w = watch.Watcher(cl.Client(self.url, opener=opener), tz=dt.timezone(dt.timedelta(hours=-4)), clock=lambda: self.now, say=self.said.append)
        self.append(line(1))
        w.tick([self.path])
        [req] = opened
        self.assertEqual(req.full_url, self.url + "/v1/ingest/transcript")
        self.assertEqual(req.get_method(), "POST")
        h = {k.lower(): v for k, v in req.header_items()}
        self.assertEqual(h["x-builder-session-id"], SID)
        self.assertEqual(h["x-builder-project-dir"], PROJECT)
        self.assertEqual(h["x-builder-offset"], "0")
        self.assertEqual(h["x-builder-hook"], "Watch")
        self.assertEqual(h["x-builder-tz-offset-minutes"], "-240")
        self.assertTrue(h["authorization"].startswith("Bearer "))
        self.assertNotIn("content-encoding", h)
        route = (ROOT / "server" / "builder" / "routes" / "ingest.py").read_text()
        for name in ("X-Builder-Session-Id", "X-Builder-Project-Dir", "X-Builder-Offset", "X-Builder-Hook", "X-Builder-Tz-Offset-Minutes"):
            self.assertIn(name, route, "the hook script sends every header the watcher does")

    def test_a_tail_of_64_kb_and_up_is_gzipped(self):
        big = b"".join(line(i, pad=200) for i in range(400))
        self.assertGreaterEqual(len(big), cl.GZIP_MIN_BYTES)
        self.append(big)
        self.w.tick([self.path])
        headers, body = self.posts()[-1]
        self.assertEqual(headers.get("content-encoding"), "gzip")
        self.assertEqual(body, big, "the route inflates it to exactly the lines")
        self.assertLess(int(headers["content-length"]), len(big))
        self.assertEqual(gzip.decompress(gzip.compress(big)), big)

    def test_a_capture_key_posts_without_pairing(self):
        key = "bck_" + "k" * 43
        self.server.valid_keys.add(key)
        self.creds.unlink()
        w = watch.Watcher(cl.Client(self.url, key=key), tz=dt.UTC, clock=lambda: self.now, say=self.said.append)
        self.append(line(1))
        w.tick([self.path])
        self.assertEqual(self.server.chunks[SID], line(1))
        self.assertNotIn("/v1/auth/refresh", [p for _, p, _, _ in self.server.requests])

    def test_the_route_limits_are_the_routes(self):
        route = (ROOT / "server" / "builder" / "routes" / "ingest.py").read_text()
        m = re.search(r"^MAX_BYTES = (.+)$", route, re.M)
        self.assertEqual(eval(m.group(1), {}), watch.MAX_POST_BYTES)  # noqa: S307 - our own source
        m = re.search(r'^_SAFE = re\.compile\(r"(.+)"\)$', route, re.M)
        self.assertEqual(m.group(1), cli._SAFE_NAME)
        self.assertEqual(watch.HOOK_NAME, "Watch")


class TheLine(_Watch):
    def test_one_line_per_post_says_what_the_server_made_of_it(self):
        self.server.ingest_live = [
            {"client_session_id": "c" * 64, "sentence": "Handing work to three helper agents", "needs_you": {"score": 5, "reason": "running_fine"}}
        ]
        self.append(line(1))
        self.w.tick([self.path])
        n = len(line(1))
        self.assertEqual(self.said, [f"{SID[:8]}  +{n:,} B  live  Handing work to three helper agents  needs you 5"])

    def test_every_answer_shape_reads_without_a_dash(self):
        cases = [
            {"live": [{"sentence": None, "needs_you": None}]},
            {"live": 2, "final": 1},
            {"live": [], "final": 3},
            {"live": []},
            {"live": [], "rejected": [{"client_session_id": "d" * 64, "reason": "live on a final payload"}]},
        ]
        dash = re.compile("[—–]|\\s-{1,2}\\s")
        for r in cases:
            for text in watch.describe(SID, 18204, r):
                self.assertIsNone(dash.search(text), text)
                self.assertTrue(text.lstrip().startswith((SID[:8], "rejected")), text)
        self.assertEqual(watch.describe(SID, 0, {"live": [], "final": 3}), [f"{SID[:8]}  +0 B  nothing running  3 final"])
        # Nothing visible is said as that: too small yet and retired look the same from here.
        self.assertEqual(watch.describe(SID, 0, {"live": []}), [f"{SID[:8]}  +0 B  no visible session"])
        self.assertEqual(watch.describe(SID, 9, {"live": []}), [f"{SID[:8]}  +9 B  no visible session"])


class Command(_Watch):
    def run_cli(self, *args) -> tuple[int, str, str]:
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = cli.main(["live", "--server", self.url, *args])
        return rc, out.getvalue(), err.getvalue()

    def test_live_once_posts_the_transcript_through_the_route(self):
        self.append(line(1) + line(2))
        rc, out, err = self.run_cli("--transcript", str(self.path), "--once")
        self.assertEqual(rc, 0, err)
        self.assertEqual(self.server.chunks[SID], line(1) + line(2))
        self.assertIn(f"{SID[:8]}  +{len(line(1) + line(2)):,} B", out)
        self.assertIn("watching 1 transcript, every 5 s", err)

    def test_a_transcript_somewhere_else_is_refused_before_any_post(self):
        odd = self.path.parent / "not a session.jsonl"
        odd.write_bytes(line(1))
        rc, _, err = self.run_cli("--transcript", str(odd), "--once")
        self.assertEqual(rc, 1)
        self.assertIn("not where Claude Code keeps a transcript", err)
        missing = self.run_cli("--transcript", str(self.path.parent / "gone.jsonl"), "--once")
        self.assertEqual(missing[0], 1)
        self.assertEqual(self.server.ingest_posts, [])

    def test_every_and_heartbeat_must_be_positive(self):
        self.assertEqual(self.run_cli("--every", "0", "--once")[0], 2)
        self.assertEqual(self.run_cli("--heartbeat", "-1", "--once")[0], 2)
        self.assertEqual(self.run_cli("--for", "0")[0], 2)

    def test_for_stops_after_the_tick_that_reaches_it(self):
        self.append(line(1))
        slept: list[float] = []

        def sleep(s):
            slept.append(s)
            self.now += s

        rc = watch.run(
            cl.Client(self.url), transcripts=[self.path], root=self.path.parent, tz=dt.UTC, every=5.0,
            heartbeat=30.0, once=False, until=self.now + 12, sleep=sleep, clock=lambda: self.now, say=self.said.append,
        )
        # Ticks at +0, +5, +10 and +15; the one at +15 is the first to reach +12, and the last.
        self.assertEqual((rc, slept), (0, [5.0, 5.0, 5.0]))


if __name__ == "__main__":
    unittest.main()
