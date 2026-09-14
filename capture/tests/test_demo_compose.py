"""python3 -m unittest capture.tests.test_demo_compose

Stage 4 (docs/demos.md): ffmpeg only, and every command line built by a pure function, read
here: freezedetect's log parsed into holds, a beat cut into motion and sped up holds, a beat
held to its budget, the join inside 10 to 30 seconds, the crossfade offsets, the caption
(drawtext where ffmpeg has it, the overlay of a drawn caption where it does not), faststart,
and the poster frame.
"""

from __future__ import annotations

import unittest

from capture.demo import compose as c

FREEZE_LOG = """\
[freezedetect @ 0x6000] lavfi.freezedetect.freeze_start: 1.2
[freezedetect @ 0x6000] lavfi.freezedetect.freeze_duration: 3.8
[freezedetect @ 0x6000] lavfi.freezedetect.freeze_end: 5
frame=  300 fps=0.0 q=-0.0 size=N/A
[freezedetect @ 0x6000] lavfi.freezedetect.freeze_start: 9.5
"""


class Holds(unittest.TestCase):
    def test_parse_freezes_closes_an_open_one_at_the_end(self):
        self.assertEqual(c.parse_freezes(FREEZE_LOG, 12.0), [(1.2, 5.0), (9.5, 12.0)])
        self.assertEqual(c.parse_freezes(FREEZE_LOG), [(1.2, 5.0)])

    def test_segments_speed_up_the_holds_and_keep_the_motion(self):
        segs = c.segments(0.0, 12.0, [(1.2, 5.0), (9.5, 12.0)])
        self.assertEqual([(s.start, s.end) for s in segs], [(0.0, 1.2), (1.2, 5.0), (5.0, 9.5), (9.5, 12.0)])
        self.assertEqual(segs[0].speed, 1.0)
        self.assertEqual(segs[2].speed, 1.0)
        # A hold in the middle keeps HOLD_KEEP; the last one, what the caption describes, TAIL_KEEP.
        self.assertAlmostEqual(segs[1].out_len, c.HOLD_KEEP, places=2)
        self.assertAlmostEqual(segs[3].out_len, 2.5 / max(1.0, 2.5 / c.TAIL_KEEP), places=2)

    def test_segments_cover_the_window_exactly_and_ignore_short_freezes(self):
        segs = c.segments(10.0, 20.0, [(2.0, 11.0), (14.0, 14.2), (19.0, 30.0)])
        self.assertEqual(segs[0].start, 10.0)
        self.assertEqual(segs[-1].end, 20.0)
        for a, b in zip(segs, segs[1:]):
            self.assertEqual(a.end, b.start)
        self.assertNotIn(14.0, [s.start for s in segs])  # 0.2 s is not a hold
        self.assertEqual(c.segments(5.0, 5.0, []), [])

    def test_no_hold_is_sped_past_the_cap(self):
        segs = c.segments(0.0, 100.0, [(0.0, 100.0)])
        self.assertEqual(segs[0].speed, c.MAX_SPEED)

    def test_a_beat_over_budget_is_sped_up_alone_keeping_its_final_hold(self):
        segs = [c.Segment(0, 20, 1.0), c.Segment(20, 25, 5 / c.TAIL_KEEP)]
        out = c.budget(segs, 6.5)
        self.assertAlmostEqual(sum(s.out_len for s in out), 6.5, places=2)
        self.assertEqual(out[-1], segs[-1])
        self.assertEqual(c.budget(segs[:1][:0], 6.5), [])
        short = [c.Segment(0, 3, 1.0)]
        self.assertEqual(c.budget(short, 6.5), short)


