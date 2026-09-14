"""The three new commands as a person reads them: `wrapped`, `live` and `vocab`.

The modules test their own strings. These test what the CLI adds around them: the numbers
block, the refusals, the order, and that nothing the printers write carries a dash
(docs/approved-roadmap.md rule 2, enforced here a fourth time for the terminal surface).
They also pin the integration the printers rest on: the corpus cut now fills the burn
fields, a single transcript file is a corpus of one, and `live` finds a running sitting,
skips a stale file, and says why when nothing is running.
"""

from __future__ import annotations

import contextlib
import copy
import dataclasses
import datetime as dt
import io
import json
import os
import pathlib
import tempfile
import time
import unittest
import uuid

from analysis import __main__ as cli
from analysis import burn, live, plain, vocab
from analysis import wrapped as wr
from analysis.tests import test_live as tl
from analysis.tests import test_vocab as tv
from analysis.tests import test_wrapped as tw

SID = "5b1f6c2e-0000-4000-8000-00000000c1c1"


def printed(fn, *args, **kw) -> str:
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        fn(*args, **kw)
    return buf.getvalue()


class _Case(unittest.TestCase):
    def assertNoDash(self, text: str, skip: tuple[str, ...] = ()):
        for line in text.splitlines():
            if any(s in line for s in skip):
                continue
            self.assertFalse(plain.has_dash(line), repr(line))


# ------------------------------------------------------------------------------ transcripts


def _iso(ts: float) -> str:
    return dt.datetime.fromtimestamp(ts, dt.UTC).isoformat().replace("+00:00", "Z")


def records(base: float, sid: str = SID, end_turn: bool = True, ids: str = "", cwd: str = "/nonexistent/repo") -> list[dict]:
    """A small Claude Code sitting at absolute times from `base`: a prompt, a read, a failing
    test run, a command answered ok, and (unless `end_turn` is False) closing text that
    hands the turn back. `ids` prefixes every message and call id, so two sittings in one
    file are two sets of messages; `cwd` is the directory every record was stamped with."""
    out: list[dict] = []
    parent = None

    def rec(t: float, body: dict) -> None:
        nonlocal parent
        u = str(uuid.uuid4())
        out.append(
            {
                "uuid": u,
                "parentUuid": parent,
                "sessionId": sid,
                "cwd": cwd,
                "timestamp": _iso(base + t),
                **body,
            }
        )
        parent = u

    usage = {
        "input_tokens": 10,
        "output_tokens": 5,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 100,
    }

    def said(t, mid, blocks, stop):
        rec(
            t,
            {
                "type": "assistant",
                "message": {
                    "id": mid,
                    "role": "assistant",
                    "model": "claude-opus-5",
                    "stop_reason": stop,
                    "usage": usage,
                    "content": blocks,
                },
            },
        )

    def result(t, tid, content, is_error=False):
        block = {"type": "tool_result", "tool_use_id": tid, "content": content, "is_error": is_error}
        rec(t, {"type": "user", "message": {"role": "user", "content": [block]}})

    rec(0, {"type": "user", "promptSource": "typed", "message": {"role": "user", "content": "fix the parser"}})
    said(2, f"{ids}m1", [{"type": "tool_use", "id": f"{ids}t1", "name": "Read", "input": {"file_path": f"{cwd}/p.py"}}], "tool_use")
    result(3, f"{ids}t1", "def parse(): pass")
    said(5, f"{ids}m2", [{"type": "tool_use", "id": f"{ids}t2", "name": "Bash", "input": {"command": "pytest -q"}}], "tool_use")
    result(9, f"{ids}t2", "FAILED test_p.py::test_parse", is_error=True)
    said(11, f"{ids}m3", [{"type": "tool_use", "id": f"{ids}t3", "name": "Bash", "input": {"command": "ls"}}], "tool_use")
    result(12, f"{ids}t3", "p.py")
    if end_turn:
        said(14, f"{ids}m4", [{"type": "text", "text": "The parse test fails on empty input."}], "end_turn")
    return out


