"""Wrapped: fifteen questions about how you build, each one answered or refused.

The Paxel cards (brief.md, table C) are a year in review: a question, a big answer, one
sentence under it. Every one of them is easy to fill with a plausible wrong number, and
this module exists to fill them with measured ones or with nothing. The design is
`docs/overnight-engine.md` section 2, and the rules it holds are CLAUDE.md's:

  * A CARD IS ALWAYS THE SAME SHAPE. Ten keys, `id, question, value, unit, display,
    sentence, basis, n, reason, extras`, on an answer and on a refusal alike, with
    `extras` always an object. A refused card has `value`, `display` and `sentence` None
    and a `reason` that says why in words a person can act on. Absent is None, never 0:
    a zero is printed only where it was measured ("No streak yet" is a measurement).
  * EVERY ANSWERED SENTENCE HAS A DIGIT IN IT. That is what keeps them facts rather than
    horoscopes, so the cards use digits and never spelled out numbers.
  * NO DASHES in any string this module writes (docs/analysis.md). The one exemption is
    the same one `prompt_excerpt` has: a quote is the person's own words, verbatim, and
    rewriting it would put words in their mouth.
  * ATTENDED TIME DECIDES RECORDS (CLAUDE.md). An unattended run can never hold the
    longest session, extend a streak, count as a deep session or a conversation.
  * PROMPT TEXT NEVER REACHES `display` OR `sentence`. The three prompt cards that quote
    somebody (go-to prompt, crash out, cryptic prompt) pick only prompts that are safe to
    show (`_private`: no secret, home path, credentials, pasted error or somebody else's
    words; never distress) and put the quote in `quotes`, which is
    `{}` unless the caller asks for it, and `wire()` drops it along with every rendered
    string. Two of those cards are LOCAL whole: every number on them is a function of which
    words were typed, so only `{id, n, reason}` survive `wire()`.

Nothing here reads a file, runs git or opens a sidecar. The corpus, its profile, the
commit history and the subagent fan out arrive precomputed from `analysis/__main__.py`,
which is the one place the corpus is cut.

WHAT WAS MEASURED, 2026-09-13, on `~/.builder-overnight/corpus` (57 root transcripts, 153
counted sessions): builder type Quality guardian at 0.79 with Velocity machine at 0.785
beside it; 64,652 agent lines; work style `steering` (autonomy 0.12, median 4 prompts,
steer 0.433); longest attended session 3h 06m of 131; 3 sessions at once; streak 11 days
where the old streak rule said 21; 43% steer rate; mean prompt 30.3 words, median 16;
84.6 hours over 153 sessions, 74.4 attended; 7.1 prompts a session. The commit subject
labels refuse on it (21 of 232 and 4 of 15 subjects are labelled), so the kind of work
comes from the file role fallback: source 65.3%, tests 18.0%.

RE-MEASURED after the adversarial review, 2026-09-13, the same corpus at 158 counted
sessions, with project lines only (`patterns.project_write`) and each event once
(`patterns.distinct_events`): 50,177 agent lines where the old rule said 64,747 (13,663 were
Claude Code's own files, 907 a resumed transcript's copies); the kind of work fallback
source 69.5%, tests 22.1%, docs 4.9%; 927 prompts where the copies made 932; builder type
still Quality guardian, now at least 4.9 test runs an hour (414 visible test runs where 398
were: masking before the cut leaves more of each command readable); 11.3 tool calls a
prompt over the attended sessions the card counts (the profile's 12.0 counts unattended
runs too); 74.5 attended hours, up to 1.2 of them in sittings that overlapped.

GROUND TRUTH, 2026-09-13, the same corpus now 156 counted sessions, recomputed by hand from
the raw JSONL and `git log` without this code: commits 247 (232 RideGT and 15 builder on
the checked out branch), streak 11 over 20 days with both (24 commit days, 25 attended),
151 interrupts and 253 corrections, the go to prompt `<100 words` in 4 sessions, the crash
out 7.49 minutes into its sitting, 3 sessions at once and 9 of 39 helpers at once all
agree. Two cards were wrong and are fixed here: the cryptic prompt was an account
identifier the person had pasted (`_carries_identifier`), and the test rate was a floor
printed as the rate (`_archetype_sentence`).
"""

from __future__ import annotations

import collections
import copy
import dataclasses
import itertools
import re
import string
from collections.abc import Mapping, Sequence

from . import agents as ag
from . import contributions as co
from . import feedback as fb
from . import languages as lang
from . import patterns as pat
from . import plain
from . import profile as pf

# --------------------------------------------------------------------------- the cards
#: The fifteen cards, in the order brief.md's table lists them. The order is the contract:
#: the phone lays them out in it and the tests pin it.
CARD_IDS: tuple[str, ...] = (
    "builder_type",
    "shipped",
    "work_style",
    "longest_session",
    "agents_at_once",
    "go_to_prompt",
    "streak",
    "change_course",
    "crash_out",
    "prompt_length",
    "deep_sessions",
    "time_put_in",
    "cryptic_prompt",
    "prompts_per_session",
    "kind_of_work",
)

#: The questions, word for word from brief.md (Paxel's own copy, minus its dashes). A
#: hyphen inside a word is not a dash (`plain.DASH`), so Paxel's "go-to" keeps its own
#: (FOUND IN REVIEW: "What's your go to prompt?" read as a misprint).
QUESTIONS: dict[str, str] = {
    "builder_type": "Which kind of builder are you?",
    "shipped": "How much did you ship?",
    "work_style": "How do you work with your agent?",
    "longest_session": "Your longest single session?",
    "agents_at_once": "How many agents do you run?",
    "go_to_prompt": "What's your go-to prompt?",
    "streak": "What's your longest streak?",
    "change_course": "How often do you change course?",
    "crash_out": "Your biggest crash out?",
    "prompt_length": "How long are your prompts?",
    "deep_sessions": "How do you work?",
    "time_put_in": "How much time did you put in?",
    "cryptic_prompt": "Your most cryptic prompt?",
    "prompts_per_session": "How much do you talk to your agent?",
    "kind_of_work": "What kind of work is it?",
}

#: Every card carries exactly these, in this order, answered or refused. `needed` is the
#: floor a refusal names (None on an answer and on a refusal that names none) and `code`
#: the refusal as an id (`REFUSALS`), beside `reason`, the same refusal in words: the words
#: stay on this machine and the code travels, so the phone words it the same way.
CARD_KEYS: tuple[str, ...] = (
    "id",
    "question",
    "value",
    "unit",
    "display",
    "sentence",
    "basis",
    "n",
    "needed",
    "reason",
    "code",
    "extras",
)

#: What `wire()` keeps of a card. `question`, `display` and `sentence` are rendered from
#: ids and numbers, so the phone writes its own (the `feedback.wire` rule).
WIRE_KEYS: tuple[str, ...] = (
    "id",
    "value",
    "unit",
    "basis",
    "n",
    "needed",
    "reason",
    "code",
    "extras",
)

#: Cards whose every number is a function of which words were typed. Only what says WHICH
#: card and WHETHER it was answered leaves the machine: a crash out score is a reading of
#: somebody's prompt, and so is a gibberish share. The unit and basis are the card's own
#: constants, never a reading of a prompt, and the report spec requires them on every card.
LOCAL_CARDS = frozenset({"crash_out", "cryptic_prompt"})

#: The cards that can quote a prompt (`quotes`), in card order.
QUOTE_CARDS: tuple[str, ...] = ("go_to_prompt", "crash_out", "cryptic_prompt")
LOCAL_CARD_KEYS: tuple[str, ...] = ("id", "unit", "basis", "n", "needed", "reason", "code")

#: The profile sample fields a wrapped reader needs to know what the cards rest on.
SAMPLE_KEYS: tuple[str, ...] = (
    "sessions",
    "prompts_with_text",
    "active_hours",
    "days",
    "spans_days",
    "first_at",
    "last_at",
)

# ------------------------------------------------------------------------- thresholds
#: A session with at least this median of prompts is a conversation. UNMEASURED JUDGEMENT
#: CALL; MEASURED context on the corpus: median 4, mean 7.1 over 131 attended sessions.
DIALOGUE_MIN_PROMPTS = 5

#: A go to prompt is one you went back to in a different sitting. Two, from the brief
#: ("sent 5 times across sessions"); repeating yourself inside one sitting is not a habit.
GO_TO_MIN_SESSIONS = 2

#: A crash out needs two separate signals (profanity is 3, a shouted word 2, a `!?` run 2,
#: a correction marker 1). UNMEASURED JUDGEMENT CALL; MEASURED: 117 of 923 quotable
#: prompts clear it, and the maximum is 46 by construction.
CRASH_MIN_SCORE = 6

#: The median prompt at or past this is a written brief, not a conversation. UNMEASURED
#: JUDGEMENT CALL; MEASURED context: prompt word count p75 32, p90 65.
PROMPT_BRIEF_WORDS = 40

#: An hour with you present. UNMEASURED JUDGEMENT CALL; MEASURED context: attended p75
#: 44.5 minutes, p90 83; 19 of 131 attended sessions clear it, averaging 99 minutes.
DEEP_MIN_ATTENDED_SEC = 3600.0

#: Half the prompt's characters in gibberish tokens. UNMEASURED JUDGEMENT CALL; MEASURED:
#: one distinct 10 character text qualified on the corpus (sent in 2 sessions), and it was
#: an account identifier the person had pasted (`_carries_identifier`). With identifiers excluded, none of
#: the 410 candidates has a vowelless token at all, so the card refuses there, which is the
#: true answer for somebody whose short prompts are all words.
CRYPTIC_MIN = 0.5

