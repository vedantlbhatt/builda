"""python3 -m unittest capture.tests.test_shipkit

The device table and the ship kit (docs/ship-kit.md), every rule that can be held without a
simulator, ffmpeg or a model:

- the table: points times the panel's scale IS the pixels on every row, no two rows a capture could
  match both of, a capture of the wrong size refused with its code, the project's own simulator
  chosen from its transcripts;
- the frame: on EVERY row in EVERY format the drawn screen is the row's shape (the elongated phone,
  held arithmetically here and by the pixel probe on the Mac), inside the canvas, even sided;
- the motion: zoom about the tap, rings where taps are, a blank run found and a real screen not;
- the poster: taken from a hold, never a crossfade, the fullest screen winning;
- the captions: every number checked strictly, a name refused, a platform's limit kept, the
  template made only of the input;
- the queue: a hook only writes a file, one job claimed once, the app files told from the rest;
- the pins: the kit's hues are the phone's, its ground and ink are design/tokens.json's.
"""

from __future__ import annotations

import io
import json
import os
import pathlib
import re
import tempfile
import types
import unittest
from unittest import mock

from capture.demo import compose, devices, storyboard
from capture.demo.result import BeatWindow, CaptureError
from capture.shipkit import cli as kcli
from capture.shipkit import copy as kcopy
from capture.shipkit import frame as fr
from capture.shipkit import kit as kmod
from capture.shipkit import queue as kq
from capture.shipkit import tables

ROOT = pathlib.Path(__file__).resolve().parents[2]
PHONES = [d for d in devices.DEVICES if d["family"] in ("iphone", "ipad")]


