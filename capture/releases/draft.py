"""Release drafts made on the Mac: a project's facts, a trigger, words held to the evidence, one PUT.

The phone owns the switch and the timing (`release_settings`: `drafts_to_phone`, `every_commits`,
`cadence`, `on_shipped`, docs/social.md). The Mac reads them (`GET /v1/me/release-settings`) and
drafts only for a project whose switch is on; the server refuses anything else (403 `drafts_off`).
A draft replaces the project's one live draft (`PUT /v1/projects/{key}/releases/draft`). Nothing is
published from here: the owner reads the draft on the phone, edits it, publishes or dismisses it.

FACTS, for one project (`gather`):
  the commits in the checkout's own history (`HEAD`, merges left out) since the last PUBLISHED
    release (`GET /v1/me/releases?status=published`), counted with `git rev-list --count`, and the
    newest `SUBJECTS_CAP` of their subjects as written. HEAD, not every local branch (attribution's
    `GIT_LOG_REFS`): a release says what shipped, and work parked on a branch did not;
  the build post (`work/<key>/shipped.json`, from `python -m analysis shipped`): its `what` always,
    its `changes` only when the post was written after that release, since older ones were news then;
  the kit beside the demo (`<key>/kit/kit.json`), as an id and a time, for the `shipped` trigger;
  the trailer the PUBLISHED kit carries, and its version (`GET /v1/projects/{key}/kit`), read only
    when a draft is about to be written.

TRIGGERS (`decide`), first match wins, each only while `drafts_to_phone` is on. "The baseline" is
the later of the last published release and the last draft this Mac made.
  tagged   a tag in HEAD's history made after the baseline and not the one the last draft saw: the
           owner named a version (0038). The title leads with it.
  merged   a branch merged into HEAD's first parent line after the baseline, not the merge the last
           draft saw: a feature landed (0038). The title is the branch's name, in words.
  shipped  `on_shipped`, and a build post or a kit whose id is not the one the last draft saw and
           whose file was written after the baseline (with no baseline at all, any).
  commits  the commits after the baseline reach `every_commits`.
  cadence  `weekly` or `biweekly`, 7 or 14 days since the baseline (with no baseline, since this
           Mac first saw the switch on), and something new since the last published release: a
           commit, or a build post or kit written after it.
  asked    only `python -m capture release draft`, which drafts whatever the state.
NEVER TWICE FOR ONE STATE: when the newest commit, the last published release, the build post and
the kit are all what they were when the last draft was made, no automatic trigger drafts.

WORDS (`write`). The rules first, no model: the highlights are the commit subjects cleaned (a
conventional prefix such as `feat:` or `fix(map):` taken off, merges and `fixup!` commits dropped,
a trailing `(#12)` dropped, capitalised, no full stop, features ranked before fixes before chores),
or the build post's changes when no subject is left; the title is the first of them; the notes
are the build post's `what`, its changes, the commit count and the trailer, as plain sentences.
Then, unless told not to, the person's own `claude` (`analysis.run.call_claude`, draft_schema.json,
draft_prompt.txt) rewrites them plainly. Then the checks, which can only REMOVE, on both paths:
  NUMBERS  every number in the words is one the input holds (`capture.shipkit.copy.numbers_unknown`,
           strict, the captions' rule). A model title with another number throws the model's
           whole answer away and the rules' draft is used; a sentence or a highlight with one is
           deleted, never edited, since a sentence with its number cut out says something else.
  NAMES    this project's and this Mac's other repositories' names (`privacy.label_leaks`), the
           project key, a key shaped string or an email address: deleted the same way.
  DASHES   rewritten, never refused (`analysis.run.dedash`, and a spaced hyphen typed as one).

STATE, one file per project, owner only: `<demos dir>/releases/<key>.json` (`state_path`):
  seen_at        when this Mac first saw the switch on (the cadence's anchor with no baseline)
  drafted_at     when the last draft was sent (unix seconds)
  trigger        what fired it; source: `rules` or `model`
  commit, published_id, shipped_id, kit_id   the state it was drafted from (the double draft rule)
  commits        the count it carried; release_id: the server's id for it
  refused        a code, when the server refused it for good (404 or 422): that state is not
                 sent again. A 403 or a server that is down records nothing and is tried again.
"""

from __future__ import annotations

import argparse
import dataclasses
import datetime as dt
import json
import math
import os
import pathlib
import re
import subprocess
import time
from collections.abc import Callable

from capture.demo import paths

HERE = pathlib.Path(__file__).resolve().parent
SCHEMA_PATH = HERE / "draft_schema.json"
PROMPT_PATH = HERE / "draft_prompt.txt"

