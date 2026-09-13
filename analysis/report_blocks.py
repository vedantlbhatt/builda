"""The report's version 2 blocks, mapped from what the engine already computed.

docs/overnight-integration.md 1.3. Five functions, one per block of `spec/report.v1.json`:
`wrapped_block`, `money_block`, `burn_block`, `vocab_block`, `stack_block`. None of them
measures anything. Each takes a module's own output (`wrapped.wire`, the profile,
`vocab.wire`) and renames, drops and reorders until it is the spec's shape, and nothing
else: a number computed here would be a second definition of it, and the first thing that
drifts (CLAUDE.md, "A rule copied into a second module").

THREE RULES, the same ones the spec's own tests hold:

  * NO STRING THAT IS NOT AN ENUM OR A CLOCK. Every rendered string the engine keeps (a
    card's question, display, sentence and reason words, a term's word and definition, a
    stack item's name) is dropped here, and every refusal travels as its code. The phone
    writes the words from `mobile/src/generated/copy.ts`, generated from the same tables.
  * ABSENT IS NULL. A refused block keeps its shape with its numbers null and its `reason`
    code set; a block whose input this machine never had is null as a whole (`report.build`).
  * THE MACHINE SENDS ONLY THE EXTRAS A CARD SETS (`WRAPPED_EXTRAS`), so a key the server
    stores as null means "not this card's", never "measured as nothing".
"""

from __future__ import annotations

import copy
from collections.abc import Mapping, Sequence

from . import plain
from . import pricing
from . import profile as pf
from . import wrapped as wr

# ---------------------------------------------------------------------------- wrapped
#: The extras each card sets on the wire, by the spec's names (`ReportWrappedExtras`).
#: Crash out and cryptic prompt set none: every number on them is a reading of what
#: somebody typed (`wrapped.LOCAL_CARDS`).
WRAPPED_EXTRAS: dict[str, tuple[str, ...]] = {
    "builder_type": (
        "confidence",
        "metric",
        "metric_value",
        "metric_lower_bound",
        "closest",
        "runners_up",
    ),
    "shipped": ("commits", "assisted", "alone", "commits_basis"),
    "work_style": ("autonomy", "median_prompts", "steer_rate"),
    "longest_session": ("active_seconds", "started_at"),
    "agents_at_once": ("subagents_peak", "subagents"),
    "go_to_prompt": ("sessions", "words"),
    "streak": ("commit_days", "attended_days", "both_days"),
    "change_course": ("interrupts", "corrective_prompts"),
    "crash_out": (),
    "prompt_length": ("median",),
    "deep_sessions": ("avg_minutes", "longest_minutes"),
    "time_put_in": ("attended_hours", "attended_overlap_hours"),
    "cryptic_prompt": (),
    "prompts_per_session": ("median", "tool_calls_per_prompt"),
    "kind_of_work": (
        "kinds",
        "classified",
        "commits",
        "coverage",
        "role_lines",
        "commit_refusal",
        "lines",
        "lines_needed",
    ),
}

#: Cards whose answer is an id rather than a number: it travels as `value_id`, `value`
#: null (the spec's `wrapped_value`).
ID_UNITS = frozenset({"archetype", "style", "kind"})

_SCORE_KEYS = ("name", "metric", "value", "threshold", "score")


def _score(s: Mapping | None) -> dict | None:
    return None if s is None else {k: s.get(k) for k in _SCORE_KEYS}


def _card_extras(card: Mapping, commits_basis: str | None) -> dict:
    """The spec's extras for one card, from `wrapped`'s own, renamed where the spec needs
    an id or a list: `metric_basis` becomes whether the metric is a floor, `counts` the
    kinds in `KINDS` order, `role_lines` a list in `plain.ROLES` order, and `commit_code`
    the commit labels' refusal."""
    ex = card["extras"]
    out: dict = {}
    for key in WRAPPED_EXTRAS[card["id"]]:
        if key == "metric_lower_bound":
            basis = ex.get("metric_basis")
            out[key] = None if basis is None else wr._is_lower_bound(basis)
        elif key == "closest":
            out[key] = _score(ex.get("closest"))
        elif key == "runners_up":
            out[key] = [_score(r) for r in ex.get("runners_up") or []]
        elif key == "commits_basis":
            out[key] = commits_basis
        elif key == "kinds":
            counts = ex.get("counts") or {}
            out[key] = [{"kind": k, "commits": counts[k]} for k in wr.KINDS if counts.get(k)]
        elif key == "role_lines":
            lines = ex.get("role_lines") or {}
            out[key] = [{"role": r, "lines": lines[r]} for r in plain.ROLES if lines.get(r)]
        elif key == "commit_refusal":
            out[key] = ex.get("commit_code")
        else:
            out[key] = copy.deepcopy(ex.get(key))
    return out


