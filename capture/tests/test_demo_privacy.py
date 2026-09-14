"""python3 -m unittest capture.tests.test_demo_privacy

Stage 5 (docs/demos.md): what the Vision text of a still or a frame may not show. Tested on
TEXT fixtures, never through Vision: the private repository's names as whole words (and squashed
for a wordmark), an ordinary word name only where a name is shown (a label, a path), the other
repositories on the Mac, every key shape the digest masks and any long token, email addresses;
the refusal's shape (file, box, reason, masked text), one per file for a video, and labels
checked as text because they travel with the demo.
"""

from __future__ import annotations

import json
import pathlib
import unittest
from unittest import mock

from capture.demo import privacy as pv
from capture.demo.project import names_for

WORDS = frozenset({"builder", "practice", "which", "kind", "of", "are", "you", "the", "map"})
BOX = (10, 20, 300, 40)
BUILDER = names_for("github.com/vedantlbhatt/builder", ["builder-overnight", "builder"])
RIDEGT = names_for("github.com/vedantlbhatt/gt-transit", ["RideGT"])


def hits(text: str, names=RIDEGT, others=(), words=WORDS):
    return [(h.reason, h.text) for h in pv.find([pv.Line(text, BOX)], names, others, words)]


class Names(unittest.TestCase):
    def test_the_names_a_project_has(self):
        self.assertEqual(RIDEGT, ("vedantlbhatt/gt-transit", "gt-transit", "RideGT"))
        self.assertEqual(BUILDER, ("vedantlbhatt/builder", "builder", "builder-overnight"))

    def test_a_distinctive_name_matches_anywhere_as_words(self):
        self.assertEqual(hits("Welcome to RideGT"), [("repo_name", "RideGT")])
        self.assertEqual(hits("ridegt"), [("repo_name", "RideGT")])
        self.assertEqual(hits("pushed to gt-transit today"), [("repo_name", "gt-transit")])
        # OCR sets punctuation its own way: an em dash, spaces, case.
        self.assertEqual(hits("GT—Transit"), [("repo_name", "gt-transit")])
        self.assertEqual(hits("GT Transit"), [("repo_name", "gt-transit")])

    def test_a_wordmark_squashes_a_two_word_name(self):
        self.assertEqual(hits("GTTRANSIT"), [("repo_name", "gt-transit")])

    def test_never_inside_another_word(self):
        self.assertEqual(hits("RideGTX is not it"), [])
        self.assertEqual(hits("Builda", BUILDER), [])
        self.assertEqual(hits("builders unite", BUILDER), [])

    def test_an_ordinary_word_name_is_refused_where_a_name_is_shown(self):
        # FOUND ON THE FIRST BUILDA RUN: the sample Now tile prints the repository, alone.
        self.assertEqual(hits("builder", BUILDER), [("repo_name", "builder")])
        self.assertEqual(hits("builder  main", BUILDER), [("repo_name", "builder")])
        self.assertEqual(hits("~/code/builder is open", BUILDER), [("repo_name", "builder")])
        self.assertEqual(hits("cd builder/mobile first", BUILDER), [("repo_name", "builder")])
        self.assertEqual(hits("vedantlbhatt/builder", BUILDER), [("repo_name", "vedantlbhatt/builder")])

    def test_an_ordinary_word_name_is_not_refused_in_a_sentence(self):
        # The same run's Wrapped card: the word, not the repository.
        self.assertEqual(hits("Which kind of builder are you?", BUILDER), [])

    def test_without_a_word_list_every_name_is_strict(self):
        self.assertEqual(hits("Which kind of builder are you?", BUILDER, words=frozenset()), [("repo_name", "builder")])

    def test_other_repositories_on_the_mac(self):
        self.assertEqual(hits("RideGT", BUILDER, others=RIDEGT), [("other_repo_name", "RideGT")])
        # The project's own name is reported as its own, once.
        self.assertEqual(hits("RideGT", RIDEGT, others=RIDEGT), [("repo_name", "RideGT")])

    def test_other_names_leaves_out_what_the_project_shares(self):
        got = pv.other_names([("github.com/vedantlbhatt/gt-transit", "/x/RideGT"), ("localroot:abc", "/x/builder")], BUILDER)
        self.assertEqual(got, ("vedantlbhatt/gt-transit", "gt-transit", "RideGT"))

    def test_short_names_are_ignored(self):
        self.assertEqual(pv.name_patterns(["ab", "abc"], WORDS)[0][0], "abc")
        self.assertEqual(len(pv.name_patterns(["ab"], WORDS)), 0)

    def test_a_name_split_across_two_lines_is_matched_over_the_joined_text(self):
        # The review's item 7: OCR wrapped "gt-transit" as "GT" / "transit"; neither line alone
        # matches, but the two joined do. A single line's match is still counted once, not twice.
        lines = [pv.Line("GT", BOX), pv.Line("transit", BOX)]
        got = [(h.reason, h.text) for h in pv.find(lines, RIDEGT, (), WORDS)]
        self.assertEqual(got, [("repo_name", "gt-transit")])
        # A name fully inside one line is not also reported from the joined text.
        lines = [pv.Line("RideGT", BOX), pv.Line("home", BOX)]
        got = [(h.reason, h.text) for h in pv.find(lines, RIDEGT, (), WORDS)]
        self.assertEqual(got, [("repo_name", "RideGT")])

    def test_the_macos_user_name_in_a_path_is_refused(self):
        # The review's item 7: a /Users/<name>/ path was not refused; machine_names supplies it.
        names = pv.machine_names()
        self.assertTrue(names)
        user = names[0]
        got = [(h.reason, h.text) for h in pv.find([pv.Line(f"/Users/{user}/Downloads/app", BOX)], names)]
        self.assertEqual([r for r, _ in got], ["repo_name"])