#: Commit subjects that must carry a label before their count means anything. Below 20 one
#: commit moves a kind by five points. UNMEASURED JUDGEMENT CALL.
KIND_MIN_SUBJECTS = 20

#: The labelled subjects must be most of the work, or the count describes how somebody
#: writes commit messages (the objection `quality.py` raised). UNMEASURED JUDGEMENT CALL;
#: MEASURED with a draft of this rule: RideGT 21 of 232 classify (9.1%), builder 4 of 15.
KIND_MIN_COVERAGE = 0.6

#: A quote is cut to this. Not a new number: it is the contract's own cap on a verbatim
#: prompt excerpt, `max_lengths.excerpt` in spec/analysis.v1.json (a test holds them equal).
QUOTE_MAX = 160
ELLIPSIS = "…"

# ------------------------------------------------------------------------ the prompts
#: Lines that mean the prompt is a paste of tool output rather than somebody's words. The
#: same shapes `digest._looks_like_error` reads as a failed command, plus stack frames.
_PASTE_LINE = re.compile(
    r"(?m)^(Traceback \(most recent call last\)|\s+at \S+ \(|\s+File \".+\", line \d+|"
    r"Error:|error:|fatal:|FAILED|npm ERR!|\w+(Error|Exception): )"
)
#: Two paste markers, not one: a person's own sentence can quote one error line ("it says
#: TypeError: x is undefined"), and a traceback or a log carries several. UNMEASURED
#: JUDGEMENT CALL; MEASURED effect on the corpus (2026-09-13): with the list marker rule
#: below, the paste rule and the masks exclude 6 of 932 prompts, 5 of them pastes, a masked
#: log or a key file path, read by hand.
PASTE_MIN_MARKERS = 2
#: Or a block of code: this many lines, more than half of them code shaped. UNMEASURED
#: JUDGEMENT CALL: under eight lines a person's own numbered list or short snippet reads
#: as code as often as a paste does; the effect is the measurement above.
PASTE_MIN_LINES = 8
_CODE_CHARS = frozenset("{}();=<>")
#: A numbered or lettered list marker (`1) `, `2. `, `a) `) is how people structure prose,
#: so it is stripped before a line is searched for code characters. MEASURED by hand on
#: the corpus, 2026-09-13: of the 10 prompts the unstripped rule excluded, 5 were pastes or
#: a path and 5 were the person's own words, four of them numbered lists whose `1)` read
#: as code. Stripping the marker restores those four and lets none of the pastes through.
#: The fifth is prose wrapped with two leading spaces, the same shape as a pasted terminal
#: block, and stays excluded: a prompt wrongly left unquoted costs a quote, never a claim.
_LIST_MARKER = re.compile(r"^\s*(\d{1,2}|[a-zA-Z])[.)]\s+")

#: The digest's `mask` writes this over a secret. A prompt that carried one is never
#: quoted, even masked: the sentence around a key is usually about the key.
REDACTED = "[redacted]"

#: A token whose letters and digits interleave (`Q7ZK2M9X4P`, `f7b1eb6`, an OAuth `code=`)
#: is an IDENTIFIER: a team id, a one time code, a key, a hash. People do not type prose
#: that way; they paste values that way. The shape is the one section 2.2 first called
#: gibberish, and it is exactly the shape brief.md warned about ("the cryptic prompt filter
#: must drop IDs, OTPs and tokens"). MEASURED on the corpus, 2026-09-13: the ONLY prompt
#: that qualified as cryptic under the gibberish reading was a ten character account
#: identifier (the synthetic `Q7ZK2M9X4P` has its shape), typed twice in one conversation
#: in answer to a request for it ("I'm blocked on one value ... the
#: 10-character code", and the card printed it as "Your most cryptic prompt". It also
#: formed a go to prompt group (2 sessions, 2 sends). The rule excludes 15 of 926 quotable
#: prompts there, read by hand: both identifier replies, two OAuth callback URLs carrying
#: `code=` and `state=`, an Apple key file path, four terminal or error page pastes the
#: paste rule missed, four prompts around a URL or an image path (one of them a Grafana
#: link beside its login), and two of the person's own lines around an odd token or a
#: pasted block. None of the 15 was the crash out or the go to prompt. Words that mix a
#: letter and a digit ONCE (`python3`, `gpt4o`, `1080p`, `sha256`, `5min`) are not
#: identifiers and stay quotable. The four numbers are section 2.2's own for that shape
#: (4+ characters, 2+ letters, 2+ digits, 2+ switches), reused rather than chosen again.
IDENTIFIER_MIN_CHARS = 4
IDENTIFIER_MIN_LETTERS = IDENTIFIER_MIN_DIGITS = IDENTIFIER_MIN_SWITCHES = 2
_NOT_ALNUM = re.compile(r"[^0-9A-Za-z]")


def _interleaved(core: str) -> bool:
    """Letters and digits interleaved: 2+ of each and 2+ changes between them."""
    if len(core) < IDENTIFIER_MIN_CHARS:
        return False
    letters = sum(1 for c in core if c.isalpha())
    digits = sum(1 for c in core if c.isdigit())
    switches = sum(1 for a, b in itertools.pairwise(core) if a.isalpha() != b.isalpha())
    return (
        letters >= IDENTIFIER_MIN_LETTERS
        and digits >= IDENTIFIER_MIN_DIGITS
        and switches >= IDENTIFIER_MIN_SWITCHES
    )


def _carries_identifier(text: str) -> bool:
    """Does any whitespace token, punctuation stripped, have an identifier's shape."""
    return any(_interleaved(_NOT_ALNUM.sub("", tok)) for tok in text.split())


@dataclasses.dataclass(frozen=True)
class _Prompt:
    """One human prompt with text, and where it sits."""

    session_index: int
    event_index: int
    ts: float
    text: str
    session: pat.SessionEvents


def _prompts(sessions: Sequence[pat.SessionEvents]) -> list[_Prompt]:
    return [
        _Prompt(si, ei, e.ts, e.text, s)
        for si, s in enumerate(sessions)
        for ei, e in enumerate(s.events)
        if e.kind == "prompt" and e.text
    ]


def _pasted(text: str) -> bool:
    """A traceback, a log or a block of code, pasted in rather than written."""
    if sum(1 for _ in _PASTE_LINE.finditer(text)) >= PASTE_MIN_MARKERS:
        return True
    lines = text.splitlines()
    if len(lines) < PASTE_MIN_LINES:
        return False
    codey = sum(
        1
        for ln in lines
        if ln.startswith("  ") or any(c in _CODE_CHARS for c in _LIST_MARKER.sub("", ln, count=1))
    )
    return codey > len(lines) / 2


def quotable(text: str | None) -> bool:
    """Is this the person's own words, fit to quote and to measure as a prompt.

    False for an empty text, a slash command, a prompt the digest had to mask a secret in,
    a prompt carrying an identifier (`_carries_identifier`), and a paste. MEASURED on the
    corpus, 2026-09-13: the first three and the paste rule exclude 6 of 932 prompts (5 of
    them pastes, a masked log or a key file path, read by hand; see `_LIST_MARKER` for the
    sixth); the identifier rule 15 more of the remaining 926. The mean prompt moves from
    29.9 to 29.8 words, the median stays 16. All four prompt cards read this one rule, so
    "a prompt" means the same thing on every one; the three that QUOTE one also pass over
    what is not safe to show (`_private`), which is still counted here.
    """
    if not text or not text.strip():
        return False
    if text.lstrip().startswith("/"):
        return False
    if REDACTED in text:
        return False
    if _carries_identifier(text):
        return False
    return not _pasted(text)


#: What a quote card must never print, whatever the person typed around it. A quote is
#: the one place prompt text is shown (LOCAL, `--quotes`), and it is the card people
#: screenshot. FOUND IN REVIEW (2026-09-13), each shape a crowned quote in a synthetic run:
#: a password the mask missed ("the prod db password is hunterpass"), a pasted one line
#: error carrying a home directory path, a letters only password as the most cryptic
#: prompt, a pasted customer complaint with a name and a street address, and distress
#: ("I HATE MYSELF") as "Your angriest prompt. We have all been there."
_SECRET_WORDS = re.compile(
    r"\b(pass(word|wd|code|phrase)|secret|token|bearer|api[\s_-]?key|private key|"
    r"credentials?|otp|2fa|ssn)\b",
    re.I,
)
_HOME_PATH = re.compile(r"(?:^|[\s'\"(=:])(?:/Users/|/home/|/root/|~/|[A-Za-z]:\\)")
_URL_USERINFO = re.compile(r"://[^/\s@]+@")
_ERROR_ANYWHERE = re.compile(r"\b\w+(Error|Exception):|\b(error|fatal):|Traceback \(", re.I)
#: Somebody else's words: a quoted message, an email header, an address the digest masked
#: (`[email]`), a street address, or a prompt that says it is a paste or a forward.
_THIRD_PARTY = re.compile(
    r"\bwrote:|^\s*(From|To|Cc|Subject):|\[email\]|\b(pasted|forwarded|forwarding)\b|"
    r"\b\d{1,5}\s+[A-Z][a-z]+\s+(St|Street|Ave|Avenue|Rd|Road|Blvd|Lane|Ln|Dr|Drive|Way|Ct|Court)\b",
    re.M,
)
#: Distress and self insult are never a crash out to crown.
_DISTRESS = re.compile(
    r"\b(kill (my ?self|me)|want(ed)? to die|wanna die|end it all|suicid\w*|self[\s-]?harm|"
    r"hurt (my ?self)|hate (my ?self|me)|i('?m| am) (so |such an? |a |an )?"
    r"(stupid|useless|worthless|idiot|failure|pathetic|dumb))\b",
    re.I,
)


