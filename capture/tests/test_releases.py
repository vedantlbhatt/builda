"""python3 -m unittest capture.tests.test_releases

The Mac's release drafts (capture/releases/), held without a network or a model:

- when a draft is due: the commit threshold counted from the later of the last published release
  and the last draft, a new build post or kit, a weekly and a fortnightly cadence, never twice for
  one state, and never for a project whose owner has drafts off;
- the rules' words: conventional prefixes off, merges dropped, at most five highlights of at most
  120 characters, a title of at most 80, no dash anywhere and no number the input does not hold;
- the checks: a model answer with an invented number or a repository's name is not used;
- the PUT through a fake client, a 403 `drafts_off` included, which is a line and not a crash;
- the worker's hook: at most once every ten minutes, and an error there is one line;
- the bounds and the enums, held to server/builder/releases.py.
"""

from __future__ import annotations

import argparse
import ast
import contextlib
import datetime as dt
import io
import json
import os
import pathlib
import stat
import subprocess
import tempfile
import unittest
from unittest import mock

from analysis import plain
from capture.releases import cli as rcli
from capture.releases import draft
from capture.shipkit.copy import numbers_unknown

KEY = "cd" * 32
DAY = draft.DAY
#: A fixed clock: every commit and every release below is placed against it.
T0 = 1_780_000_000
NOW = float(T0 + 40 * DAY)
ON = {"project_key": KEY, "drafts_to_phone": True, "every_commits": 10, "cadence": "none", "on_shipped": True}
REPO = pathlib.Path(__file__).resolve().parents[2]


def no_names(_key, _checkout):
    return (), ()


def settings(**kw) -> dict:
    return {**ON, **kw}


def facts(**kw) -> draft.Facts:
    return draft.Facts(key=KEY, **kw)


class Repo:
    """A git repository whose commits are made at the times asked for."""

    def __init__(self, root: pathlib.Path):
        self.path = root / "app"
        self.path.mkdir()
        self.git("init", "-q", "-b", "main")

    def git(self, *args: str, when: int | None = None) -> str:
        env = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.com",
               "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.com"}  # fmt: skip
        if when is not None:
            env |= {"GIT_AUTHOR_DATE": f"{when} +0000", "GIT_COMMITTER_DATE": f"{when} +0000"}
        return subprocess.run(["git", "-C", str(self.path), *args], env=env, capture_output=True, text=True, check=True).stdout.strip()

    def commit(self, subject: str, when: int) -> str:
        self.git("commit", "-q", "--allow-empty", "-m", subject, when=when)
        return self.git("rev-parse", "HEAD")


class Fake:
    """The server's release routes, as `Client._authorized` answers them."""

    def __init__(self, *, published=None, kit=None, rows=None, put=(200, None)):
        self.published = published or []
        self.kit = kit
        self.rows = rows if rows is not None else [ON]
        self.put = put
        self.calls: list[tuple[str, str, dict | None]] = []

    def _authorized(self, method, path, body):
        self.calls.append((method, path, body))
        if path == "/v1/me/release-settings":
            return 200, {"settings": self.rows}
        if path.startswith("/v1/me/releases?"):
            return 200, {"releases": self.published}
        if path.endswith("/kit"):
            return 200, {"kit": self.kit}
        if method == "PUT" and path.endswith("/releases/draft"):
            status, answer = self.put
            return status, answer if answer is not None else {"release": {"id": "r-1", **body}, "replaced": False}
        return 404, {"detail": "not_found"}

    def puts(self) -> list[dict]:
        return [b for m, p, b in self.calls if m == "PUT"]


class Temp(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name)
        self.env = mock.patch.dict(os.environ, {"BUILDER_DEMOS_DIR": str(self.root / "demos"),
                                                "BUILDER_CREDENTIALS": str(self.root / "no-credentials.json")})  # fmt: skip
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()


# ------------------------------------------------------------------------ the triggers


