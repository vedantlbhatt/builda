"""THE ONE CORPUS CUT: every session a machine holds, cut once, with everything the
documents about a person rest on (docs/overnight-integration.md 1.3).

`python -m analysis report` and `python -m capture report` both describe one corpus, and
two functions that each sessionize are two functions that will one day disagree about how
many sessions somebody had: the same bug as a wrong number, arriving as two screens that
contradict each other. It happened. `capture/cli.py _corpus` cut its own corpus beside
`analysis/__main__.py _corpus_facts`, and it passed no token counts (so `capture report`
refused spend with "no session reported token counts" about sessions that all did), no
burn, did not read each event once, and did not leave out an excluded repository. This
module is the body of `_corpus_facts` and `_narrative_inputs` with the commit subjects and
the subagent fan out beside them; both commands call `cut`, so they cannot differ.

WHAT IS IN A CUT, in the order it is made:

  * the reference sessionizer (`capture.sessions.sessionize_sources`: v3 lineage pooling,
    fitted tau), FINAL sittings only (a live one's numbers move every minute), none in a
    repository the person excluded (`BUILDER_CAPTURE_EXCLUDE`: "an excluded repo produces
    ZERO uploads"), each event read once (`patterns.distinct_events`), and only the
    sittings `capture.sessions.is_counted` counts, which is what decides `visible` on the
    wire and so the population the phone shows;
  * per sitting, a `SessionFact` with the ledger's five token buckets and output tokens by
    model (deduplicated on `message.id` across the sitting, never summed off records: 1.878x),
    and burn over every file its records came from, windowed to it (`burn.turns_for_window`,
    each message once across a resumed sitting's files), barren causes included;
  * the repository on each fact and the commits `git log` says landed in its window, each
    commit to the first sitting that claims it (`profile.attribute_commits`), and beside it
    how many landed in that window at all (`SessionFact.commits_in_window`);
  * every commit over one window (`commit_window`, read once by `commit_log`), as the
    commit graph (`contributions.split`) and the subjects, so the kind of work card and the
    shipped card count the same commits; git walks every local branch
    (`capture.tuning.GIT_LOG_REFS`), because a worktree's commits are on its own branch;
  * the subagent fan out, from the sidecars of the transcripts the KEPT sittings came
    from, each agent inside one of them (never a token, a line or a commit:
    `analysis/agents.py`); an agent that ran in an excluded repository is not in it;
  * what each repository's manifests say it depends on (`shipped.stack_evidence`), matched
    against the stack catalog and dropped there: no manifest string leaves the machine.

A cut is EVERY final sitting the machine holds. A report asks about a window, and
`window` narrows a cut to it (the report's `from_corpus` calls it): the facts, the events,
the sittings, the commits, the agents and the manifests, all to the same bound.

`lean=True` skips what only the corpus cards read (burn, commit attribution, the graph, the
subjects, the fan out and the manifests) for a caller that reads the clocks and the
repository alone: the live ETA's history and the vocabulary. MEASURED (FOUND IN REVIEW,
2026-09-13): `live` spent 19.7 s of 19.9 s cutting history, 7.2 s of it in 329 `git` calls
for commit attribution it never read.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
import functools
import pathlib
import time
from collections.abc import Sequence

from . import agents as ag_mod
from . import burn as bn_mod
from . import contributions as co_mod
from . import patterns as pat
from . import pricing as pr_mod
from . import profile as pf_mod


@dataclasses.dataclass(frozen=True)
class Corpus:
    """One cut. `facts`, `sessions`, `kept` and `roots` are parallel, one entry per counted
    final sitting, in the sessionizer's order: the `SessionFact`, its `SessionEvents` (the
    events, prompt wording included, which the comparative findings and the cards read and
    nothing uploads), the `capture.sessions.Session` it came from (records and all), and
    the repository's common root on this machine (None when it did not resolve)."""

    facts: list
    sessions: list
    kept: list
    roots: list
    fanout: ag_mod.Fanout | None
    contributions: co_mod.Contributions | None
    commit_subjects: list[str]
    #: `shipped.stack_evidence` strings over every root. LOCAL: the stack matches them
    #: against its catalog and emits only catalog ids.
    dependencies: list[str]
    #: The clock the cut was made on: every window and "today" below reads this, never the
    #: wall clock again, so one cut answers one question.
    now: float
    tz: dt.tzinfo
    #: Every commit behind `contributions` and `commit_subjects`, as (unix time, subject),
    #: so `window` can narrow both to a report's window without running git again. LOCAL,
    #: like the subjects. None on a cut built by hand (a test's), which `window` then keeps
    #: as it was given.
    commits: tuple[tuple[float, str], ...] | None = None
    #: `dependencies` per repository, so `window` keeps only the repositories a sitting in
    #: the window ran in. LOCAL. None on a cut built by hand.
    dependencies_by_root: dict[str, tuple[str, ...]] | None = None


