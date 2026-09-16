"""The text the PLATFORM published about a link, and nothing else.

MEASURED 2026-09-15, against the live endpoints, because what these services actually hand an
anonymous caller is the whole design of this module:

  TikTok     `https://www.tiktok.com/oembed?url=...` answers with no key: the FULL caption as
             `title`, the handle, and a poster frame. yt-dlp is blocked ("Unexpected response
             from webpage request") for the same link in the same minute.
  YouTube    oEmbed answers with no key (title, channel, thumbnail), and yt-dlp additionally
             has the PUBLISHED subtitle tracks, which is the only place in this module real
             spoken words come from.
  Instagram  closed. The reel page serves a 625 KB app shell with zero `og:` tags to every
             crawler user agent tried (facebookexternalhit, Googlebot, WhatsApp, Twitterbot),
             and yt-dlp answers "Instagram sent an empty media response ... use
             --cookies-from-browser".

So the chain is oEmbed, then yt-dlp, then OpenGraph, then the share sheet's own text, and a
drop that reaches the end of it is `no_text` on the card with the character counts printed
beside the refusal. That is a true sentence about a closed platform and it is the one shown.

THE COOKIE DOOR IS SHUT BY DEFAULT AND IT IS NOT LOCKED. Setting `BUILDER_DROPS_COOKIES_FROM`
to a browser name hands yt-dlp that browser's cookies, which is how a person reads, on their
own machine, a post they are already logged in to and can already see. It is off unless it is
set, it is refused outright when `BUILDER_DROPS_SERVER_SIDE` is set (no server may ever do
this with somebody's session), and `python -m drops doctor` prints which door is open. The
alternative was pretending Instagram works.

NO VIDEO IS DOWNLOADED AND NO AUDIO IS TRANSCRIBED. `--skip-download` is on every yt-dlp call.
If the platform published no words, the drop has no words.
"""

from __future__ import annotations

import datetime as dt
import html
import json
import os
import re
import shutil
import subprocess
import urllib.error
import urllib.parse as up
import urllib.request

from . import urls as u
from .tables import RESOLVER

#: Given to every fetch. A real browser string would be a lie about what this is; this one
#: says what it is and carries the project's URL, which is what a well behaved reader does.
UA = "BuildaDrops/1 (+https://github.com/vedantlbhatt/builder)"
FETCH_TIMEOUT_S = 20
YT_DLP_TIMEOUT_S = 45
#: The caption of a reel is at most a few hundred words. A megabyte of HTML is an app shell.
MAX_HTML_BYTES = 2_000_000
#: Past this, the text is not a caption. The planner is handed the head of it and told so.
MAX_TEXT_CHARS = 12_000

#: oEmbed endpoints that answer an anonymous GET. Instagram's is absent on purpose: it exists,
#: it requires a Facebook app token, and an endpoint that 400s for everybody who has not made
#: a Meta developer account is not a path this reads as available.
OEMBED: dict[str, str] = {
    "tiktok": "https://www.tiktok.com/oembed?url={url}",
    "youtube": "https://www.youtube.com/oembed?format=json&url={url}",
}

#: A meta tag, WHOLE, and nothing across tags. The first version of this module matched
#: `<meta[^>]+?(?:property|name)=...[^>]*?content=["\'](.*?)["\']` in one pass and hung: on
#: Instagram's 625 KB app shell it ran 100% of a core for over four minutes before it was
#: killed, because two lazy quantifiers either side of an alternation over that much text is
#: catastrophic backtracking. Scan for the tags first, with a bound, then read attributes
#: inside each one. MEASURED after the fix: the same document in 40 ms.
META_TAG = re.compile(r"<meta\b[^>]{0,4000}>", re.IGNORECASE)
META_ATTR = re.compile(r'(?:property|name|content)\s*=\s*"([^"]{0,4000})"|(?:property|name|content)\s*=\s*\'([^\']{0,4000})\'', re.IGNORECASE)
META_PAIR = re.compile(r'([a-zA-Z:-]+)\s*=\s*(?:"([^"]{0,4000})"|\'([^\']{0,4000})\')')
#: The og keys worth reading. Anything else in the head is somebody's analytics.
OG_KEYS = ("og:title", "og:description", "og:image", "og:video:duration", "title", "description")