def _private(text: str) -> bool:
    """Would quoting this print a secret, a path on this machine, credentials in a URL,
    an error the person pasted, or somebody else's words? Such a prompt is still the
    person's own and still MEASURED (`quotable`); it is only never quoted, so the three
    quote cards never pick it. A prompt wrongly left unquoted costs a quote, never a claim.
    """
    return bool(
        _SECRET_WORDS.search(text)
        or _HOME_PATH.search(text)
        or _URL_USERINFO.search(text)
        or _ERROR_ANYWHERE.search(text)
        or _THIRD_PARTY.search(text)
    )


def _quote(text: str) -> str:
    """Whitespace collapsed, cut at the last space inside `QUOTE_MAX`, with an ellipsis.

    The result, ellipsis included, is never longer than the contract's excerpt cap.
    """
    flat = " ".join(text.split())
    if len(flat) <= QUOTE_MAX:
        return flat
    head = flat[:QUOTE_MAX]
    cut = head.rfind(" ")
    if cut <= 0:
        cut = QUOTE_MAX - 1
    return head[:cut].rstrip() + ELLIPSIS


def _seconds_in(p: _Prompt) -> int:
    """Whole seconds from the prompt's session start to the prompt, never negative."""
    return int(max(0.0, p.ts - p.session.started_at))


def _quote_of(p: _Prompt, **extra) -> dict:
    """A quote as `quotes` holds it: the text as quoted, where it was sent, and the numbers
    the quotes document carries beside it (`quotes_upload`)."""
    return {
        "text": _quote(p.text),
        "session_id": p.session.session_id,
        "ts": p.ts,
        "seconds_in": _seconds_in(p),
        **extra,
    }


def _norm(text: str) -> str:
    """Lowercase letters and digits, one space apart. `Run the tests!` is `run the tests`."""
    return " ".join(re.sub(r"[^a-z0-9]+", " ", text.lower()).split())


# ------------------------------------------------------------------- small renderers
#: The number and its noun, agreed: `1 session`, `3 sessions`, `1,234 lines`
#: (`profile._count`, the one helper every printer uses).
_count = pf._count


def _minutes(x: float) -> str:
    return _count(x, "minute")


