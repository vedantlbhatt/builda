"""python3 -m unittest capture.tests.test_trailer_notes

The director's notes on the Mac (capture/trailer/notes.py) and the trailer in the kit's publish
(capture/shipkit/publish.py `trailer_of`), held without Node, ffmpeg, a model or a server:

- a note on a project with no trailer is answered with the first cut, and the note read against it;
- a note on a trailer is answered with the new version and its changes as codes, or refused with a
  code, and a render that fails puts the owner's cut back;
- the worker finishes every note it claimed, whatever happens to one of them;
- only a whole render of the current cut rides in the kit, and never one whose words name a
  repository.
"""

from __future__ import annotations

import json
import os
import pathlib
import tempfile
import unittest
from unittest import mock

from capture.tests.test_trailer import some_facts
from capture.trailer import notes, render

KEY = "ab" * 32


def no_names(_key):
    return None, (), ()


class Rendered:
    """A render that writes nothing and remembers what it was asked to render."""

    def __init__(self, fail: str | None = None):
        self.cuts: list[int] = []
        self.fail = fail

    def __call__(self, key, f, cut, **kw):
        if self.fail:
            raise render.RenderError(self.fail, "no")
        self.cuts.append(cut["version"])
        return {"made": []}


class NoteAnswers(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = mock.patch.dict(os.environ, {"BUILDER_DEMOS_DIR": self.tmp.name})
        self.env.start()
        self.facts = mock.patch("capture.trailer.make.facts_for", lambda *a, **k: some_facts())
        self.facts.start()

    def tearDown(self):
        self.facts.stop()
        self.env.stop()
        self.tmp.cleanup()

    def note(self, body: str) -> dict:
        return {"id": "n1", "project_key": KEY, "body": body, "created_at": "2026-09-28T06:00:00+00:00"}

    def test_make_a_trailer_is_the_first_cut_as_version_one(self):
        r = Rendered()
        body = notes.answer(self.note("make a trailer"), use_model=False, resolve=no_names, render_fn=r)
        self.assertEqual(body, {"status": "done", "from_version": None, "to_version": 1, "changes": [], "refusal": None, "source": None})
        self.assertEqual(r.cuts, [1])
        self.assertEqual(render.current(KEY)["version"], 1)

    def test_a_note_with_no_trailer_yet_is_read_against_the_first_cut(self):
        body = notes.answer(self.note("make it orange"), use_model=False, resolve=no_names, render_fn=Rendered())
        self.assertEqual((body["status"], body["from_version"], body["to_version"]), ("done", None, 1))
        self.assertEqual([c["code"] for c in body["changes"]], ["hue"])
        self.assertEqual(render.current(KEY)["hue"], "ember")

    def test_a_note_nobody_can_read_still_gets_the_first_cut_it_asked_for_at_least(self):
        body = notes.answer(self.note("something unreadable entirely"), use_model=False, resolve=no_names, render_fn=Rendered())
        self.assertEqual((body["status"], body["to_version"], body["changes"]), ("done", 1, []))

    def test_a_note_on_a_trailer_is_the_next_version_with_its_changes(self):
        notes.answer(self.note("make a trailer"), use_model=False, resolve=no_names, render_fn=Rendered())
        body = notes.answer(self.note("make it shorter"), use_model=False, resolve=no_names, render_fn=Rendered())
        self.assertEqual((body["status"], body["from_version"], body["to_version"]), ("done", 1, 2))
        self.assertEqual(body["changes"][0]["code"], "seconds")
        self.assertEqual(body["source"], "rules")

    def test_a_note_the_rules_cannot_read_and_no_model_is_refused_with_a_code(self):
        notes.answer(self.note("make a trailer"), use_model=False, resolve=no_names, render_fn=Rendered())
        body = notes.answer(self.note("something unreadable entirely"), use_model=False, resolve=no_names, render_fn=Rendered())
        self.assertEqual(body, {"status": "failed", "from_version": 1, "to_version": None, "changes": [], "refusal": "not_understood", "source": "rules"})

    def test_a_render_that_fails_puts_the_owner_cut_back(self):
        notes.answer(self.note("make a trailer"), use_model=False, resolve=no_names, render_fn=Rendered())
        body = notes.answer(self.note("make it shorter"), use_model=False, resolve=no_names, render_fn=Rendered(fail="no_node"))
        self.assertEqual((body["status"], body["refusal"], body["to_version"]), ("failed", "no_node", None))
        self.assertEqual(render.current(KEY)["version"], 1)

    def test_no_demo_is_a_code(self):
        from capture.demo.result import CaptureError

        def none(*a, **k):
            raise CaptureError("no demo")

        with mock.patch("capture.trailer.make.facts_for", none):
            body = notes.answer(self.note("make a trailer"), use_model=False, resolve=no_names, render_fn=Rendered())
        self.assertEqual(body["refusal"], "no_demo")

    def test_after_a_new_demo_the_trailer_is_cut_and_a_first_one_made_unless_turned_off(self):
        r = Rendered()
        self.assertIsNone(notes.refresh(KEY, resolve=no_names, render_fn=r, make_first=False))
        self.assertEqual(r.cuts, [])
        # For everyone: a project with no trailer gets its first after a demo, as the kit is made.
        self.assertEqual(notes.refresh(KEY, resolve=no_names, render_fn=r), 1)
        # The next demo keeps the owner's cut when it still fits, at its version.
        self.assertEqual(notes.refresh(KEY, resolve=no_names, render_fn=r), 1)
        self.assertEqual(r.cuts, [1, 1])


class Worker(unittest.TestCase):
    def test_every_claimed_note_is_finished_whatever_happens_to_one(self):
        finished: list[tuple[str, dict]] = []

        class Client:
            def claim(self):
                return [{"id": "a", "project_key": KEY, "body": "x"}, {"id": "b", "project_key": KEY, "body": "y"}]

            def finish(self, nid, body):
                finished.append((nid, body))
                if nid == "a":
                    raise RuntimeError("the server went away")

        def answer(n, **kw):
            if n["id"] == "a":
                raise ValueError("broke")
            return {"status": "done", "from_version": 1, "to_version": 2, "changes": [], "refusal": None, "source": "rules"}

        lines: list[str] = []
        with mock.patch.object(notes, "answer", answer):
            self.assertEqual(notes.take(Client(), publish_to=None, say=lines.append), 2)
        self.assertEqual([f[0] for f in finished], ["a", "b"])
        self.assertEqual(finished[0][1]["refusal"], "render_failed")
        self.assertTrue(any("comes back in ten minutes" in line for line in lines))

    def test_a_server_that_does_not_answer_is_a_line(self):
        class Down:
            def claim(self):
                raise OSError("refused")

        lines: list[str] = []
        self.assertEqual(notes.take(Down(), publish_to=None, say=lines.append), 0)
        self.assertIn("did not answer", lines[0])

    def test_the_notes_that_only_ask_for_a_trailer(self):
        for yes in ("make a trailer", "Make me a trailer!", "trailer", "please cut the first trailer", "do a trailer"):
            self.assertIsNotNone(notes.MAKE_ONE.match(yes), yes)
        for no in ("make a trailer in orange", "shorter trailer", "no trailer music"):
            self.assertIsNone(notes.MAKE_ONE.match(no), no)


class InTheKit(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = pathlib.Path(self.tmp.name)
        self.kit_dir = root / "kit"
        self.kit_dir.mkdir()
        self.t = root / "trailer"
        (self.t / "render").mkdir(parents=True)
        self.cut = {"version": 3, "seconds": 20, "scenes": [{"kind": "open"}, {"kind": "screens"}, {"kind": "end"}]}
        self.made = {"cut": 3, "seconds": 20, "draft": False, "made": [
            {"format": "vertical", "file": "trailer-vertical.mp4", "seconds": 20, "width": 1080, "height": 1920},
            {"format": "square", "file": "trailer-square.mp4", "seconds": 20},
            {"format": "loop", "file": "trailer.gif", "width": 600, "height": 600},
        ]}  # fmt: skip
        for m in self.made["made"]:
            (self.t / "render" / m["file"]).write_bytes(b"x" * 10)
        self.write()

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, facts: dict | None = None):
        (self.t / "cut.json").write_text(json.dumps(self.cut))
        (self.t / "render" / "render.json").write_text(json.dumps(self.made))
        (self.t / "facts.json").write_text(json.dumps(facts or some_facts()))

    def test_a_whole_render_of_the_current_cut_rides_in_its_slots(self):
        from capture.shipkit import publish

        files, doc, why = publish.trailer_of(self.kit_dir)
        self.assertIsNone(why)
        self.assertEqual([(f["slot"], f["width"], f["height"], f["duration_ms"]) for f in files],
                         [("trailer_vertical", 1080, 1920, 20000), ("trailer_square", 1080, 1080, 20000), ("trailer_loop", 600, 600, None)])  # fmt: skip
        self.assertEqual(doc, {"version": 3, "seconds": 20.0, "scenes": ["open", "screens", "end"]})

    def test_a_draft_or_a_stale_render_stays_on_the_mac_and_says_why(self):
        from capture.shipkit import publish

        self.made["draft"] = True
        self.write()
        files, doc, why = publish.trailer_of(self.kit_dir)
        self.assertEqual((files, doc), ([], None))
        self.assertIn("draft", why)
        self.made["draft"] = False
        self.cut["version"] = 4
        self.write()
        files, doc, why = publish.trailer_of(self.kit_dir)
        self.assertEqual((files, doc), ([], None))
        self.assertIn("version 3", why)

    def test_a_trailer_whose_words_name_a_repository_stays_on_the_mac(self):
        from capture.shipkit import publish

        self.write(some_facts(changelog=["Merge the secretproject branch"]))
        files, doc, why = publish.trailer_of(self.kit_dir, names=("secretproject",))
        self.assertEqual((files, doc), ([], None))
        self.assertIn("names a repository", why)

    def test_no_trailer_is_no_trailer_and_nothing_said(self):
        from capture.shipkit import publish

        empty = pathlib.Path(self.tmp.name) / "other" / "kit"
        empty.mkdir(parents=True)
        self.assertEqual(publish.trailer_of(empty), ([], None, None))


if __name__ == "__main__":
    unittest.main()
