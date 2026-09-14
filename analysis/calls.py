"""Tokens, call by call: what every request to the model sent and got back, in one sitting.

`burn.py` says where a sitting's tokens went stretch by stretch. This answers the question
the owner asked on 2026-09-13: "I'm confused how 99% is spent reading the cache". The model
keeps nothing between calls, so every call re-sends the whole conversation so far; the cache
serves the part it has seen before (a re-read), and only the tail is new. The conversation
only grows, so the re-read climbs call after call while what is new and what the model
writes back stay small. The phone draws it, one bar per call, and writes every word
(`mobile/src/session/callsView.ts`); the wire carries numbers and two enums
(privacy/upload-contract.json `call_tokens`, `SessionCallTokens`).

ONE READER. The calls are `burn.turns_for_window` over the sitting's files: every assistant
message once, deduplicated on its id across the files (Claude Code repeats one usage on every
content block, 1.878x if summed; a resumed transcript begins with a copy of the old one's
messages), subagent sidecars never read (their tokens are in no number here, CLAUDE.md).
`<synthetic>` placeholders are left out: an interrupt or an API error Claude Code writes
itself, not a call, and never any usage (`capture.tuning.SYNTHETIC_MODEL_SENTINEL`). So the
points sum to exactly the tokens burn counts for the same sitting.

Three rules that would each fail silently:

1. **The gap before a call is measured to the call before it IN THE SAME TRANSCRIPT**, which
   may sit in an earlier sitting, never to the call before it on the sitting's clock. A cache
   belongs to one conversation, and the sessionizer cuts a sitting at every idle gap: MEASURED
   on this machine's corpus (2026-09-13, 160 counted sittings cut as capture cuts them), NOT
   ONE sitting holds a gap of an hour between two of its own calls, so a rule that looked
   inside the window flagged nothing, anywhere. Measured to the conversation's own previous
   call, 49 of the 160 carry a call that came back to an expired cache (38 one, 9 two, 2
   three), most of them the sitting's first call, after the break that ended the sitting
   before. The owner's example is one: RideGT `0a050ea3` call 124, 68 minutes after call
   123, is the first call of the sitting that starts at 13:54, and it wrote 140,553 tokens of
   a 167,003 token context again. A sitting also pools every conversation in one directory
   back to back, and on the sitting's clock one conversation's hour away is filled by the
   other's calls (`fafec44e` call 211: 81 minutes away in its own transcript).

2. **Absent is not zero.** A harness that writes no token counts (Cursor), or one burn does
   not read yet, is `no_token_counts` with every number null, never a chart of zeros. A
   price the table does not have is `price_reason`, never $0.

3. **One price table.** Every dollar is `analysis.pricing.cost_usd` over one call's own
   buckets, on that call's own model, the five minute and the one hour write each at its own
   rate: API LIST PRICES, never "you spent" (most people are on a subscription).
"""

from __future__ import annotations

import bisect
import math
import pathlib
from typing import Callable, Iterable, Mapping, Sequence

from . import burn, pricing

#: A sitting with more calls than this is drawn in points of consecutive calls, summed.
#: MEASURED on this machine's corpus (2026-09-13, 160 counted sittings): calls per sitting
#: p50 41, p90 162, max 383, and 9 of the 160 have more than 240, so 151 draw one bar per
#: call. 240 bars across the session page's chart (402 points on an iPhone 16 Pro less the
#: 20 point gutters) are 1.5 points each, 4.5 device pixels at 3x: the narrowest a bar can be
#: and still keep a gap from its neighbour. Capped here, not on the phone, so the upload is
#: bounded too: at most 240 points of five integers.
MAX_POINTS = 240

#: Below this many calls there is no chart, and the refusal says so (`too_few_calls`).
#: JUDGEMENT CALL, on this measurement (the same 160 sittings): 12 have fewer than 5 calls,
#: and in every one of the five 3 call sittings the re-read is 66% of the tokens, one call
#: writing the conversation into the cache and two re-reading it. Three bars draw that
#: arithmetic, not a session. Over the first 1, 2, 3, 4 and 5 calls of the sittings with 20
#: or more, the re-read's tenth percentile is 0%, 49%, 65%, 73% and 77%: the first calls are
#: about the first write, and from the fifth the shape the chart exists to show has begun.
MIN_CALLS = 5

#: A call whose cache write is more than this share of everything it sent wrote the
#: conversation into the cache again rather than adding to it. MEASURED (2026-09-13, 127
#: root transcripts, 17,629 calls): after a gap longer than the cache lifetime, 147 of 155
#: calls wrote more than half of what they sent. Of the 8 that did not, 5 came back 61 to 75
#: minutes after and re-read all but a few hundred tokens (the cache outlived its hour), and
#: 3 wrote 38% to 49%: short conversations whose shared prefix (the system prompt and the
#: tools, kept warm by other sessions) is half of what they send. Those three are drawn and
#: not annotated, which is the safe way to be wrong.
REWRITE_MIN_SHARE = 0.5