# server/builder/releases.py, restated because capture imports nothing of the server; the test
# reads that file with `ast` and holds every one of these to it.
TRIGGERS = ("commits", "shipped", "cadence", "asked", "tagged", "merged")
CADENCES = ("none", "weekly", "biweekly")
TITLE_MAX = 80
NOTES_MAX = 1200
HIGHLIGHTS_MAX = 5
HIGHLIGHT_MAX = 120
EVERY_COMMITS = (3, 200)
DEFAULT_SETTINGS = {"every_commits": 10, "cadence": "none", "on_shipped": True, "drafts_to_phone": False}

#: How long each cadence waits, in days: what its name says.
CADENCE_DAYS = {"weekly": 7, "biweekly": 14}
DAY = 86400
#: The worker checks at most this often, in seconds. A judgement, not a measurement: a check is one
#: settings read, then a server read and at most four git calls per opted in project, and a draft
#: is not news by the minute.
CHECK_EVERY = 10 * 60
#: How many commit subjects are read for the words. The count is `rev-list --count` and uncapped.
SUBJECTS_CAP = 60

#: What each outcome code says in a line of the worker's log or the CLI's output.
SAYS = {
    "drafts_off": "drafts are off for this project; the phone turns them on in its release settings",
    "not_found": "the server holds no project of yours with this key",
    "no_checkout": "no checkout of it on this Mac",
    "same_state": "nothing is new since the last draft",
    "nothing_due": "no trigger is due",
    "nothing_new": "nothing to say: no commit since the last release and no build post",
    "empty_title": "the server found the title empty",
    "empty_highlight": "the server found a highlight empty",
}


# ------------------------------------------------------------------------ small rules


def settings_of(raw: dict | None) -> dict:
    """A project's settings with the server's defaults under them, and a value the server could
    not have sent read as its default (pure)."""
    s = {**DEFAULT_SETTINGS, **{k: v for k, v in (raw or {}).items() if v is not None}}
    every = s["every_commits"]
    if isinstance(every, bool) or not isinstance(every, int) or not EVERY_COMMITS[0] <= every <= EVERY_COMMITS[1]:
        s["every_commits"] = DEFAULT_SETTINGS["every_commits"]
    if s["cadence"] not in CADENCES:
        s["cadence"] = DEFAULT_SETTINGS["cadence"]
    s["on_shipped"] = s["on_shipped"] is not False
    s["drafts_to_phone"] = s["drafts_to_phone"] is True
    return s


def unix(value) -> float | None:
    """Seconds since the epoch from an ISO time the server wrote, or None."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        d = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return (d if d.tzinfo else d.replace(tzinfo=dt.UTC)).timestamp()


def later(*values: float | None) -> float | None:
    got = [v for v in values if v is not None]
    return max(got) if got else None


# ------------------------------------------------------------------------ facts


def _git(src: pathlib.Path, *args: str) -> str | None:
    try:
        r = subprocess.run(["git", "-C", str(src), *args], capture_output=True, text=True, timeout=60, check=False,
                           env={**os.environ, "GIT_OPTIONAL_LOCKS": "0"}, stdin=subprocess.DEVNULL)  # fmt: skip
    except (OSError, subprocess.SubprocessError):
        return None
    return r.stdout if r.returncode == 0 else None


def _after(since: float | None) -> list[str]:
    """Strictly after `since`: git's `--since` keeps a commit made in that very second, and git
    counts whole seconds."""
    return [] if since is None else [f"--since=@{math.floor(since) + 1}"]


def count_since(src: pathlib.Path, since: float | None) -> int | None:
    """Commits in HEAD's history after `since`, merges left out; None when git cannot say."""
    out = (_git(src, "rev-list", "--count", "--no-merges", "HEAD", *_after(since)) or "").strip()
    return int(out) if out.isdigit() else None


def newest(src: pathlib.Path) -> str | None:
    out = (_git(src, "log", "HEAD", "-n1", "--format=%H") or "").strip()
    return out or None


def newest_tag(src: pathlib.Path) -> tuple[str | None, float | None]:
    """(the newest tag in HEAD's history, when it was made): an annotated tag's own date, a light
    one's commit's."""
    out = (_git(src, "for-each-ref", "refs/tags", "--merged", "HEAD", "--sort=-creatordate", "--count=1",
                "--format=%(refname:short) %(creatordate:unix)") or "").strip()  # fmt: skip
    name, _, at = out.rpartition(" ")
    return (name or None, float(at)) if name and at.isdigit() else (None, None)


#: A merge commit's subject, to the branch it brought in: git's own words and a forge's.
_MERGED = re.compile(
    r"^Merge (?:pull request #\d+ from [^/\s]+/(?P<pr>\S+)|(?:remote-tracking )?branch '(?:origin/)?(?P<br>[^']+)')"
)
#: Branches that are a line of work themselves, not a feature landing on one.
_TRUNKS = {"main", "master", "develop", "dev", "trunk", "staging", "release", "production", "prod"}
_TICKET = re.compile(r"^(?:[A-Za-z]+-\d+|\d+)$")


