"""python3 -m unittest capture.tests.test_demo_manifest

Stage 7 (docs/demos.md): the manifest the publish side reads, EXACTLY its shape both ways, with
sizes read from the files, the contract's caps, and a `project_key` that IS the key the phone's
Projects screen uses: the repository's salted hash every session upload carries as `repo_hash`.
"""

from __future__ import annotations

import json
import pathlib
import tempfile
import unittest

from capture import identity, repo
from capture.demo import manifest as mf
from capture.demo import project as pj
from capture.tests import _demo_fixtures as fx
from capture.tuning import REPO_HASH_PREFIX, REPO_PEPPER

KEY = "a" * 64


def good(d: pathlib.Path) -> dict:
    (d / "still-01.png").write_bytes(fx.png(40, 80))
    (d / "still-02.jpg").write_bytes(fx.jpeg_header(30, 60))
    (d / "demo.mp4").write_bytes(b"\x00\x00\x00\x18ftypisom" + b"\x00" * 64)
    (d / "poster.jpg").write_bytes(fx.jpeg_header(40, 80))
    assets = [
        mf.image_asset("still-01.png", 40, 80, 1, "the session page, the call chart", "capture"),
        mf.image_asset("still-02.jpg", 30, 60, 2, "the Projects tab", "capture"),
        mf.video_asset("demo.mp4", 40, 80, 18000, "a pass through the app", "poster.jpg", "capture"),
    ]
    return mf.build(KEY, "expo_ios", "c0ffee", "2026-09-14T06:12:00Z", assets, [])


