"""The small shared rules every sentence a person reads is built from.

`docs/overnight-engine.md` section 1.1. Three modules speak about files and counts
(`live.py`, `vocab.py`, `wrapped.py`), and each of these rules would drift if it were
written three times (CLAUDE.md, "A rule copied into a second module is a definition that
will drift"):

  * `role_of`: what a file IS to the project, from its path shape alone. Never its
    contents: a role read off contents would need the file, and the transcript names it.
  * `spoken` and `ordinal`: numbers the way a person says them ("six", "third").
  * `has_dash`: the one definition of a dash, which no string a person reads may carry
    (docs/analysis.md; docs/approved-roadmap.md rule 2).
  * `ROLE_NOUN`: the words for a role, one file, several, and the whole collection.
  * `half_up`, `rounded` and `pct`: THE rounding rule for every number a person reads, a
    tie away from zero, off the number as it is written. `mobile/src/copy/numbers.ts`
    (`scaledHalfUp`) holds the same rule, so the phone and the Mac agree to the digit.

MEASURED over the corpus's 50,177 PROJECT agent lines (2026-09-13, after the review:
generated files excluded as `languages.split` excludes them, Claude Code's own files as
`patterns.project_write` does, each event once): source 69.5%, test 22.1%, docs 4.9%,
config 1.7%, migration 1.1%, dependency 0.4%, build 0.3%, unknown 0.1%. (The first
measurement, 65.3% source over 64,652 lines, counted scratchpad and memory files too.)
"""

from __future__ import annotations

import math
import posixpath
import re
from decimal import ROUND_HALF_UP, Decimal

from . import languages, shipped

#: Every role a path can have, in the order `role_of` tries them after `dependency` and
#: `migration` (and the order ties are broken in by the modules that rank roles).
ROLES = (
    "test",
    "source",
    "config",
    "docs",
    "migration",
    "style",
    "build",
    "dependency",
    "unknown",
)

_MIGRATION_SEGS = frozenset({"migrations", "migration", "migrate", "alembic"})
_MIGRATION_NAME = re.compile(r"^\d{3,}[_-].+\.(sql|py|ts|js|rb)$")

#: Never `spec/`: this repository's `spec/` holds JSON specs, and `spec/strip.v1.json` is
#: configuration, not a test.
_TEST_SEGS = frozenset({"test", "tests", "__tests__"})
_TEST_NAME = re.compile(
    r"^test_.+\.py$|_test\.(py|go)$|\.(test|spec)\.[jt]sx?$|Tests?\.swift$|Test\.(java|kt)$"
)

_DOCS_EXT = frozenset({"md", "mdx", "rst", "adoc", "txt"})
_DOCS_SEGS = frozenset({"docs", "doc"})
_STYLE_EXT = frozenset({"css", "scss", "sass", "less", "styl"})
_BUILD_NAMES = frozenset({"Makefile", "Dockerfile", "CMakeLists.txt", "Procfile", "justfile"})
_CONFIG_EXT = frozenset(
    {"json", "yaml", "yml", "toml", "ini", "env", "plist", "xcconfig", "conf", "cfg", "xml"}
)
_CONFIG_NAME = re.compile(r"\.config\.[cm]?[jt]s$")


def _ext(name: str) -> str:
    """The lowercased extension, `""` for none. A leading dot is a hidden file, not an
    extension (`.env` has none), the rule `languages.language_of` uses."""
    return name.rsplit(".", 1)[-1].lower() if "." in name[1:] else ""


def role_of(path: str) -> str:
    """The role of a file in the project, from its path shape only. First match wins.

    1. dependency: a lockfile or generated manifest (`languages.GENERATED_NAMES`) or a
       manifest (`shipped.MANIFESTS`);
    2. migration: under `migrations/`, `migration/`, `migrate/` or `alembic/`, or named
       like `0003_add_users.sql`;
    3. test: a test file name, or under `test/`, `tests/` or `__tests__/`;
    4. docs; 5. style; 6. build; 7. config;
    8. source: any language `languages.language_of` names;
    9. unknown.
    """
    norm = str(path or "").replace("\\", "/")
    name = posixpath.basename(norm)
    segs = {s.lower() for s in posixpath.dirname(norm).split("/") if s}
    ext = _ext(name)

    if name in languages.GENERATED_NAMES or name in shipped.MANIFESTS:
        return "dependency"
    if segs & _MIGRATION_SEGS or _MIGRATION_NAME.search(name):
        return "migration"
    if _TEST_NAME.search(name) or segs & _TEST_SEGS:
        return "test"
    if ext in _DOCS_EXT or segs & _DOCS_SEGS:
        return "docs"
    if ext in _STYLE_EXT:
        return "style"
    if name in _BUILD_NAMES or ext == "gradle" or ".github" in segs:
        return "build"
    if ext in _CONFIG_EXT or name.startswith(".") or _CONFIG_NAME.search(name):
        return "config"
    lang = languages.language_of(norm) if name else None
    if lang is not None and lang != "other":
        return "source"
    return "unknown"


