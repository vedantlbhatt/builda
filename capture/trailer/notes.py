"""The phone's notes on a trailer, answered on this Mac (docs/trailers.md): claim, read, cut, render,
publish, finish.

The server holds the conversation (routes/trailer.py); this is the Mac's half of it, run by the one
worker (`python -m capture demo watch`) before it looks at the demo queue, because a note is a
render of a few minutes and the owner is looking at the phone for its answer, where a demo is a
film of half an hour nobody is waiting on.

    POST /v1/trailer/notes:claim          up to five, oldest first, each exactly once
    ...the note is read (direct.answer), the new cut rendered, the kit published when allowed...
    POST /v1/trailer/notes/{id}:finish    done with the version and the changes as codes, or
                                          failed with a refusal code; never a sentence

A project with no trailer yet is cut first (make.cut_for), and the note is read against that
first cut: "make a trailer" is answered with version one, "make a trailer, orange" with version one
in orange. The answer's `from_version` is then null, which is how the phone knows to say it is the
first.

PUBLISHING. A note makes a new trailer on this Mac; the phone sees it once the kit is published
with it, and the kit's publish is the ship kit's own (`demo kit --publish --yes`: the same listing,
the same second privacy read, the trailer's words read once more). The worker publishes only when
it was started with `--publish-requests`, the yes the owner gives on the Mac for everything the
phone asks for. Without it the note still finishes done, and the phone says the version is on the
Mac. A publish that fails does not fail the note: the version was made.
"""

from __future__ import annotations

import json
import pathlib
import re
import subprocess
import sys
from collections.abc import Callable

from capture.demo import privacy
from capture.demo.result import CaptureError

from . import cut as cutmod
from . import direct, make, render, tables

#: The notes that ask for a trailer and nothing else: answered with the first cut as it is.
MAKE_ONE = re.compile(r"^\W*(please\s+)?((make|cut|create|do|give\s+me|render)\s+)?(me\s+)?(a|the|my)?\s*(first\s+)?trailer\W*$", re.I)
#: A publish is the ship kit's (videos and stills), so its ceiling is the kit's.
PUBLISH_TIMEOUT = 20 * 60


class Notes:
    """The owner's notes, through the paired Mac's credentials (the demo requests' client)."""

    def __init__(self, server: str):
        from capture.client import Client

        self.client = Client(server)

    def _call(self, method: str, path: str, body: dict | None = None) -> dict:
        from capture.client import HTTPFailure

        status, parsed = self.client._authorized(method, path, body if body is not None else ({} if method == "POST" else None))
        if not 200 <= status < 300:
            raise HTTPFailure(status, json.dumps(parsed))
        return parsed

    def claim(self) -> list[dict]:
        return self._call("POST", "/v1/trailer/notes:claim").get("notes") or []

    def finish(self, note_id: str, body: dict) -> dict:
        return self._call("POST", f"/v1/trailer/notes/{note_id}:finish", body)


def failed(code: str, from_version: int | None = None, source: str | None = None) -> dict:
    return {"status": "failed", "from_version": from_version, "to_version": None, "changes": [], "refusal": code, "source": source}


def names_of(key: str) -> tuple[pathlib.Path | None, tuple, tuple]:
    """(checkout, names, others) for a key, as the ship kit resolves a bare key (kit.main)."""
    import argparse

    from capture.shipkit import kit

    project = kit.project_for_key(key)
    if project is None:
        return None, tuple(privacy.machine_names()), ()
    names, others = kit.names_for(project, argparse.Namespace(no_transcripts=False, root="~/.claude/projects"))
    return project.checkout, names, others