#: The cache lifetime of a call's writes, by the TTL its usage names. MEASURED on this
#: machine (2026-09-13, every call with a cache write in 127 root transcripts): 17,575 of
#: 17,575 wrote with `cache_creation.ephemeral_1h_input_tokens` and none with
#: `ephemeral_5m_input_tokens`, 107,406,331 tokens at one hour and 0 at five minutes, so
#: Claude Code writes with the one hour TTL. A sitting that wrote only at five minutes (or an
#: older writer with no breakdown, which `token_ledger` stores as five minute writes) is held
#: to five minutes. A call is flagged only after a gap longer than this.
ONE_HOUR_SEC = 3600
FIVE_MINUTES_SEC = 300

#: How many flagged calls travel, the ones that wrote the most. MEASURED: 3 at most in any of
#: the 160 sittings (above), so 12 is four times the most seen; `rewrite_calls` counts all of
#: them whatever the list keeps.
MAX_REWRITES = 12

#: Why a sitting has no chart (`call_tokens_refusal` in the contract).
REFUSE_NO_COUNTS = "no_token_counts"
REFUSE_TOO_FEW = "too_few_calls"
REFUSALS: tuple[str, ...] = (REFUSE_NO_COUNTS, REFUSE_TOO_FEW)

#: Why the dollars are null (`call_price_refusal`): pricing's own code, one list of codes.
PRICE_UNKNOWN_MODEL = pricing.BASIS_UNKNOWN_MODEL
PRICE_REFUSALS: tuple[str, ...] = (PRICE_UNKNOWN_MODEL,)


def _synthetic() -> str:
    from capture.tuning import SYNTHETIC_MODEL_SENTINEL

    return SYNTHETIC_MODEL_SENTINEL


def calls_of(turns: Iterable[burn.Turn]) -> list[burn.Turn]:
    """The API calls among `turns`, in time order: every turn but a `<synthetic>` one."""
    fake = _synthetic()
    return sorted((t for t in turns if t.model != fake), key=lambda t: t.ts)


def previous_calls(
    paths: Iterable[pathlib.Path | str],
    turns: Sequence[burn.Turn],
    *,
    loader: Callable[[pathlib.Path], Sequence[burn.Turn]] = burn.load_turns,
) -> dict[str, float | None]:
    """For each of `turns`, when the call before it IN ITS OWN TRANSCRIPT was made, or None
    when it is the first call that transcript holds (rule 1 in the module docstring).

    A message belongs to the first of `paths` that carries it, the order
    `burn.turns_for_window` keeps it by, and that file's calls are read whole, from before the
    sitting too. Pass the same `loader` the window was read with and nothing is parsed twice.
    """
    home: dict[str, list[float]] = {}
    for p in dict.fromkeys(pathlib.Path(x) for x in paths):
        file_calls = calls_of(loader(p))
        times = [t.ts for t in file_calls]
        for t in file_calls:
            home.setdefault(t.msg_id, times)
    out: dict[str, float | None] = {}
    for t in turns:
        times = home.get(t.msg_id)
        k = bisect.bisect_left(times, t.ts) if times else 0
        out[t.msg_id] = times[k - 1] if times and k > 0 else None
    return out


def cache_lifetime(calls: Sequence[burn.Turn]) -> int | None:
    """The lifetime this sitting's cache writes were made with: an hour when any call wrote
    with the one hour TTL, five minutes when it wrote only without it, None when nothing was
    written to a cache at all (Codex and Gemini write no cache split), and then no call can be
    a rewrite."""
    if any(t.cache_create_1h > 0 for t in calls):
        return ONE_HOUR_SEC
    if any(t.cache_create > 0 for t in calls):
        return FIVE_MINUTES_SEC
    return None


def is_rewrite(t: burn.Turn, away: float | None, lifetime: int | None) -> bool:
    """A call that came back after its conversation's cache expired and wrote most of what it
    sent into the cache again (`REWRITE_MIN_SHARE`)."""
    if away is None or lifetime is None or away <= lifetime:
        return False
    sent = t.input_tokens + t.cache_create + t.cache_read
    return sent > 0 and t.cache_create > REWRITE_MIN_SHARE * sent


def _points(calls: Sequence[burn.Turn], started_at: float, per: int) -> list[dict]:
    out = []
    for i in range(0, len(calls), per):
        group = calls[i : i + per]
        out.append(
            {
                "at": max(0, round(group[0].ts - started_at)),
                "cache_read": sum(t.cache_read for t in group),
                "cache_write": sum(t.cache_create for t in group),
                "input": sum(t.input_tokens for t in group),
                "output": sum(t.output_tokens for t in group),
            }
        )
    return out


