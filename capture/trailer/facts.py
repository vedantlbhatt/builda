"""What a trailer may show about a project, gathered on the Mac (docs/trailers.md).

Every word and number in a trailer comes from here or from its owner, never from the renderer and
never from a model's imagination. So this gathers only what the project gave:

  the demo      its recording, its stills and each beat's label and tap (`capture demo`), and the
                device row it was filmed on, read through the ship kit's own loader
  the numbers   measured from git over the demo commit's own ancestry (the ship kit's changelog
                rule): its commits, the days they landed on (04:00 local, `DAY_BOUNDARY_HOUR`, the
                one day boundary), and the commits since the last demo when there WAS one. Hours and
                sessions only when the owner hands over the project's report (`--report`), because
                the Mac's transcripts are the only honest source of them and this does not re-read
                them
  the calendar  the last twelve weeks of days, each a level from the commits that landed on it
  the words     the title (typed by the owner, a name they allow on screen, or the build post's
                what, checked for repository names like every caption and label), the line under it
                and the end card's line, each marked with where it came from

A number carries the words it is said with (`unit`), written here once, so the renderer never
composes a phrase. "Since the last demo" is said only when there was a last demo (the ship kit's
first MDN kit claimed 30 commits since a demo that never existed).
"""

from __future__ import annotations

import datetime as dt
import pathlib
import subprocess

from capture.tuning import DAY_BOUNDARY_HOUR

from . import tables

#: How many weeks the calendar scene shows: a quarter, as the Projects tab's rivers do.
WEEKS = 12
#: A day's level from the commits that landed on it: 1, 2 to 3, 4 to 6, 7 to 11, 12 or more. An
#: UNMEASURED JUDGEMENT CALL (the contribution graph's own buckets are hours, which git cannot see);
#: it only decides how dense a day's pixels print, never a number on screen.
LEVELS = (1, 2, 4, 7, 12)
#: The title when nothing else may be said: no name, no build post.
FALLBACK_TITLE = "What I built"


def _git(src: pathlib.Path, *args: str) -> str:
    r = subprocess.run(["git", "-C", str(src), *args], capture_output=True, text=True, timeout=60, check=False)
    return r.stdout if r.returncode == 0 else ""


def commit_times(src: pathlib.Path | None, until: str) -> list[int]:
    """Commit times (unix seconds) of `until` and its ancestry, merges included: a merge is a day's
    work landing too."""
    if src is None or not (src / ".git").exists():
        return []
    return [int(x) for x in _git(src, "log", "--format=%ct", until).split() if x.isdigit()]


def local_day(ts: int, tz: dt.tzinfo | None = None) -> dt.date:
    """The Builda day a moment falls on: the local date, the day turning at 04:00."""
    local = dt.datetime.fromtimestamp(ts, tz or dt.datetime.now().astimezone().tzinfo)
    return (local - dt.timedelta(hours=DAY_BOUNDARY_HOUR)).date()


def level(n: int) -> int:
    return sum(1 for edge in LEVELS if n >= edge)


def calendar(times: list[int], today: dt.date, tz: dt.tzinfo | None = None, weeks: int = WEEKS) -> dict | None:
    """The last `weeks` weeks through `today`, Monday first, a level a day (pure). None with no
    commit in them: an empty calendar is not a scene."""
    start = today - dt.timedelta(days=today.weekday()) - dt.timedelta(weeks=weeks - 1)
    counts: dict[dt.date, int] = {}
    for t in times:
        d = local_day(t, tz)
        if start <= d <= today:
            counts[d] = counts.get(d, 0) + 1
    if not counts:
        return None
    days = (today - start).days + 1
    levels = [level(counts.get(start + dt.timedelta(days=i), 0)) for i in range(days)]
    first = min(local_day(t, tz) for t in times)
    return {"levels": levels, "since": f"since {first.strftime('%b').lower()} {first.day}"}


def fmt(n: int) -> str:
    return f"{n:,}"


def number(value: int, unit: str) -> dict:
    return {"value": value, "text": fmt(value), "unit": unit}