#: One sitting of `records`: four assistant messages, each 10 + 5 + 0 + 100 tokens.
SITTING_TOKENS = 4 * 115


def write(root: pathlib.Path, recs: list[dict], project: str = "-nonexistent-repo", sid: str = SID) -> pathlib.Path:
    d = root / project
    d.mkdir(parents=True, exist_ok=True)
    path = d / f"{sid}.jsonl"
    path.write_text("".join(json.dumps(r) + "\n" for r in recs))
    return path


# ------------------------------------------------------------------------------ wrapped


class Wrapped(_Case):
    def result(self, **kw):
        facts, sessions = tw.corpus(*tw.rich())
        return wr.wrapped(facts, sessions, **tw.rich_kw(**kw))

    def test_every_card_prints_its_question_and_its_answer_or_its_reason(self):
        res = self.result()
        text = printed(cli._print_wrapped, res)
        for i, c in enumerate(res["cards"], 1):
            self.assertIn(f"{i:>2}  {c['question']}", text)
            if c["reason"] is None:
                self.assertIn(c["display"], text)
                self.assertIn(c["sentence"], text)
            else:
                self.assertIn(f"not yet: {c['reason']}", text)
        answered = sum(1 for c in res["cards"] if c["reason"] is None)
        self.assertIn(f"{answered} of 15 answered.", text)
        self.assertNoDash(text)

    def test_numbers_come_before_the_first_card(self):
        text = printed(cli._print_wrapped, self.result())
        self.assertLess(text.index("sessions,"), text.index(wr.QUESTIONS[wr.CARD_IDS[0]]))

    def test_quotes_print_only_when_asked(self):
        without = printed(cli._print_wrapped, self.result())
        with_q = printed(cli._print_wrapped, self.result(quotes=True))
        quotes = self.result(quotes=True)["quotes"]
        self.assertTrue(quotes)
        for q in quotes.values():
            self.assertNotIn(q["text"], without)
            self.assertIn(q["text"], with_q)
        for sentinel in tw.SENTINELS:
            self.assertNotIn(sentinel, without)

    def test_an_empty_corpus_prints_every_refusal_and_no_zero(self):
        text = printed(cli._print_wrapped, wr.wrapped([], []))
        self.assertEqual(text.count("not yet: "), 15)
        self.assertIn("0 of 15 answered.", text)
        self.assertNoDash(text)


# ------------------------------------------------------------------------------ live


def entry(state: dict, **over) -> dict:
    e = {
        "transcript": "/root/-p/x.jsonl",
        "repo": "github.com/me/app",
        "attended_s": 300,
        "autonomous_s": 215,
        "unattended": False,
        "background": None,
        "state": state,
    }
    e.update(over)
    return e


def doc(*entries, ended=None, reason=None, moved=None) -> dict:
    return {
        "now": tl.T0,
        "where": "/root",
        "sessions": list(entries),
        "ended": ended,
        "reason": reason,
        "moved": moved,
    }


