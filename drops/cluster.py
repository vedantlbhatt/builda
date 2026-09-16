"""The board's shape: which drops belong together, decided by the drops themselves.

THE REFERENCE IMPLEMENTATION. `mobile/src/drops/cluster.ts` runs the same rules on the phone,
because the board has to re cluster the moment a drop lands and a round trip to a Mac that may
be asleep is not a board. `drops/tests/test_cluster_parity.py` holds the two equal over the
real corpus: same clusters, same labels, same order, or the test fails.

WHY NOT EMBEDDINGS. An embedding needs a model, which means a key or a download, which means
the board does not work on a plane; and the thing being clustered is fifteen words of title,
summary and tags, where TF-IDF over character folded terms is not a compromise. It is also
INSPECTABLE: every cluster can say which shared terms put it together, and a person who
disagrees can read the reason. A cosine distance from an opaque vector cannot be argued with.

THE ALGORITHM, all of it:

  1. Terms. Title, summary and tags, lowercased, split on anything that is not a letter or a
     digit, stopwords dropped, stemmed by the crudest rule that works on this vocabulary
     (plural `s`, `es`, `ies`). Tags count THREE times and the kind counts TWICE, because a
     tag is what the planner thought the drop was ABOUT and the body text is how it said it.
  2. Weights. tf = 1 + log(count); idf = log((N + 1) / (df + 1)) + 1; L2 normalised, so a long
     summary cannot outweigh a short one.
  3. Similarity. Cosine, which on L2 normalised vectors is the dot product.
  4. Merging. Average link agglomeration: repeatedly merge the two clusters with the highest
     average pairwise similarity, while that similarity is at or above MERGE_FLOOR.
  5. Labels. The term with the greatest summed weight across the cluster that appears in at
     least half its members. Ties broken by document frequency and then alphabetically, so the
     label never depends on dictionary order. The WORD shown is the most common form the drops
     actually used, never the stem: see `surfaces`.

EVERY TIE IS BROKEN EXPLICITLY. Two pairs at the same similarity, two terms with the same
weight, two clusters of the same size: each one has a stated rule. Without them the Python and
the TypeScript would agree on most corpora and disagree on somebody's, which is the worst
possible version of this.
"""

from __future__ import annotations

import math
import re

#: Below this, two drops are not about the same thing. MEASURED on the real corpus in
#: drops/tests/corpus (see `docs/drops.md`, "What the floor was fitted to"): the four pasta
#: posts sit at 0.31 to 0.62 to each other, the five editor posts at 0.24 to 0.55, and the
#: highest similarity BETWEEN those two groups is 0.09. Any floor in [0.12, 0.24] produces the
#: same partition on this corpus; 0.18 is its middle. Re measure with
#: `python -m drops cluster --sweep` when the corpus grows.
MERGE_FLOOR = 0.18
#: A cluster past this size is a pile, not a group, and stops accepting merges. 9 is the widest
#: the board draws before it splits a hub into two rings (mobile/src/drops/layout.ts).
MAX_CLUSTER = 9
#: Weight multipliers. A tag is the planner's own answer to "what is this about".
TAG_WEIGHT = 3
KIND_WEIGHT = 2
#: A term in fewer than this many documents cannot be a label: a cluster of four named by a
#: word one of them used is a label that describes one drop and mislabels three.
LABEL_MIN_SHARE = 0.5

TOKEN = re.compile(r"[a-z0-9]+")

#: Short, and deliberately not a linguistics project. Every word here was in the real corpus's
#: titles and summaries and carried no information about what a drop was about.
STOPWORDS = frozenset("""
a an the and or but if then than that this these those with without within from into onto
for of to in on at by as is are was were be been being do does did doing done have has had
how what when where which who whom why you your yours it its they them their there here
i me my we us our he she his her not no nor so such can could should would will shall may
might must just only very more most much many few other some any all each every one two
new get gets got make makes made use uses used using way ways thing things stuff lot lots
like about over under after before while during between out up down off again once
video reel short shorts post posts clip watch watching see seen look looking show shows
tip tips trick tricks hack hacks guide tutorial explained explains
""".split())

