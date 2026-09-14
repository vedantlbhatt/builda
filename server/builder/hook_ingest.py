"""Cut a hook-delivered transcript into sessions with the uploader's own pipeline.

The hook channel (docs/hooks-capture.md) is the zero-install path: Claude Code POSTs the
transcript itself. Everything after that is `python -m capture` running on the server
instead of on the machine — the same record loader, the same v3 sessionizer, the same
payload builder — so a session that arrives by hook and the same session synced later by
capture or by the Mac produce ONE row: `client_session_id` is derived from the first
event with the machine slot fixed to ``capture`` (capture/identity.py), whatever machine
did the cutting.

A session the cut leaves LIVE also gets its live state (contract v4 `live`,
spec/live.v1.json), computed here by `analysis/live.py` from the same bytes, the way
`capture sync --live` computes it on a machine without hooks
(docs/overnight-integration.md 3.1). Everything else the payload carries, `feedback`
included, is `capture.sessions.build_payload`'s, the one payload builder both channels
share.

`capture/`, `analysis/` and `scripts/measure_boundaries.py` live at the repository root.
The repo-root Dockerfile copies them next to `server/`; in a checkout the root is two
levels up. Imported lazily so the server still boots — and `/health` still answers —
without them; only this channel is then unavailable, and it says so.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
import inspect
import pathlib
import sys
import tempfile
import time

_ROOT = pathlib.Path(__file__).resolve().parents[2]

#: `client_version` on hook-fed payloads. The engine's stamps are semver; this names the
#: channel so a row's origin is visible in the database.
HOOK_CLIENT_VERSION = "hook/1"


class CaptureUnavailable(RuntimeError):
    """The sessionizer is not importable on this server (server-only image)."""


@dataclasses.dataclass(frozen=True)
class LiveContext:
    """What a live state needs from the account, built once per request by routes/ingest.py.

    `history` is `builder_profile.eta_history(db, user)`: the stored finished sessions,
    keyed by `repo_hash`, or None when `analysis/` is not deployed (the ETA then refuses
    `no_history` rather than counting zero sessions). `salt` is `privacy_prefs.map_salt`,
    which never leaves the server. `names` is `privacy_prefs.live_names`: without it no
    basename is computed at all, so none can be stored.
    """

    history: list | None
    salt: str
    names: bool


@dataclasses.dataclass(frozen=True)
class Cut:
    """One visible session of a transcript: its contract payload and, for a live session
    whose state was computed, the two things the uploader's terminal prints."""

    payload: dict
    #: `live.sentence(state)`, the names=False sentence. The uploader holds the transcript
    #: already, so this goes back to it in the ingest response and is stored nowhere.
    sentence: str | None = None
    #: The wire `needs_you` block, `{score, reason}`.
    needs_you: dict | None = None


def _repo_root_on_path() -> None:
    root = str(_ROOT)
    if root not in sys.path:
        sys.path.insert(0, root)


def _capture():
    try:
        import capture.sessions  # noqa: F401
    except ImportError:
        _repo_root_on_path()
    try:
        from capture import identity, sessions
        from capture.discover import Transcript
    except ImportError as e:  # pragma: no cover - deployment shape, not logic
        raise CaptureUnavailable(str(e)) from e
    return identity, sessions, Transcript


def live_engine():
    """`analysis.live` when the deployed engine writes spec/live.v1.json, else None.

    The spec shape is recognisable by what it added: `capture.sessions.attach_live` and
    `live.session_state` (the one place a cut sitting becomes a live state, shared with
    `capture sync --live`), `live.wire_names` and `live_state(repo_key=...)`. An older
    engine computes a state the door would refuse, and the door refuses the whole payload,
    so the session itself would never be stored. With None the channel computes no live
    block, exactly as a producer that does not compute one: the session is stored and its
    live row is left alone.
    """
    try:
        _, sessions, _ = _capture()  # analysis.live imports capture; both sit at the root
        from analysis import live as lv
    except (ImportError, CaptureUnavailable):  # pragma: no cover - deployment shape
        return None
    if not all(hasattr(lv, f) for f in ("session_state", "wire", "wire_names")):
        return None
    if not hasattr(sessions, "attach_live"):
        return None
    if "repo_key" not in inspect.signature(lv.live_state).parameters:
        return None
    return lv