class DeviceTable(unittest.TestCase):
    def test_points_times_the_panel_scale_is_the_pixels_on_every_row(self):
        for d in devices.DEVICES:
            (pw, ph), sc, (xw, xh) = d["points"], d["native_scale"], d["pixels"]
            self.assertLessEqual(abs(pw * sc - xw), 2, d["id"])
            self.assertLessEqual(abs(ph * sc - xh), 2, d["id"])

    def test_the_mini_is_the_row_whose_panel_is_not_its_points(self):
        mini = devices.by_id("iphone-13-mini")
        self.assertEqual((mini["points"], mini["scale"], mini["pixels"]), ([375, 812], 3, [1080, 2340]))
        self.assertEqual(devices.match_pixels(1080, 2340)["id"], "iphone-13-mini")
        self.assertIsNone(devices.match_pixels(1125, 2436 + 60), "points times UIKit's scale is not the panel")

    def test_every_current_phone_the_brief_names_is_a_row(self):
        want = {
            "iphone-17-pro-max": (1320, 2868), "iphone-air": (1260, 2736), "iphone-17-pro": (1206, 2622),
            "iphone-16-plus": (1290, 2796), "iphone-16": (1179, 2556), "iphone-16e": (1170, 2532),
            "iphone-se": (750, 1334), "ipad-pro-13": (2064, 2752), "ipad-pro-11": (1668, 2420),
            "ipad-air-13": (2048, 2732), "ipad-air-11": (1640, 2360), "ipad-mini": (1488, 2266),
            "mac-1280": (2560, 1600), "mac-1440": (2880, 1800), "mac-1512": (3024, 1964), "mac-1728": (3456, 2234),
        }  # fmt: skip
        for rid, px in want.items():
            self.assertEqual(tuple(devices.by_id(rid)["pixels"]), px, rid)

    def test_a_capture_of_another_size_is_refused_with_its_code(self):
        row = devices.by_id("iphone-17-pro")
        devices.check_capture(row, 1206, 2623, "a web still a pixel taller")  # rounding passes
        with self.assertRaises(devices.DeviceError) as e:
            devices.check_capture(row, 1206, 2868, "still-01.png")
        self.assertEqual(e.exception.code, "frame_size_mismatch")
        self.assertIn("still-01.png", str(e.exception))
        with self.assertRaises(devices.DeviceError):
            devices.check_capture(row, 1320, 2868, "a Pro Max screenshot filed as a Pro")

    def test_match_pixels_finds_a_row_either_way_round_and_nothing_else(self):
        self.assertEqual(devices.match_pixels(1260, 2736)["id"], "iphone-air")
        self.assertEqual(devices.match_pixels(2736, 1260)["id"], "iphone-air")
        self.assertIsNone(devices.match_pixels(1440, 2996), "an ad template is no phone")

    def test_the_projects_own_simulator_is_chosen_from_its_transcripts(self):
        names = {"iPhone Air": "com.apple.CoreSimulator.SimDeviceType.iPhone-Air", "iPhone 16 Pro": "com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro"}
        seen = [
            types.SimpleNamespace(command="npx expo run:ios --device 'iPhone Air'", ok=5),
            types.SimpleNamespace(command="xcodebuild -destination 'platform=iOS Simulator,name=iPhone 16 Pro,OS=18.2'", ok=2),
            types.SimpleNamespace(command="xcrun simctl boot 'iPhone 16 Pro'", ok=0),
        ]  # fmt: skip
        row, why, ty = devices.choose_phone(seen, names=names)
        self.assertEqual((row["id"], ty), ("iphone-air", names["iPhone Air"]))
        self.assertIn("used 5 times", why)
        row, why, _ = devices.choose_phone([], names=names)
        self.assertEqual(row["id"], "iphone-17-pro")
        self.assertIn("default", why)
        row, _, _ = devices.choose_phone(seen, explicit="ipad-pro-13", names=names)
        self.assertEqual(row["id"], "ipad-pro-13")

    def test_simulators_in_reads_a_device_type_id_too(self):
        got = devices.simulators_in([types.SimpleNamespace(command="xcrun simctl create X com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro-Max", ok=1)])
        self.assertEqual(list(got), ["com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro-Max"])

    def test_a_storyboard_names_a_row_never_a_size(self):
        base = {"version": 1, "kind": "web", "beats": [{"label": "the home page", "actions": [{"open": "/"}]}] * 3}
        storyboard.validate({**base, "device": {"row": "iphone-air", "desktop": "mac-1440"}})
        with self.assertRaises(storyboard.StoryboardError):
            storyboard.validate({**base, "device": {"row": "iphone-9000"}})
        with self.assertRaises(storyboard.StoryboardError):
            storyboard.validate({**base, "device": {"desktop": "iphone-air"}})
        with self.assertRaises(storyboard.StoryboardError):
            storyboard.validate({**base, "viewport": {"width": 400, "height": 900}})
        storyboard.validate({**base, "viewport": {"width": 402, "height": 874}})

    def test_the_caption_sits_where_it_always_did_on_the_default_phone(self):
        # MEASURED: every demo before the table put the caption 11.5% up an iPhone 16 Pro.
        self.assertEqual(compose.caption_bottom(devices.default_phone()), 0.115)
        self.assertLess(compose.caption_bottom(devices.by_id("mac-1512")), 0.05, "no tab bar in a browser")

    def test_a_beat_keeps_its_tap_when_the_recording_realigns_it(self):
        """FOUND ON THE FIRST RIDEGT KIT (2026-09-19): the driver found both taps, `realign` built
        each beat again without them, and the kit drew no ring anywhere."""
        beats = [BeatWindow("a", None, 0.0, 2.0, still=pathlib.Path("a.png"), tap=(0.31, 0.16))]
        out = compose.realign(beats, [7, 7, 7, 7, 7, 7, 7, 7, 7, 7], [7], fps=5)
        self.assertEqual(out[0].tap, (0.31, 0.16))

    def test_the_timeline_is_computed_from_the_numbers_the_join_cuts_with(self):
        beats = [BeatWindow("a", None, 0, 1), BeatWindow("b", None, 0, 1, tap=(0.5, 0.8)), BeatWindow("c", None, 0, 1)]
        tl = compose.timeline(beats, [4.0, 5.0, 3.0], speed=1.0, pad=0.5)
        self.assertEqual([(b["start"], b["end"]) for b in tl], [(0.0, 4.0), (3.6, 8.6), (8.2, 11.7)])
        self.assertEqual(tl[1]["tap"], [0.5, 0.8])
        self.assertAlmostEqual(tl[-1]["end"], compose.total_length([4.0, 5.0, 3.0], 1.0, 0.5), places=6)