def transcripts(root: pathlib.Path):
    """Every root transcript under `root`, or `root` itself when it is one transcript file.

    A directory is walked through `capture.discover.iter_root_transcripts`, the allowlist
    on path shape (CLAUDE.md, "Globbing"). A FILE is taken as the one transcript the person
    named, so every corpus command can answer about a single sitting's transcript; before,
    a file here was walked as a directory, found nothing, and answered about zero sessions
    without saying why.
    """
    from capture import discover

    root = pathlib.Path(root).expanduser()
    if root.is_file():
        return [discover.Transcript(project_dir=root.parent.name, path=root)]
    return discover.iter_root_transcripts(root)


def excluded(session, excluded_origins: set[str]) -> bool:
    """Is this sitting in a repository the person excluded (`BUILDER_CAPTURE_EXCLUDE`, read
    by `capture.repo.excluded_origins`)? The rule `capture/cli.py` applies before it builds
    a payload, written as a function here because every wire bound input this package cuts
    must apply it: "an excluded repo produces ZERO uploads" (privacy/upload-contract.json).
    FOUND IN REVIEW (2026-09-13): none of the corpus commands did. RECORDED: the rule
    belongs beside `is_counted` in `capture.sessions`."""
    return session.repo is not None and session.repo.identity in excluded_origins


def distinct(session):
    """The sitting with each event once (`patterns.distinct_events`): a resumed
    transcript's copy of the old one's records reaches the pooled sitting twice, and every
    count read off the events (lines, tool calls, prompts, commits, burn segments) would
    count them twice. FOUND IN REVIEW, MEASURED on the corpus: 5 of 158 sittings, 907
    agent lines and 5 prompts."""
    return dataclasses.replace(session, events=pat.distinct_events(session.events))


def commit_log(common_root: str | None, since: float, until: float | None = None) -> list[tuple[float, str]]:
    """(unix time, SUBJECT) for every commit from `since` (to `until` when given), newest
    first, from capture's own git runner. THE ONE READER of commits in this package: the
    commit graph and the subjects are two views of this list, so they count one set.

    The filters are `capture.repo.commits_in`'s: every local branch (`GIT_LOG_REFS`: git
    runs in the common root, the main checkout, whose HEAD never reaches a worktree's
    branch; MEASURED on this machine, 0 commits in two days from HEAD against 32 with
    `--branches`), no merges, vendored paths excluded. A subject may be empty; the times
    still count.
    """
    from capture import repo as cap_repo
    from capture.tuning import GIT_EXCLUDE_PATHSPECS, GIT_LOG_REFS

    if not common_root:
        return []
    out = cap_repo._git(
        [
            "log",
            *GIT_LOG_REFS,
            f"--since=@{since:.0f}",
            *([f"--until=@{until:.0f}"] if until is not None else []),
            "--pretty=format:%ct%x09%s",
            "--no-merges",
            "--",
            *GIT_EXCLUDE_PATHSPECS,
        ],
        common_root,
    )
    rows = []
    for line in (out or "").splitlines():
        ts, _, subject = line.partition("\t")
        if ts.isdigit():
            rows.append((float(ts), subject))
    return rows


def commit_messages(common_root: str | None, since: float, cap: int | None = 40) -> list[str]:
    """Commit SUBJECTS since `since` (`commit_log`), blank ones dropped.

    Subjects only: a body can run to forty lines in a repository with a commit-message
    convention, and a post needs to know what landed, not to read the reasoning again.
    `cap` is the build post's: forty subjects are enough to describe a week, and `None`
    reads them all for a caller that counts them (`commit_subjects`).
    """
    subjects = [s for _, s in commit_log(common_root, since) if s.strip()]
    return subjects if cap is None else subjects[:cap]


def commit_subjects(roots: Sequence[str], since: float) -> list[str]:
    """Every commit subject in the window across every repository, uncapped: the kind of
    work card counts them, and a cap would turn "25 of 247 are labelled" into a number
    about the first forty. The same `git log` filters as `capture.repo.commits_in` (no
    merges, vendored paths excluded), so the count matches `contributions.total`."""
    return [s for r in roots for s in commit_messages(r, since, cap=None)]