def feature_words(branch: str) -> str | None:
    """A branch's name as the feature it is: `feature/leave-now-times` is "Leave now times"; a trunk,
    a ticket number alone or one word says nothing and is None (pure)."""
    last = re.sub(r"^[A-Za-z]+-\d+[-_]*", "", branch.strip().rsplit("/", 1)[-1])
    if last.lower() in _TRUNKS:
        return None
    parts = [w for w in re.split(r"[-_.\s]+", last) if w and not _TICKET.match(w)]
    if len(parts) < 2:
        return None
    return capital(" ".join(w.lower() if not w.isupper() else w for w in parts))


def merges_since(src: pathlib.Path, since: float | None, cap: int = 10) -> tuple[list[str], str | None]:
    """(the features merged into HEAD's first parent line after `since`, newest first, in words;
    the newest such merge's commit)."""
    out = _git(src, "log", "HEAD", "--first-parent", "--merges", f"-n{cap}", "--format=%H%x00%s", *_after(since)) or ""
    words, head = [], None
    for ln in out.splitlines():
        sha, _, subject = ln.partition("\x00")
        m = _MERGED.match(subject.strip())
        w = feature_words(m.group("pr") or m.group("br")) if m else None
        if w and w not in words:
            words.append(w)
            head = head or sha
    return words, head


def subjects_since(src: pathlib.Path, since: float | None, cap: int = SUBJECTS_CAP) -> list[str]:
    """The subjects of the newest `cap` commits after `since`, newest first, as written."""
    out = _git(src, "log", "HEAD", "--no-merges", f"-n{cap}", "--format=%s", *_after(since)) or ""
    return [s for s in out.splitlines() if s.strip()]


@dataclasses.dataclass
class Facts:
    """Everything a draft may say about one project, and what its triggers read."""

    key: str
    checkout: pathlib.Path | None = None
    published_id: str | None = None
    published_at: float | None = None
    #: Since the last published release; None when there is no checkout to count in.
    commits: int | None = None
    #: Since the baseline: the later of the last published release and the last draft.
    new_commits: int = 0
    commit: str | None = None
    subjects: list[str] = dataclasses.field(default_factory=list)
    what: str | None = None
    changes: list[str] = dataclasses.field(default_factory=list)
    shipped_id: str | None = None
    shipped_at: float | None = None
    kit_id: str | None = None
    kit_at: float | None = None
    has_trailer: bool = False
    trailer_version: int | None = None
    #: The newest tag in HEAD's history and when it was made (the `tagged` trigger, the title).
    tag: str | None = None
    tag_at: float | None = None
    #: Features merged since the baseline, in words, and the newest such merge (`merged`).
    merged: list[str] = dataclasses.field(default_factory=list)
    merged_head: str | None = None

    def signature(self) -> dict:
        """The state a draft is made from: the double draft rule compares exactly these."""
        return {"commit": self.commit, "published_id": self.published_id, "shipped_id": self.shipped_id, "kit_id": self.kit_id,
                "tag": self.tag, "merged_head": self.merged_head}  # fmt: skip


def shipped_path(key: str) -> pathlib.Path:
    return paths.work_dir(key) / "shipped.json"


def kit_path(key: str) -> pathlib.Path:
    return paths.out_dir(key) / "kit" / "kit.json"


def _read(path: pathlib.Path) -> tuple[dict | None, float | None]:
    try:
        doc = json.loads(path.read_text())
        at = path.stat().st_mtime
    except (OSError, ValueError):
        return None, None
    return (doc, at) if isinstance(doc, dict) else (None, None)


def gather(key: str, checkout: pathlib.Path | None, published: dict | None, state: dict) -> Facts:
    """One project's facts. `published` is the last published release (the server's row) or None;
    `state` is what the last draft recorded (`load_state`)."""
    f = Facts(key=key, checkout=checkout)
    if published:
        f.published_id = str(published["id"]) if published.get("id") else None
        f.published_at = unix(published.get("published_at"))
    if checkout is not None:
        f.commits = count_since(checkout, f.published_at)
        base = later(f.published_at, state.get("drafted_at"))
        f.new_commits = (f.commits if base == f.published_at else count_since(checkout, base)) or 0
        f.commit = newest(checkout)
        f.subjects = subjects_since(checkout, f.published_at)
        f.tag, f.tag_at = newest_tag(checkout)
        f.merged, f.merged_head = merges_since(checkout, base)
    post, at = _read(shipped_path(key))
    if post is not None:
        f.what = str(post.get("what") or "").strip() or None
        f.shipped_id = str(post.get("generated_at") or int(at))
        f.shipped_at = at
        if f.published_at is None or at > f.published_at:
            f.changes = [str(c["text"]).strip() for c in post.get("changes") or [] if isinstance(c, dict) and str(c.get("text") or "").strip()]
    kit, at = _read(kit_path(key))
    if kit is not None:
        f.kit_id = f"{kit.get('made_at') or int(at)} {str(kit.get('commit') or '')[:12]}".strip()
        f.kit_at = at
    return f