#: WebVTT: drop the header, the cue numbers, the timing lines and the inline karaoke tags.
VTT_NOISE = re.compile(r"^(WEBVTT|Kind:|Language:|NOTE\b|\d+$)|-->", re.MULTILINE)
VTT_TAGS = re.compile(r"</?[cvibu][^>]*>|<\d\d:\d\d:\d\d\.\d\d\d>")


class Resolved:
    """What one link published. The `DropSource` fields, plus the text nobody stores.

    `text` is the caption and the subtitles joined, and it is the ONLY thing the planner is
    given. It is not on the wire: `spec/drops.v1.json` carries the two character counts
    instead, so a card can say how much there was to read without the server holding a
    stranger's caption.
    """

    __slots__ = (
        "platform", "url", "author", "title", "thumbnail_url", "duration_s",
        "caption", "transcript", "resolver", "resolved_at", "notes",
    )

    def __init__(self, *, platform: str, url: str) -> None:
        self.platform = platform
        self.url = url
        self.author: str | None = None
        self.title: str | None = None
        self.thumbnail_url: str | None = None
        self.duration_s: int | None = None
        self.caption: str = ""
        self.transcript: str = ""
        self.resolver: str = "shared_text"
        self.resolved_at = dt.datetime.now(dt.UTC)
        self.notes: list[str] = []

    @property
    def text(self) -> str:
        """The caption and the subtitles, once each.

        The title and the caption are USUALLY THE SAME SENTENCE on TikTok, where oEmbed puts
        the whole caption in `title` and the wire's `title` is capped at 200 characters. So
        the first version of this joined a truncated copy to its own full text and handed the
        planner the same claim twice, which is exactly the shape a model reads as corroboration.
        Containment is checked BOTH WAYS and the longer one wins.
        """
        out: list[str] = []
        for part in (self.title or "", self.caption, self.transcript):
            p = part.strip()
            if not p:
                continue
            if any(p in kept for kept in out):
                continue
            out = [kept for kept in out if kept not in p]
            out.append(p)
        return "\n\n".join(out)[:MAX_TEXT_CHARS]

    def source_block(self) -> dict:
        """The `DropSource` the Mac uploads."""
        return {
            "platform": self.platform,
            "url": self.url,
            "author": _cap(self.author, 80),
            "title": _cap(self.title, 200),
            "thumbnail_url": _cap(self.thumbnail_url, 500),
            "duration_s": self.duration_s,
            "caption_chars": len(self.caption or self.title or ""),
            "transcript_chars": len(self.transcript),
            "resolver": self.resolver,
            "resolved_at": self.resolved_at.isoformat(),
        }


def _cap(s: str | None, n: int) -> str | None:
    if s is None:
        return None
    s = " ".join(str(s).split())
    return s[:n] or None


def _get(url: str, *, timeout: int = FETCH_TIMEOUT_S, max_bytes: int = MAX_HTML_BYTES) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en"})
    with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 (scheme checked in urls)
        return r.read(max_bytes)


def cookies_from() -> str | None:
    """The browser yt-dlp may borrow cookies from, or None. See the module docstring."""
    if os.environ.get("BUILDER_DROPS_SERVER_SIDE"):
        return None
    v = (os.environ.get("BUILDER_DROPS_COOKIES_FROM") or "").strip()
    return v or None