class Secrets(unittest.TestCase):
    def test_every_digest_key_shape(self):
        for text in (
            "sk-ant-api03-abcdefghijklmnopqrstuvwxyz",
            "AKIAABCDEFGHIJKLMNOP",
            "ghp_" + "a" * 36,
            "token: s3cretvalue1",
            "Bearer abcdefghijklmnop",
            "eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4",
        ):
            got = hits(text, names=())
            self.assertEqual([r for r, _ in got], ["token"], text)
            self.assertNotIn(text, got[0][1])  # the refusal carries the text masked

    def test_a_long_run_of_letters_and_digits_is_token_shaped(self):
        self.assertEqual([r for r, _ in hits("key 3f9a0c1b2d4e5f60718293a4b5c6d7e8f9", names=())], ["token"])
        # Long plain words, a sentence, a number: not tokens.
        self.assertEqual(hits("Antidisestablishmentarianism", names=()), [])
        self.assertEqual(hits("47,803 lines shipped in 143 sessions", names=()), [])

    def test_a_crash_screen_is_never_a_good_capture(self):
        got = hits("[runtime not ready]: Error: Cannot create devtools websocket connections", names=())
        self.assertEqual(got, [("error_screen", "runtime not ready")])
        self.assertEqual([r for r, _ in hits("Uncaught Error", names=())], ["error_screen"])
        self.assertEqual(hits("Every bus on campus, moving", names=()), [])
        # The review's item 7: the "No script URL provided" screen a dead Metro leaves, and the
        # other red box strings, are refused too.
        self.assertEqual([r for r, _ in hits("No script URL provided", names=())], ["error_screen"])
        self.assertEqual([r for r, _ in hits("Could not connect to development server", names=())], ["error_screen"])
        self.assertEqual([r for r, _ in hits("Unable to resolve module ./foo", names=())], ["error_screen"])

    def test_email(self):
        got = hits("reach me at someone@example.com", names=())
        self.assertEqual(got, [("email", "reach me at [email]")])


class Refusals(unittest.TestCase):
    def test_the_refusal_names_the_file_and_the_box(self):
        results = [{"file": "still-01.png", "lines": [{"text": "RideGT", "box": [1, 2, 3, 4]}, {"text": "fine"}]}]
        self.assertEqual(
            pv.refusals(results, RIDEGT),
            [{"file": "still-01.png", "box": {"x": 1, "y": 2, "width": 3, "height": 4}, "reason": "repo_name", "text": "RideGT"}],
        )

    def test_a_video_is_refused_once_per_finding_at_its_first_frame(self):
        frames = [{"file": "demo.mp4", "at_ms": ms, "lines": [{"text": "RideGT", "box": [0, 0, 1, 1]}]} for ms in (500, 1000, 1500)]
        got = pv.refusals(frames, RIDEGT)
        self.assertEqual(len(got), 1)
        self.assertEqual(got[0]["at_ms"], 500)

    def test_a_clean_frame_refuses_nothing(self):
        self.assertEqual(pv.refusals([{"file": "a.png", "lines": [{"text": "Private project 1", "box": [0, 0, 1, 1]}]}], RIDEGT), [])

    def test_labels_are_checked_as_text(self):
        self.assertEqual(pv.label_leaks(["RideGT running: the map", "the map"], RIDEGT, words=WORDS), ["'RideGT running: the map' names RideGT"])


class FailsClosed(unittest.TestCase):
    def test_an_ocr_error_entry_raises_so_the_demo_is_marked_unchecked(self):
        # The review's item 4: the helper exits 0 with an error entry for an image it cannot read;
        # `ocr` raises rather than reading it as blank, so `check` propagates and the demo is
        # unchecked instead of published as though every pixel was read.
        fake = mock.Mock(returncode=0, stdout=json.dumps([{"file": "a.png", "error": "unreadable image"}]), stderr="")
        with mock.patch("capture.demo.tools.helper", return_value="/x/helper"), mock.patch("subprocess.run", return_value=fake):
            with self.assertRaises(RuntimeError):
                pv.ocr([pathlib.Path("a.png")])

    def test_the_video_is_sampled_at_least_four_frames_a_second_and_at_scene_changes(self):
        self.assertGreaterEqual(pv.SAMPLE_FPS, 4)
        self.assertTrue(hasattr(pv, "SCENE_THRESHOLD"))


if __name__ == "__main__":
    unittest.main()