# ------------------------------------------------------------------------ the trigger


def _fresh(ident: str | None, at: float | None, seen: str | None, base: float | None) -> bool:
    return ident is not None and ident != seen and (base is None or (at is not None and at > base))


def decide(settings: dict | None, f: Facts, state: dict, now: float) -> tuple[str | None, str]:
    """(the trigger, or None, and the code for why): the module docstring's TRIGGERS (pure)."""
    s = settings_of(settings)
    if not s["drafts_to_phone"]:
        return None, "drafts_off"
    if state.get("drafted_at") is not None and all(state.get(k) == v for k, v in f.signature().items()):
        return None, "same_state"
    base = later(f.published_at, state.get("drafted_at"))
    if f.tag and f.tag != state.get("tag") and (base is None or (f.tag_at is not None and f.tag_at > base)):
        return "tagged", "tagged"
    if f.merged and f.merged_head and f.merged_head != state.get("merged_head"):
        return "merged", "merged"
    if s["on_shipped"] and (_fresh(f.shipped_id, f.shipped_at, state.get("shipped_id"), base)
                            or _fresh(f.kit_id, f.kit_at, state.get("kit_id"), base)):  # fmt: skip
        return "shipped", "shipped"
    if f.new_commits >= s["every_commits"]:
        return "commits", "commits"
    days = CADENCE_DAYS.get(s["cadence"])
    if days:
        anchor = base if base is not None else state.get("seen_at")
        new = (f.commits or 0) > 0 or _fresh(f.shipped_id, f.shipped_at, None, f.published_at) or _fresh(f.kit_id, f.kit_at, None, f.published_at)
        if anchor is not None and now - anchor >= days * DAY and new:
            return "cadence", "cadence"
    return None, "nothing_due"


# ------------------------------------------------------------------------ the words


_MERGE = re.compile(r"^Merge (?:branch|branches|remote-tracking branch|pull request|tag|commit)\b", re.I)
_AUTOSQUASH = re.compile(r"^(?:fixup|squash|amend)!", re.I)
_CONVENTIONAL = re.compile(
    r"^(?P<type>feat|feature|fix|bugfix|hotfix|perf|refactor|revert|docs?|style|tests?|chore|build|ci|deps)(?:\([^)]*\))?!?\s*:\s*",
    re.I,
)
_TRAILING_REF = re.compile(r"\s*(?:\((?:#|!|GH-)\d+\)|\[(?:skip ci|ci skip|no ci|skip actions)\])\s*$", re.I)
_BULLET = re.compile("^(?:[-*\u2022\u00b7]\\s+)+")
_KEYBOARD_DASH = re.compile(r"\s-{1,2}\s")
#: A subject that says nothing a reader could use.
_NOISE = re.compile(r"^(?:wip|work in progress|tmp|temp|misc|minor|updates?|initial commit|first commit|init)$", re.I)
#: Features first, then fixes, then a subject with no type, then the housekeeping (the ranks).
_RANK = {"feat": 0, "feature": 0, "fix": 1, "bugfix": 1, "hotfix": 1, "perf": 1}
_HOUSEKEEPING = 3
_ONE_WORD = 4


def plain_words(text) -> str:
    """One line with no dash in it (`analysis.plain.DASH`): a dash character rewritten by
    `analysis.run.dedash`, a spaced hyphen typed as a dash made a comma, a leading bullet dropped."""
    from analysis import plain
    from analysis import run as rn

    s = _BULLET.sub("", " ".join(str(text or "").split()))
    for _ in range(8):
        if not plain.has_dash(s):
            break
        s = _KEYBOARD_DASH.sub(", ", f" {s} ").strip()
        s, _ = rn.dedash(s)
    return s.strip(" ,;:")


def cut(text: str, limit: int) -> str:
    """At most `limit` characters, cut at a word, with no dangling punctuation (pure)."""
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    head = text[: limit + 1]
    head = head.rsplit(" ", 1)[0] if " " in head else head[:limit]
    return head.rstrip(" ,;:.")[:limit]


def capital(text: str) -> str:
    return text[:1].upper() + text[1:] if text[:1].islower() else text


def tidy(text, limit: int) -> str:
    """A title or a highlight: plain words, a capital first letter, no full stop, within `limit`."""
    return cut(capital(plain_words(text).rstrip(" .")), limit)