class Live(_Case):
    def test_every_scenario_prints_numbers_then_its_sentence_last(self):
        for names in (False, True):
            for name, st in tl.scenario_states(names=names).items():
                text = printed(cli._print_live, doc(entry(st)), names=names)
                last = [ln for ln in text.splitlines() if ln.strip()][-1].strip()
                self.assertEqual(last, live.sentence(st, names=names) + ".", name)
                self.assertIn(f"needs you: {st['needs_you']['score']} of 100", text, name)
                # Words for the engine's ids, never the ids (FOUND IN REVIEW).
                self.assertNotIn("causes:", text, name)
                self.assertNotIn("segment", text, name)
                self.assertIn("evidence", text, name)
                self.assertNoDash(text)

    def test_the_numbers_block_says_seconds_exactly(self):
        """`feedback._mins` rounds and `live.sentence` floors: 215 s printed "4 minutes"
        above "three minutes". The block prints the measurement itself."""
        st = copy.deepcopy(tl.scenario_states()["waiting_question"])
        st["activity"]["since_s"] = 215
        text = printed(cli._print_live, doc(entry(st)))
        self.assertIn("for 3m 35s", text)
        self.assertIn("active            8m 35s, 5m 00s of it with you", text)

    def test_an_answered_eta_prints_every_quartile(self):
        st = copy.deepcopy(tl.scenario_states()["converging"])
        history = [tl.fact(i, 600.0 + 60 * i) for i in range(12)]
        st["eta"] = tl.eta(history, elapsed=150.0)
        self.assertIsNone(st["eta"]["reason"])
        text = printed(cli._print_live, doc(entry(st)))
        self.assertRegex(text, r"eta +about \d+ minutes left; typical \d+ minutes")
        self.assertIn("over 12 finished sessions on this repository", text)
        text = printed(cli._print_live, doc(entry(st, unattended=True)))
        self.assertIn("over 12 finished unattended runs", text)

    def test_decisions_print_with_their_count(self):
        st = copy.deepcopy(tl.scenario_states()["converging"])
        st["decisions"] = [
            {"kind": "reverted_changes", "ts": tl.T0, "evidence": {"event_n": 3, "count": 2}},
            {"kind": "added_dependency", "ts": tl.T0, "evidence": {"event_n": 5, "count": 1}, "detail": "redis"},
        ]
        text = printed(cli._print_live, doc(entry(st)))
        self.assertIn("Threw away uncommitted changes.  (2 times)", text)
        self.assertIn("Added a dependency.", text)
        self.assertNotIn("redis", text)
        self.assertIn("Added redis.", printed(cli._print_live, doc(entry(st)), names=True))

    def test_several_sessions_say_the_order(self):
        states = tl.scenario_states()
        text = printed(cli._print_live, doc(entry(states["starting"]), entry(states["waiting_question"])))
        self.assertIn("2 sessions in /root, the one that needs you most first", text)

    def test_nothing_running_says_why_and_that_nothing_needs_you(self):
        text = printed(
            cli._print_live,
            doc(reason="2 transcripts moved in the last hour, and every sitting in them has ended", moved=2),
        )
        self.assertIn("NOTHING IS RUNNING", text)
        self.assertIn("2 transcripts moved in the last hour, and every sitting in them has ended. Nothing needs you.", text)
        self.assertNoDash(text)

    def test_an_ended_transcript_is_labelled_as_it_ended(self):
        st = tl.scenario_states()["done_after_commit"]
        text = printed(
            cli._print_live,
            doc(ended=entry(st), reason="its last sitting ended 3 days ago, at 2026-09-10 22:39"),
        )
        self.assertIn("NOT RUNNING", text)
        self.assertIn("Its last sitting ended 3 days ago, at 2026-09-10 22:39. As it stood when it ended:", text)

    def test_clock_and_ago(self):
        self.assertEqual([cli._clock(s) for s in (0, 45, 215, 3725)], ["0s", "45s", "3m 35s", "1h 02m 05s"])
        self.assertEqual(cli._ago(20), "just now")
        self.assertEqual(cli._ago(600), "10 minutes ago")
        self.assertEqual(cli._ago(3 * 86400 + 5), "3 days ago")
        self.assertEqual(cli._ago(3600, bare=True), "hour")


