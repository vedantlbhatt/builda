"""python3 -m unittest capture.tests.test_demo_publish

`python -m capture demo --publish` and `--delete` (capture/demo_publish.py, docs/demos.md):
the only way a project's demo leaves the Mac. Every guarantee here is about what does NOT go:
nothing without a yes, nothing the privacy check refused or never checked, nothing the
contract's `project_media` section does not declare (the commit SHA, the file names, the
manifest's `taken_at` and `kind`), no bearer to an upload URL, and never with a capture key.
So each test reads the fake server's request log, not the command's own account of itself.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import pathlib
import struct
import subprocess
import tempfile
import unittest
import zlib

from capture import cli, demo_publish, identity
from capture import client as cl
from capture.tests._fake_server import FakeBuilder
from capture.tuning import REPO_HASH_PREFIX, REPO_PEPPER

ROOT = pathlib.Path(__file__).resolve().parents[2]
CONTRACT = json.loads((ROOT / "privacy" / "upload-contract.json").read_text())
KEY = "3f" * 32
SHA = "9c1e0b7d" * 5


def png(w: int, h: int) -> bytes:
    def chunk(t: bytes, d: bytes) -> bytes:
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + bytes((x * 7 + y) % 256 for x in range(w * 3)) for y in range(h))
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def jpeg(w: int, h: int) -> bytes:
    """Enough of a JPEG for its size to be read: SOI, a JFIF segment, a baseline SOF, EOI."""
    app0 = b"\xff\xe0" + struct.pack(">H", 16) + b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    sof = b"\xff\xc0" + struct.pack(">HBHHB", 11, 8, h, w, 1) + b"\x01\x11\x00"
    return b"\xff\xd8" + app0 + sof + b"\x00" * 64 + b"\xff\xd9"


def mp4(duration_ms: int, timescale: int = 600) -> bytes:
    """An `ftyp`, a `moov` holding an `mvhd` (version 0) and some `mdat`."""
    ftyp = b"ftypisom" + struct.pack(">I", 512) + b"isomiso2"
    mvhd = b"\x00\x00\x00\x00" + struct.pack(">IIII", 0, 0, timescale, duration_ms * timescale // 1000)
    mvhd += b"\x00" * 80
    box = lambda kind, body: struct.pack(">I", len(body) + 8) + kind + body  # noqa: E731
    return box(b"ftyp", ftyp[4:]) + box(b"moov", box(b"mvhd", mvhd)) + box(b"mdat", b"\x01" * 2048)


def manifest(assets: list[dict], **privacy) -> dict:
    return {
        "version": 1,
        "project_key": KEY,
        "kind": "expo_ios",
        "commit": SHA,
        "taken_at": "2026-09-14T03:00:00Z",
        "assets": assets,
        "privacy": {"checked": True, "engine": "vision", "refused": [], **privacy},
    }


def still(name: str, pos: int, label: str = "the session page, scrolled to the chart", **kw) -> dict:
    return {
        "file": name,
        "kind": "image",
        "content_type": "image/png",
        "width": 24,
        "height": 52,
        "position": pos,
        "label": label,
        "source": "capture",
        **kw,
    }


VIDEO = {
    "file": "demo.mp4",
    "kind": "video",
    "content_type": "video/mp4",
    "width": 1206,
    "height": 2622,
    "duration_ms": 18000,
    "position": 0,
    "label": "a pass through the app",
    "poster": "poster.jpg",
    "source": "capture",
}


class _Demo(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = pathlib.Path(self.tmp.name)
        self._env = {k: os.environ.get(k) for k in ("HOME", "BUILDER_CREDENTIALS", "BUILDER_DEMOS_DIR", "BUILDER_CAPTURE_KEY", "BUILDER_CAPTURE_EXCLUDE")}
        os.environ["HOME"] = str(base / "home")
        os.environ["BUILDER_DEMOS_DIR"] = str(base / "demos")
        self.creds = base / "builder" / "credentials.json"
        os.environ["BUILDER_CREDENTIALS"] = str(self.creds)
        for k in ("BUILDER_CAPTURE_KEY", "BUILDER_CAPTURE_EXCLUDE"):
            os.environ.pop(k, None)
        self.server = FakeBuilder()
        self.url = self.server.start()
        access, refresh = self.server.seed()
        cl.write_private_json(
            self.creds, {"server": self.url, "machine_id": "m" * 64, "access_token": access, "refresh_token": refresh}
        )
        self.dir = base / "demos" / KEY
        self.dir.mkdir(parents=True)
        self.files = {
            "still-01.png": png(24, 52),
            "still-02.png": png(24, 52),
            "demo.mp4": mp4(18000),
            "poster.jpg": jpeg(1206, 2622),
        }
        for name, data in self.files.items():
            (self.dir / name).write_bytes(data)
        self.write(manifest([VIDEO, still("still-01.png", 1), still("still-02.png", 2)]))

    def tearDown(self):
        self.server.stop()
        self.tmp.cleanup()
        for k, v in self._env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def write(self, m: dict) -> None:
        (self.dir / "manifest.json").write_text(json.dumps(m))

    def run_cli(self, *args: str) -> tuple[int, str, str]:
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = cli.main(["demo", *args, "--key", KEY, "--server", self.url])
        return rc, out.getvalue(), err.getvalue()

    def sent(self, prefix: str) -> list:
        return [r for r in self.server.requests if r[1].startswith(prefix)]


class Publish(_Demo):
    def test_a_yes_presigns_each_file_before_its_upload_then_commits_them_all(self):
        rc, out, err = self.run_cli("--publish", "--yes")
        self.assertEqual(rc, 0, out + err)
        paths = [p for _, p, _, _ in self.server.requests]
        kinds = [
            "presign" if p.endswith("media:presign") else "put" if p.startswith("/v1/media-upload/")
            else "commit" if p.endswith(":commit") else "other"
            for p in paths
        ]  # fmt: skip
        # The video and its poster, then each still: presign, upload, presign, upload... and
        # only then every commit. A URL is made right before the one upload it is for, so it
        # lives only as long as that upload needs (the security review, 2026-09-14).
        self.assertEqual(
            kinds,
            ["presign", "put", "put", "presign", "put", "presign", "put", "commit", "commit", "commit"],
        )

        # The bytes went exactly as they are on disk, to the URL, with no bearer.
        got = {path.rsplit("/", 1)[1]: (body, headers, token) for path, headers, body, token in self.server.media_uploads}
        mids = {r["body"]["label"]: mid for mid, r in self.server.media.items()}
        video = mids["a pass through the app"]
        self.assertEqual(got[video][0], self.files["demo.mp4"])
        self.assertEqual(got[f"{video}-poster"][0], self.files["poster.jpg"])
        self.assertEqual(got[video][1]["content-type"], "video/mp4")
        for body, headers, token in got.values():
            self.assertIsNone(token, "a bearer never goes to an upload URL")
            self.assertNotIn("authorization", headers)
            self.assertEqual(int(headers["content-length"]), len(body))

        # What each presign carried: the contract's fields, nothing else from the manifest.
        bodies = [b for _, p, b, _ in self.server.requests if p.endswith("media:presign")]
        declared = [f["name"] for f in CONTRACT["project_media"]["fields"]]
        for b in bodies:
            self.assertEqual(sorted(b), sorted(declared))
            text = json.dumps(b)
            for private in (SHA, "2026-09-14T03:00:00Z", "expo_ios", "still-01", "demo.mp4", "poster.jpg"):
                self.assertNotIn(private, text)
        self.assertEqual(len({b["publish_id"] for b in bodies}), 1, "one publish, one id")
        v = next(b for b in bodies if b["kind"] == "video")
        self.assertEqual(v["poster"], {"content_type": "image/jpeg", "bytes": len(self.files["poster.jpg"])})
        self.assertEqual((v["duration_ms"], v["bytes"]), (18000, len(self.files["demo.mp4"])))

        total = sum(len(d) for d in self.files.values())
        self.assertIn(f"One video and two images: four files, {total:,} bytes", out)
        self.assertIn("Not the file names, not the commit it was taken at", out)
        self.assertIn("Published one video and two images", out)
        self.assertIn("This is the first demo of this project on the server.", out)
        self.assertTrue(all(r["committed"] for r in self.server.media.values()))

    def test_publishing_again_replaces_and_says_how_many(self):
        self.assertEqual(self.run_cli("--publish", "--yes")[0], 0)
        self.write(manifest([still("still-01.png", 1)]))
        rc, out, _ = self.run_cli("--publish", "--yes")
        self.assertEqual(rc, 0)
        self.assertIn("It replaced the demo that was there (three items on the phone).", out)
        self.assertEqual(len(self.server.media), 1)

    def test_no_video_sends_the_stills_and_replaces_the_video(self):
        # The owner, 2026-09-14: "just screenshots for now".
        self.assertEqual(self.run_cli("--publish", "--yes")[0], 0)
        rc, out, _ = self.run_cli("--publish", "--yes", "--no-video")
        self.assertEqual(rc, 0, out)
        self.assertIn("Published two images", out)
        self.assertEqual(sorted(r["body"]["kind"] for r in self.server.media.values()), ["image", "image"])
        self.write(manifest([VIDEO]))
        rc, _, err = self.run_cli("--publish", "--yes", "--no-video")
        self.assertEqual(rc, 2)
        self.assertIn("no stills to send without its video", err)

    def test_without_a_terminal_or_a_yes_nothing_is_sent(self):
        rc, out, err = self.run_cli("--publish")
        self.assertEqual(rc, 1)
        self.assertIn("pass --yes", err)
        self.assertIn("four files", out, "it still says what it would have sent")
        self.assertEqual(self.sent("/v1/projects/"), [])

    def test_the_numbers_are_the_files_own(self):
        """A manifest that disagrees with its pictures cannot put a wrong number on the phone."""
        self.write(manifest([still("still-01.png", 1, width=1206, height=2622), dict(VIDEO, duration_ms=25000)]))
        rc, out, err = self.run_cli("--publish", "--yes")
        self.assertEqual(rc, 0, err)
        bodies = {b["kind"]: b for _, p, b, _ in self.server.requests if p.endswith("media:presign")}
        self.assertEqual((bodies["image"]["width"], bodies["image"]["height"]), (24, 52))
        self.assertEqual(bodies["video"]["duration_ms"], 18000)
        self.assertIn("the manifest says 1206x2622 and the file is 24x52", out)
        self.assertIn("the manifest says 25000 ms and the file is 18000 ms", out)

    def test_an_expired_token_is_refreshed_and_rotated(self):
        self.server.expire_access()
        rc, out, err = self.run_cli("--publish", "--yes")
        self.assertEqual(rc, 0, out + err)
        self.assertEqual(json.loads(self.creds.read_text())["access_token"], "A2")
        self.assertEqual(self.server.reuse_detected, 0)

    def test_a_publish_that_fails_part_way_says_the_old_demo_still_shows(self):
        self.server.media_upload_status = [204, 500]
        rc, _, err = self.run_cli("--publish", "--yes")
        self.assertEqual(rc, 4)
        self.assertIn("Nothing of it was committed, so the demo on the server is still the one", err)
        self.assertEqual(self.sent("/v1/projects/" + KEY + "/media/"), [], "nothing committed")

    def test_a_lost_commit_answer_says_it_cannot_tell_and_how_to_look(self):
        """The last commit is the one that replaces, and its answer can be lost after the
        server acted on it: this side must not say the old demo still shows."""
        self.server.media_commit_fails_at = 3  # the last of three: the one that replaces
        self.server.media_commit_acts_anyway = True
        rc, _, err = self.run_cli("--publish", "--yes")
        self.assertEqual(rc, 4)
        self.assertIn("This Mac cannot tell whether the server finished it", err)
        self.assertIn(f"`python -m capture demo --list --key {KEY}`", err)
        self.assertNotIn("still the one that was there", err)
        # And the command it names says what the server shows: here, the new demo.
        rc, out, _ = self.run_cli("--list")
        self.assertEqual(rc, 0)
        self.assertIn("The server shows this demo of project 3f3f3f3f3f3f:", out)
        self.assertIn('"a pass through the app"', out)
        self.assertIn('"the session page, scrolled to the chart"', out)

    def test_list_says_when_the_server_shows_no_demo(self):
        rc, out, _ = self.run_cli("--list")
        self.assertEqual((rc, out.strip()), (0, "The server shows no demo of project 3f3f3f3f3f3f."))


class Refusals(_Demo):
    def assert_refused(self, needle: str, *args: str) -> str:
        rc, out, err = self.run_cli("--publish", "--yes", *args)
        self.assertEqual(rc, 2, out + err)
        self.assertIn(needle, err)
        self.assertEqual([r for r in self.server.requests if "media" in r[1]], [], "nothing sent")
        return err

    def test_an_unchecked_demo_does_not_leave(self):
        m = manifest([still("still-01.png", 1)])
        m["privacy"]["checked"] = False
        self.write(m)
        self.assert_refused("the privacy check has not run on this demo")
        del m["privacy"]
        self.write(m)
        self.assert_refused("the privacy check has not run on this demo")

    def test_a_refused_demo_says_which_file_and_why(self):
        refused = [
            {"file": "the session page", "box": {"x": 1, "y": 2, "width": 3, "height": 4},
             "reason": "the repository's name", "text": "secret-repo"},
        ]  # fmt: skip
        self.write(manifest([still("still-01.png", 1)], refused=refused))
        err = self.assert_refused("the privacy check refused this demo: the session page: the repository's name")
        self.assertNotIn("secret-repo", err)

    def test_every_file_is_checked_against_the_contract(self):
        big = self.dir / "big.png"
        big.write_bytes(png(8, 8) + b"\x00" * (6 * 1024 * 1024))
        (self.dir / "fake.png").write_bytes(b"<html>" + b" " * 100)
        (self.dir / "long.mp4").write_bytes(mp4(40000))
        cases = [
            (still("still-01.png", 1, label="the sign-in screen"), "it may not carry '-'"),
            (still("still-01.png", 1, label="src/app/page"), "it may not carry '/'"),
            (still("still-01.png", 1, label="x" * 81), "at most 80 characters"),
            (still("big.png", 1), "big.png is 6,291,"),
            (still("fake.png", 1), "fake.png does not start like image/png"),
            (still("still-01.png", 1, content_type="image/gif"), "'image/gif' is not one of"),
            (still("still-01.png", 1, source="generated"), "source 'generated'"),
            (still("../../etc/passwd", 1), "is not a file name in the demo's directory"),
            (still("missing.png", 1), "missing.png is not a file in"),
            (dict(VIDEO, file="long.mp4"), "long.mp4 is 40.0 s"),
            (still("still-01.png", 1, duration_ms=100), "an image has no duration or poster"),
        ]
        for asset, needle in cases:
            with self.subTest(needle=needle):
                self.write(manifest([asset]))
                self.assert_refused(needle)

    def test_counts_positions_and_the_project(self):
        self.write(manifest([still("still-01.png", i) for i in range(1, 10)]))
        self.assert_refused("the demo has 9 stills; one publish sends at most 8")
        self.write(manifest([still("still-01.png", 1), still("still-02.png", 1)]))
        self.assert_refused("both at position 1")
        m = manifest([still("still-01.png", 1)])
        m["project_key"] = "ab" * 32
        self.write(m)
        self.assert_refused("is the demo of project abababababab, not 3f3f3f3f3f3f")
        (self.dir / "manifest.json").unlink()
        self.assert_refused("no demo for this project at")

    def test_an_excluded_repository_never_leaves(self):
        origin = "github.com/acme/secret"
        excluded = identity.repo_hash(origin, REPO_PEPPER, REPO_HASH_PREFIX)
        os.environ["BUILDER_CAPTURE_EXCLUDE"] = origin
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = cli.main(["demo", "--publish", "--yes", "--key", excluded, "--server", self.url])
        self.assertEqual(rc, 2)
        self.assertIn("BUILDER_CAPTURE_EXCLUDE names this project's repository", err.getvalue())
        self.assertEqual(self.server.requests, [])


class Auth(_Demo):
    def test_a_capture_key_is_never_what_publishes(self):
        """The server refuses a key on every demo route; this side never offers one. With a
        key in the environment and the Mac paired, the device token goes; with the key and
        no pairing, nothing goes and the sentence says why."""
        key = "bck_" + "k" * 43
        self.server.valid_keys.add(key)
        os.environ["BUILDER_CAPTURE_KEY"] = key
        rc, _, err = self.run_cli("--publish", "--yes")
        self.assertEqual(rc, 0, err)
        bearers = {t for _, p, _, t in self.server.requests if p.startswith("/v1/projects/")}
        self.assertEqual(bearers, {"A1"})

        self.server.requests.clear()
        self.creds.unlink()
        rc, _, err = self.run_cli("--publish", "--yes")
        self.assertEqual(rc, 3)
        self.assertIn("A capture key cannot publish or delete a demo", err)
        self.assertEqual(self.server.requests, [])

    def test_the_fake_refuses_a_key_on_a_demo_route_as_the_server_does(self):
        key = "bck_" + "k" * 43
        self.server.valid_keys.add(key)
        with self.assertRaises(cl.CaptureKeyRejected):
            cl.Client(self.url, key=key).media_delete(KEY)
        self.assertEqual(self.server.media, {})


class Delete(_Demo):
    def test_delete_asks_then_deletes_the_projects_published_demo(self):
        self.assertEqual(self.run_cli("--publish", "--yes")[0], 0)
        rc, out, err = self.run_cli("--delete")
        self.assertEqual(rc, 1, "no terminal, no --yes: nothing deleted")
        self.assertEqual(len(self.server.media), 3)
        rc, out, err = self.run_cli("--delete", "--yes")
        self.assertEqual(rc, 0, err)
        self.assertIn("Deleted this project's demo from the server (three items on the phone).", out)
        self.assertEqual(self.server.media, {})
        self.assertTrue((self.dir / "manifest.json").exists(), "the copy on this Mac is untouched")
        rc, out, _ = self.run_cli("--delete", "--yes")
        self.assertIn("The server held no demo of this project.", out)


class Wiring(unittest.TestCase):
    def test_only_publish_and_delete_are_this_modules(self):
        self.assertTrue(demo_publish.claims(["demo", "--publish"]))
        self.assertTrue(demo_publish.claims(["demo", "--key", KEY, "--delete"]))
        self.assertTrue(demo_publish.claims(["demo", "--list"]))
        self.assertFalse(demo_publish.claims(["demo", "."]), "making a demo is the generator's")
        self.assertFalse(demo_publish.claims(["sync", "--publish"]))

    def test_a_project_directory_resolves_to_its_repository_key(self):
        with tempfile.TemporaryDirectory() as d:
            subprocess.run(["git", "init", "-q", d], check=True)
            subprocess.run(["git", "-C", d, "remote", "add", "origin", "git@github.com:Acme/Demo.git"], check=True)
            want = identity.repo_hash("github.com/acme/demo", REPO_PEPPER, REPO_HASH_PREFIX)
            self.assertEqual(demo_publish.resolve_key(d, None), want)
            with self.assertRaises(demo_publish.Refused):
                demo_publish.resolve_key(None, "not a key")

    def test_the_restated_constants_are_the_contracts_both_ways(self):
        m = CONTRACT["project_media"]
        self.assertEqual(
            demo_publish.CONTENT_TYPES,
            {t: (v["kind"], v["max_bytes"]) for t, v in m["content_types"].items()},
        )
        self.assertEqual(list(demo_publish.POSTER_TYPES), m["enums"]["poster_content_type"])
        self.assertEqual(list(demo_publish.KINDS), m["enums"]["media_kind"])
        self.assertEqual(list(demo_publish.SOURCES), m["enums"]["media_source"])
        self.assertEqual(
            (demo_publish.MAX_IMAGES, demo_publish.MAX_VIDEOS, demo_publish.MAX_VIDEO_MS,
             demo_publish.MAX_PIXELS, demo_publish.LABEL_WORD),
            (m["caps"]["images"], m["caps"]["videos"], m["caps"]["video_ms"],
             m["caps"]["pixels"], m["caps"]["label_word"]),
        )  # fmt: skip
        self.assertEqual(demo_publish.LABEL_MAX, m["max_lengths"]["label"])
        self.assertEqual(demo_publish.LABEL_PATTERN, m["label_pattern"])
        self.assertEqual(list(demo_publish.PRESIGN_FIELDS), [f["name"] for f in m["fields"]])
        position = next(f for f in m["fields"] if f["name"] == "position")
        self.assertTrue(position["doc"].startswith(f"0-{demo_publish.MAX_POSITION}:"))

    def test_the_label_rule_is_the_servers_sentence_for_sentence(self):
        """Refused here with the words the server would use, so a label never fails as a 422
        after the other files were presigned. The server module is read as text: capture runs
        where FastAPI is not installed."""
        src = (ROOT / "server" / "builder" / "project_media.py").read_text()
        for sentence in (
            "a label says what the screen shows; this one is empty",
            "a label has single spaces between words and none at either end",
            "a label needs at least one word",
        ):
            self.assertIn(sentence, src)
            self.assertIn(sentence, pathlib.Path(demo_publish.__file__).read_text())
        for label, ok in (
            ("the session page, scrolled to the chart", True),
            ("Wrapped: the first card (sample)", True),
            ("the sign-in screen", False),
            ("the café", False),
            ("2026", False),
            ("an AKIAIOSFODNN7EXAMPLEKEYAB here", False),
        ):
            self.assertEqual(demo_publish.label_refusal(label) is None, ok, label)


if __name__ == "__main__":
    unittest.main()