def clean_subject(subject: str) -> tuple[int, str] | None:
    """(its rank, the subject as a highlight), or None for a merge, an autosquash commit or one that
    says nothing (pure). Only takes off and tidies: it never rewrites what the subject says."""
    s = " ".join(str(subject).split())
    if not s or _MERGE.match(s) or _AUTOSQUASH.match(s):
        return None
    rank = 2
    m = _CONVENTIONAL.match(s)
    if m:
        kind = m.group("type").lower()
        rank = _RANK.get(kind, _HOUSEKEEPING)
        s = s[m.end() :]
    elif s.lower().startswith('revert "'):
        rank = _HOUSEKEEPING
    s = _TRAILING_REF.sub("", s)
    s = tidy(s, HIGHLIGHT_MAX)
    if not s or _NOISE.match(s):
        return None
    if len(s.split()) < 2:
        rank = max(rank, _ONE_WORD)
    return rank, s


def ranked(subjects: list[str]) -> list[str]:
    """The subjects as highlights, best first: by rank, then newest first; one of each (pure)."""
    rows: list[tuple[int, int, str]] = []
    seen: set[str] = set()
    for i, subject in enumerate(subjects):
        c = clean_subject(subject)
        if c is None or c[1].lower() in seen:
            continue
        seen.add(c[1].lower())
        rows.append((c[0], i, c[1]))
    return [text for _, _, text in sorted(rows)]


def build_input(f: Facts) -> str:
    """What the model reads, and the text every number in the words is checked against (pure)."""
    first = f.published_id is None
    lines = ["THE PROJECT", f"  what it is: {f.what or '(not recorded)'}",
             "  this is its first release" if first else "  it has published releases before"]  # fmt: skip
    if f.tag:
        lines += [f"  its newest version tag: {f.tag}"]
    if f.merged:
        lines += ["", "FEATURES MERGED SINCE THE LAST RELEASE, from their branch names"] + [f"  {m}" for m in f.merged]
    if f.changes:
        lines += ["", "WHAT IS NEW, from the builder's own session record"] + [f"  {c}" for c in f.changes]
    if f.subjects:
        head = "THE LATEST COMMITS" if first else "THE COMMITS SINCE THE LAST RELEASE"
        lines += ["", f"{head}, newest first, as written (never quote a hash or a file name)"] + [f"  {s}" for s in f.subjects]
    lines += ["", "NUMBERS YOU MAY USE, and only these"]
    numbers = []
    if f.commits is not None:
        numbers.append(f"  commits {'so far' if first else 'since the last release'}: {f.commits}")
    if f.has_trailer and f.trailer_version is not None:
        numbers.append(f"  the trailer's version: {f.trailer_version}")
    return "\n".join(lines + (numbers or ["  none"]))


def carries_key(text: str, key: str) -> bool:
    """The project key, a key shaped string or an email address (`privacy.find`'s rules)."""
    from capture.demo import privacy

    if key and key[:12].lower() in text.lower():
        return True
    return any(h.reason in ("token", "email") for h in privacy.find([privacy.Line(text, (0, 0, 0, 0))], ()))


def verdict_for(source: str, names=(), others=(), key: str = "") -> Callable[[str], str | None]:
    """The checks, as one function of a piece of text: a refusal code, or None when it may stay."""
    from analysis import plain
    from capture.demo import privacy
    from capture.shipkit.copy import numbers_unknown

    def verdict(text: str) -> str | None:
        if numbers_unknown(text, source):
            return "invented_number"
        if (names or others) and privacy.label_leaks([text], tuple(names), tuple(others)):
            return "names_a_repository"
        if carries_key(text, key):
            return "carries_a_key"
        if plain.has_dash(text):
            return "dash"
        return None

    return verdict


@dataclasses.dataclass
class Words:
    title: str
    notes: str
    highlights: list[str]
    source: str = "rules"
    #: What the checks removed: {"what", "code", "text"}.
    dropped: list[dict] = dataclasses.field(default_factory=list)
    #: Why the model was not used, when it was asked and could not answer.
    no_model: str | None = None


def sentences_of(text) -> list[str]:
    return [s for s in re.split(r"(?<=[.!?])\s+", " ".join(str(text or "").split())) if s]


def sentence(text: str) -> str:
    return text if text[-1:] in ".!?" else text + "."


def within(parts: list[str], limit: int) -> str:
    """Whole sentences, as many as fit in `limit`."""
    out = ""
    for p in parts:
        nxt = f"{out} {p}".strip()
        if len(nxt) > limit:
            break
        out = nxt
    return out


def count_sentence(f: Facts) -> str | None:
    if f.commits is None:
        return None
    word = "commit" if f.commits == 1 else "commits"
    if f.published_id is None:
        return f"{f.commits} {word} so far, and this is the first release."
    if f.commits == 0:
        return "No new commits since the last release."
    return f"{f.commits} {word} since the last release."