def wrapped_card(card: Mapping) -> dict:
    """One card of `wrapped.wire` as the spec's `ReportWrappedCard`. The shipped card's
    basis names its lines and its commits in one string (`lines+git_log_distinct_commits`);
    the spec splits them, so the commits half travels as `extras.commits_basis`."""
    basis, _, commits_basis = card["basis"].partition("+")
    unit = card["unit"]
    value = card.get("value")
    local = card["id"] in wr.LOCAL_CARDS
    return {
        "id": card["id"],
        "value": None if local or unit in ID_UNITS else value,
        "value_id": None if local or unit not in ID_UNITS else value,
        "unit": unit,
        "basis": basis,
        "n": card["n"],
        "needed": card.get("needed"),
        # The code, never the words: the phone writes the refusal from it, `n` and `needed`.
        "reason": card.get("code"),
        "extras": {} if local else _card_extras(card, commits_basis or None),
    }


def wrapped_block(w: Mapping) -> dict:
    """`wrapped.wire(result)` as the spec's `ReportWrapped`: all fifteen cards, in
    `CARD_IDS` order, and the two counts the cards rest on."""
    cards = [wrapped_card(c) for c in w["cards"]]
    if [c["id"] for c in cards] != list(wr.CARD_IDS):
        raise ValueError("wrapped_block: the cards are not wrapped.CARD_IDS in order")
    return {
        "cards": cards,
        "prompts_with_text": int(w["sample"]["prompts_with_text"]),
        "attended_sessions": int(w["sample"]["attended_sessions"]),
    }


# ------------------------------------------------------------------------------ money
def _day_iso(day) -> str:
    """A day as the spec's datetime: midnight UTC, the day the prices were read."""
    return f"{day.isoformat()}T00:00:00Z"


def money_block(profile: Mapping, facts: Sequence[pf.SessionFact]) -> dict:
    """Dollars at list prices beside tokens beside lines (`ReportMoney`).

    NO PRICE IS COMPUTED HERE. `profile.corpus_profile` is the one place a session is
    priced (`pricing.session_cost`) and the server runs the same function over its own
    rows, so with the report null the phone still has `corpus.metrics.spend_usd`. When the
    spend is refused, its basis IS the refusal code (`tokens_not_reported`,
    `model_not_in_price_table`), and the dollar fields are null beside it. The tokens are
    the five buckets summed over the sessions that reported any, and `token_sessions` says
    how many that is; the lines are the profile's totals, null when no session carried a
    line basis at all.
    """
    m = profile["metrics"]
    spend = m["spend_usd"]
    answered = spend["value"] is not None
    quiet = m["spend_without_a_commit_usd"]
    with_tokens = [f for f in facts if f.tokens is not None and f.tokens.any]
    tokens = (
        {
            "input": sum(f.tokens.input for f in with_tokens),
            "output": sum(f.tokens.output for f in with_tokens),
            "cache_read": sum(f.tokens.cache_read for f in with_tokens),
            "cache_w5m": sum(f.tokens.cache_w5m for f in with_tokens),
            "cache_w1h": sum(f.tokens.cache_w1h for f in with_tokens),
        }
        if with_tokens
        else None
    )
    known = [f for f in facts if f.lines_basis != pf.LINES_ABSENT]
    totals = profile["totals"]
    return {
        "usd": spend["value"],
        "basis": spend["basis"] if answered else None,
        "reason": None if answered else spend["basis"],
        "prices_read_on": _day_iso(pricing.PRICES_READ_ON),
        "priced_sessions": int(spend["n"]),
        "unpriced_sessions": int(spend.get("unpriced_sessions") or 0),
        "usd_per_active_hour": m["spend_per_hour_usd"]["value"] if answered else None,
        "usd_without_a_commit": quiet["value"],
        "share_without_a_commit": quiet.get("share_of_spend") if quiet["value"] is not None else None,
        "tokens": tokens,
        "token_sessions": len(with_tokens),
        "lines_added": int(totals["total_lines_added"]) if known else None,
        "lines_removed": int(totals["total_lines_removed"]) if known else None,
        "lines_basis": known[0].lines_basis if known else pf.LINES_ABSENT,
        "by_model": [
            {
                "model": row["model_id"],
                "usd": row["usd"],
                "output_tokens": row["output_tokens"],
                "sessions": row["sessions"],
                "sessions_dominated": row["sessions_dominated"],
                "commits": row["commits"],
                "usd_per_commit": row["usd_per_commit"],
            }
            for row in (profile.get("model_costs") or [])[: len(pricing.PRICES)]
        ],
    }