def commit_window(facts) -> tuple[list[str], float | None]:
    """(every repository the facts resolved to, when their commit window opens): the first
    sitting's start less the attribution lookback. The one definition the contribution
    graph and the commit subjects both read, so the two count the same commits."""
    roots = sorted({f.repo for f in facts if f.repo})
    if not roots or not facts:
        return roots, None
    return roots, min(f.started_at for f in facts) - co_mod.LOOKBACK_SEC


def split_commits(times: Sequence[float], facts, now: float) -> co_mod.Contributions | None:
    """Commits by day, split by whether any of `facts` was running; None with no commit or
    no sitting (absent, never an empty graph that reads as nothing done)."""
    if not times or not facts:
        return None
    return co_mod.split(
        list(times), [(f.started_at, f.ended_at) for f in facts], facts[-1].tz_offset_minutes, now
    )


def contributions_of(facts, now: float) -> co_mod.Contributions | None:
    """Commits by day over the facts' commit window (`commit_window`, `commit_log`), split
    by whether a sitting was running; None with no repository or no commit."""
    roots, since = commit_window(facts)
    if since is None:
        return None
    return split_commits([ts for r in roots for ts, _ in commit_log(r, since, now)], facts, now)


def fanout_over(spans: Sequence) -> ag_mod.Fanout | None:
    """`agents.fanout` over `spans`, the stretch being first start to last end; None when
    no agent ran."""
    if not spans:
        return None
    wall = max(s.ended_at for s in spans) - min(s.started_at for s in spans)
    return ag_mod.fanout(list(spans), wall)


def fanout_of(root_transcripts, kept=None) -> ag_mod.Fanout | None:
    """Every subagent the root transcripts dispatched, as one `Fanout`. Never a token.

    With `kept` (the cut's counted final sittings), only the agents a kept sitting
    dispatched: a transcript no kept sitting came from is not even opened, and an agent is
    counted when it started inside a kept sitting that read its transcript. FOUND IN
    REVIEW (2026-09-13): `cut` passed every root transcript, so an excluded repository's
    agents, and the free text type names its own `.claude/agents` gave them, reached the
    uploaded report ("an excluded repo produces ZERO uploads"). The same leak carried a
    live sitting's agents and a sitting too small to count.
    """
    if kept is None:
        return fanout_over([s for t in root_transcripts for s in ag_mod.spans(t.path)])
    windows: dict[str, list[tuple[float, float]]] = {}
    for s in kept:
        for path in {r["path"] for r in s.records}:
            windows.setdefault(path, []).append((s.started_at, s.ended_at))
    spans = [
        sp
        for t in root_transcripts
        if str(t.path) in windows
        for sp in ag_mod.spans(t.path)
        if any(a <= sp.started_at <= b for a, b in windows[str(t.path)])
    ]
    return fanout_over(spans)