def rules(f: Facts, verdict: Callable[[str], str | None]) -> Words | None:
    """The draft with no model (the module docstring's WORDS), every piece already checked; None
    when there is nothing to say."""
    dropped: list[dict] = []

    def keep(what: str, text: str) -> bool:
        code = verdict(text)
        if code:
            dropped.append({"what": what, "code": code, "text": text})
        return bool(text) and code is None

    subjects = [h for h in ranked(f.subjects) if keep("highlight", h)]
    changes = [c for c in (tidy(x, HIGHLIGHT_MAX) for x in f.changes) if keep("change", c)]
    what = tidy(f.what, TITLE_MAX) if f.what else ""
    if what and not keep("what", what):
        what = ""
    points = subjects or changes
    # A feature that landed (a merged branch) is what this release is: it leads, and what the
    # commits say follows it as highlights.
    feature = next((m for m in f.merged if keep("feature", tidy(m, TITLE_MAX))), None)
    if feature:
        points = [tidy(feature, TITLE_MAX)] + [x for x in points if x.lower() != feature.lower()]
    if points and len(points[0]) <= TITLE_MAX:
        title, highlights = points[0], points[1 : 1 + HIGHLIGHTS_MAX]
    elif points:
        # Too long to be the title whole: the title is its head, and it stays a highlight whole.
        title, highlights = cut(points[0], TITLE_MAX), points[:HIGHLIGHTS_MAX]
    elif f.commits:
        title, highlights = what or f"{f.commits} new {'commit' if f.commits == 1 else 'commits'}", []
    else:
        return None
    # A version tag made since the last release names this one: it leads the title.
    if f.tag and (f.published_at is None or (f.tag_at is not None and f.tag_at > f.published_at)) and keep("tag", f.tag):
        title = cut(f"{f.tag} · {title}", TITLE_MAX)
    notes: list[str] = []
    if what and what != title:
        notes.append(sentence(what))
    if subjects:
        notes += [sentence(c) for c in changes[:2] if c != title]
    for extra in (count_sentence(f), "It comes with a trailer." if f.has_trailer else None):
        if extra and keep("notes", extra):
            notes.append(extra)
    return Words(title, within(notes, NOTES_MAX), highlights, "rules", dropped)


def from_model(doc, verdict: Callable[[str], str | None]) -> tuple[Words | None, list[dict]]:
    """The model's answer after the checks, or (None, why) when its title cannot stand."""
    if not isinstance(doc, dict):
        return None, [{"what": "answer", "code": "not_an_answer", "text": ""}]
    title = tidy(doc.get("title"), TITLE_MAX)
    if not title:
        return None, [{"what": "answer", "code": "empty_title", "text": ""}]
    code = verdict(title)
    if code:
        return None, [{"what": "answer", "code": code, "text": title}]
    dropped: list[dict] = []
    notes: list[str] = []
    for s in sentences_of(doc.get("notes")):
        s = plain_words(s)
        code = verdict(s)
        if code:
            dropped.append({"what": "notes", "code": code, "text": s})
        elif s:
            notes.append(sentence(s))
    highlights: list[str] = []
    for h in doc.get("highlights") or []:
        h = tidy(h, HIGHLIGHT_MAX)
        code = verdict(h) if h else None
        if code:
            dropped.append({"what": "highlight", "code": code, "text": h})
        elif h and h.lower() not in {x.lower() for x in highlights}:
            highlights.append(h)
    return Words(title, within(notes, NOTES_MAX), highlights[:HIGHLIGHTS_MAX], "model", dropped), dropped


def ask_model(source: str) -> dict:
    """The person's own `claude`, no tools, with the schema beside this file; dashes rewritten."""
    from analysis import run as rn

    schema = json.loads(SCHEMA_PATH.read_text())
    for k in ("$schema", "$comment"):
        schema.pop(k, None)
    doc, _envelope = rn.call_claude(PROMPT_PATH.read_text(), source, schema)
    doc, _ = rn.dedash(doc)
    return doc


def write(f: Facts, names=(), others=(), *, use_model: bool = True, call: Callable[[str], dict] | None = None) -> Words | None:
    """The draft's words: the model's when it answered and its title stood the checks, else the
    rules'. None when there is nothing to say (no model is asked then either)."""
    from analysis import run as rn

    source = build_input(f)
    verdict = verdict_for(source, names, others, f.key)
    fallback = rules(f, verdict)
    if fallback is None or not use_model:
        return fallback
    try:
        doc = (call or ask_model)(source)
    except (rn.AnalysisError, OSError, ValueError) as e:
        fallback.no_model = str(e)[:200]
        return fallback
    words, dropped = from_model(doc, verdict)
    if words is None:
        fallback.dropped = dropped + fallback.dropped
        return fallback
    return words


def body_of(f: Facts, w: Words, trigger: str) -> dict:
    """The PUT's body (routes/releases.py `DraftIn`)."""
    return {"title": w.title, "notes": w.notes, "highlights": list(w.highlights[:HIGHLIGHTS_MAX]), "commits": f.commits,
            "trigger": trigger, "has_trailer": bool(f.has_trailer), "trailer_version": f.trailer_version if f.has_trailer else None}  # fmt: skip