#: Words that are true of nearly every drop on a builder's board and therefore separate none
#: of them. Kept apart from STOPWORDS because these are DOMAIN stopwords: they would carry
#: information on somebody else's board, and this list is the one to revisit when the corpus
#: stops being about coding.
WEAK = frozenset("code coding dev developer development software app apps build building".split())


def stem(word: str) -> str:
    """The crudest rule that folds the plurals this vocabulary actually contains.

    `skills`/`skill`, `shortcuts`/`shortcut`, `recipes`/`recipe`. Nothing else: an aggressive
    stemmer folds `pasta` and `paste`, and a board that clusters a recipe with a clipboard tip
    is worse than one that keeps two forms of a word apart.
    """
    if len(word) > 4 and word.endswith("ies"):
        return word[:-3] + "y"
    if len(word) > 4 and word.endswith(("ses", "xes", "zes", "ches", "shes")):
        return word[:-2]
    if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
        return word[:-1]
    return word


def terms_of(drop: dict) -> dict[str, int]:
    """The weighted term counts for one drop. `drop` is {kind, title, summary, tags}."""
    counts: dict[str, int] = {}

    def add(text: str, weight: int) -> None:
        for raw in TOKEN.findall((text or "").lower()):
            t = stem(raw)
            if len(t) < 2 or t in STOPWORDS or t.isdigit():
                continue
            counts[t] = counts.get(t, 0) + weight

    add(drop.get("title") or "", 1)
    add(drop.get("summary") or "", 1)
    for tag in drop.get("tags") or []:
        add(str(tag), TAG_WEIGHT)
    kind = drop.get("kind") or ""
    if kind and kind != "unknown":
        add(kind, KIND_WEIGHT)
    return counts


def surfaces(drops: list[dict]) -> dict[str, dict[str, int]]:
    """stem -> {the word as it was written: how many drops wrote it that way}.

    A LABEL IS A WORD SOMEBODY WROTE, NOT A STEM. MEASURED on the real corpus: the cluster for
    "Indie Hacker? Startup or SAAS?" was labelled `saa`, because `stem` takes a trailing `s` off
    anything longer than three letters that does not end in `ss`. The stem is the right thing to
    CLUSTER on and the wrong thing to print, and the two had been the same function. This is the
    lookup back.
    """
    out: dict[str, dict[str, int]] = {}
    for d in drops:
        seen: set[tuple[str, str]] = set()
        for text in [d.get("title") or "", d.get("summary") or "", *(d.get("tags") or [])]:
            for raw in TOKEN.findall(str(text).lower()):
                t = stem(raw)
                if len(t) < 2 or t in STOPWORDS or t.isdigit() or (t, raw) in seen:
                    continue
                seen.add((t, raw))
                out.setdefault(t, {})[raw] = out.setdefault(t, {}).get(raw, 0) + 1
    return out


def vectors(drops: list[dict]) -> tuple[list[dict[str, float]], dict[str, int]]:
    """L2 normalised TF-IDF vectors, and the document frequency table."""
    docs = [terms_of(d) for d in drops]
    n = len(docs)
    df: dict[str, int] = {}
    for doc in docs:
        for t in doc:
            df[t] = df.get(t, 0) + 1
    out: list[dict[str, float]] = []
    for doc in docs:
        vec: dict[str, float] = {}
        for t, c in doc.items():
            # A weak domain word still counts, at a quarter: it should not decide a cluster and
            # it should still break a tie between two drops that share nothing else.
            damp = 0.25 if t in WEAK else 1.0
            vec[t] = (1.0 + math.log(c)) * (math.log((n + 1) / (df[t] + 1)) + 1.0) * damp
        norm = math.sqrt(sum(v * v for v in vec.values())) or 1.0
        out.append({t: v / norm for t, v in vec.items()})
    return out, df


def cosine(a: dict[str, float], b: dict[str, float]) -> float:
    if len(b) < len(a):
        a, b = b, a
    return sum(v * b[t] for t, v in a.items() if t in b)