class Triggers(unittest.TestCase):
    def test_the_commit_threshold_is_every_commits(self):
        self.assertEqual(draft.decide(ON, facts(commits=9, new_commits=9, commit="a"), {}, NOW), (None, "nothing_due"))
        self.assertEqual(draft.decide(ON, facts(commits=10, new_commits=10, commit="a"), {}, NOW)[0], "commits")
        self.assertEqual(draft.decide(settings(every_commits=3), facts(commits=3, new_commits=3, commit="a"), {}, NOW)[0], "commits")
        # A value the server could not have sent is read as its default, never as "every commit".
        self.assertEqual(draft.decide(settings(every_commits=1), facts(commits=3, new_commits=3, commit="a"), {}, NOW)[0], None)

    def test_a_new_build_post_or_kit_is_shipped_and_an_old_one_is_not(self):
        published = NOW - 5 * DAY
        kit = facts(kit_id="k1", kit_at=NOW - DAY, published_id="p", published_at=published, commit="a")
        self.assertEqual(draft.decide(ON, kit, {}, NOW)[0], "shipped")
        post = facts(shipped_id="s1", shipped_at=NOW - DAY, published_id="p", published_at=published, commit="a")
        self.assertEqual(draft.decide(ON, post, {}, NOW)[0], "shipped")
        # Made before the last published release: that release had it.
        old = facts(kit_id="k1", kit_at=published - DAY, published_id="p", published_at=published, commit="a")
        self.assertEqual(draft.decide(ON, old, {}, NOW), (None, "nothing_due"))
        # Off on the phone.
        self.assertEqual(draft.decide(settings(on_shipped=False), kit, {}, NOW), (None, "nothing_due"))
        # The kit the last draft already saw, with one commit since: not shipped again.
        state = {"drafted_at": NOW - DAY / 2, "kit_id": "k1", "commit": "old", "published_id": "p"}
        self.assertEqual(draft.decide(ON, kit, state, NOW), (None, "nothing_due"))
        # A kit made after that draft is new.
        newer = facts(kit_id="k2", kit_at=NOW - 60, published_id="p", published_at=published, commit="a")
        self.assertEqual(draft.decide(ON, newer, state, NOW)[0], "shipped")

    def test_weekly_and_biweekly_count_from_the_later_of_the_release_and_the_draft(self):
        weekly, biweekly = settings(cadence="weekly"), settings(cadence="biweekly")

        def at(days_ago: float, **kw):
            return facts(commits=1, new_commits=1, commit="a", published_id="p", published_at=NOW - days_ago * DAY, **kw)

        self.assertEqual(draft.decide(weekly, at(6.9), {}, NOW), (None, "nothing_due"))
        self.assertEqual(draft.decide(weekly, at(7), {}, NOW)[0], "cadence")
        self.assertEqual(draft.decide(biweekly, at(13.9), {}, NOW), (None, "nothing_due"))
        self.assertEqual(draft.decide(biweekly, at(14), {}, NOW)[0], "cadence")
        # A draft three days ago is the later of the two: not a week yet.
        self.assertEqual(draft.decide(weekly, at(20), {"drafted_at": NOW - 3 * DAY, "commit": "old"}, NOW), (None, "nothing_due"))
        # Nothing new since the last published release: a release about nothing is not drafted.
        quiet = facts(commits=0, new_commits=0, commit="a", published_id="p", published_at=NOW - 30 * DAY)
        self.assertEqual(draft.decide(weekly, quiet, {}, NOW), (None, "nothing_due"))
        # No release and no draft yet: the week counts from when this Mac first saw the switch on.
        first = facts(commits=2, new_commits=2, commit="a")
        self.assertEqual(draft.decide(weekly, first, {}, NOW), (None, "nothing_due"))
        self.assertEqual(draft.decide(weekly, first, {"seen_at": NOW - 8 * DAY}, NOW)[0], "cadence")
        self.assertEqual(draft.decide(settings(cadence="none"), first, {"seen_at": NOW - 80 * DAY}, NOW), (None, "nothing_due"))

    def test_never_twice_for_one_state(self):
        f = facts(commits=50, new_commits=50, commit="a", published_id="p", published_at=NOW - 30 * DAY, kit_id="k", kit_at=NOW - DAY)
        state = {"drafted_at": NOW - 20 * DAY, **f.signature()}
        self.assertEqual(draft.decide(settings(cadence="weekly"), f, state, NOW), (None, "same_state"))
        f.commit = "b"
        self.assertEqual(draft.decide(settings(cadence="weekly"), f, state, NOW)[0], "commits")

    def test_a_project_with_drafts_off_never_drafts(self):
        for off in ({**ON, "drafts_to_phone": False}, {"project_key": KEY}, {**ON, "drafts_to_phone": "yes"}):
            self.assertEqual(draft.decide(off, facts(commits=99, new_commits=99, commit="a", kit_id="k", kit_at=NOW), {}, NOW), (None, "drafts_off"))


