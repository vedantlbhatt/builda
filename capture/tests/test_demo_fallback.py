"""python3 -m unittest capture.tests.test_demo_fallback

Stage 6 (docs/demos.md): when the project will not run, real pictures, each labelled with where
it came from: the last good capture (`previous`), then images already in the checkout
(`checkout`), then images a Claude Code session read (`transcript`). Never a generated picture:
with none of the three the demo is refused, and no manifest is written. The end to end cases run
`python -m capture demo` itself over a fixture repository, with Vision replaced by a stub (no
simulator, no network, no Vision in a test).
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import pathlib
import tempfile
import unittest
from unittest import mock

from capture import cli
from capture.demo import fallback as fb
from capture.demo import manifest as mf
from capture.demo import paths
from capture.demo import project as pj
from capture.tests import _demo_fixtures as fx


class Labels(unittest.TestCase):
    def test_plain_words_from_a_file_name(self):
        self.assertEqual(fb.label_from_name("08-clough-directions.png"), "clough directions")
        self.assertEqual(fb.label_from_name("03_Clough_Selected@2x.PNG"), "clough selected 2x")
        self.assertEqual(fb.label_from_name("final-43.png"), fb.NEUTRAL_LABEL)
        self.assertEqual(fb.label_from_name("3f9a0c1b2d4e5f60.png"), fb.NEUTRAL_LABEL)  # an id is not a label
        self.assertEqual(fb.label_from_name("Screenshot 2026-09-14 at 9.41.00 AM.png"), "at am")


class CheckoutImages(unittest.TestCase):
    def test_readme_images_first_then_device_screenshots_then_the_rest(self):
        with tempfile.TemporaryDirectory() as t:
            top = pathlib.Path(t).resolve()
            fx.write(top, {
                "README.md": "# x\n![the map](docs/map-view.png)\n<img src=\"https://cdn.example/remote.png\">\n",
                "docs/map-view.png": fx.png(900, 600),
                "shots/ads-template.png": fx.png(1440, 2996),
                "shots/results-list.png": fx.png(1179, 2556),
                "shots/final-3.png": fx.png(1179, 2556),
                "shots/icon.png": fx.png(64, 64),
            })  # fmt: skip
            got = [(p.name, label) for p, label in fb.checkout_images(top, "expo_ios")]
        self.assertEqual(got[0], ("map-view.png", "map view"))
        # A real device screenshot with a name that says what it shows, then one without, then
        # the phone shaped template; the icon is too small to be a screen.
        self.assertEqual([n for n, _ in got[1:]], ["results-list.png", "final-3.png", "ads-template.png"])
        self.assertNotIn("icon.png", [n for n, _ in got])

    def test_one_picture_per_label_first(self):
        # The fourth RideGT run's fallback: six takes of one effect, glow-25 to glow-30.
        with tempfile.TemporaryDirectory() as t:
            top = pathlib.Path(t).resolve()
            fx.write(top, {**{f"shots/glow-{i}.png": fx.png(1179, 2556) for i in range(5)},
                           "shots/clough-directions.png": fx.png(1179, 2556), "shots/results.png": fx.png(1179, 2556)})  # fmt: skip
            labels = [label for _, label in fb.checkout_images(top, "expo_ios", limit=3)]
        self.assertEqual(sorted(labels), ["clough directions", "glow", "results"])

    def test_the_limit(self):
        with tempfile.TemporaryDirectory() as t:
            top = pathlib.Path(t).resolve()
            fx.write(top, {f"screenshots/s{i}.png": fx.png(400, 800) for i in range(9)})
            self.assertEqual(len(fb.checkout_images(top, "web")), 6)

    def test_transcript_images_only_when_still_on_disk(self):
        with tempfile.TemporaryDirectory() as t:
            p = pathlib.Path(t) / "shot.png"
            p.write_bytes(fx.png(400, 800))
            got = fb.transcript_images([(str(p), 2.0), (str(pathlib.Path(t) / "gone.png"), 1.0)])
        self.assertEqual([x.name for x, _ in got], ["shot.png"])


class LastGood(unittest.TestCase):
    def test_a_clean_capture_is_kept_and_a_refused_one_is_not(self):
        with tempfile.TemporaryDirectory() as t:
            work, out = pathlib.Path(t) / "work", pathlib.Path(t) / "out"
            out.mkdir()
            (out / "still-01.png").write_bytes(fx.png(40, 80))
            m = mf.build("b" * 64, "web", "c1", "2026-09-14T00:00:00Z", [mf.image_asset("still-01.png", 40, 80, 1, "the home page", "capture")], [])
            refused = {**m, "privacy": {**m["privacy"], "refused": [{"file": "still-01.png"}]}}
            fb.keep_last_good(work, out, refused)
            self.assertIsNone(fb.last_good(work))
            fb.keep_last_good(work, out, m)
            data, d = fb.last_good(work)
            self.assertEqual(data, m)
            self.assertTrue((d / "still-01.png").exists())


class EndToEnd(unittest.TestCase):
    """`python -m capture demo` over a repository that cannot run."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = pathlib.Path(self.tmp.name).resolve()
        self.env = mock.patch.dict(os.environ, {"BUILDER_DEMOS_DIR": str(base / "demos")})
        self.env.start()
        self.top = fx.repo(base / "shop", {
            "notes.md": "no manifest, no entry point: nothing here runs\n",
            "shots/cart-page.png": fx.png(1179, 2556),
            "shots/checkout-done.png": fx.png(1179, 2556),
        })  # fmt: skip
        self.key = pj.from_checkout(self.top).key
        self.checked = []
        self.prints: dict[str, int] = {}

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def run_demo(self, refused=()):
        def fake_check(stills, video, names, poster=None, other_names=()):
            self.checked.append(([p.name for p in stills], tuple(names)))
            return list(refused), len(stills)

        def fake_prints(paths):
            # Distinct pictures unless a test says otherwise (no helper, no Vision in a test).
            return [self.prints.get(p.name, (1 << (40 * i)) - 1) for i, p in enumerate(paths, 1)]  # 40 bits apart

        err, out = io.StringIO(), io.StringIO()
        with mock.patch("capture.demo.privacy.check", fake_check), mock.patch("capture.demo.pictures.fingerprints", fake_prints), \
                contextlib.redirect_stderr(err), contextlib.redirect_stdout(out):  # fmt: skip
            rc = cli.main(["demo", str(self.top), "--no-transcripts"])
        return rc, out.getvalue() + err.getvalue()

    def test_images_in_the_checkout_labelled_checkout(self):
        rc, text = self.run_demo()
        self.assertEqual(rc, 0, text)
        m = json.loads((paths.out_dir(self.key) / "manifest.json").read_text())
        self.assertEqual(mf.validate(m, paths.out_dir(self.key)), [])
        self.assertEqual([(a["file"], a["source"], a["label"]) for a in m["assets"]],
                         [("still-01.png", "checkout", "cart page"), ("still-02.png", "checkout", "checkout done")])  # fmt: skip
        self.assertEqual(m["project_key"], self.key)
        self.assertEqual(m["privacy"], {"checked": True, "engine": "vision", "refused": []})
        # Every still went through the check, with the repository's names and this Mac's own
        # names (so a /Users/<name>/ path on screen is refused too, the review's item 7).
        from capture.demo import privacy

        files, names = self.checked[0]
        self.assertEqual(files, ["still-01.png", "still-02.png"])
        self.assertEqual(names[:3], ("acme/widget", "widget", "shop"))
        self.assertTrue(set(privacy.machine_names()).issubset(set(names)))
        self.assertIn("no run command found", text)
        self.assertFalse(any(c in text for c in ("—", "–")), text)

    def test_the_same_picture_is_never_kept_twice(self):
        self.prints = {"still-01.png": 0xABCDEF, "still-02.png": 0xABCDEF ^ 0b111}  # 3 bits apart
        rc, text = self.run_demo()
        self.assertEqual(rc, 0, text)
        m = json.loads((paths.out_dir(self.key) / "manifest.json").read_text())
        self.assertEqual([(a["file"], a["position"]) for a in m["assets"]], [("still-01.png", 1)])
        self.assertIn("is the same picture as still-01.png", text)
        self.assertFalse((paths.out_dir(self.key) / "still-02.png").exists())

    def test_the_last_good_capture_comes_first_labelled_previous(self):
        work = paths.work_dir(self.key)
        good = paths.private_dir(work / "last-good")
        (good / "still-01.png").write_bytes(fx.png(40, 80))
        prev = mf.build(self.key, "web", "0ld", "2026-09-01T00:00:00Z", [mf.image_asset("still-01.png", 40, 80, 1, "the home page", "capture")], [])
        (good / "manifest.json").write_text(json.dumps(prev))
        rc, text = self.run_demo()
        self.assertEqual(rc, 0, text)
        m = json.loads((paths.out_dir(self.key) / "manifest.json").read_text())
        self.assertEqual([(a["source"], a["label"]) for a in m["assets"]], [("previous", "the home page")])
        self.assertEqual((m["commit"], m["taken_at"], m["kind"]), ("0ld", "2026-09-01T00:00:00Z", "web"))

    def test_a_refusal_is_written_down_and_the_exit_says_so(self):
        finding = {"file": "still-01.png", "box": {"x": 1, "y": 2, "width": 3, "height": 4}, "reason": "repo_name", "text": "shop"}
        rc, text = self.run_demo(refused=[finding])
        self.assertEqual(rc, 3)
        m = json.loads((paths.out_dir(self.key) / "manifest.json").read_text())
        self.assertEqual(m["privacy"]["refused"], [finding])
        self.assertIn("REFUSED", text)
        self.assertIn("x 1, y 2, 3 by 4", text)

    def test_nothing_to_show_is_refused_and_nothing_is_invented(self):
        for p in (self.top / "shots").iterdir():
            p.unlink()
        rc, text = self.run_demo()
        self.assertEqual(rc, 1)
        self.assertIn("nothing was invented", text)
        self.assertFalse((paths.out_dir(self.key) / "manifest.json").exists())

    def test_plan_runs_nothing(self):
        err, out = io.StringIO(), io.StringIO()
        with contextlib.redirect_stderr(err), contextlib.redirect_stdout(out):
            rc = cli.main(["demo", str(self.top), "--plan", "--no-transcripts"])
        self.assertEqual(rc, 0)
        self.assertIn("Refused: no run command found", out.getvalue())
        self.assertFalse(paths.demos_dir().exists() and any(paths.demos_dir().iterdir()))


if __name__ == "__main__":
    unittest.main()


class Pictures(unittest.TestCase):
    def test_distinct_names_the_earlier_picture_each_repeats(self):
        from capture.demo import pictures

        a, b = 0, (1 << 200) - 1  # 200 bits apart: two screens
        near = a ^ 0b1011  # 3 bits from a: the same screen, drifting
        self.assertEqual(pictures.distinct([a, b, near, b ^ 1]), [None, None, 0, 1])
        self.assertTrue(pictures.same_picture(a, a ^ ((1 << pictures.SAME_PICTURE_BITS) - 1)))
        self.assertFalse(pictures.same_picture(a, a ^ ((1 << (pictures.SAME_PICTURE_BITS + 1)) - 1)))