class Shape(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.d = pathlib.Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_exactly_the_published_shape(self):
        m = good(self.d)
        self.assertEqual(mf.validate(m, self.d), [])
        self.assertEqual(set(m), {"version", "project_key", "kind", "commit", "taken_at", "assets", "privacy"})
        self.assertEqual(m["privacy"], {"checked": True, "engine": "vision", "refused": []})
        still, _, video = m["assets"]
        self.assertEqual(still, {"file": "still-01.png", "kind": "image", "content_type": "image/png", "width": 40, "height": 80,
                                 "position": 1, "label": "the session page, the call chart", "source": "capture"})  # fmt: skip
        self.assertEqual(set(video), {"file", "kind", "content_type", "width", "height", "duration_ms", "position", "label", "poster", "source"})
        self.assertEqual((video["position"], video["content_type"]), (0, "video/mp4"))
        path = mf.write(self.d, m)
        self.assertEqual(json.loads(path.read_text()), m)

    def test_a_key_added_or_missing_is_a_problem(self):
        m = good(self.d)
        m["extra"] = 1
        self.assertTrue(mf.validate(m))
        m = good(self.d)
        del m["assets"][0]["label"]
        self.assertTrue(mf.validate(m))
        m = good(self.d)
        m["assets"][0]["note"] = "x"
        self.assertTrue(mf.validate(m))

    def test_the_writer_refuses_a_wrong_manifest(self):
        m = good(self.d)
        m["assets"][0]["width"] = 41  # not what the file says
        with self.assertRaisesRegex(ValueError, "size differs"):
            mf.write(self.d, m)
        self.assertFalse((self.d / "manifest.json").exists())

    def test_sources_positions_and_the_video(self):
        m = good(self.d)
        m["assets"][0]["source"] = "generated"
        self.assertIn("source", " ".join(mf.validate(m)))
        m = good(self.d)
        m["assets"][1]["position"] = 5
        self.assertIn("positions", " ".join(mf.validate(m)))
        m = good(self.d)
        m["assets"].append(dict(m["assets"][2]))
        self.assertIn("more than one video", " ".join(mf.validate(m)))

    def test_the_contract_caps(self):
        cap = mf.caps()
        m = good(self.d)
        m["assets"][2]["duration_ms"] = cap["video_ms"] + 1
        self.assertIn("duration_ms", " ".join(mf.validate(m)))
        m = good(self.d)
        m["assets"][0]["height"] = cap["pixels"] + 1
        self.assertIn("height", " ".join(mf.validate(m)))
        (self.d / "big.png").write_bytes(fx.png(4, 4) + b"\x00" * (cap["image_bytes"] + 1))
        m = good(self.d)
        m["assets"][0] = mf.image_asset("big.png", 4, 4, 1, "a picture", "checkout")
        self.assertIn("byte cap", " ".join(mf.validate(m, self.d)))
        m = good(self.d)
        m["assets"] = [mf.image_asset(f"s{i}.png", 4, 4, i, "a picture", "capture") for i in range(1, cap["images"] + 2)]
        self.assertIn("at most", " ".join(mf.validate(m)))

    def test_a_label_the_publish_side_would_refuse_is_refused_here(self):
        m = good(self.d)
        m["assets"][0]["label"] = "the item/[id] page"
        self.assertIn("label", " ".join(mf.validate(m)))

    def test_sizes_come_from_the_files(self):
        (self.d / "a.png").write_bytes(fx.png(1206, 3))
        self.assertEqual(mf.image_size(self.d / "a.png"), (1206, 3))
        (self.d / "b.jpg").write_bytes(fx.jpeg_header(640, 1136))
        self.assertEqual(mf.image_size(self.d / "b.jpg"), (640, 1136))
        (self.d / "c.gif").write_bytes(b"GIF89a")
        with self.assertRaises(ValueError):
            mf.image_size(self.d / "c.gif")
        with self.assertRaises(ValueError):
            mf.content_type("x.webp")

    def test_taken_at_is_iso_utc(self):
        import datetime as dt

        self.assertEqual(mf.taken_at(dt.datetime(2026, 9, 14, 2, 12, tzinfo=dt.timezone(dt.timedelta(hours=-4)))), "2026-09-14T06:12:00Z")


class ProjectKey(unittest.TestCase):
    """The key is the phone's: `RepoIdentity.hash`, the `repo_hash` of every session upload."""

    def test_a_checkout_is_keyed_by_its_origin_like_its_sessions(self):
        with tempfile.TemporaryDirectory() as t:
            root = fx.repo(pathlib.Path(t).resolve() / "RideGT", {"a.txt": "a"}, origin="git@github.com:VedantLBhatt/gt-transit.git")
            p = pj.from_checkout(root / ".")
            self.assertEqual(p.key, repo.identity_for(str(root)).hash)
            self.assertEqual(p.key, identity.repo_hash("github.com/vedantlbhatt/gt-transit", REPO_PEPPER, REPO_HASH_PREFIX))
            self.assertEqual(p.names, ("vedantlbhatt/gt-transit", "gt-transit", "RideGT"))
            # The same repository named by URL is the same project.
            self.assertEqual(pj.from_url("https://github.com/vedantlbhatt/gt-transit").key, p.key)
            self.assertEqual(pj.from_url("https://token@github.com/VedantLBhatt/gt-transit.git").key, p.key)

    def test_a_repository_with_no_origin_is_keyed_by_its_root_commit(self):
        with tempfile.TemporaryDirectory() as t:
            root = fx.repo(pathlib.Path(t).resolve() / "local", {"a.txt": "a"}, origin=None)
            p = pj.from_checkout(root)
            self.assertTrue(p.identity.startswith("localroot:"))
            self.assertEqual(p.key, repo.identity_for(str(root)).hash)
            self.assertEqual(p.names, ("local",))

    def test_urls_that_are_not_a_repository_are_refused(self):
        for bad in ("http://github.com/a/b", "https://example.com/a/b", "file:///etc", "https://github.com/a"):
            with self.assertRaises(pj.ProjectError, msg=bad):
                pj.from_url(bad)

    def test_not_a_repository(self):
        with tempfile.TemporaryDirectory() as t, self.assertRaises(pj.ProjectError):
            pj.from_checkout(t)


class Paths(unittest.TestCase):
    def test_the_demos_dir_is_overridable_and_a_key_cannot_walk_out(self):
        import os
        from unittest import mock

        from capture.demo import paths

        with mock.patch.dict(os.environ, {"BUILDER_DEMOS_DIR": "/tmp/x-demos"}):
            self.assertEqual(paths.out_dir(KEY), pathlib.Path("/tmp/x-demos") / KEY)
            self.assertEqual(paths.work_dir(KEY), pathlib.Path("/tmp/x-demos/work") / KEY)
            with self.assertRaises(ValueError):
                paths.out_dir("../../etc")


if __name__ == "__main__":
    unittest.main()