class Counting(Temp):
    """The count runs over the checkout's own history (HEAD), merges left out, from the later of
    the last published release and the last draft; a branch that was never merged is not in it."""

    def setUp(self):
        super().setUp()
        self.repo = Repo(self.root)
        self.shas = [self.repo.commit(f"feat: step {i}", T0 + 100 * i) for i in range(1, 5)]
        self.repo.git("checkout", "-q", "-b", "side")
        self.repo.commit("fix: on the side branch", T0 + 500)
        self.repo.git("checkout", "-q", "main")
        self.repo.commit("feat: on main", T0 + 600)
        self.repo.git("merge", "-q", "--no-ff", "side", "-m", "Merge branch 'side'", when=T0 + 700)
        self.repo.git("checkout", "-q", "-b", "parked")
        self.repo.commit("feat: parked, never merged", T0 + 800)
        self.repo.git("checkout", "-q", "main")

    def test_since_the_release_and_since_the_draft(self):
        # As the server writes it, between step 2 and step 3.
        published = {"id": "p", "published_at": dt.datetime.fromtimestamp(T0 + 250, dt.UTC).isoformat()}
        self.assertEqual(draft.unix(published["published_at"]), T0 + 250)
        f = draft.gather(KEY, self.repo.path, published, {})
        # step 3, step 4, the side branch and main; the merge is not a commit anyone wrote.
        self.assertEqual(f.commits, 4)
        self.assertEqual(f.new_commits, 4)
        self.assertEqual(f.subjects, ["feat: on main", "fix: on the side branch", "feat: step 4", "feat: step 3"])
        self.assertNotIn("feat: parked, never merged", f.subjects, "a release says what shipped")
        self.assertEqual(f.commit, self.repo.git("rev-parse", "HEAD"))
        f = draft.gather(KEY, self.repo.path, published, {"drafted_at": T0 + 450})
        self.assertEqual((f.commits, f.new_commits), (4, 2))
        # A draft older than the release: the release is the later of the two.
        f = draft.gather(KEY, self.repo.path, published, {"drafted_at": T0 + 150})
        self.assertEqual((f.commits, f.new_commits), (4, 4))
        f = draft.gather(KEY, self.repo.path, None, {})
        self.assertEqual((f.commits, f.published_id), (6, None))

    def test_a_build_post_written_before_the_release_lends_its_what_and_not_its_changes(self):
        from capture.demo import paths

        post = paths.private_dir(paths.work_dir(KEY)) / "shipped.json"
        post.write_text(json.dumps({"what": "A bus route finder for campus", "generated_at": "2026-05-28T20:00:00Z",
                                    "changes": [{"text": "Search a building by name", "evidence": None}]}))  # fmt: skip
        published = {"id": "p", "published_at": T0 + 250}
        os.utime(post, (T0 + 200, T0 + 200))
        f = draft.gather(KEY, self.repo.path, published, {})
        self.assertEqual((f.what, f.changes, f.shipped_id), ("A bus route finder for campus", [], "2026-05-28T20:00:00Z"))
        os.utime(post, (T0 + 300, T0 + 300))
        f = draft.gather(KEY, self.repo.path, published, {})
        self.assertEqual(f.changes, ["Search a building by name"])


# ------------------------------------------------------------------------ the rules' words


SUBJECTS = [
    "Merge pull request #12 from someone/branch",
    "chore(deps): bump the lockfile (#41)",
    "feat(map): add a stop search",
    "fix: crash when the list is empty.",
    "Map \u2014 faster pins on the 2020\u20132021 archive",
    "Search - by name, now with 3 filters",
    "fixup! feat(map): add a stop search",
    "docs: explain the release settings",
    "wip",
    "feat: " + "a very long subject that keeps on going " * 6,
    "Merge branch 'main' into feature",
    "refactor: split the settings screen",
    "Tidy",
]