class Frame(unittest.TestCase):
    def test_every_row_in_every_format_is_drawn_at_its_own_shape(self):
        for d in devices.DEVICES + [None]:
            (dw, dh), _, _ = fr.screen_of(d)
            for f in devices.FORMATS:
                for title in (True, False):
                    lay = fr.layout(f, d, title)
                    name = f"{d['id'] if d else 'terminal'} in {f['id']}"
                    self.assertTrue(fr.aspect_ok((lay.w, lay.h), d), f"{name}: {lay.w}x{lay.h} is not {dw}x{dh}'s shape")
                    self.assertEqual((lay.w % 2, lay.h % 2), (0, 0), name)
                    self.assertTrue(0 <= lay.x and lay.x + lay.w <= lay.width and 0 <= lay.y and lay.y + lay.h <= lay.height, name)
                    if lay.title_box:
                        x, y, w, h = lay.title_box
                        self.assertTrue(x + w <= lay.width and y + h <= lay.height, name)

    def test_a_stretched_screen_is_not_the_devices_shape(self):
        pro = devices.by_id("iphone-17-pro")
        self.assertTrue(fr.aspect_ok((706, 1534), pro))
        self.assertFalse(fr.aspect_ok((706, 1620), pro), "5% taller: the elongated phone")
        self.assertFalse(fr.aspect_ok((740, 1534), pro))

    def test_bbox_measures_the_white_exactly(self):
        w, h = 20, 10
        buf = bytearray(w * h)
        for y in range(2, 8):
            for x in range(5, 15):
                buf[y * w + x] = 255
        buf[2 * w + 5] = 0  # a rounded corner trims a pixel, never a row
        self.assertEqual(fr.bbox(bytes(buf), w, h), (10, 6, 5, 2))
        self.assertIsNone(fr.bbox(bytes(w * h), w, h))

    def test_blank_runs_find_a_flat_stretch_and_not_one_flat_frame(self):
        self.assertEqual(fr.blank_runs([40, 2, 50, 40]), [], "one flat sample is a cut")
        self.assertEqual(fr.blank_runs([40, 2, 1, 3, 40], fps=4), [(0.25, 1.0)])

    def test_the_graph_zooms_about_the_tap_and_rings_it(self):
        lay = fr.layout(devices.fmt("vertical"), devices.default_phone(), True)
        tl = [{"start": 0, "end": 3.0, "tap": None}, {"start": 2.6, "end": 6.2, "tap": [0.25, 0.75]}]
        rings = fr.rings(tl, {1: 3.4})
        self.assertEqual([(r.at, r.x, r.y) for r in rings], [(3.1, 0.25, 0.75)], "just before the screen reacted")
        g = fr.filter_graph(lay, tl, rings)
        self.assertIn("alphamerge", g)
        self.assertIn("eval=frame", g)
        self.assertEqual(g.count("overlay="), 3, "the picture inside the screen, the device, then one ring")
        self.assertIn(f"[bg][dev]overlay=x={lay.x}:y={lay.y}:", g, "the device never moves or grows: only its picture does")
        z, x, y = fr.motion_exprs(lay, tl)
        self.assertEqual(z.count("clip("), 4, "two beats long enough to punch in, two clips each")
        self.assertIn(str(round(lay.w * 0.25 * fr.ZOOM, 3)), x, "x moves by the tap's share, so the tap stays put")
        self.assertEqual(fr.filter_graph(lay, [], []).count("eval=frame"), 0, "no beats: no zoom")
        bar = fr.status_bar_px(lay, devices.default_phone())
        self.assertEqual(bar, fr.even(lay.h * 62 / 874), "the row's 62 point top safe area, at the layout's scale")
        held = fr.filter_graph(lay, tl, rings, bar=bar)
        self.assertIn(f"crop={lay.w}:{bar}:0:0", held, "the status bar and the island are held still")
        self.assertIn("[zc][bar]overlay=x=0:y=0", held, "and laid over the punched in picture")
        self.assertEqual(fr.status_bar_px(lay, devices.by_id("mac-1512")), 0, "a browser window has no status bar")

    def test_the_change_measured_on_the_beats_own_clip_wins(self):
        """The finished video's first 0.4 s of a beat is a crossfade; a change inside it can only
        be seen on the beat's own clip, which the capture measured (`compose.first_change`)."""
        tl = [{"start": 5.7, "end": 10.0, "tap": [0.88, 0.8], "change": 6.0}]
        self.assertEqual([r.at for r in fr.rings(tl, {0: 6.5})], [5.75], "the clip's 6.0 less the lead, never before the beat")
        self.assertEqual([r.at for r in fr.rings([{**tl[0], "change": None}], {0: 6.5})], [6.2])

    def test_a_ring_without_a_measured_change_lands_after_the_crossfade(self):
        rings = fr.rings([{"start": 0, "end": 3, "tap": [0.5, 0.5]}, {"start": 2.6, "end": 5, "tap": [0.1, 0.9]}])
        self.assertEqual([r.at for r in rings], [0.1, 3.05])


