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
    model (deduplicated on `(source_id, message.id)`, never summed off records: 1.878x),
    and burn over every file its records came from, windowed to it (`burn.turns_for_window`,
    each message once across a resumed sitting's files), barren causes included;
  * the repository on each fact and the commits `git log` says landed in its window, each
    commit to the first sitting that claims it (`profile.attribute_commits`);
  * the commit graph (`contributions.split`) and every commit subject over one window
    (`commit_window`), so the kind of work card and the shipped card count the same commits;
  * the subagent fan out, from the ROOT transcripts' sidecars (never a token, a line or a
    commit: `analysis/agents.py`);
  * what each repository's manifests say it depends on (`shipped.stack_evidence`), matched
    against the stack catalog and dropped there: no manifest string leaves the machine.

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


def commit_messages(common_root: str | None, since: float, cap: int | None = 40) -> list[str]:
    """Commit SUBJECTS since `since`, from capture's own git runner.

    Subjects only: a body can run to forty lines in a repository with a commit-message
    convention, and a post needs to know what landed, not to read the reasoning again.
    `cap` is the build post's: forty subjects are enough to describe a week, and `None`
    reads them all for a caller that counts them (`commit_subjects`).
    """
    from capture import repo as cap_repo
    from capture.tuning import GIT_EXCLUDE_PATHSPECS

    if not common_root:
        return []
    out = cap_repo._git(
        [
            "log",
            f"--since=@{since:.0f}",
            "--pretty=format:%s",
            "--no-merges",
            "--",
            *GIT_EXCLUDE_PATHSPECS,
        ],
        common_root,
    )
    subjects = [line for line in (out or "").splitlines() if line.strip()]
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


def contributions_of(facts, now: float) -> co_mod.Contributions | None:
    """Commits by day, split by whether a sitting was running; None with no repository or
    no commit in the window (absent, never an empty graph that reads as nothing done)."""
    from capture import repo as cap_repo

    roots, since = commit_window(facts)
    if since is None:
        return None
    commits = [ts for r in roots for _sha, ts in cap_repo.commits_in(r, since, now)]
    if not commits:
        return None
    return co_mod.split(
        commits, [(f.started_at, f.ended_at) for f in facts], facts[-1].tz_offset_minutes, now
    )


def fanout_of(root_transcripts) -> ag_mod.Fanout | None:
    """Every subagent the root transcripts dispatched, as one `Fanout`. Never a token."""
    spans = [s for t in root_transcripts for s in ag_mod.spans(t.path)]
    if not spans:
        return None
    wall = max(s.ended_at for s in spans) - min(s.started_at for s in spans)
    return ag_mod.fanout(spans, wall)


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
        # `(source_id, message.id)`, sidechain and `<synthetic>` records excluded), never
        # from summing `.message.usage`: that inflates by 1.878x (CLAUDE.md). Share times
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

    commit_roots, since = commit_window(facts)
    return Corpus(
        facts=facts,
        sessions=sessions,
        kept=kept,
        roots=roots,
        fanout=fanout_of(root_transcripts),
        contributions=contributions_of(facts, now),
        commit_subjects=commit_subjects(commit_roots, since) if since is not None else [],
        dependencies=[d for r in commit_roots for d in sh_mod.stack_evidence(r)],
        now=now,
        tz=tz,
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
    "commit_messages",
    "commit_subjects",
    "commit_window",
    "contributions_of",
    "cut",
    "cut_root",
    "distinct",
    "excluded",
    "fanout_of",
    "transcripts",
]
