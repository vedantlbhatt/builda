"""Is this a link Builda can read, and what does it look like with the tracking gone.

THE DOOR IS HERE, not in the resolver. A URL arrives from a share sheet, which means it
arrives from whatever app the person was in, which means it is a string a stranger's product
composed. Everything downstream (a subprocess argument, an HTTP fetch, a row in Postgres)
treats it as a URL, so the one place that decides it IS one is this module.

WHY AN ALLOWLIST OF SCHEMES AND NOT A DENYLIST. `javascript:`, `data:`, `file:` and
`chrome-extension:` are the ones anybody thinks of; the one that matters is that a denylist
has to be complete forever and an allowlist has to be right once. Two schemes pass: https,
and http only so that the normaliser can UPGRADE it and hand back https.

`www.` IS NOT NOISE, AND REMOVING IT BREAKS THE READERS. MEASURED 2026-09-15: the first version
of this module lowercased the host and dropped `www.`, which turns a working TikTok link into
`https://tiktok.com/@user/video/123`. TikTok's own oEmbed endpoint answers HTTP 400 for that
form, and yt-dlp reports `unsupported url` for it, so a normaliser written to make two shares of
one reel the same card silently made every TikTok unreadable and the card said `no_text`. The
host is canonicalised to the form the PLATFORM itself publishes (`CANONICAL_HOST`), never to the
shortest one that still resolves in a browser. Short link hosts (`vm.tiktok.com`, `youtu.be`,
`redd.it`) are left exactly as they are: they are different URLs, not prettier ones.

WHAT IS STRIPPED, AND WHY IT IS NOT COSMETIC. Instagram's `?igsh=`, TikTok's `?_t=` and
`?_r=`, and every `utm_*` are the SHARER'S id: they identify the person who sent the link and
they change on every share. Left in, the same reel shared twice is two rows on the board and
two runs of the planner; stripped, the normalised URL is the natural key, and the second share
of the same reel lands on the card that is already there.
"""

from __future__ import annotations

import re
import urllib.parse as up

from .tables import PLATFORM

#: Longer than any real reel link and short enough that no column has to think about it.
MAX_URL = 500

#: host suffix -> the spec's `platform`. Order matters only in that the first match wins, and
#: no two suffixes here overlap. Anything not listed resolves to `web`, which is a platform
#: with OpenGraph tags and nothing else, not a refusal.
HOSTS: tuple[tuple[str, str], ...] = (
    ("instagram.com", "instagram"),
    ("instagr.am", "instagram"),
    ("tiktok.com", "tiktok"),
    ("youtube.com", "youtube"),
    ("youtu.be", "youtube"),
    ("twitter.com", "x"),
    ("x.com", "x"),
    ("reddit.com", "reddit"),
    ("redd.it", "reddit"),
    ("threads.net", "threads"),
    ("threads.com", "threads"),
)

#: Query parameters that identify the SHARER rather than the post. `igsh` and `igshid` are
#: Instagram's, `_t`/`_r` are TikTok's, `si` is YouTube's, `s`/`t` are X's, `share_id` and
#: `context` are Reddit's. Every `utm_*` goes too, by prefix.
SHARE_PARAMS = frozenset(
    {
        "igsh", "igshid", "_t", "_r", "_d", "si", "s", "t", "share_id", "context",
        "fbclid", "gclid", "feature", "app", "is_from_webapp", "sender_device",
    }
)
UTM = "utm_"

#: The host each platform publishes its own links as. Applied only when the link is already on
#: one of that platform's main domains, so a short link keeps its own host and is followed by
#: the resolver rather than rewritten by a guess here.
CANONICAL_HOST: dict[str, str] = {
    "instagram.com": "www.instagram.com",
    "tiktok.com": "www.tiktok.com",
    "youtube.com": "www.youtube.com",
    "twitter.com": "x.com",
    "x.com": "x.com",
    "reddit.com": "www.reddit.com",
    "threads.net": "www.threads.com",
    "threads.com": "www.threads.com",
}

