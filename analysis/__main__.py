from __future__ import annotations

import argparse
import collections
import datetime as dt
import json
import pathlib
import sys
import time

from . import digest as dg


def _ts(s: str | None) -> float | None:
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp() if s else None


def main() -> int:
    ap = argparse.ArgumentParser(prog="python -m analysis")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("digest", "stats", "run"):
        p = sub.add_parser(name)
        p.add_argument("transcript")
        p.add_argument("--start")
        p.add_argument("--end")
        p.add_argument("--repo")
        p.add_argument("--budget", type=int, default=dg.DEFAULT_BUDGET)
        if name == "run":
            p.add_argument("--out")
            p.add_argument("--model", default=None)
    pf = sub.add_parser(
        "profile",
        help="corpus metrics over every root transcript in a directory (no model, read-only)",
    )
    pf.add_argument("path", nargs="?", default="~/.claude/projects")
    pf.add_argument("--facts-only", action="store_true")
    nr = sub.add_parser(
        "narrative",
        help="the 'how you work' page: profile + comparative findings through `claude -p`",
    )
    nr.add_argument("path", nargs="?", default="~/.claude/projects")
    nr.add_argument("--out")
    nr.add_argument("--model", default=None)
    nr.add_argument(
        "--findings-only",
        action="store_true",
        help="print the comparative findings and stop, without calling a model",
    )
    rp = sub.add_parser(
        "report",
        help="the whole builder report as one JSON document, exactly as it is uploaded",
    )
    rp.add_argument("path", nargs="?", default="~/.claude/projects")
    rp.add_argument(
        "--days",
        type=int,
        default=None,
        help=f"the window, and the length of each trend window (default {rp_default()})",
    )
    rp.add_argument("--out")
    rp.add_argument(
        "--quotes",
        action="store_true",
        help="also print the opt in quotes document (up to three prompts, verbatim) after it",
    )
    ql = sub.add_parser(
        "quality", help="how long it takes you to get back to green, and what passed first try"
    )
    ql.add_argument("path", nargs="?", default="~/.claude/projects")
    ql.add_argument("--days", type=int, default=30, help="how far back to look (default 30)")
    co = sub.add_parser(
        "contributions",
        help="your commits by day, split by whether an agent was in the room",
    )
    co.add_argument("path", nargs="?", default="~/.claude/projects")
    co.add_argument("--days", type=int, default=60, help="how far back to look (default 60)")
    tr = sub.add_parser(
        "trends", help="how you build now against how you built before, you against you"
    )
    tr.add_argument("path", nargs="?", default="~/.claude/projects")
    tr.add_argument("--window", type=int, default=30, help="days per window (default 30)")
    ag = sub.add_parser(
        "agents",
        help="several agents at once: who ran, overlapping or one after another, and what landed",
    )
    ag.add_argument("path", nargs="?", default="~/.claude/projects")
    ag.add_argument("--days", type=int, default=30, help="how far back to look (default 30)")
    pb = sub.add_parser(
        "playbook",
        help="your own prompts that landed, against the ones that cost a round trip",
    )
    pb.add_argument("path", nargs="?", default="~/.claude/projects")
    pb.add_argument("--days", type=int, default=30, help="how far back to look (default 30)")
    pb.add_argument("--top", type=int, default=5, help="how many of each to show")
    ru = sub.add_parser(
        "rules",
        help="the same mistake, made again: recurring failures turned into rules-file lines",
    )
    ru.add_argument("path", nargs="?", default="~/.claude/projects")
    ru.add_argument("--repo", help="only this repository (matched on the directory name)")
    ru.add_argument("--days", type=int, default=30, help="how far back to look (default 30)")
    ru.add_argument("--model", default=None)
    ru.add_argument(
        "--list",
        action="store_true",
        help="list the recurring failures and stop, without calling a model",
    )
    ru.add_argument("--out", help="append the accepted rules to this file")
    sh = sub.add_parser(
        "shipped",
        help="draft a build post: what you made in a window, and what was hard about it",
    )
    sh.add_argument("path", nargs="?", default="~/.claude/projects")
    sh.add_argument("--repo", help="only this repository (matched on the directory name)")
    sh.add_argument("--days", type=int, default=7, help="how far back to look (default 7)")
    sh.add_argument("--out")
    sh.add_argument("--model", default=None)
    sh.add_argument(
        "--dry-run",
        action="store_true",
        help="print what the model would be shown and stop, without calling it",
    )
    bg = sub.add_parser(
        "cards", help="the postable cards: what this corpus gives you to put in a feed"
    )
    bg.add_argument("path", nargs="?", default="~/.claude/projects")
    bg.add_argument("--all", action="store_true", help="show the ones that scored too low too")
    bn = sub.add_parser(
        "burn",
        help="where the tokens went in one transcript, and whether anything came of it",
    )
    bn.add_argument("transcript")
    bn.add_argument("--start")
    bn.add_argument("--end")
    bn.add_argument("--json", action="store_true")
    bn.add_argument(
        "--spike",
        type=float,
        default=None,
        help="a segment is a spike at this multiple of the median segment cost",
    )
    wr = sub.add_parser(
        "wrapped",
        help="fifteen questions about how you build, each one answered or refused with a reason",
    )
    wr.add_argument("path", nargs="?", default="~/.claude/projects")
    wr.add_argument("--json", action="store_true", help="the whole LOCAL result, quotes included when asked")
    wr.add_argument(
        "--wire",
        action="store_true",
        help="only what `wrapped.wire` keeps, the form that may leave this machine",
    )
    wr.add_argument(
        "--quotes",
        action="store_true",
        help="also print the prompts three cards quote; they never leave this machine",
    )
    lv = sub.add_parser(
        "live",
        help="what each running session is doing now, whether it is working, and who needs you",
    )
    lv.add_argument(
        "transcript",
        nargs="?",
        help="one transcript; without it, every session running under --root",
    )
    lv.add_argument(
        "--root",
        default="~/.claude/projects",
        help="where to look for running sessions (default ~/.claude/projects)",
    )
    lv.add_argument(
        "--history",
        help="finished sessions for the ETA (default: --root, or the transcript's grandparent)",
    )
    lv.add_argument("--json", action="store_true", help="the whole LOCAL document")
    lv.add_argument(
        "--wire",
        action="store_true",
        help="only what `live.wire` keeps of each session, the form that may leave this machine",
    )
    lv.add_argument(
        "--names",
        action="store_true",
        help="name files, commands and packages; these never leave this machine",
    )
    lv.add_argument(
        "--watch",
        type=float,
        default=None,
        metavar="N",
        help="refresh every N seconds until interrupted",
    )
    vc = sub.add_parser(
        "vocab",
        help="the words your sessions have earned, what the project is made of, and titles",
    )
    vc.add_argument("path", nargs="?", default="~/.claude/projects")
    vc.add_argument("--json", action="store_true", help="the whole LOCAL result")
    vc.add_argument(
        "--wire",
        action="store_true",
        help="only what `vocab.wire` keeps, the form that may leave this machine",
    )
    vc.add_argument("--titles", type=int, default=10, help="how many recent titles (default 10)")
    pj = sub.add_parser(
        "projects",
        help="each repository on its own: time, how you build it, what shipped, what it cost, where it is in its life",
    )
    pj.add_argument("path", nargs="?", default="~/.claude/projects")
    pj.add_argument(
        "--days",
        type=int,
        default=None,
        help=f"the window each project's window half reads (default {rp_default()}, the report's)",
    )
    pj.add_argument("--json", action="store_true", help="the whole LOCAL result: names, checkouts and sentences included")
    pj.add_argument(
        "--wire",
        action="store_true",
        help="only the report's projects block, the form that may leave this machine",
    )
    pr = sub.add_parser("probe", help="read-only shape report over a file or directory")
    pr.add_argument(
        "path",
        help=(
            "a transcript file or a directory: Codex ~/.codex/sessions, Gemini ~/.gemini/tmp, "
            "Cline ~/.cline/data, opencode ~/.local/share/opencode (or one session as "
            "opencode.db/<session id>), Aider a repo directory holding .aider.chat.history.md "
            "(or one session as .aider.chat.history.md/<YYYYMMDD-HHMMSS>)"
        ),
    )
    pr.add_argument("--json", action="store_true")
    a = ap.parse_args()

    if a.cmd == "profile":
        from . import profile as pf_mod

        facts, _ = _corpus_facts(pathlib.Path(a.path).expanduser())
        prof = pf_mod.corpus_profile(facts)
        if a.facts_only:
            for f in prof["facts"]:
                print(f"[{f['unusualness']:5.2f}] {f['text']}")
            return 0
        print(json.dumps(prof, indent=1, default=str))
        return 0

    if a.cmd == "report":
        return _report(a)

    if a.cmd == "quality":
        return _quality(a)

    if a.cmd == "contributions":
        return _contributions(a)

    if a.cmd == "trends":
        return _trends(a)

    if a.cmd == "agents":
        return _agents(a)

    if a.cmd == "playbook":
        return _playbook(a)

    if a.cmd == "rules":
        return _rules(a)

    if a.cmd == "shipped":
        return _shipped(a)

    if a.cmd == "cards":
        return _cards(a)

    if a.cmd == "narrative":
        return _narrative(a)

    if a.cmd == "wrapped":
        return _wrapped(a)

    if a.cmd == "live":
        return _live(a)

    if a.cmd == "vocab":
        return _vocab(a)

    if a.cmd == "projects":
        return _projects(a)

    if a.cmd == "probe":
        from . import probe as pb

        pb.run(pathlib.Path(a.path).expanduser(), as_json=a.json)
        return 0

    if a.cmd == "burn":
        from . import burn as bn_mod

        rep = bn_mod.burn_report(
            pathlib.Path(a.transcript).expanduser(),
            start=_ts(a.start),
            end=_ts(a.end),
            spike_multiple=a.spike or bn_mod.SPIKE_MULTIPLE,
        )
        if a.json:
            print(json.dumps(rep, indent=1, default=str))
            return 0
        _print_burn(rep)
        return 0

    path = pathlib.Path(a.transcript).expanduser()
    meta = {"repo": a.repo} if a.repo else {}

    if a.cmd == "digest":
        d = dg.build(path, _ts(a.start), _ts(a.end), meta, a.budget)
        sys.stdout.write(d["text"])
        sys.stderr.write(
            f"\n[events {d['events']}  coverage {d['coverage']}  chars {len(d['text'])}  hash {d['hash'][:12]}]\n"
        )
        return 0
    if a.cmd == "stats":
        d = dg.build(path, _ts(a.start), _ts(a.end), meta, a.budget)
        print(json.dumps(d["stats"], indent=1))
        return 0
    from . import run as rn

    kw = {"model": a.model} if a.model else {}
    res = rn.analyze(path, _ts(a.start), _ts(a.end), meta, budget=a.budget, **kw)
    text = json.dumps(res, indent=1, ensure_ascii=False)
    if a.out:
        pathlib.Path(a.out).write_text(text)
        sys.stderr.write(f"wrote {a.out}  cost ${res['cost_usd']}  {res['duration_ms']} ms\n")
    else:
        print(text)
    return 0