class RulesWords(unittest.TestCase):
    def test_prefixes_come_off_and_merges_go(self):
        self.assertEqual(draft.clean_subject("feat(map): add a stop search"), (0, "Add a stop search"))
        self.assertEqual(draft.clean_subject("FEAT!: drop the old route"), (0, "Drop the old route"))
        self.assertEqual(draft.clean_subject("fix: crash when the list is empty."), (1, "Crash when the list is empty"))
        self.assertEqual(draft.clean_subject("chore(deps): bump the lockfile (#41)"), (3, "Bump the lockfile"))
        self.assertEqual(draft.clean_subject("Search a building by name"), (2, "Search a building by name"))
        for dropped in ("Merge pull request #12 from someone/branch", "Merge branch 'main' into feature",
                        "Merge remote-tracking branch 'origin/main'", "fixup! feat: add x", "squash! fix: y", "wip", "", "feat: "):  # fmt: skip
            self.assertIsNone(draft.clean_subject(dropped), dropped)
        # Features first, then fixes, then plain subjects, then the housekeeping; newest first within.
        self.assertEqual(draft.ranked(["docs: a b", "plain one", "fix: c d", "feat: e f", "feat: g h"]),
                         ["E f", "G h", "C d", "Plain one", "A b"])  # fmt: skip

    def test_the_rules_draft_keeps_every_bound(self):
        f = facts(commits=12, new_commits=12, commit="a", published_id="p", published_at=NOW - DAY, subjects=SUBJECTS)
        w = draft.write(f, use_model=False)
        self.assertEqual(w.source, "rules")
        self.assertEqual(w.title, "Add a stop search")
        self.assertLessEqual(len(w.title), draft.TITLE_MAX)
        self.assertLessEqual(len(w.highlights), draft.HIGHLIGHTS_MAX)
        self.assertTrue(all(0 < len(h) <= draft.HIGHLIGHT_MAX for h in w.highlights), w.highlights)
        self.assertNotIn("Add a stop search", w.highlights, "the title is not said twice")
        for h in w.highlights:
            self.assertFalse(h.endswith("."), h)
            self.assertTrue(h[0].isupper(), h)
            self.assertNotRegex(h, r"^(feat|fix|chore|docs|refactor)\b", h)
            self.assertNotIn("Merge", h)
        words = [w.title, w.notes, *w.highlights]
        self.assertFalse(any(plain.has_dash(t) for t in words), words)
        source = draft.build_input(f)
        self.assertEqual([t for t in words if numbers_unknown(t, source)], [])
        self.assertEqual(w.notes, "12 commits since the last release.")
        self.assertEqual(draft.problems(draft.body_of(f, w, "commits")), [])

    def test_a_long_subject_is_cut_at_a_word_and_a_long_first_one_stays_whole_as_a_highlight(self):
        long = "feat: " + "search every stop on campus by name " * 5
        w = draft.write(facts(commits=1, subjects=[long], published_id="p"), use_model=False)
        [whole] = w.highlights
        self.assertLessEqual(len(whole), draft.HIGHLIGHT_MAX)
        self.assertLessEqual(len(w.title), draft.TITLE_MAX)
        self.assertTrue(whole.startswith(w.title) and whole[len(w.title)] == " ", (w.title, whole))
        self.assertTrue(("search every stop on campus by name " * 5).startswith(whole.lower() + " "), whole)

    def test_a_first_release_with_a_build_post(self):
        f = facts(commits=3, subjects=["feat: add a stop search"], what="A bus route finder for campus",
                  changes=["Leave now times for every stop."], has_trailer=True, trailer_version=2)  # fmt: skip
        w = draft.write(f, use_model=False)
        self.assertEqual(w.title, "Add a stop search")
        self.assertEqual(w.notes, "A bus route finder for campus. Leave now times for every stop. "
                                  "3 commits so far, and this is the first release. It comes with a trailer.")  # fmt: skip
        body = draft.body_of(f, w, "asked")
        self.assertEqual((body["has_trailer"], body["trailer_version"], body["commits"]), (True, 2, 3))

    def test_the_build_posts_changes_are_the_highlights_when_no_subject_is_left(self):
        w = draft.write(facts(commits=1, subjects=["wip"], changes=["Search a building by name.", "Leave now times"], published_id="p"), use_model=False)
        self.assertEqual((w.title, w.highlights), ("Search a building by name", ["Leave now times"]))

    def test_nothing_to_say_is_no_draft(self):
        self.assertIsNone(draft.write(facts(commits=0, published_id="p", what="A bus route finder"), use_model=False))
        self.assertIsNone(draft.write(facts(commits=None, what="A bus route finder"), use_model=False))