class Fit(unittest.TestCase):
    def test_inside_the_window_nothing_changes(self):
        self.assertEqual(c.fit([6.0, 6.0, 6.0]), (1.0, 0.0))

    def test_too_long_is_sped_up_evenly_under_thirty(self):
        speed, pad = c.fit([12.0, 12.0, 12.0])
        self.assertGreater(speed, 1.0)
        self.assertEqual(pad, 0.0)
        self.assertLessEqual(c.total_length([12.0, 12.0, 12.0], speed), c.MAX_TOTAL)

    def test_too_short_holds_the_last_frame_to_ten(self):
        speed, pad = c.fit([2.0, 2.0])
        self.assertEqual(speed, 1.0)
        self.assertGreaterEqual(c.total_length([2.0, 2.0], speed, pad), c.MIN_TOTAL)


class CommandLines(unittest.TestCase):
    def test_a_beat_with_an_overlaid_caption(self):
        segs = [c.Segment(1.0, 2.0, 1.0), c.Segment(2.0, 6.0, 4.0)]
        args = c.beat_command("ffmpeg", "raw.mp4", segs, "b1.mp4", (1206, 2622), caption_png="cap.png")
        self.assertEqual(args[:5], ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"])
        self.assertEqual(args[5:11], ["-ss", "1.000", "-t", "1.000", "-i", "raw.mp4"])
        graph = args[args.index("-filter_complex") + 1]
        self.assertIn("[0:v]setpts=(PTS-STARTPTS)/1,fps=30,mpdecimate=", graph)  # motion: duplicates dropped
        self.assertIn("[1:v]setpts=(PTS-STARTPTS)/4,fps=30,scale=", graph)  # a hold: sped up, not decimated
        self.assertIn("[s0][s1]concat=n=2:v=1:a=0[cat]", graph)
        self.assertIn(f"[cat][2:v]overlay=x=(W-w)/2:y=H-h-{round(2622 * c.CAPTION_BOTTOM)}", graph)
        self.assertIn("cap.png", args)
        self.assertEqual(args[-1], "b1.mp4")
        self.assertIn("libx264", args)

    def test_a_beat_with_drawtext_where_ffmpeg_has_it(self):
        args = c.beat_command("ffmpeg", "raw.mp4", [c.Segment(0, 3, 1.0)], "b.mp4", (1080, 1920), caption_text_file="/t/cap:1.txt", fontfile="/f/SF.ttf")
        graph = args[args.index("-filter_complex") + 1]
        self.assertIn("[s0]drawtext=textfile='/t/cap\\:1.txt':fontfile='/f/SF.ttf'", graph)
        self.assertIn("box=1", graph)

    def test_odd_sizes_are_made_even_for_yuv420p(self):
        args = c.beat_command("ffmpeg", "r.mp4", [c.Segment(0, 1, 1.0)], "b.mp4", (781, 1689))
        self.assertIn("scale=780:1688", args[args.index("-filter_complex") + 1])

    def test_the_join_crossfades_at_the_right_offsets_with_faststart(self):
        args = c.join_command("ffmpeg", ["a.mp4", "b.mp4", "c.mp4"], [5.0, 6.0, 4.0], "demo.mp4")
        graph = args[args.index("-filter_complex") + 1]
        self.assertIn("[v0][v1]xfade=transition=fade:duration=0.4:offset=4.600[x1]", graph)
        self.assertIn("[x1][v2]xfade=transition=fade:duration=0.4:offset=10.200[x2]", graph)
        self.assertIn("+faststart", args)
        self.assertIn("yuv420p", args)
        self.assertEqual(args[args.index("-profile:v") + 1], "high")
        self.assertIn("-an", args)

    def test_the_join_applies_the_fit(self):
        args = c.join_command("ffmpeg", ["a.mp4", "b.mp4"], [20.0, 20.0], "demo.mp4", speed=2.0, pad=1.5)
        graph = args[args.index("-filter_complex") + 1]
        self.assertIn("[0:v]setpts=PTS/2,settb=AVTB", graph)
        self.assertIn("[1:v]setpts=PTS/2,tpad=stop_mode=clone:stop_duration=1.5,", graph)
        self.assertIn("offset=9.600", graph)

    def test_one_beat_needs_no_crossfade(self):
        args = c.join_command("ffmpeg", ["a.mp4"], [12.0], "demo.mp4")
        self.assertNotIn("xfade", args[args.index("-filter_complex") + 1])

    def test_the_poster_is_the_first_beat_settled_before_its_fade(self):
        self.assertAlmostEqual(c.poster_time([5.0, 6.0]), 5.0 - c.FADE - 0.15)
        self.assertAlmostEqual(c.poster_time([10.0, 6.0], speed=2.0), 5.0 - c.FADE - 0.15)
        self.assertEqual(c.poster_command("ffmpeg", "demo.mp4", 4.45, "poster.jpg")[-5:], ["-frames:v", "1", "-q:v", "3", "poster.jpg"])

    def test_the_recording_is_made_constant_frame_rate_before_any_cut(self):
        # The fourth Builda run: a cut starting inside a frameless stretch of simctl's variable
        # frame rate recording came back with frames from the end of the file.
        args = c.cfr_command("ffmpeg", "raw.mp4", "raw-cfr.mp4")
        self.assertEqual(args[args.index("-vf") + 1], f"fps={c.FPS}")
        self.assertEqual(args[args.index("-g") + 1], str(c.FPS))  # a keyframe every second
        self.assertEqual(args[-1], "raw-cfr.mp4")

    def test_a_beats_still_is_checked_at_the_end_of_its_window(self):
        from capture.demo.result import BeatWindow

        self.assertAlmostEqual(c.frame_time(BeatWindow("b", None, 10.0, 16.0)), 15.6)
        self.assertEqual(c.frame_time(BeatWindow("b", None, 10.0, 10.2)), 10.0)

    def test_each_beat_is_found_in_the_recording_by_its_picture(self):
        # The sixth Builda run: the recording's stamps ran about 10 s behind the driver's clock.
        from capture.demo.result import BeatWindow, CaptureError

        A, B, C = 0, (1 << 100) - 1, ((1 << 100) - 1) << 120  # three screens, far apart
        # 5 frames a second: A for 6 s, B for 4 s, C for 5 s.
        frames = [A] * 30 + [B] * 20 + [C] * 25
        beats = [BeatWindow("a", None, 0.0, 8.0), BeatWindow("b", None, 8.0, 13.0), BeatWindow("c", None, 13.0, 15.0)]
        got = c.realign(beats, frames, [A, B, C], fps=5, duration=15.0)
        self.assertEqual([(g.start, g.end) for g in got], [(0.0, 6.0), (6.0, 10.0), (13.0, 15.0)])
        self.assertEqual([r for r in c.match_runs(frames, B)], [(30, 49)])
        with self.assertRaisesRegex(CaptureError, "does not line up"):
            c.realign(beats[:1], [B] * 10, [A], fps=5)
        # A beat without a still keeps its clock window.
        self.assertEqual(c.realign(beats[:1], frames, [None], fps=5)[0], beats[0])

    def test_the_recording_starts_on_a_frame_the_run_made(self):
        # The fifth Builda run: simctl's first frame waits for the screen to change, so a run
        # that started on a still screen had its video zero 11 s late.
        from unittest import mock

        from capture.demo import simulator as sim

        calls = []
        with mock.patch.object(sim, "_simctl", side_effect=lambda args, **kw: calls.append(args)), mock.patch.object(sim.time, "sleep"):
            sim.mark_start("UDID")
        self.assertEqual(calls[0], ["status_bar", "UDID", "override", "--time", "9:42"])
        self.assertEqual(calls[1][:3], ["status_bar", "UDID", "override"])
        self.assertIn("9:41", calls[1])

    def test_freezedetect_command(self):
        self.assertIn(f"freezedetect=n={c.FREEZE_NOISE}:d={c.FREEZE_MIN}", c.freeze_command("ffmpeg", "raw.mp4"))


if __name__ == "__main__":
    unittest.main()
