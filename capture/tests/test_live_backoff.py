"""python3 -m unittest capture.tests.test_live_backoff

`python -m capture live` against a server that fails, and against a transcript too big for
one post. Both used to be retried on every tick: FOUND IN REVIEW (2026-09-13), a server
answering 500 to one 6.9 MB transcript was sent it 12 times a minute, and a tail over
`MAX_POST_BYTES` was read in full and reported again on every tick. The stand in clients
here count what the watcher sends; nothing listens on a socket.
"""

from __future__ import annotations

import datetime as dt
import json
import pathlib
import tempfile
import unittest

from capture import client as cl
from capture import watch

SID = "8f7c2a4e-0000-4000-8000-00000000abcd"


class Failing:
    """A server that answers 500 to every post until `healthy` is set."""

    def __init__(self):
        self.calls = 0
        self.bytes = 0
        self.healthy = False

    def post_transcript(self, sid, pdir, offset, body, hook, tz):
        self.calls += 1
        self.bytes += len(body)
        if not self.healthy:
            raise cl.HTTPFailure(500, "Internal Server Error")
        return {"next_offset": offset + len(body), "live": [], "final": 0}

    def transcript_offset(self, sid):
        return 0


class _Case(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        base = pathlib.Path(self.tmp.name)
        self.path = base / "proj" / f"{SID}.jsonl"
        self.path.parent.mkdir()
        self.now = 0.0
        self.said: list[str] = []
        self.offsets = base / "offsets"

    def watcher(self, client) -> watch.Watcher:
        return watch.Watcher(
            client, tz=dt.UTC, heartbeat=30.0, clock=lambda: self.now, say=self.said.append, offsets=self.offsets
        )

    def run_for(self, w: watch.Watcher, seconds: float, every: float = 5.0) -> None:
        end = self.now + seconds
        while self.now < end:
            w.tick([self.path])
            self.now += every


class Backoff(_Case):
    def test_a_failing_server_is_tried_less_and_less_often(self):
        """MEASURED with this test's own shape (a 6.9 MB transcript, `--every 5`, a server
        answering 500): before the fix 12 posts and 89,092,800 bytes in the first minute
        and 720 posts in an hour; after it 4 posts (29,697,600 bytes) in the first minute
        and 17 in the hour, the waits running 5, 10, 20, 40, 80, 160 and then 300 s."""
        rec = json.dumps({"type": "user", "uuid": "u", "timestamp": "2026-09-13T07:00:00Z", "x": "y" * 1000}) + "\n"
        self.path.write_text(rec * 6900)
        server = Failing()
        w = self.watcher(server)
        self.run_for(w, 60)
        self.assertEqual((server.calls, server.bytes), (4, 4 * len(rec) * 6900))
        self.run_for(w, 3600 - 60)
        self.assertEqual(server.calls, 17)
        self.assertEqual(
            [watch.backoff(k) for k in range(1, 9)], [5.0, 10.0, 20.0, 40.0, 80.0, 160.0, 300.0, 300.0]
        )
        # Every failed try says so once, with when the next one is, and no dash.
        self.assertEqual(len(self.said), server.calls)
        self.assertIn("trying again in 300 s", self.said[-1])

    def test_a_server_that_recovers_is_posted_to_and_the_wait_starts_over(self):
        self.path.write_text(json.dumps({"type": "user", "uuid": "u", "timestamp": "2026-09-13T07:00:00Z"}) + "\n")
        server = Failing()
        w = self.watcher(server)
        self.run_for(w, 400)  # well into the 300 s ceiling
        tried = server.calls
        server.healthy = True
        self.run_for(w, 300)
        self.assertGreater(server.calls, tried, "the recovered server was posted to")
        t = w.tails[self.path]
        self.assertEqual((t.failures, t.retry_at), (0, None))
        self.assertEqual(t.offset, self.path.stat().st_size, "the tail went through")

    def test_a_week_of_failures_still_waits_the_ceiling(self):
        self.assertEqual(watch.backoff(10_000), watch.BACKOFF_MAX_SEC)


class Oversize(_Case):
    def setUp(self):
        super().setUp()
        saved = watch.MAX_POST_BYTES
        watch.MAX_POST_BYTES = 1000  # stands in for 64 MB, so the file is small
        self.addCleanup(setattr, watch, "MAX_POST_BYTES", saved)
        reads = self.reads = []
        real = watch.complete_tail

        def counted(path, offset):
            reads.append(offset)
            return real(path, offset)

        watch.complete_tail = counted
        self.addCleanup(setattr, watch, "complete_tail", real)

    def test_a_tail_too_big_for_one_post_is_reported_once_and_not_read_again(self):
        """MEASURED with this test's shape (5,500 B of lines against a 1,000 B limit, 24
        ticks at 5 s, a line appended half way): before the fix the tail was read 24 times
        and the same line printed 24 times; after it, read once and said once. It only
        grows, so it is not read again while the file is at least that size."""
        self.path.write_text((json.dumps({"x": "y" * 100}) + "\n") * 50)
        server = Failing()
        w = self.watcher(server)
        self.run_for(w, 60)
        with open(self.path, "a") as f:
            f.write(json.dumps({"x": "z"}) + "\n")
        self.run_for(w, 60)
        self.assertEqual((server.calls, len(self.reads), len(self.said)), (0, 1, 1))
        self.assertIn("not read again unless the file is replaced", self.said[0])

    def test_a_replaced_smaller_file_is_read_and_sent_again(self):
        self.path.write_text((json.dumps({"x": "y" * 100}) + "\n") * 50)
        server = Failing()
        server.healthy = True
        w = self.watcher(server)
        self.run_for(w, 10)
        self.assertEqual(server.calls, 0)
        self.path.write_text(json.dumps({"x": "y"}) + "\n")
        self.run_for(w, 5)
        self.assertEqual(server.calls, 1)
        self.assertIsNone(w.tails[self.path].oversize_at)


if __name__ == "__main__":
    unittest.main()