# ------------------------------------------------------------------------- oembed
def from_oembed(r: Resolved) -> bool:
    endpoint = OEMBED.get(r.platform)
    if not endpoint:
        return False
    try:
        raw = _get(endpoint.format(url=up.quote(r.url, safe="")), max_bytes=200_000)
        d = json.loads(raw)
    except (urllib.error.URLError, json.JSONDecodeError, OSError, ValueError) as e:
        r.notes.append(f"oembed:{type(e).__name__}")
        return False
    if not isinstance(d, dict) or not (d.get("title") or d.get("author_name")):
        return False
    # TikTok puts the WHOLE caption in `title`; YouTube puts the video's title there. Both are
    # "what the platform published as this post's words", which is what the field means.
    r.title = _cap(d.get("title"), 200)
    r.caption = " ".join(str(d.get("title") or "").split())
    r.author = _cap(d.get("author_name") or d.get("author_unique_id"), 80)
    thumb = d.get("thumbnail_url")
    r.thumbnail_url = thumb if isinstance(thumb, str) and thumb.startswith("https://") else None
    r.resolver = "oembed"
    return True


# ------------------------------------------------------------------------- yt-dlp
def have_yt_dlp() -> str | None:
    return shutil.which("yt-dlp")


def from_yt_dlp(r: Resolved) -> bool:
    """Metadata and PUBLISHED subtitles. Never the video."""
    exe = have_yt_dlp()
    if not exe:
        r.notes.append("yt_dlp:absent")
        return False
    cmd = [exe, "-J", "--no-warnings", "--skip-download", "--no-playlist",
           "--socket-timeout", "15", "--retries", "1"]
    browser = cookies_from()
    if browser:
        cmd += ["--cookies-from-browser", browser]
    cmd.append(r.url)
    try:
        proc = subprocess.run(
            cmd, capture_output=True, text=True, timeout=YT_DLP_TIMEOUT_S,
            stdin=subprocess.DEVNULL, check=False,
        )
    except subprocess.TimeoutExpired:
        r.notes.append("yt_dlp:timeout")
        return False
    if proc.returncode != 0:
        r.notes.append("yt_dlp:" + _yt_reason(proc.stderr))
        return False
    try:
        d = json.loads(proc.stdout)
    except json.JSONDecodeError:
        r.notes.append("yt_dlp:not_json")
        return False
    if not isinstance(d, dict):
        return False
    r.author = _cap(d.get("uploader") or d.get("channel") or d.get("uploader_id"), 80) or r.author
    title = _cap(d.get("title"), 200)
    desc = " ".join(str(d.get("description") or "").split())
    # yt-dlp's `title` for a TikTok IS the caption; for YouTube it is the title and the caption
    # is `description`. Keeping both and deduping in `text` is how one rule serves both.
    r.title = title or r.title
    if len(desc) > len(r.caption):
        r.caption = desc[:MAX_TEXT_CHARS]
    elif title and not r.caption:
        r.caption = title
    thumb = d.get("thumbnail")
    if isinstance(thumb, str) and thumb.startswith("https://"):
        r.thumbnail_url = thumb
    dur = d.get("duration")
    if isinstance(dur, (int, float)) and 0 < dur < 86400:
        r.duration_s = int(dur)
    r.transcript = _subtitles(d) or r.transcript
    r.resolver = "yt_dlp"
    return True


def _yt_reason(stderr: str) -> str:
    """One short code from yt-dlp's stderr. The stderr itself is never stored: it carries the
    URL, and on a cookies run it can carry a profile path."""
    s = (stderr or "").lower()
    for needle, code in (
        ("cookies", "login_required"),
        ("empty media response", "login_required"),
        ("private", "private"),
        ("unavailable", "gone"),
        ("not found", "gone"),
        ("unsupported url", "unsupported"),
        ("unexpected response", "blocked"),
        ("rate", "rate_limited"),
    ):
        if needle in s:
            return code
    return "failed"