class Poster(unittest.TestCase):
    def test_the_poster_comes_from_a_hold_never_a_crossfade(self):
        holds = [(0.5, 2.9), (3.4, 3.7), (4.0, 7.2)]
        self.assertEqual(kmod.poster_candidates(holds, [], 10.0), [1.7, 5.6], "a 0.3 s hold is a blink")
        tl = [{"start": 0, "end": 4}, {"start": 3.6, "end": 8}]
        self.assertEqual(kmod.poster_candidates([], tl, 8.0), [3.3, 7.7])
        self.assertEqual(kmod.poster_candidates([], [], 8.0), [4.0])

    def test_the_fullest_settled_screen_wins_and_ties_go_early(self):
        self.assertEqual(kmod.pick_poster([(1.0, 4, 50.0), (2.0, 11, 40.0), (3.0, 11, 40.2)]), 1)
        self.assertEqual(kmod.pick_poster([(1.0, 0, 30.0)]), 0)


class Captions(unittest.TestCase):
    SRC = kcopy.build_input(kcopy.Inputs(what="A bus route finder for campus", changes=["Search a building by name"],
                                         commits=["map: 14 routes drawn from the feed"], facts={"stills in the demo": 6}))  # fmt: skip

    def test_every_number_is_checked_even_the_small_ones(self):
        ok = {"platform": "x", "text": "A bus route finder. 14 routes, 6 screens.", "thread": []}
        self.assertIsNone(kcopy.check(ok, self.SRC))
        bad = {"platform": "x", "text": "A bus route finder. 3 taps to anywhere.", "thread": []}
        self.assertEqual(kcopy.check(bad, self.SRC), "invented_number", "3 is a claim in a public post")
        thread = {"platform": "x", "text": "A bus route finder.", "thread": ["It saves 40 minutes a day."]}
        self.assertEqual(kcopy.check(thread, self.SRC), "invented_number")
        self.assertEqual(kcopy.numbers_unknown("1,211 calls and 14 routes", self.SRC), ["1211"])

    def test_the_first_demo_has_no_commits_since_the_last_one(self):
        """FOUND ON THE FIRST WEBSITE KIT: the latest 30 commits were handed over as "commits since
        the last demo: 30" and four captions said so about a project with no last demo."""
        i = kcopy.Inputs(what="A portfolio page", commits=["a blog section"] * 30, since_last_demo=False, facts={"stills in the demo": 4})
        src = kcopy.build_input(i)
        self.assertIn("FIRST demo", src)
        self.assertNotIn("SINCE THE LAST DEMO,", src)
        claim = {"platform": "tiktok", "text": "30 commits since the last demo.", "thread": []}
        self.assertEqual(kcopy.check(claim, src), "invented_number")

    def test_a_name_and_a_limit(self):
        named = {"platform": "threads", "text": "Shipping gt-transit today.", "thread": []}
        self.assertEqual(kcopy.check(named, self.SRC, names=("gt-transit",)), "names_a_repository")
        long = {"platform": "x", "text": "word " * 60, "thread": []}
        self.assertEqual(kcopy.check(long, self.SRC), "over_limit")
        self.assertIsNone(kcopy.check({"platform": "linkedin", "text": "word " * 60, "thread": []}, self.SRC))

    def test_the_template_is_made_of_the_input_and_fits(self):
        i = kcopy.Inputs(what="A bus route finder for campus", changes=["Search a building by name"])
        src = kcopy.build_input(i)
        for p in kcopy.PLATFORMS:
            t = kcopy.template(p, i)
            self.assertLessEqual(len(t), tables.PLATFORM_LIMITS[p])
            self.assertIsNone(kcopy.check({"platform": p, "text": t, "thread": []}, src))
        self.assertIsNone(kcopy.template("x", kcopy.Inputs()), "nothing in, nothing out")

    def test_without_a_model_every_platform_gets_a_checked_template(self):
        i = kcopy.Inputs(shows=["the live map, buses from a recorded day"], facts={"stills in the demo": 4})
        doc = kcopy.write(i, use_model=False)
        self.assertEqual([c["platform"] for c in doc["captions"]], tables.ENUMS["platform"])
        self.assertTrue(all(c["source"] == "template" for c in doc["captions"]))

    def test_the_schema_the_model_gets_is_the_specs(self):
        schema = json.loads(kcopy.SCHEMA_PATH.read_text())
        self.assertEqual(schema["title"], "ShareCopy")
        cap = schema["$defs"]["Caption"]["properties"]
        self.assertEqual(cap["platform"]["enum"], tables.ENUMS["platform"])
        self.assertEqual(cap["thread"]["maxItems"], tables.THREAD_MAX)


