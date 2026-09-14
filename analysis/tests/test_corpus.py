"""The one corpus cut (`analysis/corpus.py`) and the one report builder over it.

docs/overnight-integration.md 1.3 and 5.2. Two commands describe one corpus: `python -m
analysis report` and `python -m capture report`. They used to cut it twice, and the capture
cut passed no token counts, so the report it uploaded refused spend ("no session reported
token counts") about sessions that every one did. These tests hold the two to one cut and
one document, and hold the cut to what every block reads from it.
"""

from __future__ import annotations

import contextlib
import dataclasses
import datetime as dt
import io
import json
import os
import pathlib
import subprocess
import tempfile
import time
import unittest
import zoneinfo

from analysis import __main__ as cli
from analysis import agents as ag
from analysis import burn, corpus, pricing
from analysis import profile as pf
from analysis import report as rp
from analysis.tests import test_cli as tc

UTC = zoneinfo.ZoneInfo("UTC")


def recent() -> float:
    """Three days before now, on the hour. The report reads the last 30 days
    (`corpus.window`) on the wall clock these commands use, so a transcript pinned to a
    fixed date would age out of every window here a month after it was written."""
    return (time.time() // 3600) * 3600 - 3 * 86400


def two_sittings(root: pathlib.Path) -> pathlib.Path:
    """Two sittings twelve hours apart in one transcript, each four priced messages."""
    base = recent()
    return tc.write(root, tc.records(base, ids="a") + tc.records(base + 12 * 3600, ids="b"))


def _no_clock(doc: dict) -> dict:
    return {k: v for k, v in doc.items() if k != "generated_at"}


class OneCut(unittest.TestCase):
    def test_capture_and_analysis_cut_the_same_facts(self):
        """`capture report` builds the document `analysis report` prints, byte for byte but
        the clock it was made at: both discover, cut (`corpus.cut`) and build
        (`report.from_corpus`) through the same functions."""
        from capture import cli as capture_cli

        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            two_sittings(root)
            out = io.StringIO()
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
                code = capture_cli.main(
                    ["report", "--root", str(root), "--tz", "UTC", "--no-other-harnesses", "--dry-run"]
                )
            self.assertEqual(code, 0)
            from_capture = json.loads(out.getvalue())
            from_analysis, _ = rp.from_corpus(corpus.cut_root(root, tz=UTC), rp.DEFAULT_WINDOW_DAYS)
        self.assertEqual(_no_clock(from_capture), _no_clock(from_analysis))
        # And it is a report that answers: the capture cut used to refuse every dollar.
        self.assertIsNotNone(from_capture["money"]["usd"])

    def test_facts_carry_tokens_and_burn_when_the_ledger_reported_them(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            path = two_sittings(root)
            c = corpus.cut_root(root, tz=UTC)
            turns = burn.load_turns(path)
        self.assertEqual(len(c.facts), 2)
        for f, s in zip(c.facts, c.kept, strict=True):
            # The ledger's five buckets, deduplicated on message id: 4 x (10, 5, 0, 100).
            self.assertEqual(f.tokens, pricing.Tokens(input=40, output=20, cache_read=400))
            self.assertEqual(f.output_tokens_by_model, {"claude-opus-5": 20})
            self.assertEqual(f.burn_tokens, tc.SITTING_TOKENS)
            want = burn.session_burn_detail(s.events, [t for t in turns if s.started_at <= t.ts <= s.ended_at])
            self.assertEqual(
                (f.burn_tokens, f.barren_tokens, f.unreadable_tokens, f.barren_causes),
                (want["tokens"], want["barren"], want["unreadable"], want["causes"]),
            )
        # The parallel lists are parallel.
        self.assertEqual([f.session_id for f in c.facts], [s.session_id for s in c.sessions])

    def test_a_transcript_with_no_counts_prices_nothing_and_says_so(self):
        recs = tc.records(recent())
        for r in recs:
            if r["type"] == "assistant":
                r["message"].pop("usage")
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            tc.write(root, recs)
            c = corpus.cut_root(root, tz=UTC)
            doc, _ = rp.from_corpus(c, 30)
        self.assertEqual((c.facts[0].tokens, c.facts[0].burn_tokens), (None, None))
        self.assertEqual((doc["money"]["usd"], doc["money"]["reason"]), (None, pricing.BASIS_TOKENS_ABSENT))
        self.assertEqual(doc["burn"]["reason"], "no_token_counts")

    def test_a_lean_cut_reads_no_burn_no_git_and_no_sidecar(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            two_sittings(root)
            c = corpus.cut_root(root, tz=UTC, lean=True)
        self.assertEqual([f.burn_tokens for f in c.facts], [None, None])
        self.assertEqual((c.fanout, c.contributions, c.commit_subjects, c.dependencies), (None, None, [], []))

    def test_the_cli_cut_is_the_corpus_cut(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            two_sittings(root)
            facts, kept = cli._corpus_facts(root)
            c = corpus.cut_root(root)
        self.assertEqual(facts, c.facts)
        self.assertEqual([s.client_session_id for s in kept], [f.session_id for f in c.facts])

    def test_commit_subjects_are_uncapped(self):
        """The kind of work card counts every subject in the window; a cap would turn "25
        of 247 are labelled" into a number about the first forty."""
        seen = []
        real = corpus.commit_messages

        def fake(root, since, cap=40):
            seen.append(cap)
            return [f"{root} {i}" for i in range(50)][: cap if cap is not None else None]

        corpus.commit_messages = fake
        try:
            got = corpus.commit_subjects(["/a", "/b"], 0.0)
        finally:
            corpus.commit_messages = real
        self.assertEqual((len(got), seen), (100, [None, None]))


NOW = 1_757_750_000.0  # 2025-09-13 07:53:20 UTC


def spaced_corpus(n: int = 30, every_days: int = 3, **over) -> corpus.Corpus:
    """`n` priced one hour sittings `every_days` apart, the newest a day before `NOW`: the
    review's probe, 30 sittings over 88 days, of which 10 started in the last 30."""
    facts, sessions = [], []
    from analysis import patterns as pat

    for i in range(n):
        st = NOW - (i * every_days + 1) * 86400
        facts.append(
            pf.SessionFact(
                session_id=f"s{i}", started_at=st, ended_at=st + 3600, active_seconds=3600,
                attended_seconds=3600, autonomous_seconds=0, prompt_count=3,
                output_tokens_by_model={"claude-opus-4-8": 100_000},
                tokens=pricing.Tokens(input=1000, output=100_000),
                lines_added_agent=100, lines_basis=pf.LINES_EDIT_ONLY, repo=f"/r{i % 2}",
            )  # fmt: skip
        )
        sessions.append(
            pat.SessionEvents(
                session_id=f"s{i}", started_at=st, ended_at=st + 3600, active_seconds=3600,
                attended_seconds=3600, tz_offset_minutes=0, events=[],
            )  # fmt: skip
        )
    kw = dict(
        facts=facts, sessions=sessions, kept=[None] * n, roots=[f.repo for f in facts], fanout=None,
        contributions=None, commit_subjects=[], dependencies=[], now=NOW, tz=dt.UTC,
    )  # fmt: skip
    kw.update(over)
    return corpus.Corpus(**kw)


class TheWindowIsTheQuestion(unittest.TestCase):
    """The report says `window_days` and the phone prints "the last 30 days"; every block
    must rest on that window and nothing older (`corpus.window`)."""

    def test_every_block_reads_the_window_it_names(self):
        """FOUND IN REVIEW (2026-09-13): the committed report said "The last 30 days ... Aug
        11 to Sep 13", 34 days. MEASURED on this probe (30 sittings three days apart, 88
        days, asked for 30) before the fix: coverage 30 sessions spanning 88 days, $75.15
        over 30 priced sittings, 3,000 lines, 30.0 hours on the time card. After: 10
        sessions spanning 28 days, $25.05 over 10, 1,000 lines, 10.0 hours."""
        doc, _ = rp.from_corpus(spaced_corpus(), 30)
        cov = doc["coverage"]
        self.assertEqual((cov["sessions"], cov["spans_days"], cov["active_days"]), (10, 28, 10))
        edge = NOW - 30 * 86400
        first = dt.datetime.fromisoformat(cov["first_at"].replace("Z", "+00:00")).timestamp()
        self.assertGreaterEqual(first, edge)
        self.assertEqual((doc["money"]["usd"], doc["money"]["priced_sessions"], doc["money"]["lines_added"]), (25.05, 10, 1000))
        time_card = next(c for c in doc["wrapped"]["cards"] if c["id"] == "time_put_in")
        self.assertEqual((time_card["value"], time_card["n"]), (10.0, 10))

    def test_the_trends_still_compare_this_window_with_the_one_before(self):
        """The one block that reads further back: two equal windows, back to back."""
        everything = spaced_corpus()
        doc, _ = rp.from_corpus(everything, 30)
        self.assertEqual(
            doc["trends"], [rp._trend(t) for t in rp.recent_trends(everything.facts, 30, NOW)]
        )

    def test_commits_agents_and_manifests_narrow_to_the_same_bound(self):
        """Commits by their own time, agents by their start, manifests to the repositories
        a sitting in the window ran in. A commit inside a sitting that began before the
        edge still counts as assisted: the edge never turns an agent's commit into yours."""
        edge = NOW - 30 * 86400
        straddler = pf.SessionFact(
            session_id="edge", started_at=edge - 600, ended_at=edge + 3000, active_seconds=3600,
            attended_seconds=3600, autonomous_seconds=0, repo="/old",
        )  # fmt: skip
        base = spaced_corpus()
        span = lambda aid, t: ag.AgentSpan(  # noqa: E731
            agent_id=aid, agent_type="general-purpose", asked=None, started_at=t, ended_at=t + 60,
            records=2, tool_calls=1, landed=1, failures=0,
        )  # fmt: skip
        spans = [span("old", edge - 86400), span("new1", NOW - 5 * 86400), span("new2", NOW - 5 * 86400 + 30)]
        c = dataclasses.replace(
            base,
            facts=[straddler, *base.facts],
            sessions=[None, *base.sessions],
            kept=[None, *base.kept],
            roots=["/old", *base.roots],
            fanout=corpus.fanout_over(spans),
            commits=((edge + 60, "fix: inside the straddler"), (edge - 7200, "feat: before the window"), (NOW - 2 * 86400, "feat: between two sittings")),
            dependencies_by_root={"/old": ("gone",), "/r0": ("react",), "/r1": ("fastapi",)},
        )
        w = corpus.window(c, 30)
        self.assertEqual(len(w.facts), 10)
        self.assertNotIn("edge", [f.session_id for f in w.facts])
        self.assertEqual(w.commit_subjects, ["fix: inside the straddler", "feat: between two sittings"])
        self.assertEqual((w.contributions.assisted, w.contributions.alone), (1, 1))
        self.assertEqual((w.fanout.agents, w.fanout.max_concurrent), (2, 2))
        self.assertEqual(sorted(w.dependencies), ["fastapi", "react"])

    def test_a_corpus_built_by_hand_keeps_what_it_cannot_narrow(self):
        """No `commits`, no manifests per root, a fan out with no spans: kept as given."""
        c = spaced_corpus(3, 1, contributions="graph", commit_subjects=["a"], dependencies=["x"])
        w = corpus.window(c, 30)
        self.assertEqual((w.contributions, w.commit_subjects, w.dependencies), ("graph", ["a"], ["x"]))


def _stamp(t0: dt.datetime, s: float) -> str:
    return (t0 + dt.timedelta(seconds=s)).isoformat().replace("+00:00", "Z")


class AnExcludedRepositorysAgents(unittest.TestCase):
    def test_never_reach_the_report(self):
        """FOUND IN REVIEW (2026-09-13): `cut` built the fan out from EVERY root transcript,
        so an excluded repository's subagents, and the type name its own `.claude/agents`
        gave them, reached the uploaded report. MEASURED before the fix, this test's sitting
        with three `acme-payroll-migrator` agents in an excluded repository: 0 sittings kept
        and still `agents: 3, by_type: [{"name": "acme-payroll-migrator", "agents": 3}]`.
        After: no fan out, no agents block, and the name nowhere in the document."""
        from capture import discover
        from capture import sessions as cap

        t0 = dt.datetime(2026, 9, 1, 9, 0, tzinfo=dt.UTC)
        with tempfile.TemporaryDirectory() as tmp:
            tmp = pathlib.Path(tmp)
            repo = tmp / "secret"
            repo.mkdir()
            subprocess.run(["git", "init", "-q", str(repo)], check=True)
            subprocess.run(
                ["git", "-C", str(repo), "remote", "add", "origin", "https://github.com/acme/secret-payroll.git"],
                check=True,
            )
            root = tmp / "projects"
            pdir = root / "-tmp-secret"
            pdir.mkdir(parents=True)
            sid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
            lines = []
            for i in range(0, 1800, 60):
                lines.append({
                    "type": "user", "timestamp": _stamp(t0, i), "cwd": str(repo), "sessionId": sid,
                    "uuid": f"u{i}", "promptSource": "typed",
                    "message": {"role": "user", "content": f"step {i} please continue"},
                })  # fmt: skip
                lines.append({
                    "type": "assistant", "timestamp": _stamp(t0, i + 5), "cwd": str(repo), "sessionId": sid,
                    "uuid": f"a{i}", "message": {"id": f"m{i}", "role": "assistant", "content": [
                        {"type": "tool_use", "id": f"t{i}", "name": "Agent",
                         "input": {"description": "migrate payroll", "subagent_type": "acme-payroll-migrator"}}]},
                })  # fmt: skip
            (pdir / f"{sid}.jsonl").write_text("\n".join(json.dumps(x) for x in lines) + "\n")
            side = pdir / sid / "subagents"
            side.mkdir(parents=True)
            for k in range(3):
                (side / f"agent-x{k}.jsonl").write_text(
                    "\n".join(
                        json.dumps({
                            "type": "assistant", "timestamp": _stamp(t0, 10 + k * 60 + j), "agentId": f"x{k}",
                            "message": {"content": [{"type": "tool_use", "name": "Read", "input": {}}]},
                        })  # fmt: skip
                        for j in (0, 30)
                    )
                    + "\n"
                )
            before = os.environ.get("BUILDER_CAPTURE_EXCLUDE")
            try:
                found = list(discover.iter_root_transcripts(root))
                now = (t0 + dt.timedelta(days=1)).timestamp()
                os.environ.pop("BUILDER_CAPTURE_EXCLUDE", None)
                shown = corpus.cut([cap.load_source(t) for t in found], found, dt.UTC, now)
                # Not excluded, the agents are the corpus's, and the custom name travels
                # as `custom` (`agents.wire_type`).
                self.assertEqual(shown.fanout.agents, 3)
                self.assertEqual(rp.from_corpus(shown, 30)[0]["agents"]["by_type"], [{"name": "custom", "agents": 3}])
                os.environ["BUILDER_CAPTURE_EXCLUDE"] = "github.com/acme/secret-payroll"
                c = corpus.cut([cap.load_source(t) for t in found], found, dt.UTC, now)
                doc, _ = rp.from_corpus(c, 30)
            finally:
                if before is None:
                    os.environ.pop("BUILDER_CAPTURE_EXCLUDE", None)
                else:
                    os.environ["BUILDER_CAPTURE_EXCLUDE"] = before
        self.assertEqual((len(c.kept), c.fanout, doc["agents"]), (0, None, None))
        self.assertNotIn("acme-payroll-migrator", json.dumps(doc))


class TheReportCommand(unittest.TestCase):
    def test_analysis_report_prints_the_one_builders_document_and_quotes_only_when_asked(self):
        import argparse

        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            two_sittings(root)
            out = pathlib.Path(tmp) / "report.json"
            a = argparse.Namespace(path=str(root), days=None, out=str(out), quotes=False)
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(cli._report(a), 0)
            printed = json.loads(out.read_text())
            want, _ = rp.from_corpus(corpus.cut_root(root), rp.DEFAULT_WINDOW_DAYS)
        self.assertEqual(_no_clock(printed), _no_clock(want))
        self.assertEqual(printed["report_version"], rp.REPORT_VERSION)
        for block in rp.V2_BLOCKS:
            self.assertIsNotNone(printed[block], block)


if __name__ == "__main__":
    unittest.main()