# ------------------------------------------------------------------------------- burn
def burn_block(profile: Mapping) -> dict:
    """The tokens spent in stretches that changed nothing, across the corpus (`ReportBurn`),
    from `profile.metrics.barren_token_share` and nothing else. A refusal keeps its code
    (`profile.BARREN_CODES`) and, for the session floor, the floor it names; `causes` is
    null exactly when the share is. The cause shares OVERLAP (one turn can be claimed by
    two causes), so the phone never sums them."""
    b = profile["metrics"]["barren_token_share"]
    answered = b["value"] is not None
    code = b.get("code")
    if answered == (code is not None):
        raise ValueError("burn_block: a share needs no code and a refusal needs one")
    return {
        "share": b["value"],
        "barren_tokens": b.get("barren_tokens"),
        "tokens": b.get("tokens"),
        "unreadable_tokens": b.get("unreadable_tokens"),
        "sessions": int(b["n"]),
        "needed": b.get("needed"),
        "reason": code,
        "causes": copy.deepcopy(b.get("by_cause")) if answered else None,
    }


# ------------------------------------------------------------------------ vocab, stack
#: `vocab`'s refusals are words (vocab.py is not this package's to change), so the code for
#: each is read off its exact words. A refusal this table does not know raises: a new one
#: is a new enum value in `spec/report.v1.json`, never a silent null. Pinned to what
#: `vocab.glossary([])` and `vocab.stack([])` actually say by the report block tests.
VOCAB_REFUSALS: dict[str, str] = {"no session had any events to read": "no_events"}
STACK_REFUSALS: dict[str, str] = {
    "no session events and no manifest names to read": "no_evidence",
}


def vocab_block(w: Mapping) -> dict:
    """`vocab.wire(glossary)` as `ReportVocab`: each term's id, counts and the first time
    you met it; `word` and `basis` dropped (the phone has the words), `first_seen_ts` an ISO
    clock, `locked_count` renamed `locked`, `n` renamed `sessions`."""
    return {
        "terms": [
            {
                "id": t["id"],
                "count": int(t["count"]),
                "sessions": int(t["sessions"]),
                "first_seen": pf._iso(t["first_seen_ts"]),
            }
            for t in w["terms"]
        ],
        "locked": w["locked_count"],
        "catalog_size": int(w["catalog_size"]),
        "sessions": int(w["n"]),
        "shell_calls": int(w["shell_calls"]),
        "shell_calls_cut": int(w["shell_calls_cut"]),
        "reason": VOCAB_REFUSALS[w["reason"]] if w["reason"] else None,
    }


def stack_block(w: Mapping) -> dict:
    """`vocab.wire(stack)` as `ReportStack`: catalog ids, categories and evidence; `name`
    and `language_reason` dropped, `manifest_names` (a count, never a name) renamed
    `manifests`, `first_seen_ts` an ISO clock or null for an item only a manifest names."""
    return {
        "items": [
            {
                "id": i["id"],
                "category": i["category"],
                "evidence": i["evidence"],
                "sessions": int(i["sessions"]),
                "first_seen": pf._iso(i["first_seen_ts"]) if i["first_seen_ts"] is not None else None,
            }
            for i in w["items"]
        ],
        "sessions": int(w["n"]),
        "manifests": int(w["manifest_names"]),
        "shell_calls": int(w["shell_calls"]),
        "shell_calls_cut": int(w["shell_calls_cut"]),
        "reason": STACK_REFUSALS[w["reason"]] if w["reason"] else None,
    }


__all__ = [
    "ID_UNITS",
    "STACK_REFUSALS",
    "VOCAB_REFUSALS",
    "WRAPPED_EXTRAS",
    "burn_block",
    "money_block",
    "stack_block",
    "vocab_block",
    "wrapped_block",
    "wrapped_card",
]