def _subtitles(d: dict) -> str:
    """Published subtitles as plain text. The MANUAL track only.

    Automatic captions are a transcription the platform made, and reading them would make
    "Builda transcribes no audio" a distinction without a difference. They are also, on the
    kind of video this feature is for, wrong in exactly the places that matter: a package name
    said out loud comes back as three English words.
    """
    subs = d.get("subtitles")
    if not isinstance(subs, dict):
        return ""
    for lang in list(subs):
        if not str(lang).lower().startswith("en"):
            continue
        for fmt in subs[lang] if isinstance(subs[lang], list) else []:
            url = fmt.get("url") if isinstance(fmt, dict) else None
            ext = (fmt.get("ext") or "") if isinstance(fmt, dict) else ""
            if not (isinstance(url, str) and url.startswith("https://") and ext in ("vtt", "srt")):
                continue
            try:
                body = _get(url, max_bytes=400_000).decode("utf-8", "replace")
            except (urllib.error.URLError, OSError):
                continue
            return _vtt_text(body)
    return ""


def _vtt_text(body: str) -> str:
    lines: list[str] = []
    for raw in body.splitlines():
        line = VTT_TAGS.sub("", raw).strip()
        if not line or VTT_NOISE.match(line):
            continue
        # Subtitles repeat the previous cue's last line while the next one scrolls in.
        if lines and lines[-1] == line:
            continue
        lines.append(line)
    return " ".join(lines)[:MAX_TEXT_CHARS]


# --------------------------------------------------------------------- opengraph
def meta_tags(body: str) -> dict[str, str]:
    """Every `<meta>` in a document as {key: content}, first occurrence wins."""
    out: dict[str, str] = {}
    for tag in META_TAG.finditer(body):
        attrs: dict[str, str] = {}
        for m in META_PAIR.finditer(tag.group(0)):
            attrs[m.group(1).lower()] = m.group(2) if m.group(2) is not None else (m.group(3) or "")
        key = (attrs.get("property") or attrs.get("name") or "").lower()
        if key in OG_KEYS and "content" in attrs:
            out.setdefault(key, html.unescape(attrs["content"]))
    return out


def from_opengraph(r: Resolved) -> bool:
    try:
        body = _get(r.url).decode("utf-8", "replace")
    except (urllib.error.URLError, OSError) as e:
        r.notes.append(f"og:{type(e).__name__}")
        return False
    tags = meta_tags(body)
    title = _cap(tags.get("og:title") or tags.get("title"), 200)
    desc = _cap(tags.get("og:description") or tags.get("description"), MAX_TEXT_CHARS)
    if not title and not desc:
        r.notes.append("og:no_tags")
        return False
    r.title = title or r.title
    if desc and len(desc) > len(r.caption):
        r.caption = desc
    img = tags.get("og:image")
    if isinstance(img, str) and img.startswith("https://"):
        r.thumbnail_url = img
    r.resolver = "opengraph"
    return True


# ------------------------------------------------------------------------- entry
def resolve(shared: str, *, shared_text: str = "") -> Resolved:
    """A share sheet's payload into everything that could be read from it.

    Raises `urls.UrlRefused` when the link is not one. Never raises for a link that simply
    gave nothing: that case comes back with `resolver == "shared_text"` and empty text, and
    the caller turns it into the `no_text` refusal.
    """
    url, plat = u.normalize(shared)
    r = Resolved(platform=plat, url=url)
    if shared_text:
        r.caption = " ".join(shared_text.split())[:MAX_TEXT_CHARS]

    # Order is by what costs least and lies least: a published oEmbed document beats a
    # subprocess beats parsing somebody's HTML. Each step only runs if the one before it did
    # not already produce words, EXCEPT yt-dlp on YouTube, which adds the subtitles oEmbed has
    # no field for.
    got = from_oembed(r)
    if not got or (r.platform == "youtube" and not r.transcript):
        from_yt_dlp(r)
    if not r.text.strip():
        from_opengraph(r)
    return r


def refusal_for(r: Resolved) -> str | None:
    """The spec's `drop_refusal` when there is nothing to plan from, else None."""
    if r.text.strip():
        return None
    if any(n.endswith(("login_required", "private")) for n in r.notes):
        return "private_or_gone"
    if any(n.endswith("gone") for n in r.notes):
        return "private_or_gone"
    return "no_text"


assert set(OEMBED) <= set(RESOLVER) | {"tiktok", "youtube"}, "unreachable; keeps the import honest"