def cut(
    raw: bytes,
    *,
    native_session_id: str,
    project_dir: str,
    tz_offset_minutes: int,
    finalize: bool,
    device_id: str,
    now: float | None = None,
    live: LiveContext | None = None,
) -> list[Cut]:
    """Every visible session in one transcript's bytes, with a live state for each one the
    cut leaves live when `live` is given and the engine can compute one.

    `finalize` is true for `SessionEnd`: Claude Code is exiting, so an open session is
    closed now. For every other hook the idle rule decides — a `Stop` is the end of a
    turn, not of a sitting, and the person may type again. A transcript whose last record
    is already older than the idle threshold comes back final either way, which is how a
    session whose process was killed without a `SessionEnd` still finishes: the next hook
    from any session re-cuts the stale ones (routes/ingest.py).

    `now` is the server's clock, and it matters for the live state: an empty heartbeat
    tail re-cuts at a later `now`, so "idle" and "waiting on you for N minutes" advance
    with no new bytes. The live block is attached AFTER `build_payload` hashed the
    payload, so `content_hash` stays the hash of the payload without it
    (docs/overnight-integration.md 3.2): the block moves with the clock, not the bytes.
    """
    identity, sessions, Transcript = _capture()
    now = time.time() if now is None else now
    tz = dt.timezone(dt.timedelta(minutes=tz_offset_minutes))
    lv = live_engine() if live is not None else None
    with tempfile.TemporaryDirectory(prefix="builder-hook-") as tmp:
        pdir = pathlib.Path(tmp) / project_dir
        pdir.mkdir()
        path = pdir / f"{native_session_id}.jsonl"
        path.write_bytes(raw)
        src = sessions.load_source(Transcript(project_dir=project_dir, path=path))
        cuts = sessions.sessionize_sources([src], tz, now=now, finalize_open=finalize)
        # The device is the capture key's own row; the payload's machine id only has to
        # be a stable sha256 per device (contract), never the server's identity.
        machine = identity.machine_id(f"builder-hook-device|{device_id}")
        out: list[Cut] = []
        for s in cuts:
            p = sessions.build_payload(s, tz, machine, HOOK_CLIENT_VERSION, now)
            if not p["visible"]:
                continue
            if lv is None or s.state != "live":
                out.append(Cut(p))
                continue
            # `capture.sessions.attach_live`, the one place a live payload gains its block
            # (and, only with names on, `live_names`), shared with `capture sync --live`;
            # after `build_payload` hashed it. Inside the temporary directory: the state
            # reads the transcript for its usage and its background tasks. `repo_key` is
            # the payload's repo_hash, because the server keys stored sessions
            # (`builder_profile.eta_history`) by it while map paths are relative to the
            # checkout; on Railway a hook's cwd does not exist, so there is no repo_hash and
            # the ETA refuses `repo_unresolved`.
            st = sessions.attach_live(
                p,
                s,
                now=now,
                history=live.history,
                salt=live.salt,
                repo_key=p.get("repo_hash"),
                names=live.names,
            )
            out.append(Cut(p, sentence=st.get("sentence"), needs_you=p["live"].get("needs_you")))
        return out


def payloads_for(
    raw: bytes,
    *,
    native_session_id: str,
    project_dir: str,
    tz_offset_minutes: int,
    finalize: bool,
    device_id: str,
    now: float | None = None,
    live: LiveContext | None = None,
) -> list[dict]:
    """Contract payloads for every visible session in one transcript's bytes (`cut`
    without the terminal's two fields)."""
    return [
        c.payload
        for c in cut(
            raw,
            native_session_id=native_session_id,
            project_dir=project_dir,
            tz_offset_minutes=tz_offset_minutes,
            finalize=finalize,
            device_id=device_id,
            now=now,
            live=live,
        )
    ]