# ------------------------------------------------------------------------ the checks


class Checks(unittest.TestCase):
    def setUp(self):
        self.f = facts(commits=4, new_commits=4, commit="a", published_id="p", published_at=NOW - DAY,
                       subjects=["feat: add a stop search", "fix: crash when the list is empty", "feat: leave now times"])  # fmt: skip

    def answer(self, **kw):
        doc = {"title": "Find your stop faster", "notes": "You can search stops now. The list no longer crashes.",
               "highlights": ["Search for a stop by name", "The list no longer crashes when it is empty"]}  # fmt: skip
        doc.update(kw)
        return lambda _source: doc

    def test_a_clean_answer_is_used(self):
        w = draft.write(self.f, call=self.answer())
        self.assertEqual((w.source, w.title, len(w.highlights)), ("model", "Find your stop faster", 2))

    def test_an_invented_number_in_the_title_throws_the_whole_answer_away(self):
        w = draft.write(self.f, call=self.answer(title="Search is 40% faster"))
        self.assertEqual(w.source, "rules")
        self.assertEqual(w.title, "Add a stop search")
        self.assertIn({"what": "answer", "code": "invented_number", "text": "Search is 40% faster"}, w.dropped)
        self.assertFalse(any("40" in t for t in [w.title, w.notes, *w.highlights]))

    def test_an_invented_number_in_a_sentence_or_a_highlight_deletes_that_one(self):
        w = draft.write(self.f, call=self.answer(notes="You can search stops now. It is 3 times faster.",
                                                 highlights=["Search for a stop by name", "Loads 2 seconds sooner"]))  # fmt: skip
        self.assertEqual(w.source, "model")
        self.assertEqual(w.notes, "You can search stops now.")
        self.assertEqual(w.highlights, ["Search for a stop by name"])
        self.assertEqual(sorted(d["code"] for d in w.dropped), ["invented_number", "invented_number"])
        # A number the input holds is said: the commit count.
        w = draft.write(self.f, call=self.answer(notes="4 commits since the last release."))
        self.assertEqual(w.notes, "4 commits since the last release.")

    def test_a_repository_name_is_never_said(self):
        names = ("quokkaroute",)
        w = draft.write(self.f, names, call=self.answer(title="Quokkaroute gets a stop search"))
        self.assertEqual(w.source, "rules")
        self.assertIn("names_a_repository", [d["code"] for d in w.dropped])
        w = draft.write(self.f, names, call=self.answer(highlights=["Quokkaroute finds stops", "Search for a stop by name"]))
        self.assertEqual((w.source, w.highlights), ("model", ["Search for a stop by name"]))
        # The rules' own words are held to the same check: a subject that names it is left out.
        f = facts(commits=2, published_id="p", subjects=["feat: quokkaroute search", "feat: leave now times"])
        w = draft.write(f, names, use_model=False)
        self.assertFalse(any("uokkaroute" in t for t in [w.title, w.notes, *w.highlights]))
        self.assertEqual(w.title, "Leave now times")

    def test_a_key_or_an_email_is_never_said(self):
        f = facts(commits=3, published_id="p", subjects=["fix: send logs to someone@example.com", f"feat: cache {KEY[:16]}", "feat: leave now times"])
        w = draft.write(f, use_model=False)
        self.assertEqual((w.title, w.highlights), ("Leave now times", []))
        self.assertEqual(sorted(d["code"] for d in w.dropped), ["carries_a_key", "carries_a_key"])

    def test_dashes_in_an_answer_are_rewritten_not_refused(self):
        w = draft.write(self.f, call=self.answer(title="Stops \u2014 faster", highlights=["Search - by name", "Crashes \u2013 gone"]))
        self.assertEqual(w.source, "model")
        self.assertFalse(any(plain.has_dash(t) for t in [w.title, w.notes, *w.highlights]), (w.title, w.highlights))

    def test_no_model_on_this_mac_is_the_rules_draft_and_says_why(self):
        from analysis import run as rn

        def down(_source):
            raise rn.AnalysisError("claude CLI not found on PATH")

        w = draft.write(self.f, call=down)
        self.assertEqual((w.source, w.no_model), ("rules", "claude CLI not found on PATH"))

    def test_the_schema_the_model_gets_has_the_servers_bounds(self):
        schema = json.loads(draft.SCHEMA_PATH.read_text())
        p = schema["properties"]
        self.assertEqual((p["title"]["maxLength"], p["notes"]["maxLength"]), (draft.TITLE_MAX, draft.NOTES_MAX))
        self.assertEqual((p["highlights"]["maxItems"], p["highlights"]["items"]["maxLength"]), (draft.HIGHLIGHTS_MAX, draft.HIGHLIGHT_MAX))
        self.assertEqual(sorted(schema["required"]), ["highlights", "notes", "title"])
        self.assertFalse(schema["additionalProperties"])