class Queue(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = mock.patch.dict(os.environ, {"BUILDER_DEMOS_DIR": self.tmp.name})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def test_a_hook_only_writes_a_file_and_never_fails(self):
        args = types.SimpleNamespace(install=False, dry_run=False)
        hook = {"hook_event_name": "SessionEnd", "session_id": "s1", "transcript_path": "/t.jsonl", "cwd": "/repo"}
        self.assertEqual(kq.hook_main(args, io.StringIO(json.dumps(hook))), 0)
        (p,) = kq.jobs("pending")
        self.assertEqual({k: kq.read(p)[k] for k in ("kind", "session_id", "cwd")}, {"kind": "session_end", "session_id": "s1", "cwd": "/repo"})
        self.assertEqual(kq.hook_main(args, io.StringIO(json.dumps({**hook, "hook_event_name": "Stop"}))), 0)
        self.assertEqual(kq.hook_main(args, io.StringIO("not json")), 0, "a broken hook never blocks Claude Code")
        self.assertEqual(len(kq.jobs("pending")), 1)

    def test_one_job_is_claimed_once_and_moved_with_its_outcome(self):
        kq.enqueue({"kind": "manual", "path": "/a"})
        kq.enqueue({"kind": "manual", "path": "/b"})
        first = kq.claim_next()
        self.assertEqual(kq.read(first)["path"], "/a", "oldest first")
        self.assertEqual(len(kq.jobs("pending")), 1)
        done = kq.move(first, "skipped", skip="nothing_shipped")
        self.assertEqual(kq.read(done)["skip"], "nothing_shipped")
        self.assertEqual(kq.jobs("running"), [])

    @unittest.skipUnless(os.uname().sysname == "Darwin", "the served hook queues on a Mac only")
    def test_the_served_hook_script_queues_the_same_job_with_no_server_configured(self):
        """hook.sh (routes/ingest.py HOOK_SCRIPT) writes the candidate with printf and sed; the
        worker reads it with `queue.read`. A folder with a space in its name survives both. (A
        quote in a path does not reach the queue at all: the script's `field` reads a JSON string
        up to its first quote, the upload's own rule, and a transcript path is always
        ~/.claude/projects/<folder>/<uuid>.jsonl.)"""
        import ast
        import subprocess

        src = (ROOT / "server/builder/routes/ingest.py").read_text()
        script = next(
            ast.literal_eval(n.value) for n in ast.parse(src).body
            if isinstance(n, ast.Assign) and getattr(n.targets[0], "id", "") == "HOOK_SCRIPT"
        )  # fmt: skip
        home = pathlib.Path(self.tmp.name) / "home"
        (home / ".builder" / "demos").mkdir(parents=True)
        transcript = pathlib.Path(self.tmp.name) / "a session.jsonl"
        transcript.write_text("{}\n")
        hook = {"hook_event_name": "SessionEnd", "session_id": "s-9", "transcript_path": str(transcript), "cwd": "/Users/x/my repo"}
        env = {"HOME": str(home), "PATH": os.environ["PATH"]}
        r = subprocess.run(["bash", "-c", script], input=json.dumps(hook), text=True, env=env, capture_output=True, timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        with mock.patch.dict(os.environ, {"BUILDER_DEMOS_DIR": str(home / ".builder" / "demos")}):
            (p,) = kq.jobs("pending")
            job = kq.read(p)
        self.assertEqual((job["kind"], job["session_id"], job["cwd"]), ("session_end", "s-9", "/Users/x/my repo"))
        self.assertEqual(job["transcript"], str(transcript))
        # Not a SessionEnd: nothing is queued.
        subprocess.run(["bash", "-c", script], input=json.dumps({**hook, "hook_event_name": "Stop"}), text=True, env=env, capture_output=True, timeout=30)
        with mock.patch.dict(os.environ, {"BUILDER_DEMOS_DIR": str(home / ".builder" / "demos")}):
            self.assertEqual(len(kq.jobs("pending")), 1)

    def test_the_files_an_app_is_made_of(self):
        files = ["mobile/src/drops/Board.tsx", "server/builder/routes/x.py", "docs/demos.md", "mobile/__tests__/a.test.ts",
                 "ios/App/View.swift", "web/styles.css", "scripts/gen.py", "src/components/Button.jsx", "README.md"]  # fmt: skip
        self.assertEqual(kq.ui_files(files), ["mobile/src/drops/Board.tsx", "ios/App/View.swift", "web/styles.css", "src/components/Button.jsx"])

    def test_the_session_window_is_read_from_the_head_and_the_tail(self):
        p = pathlib.Path(self.tmp.name) / "t.jsonl"
        p.write_text("\n".join(json.dumps({"timestamp": t}) for t in ("2026-09-19T01:00:00Z", "2026-09-19T01:30:00Z", "2026-09-19T02:00:00Z")) + "\n")
        start, end = kq.session_window(str(p))
        self.assertEqual(end - start, 3600)
        self.assertIsNone(kq.session_window(None))

    def test_a_job_outside_a_repository_is_skipped_with_its_code(self):
        skip, _ = kq.judge({"kind": "session_end", "cwd": self.tmp.name})
        self.assertEqual(skip, "not_a_repository")
        self.assertIn(skip, tables.REFUSALS)


class History(unittest.TestCase):
    """The before and after pairs a demo with an EARLIER commit's, labelled by when each commit
    was written. FOUND ON THE MDN KIT: an old commit filmed after HEAD took HEAD as its "before"."""

    def setUp(self):
        import subprocess

        self.tmp = tempfile.TemporaryDirectory()
        self.env = mock.patch.dict(os.environ, {"BUILDER_DEMOS_DIR": self.tmp.name})
        self.env.start()
        self.src = pathlib.Path(self.tmp.name) / "src"
        self.src.mkdir()

        def git(*args, when="2014-03-12T10:00:00"):
            env = {**os.environ, "GIT_AUTHOR_DATE": when, "GIT_COMMITTER_DATE": when,
                   "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.com", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.com"}  # fmt: skip
            return subprocess.run(["git", "-C", str(self.src), *args], env=env, capture_output=True, text=True, check=True).stdout.strip()

        git("init", "-q")
        (self.src / "index.html").write_text("<p>old</p>")
        git("add", ".")
        git("commit", "-qm", "old")
        self.old = git("rev-parse", "HEAD")
        (self.src / "index.html").write_text("<p>new</p>")
        git("commit", "-qam", "new", when="2019-06-01T10:00:00")
        self.new = git("rev-parse", "HEAD")
        self.key = "7a1c0e59" + "0" * 56

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def keep(self, commit: str, filmed: str) -> None:
        d = kmod.history_root(self.key) / f"{filmed}-{commit[:12]}"
        d.mkdir(parents=True)
        (d / "manifest.json").write_text(json.dumps({"commit": commit, "taken_at": "2026-09-19T06:00:00Z", "assets": []}))

    def demo(self, commit: str):
        return types.SimpleNamespace(key=self.key, commit=commit)

    def test_a_later_commit_filmed_earlier_is_never_the_before(self):
        self.keep(self.new, "20260919T055900Z")
        self.keep(self.old, "20260919T060100Z")
        self.assertIsNone(kmod.previous_kit(self.demo(self.old), self.src), "HEAD is not the 2014 commit's before")
        prev = kmod.previous_kit(self.demo(self.new), self.src)
        self.assertEqual(json.loads((prev / "manifest.json").read_text())["commit"], self.old)

    def test_without_a_clone_the_newest_other_commit_is_taken(self):
        self.keep(self.new, "20260919T055900Z")
        self.assertIsNotNone(kmod.previous_kit(self.demo(self.old), None))

    def test_the_halves_are_labelled_by_the_day_the_code_was_written(self):
        self.assertEqual(kmod.commit_day(self.src, self.old, "2026-09-19T06:00:00Z"), "2014-03-12")
        self.assertEqual(kmod.commit_day(self.src, self.new, "2026-09-19T06:00:00Z"), "2019-06-01")
        self.assertEqual(kmod.commit_day(None, self.new, "2026-09-19T06:00:00Z"), "2026-09-19")


class Pins(unittest.TestCase):
    def test_the_kits_hues_are_the_phones_in_its_order(self):
        src = (ROOT / "mobile/src/projects/model.ts").read_text()
        m = re.search(r"PROJECT_HUES: readonly HueName\[\] = \[([^\]]+)\]", src)
        self.assertEqual(re.findall(r"'(\w+)'", m.group(1)), kmod.PROJECT_HUES)
        # The phone's preferredHue: the key's first eight hex digits round the ring.
        self.assertEqual(kmod.preferred_hue("7a1c0e59" + "0" * 56), kmod.PROJECT_HUES[0x7A1C0E59 % 8])

    def test_the_ground_and_the_ink_are_the_tokens(self):
        tokens = json.loads((ROOT / "design/tokens.json").read_text())
        self.assertEqual(fr.GROUND, tokens["surface"]["bg"]["dark"])
        self.assertEqual(fr.TITLE_INK, tokens["surface"]["text"]["dark"])

    def test_every_refusal_code_has_its_sentence(self):
        for enum in ("request_refusal", "kit_refusal", "queue_skip"):
            for code in tables.ENUMS[enum]:
                self.assertIn(code, tables.REFUSALS)

    def test_the_ship_kits_commands_are_answered_before_the_demo_parser(self):
        self.assertTrue(kcli.claims(["demo", "kit", "--dry-run"]))
        self.assertTrue(kcli.claims(["demo", "watch", "--once"]))
        self.assertFalse(kcli.claims(["demo", "./watch"]))
        self.assertFalse(kcli.claims(["demo", "--publish"]))


class CaptureErrors(unittest.TestCase):
    def test_a_device_error_is_a_capture_error_with_a_code(self):
        e = devices.DeviceError("unknown_device", device="iphone-9000")
        self.assertIsInstance(e, CaptureError)
        self.assertEqual(e.code, "unknown_device")


if __name__ == "__main__":
    unittest.main()