def answer(note: dict, *, use_model: bool = True, formats: list[str] | None = None, say: Callable[[str], None] = print,
           resolve=names_of, render_fn=render.render) -> dict:
    """One note, read, cut and rendered: the NoteFinish body (spec/trailer.v1.json)."""
    key, body = note["project_key"], note["body"]
    src, names, others = resolve(key)
    leaks = lambda texts: privacy.label_leaks(texts, names, others)  # noqa: E731
    try:
        f = make.facts_for(key, src, names, others)
    except CaptureError:
        return failed("no_demo")
    old = render.current(key)
    # `first` with an old cut: the demo changed shape under it, and the note is read against a fresh
    # cut, answered as a change of version like any other.
    base, first = make.cut_for(key, f)
    from_version = old["version"] if old else None
    unmade = old is None
    if unmade and MAKE_ONE.match(body):
        cut, changes, source = base, [], None
    else:
        ans = direct.answer(body, base, f, render.history(key), leaks, use_model=use_model)
        if ans.cut is None:
            if unmade and ans.refusal in ("not_understood", "nothing_to_change", "no_model"):
                # There was no trailer, and now there is one: the note asked for at least that.
                cut, changes, source = base, [], ans.source
            else:
                return failed(ans.refusal or "not_understood", from_version, ans.source)
        else:
            cut, changes, source = ans.cut, ans.changes, ans.source
            if first:
                cut = {**cut, "version": base["version"]}
    render.save_cut(key, cut)
    render.log_note(key, {"at": note.get("created_at"), "note": body, "from": from_version, "to": cut["version"],
                          "changes": changes, "refusal": None, "source": source, "id": note["id"]})  # fmt: skip
    try:
        render_fn(key, f, cut, formats=formats, say=say)
    except render.RenderError as e:
        if old is not None:
            render.save_cut(key, old)
        return failed(e.code if e.code in tables.ENUMS["note_refusal"] else "render_failed", from_version, source)
    return {"status": "done", "from_version": from_version, "to_version": cut["version"], "changes": changes[:12],
            "refusal": None, "source": source}  # fmt: skip


def publish(key: str, server: str, log_path, run=subprocess.run) -> int:
    """The kit, with the trailer in it, through the ship kit's own publish (a child process, as the
    worker runs every stage). Its exit code; 0 is published."""
    from capture.shipkit import watch

    with open(log_path, "a") as fh:
        fh.write(f"\n== publish {key[:12]} with its trailer\n")
        fh.flush()
        try:
            r = run([sys.executable, "-m", "capture", "demo", "kit", "--key", key, "--publish", "--yes", "--server", server],
                    stdout=fh, stderr=subprocess.STDOUT, timeout=PUBLISH_TIMEOUT, check=False, env=watch.child_env(),
                    stdin=subprocess.DEVNULL)  # fmt: skip
        except subprocess.TimeoutExpired:
            return 124
    return r.returncode


def take(client: Notes, *, publish_to: str | None, use_model: bool = True, formats: list[str] | None = None,
         say: Callable[[str], None] = print) -> int:
    """Claim the owner's notes and answer each one; how many were claimed. A server that does not
    answer never stops the demo queue behind it."""
    from capture.demo import paths

    try:
        got = client.claim()
    except Exception as e:  # noqa: BLE001 - the server being down is a line, not a crash
        say(f"  notes: the server did not answer ({e})")
        return 0
    for n in got:
        key = n["project_key"]
        say(f"  note {n['id'][:8]} on {key[:12]}: {n['body'][:60]!r}")
        try:
            body = answer(n, use_model=use_model, formats=formats, say=lambda m: say(f"    {m}"))
        except Exception as e:  # noqa: BLE001 - one bad note must not strand the others claimed with it
            say(f"    it broke: {e}")
            body = failed("render_failed")
        if body["status"] == "done":
            say("    " + (" · ".join(cutmod.say(c) for c in body["changes"]) or f"version {body['to_version']}"))
            if publish_to:
                rc = publish(key, publish_to, paths.private_dir(paths.work_dir(key)) / "watch.log")
                v = body["to_version"]
                say(f"    published the kit with version {v}" if rc == 0 else f"    the publish ended {rc}; version {v} is on this Mac")
        else:
            say(f"    {tables.REFUSALS.get(body['refusal'], body['refusal'])}")
        try:
            client.finish(n["id"], body)
        except Exception as e:  # noqa: BLE001 - it goes stale in ten minutes and comes back
            say(f"    the answer did not reach the server ({e}); the note comes back in ten minutes")
    return len(got)


def refresh(key: str, say: Callable[[str], None] = print, resolve=names_of, render_fn=render.render) -> int | None:
    """After a new demo, the project's trailer cut again from it: the owner's cut when it still
    fits the new demo, else a first cut as the next version. The version rendered, or None when the
    project has no trailer (nobody asked for one, so none is made). Raises what the render raises."""
    if render.current(key) is None:
        return None
    src, names, others = resolve(key)
    f = make.facts_for(key, src, names, others)
    cut, _first = make.cut_for(key, f)
    render.save_cut(key, cut)
    render_fn(key, f, cut, say=say)
    return cut["version"]