#: A URL is not a sentence. A share sheet often hands over "look at this <url>", so the first
#: thing that looks like a link is taken and the rest is kept as the shared text.
#: Brackets count when they are balanced, so a Wikipedia link inside text is one link and
#: `(https://x.com/a)` is the link without the bracket (the phone's `urls.ts` has the same pattern).
URL_IN_TEXT = re.compile(r"https?://(?:[^\s<>\"'()\]]|\([^\s<>\"'()]*\))+", re.IGNORECASE)


class UrlRefused(ValueError):
    """The link cannot be read. Carries the spec's refusal code, never prose."""

    def __init__(self, code: str, detail: str = "") -> None:
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code


def first_url(text: str) -> str | None:
    """The first link in a blob of shared text, or None."""
    m = URL_IN_TEXT.search(text or "")
    return m.group(0).rstrip(".,;:") if m else None


def platform_of(host: str) -> str:
    """The spec's platform for a host. Never raises: an unknown host is `web`."""
    h = (host or "").lower().removeprefix("www.").removeprefix("m.").removeprefix("vm.")
    for suffix, name in HOSTS:
        if h == suffix or h.endswith("." + suffix):
            return name
    return "web"


def normalize(raw: str) -> tuple[str, str]:
    """(normalised url, platform). Raises UrlRefused with a spec code.

    Normalising is what makes the same reel shared twice one card: the scheme is forced to
    https, the host is lowercased and stripped of `www.`/`m.`, the sharer's parameters go, the
    remaining query is sorted, and a fragment is dropped (no platform routes on one).
    """
    s = (raw or "").strip()
    if not s:
        raise UrlRefused("url_unsupported", "empty")
    if len(s) > MAX_URL:
        raise UrlRefused("url_unsupported", f"{len(s)} chars")
    if "://" not in s:
        # A bare "instagram.com/reel/..." is a link a person would call a link.
        s = "https://" + s
    parts = up.urlsplit(s)
    if parts.scheme.lower() not in ("http", "https"):
        raise UrlRefused("url_unsupported", parts.scheme.lower())
    host = (parts.hostname or "").lower()
    if not host or "." not in host:
        raise UrlRefused("url_unsupported", "no host")
    # A userinfo section (`https://evil.com@instagram.com/`) is how a link is made to read as
    # one host and resolve to another. Nothing legitimate shares one.
    if "@" in parts.netloc:
        raise UrlRefused("url_unsupported", "userinfo")
    plat = platform_of(host)
    bare = host.removeprefix("www.").removeprefix("m.")
    # Canonical only for a platform's OWN domain. `vm.tiktok.com` and `youtu.be` are not
    # `www.tiktok.com` and `www.youtube.com`; rewriting them would 404.
    host = CANONICAL_HOST.get(bare, host)
    keep = [
        (k, v)
        for k, v in up.parse_qsl(parts.query, keep_blank_values=False)
        if k not in SHARE_PARAMS and not k.startswith(UTM)
    ]
    query = up.urlencode(sorted(keep))
    path = parts.path.rstrip("/") or "/"
    port = f":{parts.port}" if parts.port not in (None, 80, 443) else ""
    return up.urlunsplit(("https", host + port, path, query, "")), plat


def split_share(payload: str) -> tuple[str, str]:
    """A share sheet's payload into (url, the text around it).

    iOS hands a share extension an attributed string, and what lands in it depends on the app
    the person shared FROM: TikTok sends the caption and then the link, Instagram sends the
    link alone. Both are handled here so the runner sees one shape.
    """
    text = (payload or "").strip()
    found = first_url(text)
    if not found:
        raise UrlRefused("url_unsupported", "no link in the shared text")
    rest = (text.replace(found, " ", 1)).strip()
    return found, " ".join(rest.split())


assert set(p for _, p in HOSTS) <= set(PLATFORM), "HOSTS names a platform the spec lacks"