def _price(calls: Sequence[burn.Turn]) -> dict[str, float] | None:
    """List price dollars of the four buckets, each call priced on its own model by
    `pricing.cost_usd` (the one place a price lives), or None when a call that carries
    tokens names a model the table does not know: the rest would be a real number missing an
    unknown amount, which reads as complete and is not (`pricing.session_cost`'s rule).

    Per call rather than the stored buckets split by output share (`pricing.split_by_model`,
    which the report's money block uses and labels an estimate), because here each call's
    model is known. MEASURED on this machine (2026-09-13, 148 priced sittings): 142 of the
    144 with one model agree with the split to the cent (the other two hold a turn at the
    window's edge that the stored buckets do not); the 4 with two models do not, by 5% to 25%
    (`83f5c590`: $41.63 priced call by call, $33.33 by output share, because Fable made 2.9% of
    the output and its calls re-read the cache at twice Opus's price)."""
    usd = {"cache_read": 0.0, "cache_write": 0.0, "input": 0.0, "output": 0.0}
    for t in calls:
        if not t.total:
            continue
        w1h = min(t.cache_create_1h, t.cache_create)
        parts = {
            "cache_read": pricing.Tokens(cache_read=t.cache_read),
            "cache_write": pricing.Tokens(cache_w5m=t.cache_create - w1h, cache_w1h=w1h),
            "input": pricing.Tokens(input=t.input_tokens),
            "output": pricing.Tokens(output=t.output_tokens),
        }
        for key, tokens in parts.items():
            one = pricing.cost_usd(tokens, t.model or "")
            if one is None:
                return None
            usd[key] += one
    return usd


def _refused(reason: str, calls: int | None) -> dict:
    return {
        "reason": reason,
        "calls": calls,
        "calls_needed": MIN_CALLS,
        "per_point": None,
        "points": None,
        "lifetime_seconds": None,
        "rewrites": None,
        "rewrite_calls": None,
        "usd_cache_read": None,
        "usd_cache_write": None,
        "usd_input": None,
        "usd_output": None,
        "price_reason": None,
    }


def wire(
    turns: Sequence[burn.Turn],
    *,
    started_at: float,
    previous: Mapping[str, float | None] | None = None,
    recorded: bool = False,
) -> dict:
    """The sitting's `call_tokens` block (`SessionCallTokens`): every key present, absent as
    null, never a zero standing in for a number nobody measured.

    `turns` is the sitting's window (`burn.turns_for_window`), `started_at` its first record,
    `previous` what `previous_calls` says about them (None when the caller has no files, and
    then no call is flagged: a missing annotation, never a wrong one).

    `recorded` says the sitting's FILES record token counts, whatever this window holds. A window
    with no counted call in files that record them made no call at all: `too_few_calls` with 0,
    never "this transcript does not record token counts", which is a claim about the file and
    false. FOUND IN REVIEW (2026-09-13): `91d520d9` holds four `<synthetic>` records and nothing
    else in its window, while its files hold 2,343 counted calls.
    """
    calls = calls_of(turns)
    if not burn.records_usage(calls):
        if recorded:
            return _refused(REFUSE_TOO_FEW, 0)
        return _refused(REFUSE_NO_COUNTS, None)
    if len(calls) < MIN_CALLS:
        return _refused(REFUSE_TOO_FEW, len(calls))

    per = max(1, math.ceil(len(calls) / MAX_POINTS))
    lifetime = cache_lifetime(calls)
    found: list[dict] = []
    for n, t in enumerate(calls, 1):
        before = (previous or {}).get(t.msg_id)
        away = None if before is None else t.ts - before
        if is_rewrite(t, away, lifetime):
            found.append({"call": n, "away_seconds": round(away), "written": t.cache_create})
    kept = sorted(found, key=lambda r: (-r["written"], r["call"]))[:MAX_REWRITES]
    usd = _price(calls)
    return {
        "reason": None,
        "calls": len(calls),
        "calls_needed": MIN_CALLS,
        "per_point": per,
        "points": _points(calls, started_at, per),
        "lifetime_seconds": lifetime,
        "rewrites": sorted(kept, key=lambda r: r["call"]),
        "rewrite_calls": len(found),
        "usd_cache_read": usd["cache_read"] if usd else None,
        "usd_cache_write": usd["cache_write"] if usd else None,
        "usd_input": usd["input"] if usd else None,
        "usd_output": usd["output"] if usd else None,
        "price_reason": None if usd else PRICE_UNKNOWN_MODEL,
    }


def session_calls(
    paths: Iterable[pathlib.Path | str],
    start: float,
    end: float,
    *,
    loader: Callable[[pathlib.Path], Sequence[burn.Turn]] = burn.load_turns,
) -> dict:
    """`wire` over one sitting's files: its window (`burn.turns_for_window`, the rule burn
    counts by) and each call's previous call in its own transcript. `loader` is the memoised
    `burn.load_turns` a caller building many payloads passes, so a file is parsed once."""
    paths = list(dict.fromkeys(pathlib.Path(x) for x in paths))
    turns = burn.turns_for_window(paths, start, end, loader=loader)
    recorded = burn.files_record_usage(paths, loader=loader)
    return wire(
        turns,
        started_at=start,
        previous=previous_calls(paths, turns, loader=loader),
        recorded=recorded,
    )