def _print_burn(rep: dict) -> None:
    """The burn report as a person reads it. Numbers first, sentences last.

    Every share is said the way `burn.explain` says it: from the integers it was divided
    from (`burn._unrounded`), so the numbers block and the sentence under it can never
    print two figures for one quantity, and through `burn._share_words`, so a positive
    share that rounds to nothing reads "under 1%" rather than a zero that was never
    measured (FOUND BY RUNNING IT: the live transcript's 15,460 token fan out printed 0%).
    """
    from . import burn as bn_mod

    t = rep["totals"]
    total = t["tokens"]["value"] or 0

    def share(metric: dict | None, key: str) -> str | None:
        v = bn_mod._unrounded(metric, key, total) if metric else None
        return None if v is None else bn_mod._share_words(v)

    print()
    if not rep["harness_records_usage"]:
        # The report's own reason, never a blanket "this harness writes no token counts":
        # Codex and Gemini do write them, and a Claude Code file with no assistant record
        # (a bookkeeping transcript) is not a harness that cannot count.
        print(f"  tokens            not shown: {t['tokens'].get('reason')}")
    else:
        print(f"  tokens            {t['tokens']['value']:,}")
        cr = share(t["cache_read_share"], "cache_read_tokens")
        if cr is not None:
            print(f"  context replay    {cr} of it")
        tpl = t["tokens_per_line"]["value"]
        if tpl is not None:
            print(f"  tokens per line   {tpl:,.0f}")
        bs = share(t["barren_token_share"], "barren_tokens")
        if bs is not None:
            # Not "spent on nothing": a stretch that only read is labelled investigated,
            # never accused (`burn.Segment.barren`). FOUND IN REVIEW.
            print(f"  nothing written   {bs}")
        us = share(t.get("unreadable_token_share"), "unreadable_tokens")
        if us is not None:
            print(f"  could not judge   {us}, where a script or helper agent may have changed files unseen")
    la, lr = t["lines_added"]["value"], t["lines_removed"]["value"]
    if la is not None and lr is not None:
        print(f"  lines             {_burn_lines(rep, la, lr)}")
    else:
        print(f"  lines             not shown: {t['lines_added'].get('reason')}")
    print(
        f"  stretches         {rep['sample']['segments']}, one from each prompt of yours to the next"
    )
    for m in rep["sample"]["missing"]:
        if m != t["tokens"].get("reason"):
            print(f"  refused           {m}")

    if rep["causes"]:
        print()
        # What each cause can CLAIM of the session's tokens (`attributed_tokens`). The old
        # column was `share_of_session`, every token of any segment the cause appeared in,
        # so one expensive segment with three causes printed its whole cost three times.
        print("  WHERE IT WENT  (what each cause can claim; one turn can count toward two)")
        for c in rep["causes"][:6]:
            claimed = c.get("attributed_tokens")
            said = (
                bn_mod._share_words(claimed / total)
                if isinstance(claimed, int) and total
                else ""
            )
            k = c["segments"]
            print(f"    {said:>8}  {c['cause']:<18} {k} segment{'' if k == 1 else 's'}")

    if rep["spikes"]:
        print()
        print("  SPIKES")
        for row in rep["spikes"][:5]:
            mult = row["multiple_of_median"]
            # burn's own verdict: "+0 lines" was printed for a stretch that removed lines,
            # ran `sed -i`, only committed, or whose work a script did unseen.
            flag = bn_mod._verdict(row)
            print(f"\n    {row['tokens']:>9,} tokens  ({mult}x median)  {flag}")
            if row["prompt"]:
                # One line: a pasted prompt's newlines broke the column.
                print(f"      you asked: {' '.join(row['prompt'].split())[:88]}")
            for c in row["causes"][:3]:
                print(f"        {c['detail']}")

    sentences = bn_mod.explain(rep)
    if sentences:
        print()
        print("  IN PLAIN TERMS")
        for line in sentences:
            print(f"    {line}")
    print()


def _burn_lines(rep: dict, added: int, removed: int) -> str:
    """The lines figure of the burn numbers block: `+a / -r` when either was counted, and
    otherwise what `burn.explain` says of the same session, never a "+0 / -0" beside "it
    made 4 commits" or a transcript whose work the digest cannot see (FOUND IN REVIEW, 17
    corpus transcripts)."""
    from . import burn as bn_mod

    if added or removed:
        return f"+{added:,} / -{removed:,}"
    clause = bn_mod._work_clause(rep).lstrip(", ")
    return "none counted: " + clause.removeprefix("and ")


def _wrapped(a) -> int:
    """The fifteen cards over a corpus: `analysis/wrapped.py`, with everything it needs cut
    here, the one place the corpus is cut. Refused cards print their reason."""
    from . import corpus as cp_mod
    from . import profile as pf_mod
    from . import wrapped as wr_mod

    c = cp_mod.cut_root(pathlib.Path(a.path).expanduser())
    res = wr_mod.wrapped(
        c.facts,
        c.sessions,
        profile=pf_mod.corpus_profile(c.facts, now=c.now),
        contributions=c.contributions,
        fanout=c.fanout,
        commit_subjects=c.commit_subjects,
        quotes=a.quotes,
    )
    if a.wire:
        # FOUND IN REVIEW: the only machine readable output was the full LOCAL result,
        # with nothing to show what `wire()` would keep.
        print(json.dumps(wr_mod.wire(res), indent=1, ensure_ascii=False, default=str))
        return 0
    if a.json:
        print(json.dumps(res, indent=1, ensure_ascii=False, default=str))
        return 0
    _print_wrapped(res)
    return 0