def _round(x: float) -> float:
    """Similarities are compared for equality across two languages, so they are compared at a
    fixed precision. IEEE doubles agree here, but the ORDER of the additions in a sparse dot
    product does not have to, and one ulp decides which of two equal pairs merges first."""
    return math.floor(x * 1e9 + 0.5) / 1e9


def cluster(drops: list[dict], *, floor: float = MERGE_FLOOR) -> list[list[int]]:
    """Indices grouped. Order: largest cluster first, then by its first member's index.

    Average link, recomputed from the members rather than carried in a Lance Williams update,
    because the corpus is a board (hundreds at most) and a recomputation cannot drift from the
    definition the way an incremental formula can.
    """
    vecs, _ = vectors(drops)
    n = len(drops)
    if n == 0:
        return []
    groups: list[list[int]] = [[i] for i in range(n)]

    while len(groups) > 1:
        best = (-1.0, -1, -1)
        for i in range(len(groups)):
            for j in range(i + 1, len(groups)):
                if len(groups[i]) + len(groups[j]) > MAX_CLUSTER:
                    continue
                total = sum(cosine(vecs[a], vecs[b]) for a in groups[i] for b in groups[j])
                sim = _round(total / (len(groups[i]) * len(groups[j])))
                # Strictly greater: the FIRST pair at a given similarity wins, and the loops
                # walk in index order, so the tie break is "the earliest pair" in both
                # languages rather than whichever the comparison happened to see last.
                if sim > best[0]:
                    best = (sim, i, j)
        if best[0] < floor:
            break
        _, i, j = best
        groups[i] = sorted(groups[i] + groups[j])
        groups.pop(j)

    groups.sort(key=lambda g: (-len(g), g[0]))
    return groups


def word_for(term: str, surf: dict[str, dict[str, int]]) -> str:
    """The stem as a word somebody wrote. Most common first, then longest, then alphabetical,
    so the answer is the same in both languages and does not depend on dictionary order."""
    forms = surf.get(term)
    if not forms:
        return term
    return sorted(forms, key=lambda w: (-forms[w], -len(w), w))[0]


def label(group: list[int], drops: list[dict], vecs: list[dict[str, float]],
          df: dict[str, int], surf: dict[str, dict[str, int]] | None = None) -> str:
    """What to call a cluster: the strongest term at least half of it shares.

    A singleton is labelled by its own strongest term, which is how a board of unrelated drops
    still reads as a map rather than as a row of dots.
    """
    need = max(1, math.ceil(len(group) * LABEL_MIN_SHARE))
    totals: dict[str, float] = {}
    shared: dict[str, int] = {}
    for i in group:
        for t, v in vecs[i].items():
            totals[t] = totals.get(t, 0.0) + v
            shared[t] = shared.get(t, 0) + 1
    eligible = [t for t, c in shared.items() if c >= need and t not in WEAK]
    if not eligible:
        eligible = [t for t, c in shared.items() if c >= need] or list(totals)
    if not eligible:
        return ""
    # Weight, then how many documents hold the term, then alphabetical. Three keys, so the
    # answer never depends on which order a dictionary happened to be built in.
    eligible.sort(key=lambda t: (-_round(totals[t]), -shared[t], t))
    return word_for(eligible[0], surf if surf is not None else surfaces(drops))


def board(drops: list[dict], *, floor: float = MERGE_FLOOR) -> list[dict]:
    """The clustered board: [{label, members: [index], size}], largest first."""
    vecs, df = vectors(drops)
    surf = surfaces(drops)
    return [
        {"label": label(g, drops, vecs, df, surf), "members": g, "size": len(g)}
        for g in cluster(drops, floor=floor)
    ]


def similarity_matrix(drops: list[dict]) -> list[list[float]]:
    """Every pairwise similarity, for `--sweep` and for the parity test."""
    vecs, _ = vectors(drops)
    return [[_round(cosine(a, b)) for b in vecs] for a in vecs]