def _floor_mins(seconds: float) -> str:
    """A record's length, never rounded UP: whole minutes, `3h 06m` past an hour. A record
    is a claim about the longest time measured, and `feedback._mins` rounds, so 3,585 s
    read "1h 00m" on one card beside "No session past an hour yet. Your longest ran 60
    minutes." on another (FOUND IN REVIEW). Floored, both say 59."""
    m = int(max(0.0, seconds) // 60)
    if m < 1:
        return "under a minute"
    if m < 60:
        return _minutes(m)
    return f"{m // 60}h {m % 60:02d}m"


def _card(
    card_id: str,
    value,
    unit: str,
    display,
    sentence,
    basis: str,
    n: int,
    reason,
    extras,
    *,
    needed: int | None = None,
    code: str | None = None,
) -> dict:
    card = {
        "id": card_id,
        "question": QUESTIONS[card_id],
        "value": value,
        "unit": unit,
        "display": display,
        "sentence": sentence,
        "basis": basis,
        "n": int(n),
        "needed": needed,
        "reason": reason,
        "code": code,
        "extras": dict(extras),
    }
    assert tuple(card) == CARD_KEYS
    return card


def _answer(
    card_id: str, value, unit: str, display: str, sentence: str, basis: str, n: int, extras
) -> dict:
    return _card(card_id, value, unit, display, sentence, basis, n, None, extras)


def _refuse(
    card_id: str, unit: str, basis: str, n: int, code: str, extras, *, needed: int | None = None
) -> dict:
    """A refusal, worded from its code (`refusal_text`) so the words here and the words the
    phone writes from the wire are one template. An unknown code is a KeyError: a refusal
    must say why, and only a code with a template can."""
    if code not in REFUSALS:
        raise KeyError(f"{card_id}: {code!r} is not a refusal code with a template")
    reason = refusal_text(code, n=int(n), needed=needed, extras=extras)
    return _card(card_id, None, unit, None, None, basis, n, reason, extras, needed=needed, code=code)


#: The one phrase every card says attended time in. FOUND IN REVIEW: one screen said it
#: five ways ("with you there", "you were present for", "you were at", "with you at the
#: keyboard", "had a commit and you there"), and "at the keyboard" is false of a prompt
#: sent from a phone, which CLAUDE.md counts as presence.
WITH_YOU = "with you there"


# ------------------------------------------------------------------------- refusals
#: Every reason a card can be refused, as a code and the template it is worded from
#: (`profile.fill`: `{n}` and `{needed}` are the card's own; `{name:noun}` agrees the noun;
#: a mapping picks a form by `n`). ONE template per code, so a code means one fact: the
#: two prompt floors are two codes because they count two different things (every prompt
#: with text, against the prompts in your own words that `quotable` keeps). The phone
#: renders the refusal from the same table (`scripts/gen_copy.py` writes it to
#: `mobile/src/generated/copy.ts`), and `spec/report.v1.json` `wrapped_refusal` is these
#: keys, pinned both ways by `analysis/tests/test_report_blocks.py`.
REFUSALS: dict[str, str | dict[str, str]] = {
    "no_sessions": "no sessions",
    # The archetype's own refusal (`profile.archetype`), worded the same way.
    "below_session_floor": "fewer than {needed} sessions",
    "below_attended_floor": "{n:session} " + WITH_YOU + ", {needed} needed",
    # Every prompt counts here (`change_course`'s sample is the profile's whole prompt list).
    "below_prompt_floor": "{n:prompt} with text, {needed} needed",
    # Only the prompts `quotable` keeps count here (`prompt_length`).
    "below_own_words_floor": "{n:prompt} typed in your own words, {needed} needed",
    # The steer rate's own "not stored server side" is false on the machine that read
    # every prompt (FOUND IN REVIEW); this is true wherever the profile was computed.
    "no_prompt_text": "no prompt carried text or an interrupt count to read",
    "no_archetype_metric": (
        f"none of the {plain.spoken(len(pf.ARCHETYPE_RULES))} archetype metrics could be "
        "computed"
    ),
    "no_line_counts": "no session carries a line count",
    # `profile.no_lines_reason`, the one wording, shared with the velocity metric.
    "no_lines_attributed": pf.NO_LINES_TEMPLATE,
    "no_presence": "no session had you present, and an unattended run cannot hold a record",
    "no_events": "no session recorded an event",
    "no_repeated_prompt": "no prompt was sent in more than one session",
    "no_commit_history": (
        "no commit history could be read for the repositories these sessions ran in"
    ),
    "no_crash_out": "no prompt read as a crash out",
    # What was checked and the bar it failed, never "not cryptic enough".
    "no_cryptic_prompt": {
        "zero": "no short prompt of {min_tokens} or more words to read ({min_chars} to "
        "{max_chars} characters, no path, link or hash)",
        "one": "the 1 short prompt was not mostly keyboard mash (five letters in a row with "
        "no vowel)",
        "other": "none of the {n:short prompt} was mostly keyboard mash (five letters in a "
        "row with no vowel)",
    },
    # Both kinds of work refused: the commit subjects' reason (`KIND_REFUSALS`, by
    # `extras.commit_code`) and the file roles'.
    "neither_kind_basis": "{commit_refusal}; {lines:attributable line}, {lines_needed} needed",
}

#: Why the commit subject labels could not say what kind of work it was
#: (`spec/report.v1.json` `kind_refusal`, the card's `extras.commit_refusal` on the wire).
#: `{needed}` is the card's own: `KIND_MIN_SUBJECTS`, or the coverage in percent.
KIND_REFUSALS: dict[str, str] = {
    "no_subjects": "no commit subjects were read",
    "too_few_labelled": (
        "{classified} of {commits} commit subjects say what kind of change they are, "
        "{needed} needed"
    ),
    "low_label_coverage": (
        "{classified} of {commits} commit subjects say what kind of change they are, "
        "{needed}% needed"
    ),
}

def refusal_text(code: str, *, n: int, needed: int | None, extras: Mapping) -> str:
    """The words for refusal `code`, from the numbers a card carries and nothing else: `n`,
    `needed`, its numeric `extras`, and `REFUSAL_CONSTANTS`. The kind of work card's
    commit half is its own template (`KIND_REFUSALS`), filled from the same numbers."""
    values = {
        k: v
        for k, v in extras.items()
        if isinstance(v, (int, float)) and not isinstance(v, bool)
    }
    values.update(REFUSAL_CONSTANTS)
    values.update(n=n, needed=needed)
    commit_code = extras.get("commit_code")
    if commit_code:
        values["commit_refusal"] = pf.fill(KIND_REFUSALS[commit_code], **values)
    return pf.fill(REFUSALS[code], **values)


def _attended(facts: Sequence[pf.SessionFact]) -> list[pf.SessionFact]:
    return [f for f in facts if pf.is_attended(f)]


def _attended_floor(card_id: str, unit: str, basis: str, k: int, extras) -> dict:
    """The one refusal for every card that needs `MIN_SESSIONS` sessions with you there."""
    return _refuse(card_id, unit, basis, k, "below_attended_floor", extras, needed=pf.MIN_SESSIONS)


def _rule_threshold(name: str) -> float:
    """An archetype threshold read by NAME from `ARCHETYPE_RULES`, never retyped here."""
    return next(r["threshold"] for r in pf.ARCHETYPE_RULES if r["name"] == name)


def _runs_without_you(share: float) -> str:
    """The director sentence, which two cards say."""
    return f"{pf._pct(share)} of your build time runs without you."


# ------------------------------------------------------------------ 1 builder_type
ARCHETYPE_DISPLAY: dict[str, str] = {
    "architect": "Architect",
    "velocity_machine": "Velocity machine",
    "quality_guardian": "Quality guardian",
    "night_owl": "Night owl",
    "director": "Director",
    "skeptic": "Skeptic",
    "generalist": "Generalist",
}


#: Every basis `profile` stamps on a count it knows is short ends with this
#: (`profile.TEST_RUNS_LOWER_BOUND`, `profile.COMMITS_TOOL_CALLS`), so the card reads the
#: metric's own label rather than keeping a second list of which metrics undercount.
LOWER_BOUND_SUFFIX = "_lower_bound"


def _is_lower_bound(basis: str | None) -> bool:
    """Does the metric's basis say its number is a floor, not the number."""
    return bool(basis) and basis.endswith(LOWER_BOUND_SUFFIX)


def _metric_basis(P: Mapping, metric: str | None) -> str | None:
    return ((P.get("metrics") or {}).get(metric) or {}).get("basis") if metric else None


def _archetype_sentence(name: str, v: float, at_least: bool = False) -> str:
    """The winning rule's number, said as a floor when its metric is one.

    MEASURED on the corpus, 2026-09-13: `test_runs_per_hour` read 4.72, and the card said
    "4.7 test runs an hour, about one every 13 minutes". The metric's basis is
    `test_commands_in_the_digest_lower_bound`: it matches the digest's command text, cut at
    160 characters. Read in full from the raw transcripts, 829 Bash commands run a test
    against 420 whose first 160 characters show it, so the true rate is about 9.7 an hour,
    one every 6 minutes. A floor printed as the rate is a number off by half, so the
    sentence says what the basis says: "at least".
    """
    if name == "quality_guardian":
        every = round(60 / v)
        about = "at least" if at_least else "about"
        cadence = (
            "more than one a minute"
            if every < 1
            else f"{about} one a minute"
            if every == 1
            else f"{about} one every {every} minutes"
        )
        sentence = f"{pf._n(v)} test runs an hour, {cadence}."
    elif name == "architect":
        sentence = f"{pf._n(v)} prompts get a plan for every one that goes straight to work."
    elif name == "velocity_machine":
        sentence = f"{pf._n(v)} lines an hour while the agent runs."
    elif name == "night_owl":
        sentence = f"{pf._pct(v)} of your build time lands between 10pm and 4am."
    elif name == "director":
        sentence = _runs_without_you(v)
    elif name == "skeptic":
        sentence = f"{pf.in_ten(v)} in 10 prompts stop or redirect the agent."
    else:
        raise ValueError(f"no sentence for archetype {name!r}")
    # Every sentence above opens on its number, so the floor reads "At least 4.7 ...".
    return f"At least {sentence}" if at_least else sentence


#: What an archetype score carries on a card: the rule's name and metric, the metric's
#: value, the threshold it is scored against, and the score (`profile.archetype`).
SCORE_KEYS: tuple[str, ...] = ("name", "metric", "value", "threshold", "score")


def _builder_type(P: Mapping) -> dict:
    arch = P["archetype"]
    sample = P["sample"]
    n = int(sample["sessions"])
    # The runners up with their thresholds, read from the scores by name: the profile's
    # runner up rows leave the threshold out, and the phone needs it to say how close.
    by_name = {s["name"]: s for s in arch.get("scores") or []}
    extras = {
        "confidence": arch.get("confidence"),
        "closest": None,
        "runners_up": [
            {k: {**by_name.get(r["name"], {}), **r}.get(k) for k in SCORE_KEYS}
            for r in arch.get("runners_up") or []
        ],
        "metric": None,
        "metric_value": None,
        # The basis of the metric whose number the sentence says, so the phone can say
        # "at least" from the wire exactly when this sentence does.
        "metric_basis": None,
    }
    cid, unit, basis = "builder_type", "archetype", "archetype_rules"
    if not sample.get("enough_sessions"):
        # The archetype's own refusal ("fewer than 3 sessions"), from the same floor.
        return _refuse(
            cid, unit, basis, n, "below_session_floor", extras,
            needed=int(sample.get("min_sessions", pf.MIN_SESSIONS)),
        )  # fmt: skip
    scored = [s for s in arch["scores"] if s["score"] is not None]
    if not scored:
        return _refuse(cid, unit, basis, n, "no_archetype_metric", extras)
    if arch["name"] is None:
        closest = min(scored, key=lambda s: (-s["score"], s["name"]))
        extras["closest"] = {k: closest[k] for k in SCORE_KEYS}
        extras["metric_basis"] = _metric_basis(P, closest.get("metric"))
        # Capped at 99: no rule met its threshold, and 99.6% rounding to "100% of the way
        # there" on a card that says nothing dominates would contradict itself. Not a floor,
        # which reads 2.4 / 3.0 as 79 through float error.
        part = min(round(100 * closest["value"] / closest["threshold"]), 99)
        floor = "at least " if _is_lower_bound(extras["metric_basis"]) else ""
        return _answer(
            cid,
            "generalist",
            unit,
            ARCHETYPE_DISPLAY["generalist"],
            f"No single pattern dominates. Closest is {ARCHETYPE_DISPLAY[closest['name']]}, "
            f"{floor}{part}% of the way there.",
            basis,
            n,
            extras,
        )
    extras["metric"] = arch["metric"]
    extras["metric_value"] = arch["value"]
    extras["metric_basis"] = _metric_basis(P, arch["metric"])
    return _answer(
        cid,
        arch["name"],
        unit,
        ARCHETYPE_DISPLAY[arch["name"]],
        _archetype_sentence(
            arch["name"], arch["value"], at_least=_is_lower_bound(extras["metric_basis"])
        ),
        basis,
        n,
        extras,
    )


# ------------------------------------------------------------------------ 2 shipped
#: The commits half of the basis, appended only when commits were actually read.
COMMITS_BASIS = "git_log_distinct_commits"


def _shipped(
    facts: Sequence[pf.SessionFact], P: Mapping, contributions: co.Contributions | None
) -> dict:
    known = [f for f in facts if f.lines_basis != pf.LINES_ABSENT]
    lines_basis = known[0].lines_basis if known else pf.LINES_ABSENT
    basis = f"{lines_basis}+{COMMITS_BASIS}" if contributions is not None else lines_basis
    c = contributions
    extras = {
        # `contributions.total`: distinct SHAs from `git log` across every repository.
        # NEVER `totals.total_commits`, which is a sum of per session windows and which
        # this corpus refuses (`overlapping_session_windows`).
        "commits": c.total if c is not None else None,
        "assisted": c.assisted if c is not None else None,
        "alone": c.alone if c is not None else None,
    }
    cid, unit = "shipped", "lines"
    if not facts:
        return _refuse(cid, unit, basis, 0, "no_sessions", extras)
    if not known:
        return _refuse(cid, unit, basis, 0, "no_line_counts", extras)
    lines = int(P["totals"]["total_lines_added"])
    if lines == 0:
        # The profile's own words (`profile.no_lines_reason`): what was counted, never a
        # cause nobody measured.
        return _refuse(cid, unit, basis, len(known), "no_lines_attributed", extras)
    if c is not None:
        # Two measurements side by side, never "lines ACROSS commits": the lines come from
        # the transcripts and the commits from `git log`, and some commits hold none of
        # those lines (`alone`). FOUND IN REVIEW.
        display = f"{_count(lines, 'line')} written, {_count(c.total, 'commit')}"
        # What `contributions.split` counts as assisted: a commit inside a sitting's
        # window or in the attribution lookback before it (`LOOKBACK_SEC`), when no agent
        # need have been running yet. MEASURED on the corpus: 232 assisted, 12 of them
        # only in the lookback. RECORDED, NOT FIXED: `capture.repo.commits_in` has no
        # author filter, so a teammate's commit counts too (2 of 247 on the corpus).
        sentence = (
            f"{pf._n(c.assisted)} of those commits landed during a session or in the "
            f"{round(co.LOOKBACK_SEC / 60)} minutes before one."
        )
    else:
        display = _count(lines, "line")
        sentence = f"Counted across {_count(len(known), 'session')} from edits and shell writes."
    return _answer(cid, lines, unit, display, sentence, basis, len(known), extras)


# --------------------------------------------------------------------- 3 work_style
#: The values the work style card's `value` takes on the wire, in the order its rules run.
WORK_STYLES: tuple[str, ...] = ("hand_off", "dialogue", "steering", "one_shot")
WORK_STYLE_DISPLAY: dict[str, str] = dict(
    zip(
        WORK_STYLES,
        ("You hand it off.", "A back and forth.", "Hands on the wheel.", "Short and direct."),
        strict=True,
    )
)


def _work_style(facts: Sequence[pf.SessionFact], P: Mapping) -> dict:
    m = P["metrics"]
    attended = _attended(facts)
    autonomy = m["autonomy_score"]["value"]
    steer = m["steer_rate"]["value"]
    median = pf._median([f.prompt_count for f in attended])
    extras = {"autonomy": autonomy, "median_prompts": median, "steer_rate": steer}
    cid, unit, basis = "work_style", "style", "autonomy_then_prompts_then_steer"
    if len(attended) < pf.MIN_SESSIONS:
        return _attended_floor(cid, unit, basis, len(attended), extras)

    # First match wins; a rule whose metric is None is skipped, never read as zero.
    if autonomy is not None and autonomy >= _rule_threshold("director"):
        style, sentence = "hand_off", _runs_without_you(autonomy)
    elif median is not None and median >= DIALOGUE_MIN_PROMPTS:
        style = "dialogue"
        sentence = f"You work in dialogue, {_count(median, 'prompt')} a session."
    elif steer is not None and steer >= _rule_threshold("skeptic"):
        style = "steering"
        sentence = f"{pf.in_ten(steer)} in 10 prompts stop or redirect it."
    else:
        style = "one_shot"
        sentence = f"{_count(median, 'prompt')} a session, then it runs."
    return _answer(
        cid, style, unit, WORK_STYLE_DISPLAY[style], sentence, basis, len(attended), extras
    )


# --------------------------------------------------------------- 4 longest_session
def _longest_session(P: Mapping) -> dict:
    ranked = int(P["ranked_sessions"])
    cid, unit, basis = "longest_session", "seconds", "attended_seconds_rank"
    if ranked == 0 or not P["session_rank"]:
        return _refuse(
            cid, unit, basis, 0, "no_presence", {"active_seconds": None, "started_at": None}
        )
    # The profile's own ranking, by ATTENDED seconds (CLAUDE.md: a kickoff prompt plus
    # eight autonomous hours scores its attended minutes).
    top = P["session_rank"][0]
    value = top["attended_seconds"]
    sentence = (
        f"The longest of {_count(ranked, 'session')} {WITH_YOU}."
        if ranked > 1
        else f"Counted over {_count(ranked, 'session')} {WITH_YOU}."
    )
    return _answer(
        cid,
        value,
        unit,
        _floor_mins(value),
        sentence,
        basis,
        ranked,
        {"active_seconds": top["active_seconds"], "started_at": top["started_at"]},
    )


# ---------------------------------------------------------------- 5 agents_at_once
def _agents_at_once(sessions: Sequence[pat.SessionEvents], fanout: ag.Fanout | None) -> dict:
    extras = {
        "subagents_peak": fanout.max_concurrent if fanout is not None else None,
        "subagents": fanout.agents if fanout is not None else None,
    }
    cid, unit, basis = "agents_at_once", "sessions", "sweep_over_first_to_last_event"
    with_events = [s for s in sessions if s.events]
    if not with_events:
        return _refuse(cid, unit, basis, 0, "no_sessions" if not sessions else "no_events", extras)
    # First to last EVENT, never started_at to ended_at: `ended_at` carries the trailing
    # idle credit, and silence after the agent stopped is not the agent running (the
    # `patterns._runs_with_nothing_to_show` fix).
    peak, _busy = ag.peak_concurrency([(s.events[0].ts, s.events[-1].ts) for s in with_events])
    # The sweep skips spans shorter than the timestamp resolution, which cannot be shown to
    # overlap anything but still ran: a sitting that ran is one at once. The same floor
    # `agents.fanout` puts under `max_concurrent`.
    value = max(peak, 1)
    if fanout is not None and fanout.max_concurrent >= 2:
        # Not "inside one session": the corpus fan out sweeps every sidecar together, so
        # its peak can span two sittings running side by side. The display names what it
        # counts, so the card does not give two answers to one question (FOUND IN REVIEW:
        # "3 at once" above "Up to 9 helper agents ran at the same moment").
        inside = "Inside them, up to" if value >= 2 else "Up to"
        sentence = f"{inside} {fanout.max_concurrent} helper agents ran at the same moment."
    else:
        sentence = (
            f"Counted from first action to last across {_count(len(with_events), 'session')}."
        )
    display = f"{_count(value, 'session')} at once"
    return _answer(cid, value, unit, display, sentence, basis, len(with_events), extras)


# ------------------------------------------------------------------ 6 go_to_prompt
def _go_to_prompt(quotable: Sequence[_Prompt]) -> tuple[dict, dict | None]:
    cid, unit, basis = "go_to_prompt", "sends", "normalized_prompt_text_across_sessions"
    groups: dict[str, list[_Prompt]] = {}
    for p in quotable:
        key = _norm(p.text)
        if key:  # all punctuation normalises to nothing, and nothing is not one prompt
            groups.setdefault(key, []).append(p)

    def summary(ps: list[_Prompt]) -> tuple[int, int, int, float, _Prompt]:
        recent = max(ps, key=lambda p: (p.ts, p.session_index, p.event_index))
        return (
            len({p.session_index for p in ps}),
            len(ps),
            len(recent.text.split()),
            min(p.ts for p in ps),
            recent,
        )

    ranked = []
    for key, ps in groups.items():
        n_sessions, sends, words, first, recent = summary(ps)
        if n_sessions >= GO_TO_MIN_SESSIONS:
            # Sessions desc, sends desc, words desc, first use asc (UNMEASURED JUDGEMENT
            # CALL on the tie breaks), then the text itself so the order is total.
            ranked.append(
                ((-n_sessions, -sends, -words, first, key), n_sessions, sends, words, recent)
            )
    if not ranked:
        return (
            _refuse(
                cid, unit, basis, len(quotable), "no_repeated_prompt", {"sessions": None, "words": None}
            ),
            None,
        )
    _, n_sessions, sends, words, recent = min(ranked, key=lambda r: r[0])
    card = _answer(
        cid,
        sends,
        unit,
        f"Sent {_count(sends, 'time')} across {_count(n_sessions, 'session')}",
        f"{_count(words, 'word')} you keep coming back to.",
        basis,
        len(quotable),
        {"sessions": n_sessions, "words": words},
    )
    return card, _quote_of(recent)


# ------------------------------------------------------------------------ 7 streak
def _streak(facts: Sequence[pf.SessionFact], contributions: co.Contributions | None) -> dict:
    cid, unit, basis = "streak", "days", "days_with_a_commit_and_an_attended_session"
    if contributions is None:
        return _refuse(
            cid,
            unit,
            basis,
            0,
            "no_commit_history",
            {"commit_days": None, "attended_days": None, "both_days": None},
        )
    commit_days = {d.day for d in contributions.days if d.total}
    # An unattended run never extends a streak (CLAUDE.md; the contract's `unattended`).
    attended_days = {f.local_day for f in facts if pf.is_attended(f)}
    both = sorted(commit_days & attended_days)
    value = pf.longest_run(both)
    extras = {
        "commit_days": len(commit_days),
        "attended_days": len(attended_days),
        "both_days": len(both),
    }
    # A past fact, never a mechanic: the roadmap rejected streaks as retention, so there is
    # no current streak here and nothing that nudges.
    if value == 0:
        display = "No streak yet"
        sentence = (
            f"{_count(len(commit_days), 'day')} had a commit, none alongside a session {WITH_YOU}."
        )
    else:
        display = f"{_count(value, 'day')} straight"
        sentence = f"{_count(len(both), 'day')} in all had a commit and a session {WITH_YOU}."
    return _answer(cid, value, unit, display, sentence, basis, len(both), extras)


# ----------------------------------------------------------------- 8 change_course
def _change_course(P: Mapping) -> dict:
    sr = P["metrics"]["steer_rate"]
    cid, unit, basis = "change_course", "share", "interrupts_and_correction_markers"
    extras = {
        "interrupts": sr.get("interrupts"),
        "corrective_prompts": sr.get("corrective_prompts"),
    }
    if sr["value"] is None:
        # Said from the counts this machine has. The profile's reason is written for the
        # server too ("not stored server side", false on the Mac that read every prompt),
        # and printed "1 prompts" (FOUND IN REVIEW). At or past the floor the only way the
        # profile refuses is that no prompt carried text or no interrupt was counted.
        n = int(sr["n"])
        if not sr.get("reason"):
            # A metric refused with no reason is a caller bug: the card would have to
            # guess why, and a guessed reason is a plausible wrong sentence.
            raise ValueError("change_course: the steer rate was refused without a reason")
        if n < pf.MIN_PROMPTS:
            return _refuse(cid, unit, basis, n, "below_prompt_floor", extras, needed=pf.MIN_PROMPTS)
        return _refuse(cid, unit, basis, n, "no_prompt_text", extras)
    return _answer(
        cid,
        sr["value"],
        unit,
        f"{pf._pct(sr['value'])} of the time",
        f"{_count(sr['interrupts'], 'interrupt')} and "
        f"{_count(sr['corrective_prompts'], 'correction')} across {_count(sr['n'], 'prompt')}.",
        basis,
        sr["n"],
        extras,
    )


# ---------------------------------------------------------------------- 9 crash_out
_PROFANITY = re.compile(r"\b(fuck\w*|shit\w*|damn\w*|wtf|ffs|bullshit|crap|ugh+|omg)\b", re.I)
_BANG_RUN = re.compile(r"[!?]{2,}")
_STRETCH = re.compile(r"([a-z])\1{3,}")

#: Words that are capitals because they are names, not because somebody is shouting.
ACRONYMS = frozenset(
    {
        "API", "URL", "CSS", "HTML", "JSON", "HTTP", "HTTPS", "SQL", "CLI", "SDK", "ETA",
        "AWS", "GCP", "JWT", "RLS", "EAS", "TODO", "README", "YAML", "CSV", "PDF", "MVP",
        "IOS", "GPU", "CPU", "RAM", "UTC", "PST", "DNS", "SSH", "SSL", "TLS", "ORM", "CORS",
    }
)  # fmt: skip


def _caps_words(text: str) -> int:
    n = 0
    for token in text.split():
        core = token.strip(string.punctuation)
        if len(core) >= 3 and core.isalpha() and core.isupper() and core not in ACRONYMS:
            n += 1
    return n


def _crash_parts(text: str) -> dict[str, int]:
    """Each signal, counted raw. The caps in `_crash_score` keep one signal from winning."""
    return {
        "profanity": len(_PROFANITY.findall(text)),
        "caps_words": _caps_words(text),
        "bang_runs": len(_BANG_RUN.findall(text)),
        "markers": len(pf.correction_markers(text)),
        "stretches": len(_STRETCH.findall(text.lower())),
    }


def _crash_score(parts: Mapping[str, int]) -> int:
    return (
        3 * min(parts["profanity"], 5)
        + 2 * min(parts["caps_words"], 5)
        + 2 * min(parts["bang_runs"], 3)
        + parts["markers"]
        + 2 * min(parts["stretches"], 2)
    )


def _crash_out(quotable: Sequence[_Prompt]) -> tuple[dict, dict | None]:
    cid, unit, basis = "crash_out", "score", "profanity_caps_punctuation_markers"
    best: tuple[int, float, _Prompt, dict] | None = None
    for p in quotable:
        if _DISTRESS.search(p.text):
            continue
        parts = _crash_parts(p.text)
        score = _crash_score(parts)
        if score < CRASH_MIN_SCORE:
            continue
        # Highest score, ties to the earliest.
        if best is None or (-score, p.ts) < (-best[0], best[1]):
            best = (score, p.ts, p, parts)
    if best is None:
        return (
            _refuse(cid, unit, basis, len(quotable), "no_crash_out", {"parts": None}),
            None,
        )
    score, _ts, p, parts = best
    into = crash_out_into(_seconds_in(p))
    # A fact, not a label: when it was sent, on the person's own clock. "Your angriest
    # prompt" repeated the question, carried no number and called the person angry
    # (FOUND IN REVIEW). The card is LOCAL whole, so the day and time never leave.
    card = _answer(
        cid,
        score,
        unit,
        _when(p.ts, p.session.tz_offset_minutes),
        f"Sent {into} into that session. We have all been there.",
        basis,
        len(quotable),
        {"parts": parts},
    )
    return card, _quote_of(p)


def crash_out_into(seconds_in: int) -> str:
    """How far into its session the crash out was sent, from the WHOLE seconds the quotes
    document carries (`QuoteWire.seconds_in`), so the phone says the same minutes from the
    wire. `feedback._mins` says "under a minute" there, which has no digit and reads oddly
    after "Sent"."""
    into = fb._mins(seconds_in)
    return "less than 1 minute" if into == fb._mins(0) else into


def _when(ts: float, tz_offset_minutes: int) -> str:
    """"A Tuesday, at 11:42pm": the day and time on the person's own clock."""
    import datetime as dt

    local = dt.datetime.fromtimestamp(ts, dt.UTC) + dt.timedelta(minutes=tz_offset_minutes)
    hour = local.hour % 12 or 12
    return f"A {local.strftime('%A')}, at {hour}:{local.minute:02d}{'am' if local.hour < 12 else 'pm'}"


# ------------------------------------------------------------------ 10 prompt_length
def _prompt_length(quotable: Sequence[_Prompt]) -> dict:
    cid, unit, basis = "prompt_length", "words", "words_per_prompt"
    # The `digest.stats` word rule: whitespace separated tokens.
    words = [len(p.text.split()) for p in quotable]
    if len(words) < pf.MIN_PROMPTS:
        return _refuse(
            cid, unit, basis, len(words), "below_own_words_floor", {"median": None},
            needed=pf.MIN_PROMPTS,
        )  # fmt: skip
    mean = round(sum(words) / len(words), 1)
    median = pf._median(words)
    if median < pf.SHORT_PROMPT_WORDS:
        label = "Mostly terse."
    elif median < PROMPT_BRIEF_WORDS:
        label = "Mostly conversational."
    else:
        label = "Mostly detailed briefs."
    return _answer(
        cid,
        mean,
        unit,
        f"{_count(mean, 'word')} on average",
        f"{label} Half of them run {_count(median, 'word')} or fewer.",
        basis,
        len(words),
        {"median": median},
    )


# ----------------------------------------------------------------- 11 deep_sessions
def _deep_sessions(facts: Sequence[pf.SessionFact]) -> dict:
    cid, unit, basis = "deep_sessions", "sessions", "attended_sessions_over_an_hour"
    attended = _attended(facts)
    # Floored, as the longest session card floors it (`_floor_mins`): 3,585 s is 59
    # minutes, not "60 minutes" beside "No session past an hour yet".
    longest = int(max(f.attended_seconds for f in attended) // 60) if attended else None
    if len(attended) < pf.MIN_SESSIONS:
        return _attended_floor(
            cid, unit, basis, len(attended), {"avg_minutes": None, "longest_minutes": longest}
        )
    deep = [f for f in attended if f.attended_seconds >= DEEP_MIN_ATTENDED_SEC]
    if not deep:
        return _answer(
            cid,
            0,
            unit,
            "No session past an hour yet",
            f"Your longest ran {_minutes(longest)}.",
            basis,
            len(attended),
            {"avg_minutes": None, "longest_minutes": longest},
        )
    avg = round(sum(f.attended_seconds for f in deep) / len(deep) / 60)
    sentence = (
        f"Averaging {_minutes(avg)} of focus each."
        if len(deep) > 1
        else f"It ran {_minutes(avg)} {WITH_YOU}."
    )
    return _answer(
        cid,
        len(deep),
        unit,
        f"{_count(len(deep), 'deep session')}",
        sentence,
        basis,
        len(attended),
        {"avg_minutes": avg, "longest_minutes": longest},
    )


# ------------------------------------------------------------------- 12 time_put_in
def _time_put_in(facts: Sequence[pf.SessionFact], P: Mapping) -> dict:
    cid, unit, basis = "time_put_in", "hours", "active_seconds"
    t = P["totals"]
    n = int(t["total_sessions"])
    if not n:
        return _refuse(
            cid, unit, basis, 0, "no_sessions",
            {"attended_hours": None, "attended_overlap_hours": None},
        )  # fmt: skip
    hours = t["total_hours"]
    attended = round(sum(f.attended_seconds for f in facts) / 3600, 1)
    overlap = round(_attended_overlap_seconds(facts) / 3600, 1)
    sentence = f"{pf._n(attended)} of those hours {WITH_YOU}."
    if overlap > 0:
        sentence = (
            f"{pf._n(attended)} of those hours {WITH_YOU}, up to {pf._n(overlap)} of them "
            "in sessions that ran at the same time."
        )
    return _answer(
        cid,
        hours,
        unit,
        f"{_count(hours, 'hour')} across {_count(n, 'session')}",
        sentence,
        basis,
        n,
        {"attended_hours": attended, "attended_overlap_hours": overlap},
    )


def _attended_overlap_seconds(facts: Sequence[pf.SessionFact]) -> float:
    """How much of the attended total could be one person counted twice: the sum of the
    windows of sessions with you there, less their union. A correct per session number
    can be an incorrect corpus total (CLAUDE.md): two sittings running at once each count
    their own attended minutes, and a person is one person. An UPPER bound, because a
    sitting's window is longer than its attended clock. MEASURED on the corpus (FOUND IN
    REVIEW, 2026-09-13): windows summing to 111.81 h against a union of 110.62 h, so up
    to 1.19 h of the 74.5 attended hours may be counted twice."""
    spans = sorted((f.started_at, f.ended_at) for f in _attended(facts) if f.ended_at > f.started_at)
    total = sum(b - a for a, b in spans)
    union = 0.0
    cur_a = cur_b = None
    for a, b in spans:
        if cur_b is None or a > cur_b:
            if cur_b is not None:
                union += cur_b - cur_a
            cur_a, cur_b = a, b
        else:
            cur_b = max(cur_b, b)
    if cur_b is not None:
        union += cur_b - cur_a
    return max(0.0, total - union)


# ---------------------------------------------------------------- 13 cryptic_prompt
#: Paths, emails, URLs and versions: somebody's filing system is not cryptic.
_NOT_CRYPTIC = re.compile(r"[/@=]|://|\.\w")
_HEX_HASH = re.compile(r"[0-9a-fA-F]{7,40}")
_VOWELLESS_RUN = re.compile(r"[bcdfghjklmnpqrstvwxz]{5,}", re.I)
#: A token this long is key shaped, and possibly a credential the mask did not know.
#: UNMEASURED JUDGEMENT CALL: 16 is the shortest common API key body (a 16 character
#: Stripe or Mailgun suffix); a word that long in a short prompt is rarely prose.
CRYPTIC_MAX_TOKEN = 16
#: The lengths a cryptic prompt can have. UNMEASURED JUDGEMENT CALL: four characters is
#: the least that can be mostly gibberish (`_gibberish` reads five letter runs inside
#: longer text), and past 80 a prompt is a sentence, not a mash.
CRYPTIC_MIN_CHARS, CRYPTIC_MAX_CHARS = 4, 80
#: A prompt of one token is never the cryptic prompt: a letters only password and a
#: keyboard mash have the same shape (FOUND IN REVIEW: `xkcdmbrptw` was crowned).
CRYPTIC_MIN_TOKENS = 2
CRYPTIC_BASIS = "vowelless_runs"

#: Constants a refusal template names (`refusal_text`), so the wire need not carry them
#: on every card: the cryptic bar's own numbers. The phone gets the same table.
REFUSAL_CONSTANTS: dict[str, int] = {
    "min_tokens": CRYPTIC_MIN_TOKENS,
    "min_chars": CRYPTIC_MIN_CHARS,
    "max_chars": CRYPTIC_MAX_CHARS,
}


def _cryptic_candidate(text: str) -> bool:
    s = text.strip()
    if not (CRYPTIC_MIN_CHARS <= len(s) <= CRYPTIC_MAX_CHARS):
        return False
    alnum = _NOT_ALNUM.sub("", s)
    if len(alnum) < 4:
        return False
    if len(s.split()) < CRYPTIC_MIN_TOKENS:
        return False
    if any(len(tok) >= CRYPTIC_MAX_TOKEN for tok in s.split()):
        return False
    if _NOT_CRYPTIC.search(s):
        return False
    return not (_HEX_HASH.fullmatch(alnum) or alnum.isdigit())


def _gibberish(token: str) -> bool:
    """Five letters with no vowel in a row (`sdfgh`, a keyboard mash).

    Never an identifier: letters and digits interleaved (`Q7ZK2M9X4P`) was the other half
    of this rule as designed, and on the corpus it crowned a pasted account identifier the most cryptic
    prompt (`_carries_identifier`). A prompt carrying one is not quotable, so it never gets
    here; the guard keeps the rule honest when this is called on its own.
    """
    core = _NOT_ALNUM.sub("", token)
    if len(core) < 4 or _interleaved(core):
        return False
    return bool(_VOWELLESS_RUN.search(core))


def _cryptic_share(text: str) -> float:
    tokens = text.split()
    total = sum(len(t) for t in tokens)
    if not total:
        return 0.0
    return sum(len(t) for t in tokens if _gibberish(t)) / total


def _tool_calls_after(p: _Prompt) -> int:
    k = 0
    for e in p.session.events[p.event_index + 1 :]:
        if e.kind == "prompt":
            break
        if e.kind == "tool":
            k += 1
    return k


def _cryptic_prompt(quotable: Sequence[_Prompt]) -> tuple[dict, dict | None]:
    cid, unit, basis = "cryptic_prompt", "share", CRYPTIC_BASIS
    candidates = [p for p in quotable if _cryptic_candidate(p.text)]
    best: tuple[tuple, float, _Prompt] | None = None
    for p in candidates:
        share = _cryptic_share(p.text)
        if share < CRYPTIC_MIN:
            continue
        key = (-share, len(p.text.strip()), p.ts)  # score desc, shorter, earlier
        if best is None or key < best[0]:
            best = (key, share, p)
    empty = {"length": None, "tool_calls_after": None, "corrected": None}
    if best is None:
        return (
            _refuse(cid, unit, basis, len(candidates), "no_cryptic_prompt", empty),
            None,
        )
    _, share, p = best
    # The length of the text AS QUOTED (whitespace collapsed; a candidate is never long
    # enough to be cut), so the number beside the quote counts the characters shown and the
    # phone can say it from the quotes document alone.
    length = len(_quote(p.text))
    corrected = pat._was_corrected(p.session, p.event_index)
    after = _tool_calls_after(p)
    card = _answer(
        cid,
        round(share, 2),
        unit,
        cryptic_display(length),
        cryptic_sentence(length, after, corrected),
        basis,
        len(candidates),
        {"length": length, "tool_calls_after": after, "corrected": corrected},
    )
    return card, _quote_of(p, tool_calls_after=after, corrected=corrected)


def cryptic_display(length: int) -> str:
    """Never "A 11 character prompt": the article is right for every length this way."""
    return f"A prompt of {_count(length, 'character')}"


def cryptic_sentence(length: int, tool_calls_after: int, corrected: bool) -> str:
    return (
        f"{length} characters, and it had a go anyway."
        if corrected
        else f"Somehow the agent knew. {_count(tool_calls_after, 'tool call')} followed."
    )


# ----------------------------------------------------------- 14 prompts_per_session
def _prompts_per_session(facts: Sequence[pf.SessionFact]) -> dict:
    # The unit is an identifier (`spec/report.v1.json` `wrapped_unit`), never rendered, so
    # it carries no space (it was "prompts per session").
    cid, unit, basis = "prompts_per_session", "prompts_per_session", "prompts_over_attended_sessions"
    # A session nobody was at is not a conversation.
    attended = _attended(facts)
    counts = [f.prompt_count for f in attended]
    median = pf._median(counts)
    # Over the SAME sessions the value is: the profile's `iteration_depth` divides every
    # session's tool calls, an unattended run's included, by prompts only attended ones
    # sent (FOUND IN REVIEW: 12.1 on the corpus against 11.4 over the sessions the card
    # counts; the 26 unattended sittings add 633 tool calls and no prompt).
    prompts = sum(counts)
    tools = sum(sum(f.tool_calls.values()) for f in attended)
    # The profile's own bars for this ratio: some session with tool counts, and
    # `MIN_PROMPTS` prompts under it.
    known = any(f.tool_basis != pf.TOOLS_ABSENT for f in attended)
    depth = round(tools / prompts, 1) if prompts >= pf.MIN_PROMPTS and known else None
    extras = {"median": median, "tool_calls_per_prompt": depth}
    if len(attended) < pf.MIN_SESSIONS:
        return _attended_floor(cid, unit, basis, len(attended), extras)
    mean = round(sum(counts) / len(counts), 1)
    sentence = (
        f"{_count(depth, 'tool call')} for every prompt you send."
        if depth is not None
        else f"Half your sessions have {pf._n(median)} or fewer."
    )
    return _answer(
        cid,
        mean,
        unit,
        f"{_count(mean, 'prompt')} a session",
        sentence,
        basis,
        len(attended),
        extras,
    )


# ------------------------------------------------------------------ 15 kind_of_work
#: The commit kinds, in the order ties break.
KINDS: tuple[str, ...] = (
    "feature",
    "fix",
    "refactor",
    "docs",
    "test",
    "chore",
    "perf",
    "style",
    "build",
    "revert",
)
_KIND_NOUN: dict[str, tuple[str, str]] = {
    "feature": ("feature", "features"),
    "fix": ("fix", "fixes"),
    "refactor": ("refactor", "refactors"),
    "docs": ("docs change", "docs changes"),
    "test": ("test change", "test changes"),
    "chore": ("chore", "chores"),
    "perf": ("speedup", "speedups"),
    "style": ("style change", "style changes"),
    "build": ("build change", "build changes"),
    "revert": ("revert", "reverts"),
}

_CONVENTIONAL = re.compile(
    r"^(feat|fix|refactor|docs|test|tests|chore|perf|style|build|ci|revert)(\([^)]*\))?!?:\s",
    re.I,
)
_CONVENTIONAL_KIND = {"feat": "feature", "tests": "test", "ci": "build"}
_ONE_SCOPE = re.compile(r"^[\w./]+:\s+")
_FIRST_WORD_KIND: dict[str, str] = {
    **dict.fromkeys(("fix", "fixes", "fixed", "repair", "resolve", "patch", "correct"), "fix"),
    **dict.fromkeys(
        (
            "add",
            "adds",
            "added",
            "implement",
            "introduce",
            "build",
            "create",
            "support",
            "enable",
            "wire",
            "ship",
            "allow",
        ),
        "feature",
    ),
    **dict.fromkeys(
        (
            "refactor",
            "rename",
            "extract",
            "simplify",
            "clean",
            "cleanup",
            "move",
            "split",
            "reorganize",
            "restructure",
            "inline",
            "dedupe",
        ),
        "refactor",
    ),
    **dict.fromkeys(("document", "docs", "doc", "readme"), "docs"),
    **dict.fromkeys(("test", "tests"), "test"),
    **dict.fromkeys(("revert", "undo", "rollback"), "revert"),
    **dict.fromkeys(("bump", "upgrade"), "chore"),
}

#: The fallback's display per role, and the word it takes before "files" in the sentence.
ROLE_DISPLAY: dict[str, str] = {
    "source": "Mostly source code.",
    "test": "Mostly tests.",
    "docs": "Mostly docs.",
    "config": "Mostly configuration.",
    "migration": "Mostly database migrations.",
    "style": "Mostly styling.",
    "build": "Mostly build setup.",
    "dependency": "Mostly dependencies.",
    "unknown": "Mostly other files.",
}
ROLE_WORD: dict[str, str] = {
    "source": "source",
    "test": "test",
    "docs": "documentation",
    "config": "config",
    "migration": "migration",
    "style": "style",
    "build": "build",
    "dependency": "dependency",
    "unknown": "other",
}

KIND_BASIS_COMMITS = "commit_subject_labels"
KIND_BASIS_LINES = "lines_by_file_role"
KIND_BASIS_NEITHER = f"{KIND_BASIS_COMMITS}_then_{KIND_BASIS_LINES}"


def classify_subject(subject: str) -> str | None:
    """The kind of change a commit subject SAYS it is, or None when it does not say.

    The author's own label, read as a label: `fix:` and "Fix the thing" are what the author
    called a fix, which is what `quality.py` could not use as a failure rate and is exactly
    what this card reports. None is a subject written as prose, which is most of them on
    the measured corpus, and that is what the coverage gate is for.
    """
    s = subject.strip()
    m = _CONVENTIONAL.match(s)
    if m:
        word = m.group(1).lower()
        return _CONVENTIONAL_KIND.get(word, word)
    words = _ONE_SCOPE.sub("", s, count=1).split()
    if not words:
        return None
    return _FIRST_WORD_KIND.get(words[0].strip(string.punctuation).lower())


def _kind_noun(kind: str, n: int) -> str:
    one, many = _KIND_NOUN[kind]
    return _count(n, one, many)


def _role_lines(sessions: Sequence[pat.SessionEvents]) -> collections.Counter[str]:
    """Agent lines by file role: PROJECT writes (`patterns.project_write`, never Claude
    Code's own files), each event once (`patterns.distinct_events`), in a language that is
    not generated. The same lines "How much did you ship?" counts, split by role."""
    out: collections.Counter[str] = collections.Counter()
    for s in sessions:
        for e in pat.distinct_events(s.events):
            if not pat.project_write(e) or not e.path or not e.added:
                continue
            if lang.language_of(e.path) is None:  # generated: nobody chose those lines
                continue
            out[plain.role_of(e.path)] += e.added
    return out


def _kind_of_work(sessions: Sequence[pat.SessionEvents], commit_subjects: Sequence[str]) -> dict:
    cid, unit = "kind_of_work", "kind"
    total = len(commit_subjects)
    counts = collections.Counter(k for k in map(classify_subject, commit_subjects) if k)
    classified = sum(counts.values())
    coverage = round(classified / total, 3) if total else None
    # Which gate the commit labels failed (`KIND_REFUSALS`), and the floor it names: the
    # labelled count, or the coverage in percent.
    if not total:
        commit_code, commit_needed = "no_subjects", None
    elif classified < KIND_MIN_SUBJECTS:
        commit_code, commit_needed = "too_few_labelled", KIND_MIN_SUBJECTS
    elif classified / total < KIND_MIN_COVERAGE:
        commit_code, commit_needed = "low_label_coverage", round(KIND_MIN_COVERAGE * 100)
    else:
        commit_code, commit_needed = None, None

    roles = _role_lines(sessions)
    lines = sum(roles.values())
    extras = {
        "counts": {k: counts[k] for k in KINDS if counts[k]},
        "classified": classified,
        "commits": total,
        "coverage": coverage,
        "role_lines": {r: roles[r] for r in plain.ROLES if roles[r]},
        "commit_code": commit_code,
        "commit_reason": None,
        # The file role basis's own numbers, so its half of a refusal is worded from the
        # wire: the attributable lines, and the floor they fell short of.
        "lines": lines,
        "lines_needed": lang.MIN_LINES,
    }
    if commit_code is not None:
        extras["commit_reason"] = pf.fill(
            KIND_REFUSALS[commit_code], classified=classified, commits=total, needed=commit_needed
        )

    if commit_code is None:
        top = sorted(counts, key=lambda k: (-counts[k], KINDS.index(k)))
        k1 = top[0]
        said = _kind_noun(k1, counts[k1])
        if len(top) > 1:
            said += f" and {_kind_noun(top[1], counts[top[1]])}"
        return _answer(
            cid,
            k1,
            unit,
            f"Mostly {_KIND_NOUN[k1][1]}.",
            f"{said} in {_count(total, 'commit')}.",
            KIND_BASIS_COMMITS,
            classified,
            extras,
        )

    if lines >= lang.MIN_LINES:
        top = sorted(roles, key=lambda r: (-roles[r], plain.ROLES.index(r)))
        r1 = top[0]
        said = f"{round(100 * roles[r1] / lines)}% of agent lines went to {ROLE_WORD[r1]} files"
        if len(top) > 1:
            said += f", {round(100 * roles[top[1]] / lines)}% to {ROLE_WORD[top[1]]} files"
        return _answer(cid, r1, unit, ROLE_DISPLAY[r1], said + ".", KIND_BASIS_LINES, lines, extras)

    return _refuse(cid, unit, KIND_BASIS_NEITHER, total, "neither_kind_basis", extras, needed=commit_needed)


# ------------------------------------------------------------------------ assembled
def wrapped(
    facts: Sequence[pf.SessionFact],
    sessions: Sequence[pat.SessionEvents],
    *,
    profile: Mapping | None = None,
    contributions: co.Contributions | None = None,
    fanout: ag.Fanout | None = None,
    commit_subjects: Sequence[str] = (),
    quotes: bool = False,
) -> dict:
    """The fifteen cards, the quotes when asked for, and what the cards rest on.

    `facts` and `sessions` are the parallel lists `__main__._narrative_inputs` returns: one
    `SessionFact` and one `SessionEvents` per counted session, in the same order. A
    mismatch is a caller bug that would put one sitting's prompts beside another's clock,
    so it raises rather than answering.
    """
    facts = list(facts)
    sessions = list(sessions)
    for f, s in zip(facts, sessions, strict=True):
        if f.session_id != s.session_id:
            raise ValueError(
                f"facts and sessions are not parallel: {f.session_id!r} beside {s.session_id!r}"
            )
    P = profile if profile is not None else pf.corpus_profile(facts)

    own = [p for p in _prompts(sessions) if quotable(p.text)]
    # The three cards that quote pick only from prompts that are safe to show (`_private`).
    showable = [p for p in own if not _private(p.text)]
    go_to, go_to_quote = _go_to_prompt(showable)
    crash, crash_quote = _crash_out(showable)
    cryptic, cryptic_quote = _cryptic_prompt(showable)

    cards = [
        _builder_type(P),
        _shipped(facts, P, contributions),
        _work_style(facts, P),
        _longest_session(P),
        _agents_at_once(sessions, fanout),
        go_to,
        _streak(facts, contributions),
        _change_course(P),
        crash,
        _prompt_length(own),
        _deep_sessions(facts),
        _time_put_in(facts, P),
        cryptic,
        _prompts_per_session(facts),
        _kind_of_work(sessions, commit_subjects),
    ]
    assert tuple(c["id"] for c in cards) == CARD_IDS

    found = dict(zip(QUOTE_CARDS, (go_to_quote, crash_quote, cryptic_quote), strict=True))
    sample = {k: P["sample"][k] for k in SAMPLE_KEYS}
    sample["attended_sessions"] = len(_attended(facts))
    return {
        "cards": cards,
        "quotes": {k: q for k, q in found.items() if q is not None} if quotes else {},
        "sample": sample,
    }


def wire(result: Mapping) -> dict:
    """What may leave the machine: ids, numbers, enums and counts. Nothing rendered.

    Dropped: every `question`, `display` and `sentence` (the phone renders its own words
    from the id and the numbers, as `feedback.wire` does), every quote, and everything but
    `LOCAL_CARD_KEYS` of the two cards whose numbers are readings of what somebody typed.
    `reason` is still the words here; the report carries the `code` in its place
    (`report_blocks.wrapped_block`).
    """
    cards = []
    for c in result["cards"]:
        keys = LOCAL_CARD_KEYS if c["id"] in LOCAL_CARDS else WIRE_KEYS
        cards.append({k: copy.deepcopy(c[k]) for k in keys})
    return {"cards": cards, "sample": copy.deepcopy(dict(result["sample"]))}


#: The quotes document's version (privacy/upload-contract.json `quotes.quotes_version`).
QUOTES_VERSION = 1


def quotes_upload(result: Mapping, *, generated_at: float) -> dict:
    """The quotes document (privacy/upload-contract.json `quotes`, `QuotesUpload`): THE
    SECOND OPT-IN EXCEPTION, the one place a prompt's words leave the machine, and only
    when both the phone's setting and `--quotes` said yes. Empty unless `wrapped` was run
    with `quotes=True`, so a caller that forgot to ask sends nothing.

    Every quote is checked again here, on the text as it would be sent: the digest's mask
    must leave it as it is (a secret shape it knows is not in it) and `quotable` must still
    pass (no slash command, no identifier, no paste). A quote that fails is dropped, never
    rewritten. `server/builder/quotes.py` runs the same two functions a third time.
    """
    from . import digest

    out = []
    for card in QUOTE_CARDS:
        q = (result.get("quotes") or {}).get(card)
        if not q:
            continue
        text = q["text"]
        if len(text) > QUOTE_MAX or digest.mask(text) != text or not quotable(text):
            continue
        out.append(
            {
                "card": card,
                "text": text,
                "client_session_id": q["session_id"],
                "sent_at": pf._iso(q["ts"]),
                "seconds_in": int(q["seconds_in"]),
                # The cryptic prompt's sentence reads both; every other card's are null.
                "tool_calls_after": q.get("tool_calls_after") if card == "cryptic_prompt" else None,
                "corrected": q.get("corrected") if card == "cryptic_prompt" else None,
            }
        )
    return {"quotes_version": QUOTES_VERSION, "generated_at": pf._iso(generated_at), "quotes": out}


__all__ = [
    "ACRONYMS",
    "ARCHETYPE_DISPLAY",
    "CARD_IDS",
    "CARD_KEYS",
    "CRASH_MIN_SCORE",
    "CRYPTIC_MIN",
    "DEEP_MIN_ATTENDED_SEC",
    "DIALOGUE_MIN_PROMPTS",
    "GO_TO_MIN_SESSIONS",
    "KINDS",
    "KIND_MIN_COVERAGE",
    "KIND_MIN_SUBJECTS",
    "KIND_REFUSALS",
    "LOCAL_CARDS",
    "LOCAL_CARD_KEYS",
    "PROMPT_BRIEF_WORDS",
    "QUOTES_VERSION",
    "QUOTE_CARDS",
    "QUESTIONS",
    "QUOTE_MAX",
    "REFUSALS",
    "REFUSAL_CONSTANTS",
    "ROLE_DISPLAY",
    "ROLE_WORD",
    "WIRE_KEYS",
    "WORK_STYLES",
    "WORK_STYLE_DISPLAY",
    "classify_subject",
    "quotable",
    "quotes_upload",
    "refusal_text",
    "wire",
    "wrapped",
]