def git_numbers(times: list[int], since_count: int | None, tz: dt.tzinfo | None = None) -> dict:
    """The numbers git can vouch for (pure over the commit times)."""
    out: dict[str, dict] = {}
    if times:
        out["commits"] = number(len(times), "commits" if len(times) != 1 else "commit")
        days = len({local_day(t, tz) for t in times})
        out["days_built"] = number(days, "days built" if days != 1 else "day built")
    if since_count:
        out["commits_since"] = number(since_count, "commits since the last demo" if since_count != 1 else "commit since the last demo")
    return out


def report_numbers(project: dict | None) -> dict:
    """Hours and sessions from the project's block of the owner's report (`python -m analysis report
    --json`, the `projects.projects[]` entry for this key), history scope: every sitting the Mac holds."""
    if not project:
        return {}
    h = project.get("history") or {}
    out: dict[str, dict] = {}
    if isinstance(h.get("sessions"), int) and h["sessions"] > 0:
        out["sessions"] = number(h["sessions"], "sessions" if h["sessions"] != 1 else "session")
    secs = h.get("attended_seconds")
    if isinstance(secs, (int, float)) and secs >= 3600:
        hours = int(secs // 3600)
        out["hours"] = number(hours, "hours with you there" if hours != 1 else "hour with you there")
    return out


def beats_from(demo) -> list[dict]:
    """The demo's beats as the renderer reads them: recording seconds, the tap as a fraction of the
    screen, when the screen reacted, and the beat's label (the words the demo's privacy check read)."""
    out = []
    for b in demo.capture.get("timeline") or []:
        try:
            start, end = float(b["start"]), float(b["end"])
        except (KeyError, TypeError, ValueError):
            continue
        tap = b.get("tap")
        out.append({
            "start": start,
            "end": end,
            "tap": [float(tap[0]), float(tap[1])] if tap else None,
            "change": float(b["change"]) if b.get("change") is not None else None,
            "label": (b.get("caption") or b.get("label") or None),
        })
    return out


def choose_title(*, typed: str | None, allowed: tuple[str, ...], shipped: dict | None, leaks) -> dict:
    """The title and where it came from: typed, else an allowed public name, else the build post's
    what when it names no repository (`leaks` is privacy.label_leaks bound to this Mac's names)."""
    if typed and typed.strip():
        return {"text": typed.strip()[: tables.MAX_LENGTHS["title"]], "source": "person"}
    if allowed:
        return {"text": allowed[0][: tables.MAX_LENGTHS["title"]], "source": "person"}
    what = (shipped or {}).get("what")
    if what and not leaks([what]):
        return {"text": what[: tables.MAX_LENGTHS["title"]], "source": "model"}
    return {"text": FALLBACK_TITLE, "source": "facts"}


def gather(demo, *, src: pathlib.Path | None, hue: str, creature: str, title: dict, line: dict | None = None,
           cta: dict | None = None, changelog: list[dict] | None = None, since_last_demo: bool = False,
           report_project: dict | None = None, languages: list[dict] | None = None,
           today: dt.date | None = None, tz: dt.tzinfo | None = None) -> dict:
    """The facts document the renderer reads (trailer/src/env.js)."""
    times = commit_times(src, demo.commit)
    log = changelog or []
    numbers = git_numbers(times, len(log) if since_last_demo else None, tz)
    numbers.update(report_numbers(report_project))
    today = today or local_day(int(dt.datetime.now().timestamp()), tz)
    stills = [{"file": str(demo.dir / a["file"]), "label": a.get("label")} for a in demo.stills]
    return {
        "version": tables.TRAILER_VERSION,
        "project_key": demo.key,
        "title": title,
        "line": line,
        "cta": cta,
        "hue": hue,
        "creature": creature,
        "demo": {
            "device": demo.device["id"] if demo.device else None,
            "video": str(demo.video) if demo.video else None,
            "beats": beats_from(demo) if demo.video else [],
            "stills": stills,
        },
        "numbers": numbers,
        "days": calendar(times, today, tz),
        "changelog": [c["subject"] for c in log][:12],
        "since_last_demo": bool(since_last_demo and log),
        "languages": languages or [],
    }