class LiveEndToEnd(_Case):
    """`_live_doc` over transcripts on disk: the reference cut, the mtime prefilter, the
    snapshot of an ended sitting, and the refusal when nothing runs."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name)
        self.tz = dt.datetime.now().astimezone().tzinfo

    def tearDown(self):
        self.tmp.cleanup()

    def test_a_running_sitting_is_found_and_an_old_file_is_not(self):
        now = time.time()
        write(self.root, records(now - 60), project="-p-live")
        old = write(self.root, records(now - 3 * 86400), project="-p-old", sid="5b1f6c2e-0000-4000-8000-00000000c1c2")
        os.utime(old, (now - 3 * 86400, now - 3 * 86400))
        d = cli._live_doc(None, self.root, [], tl.SALT, self.tz, now, names=False)
        self.assertEqual(d["moved"], 1)
        self.assertEqual(len(d["sessions"]), 1)
        st = d["sessions"][0]["state"]
        # `end_turn` handed it back 46 s ago: waiting on you, from the parser's stop_reason.
        self.assertEqual((st["activity"]["kind"], st["verdict"]["state"]), ("waiting_on_you", "waiting"))
        self.assertEqual(d["sessions"][0]["background"], 0)
        self.assertIsNone(d["reason"])
        text = printed(cli._print_live, d)
        self.assertIn("RUNNING NOW   1 session", text)
        self.assertNoDash(text)

    def test_nothing_running_is_a_reason_not_an_empty_page(self):
        now = time.time()
        d = cli._live_doc(None, self.root, [], tl.SALT, self.tz, now, names=False)
        self.assertEqual((d["sessions"], d["moved"]), ([], 0))
        self.assertEqual(d["reason"], "no transcript was written to in the last hour")

    def test_one_ended_transcript_is_a_snapshot_at_its_end(self):
        now = time.time()
        path = write(self.root, records(now - 3 * 86400 - 3600))
        d = cli._live_doc(path, self.root, [], tl.SALT, self.tz, now, names=True)
        self.assertEqual(d["sessions"], [])
        self.assertIsNotNone(d["ended"])
        self.assertTrue(d["reason"].startswith("its last sitting ended 3 days ago, at "), d["reason"])
        self.assertLessEqual(d["ended"]["ended_at"], now)
        self.assertIn("names", d["ended"]["state"])

    def test_a_running_transcript_named_directly(self):
        now = time.time()
        path = write(self.root, records(now - 30, end_turn=False))
        d = cli._live_doc(path, self.root, [], tl.SALT, self.tz, now, names=False)
        self.assertEqual(len(d["sessions"]), 1)
        self.assertIsNone(d["ended"])


# ------------------------------------------------------------------------------ vocab


class Vocab(_Case):
    def result(self, sessions):
        return {
            "glossary": vocab.glossary(sessions),
            "stack": vocab.stack(sessions, dependencies=["fastapi", "left-pad"]),
            "titles": [
                {"session_id": s.session_id, "started_at": s.started_at, **vocab.session_title(s)}
                for s in sessions
            ],
        }

    def sessions(self):
        return [
            tv.sess(
                [
                    tv.prompt(1, "ship it"),
                    tv.sh(2, "git commit -m x"),
                    tv.edit(3, "/repo/src/a.py", 30),
                    tv.sh(4, "pytest -q"),
                ],
                sid="a",
            ),
            tv.sess([tv.prompt(10, "look")], sid="b"),
        ]

    def test_numbers_then_stack_then_titles_then_the_glossary(self):
        res = self.result(self.sessions())
        text = printed(cli._print_vocab, res)
        order = [text.index(k) for k in ("words earned", "STACK", "THE LAST 2 SESSIONS", "GLOSSARY")]
        self.assertEqual(order, sorted(order))
        for t in res["glossary"]["terms"]:
            self.assertIn(t["definition"], text)
        self.assertIn(f"{res['glossary']['locked_count']} more to find.", text)
        # A title refusal prints its reason, never a blank.
        self.assertIn("not titled: no tool calls in this session", text)
        # A manifest string the catalog does not know never reaches the page.
        self.assertNotIn("left-pad", text)
        self.assertIn("FastAPI", text)
        self.assertNoDash(text)

    def test_nothing_read_prints_the_reason_not_none_more_to_find(self):
        text = printed(cli._print_vocab, self.result([]))
        self.assertIn("not yet: no session had any events to read", text)
        self.assertNotIn("None", text)
        self.assertNotIn("more to find", text)


# ------------------------------------------------------------------------------ burn


class Burn(_Case):
    def test_the_printer_has_no_dash_and_no_zero_it_did_not_measure(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = write(pathlib.Path(tmp), records(tl.T0))
            text = printed(cli._print_burn, burn.burn_report(path))
        self.assertIn("tokens            ", text)
        self.assertNotIn("+0 lines", text)
        self.assertNoDash(text)

    def test_an_empty_transcript_says_why(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp) / "e.jsonl"
            path.write_text("")
            text = printed(cli._print_burn, burn.burn_report(path))
        self.assertIn("not shown: the transcript held no readable events", text)
        self.assertNotIn("None", text)
        self.assertNotIn("writes no token counts", text)


# ------------------------------------------------------------------------------ the corpus cut


class CorpusCut(unittest.TestCase):
    def test_a_file_is_a_corpus_of_one_and_the_burn_fields_are_filled(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            path = write(root, records(tl.T0))
            by_dir, _ = cli._corpus_facts(root)
            by_file, kept = cli._corpus_facts(path)
            self.assertEqual([f.session_id for f in by_dir], [f.session_id for f in by_file])
            self.assertEqual(len(by_file), 1)
            f, s = by_file[0], kept[0]
            want = burn.session_burn_detail(s.events, burn.load_turns(path))
            self.assertIsNotNone(want)
            self.assertEqual(
                (f.burn_tokens, f.barren_tokens, f.unreadable_tokens),
                (want["tokens"], want["barren"], want["unreadable"]),
            )

    def test_a_transcript_with_no_counts_leaves_them_absent(self):
        recs = records(tl.T0)
        for r in recs:
            if r["type"] == "assistant":
                r["message"].pop("usage")
        with tempfile.TemporaryDirectory() as tmp:
            facts, _ = cli._corpus_facts(write(pathlib.Path(tmp), recs))
        self.assertEqual(
            (facts[0].burn_tokens, facts[0].barren_tokens, facts[0].unreadable_tokens),
            (None, None, None),
        )


if __name__ == "__main__":
    unittest.main()


# ------------------------------------------------------------------------------ review fixes


def _git_repo(root: pathlib.Path, origin: str) -> pathlib.Path:
    """A real repository with an `origin`, so capture resolves an identity for it."""
    import subprocess

    repo = root / "repo"
    repo.mkdir()
    who = {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"}
    for args in (["init", "-q"], ["commit", "-q", "--allow-empty", "-m", "init"], ["remote", "add", "origin", origin]):
        subprocess.run(["git", *args], cwd=repo, check=True, env={**os.environ, **who}, capture_output=True)
    return repo


class ReviewCorpusCut(unittest.TestCase):
    """What the corpus cut guarantees every card, found in the adversarial review
    (2026-09-13). Each test fails on the code as it stood."""

    def test_each_sitting_is_charged_only_its_own_turns(self):
        """The window END is the only thing that keeps a sitting's burn to that sitting.
        MEASURED (FOUND IN REVIEW): with the end dropped, the corpus burn read 45.8B tokens
        where it is 4.2B (10.98x) and 142 of 158 sittings changed; nothing tested it."""
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            recs = records(tl.T0, ids="a") + records(tl.T0 + 12 * 3600, ids="b")
            write(root, recs)
            facts, kept = cli._corpus_facts(root)
        self.assertEqual(len(facts), 2)
        self.assertEqual([f.burn_tokens for f in facts], [SITTING_TOKENS, SITTING_TOKENS])

    def test_a_resumed_copy_is_counted_once(self):
        """A resumed session's new transcript begins with a copy of the old one's records
        (same uuid, timestamp and message id, the new session id), and the sessionizer
        pools both files into one sitting. MEASURED (FOUND IN REVIEW): 5 of 158 corpus
        sittings counted the copies again, three of them exactly 2x in tokens, with 907
        agent lines and 5 prompts."""
        old_sid, new_sid = "5b1f6c2e-0000-4000-8000-00000000aaaa", "5b1f6c2e-0000-4000-8000-00000000bbbb"
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            first = records(tl.T0, sid=old_sid, ids="a")
            write(root, first, sid=old_sid)
            copied = [dict(r, sessionId=new_sid) for r in copy.deepcopy(first)]
            more = records(tl.T0 + 60, sid=new_sid, ids="b")
            more[0]["parentUuid"] = copied[-1]["uuid"]
            write(root, copied + more, sid=new_sid)
            facts, kept = cli._corpus_facts(root)
        self.assertEqual(len(facts), 1, "the two files are one sitting")
        f = facts[0]
        self.assertEqual(f.burn_tokens, 2 * SITTING_TOKENS)
        self.assertEqual((f.prompt_count, sum(f.tool_calls.values())), (2, 6))
        self.assertEqual(len({(e.kind, e.tool_id) for e in kept[0].events if e.tool_id}), sum(1 for e in kept[0].events if e.tool_id))

    def test_an_excluded_repository_is_in_no_corpus_and_no_live_view(self):
        """privacy/upload-contract.json: an excluded repo produces ZERO uploads. FOUND IN
        REVIEW: `live.wire` built a full state for a session in an excluded repository, and
        wrapped and vocab counted it."""
        now = time.time()
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            repo = _git_repo(root, "https://github.com/me/secret-app.git")
            projects = root / "projects"
            live_path = write(projects, records(now - 60, cwd=str(repo)), project="-p-live")
            write(projects, records(tl.T0, cwd=str(repo), ids="x"), project="-p-old", sid="5b1f6c2e-0000-4000-8000-00000000c1c3")
            tz = dt.datetime.now().astimezone().tzinfo
            before = os.environ.get("BUILDER_CAPTURE_EXCLUDE")
            try:
                os.environ.pop("BUILDER_CAPTURE_EXCLUDE", None)
                facts, _ = cli._corpus_facts(projects, lean=True)
                self.assertEqual(len(facts), 1)
                self.assertEqual(len(cli._live_doc(None, projects, [], tl.SALT, tz, now, names=False)["sessions"]), 1)
                os.environ["BUILDER_CAPTURE_EXCLUDE"] = "https://github.com/me/secret-app.git"
                facts, _ = cli._corpus_facts(projects, lean=True)
                self.assertEqual(facts, [])
                d = cli._live_doc(None, projects, [], tl.SALT, tz, now, names=False)
                self.assertEqual(d["sessions"], [])
                one = cli._live_doc(live_path, projects, [], tl.SALT, tz, now, names=False)
                self.assertEqual((one["sessions"], one["ended"]), ([], None))
                self.assertEqual(one["reason"], "its repository is excluded, so nothing about it is shown")
                self.assertNotIn("secret", json.dumps(cli._live_wire(one)))
            finally:
                if before is None:
                    os.environ.pop("BUILDER_CAPTURE_EXCLUDE", None)
                else:
                    os.environ["BUILDER_CAPTURE_EXCLUDE"] = before

    def test_a_sitting_is_never_its_own_history_and_an_ended_one_has_no_eta(self):
        """The ETA compares against OTHER finished sessions; an ended sitting's is refused
        with the time it ran (FOUND IN REVIEW: "about 24 minutes left" for a sitting that
        ended 13 days ago)."""
        now = time.time()
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            repo = _git_repo(root, "https://github.com/me/app.git")
            path = write(root / "projects", records(now - 60, cwd=str(repo)))
            tz = dt.datetime.now().astimezone().tzinfo
            from analysis import live as lv_mod
            from capture import discover

            t = discover.Transcript(project_dir=path.parent.name, path=path)
            sess = lv_mod.current_session(t, now, tz)
            common = sess.repo.common_root
            others = [tl.fact(i, 600.0, repo=common) for i in range(9)]
            itself = dataclasses.replace(tl.fact(99, 600.0, repo=common), session_id=sess.client_session_id)
            e = cli._live_entry(t, sess, [*others, itself], tl.SALT, now, names=False)
            self.assertEqual(e["state"]["eta"]["reason"], "9 finished sessions on this repository, 10 needed")
            ended = cli._live_entry(t, sess, others, tl.SALT, now, names=False, ended=True)
            self.assertTrue(ended["state"]["eta"]["reason"].startswith("this session has ended, after "))
            self.assertIsNone(ended["state"]["eta"]["remaining_s"])
            # The LOCAL state says why; the wire has no form for it. Its refusal is a
            # sentence where the spec holds an enum, and `needed` and `unattended` are null
            # where the spec requires them, and no ended sitting's live block can leave the
            # machine anyway (`capture.sessions.attach_live` raises on a final).
            self.assertIsNone(ended["state"]["eta"]["needed"])
            w = cli._live_wire({"sessions": [e], "ended": ended})
            self.assertIsNone(w["ended"])
            self.assertEqual(w["sessions"], [lv_mod.wire(e["state"])])

    def test_a_file_that_cannot_be_read_leaves_background_absent(self):
        """None when any file of the sitting cannot be read: absent, not zero, so
        `live_state` keeps the digest's lower bound rather than hear "nothing is out" from
        a file it never opened."""
        now = time.time()
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            path = write(root, records(now - 60))
            from analysis import live as lv_mod
            from capture import discover

            t = discover.Transcript(project_dir=path.parent.name, path=path)
            sess = lv_mod.current_session(t, now, dt.datetime.now().astimezone().tzinfo)
            self.assertEqual(cli._live_entry(t, sess, [], tl.SALT, now, names=False)["background"], 0)
            sess.records.append({**sess.records[-1], "path": str(root / "gone.jsonl")})
            self.assertIsNone(cli._live_entry(t, sess, [], tl.SALT, now, names=False)["background"])

    def test_history_is_cut_only_when_a_sitting_needs_it(self):
        """FOUND IN REVIEW: `live` cut the whole history, commit attribution and burn
        included, before it knew anything was running (22.5 s to print "NOTHING IS
        RUNNING")."""
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            write(root, records(tl.T0))
            history = cli._History(root)
            d = cli._live_doc(None, root, history, tl.SALT, dt.UTC, time.time(), names=False)
            self.assertEqual(d["sessions"], [])
            self.assertIsNone(history._facts, "nothing ran, so nothing was cut")
            lean = history.facts()
            self.assertEqual([f.burn_tokens for f in lean], [None])  # lean: no burn


class ReviewMapSalt(unittest.TestCase):
    def test_the_salt_is_random_private_and_stable(self):
        """FOUND IN REVIEW: the salt was a hash of the raw machine identifier, and the
        uploaded `machine_id` is another hash of it, so a guessable `BUILDER_MACHINE_ID`
        let a server recover the salt and reverse wire file ids by dictionary."""
        from capture import identity

        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp) / "builder" / "map-salt"
            a = cli._map_salt(path)
            b = cli._map_salt(path)
            self.assertEqual(a, b)
            self.assertGreaterEqual(len(a), live.SALT_MIN_CHARS)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertNotEqual(a, identity.sha256_hex("builder-map-salt:" + identity.raw_machine_identifier()))
            other = pathlib.Path(tmp) / "elsewhere" / "map-salt"
            self.assertNotEqual(cli._map_salt(other), a, "two machines never share one")
            path.write_text("short\n")
            self.assertNotEqual(cli._map_salt(path), "short")


