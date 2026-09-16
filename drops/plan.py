"""`claude -p` over a drop's text, then the gate that throws away what it cannot ground.

WHY THE MODEL IS CALLED ON THE MAC. `analysis/run.py` gives the reason and this module borrows
its `call_claude` rather than writing a second one: the person's own Claude Code subscription
pays for it, there is no key to manage, and the two calls cannot drift in how they scrub the
environment or close stdin. The `tools` argument was added there for this module's sibling,
`find.py`; the planner itself passes the default, which is no tools at all.

THE GATE IS THE PRODUCT. A constrained decoder guarantees the SHAPE of the document, and
nothing at all about whether it is true. Four rules run after it, in this order, and each one
can only remove:

  1. EVIDENCE. A move's `evidence` must appear in the text the model was given, compared with
     whitespace normalised and quotes folded. Nothing else is forgiven: no paraphrase, no
     "close enough" ratio. MEASURED on the real corpus in drops/tests: a model that is told
     this rule exists obeys it, and the moves it loses are the ones it invented.
  2. KIND. A `recipe` block on a drop whose kind is not `recipe` is dropped; a `recipe` kind
     with no ingredients or no steps is downgraded to `unknown` with `not_about_building`,
     because a recipe card with an empty ingredient list is the one output a person cannot
     tell from a working one.
  3. SOURCE. A source whose URL is not https, or whose `ref` looks like a sentence rather than
     a name, is removed from the move. The move survives with a null source and the finder
     goes looking; an install button pointing at a made up repository does not.
  4. DASHES. `analysis/run.py`'s `dedash`, the one dash rule in this repository, over every
     string except `evidence`, which is verbatim by definition and would fail rule 1 if it
     were rewritten.

WHAT IS NEVER DONE HERE. The plan is not retried with a different prompt when it comes back
empty, and a refusal is not turned into moves by a second pass. An empty plan with a reason is
the answer; a board full of things nobody can act on is the failure this whole module exists
to prevent.
"""

from __future__ import annotations

import datetime as dt
import json
import re
import unicodedata

from analysis.run import AnalysisError, call_claude, dedash

from . import SCHEMA_PATH, prompt as pr
from .resolve import Resolved
from .tables import DROPS_VERSION, DROP_KIND, MOVE_KIND, SOURCE_KIND

#: Sonnet, like the analyst. A drop is a few hundred words and five short moves; the ceiling
#: is the honesty of the gate, not the size of the model.
DEFAULT_MODEL = "sonnet"
#: MEASURED: a TikTok caption of 260 characters comes back in 12 to 20 s. The ceiling is for a
#: YouTube description with a full subtitle track behind it.
TIMEOUT_S = 180

#: Quote characters a model tidies without meaning to. Folded on both sides before the evidence
#: comparison, because losing a real move to a curly apostrophe is a bug in the gate.
_FOLD = {
    "‘": "'", "’": "'", "“": '"', "”": '"',
    " ": " ", "​": "", "﻿": "",
}
#: AN EMOJI IS NOT EVIDENCE, and asking a model to copy one back is asking it to fail.
#: MEASURED on the real corpus: the caption "EASY 20-minute 1-PAN Garlic Butter Pasta w Shrimp"
#: ended in a fried shrimp and the model copied every word of it verbatim and wrote a different
#: shrimp, so the gate threw away a correct move over a pictograph nobody was going to read.
#: Symbol and format characters (`So`, `Sk`, `Cf`) are dropped from BOTH sides. The words are
#: still compared exactly; this is the one class of character the rule was never about.
_DROPPED_CATEGORIES = frozenset({"So", "Sk", "Cf", "Cs", "Co"})
#: A `ref` is a name: `owner/repo`, `@scope/pkg`, `some-package`. A space or a full stop in the
#: middle means the model wrote a phrase into a field the installer will paste into a command.
_REF_OK = re.compile(r"^[A-Za-z0-9@._/+-]{1,140}$")


class PlanError(RuntimeError):
    pass


def subschema(name: str) -> dict:
    """One `$def` out of the generated schema, as a root schema of its own.

    `drops/recipe.py` asks a model for a `Recipe` and nothing else, and the shape it must
    match is already defined once, in spec/drops.v1.json. Lifting the definition out beats
    writing a second one that will drift from the field the server validates.
    """
    whole = json.loads(SCHEMA_PATH.read_text())
    defs = whole.get("$defs") or {}
    if name not in defs:
        raise PlanError(f"{name} is not a $def in {SCHEMA_PATH}")
    return {"title": name, **defs[name], "$defs": {k: v for k, v in defs.items() if k != name}}


def load_schema() -> dict:
    if not SCHEMA_PATH.exists():
        raise PlanError(f"{SCHEMA_PATH} missing — run `make gen`")
    schema = json.loads(SCHEMA_PATH.read_text())
    # The CLI resolves `$schema` as a reference and has no draft 2020-12 meta-schema
    # registered, so it rejects the whole document. analysis/run.py drops the same two keys
    # for the same reason.
    schema.pop("$schema", None)
    schema.pop("$comment", None)
    return schema