def _day(ts: float) -> str:
    """The day an instant belongs to, by `profile.local_day`: this machine's offset at that
    instant, and the 04:00 boundary. Never the calendar date, which files a 01:00 sitting
    under the next day and disagrees with every streak and day count beside it (CLAUDE.md,
    "'Today' is not the calendar date")."""
    from . import profile as pf_mod

    offset = dt.datetime.fromtimestamp(ts).astimezone().utcoffset() or dt.timedelta(0)
    return pf_mod.local_day(ts, int(offset.total_seconds() // 60)).isoformat()


def _local_date(iso: str | None) -> str | None:
    """An ISO instant as the day a person would name it by (`_day`)."""
    ts = _ts(iso)
    return _day(ts) if ts is not None else None


def _print_wrapped(res: dict) -> None:
    """The cards as a person reads them. Numbers first, sentences last: what the cards rest
    on, then each question with its answer and the sentence under it, or why it is not
    answered yet. A quote prints above its answer only when `--quotes` asked for it."""
    s = res["sample"]
    print()
    print(f"  WRAPPED   {_plural(s['sessions'], 'session')}, {s['attended_sessions']:,} with you there")
    if s.get("active_hours") is not None:
        print(f"    active hours      {s['active_hours']:,}")
    if s.get("days") is not None:
        span = (
            f" of the {s['spans_days']:,} days from first session to last"
            if s.get("spans_days") is not None
            else ""
        )
        print(f"    days built        {s['days']:,}{span}")
    if s.get("prompts_with_text") is not None:
        print(f"    prompts           {s['prompts_with_text']:,} in your own words")
    first, last = _local_date(s.get("first_at")), _local_date(s.get("last_at"))
    if first and last:
        print(f"    from              {first} to {last}")

    from . import wrapped as wr_mod

    quotes = res.get("quotes") or {}
    answered = 0
    for i, c in enumerate(res["cards"], 1):
        print()
        print(f"  {i:>2}  {c['question']}")
        if c["reason"] is not None:
            print(f"      not yet: {c['reason']}")
            continue
        answered += 1
        q = quotes.get(c["id"])
        if q:
            print(f"      “{q['text']}”")
        print(f"      {c['display']}")
        print(f"      {c['sentence']}")
        if not quotes and c["id"] in wr_mod.QUOTE_CARDS:
            # The quote stays off the screen unless asked for; say how to see it.
            print("      (run with --quotes to see the prompt; it never leaves this machine)")
    print()
    print(f"  {answered} of {len(res['cards'])} answered.")
    print()


def _map_salt(path: pathlib.Path | None = None) -> str:
    """The salt the codebase map keys its file ids with (`live._hash`), never printed:
    `capture.identity.map_salt`, the one definition, so `python -m analysis live` and
    `capture sync --live` give one file one id (docs/overnight-integration.md 5.6).

    32 random bytes, written once to `map-salt` beside the capture credentials and read
    back on every later run. FOUND IN REVIEW (2026-09-13): it was a hash of the raw machine
    identifier, and the uploaded `machine_id` is another hash of it, which hands a server an
    offline test for any guess of the identifier and so for the salt.
    """
    from capture import identity

    return identity.map_salt(path)


def _live(a) -> int:
    """Mission control in a terminal: every running session, the one that needs you first.

    A TRANSCRIPT is one file. Without one, every transcript under `--root` written to within
    `live.LIVE_MTIME_SEC` whose last sitting the reference cut calls live. The finished
    sessions the ETA compares against are cut ONCE, before the first refresh: they are the
    history, and re-cutting a corpus every few seconds would answer the same question.
    """
    import datetime as _dt

    root = pathlib.Path(a.root).expanduser()
    one = pathlib.Path(a.transcript).expanduser() if a.transcript else None
    if one is not None:
        if not one.is_file():
            sys.stderr.write(f"no transcript at {one}.\n")
            return 1
        harness = dg.detect_harness(one)
        if harness != "claude_code":
            sys.stderr.write(
                f"live reads Claude Code transcripts only, and this one was written by {harness}.\n"
            )
            return 1
    if a.watch is not None and a.watch <= 0:
        sys.stderr.write("--watch takes a number of seconds above zero.\n")
        return 2

    history_root = (
        pathlib.Path(a.history).expanduser()
        if a.history
        else (one.parent.parent if one is not None else root)
    )
    history = _History(history_root)
    salt = _map_salt()
    tz = _dt.datetime.now().astimezone().tzinfo
    tty = sys.stdout.isatty()
    try:
        while True:
            now = time.time()
            doc = _live_doc(one, root, history, salt, tz, now, names=a.names)
            if a.watch is not None and tty and not (a.json or a.wire):
                sys.stdout.write("\033[H\033[J")  # clear the screen, then redraw
            if a.wire:
                out = _live_wire(doc)
                print(
                    json.dumps(out, ensure_ascii=False)
                    if a.watch is not None
                    else json.dumps(out, indent=1, ensure_ascii=False)
                )
            elif a.json:
                print(
                    json.dumps(doc, ensure_ascii=False, default=str)
                    if a.watch is not None
                    else json.dumps(doc, indent=1, ensure_ascii=False, default=str)
                )
            else:
                _print_live(doc, names=a.names, every=a.watch)
            sys.stdout.flush()
            if a.watch is None:
                return 0
            time.sleep(a.watch)
    except KeyboardInterrupt:
        return 0


class _History:
    """The finished sessions the ETA compares against, cut ONCE and only when a sitting
    needs them. FOUND IN REVIEW (2026-09-13): `live` cut the whole history, commit
    attribution and burn included, before it knew whether anything was running, and
    printed "NOTHING IS RUNNING" after 22.5 s. The ETA reads only each fact's repository,
    its `unattended` flag and its active seconds, so the cut is lean (`_corpus_facts`)."""

    def __init__(self, root: pathlib.Path):
        self.root = root
        self._facts: list | None = None

    def facts(self) -> list:
        if self._facts is None:
            self._facts, _ = _corpus_facts(self.root, lean=True)
        return self._facts


def _history_facts(history) -> list:
    """A `_History`, or a plain list of facts (tests)."""
    return history.facts() if isinstance(history, _History) else list(history)


def _live_entry(t, session, history, salt: str, now: float, names: bool, *, ended: bool = False) -> dict:
    """One sitting's `live.live_state` at `now`, with what the caller knows about it that
    the state does not carry (which transcript, which repository, the two clocks).

    `ended` is a sitting that has finished: its ETA is refused with the time it ran, never
    estimated as though it were running ("about 24 minutes left" was printed for a
    sitting that ended 13 days ago, FOUND IN REVIEW)."""
    from . import burn as bn_mod
    from . import feedback as fb
    from . import live as lv_mod

    session = _distinct(session)
    paths = sorted({r["path"] for r in session.records})
    # Background work still out, summed over every file the sitting's records came from.
    # None when any could not be read: absent, not zero, so `live_state` keeps its lower
    # bound rather than hearing "nothing is out" from a file it never opened.
    counts = [lv_mod.background_tasks(pathlib.Path(p), session.started_at, now) for p in paths]
    background = None if any(c is None for c in counts) else sum(counts)
    state = lv_mod.live_state(
        session.events,
        bn_mod.turns_for_window(paths, session.started_at, now),
        now,
        # A sitting is never its own history (the snapshot of an ended one is final). An
        # ended sitting's ETA is refused below, so its history is never cut.
        []
        if ended
        else [f for f in _history_facts(history) if f.session_id != session.client_session_id],
        salt=salt,
        repo=session.repo.common_root if session.repo else None,
        active_seconds=session.attended + session.autonomous,
        unattended=session.presence == 0,
        session_id=session.client_session_id,
        names=names,
        background=background,
        root=lv_mod.worktree_root(session),
    )
    if ended:
        active = session.attended + session.autonomous
        state["eta"] = {
            **{k: None for k in state["eta"]},
            "elapsed_s": round(active),
            "basis": state["eta"]["basis"],
            "reason": f"this session has ended, after {fb._mins(active)} active",
        }
    return {
        "transcript": str(t.path),
        "repo": session.repo.identity if session.repo else None,
        "attended_s": round(session.attended),
        "autonomous_s": round(session.autonomous),
        "unattended": session.presence == 0,
        "background": background,
        "state": state,
    }


def _live_doc(one, root, history, salt: str, tz, now: float, names: bool) -> dict:
    """Every running sitting in mission control's order (`live.mission_order`), or, when
    none is running, why not. For one TRANSCRIPT whose last sitting has ended, that sitting
    as it stood when it ended, labelled as such."""
    from capture import discover
    from capture import sessions as cap

    from . import live as lv_mod

    doc: dict = {
        "now": now,
        "where": str(one if one is not None else root),
        "sessions": [],
        "ended": None,
        "reason": None,
        "moved": None,
    }
    from capture import repo as cap_repo

    excluded = cap_repo.excluded_origins()
    if one is not None:
        t = discover.Transcript(project_dir=one.parent.name, path=one)
        # One parse and one cut per tick, whichever way the sitting stands (FOUND IN
        # REVIEW: an ended transcript was parsed and cut twice, 2 s a tick on 129 MB).
        last = lv_mod.last_session(t, now, tz)
        if last is None:
            doc["reason"] = "the transcript holds no sitting yet"
            return doc
        if _excluded(last, excluded):
            doc["reason"] = "its repository is excluded, so nothing about it is shown"
            return doc
        if last.state == "live":
            doc["sessions"] = [_live_entry(t, last, history, salt, now, names)]
            return doc
        doc["ended"] = _live_entry(t, last, history, salt, last.ended_at, names, ended=True)
        doc["ended"]["ended_at"] = last.ended_at
        doc["ended"]["end_reason"] = last.end_reason
        doc["reason"] = (
            f"its last sitting ended {_ago(now - last.ended_at)}, "
            f"at {dt.datetime.fromtimestamp(last.ended_at).strftime('%Y-%m-%d %H:%M')}"
        )
        return doc

    moved = lv_mod.live_transcripts(root, now)
    doc["moved"] = len(moved)
    entries = []
    for t in moved:
        session = lv_mod.current_session(t, now, tz)
        if session is not None and not _excluded(session, excluded):
            entries.append(_live_entry(t, session, history, salt, now, names))
    by_state = {id(e["state"]): e for e in entries}
    doc["sessions"] = [by_state[id(s)] for s in lv_mod.mission_order(e["state"] for e in entries)]
    if not entries:
        hour = f"the last {_ago(lv_mod.LIVE_MTIME_SEC, bare=True)}"
        k = len(moved)
        doc["reason"] = (
            f"no transcript was written to in {hour}"
            if not k
            else f"1 transcript was written to in {hour}, and its last session has ended"
            if k == 1
            else f"{k} transcripts were written to in {hour}, and every session in them has ended"
        )
    return doc


def _live_wire(doc: dict) -> dict:
    """What would leave this machine of a `_live_doc`: `live.wire` of each state, with the
    session's id, and nothing else. No transcript path, no `where`, no repository identity
    (the contract allows a repository's name only when it is public): those stay LOCAL,
    as does everything `--json` prints."""
    from . import live as lv_mod

    def one(e: dict | None) -> dict | None:
        return None if e is None else lv_mod.wire(e["state"])

    return {
        "sessions": [one(e) for e in doc["sessions"]],
        "ended": one(doc.get("ended")),
    }


def _clock(seconds: float) -> str:
    """Measured seconds, exactly, for the numbers block: `45s`, `3m 35s`, `1h 02m 05s`.

    Not a sentence, so not `feedback._mins`: that rounds to the nearest minute while
    `live.sentence` floors, and the two printed one above the other read "for 4 minutes"
    beside "for three minutes" about one 215 second wait (FOUND BY RUNNING IT on the live
    transcript). The exact figure agrees with both."""
    s = int(round(max(0.0, seconds)))
    h, rest = divmod(s, 3600)
    m, sec = divmod(rest, 60)
    if h:
        return f"{h}h {m:02d}m {sec:02d}s"
    if m:
        return f"{m}m {sec:02d}s"
    return f"{sec}s"


def _ago(seconds: float, bare: bool = False) -> str:
    """A duration as a person says it (`feedback._mins`), with "ago" unless `bare`. From two
    days of elapsed time it counts whole days: "316h 49m ago" is a number nobody reads."""
    from . import feedback as fb

    seconds = max(0.0, seconds)
    if seconds >= 2 * 86400:
        words = f"{int(seconds // 86400)} days"
    else:
        words = fb._mins(seconds)
    if bare:
        return "hour" if words == "1h 00m" else words
    return "just now" if words == "under a minute" else f"{words} ago"


def _print_live(doc: dict, names: bool = False, every: float | None = None) -> None:
    """Mission control as a person reads it. Numbers first, sentences last."""
    print()
    if every is not None:
        at = dt.datetime.fromtimestamp(doc["now"]).strftime("%H:%M:%S")
        often = "every second" if every == 1 else f"every {every:g} seconds"
        print(f"  at {at}, {often}, Ctrl+C to stop")
    where = doc["where"].replace(str(pathlib.Path.home()), "~", 1)
    if doc["sessions"]:
        n = len(doc["sessions"])
        head = (
            f"  RUNNING NOW   {n} session{'' if n == 1 else 's'} in {where}"
            + (", the one that needs you most first" if n > 1 else "")
        )
        print(head)
        for e in doc["sessions"]:
            _print_live_entry(e, names)
        print()
        return
    if doc["ended"] is not None:
        print(f"  NOT RUNNING   {where}")
        print(f"    {doc['reason'][0].upper()}{doc['reason'][1:]}. As it stood when it ended:")
        _print_live_entry(doc["ended"], names)
        print()
        return
    print(f"  NOTHING IS RUNNING   {where}")
    print(f"    {doc['reason'][0].upper()}{doc['reason'][1:]}. Nothing needs you.")
    print()


#: The printers' words for the engine's ids: a person reads "circling on the same call run
#: over and over", never `causes:repeated_call` (FOUND IN REVIEW). An id missing here
#: prints as itself with its underscores spaced, never as nothing.
_NEEDS_YOU_WORDS = {
    "waiting_for_input": "waiting for you",
    "circling": "circling",
    "lost": "lost",
    "error_loop": "failing again and again",
    "idle": "no new output",
    "finished_unreviewed": "finished, not looked at yet",
    "waiting_on_background": "waiting on its own background work",
    "running_fine": "running fine",
}
_BASIS_WORDS = {
    "turn_ended": "the turn was handed back",
    "turn_ended_background_out": "the turn was handed back with its background work still out",
    "segment_tool_calls": "too few tool calls since your last prompt to judge",
    "causes:repeated_call": "the same call run over and over",
    "causes:file_churn_with_failures": "one file rewritten while tests fail",
    "consecutive_failures": "failures in a row",
    "edits_to_unread_files": "edits to files it has not read",
    "error_rate_down_and_new_files": "fewer errors and new files coming in",
}


def _words(table: dict, key: str | None) -> str:
    return table.get(key or "", (key or "").replace("_", " "))


def _plural(n: int, one: str, many: str | None = None) -> str:
    """The number and its noun, agreed (`profile._count`)."""
    from . import profile as pf_mod

    return pf_mod._count(n, one, many)


def _print_live_entry(e: dict, names: bool) -> None:
    from . import feedback as fb
    from . import live as lv_mod

    st = e["state"]
    ny = st["needs_you"]
    repo = e["repo"].rsplit("/", 1)[-1] if e["repo"] else "no repository"
    print()
    print(
        f"  {(st['session_id'] or 'unknown')[:8]}  {repo}  needs you: {ny['score']} of 100, "
        f"{_words(_NEEDS_YOU_WORDS, ny['reason'])}"
    )
    active = e["attended_s"] + e["autonomous_s"]
    print(f"    active            {_clock(active)}, {_clock(e['attended_s'])} of it with you")
    sm = st["sample"]
    segs = sm["segments"]
    print(
        f"    tool calls        {sm['tool_calls']:,} in "
        f"{_plural(segs, 'stretch between your prompts', 'stretches between your prompts')}"
    )
    if sm["tokens"] is not None:
        print(f"    tokens            {sm['tokens']:,}")
    else:
        print("    tokens            not recorded by this transcript")
    if e["background"] is not None:
        print(f"    background        {_plural(e['background'], 'task')} still out")
    rows = st["map"]["files"]
    print(
        f"    map               {_plural(len(rows), 'file')}, "
        f"{sum(1 for r in rows if r['reads'])} read, {sum(1 for r in rows if r['edits'])} edited, "
        f"{_plural(len(st['timelapse']), 'frame')}"
    )
    a = st["activity"]
    if a is not None:
        print(f"    activity          {a['kind'].replace('_', ' ')}, for {_clock(a['since_s'])}")
    v = st["verdict"]
    if v["state"] is not None:
        print(f"    verdict           {v['state']}: {_words(_BASIS_WORDS, v['basis'])}")
    else:
        print(f"    verdict           none yet: {v['reason']}")
    ev = list(v["evidence"].items())
    for i in range(0, len(ev), 4):
        label = "      evidence        " if i == 0 else " " * 22
        print(label + "  ".join(f"{k} {val}" for k, val in ev[i : i + 4]))
    eta = st["eta"]
    if eta["reason"] is not None:
        print(f"    eta               not yet: {eta['reason']}")
    else:
        left = (
            "less than a minute left"
            if eta["remaining_s"] < 30
            else f"about {fb._mins(eta['remaining_s'])} left"
        )
        spread = (
            f"all of the middle half {fb._mins(eta['p25_s'])}"
            if fb._mins(eta["p25_s"]) == fb._mins(eta["p75_s"])
            else f"middle half {fb._mins(eta['p25_s'])} to {fb._mins(eta['p75_s'])}"
        )
        print(
            f"    eta               {left}; typical {fb._mins(eta['typical_s'])}, {spread}; "
            f"over {eta['n']} finished "
            f"{'unattended runs' if e['unattended'] else 'sessions'} on this repository "
            "that ran at least this long"
        )
    if names and st.get("names"):
        hot = sorted(rows, key=lambda r: (-r["edits"], -r["reads"], r["id"]))[:5]
        files = st["names"]["files"]
        for i, r in enumerate(hot):
            label = "    hot files         " if i == 0 else " " * 22
            ed, rd = r["edits"], r["reads"]
            print(
                f"{label}{ed} edit{'' if ed == 1 else 's'}, {rd} read{'' if rd == 1 else 's'}  "
                f"{files.get(r['id'], r['id'])}"
            )
    if st["decisions"]:
        print("    decisions")
        for d in st["decisions"]:
            k = d["evidence"]["count"]
            print(f"      {lv_mod.decision_sentence(d, names)}" + (f"  ({k} times)" if k > 1 else ""))
    print()
    print(f"    {lv_mod.sentence(st, names=names)}.")


def _vocab(a) -> int:
    """The glossary your sessions unlocked, the stack they ran on, and the latest titles."""
    from . import shipped as sh
    from . import vocab as vc_mod

    # Lean: the vocabulary reads events and repositories, never burn or commit attribution
    # (FOUND IN REVIEW: 16.9 s of `_narrative_inputs`, 9.5 s of it those two).
    facts, sessions = _narrative_inputs(pathlib.Path(a.path).expanduser(), lean=True)
    roots = sorted({f.repo for f in facts if f.repo})
    latest = sorted(sessions, key=lambda s: s.started_at)[-a.titles :] if a.titles > 0 else []
    res = {
        "glossary": vc_mod.glossary(sessions),
        "stack": vc_mod.stack(
            sessions, dependencies=[d for r in roots for d in sh.stack_evidence(r)]
        ),
        "titles": [
            {"session_id": s.session_id, "started_at": s.started_at, **vc_mod.session_title(s)}
            for s in latest
        ],
    }
    if a.wire:
        print(json.dumps(vc_mod.wire(res), indent=1, ensure_ascii=False, default=str))
        return 0
    if a.json:
        print(json.dumps(res, indent=1, ensure_ascii=False, default=str))
        return 0
    _print_vocab(res)
    return 0


def _print_vocab(res: dict) -> None:
    """The vocabulary as a person reads it. Numbers first, then the stack and the titles,
    and the glossary's definitions last."""
    from . import vocab as vc_mod

    g, st = res["glossary"], res["stack"]
    print()
    print(f"  VOCABULARY   {g['n']:,} session{'' if g['n'] == 1 else 's'} read")
    if g["reason"] is None:
        print(f"    words earned      {len(g['terms'])} of {g['catalog_size']}")
    else:
        print(f"    words earned      not yet: {g['reason']}")
    if st["reason"] is None:
        print(
            f"    stack items       {len(st['items'])}, "
            f"with {st['manifest_names']:,} manifest names read"
        )
    else:
        print(f"    stack items       not yet: {st['reason']}")
    if g["shell_calls"]:
        print(
            f"    shell calls       {g['shell_calls']:,}, {g['shell_calls_cut']:,} of them too "
            "long to read to the end, so a word may have come after where the reading stopped"
        )

    if st["items"]:
        print()
        print(
            "  STACK   a number is the sessions that touched it; a name with no number comes "
            "only from your dependency files"
        )
        for cat in vc_mod.CATEGORIES:
            items = [i for i in st["items"] if i["category"] == cat]
            if not items:
                continue
            words = ", ".join(
                f"{i['name']} {i['sessions']}" if i["sessions"] else i["name"] for i in items
            )
            print(f"    {cat:<13} {words}")
    if st.get("language_reason"):
        print(f"    languages not yet: {st['language_reason']}")

    if res["titles"]:
        print()
        print(f"  THE LAST {len(res['titles'])} SESSIONS")
        for t in res["titles"]:
            when = dt.datetime.fromtimestamp(t["started_at"]).strftime("%Y-%m-%d %H:%M")
            print(f"    {when}   {t['title'] if t['title'] else 'not titled: ' + t['reason']}")

    if g["terms"]:
        print()
        print("  GLOSSARY, in the order you met each word")
        for term in g["terms"]:
            first = _day(term["first_seen_ts"])
            k = term["sessions"]
            print(f"    {term['word']:<24} {k} session{'' if k == 1 else 's'}, first {first}")
            print(f"      {term['definition']}")
    if g["locked_count"] is not None:
        print()
        print(f"  {g['locked_count']} more to find.")
    print()


def _projects(a) -> int:
    """Each repository on its own (`analysis/projects.py`, docs/projects.md): the report's
    blocks asked of one project at a time, over the one corpus cut. Names are printed here
    and never leave the machine; `--wire` prints exactly what the report uploads."""
    from . import corpus as cp_mod
    from . import projects as pj_mod
    from . import report as rp_mod

    days = a.days or rp_mod.DEFAULT_WINDOW_DAYS
    c = cp_mod.cut_root(pathlib.Path(a.path).expanduser())
    res = pj_mod.build(c, days)
    if a.wire:
        print(json.dumps(pj_mod.wire(res), indent=1, ensure_ascii=False))
        return 0
    if a.json:
        print(json.dumps(_projects_local(res), indent=1, ensure_ascii=False, default=str))
        return 0
    _print_projects(res)
    return 0


def _project_labels(res: dict) -> dict[str, str]:
    """Each project's name ON THIS MACHINE, for the printer and nothing else: the origin's
    last segment (`RepoIdentity.display_name`), or the key's first 12 characters when the
    repository has no name at all. Two projects with one name get their key beside it."""
    names = {p.key: (p.name or p.key[:12]) for p in res["projects"]}
    seen = collections.Counter(names.values())
    return {k: (f"{v} ({k[:8]})" if seen[v] > 1 else v) for k, v in names.items()}


def _projects_local(res: dict) -> dict:
    """The LOCAL result as JSON: the wire block, and beside it what stays here (names,
    checkouts, the cards and the comparisons in words)."""
    from . import projects as pj_mod

    labels = _project_labels(res)
    return {
        "wire": res["wire"],
        "local": [
            {
                "key": p.key,
                "name": p.name,
                "checkouts": p.checkouts,
                "cards": [
                    {k: c[k] for k in ("id", "question", "display", "sentence", "reason")} for c in p.cards
                ],
            }
            for p in res["projects"]
        ],
        "comparisons": [
            {"metric": c["metric"], "sentence": pj_mod.comparison_sentence(c, labels)}
            for c in res["wire"]["comparisons"]
        ],
    }


def _h(seconds: float) -> str:
    """Hours, one decimal at most (`profile._n`)."""
    from . import profile as pf_mod

    return f"{pf_mod._n(seconds / 3600)} h"


def _print_projects(res: dict) -> None:
    """The projects as a person reads them: what the numbers rest on, then each project
    (its stage, its week, its whole history, then the window's blocks), then how the
    projects compare. A refused number prints its reason, never a zero."""
    from . import burn as bn_mod
    from . import pricing
    from . import profile as pf_mod
    from . import projects as pj_mod
    from . import vocab as vc_mod

    w = res["wire"]
    labels = _project_labels(res)
    local = {p.key: p for p in res["projects"]}
    stack_names = {s.id: s.name for s in vc_mod.STACK}
    print()
    first = _local_date(w["history_first_at"])
    print(
        f"  PROJECTS   {_plural(w['projects_total'], 'repository', 'repositories')}, "
        f"{_plural(w['history_sessions'], 'sitting')} on this machine" + (f" since {first}" if first else "")
    )
    print(f"    window        each project's window half is the last {w['window_days']} days")
    un = w["unresolved"]
    print(
        f"    no repository {_plural(un['sessions'], 'sitting')} in the window, "
        f"{un['history_sessions']:,} in all, belong to no project"
    )
    if w["projects_total"] > len(w["projects"]):
        print(f"    shown         the {len(w['projects'])} with most of your time")

    for p in w["projects"]:
        h, win, key = p["history"], p["window"], p["key"]
        lp = local[key]
        print()
        where = ", ".join(pathlib.Path(r).name for r in lp.checkouts)
        tail = f"   in {where}" if where and where != labels[key] else ""
        print(f"  {p['rank']:>2}  {labels[key]}   {key[:12]}{tail}")
        print(
            f"      {pj_mod.STAGE_DISPLAY[h['stage']]}. {pj_mod.stage_sentence(h)} "
            f"{pj_mod.last_session_sentence(h)}"
        )
        m = h["momentum"]
        print(
            f"      this week    {pj_mod.momentum_sentence(m)}  "
            f"({_h(m['attended_seconds'])} with you there, {_h(m['attended_seconds_before'])} the week before)"
        )
        streak = (
            f", longest streak {_plural(h['longest_streak_days'], 'day')}, now {h['current_streak_days']}"
            if h["longest_streak_days"] is not None
            else ", no day you were at it"
        )
        print(
            f"      all history  {_plural(h['sessions'], 'sitting')} over {_plural(h['active_days'], 'day')}, "
            f"{_local_date(h['first_at'])} to {_local_date(h['last_at'])}, {_h(h['active_seconds'])} active, "
            f"{_h(h['attended_seconds'])} with you there{streak}"
        )
        if win is None:
            print(f"      the last {w['window_days']} days: no sitting")
            continue
        print(f"      THE LAST {w['window_days']} DAYS")
        share = (
            f" ({bn_mod._share_words(win['share_of_attended'])} of your time with you there)"
            if win["share_of_attended"] is not None
            else ""
        )
        clock = win["clock"]
        hour = (
            f", most built at {pf_mod._hour(clock['peak_hour'])}"
            if clock["peak_hour"] is not None
            else f", no peak hour yet: {pj_mod.clock_refusal(clock)}"
        )
        print(
            f"        time       {_plural(win['sessions'], 'sitting')} on {_plural(win['active_days'], 'day')}, "
            f"{_h(win['active_seconds'])} active, {_h(win['attended_seconds'])} with you there{share}{hour}"
        )
        for card in lp.cards:
            if card["reason"] is None:
                display = card["display"] if card["display"].endswith((".", "?", "!")) else f"{card['display']}."
                print(f"        {card['question']}  {display} {card['sentence']}")
            else:
                print(f"        {card['question']}  not yet: {card['reason']}")
        q = win["quality"]
        if q["first_try_rate"] is None:
            print(f"        tests      {pj_mod.quality_refusal(q)}")
        else:
            green = q["time_to_green"]
            back = (
                f", back to green in {_hm(green['median_seconds'])} at the median over {_plural(green['n'], 'recovery', 'recoveries')}"
                if green
                else f". {pj_mod.quality_refusal(q)}"
            )
            print(
                f"        tests      {q['runs']:,} runs, {bn_mod._share_words(q['first_try_rate'])} already green{back}"
            )
        lg = win["languages"]
        if lg["languages"] is None:
            print(f"        languages  {pj_mod.languages_refusal(lg)}")
        else:
            print(
                "        languages  "
                + ", ".join(f"{r['language']} {bn_mod._share_words(r['share'])}" for r in lg["languages"][:5])
                + f", over {lg['lines']:,} lines"
            )
        cm = win["commits"]
        if cm is None:
            print("        commits    no commit was read for this project in the window")
        else:
            print(
                f"        commits    {cm['assisted'] + cm['alone']:,} on {_plural(cm['active_days'], 'day')}: "
                f"{cm['assisted']:,} with one of its sittings running, {cm['alone']:,} on your own"
            )
        money = win["money"]
        if money["usd"] is None:
            print(f"        money      refused: {money['reason']}")
        else:
            per = win["usd_per_commit"]
            each = (
                f", {pj_mod.dollars(per['usd'])} a commit over {per['commits']:,}"
                if per["usd"] is not None
                else f". No cost a commit: {pj_mod.cost_refusal(per)}"
            )
            models = ", ".join(f"{pricing.family(r['model'])} {pj_mod.dollars(r['usd'])}" for r in money["by_model"][:3])
            hourly = (
                f", {pj_mod.dollars(money['usd_per_active_hour'])} an active hour"
                if money["usd_per_active_hour"] is not None
                else ""
            )
            print(f"        money      about {pj_mod.dollars(money['usd'])} at API list prices{hourly}{each}")
            if models:
                print(f"        models     {models}")
        if money["lines_added"] is not None:
            print(f"        lines      +{money['lines_added']:,} -{money['lines_removed']:,}")
        burn = win["burn"]
        if burn["share"] is not None:
            causes = ", ".join(f"{c['cause'].replace('_', ' ')} {bn_mod._share_words(c['share'])}" for c in (burn["causes"] or [])[:3])
            print(
                f"        burn       {bn_mod._share_words(burn['share'])} of tokens went into stretches that changed nothing"
                + (f" ({causes})" if causes else "")
            )
        items = win["stack"]["items"]
        if items:
            print("        stack      " + ", ".join(stack_names.get(i["id"], i["id"]) for i in items[:12]))
        ag = win["agents"]
        if ag is not None:
            print(f"        agents     {ag['agents']:,} helper agents, up to {ag['max_concurrent']} at once")
        tools = ", ".join(f"{t['harness'].replace('_', ' ')} {_plural(t['sessions'], 'sitting')}" for t in win["harnesses"])
        if tools:
            print(f"        tools      {tools}")

    print()
    print("  HOW THE PROJECTS COMPARE")
    for c in w["comparisons"]:
        said = pj_mod.comparison_sentence(c, labels)
        if c["reason"] is None:
            print(
                f"    {said}   ({pj_mod.value_words(c['metric'], c['high_value'])} against "
                f"{pj_mod.value_words(c['metric'], c['low_value'])}, over {c['high_sessions']:,} and "
                f"{c['low_sessions']:,} sittings)"
            )
        else:
            print(f"    not yet   {pj_mod.COMPARISONS[c['metric']]['label']}: {said}")
    print()


def _quality(a) -> int:
    """Two of DORA's four questions, for one person. The other two are refused: see
    `analysis/quality.py` for the measurement that forced it."""
    from . import quality as q_mod

    facts, sessions = _narrative_inputs(pathlib.Path(a.path).expanduser())
    cutoff = time.time() - a.days * 86400
    picked = [s for f, s in zip(facts, sessions, strict=True) if f.started_at >= cutoff]
    stats = q_mod.summary(picked)
    if stats["first_try_rate"] is None:
        sys.stderr.write(f"{stats['reason']}.\n")
        return 0

    print(
        f"{stats['runs']} test runs in the last {a.days} days: {stats['passed']} passed, "
        f"{stats['failed']} failed. {round(stats['first_try_rate'] * 100)}% were already green."
    )
    ttg = stats["time_to_green"]
    if ttg is None:
        print(f"\nNothing failed and then passed in one sitting ({stats['reason']}).")
        return 0
    print(
        f"\nBack to green in {_hm(ttg['median_seconds'])} at the median, "
        f"{_hm(ttg['worst_seconds'])} at the worst, over {ttg['n']} recover"
        f"{'y' if ttg['n'] == 1 else 'ies'}."
    )
    print(f"It takes {ttg['median_attempts']} test runs to get there, typically.\n")
    for g in sorted(q_mod.recoveries(picked), key=lambda g: -g.seconds)[:5]:
        print(f"  {_hm(g.seconds):>10}  {g.attempts} runs   {g.command[:64]}")
    return 0


def _hm(seconds: float) -> str:
    m = round(seconds / 60)
    if m < 1:
        return "under a minute"
    return f"{m} min" if m < 60 else f"{m // 60}h {m % 60:02d}m"


def _contributions(a) -> int:
    """The graph, and the number underneath it that GitHub cannot answer."""
    import datetime as _dt

    from capture import repo as cap_repo

    from . import contributions as co_mod

    facts, _ = _narrative_inputs(pathlib.Path(a.path).expanduser())
    cutoff = time.time() - a.days * 86400
    facts = [f for f in facts if f.ended_at >= cutoff]
    if not facts:
        sys.stderr.write(f"no sittings in the last {a.days} days.\n")
        return 0

    # Every commit in every repository this machine's own transcripts resolved to. Not a
    # guess at where somebody keeps code, and not an API round trip that would know less.
    roots = sorted({f.repo for f in facts if f.repo})
    commits: list[float] = []
    for root in roots:
        commits += [ts for _sha, ts in cap_repo.commits_in(root, cutoff, time.time())]
    if not commits:
        sys.stderr.write(
            f"no commits in the last {a.days} days across {len(roots)} repositor(y/ies).\n"
        )
        return 0

    offset = facts[-1].tz_offset_minutes
    graph = co_mod.split(commits, [(f.started_at, f.ended_at) for f in facts], offset)
    share = graph.assisted_share

    print(
        f"{graph.total} commits over {graph.active_days} days in "
        f"{len(roots)} repositor{'y' if len(roots) == 1 else 'ies'}."
    )
    if share is not None:
        print(
            f"{graph.assisted} landed while an agent was working ({round(share * 100)}%), "
            f"{graph.alone} you committed on your own."
        )
    else:
        print(
            f"{graph.assisted} with an agent, {graph.alone} on your own. "
            f"Too few to call a share yet ({co_mod.MIN_COMMITS} needed)."
        )
    print(
        f"Longest run of days you shipped: {graph.longest_streak}. "
        f"Currently on {graph.current_streak}.\n"
    )
    for d in graph.days[-21:]:
        bar = "#" * min(d.assisted, 40) + "." * min(d.alone, 40)
        print(f"  {d.day}  {bar:<42} {d.total:>3}")
    print("\n  # landed with an agent, . you committed on your own")
    return 0


def _trends(a) -> int:
    """Two equal windows, back to back. Never a window against all of history: that
    reports the trend of the corpus growing."""
    from . import profile as pf_mod
    from . import trends as tr_mod

    facts, _ = _narrative_inputs(pathlib.Path(a.path).expanduser())
    now = time.time()
    edge = now - a.window * 86400
    floor = now - 2 * a.window * 86400
    recent = [f for f in facts if f.started_at >= edge]
    earlier = [f for f in facts if floor <= f.started_at < edge]

    found = tr_mod.compare(pf_mod.corpus_profile(earlier), pf_mod.corpus_profile(recent))
    if not found:
        sys.stderr.write(
            f"not enough on both sides yet: {len(earlier)} sitting(s) in the "
            f"{a.window} days before last, {len(recent)} since. "
            f"{tr_mod.MIN_SESSIONS} of each are needed.\n"
        )
        return 0

    line = tr_mod.headline(found, a.window)
    if line:
        print(f"{line}\n")
    for t in found:
        if t.steady:
            mark, tail = "  steady", ""
        else:
            mark = "      up" if t.direction == "up" else "    down"
            tail = (
                ""
                if t.good is None
                else ("   the way you want it" if t.good else "   worth a look")
            )
        print(f"{mark} {abs(t.move):>5.0%}  {t.label:<38} {t.before:>8g} -> {t.now:<8g}{tail}")
    print(
        f"\n{found[0].sessions_now} sittings in the last {a.window} days, "
        f"{found[0].sessions_before} in the {a.window} before that."
    )
    return 0


def _agents(a) -> int:
    """The delegations: how many agents, running at once or in a chain, and what landed.

    NEVER a token, a line or a commit: the parent's `Agent` tool result already reports a
    subagent's work in aggregate, and counting the sidecars again is the globbing revert
    in CLAUDE.md happening a second time. This reads them to describe the DELEGATION.
    """
    import datetime as _dt

    from capture import discover
    from capture import sessions as cap

    from . import agents as ag_mod

    root = pathlib.Path(a.path).expanduser()
    cutoff = time.time() - a.days * 86400
    total_agents = total_seconds = 0
    peak = 0
    kinds: collections.Counter[str] = collections.Counter()
    produced = 0
    rows = []

    for t in discover.iter_root_transcripts(root):
        spans = ag_mod.spans(t.path)
        if not spans:
            continue
        if max(s.ended_at for s in spans) < cutoff:
            continue
        wall = max(s.ended_at for s in spans) - min(s.started_at for s in spans)
        fo = ag_mod.fanout(spans, wall)
        total_agents += fo.agents
        total_seconds += fo.agent_seconds
        peak = max(peak, fo.max_concurrent)
        produced += fo.produced
        kinds.update(fo.by_type)
        rows.append((t.path.stem, fo))

    if not rows:
        sys.stderr.write(
            f"no subagents in the last {a.days} days. Every sitting was you and one agent.\n"
        )
        return 0

    hours = total_seconds / 3600
    print(
        f"{total_agents} agents across {len(rows)} sittings, {hours:.1f} hours of agent work.\n"
        f"{produced} of them produced something. The most running at once was {peak}.\n"
    )
    for name, fo in sorted(rows, key=lambda r: -r[1].agents)[:6]:
        print(
            f"  {name[:8]}  {fo.agents} agents, up to {fo.max_concurrent} at once, "
            f"{fo.agent_seconds / 60:.0f} agent-minutes over {fo.busy_seconds / 60:.0f} busy "
            f"minutes ({fo.parallelism}x) in a {fo.wall_seconds / 60:.0f} minute stretch"
        )
        for sp in sorted(fo.spans, key=lambda s: -s.landed)[:3]:
            print(
                f"      {(sp.agent_type or 'unknown'):<17} {sp.seconds / 60:5.1f}m  "
                f"{sp.landed:2} landed  {(sp.asked or 'no brief recorded')[:56]}"
            )
        print()
    if kinds:
        print("  by kind: " + ", ".join(f"{k} {v}" for k, v in kinds.most_common()))
    return 0


def _playbook(a) -> int:
    """Your own two piles, side by side. No model call: this is all measurement."""
    from . import playbook as pb_mod

    facts, sessions = _narrative_inputs(pathlib.Path(a.path).expanduser())
    cutoff = time.time() - a.days * 86400
    picked = [s for f, s in zip(facts, sessions, strict=True) if f.started_at >= cutoff]
    tried = pb_mod.attempts(picked)
    stats = pb_mod.summary(tried)
    if stats["value"] is None:
        sys.stderr.write(
            f"not enough to compare yet: {stats['reason']}, over {stats['n']} prompt(s).\n"
        )
        return 0

    worked, cost = pb_mod.split(tried)
    print(
        f"{stats['worked']} of {stats['n']} prompts landed something without you having to "
        f"take it back. That is {round(stats['value'] * 100)}%.\n"
    )
    print("THESE LANDED, AND YOU NEVER TOUCHED THE WHEEL")
    for at in worked[: a.top]:
        print(f"\n  {at.landed} things landed over {at.tool_calls} tool calls")
        print(f"  {_wrap(at.text)}")
    print("\n\nTHESE COST YOU A ROUND TRIP")
    for at in cost[: a.top]:
        why = "you corrected it" if at.corrected else (
            "it ran a long way with nothing landing" if at.stalled else "nothing landed"
        )
        print(f"\n  {why}, after {at.tool_calls} tool calls")
        print(f"  {_wrap(at.text)}")
    print()
    return 0


def _wrap(text: str, width: int = 92) -> str:
    import textwrap

    return textwrap.fill(text[:400], width=width, subsequent_indent="  ")


def _rules(a) -> int:
    """Failures that happened in more than one sitting, and the lines that stop them."""
    from . import rules as ru

    facts, sessions = _narrative_inputs(pathlib.Path(a.path).expanduser())
    cutoff = time.time() - a.days * 86400
    picked = [(f, s) for f, s in zip(facts, sessions, strict=True) if f.started_at >= cutoff]
    if a.repo:
        picked = [(f, s) for f, s in picked if f.repo and a.repo.lower() in f.repo.lower()]
    root = collections.Counter(f.repo for f, _ in picked if f.repo).most_common(1)
    project = pathlib.Path(root[0][0]).name if root else "this project"

    found = ru.recurring([s for _, s in picked])
    if not found:
        sys.stderr.write(
            f"nothing has failed in more than one of your last {len(picked)} sittings. "
            f"Every error was a one off, which is the good outcome.\n"
        )
        return 0

    if a.list:
        for i, r in enumerate(found, 1):
            hours = r.span_seconds / 3600
            print(
                f"[{i}] {r.sessions} sittings, {r.occurrences}x"
                + (f", spread over {hours:.0f}h" if hours >= 1 else "")
            )
            print(f"     ran  {r.command[:110]}")
            print(f"     got  {r.error[:110]}")
            print()
        return 0

    kw = {"model": a.model} if a.model else {}
    doc = ru.write(project=project, recurrences=found, **kw)
    lines = []
    for r in doc["rules"]:
        evidence = found[r["candidate"] - 1]
        mark = {"certain": "", "likely": "  (likely)", "guess": "  (a guess, check it)"}
        lines.append(f"- {r['rule']}{mark.get(r.get('confidence', ''), '')}")
        lines.append(f"  {r['because']}")
        lines.append(
            f"  Seen in {evidence.sessions} sittings, {evidence.occurrences} times: "
            f"{evidence.error[:120]}"
        )
        lines.append("")
    text = "\n".join(lines)

    if a.out:
        path = pathlib.Path(a.out)
        with path.open("a") as fh:
            fh.write(f"\n## Rules from failures that kept coming back\n\n{text}")
        sys.stderr.write(f"appended {len(doc['rules'])} rule(s) to {a.out}\n")
    else:
        print(text)
        sys.stderr.write(
            f"{len(found)} recurring failure(s), {len(doc['rules'])} rule(s) proposed. "
            f"Read them, then `--out CLAUDE.md` to append the ones you keep.\n"
        )
    return 0


def _shipped(a) -> int:
    """One repository, one window, one draft post about what got built in it."""
    import datetime as _dt

    from capture import repo as cap_repo

    from . import shipped as sh

    facts, sessions = _narrative_inputs(pathlib.Path(a.path).expanduser())
    cutoff = time.time() - a.days * 86400
    picked = [(f, s) for f, s in zip(facts, sessions, strict=True) if f.started_at >= cutoff]
    if a.repo:
        picked = [(f, s) for f, s in picked if f.repo and a.repo.lower() in f.repo.lower()]
    if not picked:
        sys.stderr.write(
            f"no sessions in the last {a.days} days"
            + (f" in a repository matching {a.repo!r}" % () if a.repo else "")
            + ". Nothing to write a post about.\n"
        )
        return 0

    # ONE repository per post. A post that spans two projects is two posts, and a reader
    # cannot tell which half of it they are looking at. The busiest one wins when the
    # window covers several and `--repo` did not narrow it.
    by_repo = collections.Counter(f.repo for f, _ in picked if f.repo)
    root = by_repo.most_common(1)[0][0] if by_repo else None
    picked = [(f, s) for f, s in picked if f.repo == root]
    project = pathlib.Path(root).name if root else "this project"

    commits = _commit_messages(root, cutoff) if root else []
    files = sorted({e.path.rsplit("/", 1)[-1] for _, s in picked for e in s.events if e.path})[:40]
    struggle_list = sh.struggles([s for _, s in picked], commits)
    dependencies = sh.stack_evidence(root)
    summaries = _stored_summaries([f.session_id for f, _ in picked])

    since = _dt.date.fromtimestamp(cutoff)
    source = sh.build_input(
        project=project,
        since=since,
        until=_dt.date.today(),
        session_summaries=summaries,
        commits=commits,
        files=files,
        struggle_list=struggle_list,
        dependencies=dependencies,
    )
    if a.dry_run:
        print(source)
        sys.stderr.write(
            f"\n{len(picked)} session(s) in {project}, {len(commits)} commit(s), "
            f"{len(struggle_list)} measured struggle(s), {len(summaries)} analysed. "
            f"Nothing was sent.\n"
        )
        return 0

    kw = {"model": a.model} if a.model else {}
    doc = sh.write(
        project=project,
        since=since,
        until=_dt.date.today(),
        session_summaries=summaries,
        commits=commits,
        files=files,
        struggle_list=struggle_list,
        dependencies=dependencies,
        **kw,
    )
    text = json.dumps(doc, indent=1, ensure_ascii=False)
    if a.out:
        pathlib.Path(a.out).write_text(text)
        sys.stderr.write(f"wrote {a.out}\n")
    else:
        print(text)
    return 0


def _commit_messages(common_root: str | None, since: float, cap: int | None = 40) -> list[str]:
    """`corpus.commit_messages`: the one reader of commit subjects."""
    from . import corpus as cp_mod

    return cp_mod.commit_messages(common_root, since, cap)


def _stored_summaries(session_ids: list[str]) -> list[dict]:
    """Any analyses this machine has already written for these sessions.

    Read from the capture state file rather than recomputed: an analysis costs a model
    call, and drafting a post is not a reason to spend one per session in the window.
    """
    from capture import client as cl

    state = cl.read_json(cl.state_path()) or {}
    cache = state.get("analysis") or {}
    out = []
    for sid in session_ids:
        body = cache.get(sid)
        if not isinstance(body, dict):
            continue
        out.append(
            {
                "headline": body.get("headline"),
                "summary": body.get("summary"),
                "highlights": body.get("highlights") or [],
            }
        )
    return out


def _cards(a) -> int:
    """Every postable card this corpus can honestly produce, most postable first."""
    from . import brag
    from . import patterns as pat
    from . import profile as pf_mod

    facts, sessions = _narrative_inputs(pathlib.Path(a.path).expanduser())
    prof = pf_mod.corpus_profile(facts)
    found = pat.findings(sessions)
    made = brag.cards(prof, found)
    if not made:
        sys.stderr.write(
            f"nothing postable yet from {len(facts)} session(s). A card needs a finding "
            f"that cleared its bars, or a priced model comparison.\n"
        )
        return 0
    for c in made:
        print(f"[{c.postability:.2f} {c.kind:>10}]  {c.headline}")
        if c.detail:
            print(f"{'':>19}{c.detail}")
        print()
    return 0


def _recent_trends(facts, window_days: int = 30):
    """`report.recent_trends` on the wall clock: the last `window_days` against the
    `window_days` before, both the same length, or nothing for a first month."""
    from . import report as rp_mod

    return rp_mod.recent_trends(facts, window_days, time.time())


def _narrative_inputs(root: pathlib.Path, *, lean: bool = False):
    """(facts, session events) for the whole corpus, from `corpus.cut`, the one place the
    corpus is cut. `lean` as the cut takes it."""
    from . import corpus as cp_mod

    c = cp_mod.cut_root(root, lean=lean)
    return c.facts, c.sessions


def rp_default() -> int:
    """The report's default window, read from the module that owns it rather than typed
    into the help text a second time."""
    from . import report as rp_mod

    return rp_mod.DEFAULT_WINDOW_DAYS


def _report(a) -> int:
    """The builder report: every measured block, assembled and printed.

    This is the document `python -m capture report` uploads, byte for byte: both commands
    cut the corpus with `corpus.cut` and build the document with `report.from_corpus`, so
    printing it here is the honest way to see what would leave the machine before any of
    it does. `--quotes` prints the opt in quotes document after it, which only
    `capture report --quotes` ever sends.
    """
    from . import corpus as cp_mod
    from . import report as rp_mod

    days = a.days or rp_mod.DEFAULT_WINDOW_DAYS
    c = cp_mod.cut_root(pathlib.Path(a.path).expanduser())
    doc, quotes = rp_mod.from_corpus(c, days, quotes=a.quotes)
    text = json.dumps(doc, indent=1, ensure_ascii=False)
    if quotes is not None:
        text += "\n" + json.dumps(quotes, indent=1, ensure_ascii=False)
    if a.out:
        pathlib.Path(a.out).write_text(text)
        sys.stderr.write(f"wrote {a.out}\n")
    else:
        print(text)
    return 0


def _narrative(a) -> int:
    """profile + findings -> `claude -p` -> the page, printed or written.

    Everything here reads the machine's own transcripts. `--findings-only` is the honest
    dry run: it prints exactly what the model would be shown about the person's habits,
    costs nothing, and is the fastest way to see WHY a page says what it says.
    """
    from . import narrative as nar
    from . import patterns as pat
    from . import profile as pf_mod

    from . import corpus as cp_mod

    c = cp_mod.cut_root(pathlib.Path(a.path).expanduser())
    facts, sessions = c.facts, c.sessions
    found = pat.findings(sessions)

    if a.findings_only:
        if not found:
            sys.stderr.write(
                f"no finding cleared the bars over {len(sessions)} sessions "
                f"(both sides need {pat.MIN_GROUP}, the gap needs {pat.MIN_LIFT}x)\n"
            )
            return 0
        for f in found:
            print(f"[{f.lift:>6}x] {f.text}")
            print(f"          left  {f.left}")
            print(f"          right {f.right}\n")
        return 0

    prof = pf_mod.corpus_profile(facts)
    # Everything else this machine can measure, so the page reflects the whole picture
    # rather than the one module the prose happened to start from.
    kw = {"model": a.model} if a.model else {}
    doc = nar.write(
        profile=prof,
        findings=found,
        trends=_recent_trends(facts),
        fanout=c.fanout,
        contributions=c.contributions,
        **kw,
    )
    text = json.dumps(doc, indent=1, ensure_ascii=False)
    if a.out:
        pathlib.Path(a.out).write_text(text)
        sys.stderr.write(f"wrote {a.out}\n")
    else:
        print(text)
    return 0


def _transcripts(root: pathlib.Path):
    """`corpus.transcripts`: every root transcript under `root`, or the one file it names."""
    from . import corpus as cp_mod

    return cp_mod.transcripts(root)


def _excluded(session, excluded: set[str]) -> bool:
    """`corpus.excluded`: a sitting in a repository the person excluded is in no corpus and
    no live view ("an excluded repo produces ZERO uploads")."""
    from . import corpus as cp_mod

    return cp_mod.excluded(session, excluded)


def _distinct(session):
    """`corpus.distinct`: the sitting with each event once."""
    from . import corpus as cp_mod

    return cp_mod.distinct(session)


def _corpus_facts(root: pathlib.Path, *, lean: bool = False) -> tuple[list, list]:
    """(facts, the sessions they came from) for a whole `~/.claude/projects` tree, from
    `corpus.cut` (see its docstring for what the cut holds). The sessions travel back
    beside the facts because the comparative findings need the EVENTS, prompt wording
    included, and a `SessionFact` is deliberately a summary. Nothing that reads the
    sessions may upload them."""
    from . import corpus as cp_mod

    c = cp_mod.cut_root(root, lean=lean)
    return c.facts, c.kept


if __name__ == "__main__":
    sys.exit(main())