def problems(body: dict) -> list[str]:
    """What the server's door would refuse in `body`, checked here so a draft is never sent to be
    refused (pure). Empty when it would pass."""
    from analysis import plain

    out = []
    if not body["title"].strip() or len(body["title"]) > TITLE_MAX:
        out.append("title")
    if len(body["notes"]) > NOTES_MAX:
        out.append("notes")
    hs = body["highlights"]
    if len(hs) > HIGHLIGHTS_MAX or any(not h.strip() or len(h) > HIGHLIGHT_MAX for h in hs):
        out.append("highlights")
    if body["trigger"] not in TRIGGERS:
        out.append("trigger")
    if body["trailer_version"] is not None and (not body["has_trailer"] or not 1 <= body["trailer_version"] <= 1000):
        out.append("trailer_version")
    if any(plain.has_dash(t) for t in [body["title"], body["notes"], *hs]):
        out.append("dash")
    return out


# ------------------------------------------------------------------------ state


def state_path(key: str) -> pathlib.Path:
    return paths.demos_dir() / "releases" / f"{paths.out_dir(key).name}.json"


def load_state(key: str) -> dict:
    try:
        doc = json.loads(state_path(key).read_text())
    except (OSError, ValueError):
        return {}
    return doc if isinstance(doc, dict) else {}


def save_state(key: str, state: dict) -> None:
    from capture.client import write_private_json

    p = state_path(key)
    paths.private_dir(p.parent)
    write_private_json(p, state)


def record(state: dict, f: Facts, trigger: str, w: Words, now: float, got: dict | None = None, refused: str | None = None) -> dict:
    release = (got or {}).get("release") or {}
    return {**state, "project_key": f.key, "drafted_at": int(now), "trigger": trigger, **f.signature(), "commits": f.commits,
            "source": w.source, "release_id": release.get("id"), "refused": refused}  # fmt: skip


# ------------------------------------------------------------------------ the server


class Api:
    """The release routes, through the paired Mac's credentials (the demo requests' client)."""

    def __init__(self, server: str, client=None):
        if client is None:
            from capture.client import Client

            client = Client(server)
        self.client = client

    def _call(self, method: str, path: str, body: dict | None = None) -> dict:
        from capture.client import HTTPFailure

        status, parsed = self.client._authorized(method, path, body)
        if not 200 <= status < 300:
            raise HTTPFailure(status, json.dumps(parsed))
        return parsed if isinstance(parsed, dict) else {}

    def settings(self) -> list[dict]:
        return [s for s in self._call("GET", "/v1/me/release-settings").get("settings") or [] if isinstance(s, dict)]

    def last_published(self, key: str) -> dict | None:
        got = self._call("GET", f"/v1/me/releases?status=published&project_key={key}").get("releases") or []
        dated = [r for r in got if isinstance(r, dict) and unix(r.get("published_at")) is not None]
        return max(dated, key=lambda r: unix(r["published_at"])) if dated else None

    def trailer(self, key: str) -> tuple[bool, int | None]:
        """(whether the published kit carries a trailer, its version)."""
        kit = self._call("GET", f"/v1/projects/{key}/kit").get("kit")
        t = ((kit or {}).get("document") or {}).get("trailer")
        if not isinstance(t, dict):
            return False, None
        v = t.get("version")
        return True, v if isinstance(v, int) and not isinstance(v, bool) and 1 <= v <= 1000 else None

    def put_draft(self, key: str, body: dict) -> dict:
        return self._call("PUT", f"/v1/projects/{key}/releases/draft", body)


def code_of(e) -> str:
    """The code in a refusal's `detail`, or `http_<status>`."""
    try:
        detail = json.loads(e.body).get("detail")
    except (ValueError, AttributeError, TypeError):
        detail = None
    return detail if isinstance(detail, str) and re.fullmatch(r"[a-z_]{2,40}", detail) else f"http_{getattr(e, 'status', 0)}"


def names_for_checkout(key: str, checkout: pathlib.Path | None) -> tuple[tuple, tuple]:
    """(this project's names and this Mac's, the Mac's other repositories' names): what no word of
    the draft may say, resolved as the ship kit resolves them (`kit.names_for`)."""
    from capture.demo import privacy
    from capture.demo import project as pj

    if checkout is None:
        return tuple(privacy.machine_names()), ()
    try:
        project = pj.from_checkout(checkout)
    except pj.ProjectError:
        return tuple(privacy.machine_names()), ()
    from capture.shipkit import kit

    return kit.names_for(project, argparse.Namespace(no_transcripts=False, root="~/.claude/projects"))


# ------------------------------------------------------------------------ one project, and all