# ------------------------------------------------------------------------ the server


class Sending(Temp):
    def setUp(self):
        super().setUp()
        self.repo = Repo(self.root)
        for i in range(4):
            self.repo.commit(f"feat: step {i}" if i % 2 else f"fix: mend {i}", T0 + 100 * i)
        self.on = settings(every_commits=3)
        self.kit = {"document": {"trailer": {"version": 3, "seconds": 20, "scenes": ["open"]}}}

    def run_one(self, fake: Fake, **kw) -> dict:
        kw.setdefault("now", NOW)
        return draft.run_one(draft.Api("http://server", client=fake), KEY, self.repo.path, self.on, use_model=False, resolve=no_names, **kw)

    def test_the_put_carries_the_draft_and_the_state_is_kept_private(self):
        fake = Fake(kit=self.kit)
        out = self.run_one(fake)
        self.assertEqual(out["status"], "drafted", out)
        [body] = fake.puts()
        self.assertEqual((body["trigger"], body["commits"], body["has_trailer"], body["trailer_version"]), ("commits", 4, True, 3))
        self.assertEqual(draft.problems(body), [])
        self.assertEqual([p for m, p, _ in fake.calls if m == "PUT"], [f"/v1/projects/{KEY}/releases/draft"])
        p = draft.state_path(KEY)
        self.assertEqual(p, self.root / "demos" / "releases" / f"{KEY}.json")
        self.assertEqual(stat.S_IMODE(p.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(p.parent.stat().st_mode), 0o700)
        state = json.loads(p.read_text())
        self.assertEqual((state["drafted_at"], state["trigger"], state["commits"], state["release_id"], state["source"]),
                         (int(NOW), "commits", 4, "r-1", "rules"))  # fmt: skip
        self.assertEqual(state["commit"], self.repo.git("rev-parse", "HEAD"))
        # The same state a week later, with a weekly cadence due too: no second draft.
        again = draft.run_one(draft.Api("x", client=fake), KEY, self.repo.path, settings(cadence="weekly"), use_model=False,
                              resolve=no_names, now=NOW + 8 * DAY)  # fmt: skip
        self.assertEqual((again["status"], again["why"]), ("skipped", "same_state"))
        self.assertEqual(len(fake.puts()), 1)
        # One commit later the state is new, and the week has passed: the cadence drafts.
        self.repo.commit("feat: one more", int(NOW) + DAY)
        again = draft.run_one(draft.Api("x", client=fake), KEY, self.repo.path, settings(cadence="weekly"), use_model=False,
                              resolve=no_names, now=NOW + 8 * DAY)  # fmt: skip
        self.assertEqual((again["status"], again["trigger"]), ("drafted", "cadence"))
        self.assertEqual(fake.puts()[-1]["commits"], 5)

    def test_drafts_off_from_the_server_is_a_line_and_nothing_is_recorded(self):
        fake = Fake(put=(403, {"detail": "drafts_off"}), rows=[self.on])
        lines: list[str] = []
        outs = draft.check(draft.Api("x", client=fake), checkouts={KEY: self.repo.path}, resolve=no_names, use_model=False,
                           now=NOW, say=lines.append, quiet=True)  # fmt: skip
        self.assertEqual([o["status"] for o in outs], ["refused"])
        self.assertEqual(len(lines), 1)
        self.assertIn("drafts are off", lines[0])
        self.assertIn("(drafts_off)", lines[0])
        self.assertNotIn("drafted_at", draft.load_state(KEY))
        # Tried again at the next check, since the owner may turn it back on.
        draft.check(draft.Api("x", client=fake), checkouts={KEY: self.repo.path}, resolve=no_names, use_model=False, now=NOW, say=lines.append)
        self.assertEqual(len(fake.puts()), 2)

    def test_a_refusal_for_good_is_not_sent_again_for_the_same_state(self):
        fake = Fake(put=(422, {"detail": "empty_title"}))
        self.assertEqual(self.run_one(fake)["why"], "empty_title")
        self.assertEqual(draft.load_state(KEY)["refused"], "empty_title")
        self.assertEqual(self.run_one(fake)["why"], "same_state")
        self.assertEqual(len(fake.puts()), 1)

    def test_only_the_projects_with_drafts_on_are_read(self):
        other = "ef" * 32
        fake = Fake(rows=[{**ON, "drafts_to_phone": False}, {"project_key": other, "every_commits": 3}])
        lines: list[str] = []
        self.assertEqual(draft.check(draft.Api("x", client=fake), checkouts={KEY: self.repo.path, other: self.repo.path},
                                     resolve=no_names, now=NOW, say=lines.append), [])  # fmt: skip
        self.assertEqual([p for _, p, _ in fake.calls], ["/v1/me/release-settings"])
        self.assertIn("no project has drafts", lines[0])

    def test_a_project_with_no_checkout_here_is_skipped(self):
        fake = Fake()
        outs = draft.check(draft.Api("x", client=fake), checkouts={}, resolve=no_names, now=NOW, say=lambda _m: None)
        self.assertEqual([(o["status"], o["why"]) for o in outs], [("skipped", "no_checkout")])
        self.assertEqual(fake.puts(), [])

    def test_a_server_that_does_not_answer_is_a_line(self):
        class Down:
            def _authorized(self, *a):
                raise OSError("connection refused")

        lines: list[str] = []
        self.assertEqual(draft.check(draft.Api("x", client=Down()), say=lines.append), [])
        self.assertEqual(lines, ["  releases: the server did not answer (connection refused)"])

    def test_a_dry_run_sends_and_records_nothing(self):
        fake = Fake()
        out = self.run_one(fake, dry_run=True)
        self.assertEqual((out["status"], out["body"]["commits"]), ("dry_run", 4))
        self.assertEqual(fake.puts(), [])
        self.assertFalse(draft.state_path(KEY).exists())

    def test_the_last_published_release_is_the_newest_one(self):
        fake = Fake(published=[{"id": "a", "published_at": "2026-05-28T20:05:00+00:00"},
                               {"id": "b", "published_at": "2026-05-28T20:20:00+00:00"},
                               {"id": "c", "published_at": None}])  # fmt: skip
        self.assertEqual(draft.Api("x", client=fake).last_published(KEY)["id"], "b")
        self.assertEqual(fake.calls[0][1], f"/v1/me/releases?status=published&project_key={KEY}")


class Cli(Temp):
    def setUp(self):
        super().setUp()
        self.repo = Repo(self.root)
        for i in range(4):
            self.repo.commit(f"feat: step {i}", T0 + 100 * i)

    def main(self, argv: list[str], fake: Fake) -> tuple[int, str]:
        real = draft.Api
        out = io.StringIO()
        with (mock.patch.object(draft, "Api", lambda server: real(server, client=fake)), mock.patch.object(draft, "names_for_checkout", no_names),
              contextlib.redirect_stdout(out), contextlib.redirect_stderr(out)):  # fmt: skip
            rc = rcli.main(argv)
        return rc, out.getvalue()

    def test_the_verb_is_claimed_before_the_demo_parser(self):
        self.assertTrue(rcli.claims(["release", "draft"]))
        self.assertFalse(rcli.claims(["demo", "kit"]))
        self.assertFalse(rcli.claims([]))

    def test_draft_asked_prints_it_and_sends_it(self):
        fake = Fake()
        rc, text = self.main(["draft", str(self.repo.path), "--no-model"], fake)
        self.assertEqual(rc, 0, text)
        self.assertIn("release draft (asked, rules words)", text)
        self.assertIn("sent: it is the project's draft on the phone now", text)
        self.assertEqual(fake.puts()[0]["trigger"], "asked")

    def test_a_dry_run_prints_and_sends_nothing(self):
        fake = Fake()
        rc, text = self.main(["draft", str(self.repo.path), "--no-model", "--dry-run"], fake)
        self.assertEqual(rc, 0, text)
        self.assertIn("dry run: nothing was sent and nothing was recorded", text)
        self.assertEqual(fake.puts(), [])
        self.assertFalse((self.root / "demos" / "releases").exists())

    def test_drafts_off_is_a_line_and_an_exit_code(self):
        rc, text = self.main(["draft", str(self.repo.path), "--no-model"], Fake(put=(403, {"detail": "drafts_off"})))
        self.assertEqual(rc, 1)
        self.assertIn("drafts are off for this project", text)
        self.assertNotIn("Traceback", text)

    def test_through_the_capture_command(self):
        from capture import cli

        with mock.patch("capture.shipkit.watch.known_checkouts", lambda: {}), contextlib.redirect_stderr(io.StringIO()) as err:
            self.assertEqual(cli.main(["release", "draft", "--key", "not-a-key", "--dry-run", "--no-model"]), 2)
        self.assertIn("not a project key", err.getvalue())


# ------------------------------------------------------------------------ the worker


class Worker(Temp):
    def test_due_at_most_every_ten_minutes(self):
        t = [0.0]
        due = draft.Due(draft.CHECK_EVERY, clock=lambda: t[0])
        self.assertTrue(due())
        t[0] = 599.0
        self.assertFalse(due())
        t[0] = 600.0
        self.assertTrue(due())
        self.assertFalse(due())
        self.assertEqual(draft.CHECK_EVERY, 600)

    def test_the_worker_checks_releases_and_an_error_is_one_line(self):
        from capture.shipkit import watch

        calls: list[dict] = []

        def boom(api, **kw):
            calls.append(kw)
            raise RuntimeError("boom")

        a = argparse.Namespace(server="http://127.0.0.1:9", dry_run=False, once=True, every=0.0, no_model=True, publish_requests=False)
        out = io.StringIO()
        with mock.patch.object(draft, "check", boom), mock.patch.object(watch, "lock", object), contextlib.redirect_stdout(out):
            self.assertEqual(watch.main(a), 0)
        self.assertEqual(len(calls), 1)
        self.assertEqual((calls[0]["use_model"], calls[0]["quiet"]), (False, True))
        self.assertIn("  releases: not checked (boom)\n", out.getvalue())
        self.assertIn("nothing waiting", out.getvalue())


# ------------------------------------------------------------------------ held to the server


class TheServersRules(unittest.TestCase):
    def test_the_bounds_and_enums_are_the_servers(self):
        """server/builder/releases.py is read as text (capture imports nothing of the server)."""
        tree = ast.parse((REPO / "server" / "builder" / "releases.py").read_text())
        values = {t.id: ast.literal_eval(n.value) for n in tree.body if isinstance(n, ast.Assign)
                  for t in n.targets if isinstance(t, ast.Name) and t.id.isupper() and isinstance(n.value, (ast.Constant, ast.Tuple, ast.Dict))}  # fmt: skip
        for name in ("TRIGGERS", "CADENCES", "TITLE_MAX", "NOTES_MAX", "HIGHLIGHTS_MAX", "HIGHLIGHT_MAX", "EVERY_COMMITS", "DEFAULT_SETTINGS"):
            self.assertEqual(getattr(draft, name), values[name], name)

    def test_every_outcome_and_prompt_says_it_without_a_dash(self):
        for text in [*draft.SAYS.values(), draft.PROMPT_PATH.read_text(), json.loads(draft.SCHEMA_PATH.read_text())["description"]]:
            self.assertFalse(plain.has_dash(text), text)


if __name__ == "__main__":
    unittest.main()