_WORDS = (
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
    "twenty",
)

_ORDINAL_WORDS = (
    "first",
    "second",
    "third",
    "fourth",
    "fifth",
    "sixth",
    "seventh",
    "eighth",
    "ninth",
    "tenth",
)


def spoken(n: int) -> str:
    """0 to 20 as words ("six"), digits above ("34") and below zero."""
    n = int(n)
    return _WORDS[n] if 0 <= n < len(_WORDS) else str(n)


def ordinal(n: int) -> str:
    """1 to 10 as words ("third"), then digits with the suffix ("11th", "12th", "21st").

    Anything outside 1 to 10 takes the digit form, zero included ("0th"): a sentence
    template can be asked for it, and a crash would be worse than an odd word.
    """
    n = int(n)
    if 1 <= n <= len(_ORDINAL_WORDS):
        return _ORDINAL_WORDS[n - 1]
    if 10 <= abs(n) % 100 <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(abs(n) % 10, "th")
    return f"{n}{suffix}"


#: The dash characters: an em dash (U+2014), an en dash (U+2013), a horizontal bar
#: (U+2015) and a minus sign (U+2212). `run._dedash` rewrites exactly these. FOUND IN
#: REVIEW (2026-09-13): `run` held the four and this held two, so a bar or a minus sign
#: passed `has_dash` while `run` rewrote it. RECORDED: `mobile/src/live/sentence.ts` ports
#: the older two character rule and is out of bounds for this workflow.
DASH_CHARS: tuple[str, ...] = (chr(0x2014), chr(0x2013), chr(0x2015), chr(0x2212))

#: Any of `DASH_CHARS`, or a hyphen standing alone between spaces (` - ` or ` -- `), which is
#: a dash typed on a keyboard. A hyphen inside a word (`read-only`) or a flag (`--json`)
#: is not one.
DASH = re.compile("[" + "".join(DASH_CHARS) + r"]|\s-{1,2}\s")


def has_dash(text: str) -> bool:
    """Whether `text` carries a dash a person would read as one (`DASH`)."""
    return bool(DASH.search(text))


#: role -> (one file, several with `{n}`, the whole collection). Counts are spoken by the
#: caller through `spoken`, so `many.format(n=spoken(3))` reads "three test files".
ROLE_NOUN: dict[str, tuple[str, str, str]] = {
    "test": ("a test file", "{n} test files", "your test suite"),
    "source": ("a source file", "{n} source files", "the source code"),
    "config": ("a config file", "{n} config files", "the configuration"),
    "docs": ("a doc", "{n} docs", "the docs"),
    "migration": ("a database migration", "{n} database migrations", "the migrations"),
    "style": ("a stylesheet", "{n} stylesheets", "the styles"),
    "build": ("the build setup", "{n} build files", "the build setup"),
    "dependency": ("the dependency list", "{n} dependency files", "the dependencies"),
    "unknown": ("a file", "{n} files", "the project"),
}


# ------------------------------------------------------------------ rounding


def half_up(x: float, digits: int = 0, *, scale: int = 0) -> Decimal:
    """`x` times ten to the `scale`, rounded to `digits` places with a tie AWAY from zero.
    THE rounding rule for every number a person reads, here and on the phone
    (`mobile/src/copy/numbers.ts` `scaledHalfUp`, which is the same arithmetic).

    It reads the number as it is WRITTEN, its shortest `repr`, never the binary fraction
    under it, and it moves the decimal point in decimal (`scale`) rather than multiplying
    in binary. FOUND IN THE CAPTURE (2026-09-14): "18% of instructions landed clean" for
    a share sent as 0.185, where every other percentage rounds half up. `round(0.185 * 100)`
    is 18 twice over: a tie goes to the even digit, and 0.185 is stored a hair under itself.
    A person reads 18.5% and says 19%, and so does this.
    """
    x = float(x)
    if not math.isfinite(x):
        raise ValueError(f"cannot round {x!r}")
    d = Decimal(repr(x)).scaleb(scale)
    return d.quantize(Decimal(1).scaleb(-digits), rounding=ROUND_HALF_UP)


def rounded(x: float, digits: int | None = None) -> float | int:
    """`round(x, digits)` with `half_up`'s tie rule, for a number that travels to be read.
    The same types `round` gives: an int for `digits` None, an int given back as it is (a
    count rounded to places is still that count, so `0` never travels as `0.0`), else a
    float."""
    if isinstance(x, int) and not isinstance(x, bool):
        return x if digits is None or digits >= 0 else int(half_up(x, digits))
    if digits is None:
        return int(half_up(x))
    return float(half_up(x, digits))


def pct(share: float) -> str:
    """A share as a whole percent, "19%": `half_up` of the share times a hundred."""
    return f"{int(half_up(share, scale=2))}%"


__all__ = [
    "DASH",
    "DASH_CHARS",
    "ROLES",
    "ROLE_NOUN",
    "half_up",
    "has_dash",
    "ordinal",
    "pct",
    "role_of",
    "rounded",
    "spoken",
]
