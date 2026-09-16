"""Fetch every source URL before anybody is offered a button that installs it.

THE WHOLE POINT OF THIS MODULE IS THAT A MODEL CANNOT DO IT. A plausible `owner/repo` is the
single most convincing wrong answer a planner can produce: it is correctly shaped, it reads as
research, and it 404s at the moment somebody has already decided to trust it. So no move that
names a source is shown until this module has asked the network whether that source is there.

WHAT COUNTS AS VERIFIED. The URL answered 200, and for the registries, the registry's own API
agrees the package exists. GitHub is checked through `api.github.com/repos/<ref>` rather than
the HTML page, because github.com answers 200 with a "not found" page for some shapes and the
API answers 404 honestly. npm, PyPI and crates.io have the same distinction and are checked the
same way.

WHAT A FAILURE DOES. It does NOT delete the move. The move stays, with `source` kept and
`verification.refusal = source_unverified`, and the phone draws it as a lead rather than as an
install button: you can still open the link, you are not offered a one tap install of something
that is not there. Deleting it would hide the one fact worth knowing, which is that the
creator's own link is dead.

NO REDIRECT IS FOLLOWED OFF THE HOST IT STARTED ON without being recorded, and nothing is ever
executed. This module makes GET requests and reads status codes.
"""

from __future__ import annotations

import datetime as dt
import json
import re
import urllib.error
import urllib.parse as up
import urllib.request

UA = "BuildaDrops/1 (+https://github.com/vedantlbhatt/builder)"
TIMEOUT_S = 15
#: A registry document is not small. MEASURED: PyPI's `yt-dlp` JSON carries every release and
#: ran past a 200 KB read, so the truncated body failed to parse and a package that plainly
#: exists came back `source_unverified` with an HTTP 200 beside it. A cut off answer is not a
#: negative answer, which is the rule `_registry_agrees` now follows as well as the size here.
MAX_BYTES = 8_000_000

#: Registry APIs that answer honestly. `{ref}` is the move's own `ref`, percent encoded per
#: registry: npm scopes use `%2f`, PyPI and crates.io take the bare name.
REGISTRY: dict[str, str] = {
    "github": "https://api.github.com/repos/{ref}",
    "npm": "https://registry.npmjs.org/{ref_npm}",
    "pypi": "https://pypi.org/pypi/{ref}/json",
    "cargo": "https://crates.io/api/v1/crates/{ref}",
    "homebrew": "https://formulae.brew.sh/api/formula/{ref}.json",
}


def _status(url: str) -> tuple[int | None, bytes, bool]:
    """(status, body, truncated). `truncated` is what keeps a big document from reading as a
    missing one: the caller must not conclude "the registry disagrees" from bytes it cut."""
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:  # noqa: S310
            body = r.read(MAX_BYTES + 1)
    except urllib.error.HTTPError as e:
        return e.code, b"", False
    except (urllib.error.URLError, OSError, ValueError):
        return None, b"", False
    if len(body) > MAX_BYTES:
        return r.status, body[:MAX_BYTES], True
    return r.status, body, False


def check(source: dict) -> dict:
    """A `MoveVerification` for one source. Never raises."""
    now = dt.datetime.now(dt.UTC).isoformat()
    kind = source.get("source_kind")
    ref = str(source.get("ref") or "")
    url = str(source.get("url") or "")
    out = {"state": "unverified", "found_by": None, "http_status": None,
           "checked_at": now, "refusal": "source_unverified"}

    api = REGISTRY.get(kind or "")
    if api and ref:
        probe = api.format(ref=up.quote(ref, safe="/"), ref_npm=up.quote(ref, safe=""))
        code, body, truncated = _status(probe)
        out["http_status"] = code
        if code == 200 and _registry_agrees(kind, ref, body):
            out.update(state="verified", refusal=None)
            return out
        # A registry that said no is a no, even if the page URL happens to render. A body this
        # reader cut short is not a no, and falls through to the page check below.
        if code is not None and not truncated:
            return out

    if url.startswith("https://"):
        code, _, _ = _status(url)
        out["http_status"] = code
        if code == 200:
            out.update(state="verified", refusal=None)
    return out


def _registry_agrees(kind: str | None, ref: str, body: bytes) -> bool:
    """The registry's document is ABOUT the package that was asked for.

    A 200 from a registry is not enough on its own: npm answers 200 with a redirect document
    for a name that was unpublished, and Homebrew's API serves a JSON array for a query that
    matched nothing. Reading one field costs nothing and closes both.
    """
    if not body:
        return False
    try:
        d = json.loads(body)
    except json.JSONDecodeError:
        return False
    want = ref.lower()
    if kind == "github":
        return isinstance(d, dict) and str(d.get("full_name", "")).lower() == want
    if kind == "npm":
        return isinstance(d, dict) and str(d.get("name", "")).lower() == want
    if kind == "pypi":
        info = d.get("info") if isinstance(d, dict) else None
        # PEP 503: `-`, `_` and `.` runs are one separator and case does not count, so
        # `zope.interface`, `Zope_Interface` and `zope-interface` are one project.
        return isinstance(info, dict) and _pep503(str(info.get("name", ""))) == _pep503(want)
    if kind == "cargo":
        crate = d.get("crate") if isinstance(d, dict) else None
        return isinstance(crate, dict) and str(crate.get("name", "")).lower() == want
    if kind == "homebrew":
        if isinstance(d, list):
            d = d[0] if d else {}
        return isinstance(d, dict) and str(d.get("name", "")).lower() == want
    return True


def _pep503(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def verify_plan(plan: dict) -> dict:
    """Check every move that has a source. Returns counts for the CLI."""
    counts = {"checked": 0, "verified": 0, "unverified": 0}
    for move in plan.get("moves") or []:
        src = move.get("source")
        if not src:
            continue
        prior = move.get("verification") or {}
        v = check(src)
        v["found_by"] = prior.get("found_by")
        move["verification"] = v
        counts["checked"] += 1
        counts["verified" if v["state"] == "verified" else "unverified"] += 1
    return counts