def _offset_minutes(ts: float, tz: dt.tzinfo) -> int:
    offset = dt.datetime.fromtimestamp(ts, tz).utcoffset() or dt.timedelta(0)
    return int(offset.total_seconds() // 60)


def cut(
    sources: Sequence,
    root_transcripts: Sequence,
    tz: dt.tzinfo,
    now: float | None = None,
    *,
    tau: str | float = "auto",
    lean: bool = False,
) -> Corpus:
    """The corpus: `sources` are `capture.sessions.load_source` results (Claude Code root
    transcripts, and any other harness's stores the caller loaded), `root_transcripts` the
    Claude Code roots whose sidecars hold the subagents. See the module docstring for what
    is in it and why each step is there."""
    from capture import repo as cap_repo
    from capture import sessions as cap

    now = time.time() if now is None else now
    excluded_origins = cap_repo.excluded_origins()
    cut_ = [
        distinct(s)
        for s in cap.sessionize_sources(list(sources), tz, now=now, tau=tau)
        if s.state == "final" and not excluded(s, excluded_origins)
    ]

    # One parse per transcript however many sittings share it (docs/overnight-engine.md
    # 5.3). MEASURED on `~/.claude/projects`, 345 counted sessions, 2026-09-13: 1.6 s of
    # burn over a 7.4 s cut with the loader memoised, where unmemoised it was 49.9 s. Local
    # to this call, so a long `live --watch` never answers from a stale parse.
    load_turns = functools.lru_cache(maxsize=None)(bn_mod.load_turns)

    facts, kept, sessions = [], [], []
    for s in cut_:
        # `capture.sessions.is_counted`, not a second copy of the rule: it is what decides
        # `visible` on the wire, and a private reimplementation here is a definition of
        # "a session" that can drift from the one the phone uses.
        if not cap.is_counted(s):
            continue
        # Output tokens per model come from the reference LEDGER (deduplicated on
        # `message.id` across the sitting's files, sidechain and `<synthetic>` records
        # excluded), never from summing `.message.usage`: that inflates by 1.878x
        # (CLAUDE.md). Share times
        # the ledger total is also exactly what the server has to work with, so the two
        # paths cannot disagree about the model mix.
        ledger = cap.token_ledger(s.records)
        reported = ledger.reported and ledger.buckets
        by_model: dict[str, int] = {}
        if reported:
            out_tokens = ledger.buckets["output"]
            for entry in ledger.models:
                by_model[entry["model_id"]] = round(entry["output_token_share"] * out_tokens)
        minutes = _offset_minutes(s.started_at, tz)
        # Where the tokens went, cut at the same prompts `burn` cuts one transcript at.
        # Every file the sitting's records came from, each message once across them,
        # windowed to the sitting. None when the harness wrote no counts:
        # `session_burn_detail` refuses rather than say 0.
        spent = (
            None
            if lean
            else bn_mod.session_burn_detail(
                s.events,
                bn_mod.turns_for_window(
                    sorted({r["path"] for r in s.records}),
                    s.started_at,
                    s.ended_at,
                    loader=load_turns,
                ),
            )
        )
        facts.append(
            pf_mod.session_fact_from_events(
                session_id=s.client_session_id,
                events=s.events,
                started_at=s.started_at,
                ended_at=s.ended_at,
                attended_seconds=s.attended,
                autonomous_seconds=s.autonomous,
                tz_offset_minutes=minutes,
                output_tokens_by_model=by_model,
                # The five buckets, straight from the ledger. `cache_read` is billed at a
                # tenth of the input rate and `cache_w5m` at 1.25x it, so they travel
                # separately: adding them up and multiplying by one price overcharges
                # cache-heavy work by a factor that grows with how well the cache worked.
                tokens=pr_mod.Tokens(**ledger.buckets) if reported else None,
                unattended=s.presence == 0,
                burn_tokens=spent["tokens"] if spent else None,
                barren_tokens=spent["barren"] if spent else None,
                unreadable_tokens=spent["unreadable"] if spent else None,
                barren_causes=spent["causes"] if spent else None,
            )
        )
        cost, dominant = pr_mod.priced_session(ledger, pf_mod.DOMINANT_SHARE)
        sessions.append(
            pat.SessionEvents(
                session_id=s.client_session_id,
                started_at=s.started_at,
                ended_at=s.ended_at,
                active_seconds=s.attended + s.autonomous,
                attended_seconds=s.attended,
                tz_offset_minutes=minutes,
                events=s.events,
                # Output tokens from the ledger, never summed off the events: `Ev.tok_out`
                # is set only on the records that happen to carry usage and MEASURED it
                # reported 39,487 output tokens for 21 hours of work. None when the harness
                # reports none, which is a refusal rather than a zero.
                output_tokens=ledger.buckets["output"] if reported else None,
                cost_usd=cost,
                dominant_model=dominant,
            )
        )
        kept.append(s)

    # WHICH repository, on the fact itself. Without it every session looks like it ran in
    # the same place, which makes `_corpus_commits` treat one machine's whole corpus as a
    # single repo and refuse the total for overlaps that are not overlaps. FOUND BY RUNNING
    # `shipped --dry-run`, which reported "0 commits" for a window with nine of them in it.
    roots = [s.repo.common_root if s.repo else None for s in kept]
    facts = [dataclasses.replace(f, repo=r) for f, r in zip(facts, roots, strict=True)]
    if lean:
        return Corpus(facts, sessions, kept, roots, None, None, [], [], now, tz)

    # Commits: `git log` over the session window, the same definition the uploader stores
    # and the server aggregates. Counting `git commit` shell calls off the digest text is
    # 3.5x low (MEASURED: 19 of 68 calls survive the 160 character cut on this corpus). A
    # commit goes to the FIRST sitting whose window contains it: windows overlap, and
    # summing per session counts reported 92 commits where the repository had 68.
    facts = pf_mod.attribute_commits(facts, roots, cap_repo.commits_in)

    from . import shipped as sh_mod

    # One read of every commit in the window, which the graph and the subjects both view.
    commit_roots, since = commit_window(facts)
    log = [(ts, s) for r in commit_roots for ts, s in commit_log(r, since, now)] if since is not None else []
    by_root = {r: tuple(sh_mod.stack_evidence(r)) for r in commit_roots}
    return Corpus(
        facts=facts,
        sessions=sessions,
        kept=kept,
        roots=roots,
        fanout=fanout_of(root_transcripts, kept),
        contributions=split_commits([ts for ts, _ in log], facts, now),
        commit_subjects=[s for _, s in log if s.strip()],
        dependencies=[d for r in commit_roots for d in by_root[r]],
        now=now,
        tz=tz,
        commits=tuple(log),
        dependencies_by_root=by_root,
    )


def window(c: Corpus, days: int) -> Corpus:
    """The cut narrowed to the last `days`: every sitting that STARTED at or after
    `c.now - days * 86400`, and everything read beside them narrowed to the same bound.

    THE BUG THIS EXISTS FOR. The report says "the last 30 days" and the phone prints it,
    and `from_corpus` built every block over every sitting the machine held. FOUND IN
    REVIEW (2026-09-13): the committed report read "The last 30 days ... Aug 11 to Sep 13",
    34 days, and a probe of 30 sittings three days apart priced all 30 over 88 days where
    10 started inside the window. A window is a question, and answering a different one
    under its name is the worst failure CLAUDE.md records.

    What narrows, and to what:
      * facts, sessions and kept (parallel), by the sitting's start;
      * commits (`commits`), by their own time: the graph and the subjects count what
        landed in the window, and a commit still counts as assisted when it landed inside
        a sitting that began before the edge (every fact's window is read for that), so
        the edge never turns an agent's commit into one you wrote alone;
      * the agents, by their start, over the kept sittings' agents the cut found;
      * the manifests, to the repositories a sitting in the window ran in.
    A cut built by hand without `commits`, `dependencies_by_root` or the fan out's spans
    keeps those as it was given: there is nothing to narrow them with.
    """
    edge = c.now - days * 86400
    keep = [i for i, f in enumerate(c.facts) if f.started_at >= edge]
    facts = [c.facts[i] for i in keep]

    def narrowed(xs: list) -> list:
        # Parallel to the facts by the dataclass's contract; a hand built cut may leave
        # one empty, and then there is nothing in it to narrow.
        return [xs[i] for i in keep] if len(xs) == len(c.facts) else list(xs)

    fo = c.fanout
    if fo is not None and len(fo.spans) == fo.agents:
        fo = fanout_over([s for s in fo.spans if s.started_at >= edge])

    contributions, subjects = c.contributions, c.commit_subjects
    if c.commits is not None:
        inside = [(ts, s) for ts, s in c.commits if ts >= edge]
        contributions = split_commits([ts for ts, _ in inside], c.facts, c.now)
        subjects = [s for _, s in inside if s.strip()]

    dependencies = c.dependencies
    if c.dependencies_by_root is not None:
        dependencies = [d for r in sorted({f.repo for f in facts if f.repo}) for d in c.dependencies_by_root.get(r, ())]

    return dataclasses.replace(
        c,
        facts=facts,
        sessions=narrowed(c.sessions),
        kept=narrowed(c.kept),
        roots=narrowed(c.roots),
        fanout=fo,
        contributions=contributions,
        commit_subjects=subjects,
        dependencies=dependencies,
        commits=None if c.commits is None else tuple((ts, s) for ts, s in c.commits if ts >= edge),
    )


def cut_root(root: pathlib.Path, *, tz: dt.tzinfo | None = None, now: float | None = None, lean: bool = False) -> Corpus:
    """`cut` over every root transcript under `root` (or the one file it names), on this
    machine's zone: what `python -m analysis` means by a corpus."""
    from capture import sessions as cap

    found = transcripts(root)
    return cut(
        [cap.load_source(t) for t in found],
        found,
        tz or dt.datetime.now().astimezone().tzinfo,
        now,
        lean=lean,
    )


__all__ = [
    "Corpus",
    "commit_log",
    "commit_messages",
    "commit_subjects",
    "commit_window",
    "contributions_of",
    "cut",
    "cut_root",
    "distinct",
    "excluded",
    "fanout_of",
    "fanout_over",
    "split_commits",
    "transcripts",
    "window",
]
