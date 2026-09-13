"""The one corpus cut (`analysis/corpus.py`) and the one report builder over it.

docs/overnight-integration.md 1.3 and 5.2. Two commands describe one corpus: `python -m
analysis report` and `python -m capture report`. They used to cut it twice, and the capture
cut passed no token counts, so the report it uploaded refused spend ("no session reported
token counts") about sessions that every one did. These tests hold the two to one cut and
one document, and hold the cut to what every block reads from it.
"""

from __future__ import annotations

import contextlib
import io
import json
import pathlib
import tempfile
import unittest
import zoneinfo

from analysis import __main__ as cli
from analysis import burn, corpus, pricing
from analysis import report as rp
from analysis.tests import test_cli as tc
from analysis.tests import test_live as tl

UTC = zoneinfo.ZoneInfo("UTC")


def two_sittings(root: pathlib.Path) -> pathlib.Path:
    """Two sittings twelve hours apart in one transcript, each four priced messages."""
    return tc.write(root, tc.records(tl.T0, ids="a") + tc.records(tl.T0 + 12 * 3600, ids="b"))


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
        recs = tc.records(tl.T0)
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