def run_one(api: Api, key: str, checkout: pathlib.Path | None, settings: dict | None = None, *, asked: bool = False,
            dry_run: bool = False, use_model: bool = True, now: float | None = None, resolve=None, call=None) -> dict:  # fmt: skip
    """Decide and, when a trigger fires (or `asked`), write and send one project's draft. Returns
    what happened: {key, status: drafted | dry_run | skipped | refused | failed, trigger, why, ...}.
    A dry run writes nothing, sends nothing, and reads the server only to count."""
    from capture.client import HTTPFailure

    now = time.time() if now is None else now
    paths.out_dir(key)  # a key that is not 64 hex names no file here
    state = load_state(key)
    out: dict = {"key": key, "trigger": None, "why": None}
    try:
        published = api.last_published(key)
    except Exception as e:
        if not dry_run:
            raise
        published = None
        out["note"] = f"the last published release is unknown ({e}), so it is counted as the first"
    f = gather(key, checkout, published, state)
    out["facts"] = f
    trigger, why = ("asked", "asked") if asked else decide(settings, f, state, now)
    if not dry_run and state.get("seen_at") is None:
        state["seen_at"] = int(now)
        save_state(key, state)
    out.update(trigger=trigger, why=why)
    if trigger is None:
        out["status"] = "skipped"
        return out
    try:
        f.has_trailer, f.trailer_version = api.trailer(key)
    except Exception:  # noqa: BLE001 (a trailer the server cannot say is a draft without one)
        f.has_trailer, f.trailer_version = False, None
    names, others = (resolve or names_for_checkout)(key, checkout)
    words = write(f, names, others, use_model=use_model, call=call)
    if words is None:
        out.update(status="skipped", why="nothing_new")
        return out
    body = body_of(f, words, trigger)
    out.update(words=words, body=body)
    bad = problems(body)
    if bad:
        out.update(status="failed", why=f"the draft broke its own bounds: {', '.join(bad)}")
        return out
    if dry_run:
        out["status"] = "dry_run"
        return out
    try:
        got = api.put_draft(key, body)
    except HTTPFailure as e:
        code = code_of(e)
        out.update(status="refused", why=code)
        if e.status in (404, 422):
            save_state(key, record(state, f, trigger, words, now, refused=code))
        return out
    save_state(key, record(state, f, trigger, words, now, got=got))
    out.update(status="drafted", replaced=bool(got.get("replaced")), release_id=(got.get("release") or {}).get("id"))
    return out


def line(out: dict) -> str:
    """One outcome as one line of the worker's log (lower case, no dash)."""
    k, st, why = out["key"][:12], out.get("status"), out.get("why")
    title = (out.get("body") or {}).get("title")
    if st == "drafted":
        src = out["words"].source
        return f"  release {k}: drafted ({out['trigger']}, {src} words){', the draft that was there replaced' if out.get('replaced') else ''}: {title!r}"
    if st == "dry_run":
        return f"  release {k}: would draft ({out['trigger']}): {title!r}"
    if st == "skipped":
        return f"  release {k}: {SAYS.get(why, why)}"
    if st == "refused":
        return f"  release {k}: the server refused it, {SAYS.get(why, why)} ({why})"
    return f"  release {k}: not drafted ({why})"


def check(api: Api, *, dry_run: bool = False, use_model: bool = True, now: float | None = None, checkouts: dict | None = None,
          resolve=None, call=None, say: Callable[[str], None] = print, quiet: bool = False) -> list[dict]:  # fmt: skip
    """Every project whose owner turned drafts on, once: a draft where a trigger fires. `quiet`
    (the worker) says only what was drafted, refused or broke. A server that does not answer is a
    line, never an exception."""
    try:
        rows = api.settings()
    except Exception as e:  # noqa: BLE001 (the server being down is a line, not a crash)
        say(f"  releases: the server did not answer ({e})")
        return []
    on = [r for r in rows if settings_of(r)["drafts_to_phone"] and isinstance(r.get("project_key"), str)]
    if not on:
        if not quiet:
            say("  releases: no project has drafts to the phone turned on")
        return []
    if checkouts is None:
        from capture.shipkit.watch import known_checkouts

        checkouts = known_checkouts()
    outs = []
    for s in on:
        key = s["project_key"]
        src = checkouts.get(key)
        if src is None:
            out = {"key": key, "status": "skipped", "why": "no_checkout", "trigger": None}
        else:
            try:
                out = run_one(api, key, src, s, dry_run=dry_run, use_model=use_model, now=now, resolve=resolve, call=call)
            except Exception as e:  # noqa: BLE001 (one project must not stop the others)
                out = {"key": key, "status": "failed", "why": str(e)[:200], "trigger": None}
        outs.append(out)
        if not quiet or out["status"] != "skipped":
            say(line(out))
    return outs


class Due:
    """True at most once every `seconds`, kept in memory: a worker that starts checks at once."""

    def __init__(self, seconds: float = CHECK_EVERY, clock: Callable[[], float] = time.monotonic):
        self.seconds, self.clock, self.next = seconds, clock, None

    def __call__(self) -> bool:
        now = self.clock()
        if self.next is not None and now < self.next:
            return False
        self.next = now + self.seconds
        return True
