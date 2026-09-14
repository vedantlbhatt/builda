"""python3 -m unittest capture.tests.test_report_quotes

`python -m capture report --quotes` (docs/overnight-integration.md 2.4): the SECOND opt in
exception, up to three prompts verbatim, sent only when this run says `--quotes` AND the
account has Quote my prompts on. Off by default, never remembered, so a scheduled
`capture report` never sends one; with the account off the server answers 409 and capture
prints the server's own sentence.

The quotes document is built by the call that builds the report, `analysis.report.
from_corpus` over `analysis.corpus.cut` (1.3), which is the engine's. These tests hold
capture's half: where the two documents go and in what order, what a 409 prints, and that
`--quotes` against an engine without `from_corpus` is refused before a byte is read. The
stand in engine below returns fixed documents; nothing here picks a quote.
"""

from __future__ import annotations

import contextlib
import io
import json
import unittest

from capture import cli
from capture.tests.test_dry_run import _Harness

REPORT = {"report_version": 2, "window_days": 30, "trends": [], "agents": None}
QUOTES = {
    "quotes_version": 1,
    "generated_at": "2026-09-13T07:00:00Z",
    "quotes": [
        {
            "card": "go_to_prompt",
            "text": "keep going",
            "client_session_id": "c" * 64,
            "sent_at": "2026-09-12T20:00:00Z",
            "seconds_in": 60,
            "tool_calls_after": None,
            "corrected": None,
        }
    ],
}


class _Report(_Harness):
    def report(self, *args) -> tuple[int, str, str]:
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            rc = cli.main(["report", "--root", str(self.root), "--server", self.url, "--no-other-harnesses", *args])
        return rc, out.getvalue(), err.getvalue()

    def stand_in(self):
        calls: list[bool] = []

        def cut(sources, transcripts, tz, now, *, tau="auto"):
            return {"sources": len(sources)}

        def from_corpus(corpus, window_days, *, quotes=False):
            calls.append(quotes)
            return dict(REPORT, window_days=window_days), (QUOTES if quotes else None)

        saved = cli._from_corpus
        cli._from_corpus = lambda: (cut, from_corpus)
        self.addCleanup(setattr, cli, "_from_corpus", saved)
        return calls


class Quotes(_Report):
    def test_quotes_flag_puts_quotes_after_the_report_and_prints_a_409(self):
        calls = self.stand_in()
        rc, out, err = self.report("--dry-run", "--quotes")
        self.assertEqual(rc, 0, err)
        dec = json.JSONDecoder()
        first, end = dec.raw_decode(out)
        second, _ = dec.raw_decode(out[end:].lstrip())
        self.assertEqual((first["window_days"], second), (30, QUOTES))
        self.assertIn("opt in quotes", err)
        self.assertEqual(self.server.requests, [], "a dry run sends nothing")

        self.server.quotes_on = False
        rc, out, err = self.report("--quotes")
        self.assertEqual(rc, 1)
        self.assertIn("Quotes not sent: quotes are off for this account; turn on Settings, Quote my prompts", out)
        self.assertEqual(len(self.server.reports), 1, "the report still went")
        self.assertEqual(self.server.quotes, [])

        self.server.quotes_on = True
        rc, out, err = self.report("--quotes")
        self.assertEqual(rc, 0, out + err)
        self.assertEqual(self.server.quotes, [QUOTES])
        self.assertIn("Uploaded 1 quote for your Wrapped cards.", out)
        self.assertEqual(calls, [True, True, True])

    def test_without_the_flag_no_quotes_are_built_or_sent(self):
        calls = self.stand_in()
        rc, out, err = self.report("--dry-run")
        self.assertEqual(rc, 0, err)
        doc, end = json.JSONDecoder().raw_decode(out)
        self.assertEqual(out[end:].strip(), "", "one document, the report")
        self.assertEqual(calls, [False])
        rc, _, _ = self.report()
        self.assertEqual((rc, self.server.quotes), (0, []))
        self.assertNotIn("/v1/profile/quotes", [p for _, p, _, _ in self.server.requests])

    def test_quotes_without_the_engine_are_refused_before_anything_is_read(self):
        saved = cli._from_corpus
        cli._from_corpus = lambda: None
        self.addCleanup(setattr, cli, "_from_corpus", saved)
        rc, out, err = self.report("--quotes")
        self.assertEqual(rc, 2)
        self.assertIn("--quotes needs analysis.report.from_corpus", err)
        self.assertEqual(self.server.requests, [])

    def test_delete_quotes(self):
        self.server.quotes.append(QUOTES)
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            rc = cli.main(["quotes", "--delete", "--server", self.url])
        self.assertEqual(rc, 0)
        self.assertEqual((self.server.quotes, self.server.quotes_deleted), ([], 1))
        self.assertIn("Deleted the quotes this account stored.", out.getvalue())


class TheRealEngine(_Report):
    def test_report_dry_run_without_quotes_contains_no_prompt_text(self):
        """With whatever engine this checkout has (the v1 path, or `from_corpus` once it
        lands), the report carries no word anybody typed."""
        import pathlib
        import time

        from analysis.tests import transcripts as tr

        b = tr.Builder()
        start = time.time() - 3 * 86400 - tr.T0
        b.prompt(start, "zqx sentinel prompt about the zqxsecret module")
        for i in range(4):
            b.read(start + 5 + i, f"/tmp/zqx_sentinel_dir/zqx_secret{i}.py")
        b.bash(start + 20, "zqxcmd --flag", ok=start + 21)
        tr.write_transcript(b.records, pathlib.Path(self.root), project="-Users-dev-zqx", sid="8f7c2a4e-0000-4000-8000-00000000c0de")
        rc, out, err = self.report("--dry-run")
        self.assertEqual(rc, 0, err)
        self.assertNotIn("zqx", out.lower())


if __name__ == "__main__":
    unittest.main()