class ReviewPrinters(_Case):
    """The terminal copy, FOUND IN REVIEW: nouns that did not agree with their numbers,
    internal ids, and a zero nobody measured."""

    def test_one_of_anything_is_singular(self):
        res = wr.wrapped(*tw.corpus(tw.attended_trio()[0]))
        self.assertIn("WRAPPED   1 session, 1 with you there", printed(cli._print_wrapped, res))
        st = copy.deepcopy(tl.scenario_states()["starting"])
        st["map"]["files"] = st["map"]["files"][:1]
        st["timelapse"] = st["timelapse"][:1]
        text = printed(cli._print_live, doc(entry(st)))
        self.assertIn("map               1 file, 1 read, 0 edited, 1 frame\n", text)
        self.assertIn("in 1 stretch between your prompts", text)

    def test_the_days_built_say_what_they_are_out_of(self):
        facts, sessions = tw.corpus(*tw.rich())
        text = printed(cli._print_wrapped, wr.wrapped(facts, sessions))
        self.assertIn("days built        4 of the 4 days from first session to last", text)

    def test_quote_cards_say_how_to_see_the_prompt(self):
        facts, sessions = tw.corpus(*tw.rich())
        without = printed(cli._print_wrapped, wr.wrapped(facts, sessions, **tw.rich_kw()))
        self.assertEqual(without.count("run with --quotes to see the prompt"), 3)
        with_q = printed(cli._print_wrapped, wr.wrapped(facts, sessions, quotes=True, **tw.rich_kw()))
        self.assertNotIn("run with --quotes", with_q)

    def test_the_watch_header_and_the_nothing_running_reason(self):
        d = doc(reason="1 transcript was written to in the last hour, and its last session has ended", moved=1)
        text = printed(cli._print_live, d, every=1.0)
        self.assertIn("every second, Ctrl+C to stop", text)
        self.assertIn("1 transcript was written to in the last hour, and its last session has ended. Nothing needs you.", text)
        self.assertIn("every 5 seconds", printed(cli._print_live, d, every=5.0))
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            old = write(root, records(time.time() - 7200))
            os.utime(old, None)  # written to just now, its sitting long over
            got = cli._live_doc(None, root, [], tl.SALT, dt.datetime.now().astimezone().tzinfo, time.time(), names=False)
        self.assertEqual(got["reason"], "1 transcript was written to in the last hour, and its last session has ended")

    def test_an_eta_under_half_a_minute_and_a_spread_of_one(self):
        st = copy.deepcopy(tl.scenario_states()["converging"])
        history = [tl.fact(i, 600.0) for i in range(12)]
        st["eta"] = tl.eta(history, elapsed=590.0)
        text = printed(cli._print_live, doc(entry(st)))
        self.assertIn("eta               less than a minute left; typical 10 minutes, all of the middle half 10 minutes;", text)
        self.assertNotIn("about under a minute", text)

    def test_the_verdict_is_said_in_words(self):
        for name, st in tl.scenario_states().items():
            text = printed(cli._print_live, doc(entry(st)))
            basis = st["verdict"]["basis"]
            if basis:
                self.assertNotIn(basis, text.split("verdict", 1)[1].split("\n", 1)[0], name)

    def test_the_burn_lines_never_print_a_zero_they_did_not_measure(self):
        rep = {
            "totals": {"lines_added": {"value": 0}, "lines_removed": {"value": 0}, "files_touched": {"value": 0}},
            "segments": [{"commits": 4, "unreadable": False}],
        }
        self.assertEqual(cli._burn_lines(rep, 0, 0), "none counted: made 4 commits")
        rep["segments"] = [{"unreadable": True}]
        self.assertEqual(
            cli._burn_lines(rep, 0, 0), "none counted: whether it changed any file cannot be read from this transcript"
        )
        self.assertEqual(cli._burn_lines(rep, 3, 1), "+3 / -1")
        with tempfile.TemporaryDirectory() as tmp:
            text = printed(cli._print_burn, burn.burn_report(write(pathlib.Path(tmp), records(tl.T0))))
        self.assertNotIn("spent on nothing", text)
        self.assertNotIn("+0 / -0", text)
        self.assertNoDash(text)


class ReviewWire(_Case):
    def test_the_wire_view_of_live_carries_no_path_where_or_repository(self):
        """FOUND IN REVIEW: the only machine readable output was the LOCAL document, with the
        transcript path, `where` and the repository's identity unhashed."""
        st = tl.scenario_states(names=True)["done_after_commit"]
        d = doc(entry(st, transcript="/Users/me/.claude/projects/-p/x.jsonl", repo="github.com/me/private-app"))
        w = cli._live_wire(d)
        blob = json.dumps(w)
        for local in ("/Users/me", "private-app", "transcript", "where", "names", "sentence"):
            self.assertNotIn(local, blob)
        self.assertEqual(w["sessions"][0], live.wire(st))