def fold(text: str) -> str:
    """Whitespace collapsed, smart quotes folded, emoji removed, lowercased. Comparison only."""
    out = text or ""
    for a, b in _FOLD.items():
        out = out.replace(a, b)
    out = "".join(ch for ch in out if unicodedata.category(ch) not in _DROPPED_CATEGORIES)
    return " ".join(out.split()).lower()


def evidence_ok(evidence: str, haystack_folded: str) -> bool:
    ev = fold(evidence).strip(" .,:;!?'\"")
    # Under four words an "evidence" span is a phrase that would match almost anything: "the
    # skill", "use it". It is not evidence, and a move resting on one is a move with none.
    return bool(ev) and len(ev.split()) >= 3 and ev in haystack_folded


def _clean_source(src: object) -> dict | None:
    if not isinstance(src, dict):
        return None
    kind, ref, url = src.get("source_kind"), src.get("ref"), src.get("url")
    if kind not in SOURCE_KIND:
        return None
    if not isinstance(url, str) or not url.startswith("https://") or len(url) > 500:
        return None
    if not isinstance(ref, str) or not _REF_OK.match(ref.strip()):
        return None
    return {"source_kind": kind, "ref": ref.strip(), "url": url}


def gate(plan: dict, text: str) -> tuple[dict, dict]:
    """Apply the four rules. Returns (plan, counts) and never raises on a bad field.

    Counts are kept and printed by the CLI because "the model wrote five moves and two
    survived" is the number that says whether the prompt is working. A gate whose losses
    nobody can see is a gate nobody can tune.
    """
    counts = {"moves_in": 0, "evidence_dropped": 0, "source_dropped": 0, "dashes": 0}
    haystack = fold(text)

    kind = plan.get("kind")
    if kind not in DROP_KIND:
        raise PlanError(f"kind {kind!r} is not one of {DROP_KIND}")

    moves_in = plan.get("moves") or []
    counts["moves_in"] = len(moves_in)
    kept: list[dict] = []
    for m in moves_in:
        if not isinstance(m, dict) or m.get("move_kind") not in MOVE_KIND:
            counts["evidence_dropped"] += 1
            continue
        if not evidence_ok(str(m.get("evidence") or ""), haystack):
            counts["evidence_dropped"] += 1
            continue
        src = _clean_source(m.get("source"))
        if m.get("source") is not None and src is None:
            counts["source_dropped"] += 1
        m["source"] = src
        m.setdefault("verification", None)
        kept.append(m)
    plan["moves"] = kept[:5]

    recipe = plan.get("recipe")
    if kind != "recipe":
        plan["recipe"] = None
    elif not isinstance(recipe, dict) or not recipe.get("ingredients") or not recipe.get("steps"):
        # A HALF RECIPE IS THE ONE OUTPUT A PERSON CANNOT TELL FROM A WORKING ONE, so it is
        # emptied. The KIND survives: MEASURED on the corpus, most cooking Shorts publish a
        # title and no description at all ("EASY 20-minute 1-PAN Garlic Butter Pasta w Shrimp"
        # with an empty description), and calling that `unknown` threw away the one thing the
        # post did say. It is a recipe with no method yet, and the `card` move goes and gets
        # one (drops/recipe.py).
        plan["recipe"] = None

    # A kind with no moves and no refusal is a card that says something is here and offers
    # nothing to do about it. It is `unknown` with a reason instead. A recipe that came back
    # with its method intact is the one kind that is complete with no move on it: the card IS
    # the thing you wanted.
    complete_recipe = plan["kind"] == "recipe" and plan.get("recipe")
    if not plan["moves"] and not plan.get("refusal") and not complete_recipe:
        plan["kind"] = "unknown"
        plan["refusal"] = "not_about_building"

    evidence = {id(m): m.get("evidence") for m in plan["moves"]}
    plan, n = dedash(plan)
    for m in plan["moves"]:
        m["evidence"] = evidence[id(m)]
    counts["dashes"] = n
    return plan, counts


def plan_for(r: Resolved, *, model: str = DEFAULT_MODEL) -> tuple[dict, dict]:
    """(plan, counts) for a resolved drop. Raises PlanError; the caller turns it into a code."""
    text = r.text
    if not text.strip():
        raise PlanError("no_text")
    schema = load_schema()
    user = pr.user_message(
        text, platform=r.platform, author=r.author, chars=len(text)
    )
    try:
        raw, envelope = call_claude(pr.SYSTEM, user, schema, model, timeout_s=TIMEOUT_S)
    except AnalysisError as e:
        # The one distinction the card draws: the CLI is not here at all, versus it answered
        # with something this gate refused.
        code = "planner_unavailable" if "not found on PATH" in str(e) else "planner_refused"
        raise PlanError(code) from e
    plan, counts = gate(raw, text)
    usage = envelope.get("modelUsage") or {}
    counts["model"] = (
        max(usage, key=lambda k: usage[k].get("outputTokens", 0)) if usage else model
    )
    return plan, counts


def resolution(r: Resolved, plan: dict | None, *, refusal: str | None, model: str | None) -> dict:
    """The `DropResolution` the Mac uploads. One of plan or refusal, never both."""
    return {
        "drops_version": DROPS_VERSION,
        "source": r.source_block(),
        "plan": plan,
        "refusal": refusal,
        "planner_model": model if plan is not None else None,
        "planned_at": dt.datetime.now(dt.UTC).isoformat() if plan is not None else None,
    }
