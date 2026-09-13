import hashlib
import hmac
import json
from pathlib import Path

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from pydantic import BaseModel, ConfigDict, StrictBool, model_validator
from sqlalchemy import text

from .. import builder_profile, live_store, quotes
from ..auth import CurrentDevice, current_device, current_phone, current_uploader
from ..contract import ANONYMOUS_FIELDS, CONTRACT_VERSION, PUBLIC_FIELDS
from ..db import db_session
from ..quotes_spec import QuotesUpload

router = APIRouter(prefix="/v1", tags=["privacy"])

_STATIC = Path(__file__).resolve().parent.parent / "static"


@router.get("/../upload-fields.json", include_in_schema=False)
@router.get("/upload-fields.json")
def upload_fields():
    """The published field list.

    This is the file the verification command on the privacy page fetches and diffs
    against what the agent would actually send. It is GENERATED from
    privacy/upload-contract.json, so it cannot drift from the code — and CI fails if the
    committed copy is stale.
    """
    data = json.loads((_STATIC / "upload-fields.json").read_text())
    return JSONResponse(data, headers={"Cache-Control": "public, max-age=300"})


@router.get("/privacy/fields", response_class=PlainTextResponse)
def privacy_fields_text():
    fields = json.loads((_STATIC / "upload-fields.json").read_text())["fields"]
    lines = [
        f"Builder upload contract v{CONTRACT_VERSION}",
        "",
        "Every field that can leave your machine. Nothing else is representable on the",
        "wire: the client encodes through a generated key enum with no synthesized",
        "Codable, so a field absent from this list has no way to be sent.",
        "",
    ]
    lines += [f"  {f}" for f in fields]
    lines += [
        "",
        "Never in a session upload, in any mode: prompt text, assistant text, thinking,",
        "tool inputs or outputs, file contents, diffs, file paths, file names, directory",
        "names, commit messages, commit SHAs, branch names, cwd, git remote URLs, repository",
        "names for repositories you have not marked public, MCP server names, terminal",
        "commands or their output, environment variables, URLs fetched, hostname, IP address.",
        "",
        "The Claude Code hook and `python -m capture live` are a separate channel that sends",
        "the raw transcript to this server, which keeps only the fields above and deletes",
        "the raw bytes when the session is final (PRIVACY.md, The raw transcript channel).",
        "",
        f"Public-repo-only fields: {sorted(set(PUBLIC_FIELDS) - set(ANONYMOUS_FIELDS))}",
    ]
    return "\n".join(lines)


class PrefsUpdate(BaseModel):
    """`PUT /v1/privacy/prefs`: either switch, or both. Strict booleans: `"yes"` or `1` is a
    422, never read as a yes to sending a person's words."""

    model_config = ConfigDict(extra="forbid")

    quotes: StrictBool | None = None
    live_names: StrictBool | None = None

    @model_validator(mode="after")
    def _one(self):
        if self.quotes is None and self.live_names is None:
            raise ValueError("send quotes, live_names or both")
        return self


@router.get("/privacy/prefs")
def get_prefs(device: CurrentDevice = Depends(current_device)):
    """The account's two opt in switches, both off until the person turns one on:
    `quotes` (contract v4's second exception) and `live_names` (its third). The map salt
    stored beside them is never returned by this or any route: a salt a viewer holds makes
    every file id a dictionary lookup away from its path."""
    uid = str(device.user_id)
    with db_session(viewer_id=uid) as db:
        p = live_store.prefs(db, uid)
    return {"quotes": p.quotes, "live_names": p.live_names}


@router.put("/privacy/prefs")
def put_prefs(body: PrefsUpdate, device: CurrentDevice = Depends(current_phone)):
    """Flip one switch or both. `current_phone`: only the phone flips a switch, never a
    capture key and never a paired machine's device flow token (403, FOUND IN THE
    ADVERSARIAL REVIEW 2026-09-13: `current_device` let `capture pair`'s token turn both on),
    so a machine cannot opt its own account into sending more.

    OFF DELETES, IN THIS TRANSACTION: quotes off deletes every stored quote and answers how
    many (`quotes_deleted`, a measured count, 0 included); File names off forgets every
    stored basename (`live_store.set_live_names`). If either write fails, neither switch
    moves. A key that was not sent is not touched."""
    uid = str(device.user_id)
    out: dict = {}
    with db_session(viewer_id=uid) as db:
        if body.quotes is not None:
            deleted = quotes.set_quotes(db, uid, body.quotes)
            if not body.quotes:
                out["quotes_deleted"] = deleted
        if body.live_names is not None:
            live_store.set_live_names(db, uid, body.live_names)
        p = live_store.prefs(db, uid)
    return {"quotes": p.quotes, "live_names": p.live_names, **out}


@router.put("/profile/quotes")
def put_profile_quotes(doc: QuotesUpload, device: CurrentDevice = Depends(current_uploader)):
    """Store the quotes this account's machine picked (`capture report --quotes`).

    `current_uploader`: the machine holds a capture key or a device token, as for the
    report. Refused with 409 while the account's switch is off (the machine alone can never
    opt in), 503 when this server cannot run the machine's filters, and 422 when a quote
    fails them or names a session this account has not uploaded (`quotes.py`)."""
    uid = str(device.user_id)
    with db_session(viewer_id=uid) as db:
        if not quotes.quotes_on_for_update(db, uid):
            return JSONResponse({"reason": quotes.QUOTES_OFF}, status_code=409)
        try:
            refusal = quotes.quotes_gate(doc)
        except quotes.EngineUnavailable:
            return JSONResponse({"reason": quotes.ENGINE_MISSING}, status_code=503)
        if refusal is None:
            unheld = quotes.sessions_not_held(db, uid, doc)
            if unheld:
                refusal = (
                    "quote "
                    + ", ".join(map(str, unheld))
                    + (
                        " names a session this account has not uploaded"
                        if len(unheld) == 1
                        else " name sessions this account has not uploaded"
                    )
                )
        if refusal is not None:
            return JSONResponse({"reason": refusal}, status_code=422)
        quotes.put_quotes(db, uid, doc.model_dump(mode="json"))
    return {"ok": True, "quotes_version": doc.quotes_version, "quotes": len(doc.quotes)}


@router.delete("/profile/quotes", status_code=204)
def delete_profile_quotes(device: CurrentDevice = Depends(current_uploader)):
    """Forget every stored quote now, whatever the switch says (`capture quotes --delete`,
    or the phone). 204 whether or not any were stored."""
    uid = str(device.user_id)
    with db_session(viewer_id=uid) as db:
        quotes.delete_quotes(db, uid)
    return Response(status_code=204)


class VisibilityUpdate(BaseModel):
    repo_hash: str
    visibility: str


@router.post("/repos/visibility")
def set_visibility(body: VisibilityUpdate, device: CurrentDevice = Depends(current_device)):
    """Change a repository's visibility, and apply it retroactively.

    Setting `excluded` deletes what is already stored rather than merely hiding it.
    Anything less would make the control a display preference, and the promise is that an
    excluded repository has nothing on the server.
    """
    if body.visibility not in {"public", "anonymous", "excluded"}:
        return JSONResponse({"error": "invalid visibility"}, status_code=422)

    with db_session(viewer_id=str(device.user_id)) as db:
        repo = db.execute(
            text("SELECT id FROM repos WHERE repo_hash = :h"), {"h": body.repo_hash}
        ).first()
        if repo is None:
            return JSONResponse({"error": "unknown repo"}, status_code=404)

        db.execute(
            text(
                """
                INSERT INTO repo_visibility (user_id, repo_id, visibility)
                VALUES (:u, :r, CAST(:v AS repo_vis))
                ON CONFLICT (user_id, repo_id) DO UPDATE
                  SET visibility = EXCLUDED.visibility, updated_at = now()
                """
            ),
            {"u": str(device.user_id), "r": str(repo.id), "v": body.visibility},
        )

        deleted = 0
        if body.visibility == "excluded":
            result = db.execute(
                text("DELETE FROM sessions WHERE user_id = :u AND repo_id = :r"),
                {"u": str(device.user_id), "r": str(repo.id)},
            )
            deleted = result.rowcount or 0
            # A build post (0017) is about a PROJECT and has no session, so deleting the
            # sessions does not reach it and it would survive the sweep. `can_view_post`
            # does hide it, and hidden is weaker than the promise this route makes: an
            # excluded repository has NOTHING on the server, not a row that is currently
            # filtered. A session post needs no line here; it cascades from its session.
            db.execute(
                text(
                    "DELETE FROM posts WHERE user_id = :u AND repo_id = :r AND session_id IS NULL"
                ),
                {"u": str(device.user_id), "r": str(repo.id)},
            )
            # The quotes typed in its sessions (FOUND IN THE ADVERSARIAL REVIEW,
            # 2026-09-13): they outlived the sweep, stored and shown on the Wrapped cards.
            # A quote names its session, and those sessions are gone now.
            quotes.drop_unheld(db, str(device.user_id))
            # And its project in the stored report (report v3, docs/projects.md): a block
            # of numbers under the repository's key is something about it on the server.
            # The read filters it too; this is the sweep, so nothing stays behind a filter.
            builder_profile.forget_project(db, str(device.user_id), body.repo_hash)
        elif body.visibility == "anonymous":
            # Dropping to anonymous must strip the name and the title everywhere it was
            # already stored, not just stop sending them from now on.
            db.execute(
                text(
                    "UPDATE sessions SET title = NULL, title_source = NULL "
                    "WHERE user_id = :u AND repo_id = :r"
                ),
                {"u": str(device.user_id), "r": str(repo.id)},
            )
            db.execute(
                text("UPDATE repos SET public_name = NULL WHERE id = :r"), {"r": str(repo.id)}
            )

    return {"status": "ok", "visibility": body.visibility, "sessions_deleted": deleted}


@router.post("/account/delete")
def delete_account(device: CurrentDevice = Depends(current_device)):
    """One call, everything gone.

    Returns a receipt: an HMAC over the row counts and the moment of deletion. It is the
    only artifact that survives, and it deliberately carries nothing about who the user
    was — proof the request was honoured, not a record of the person who made it.
    """
    user_id = str(device.user_id)
    with db_session(viewer_id=user_id) as db:
        counts = {}
        for table, sql in [
            ("sessions", "SELECT COUNT(*) FROM sessions WHERE user_id = :u"),
            ("devices", "SELECT COUNT(*) FROM devices WHERE user_id = :u"),
            ("push_tokens", "SELECT COUNT(*) FROM push_tokens WHERE user_id = :u"),
            (
                "repo_visibility",
                "SELECT COUNT(*) FROM repo_visibility WHERE user_id = :u",
            ),
        ]:
            counts[table] = db.execute(text(sql), {"u": user_id}).scalar() or 0

        payload = json.dumps(counts, sort_keys=True)
        receipt = hmac.new(
            b"builder-deletion-receipt-v1", payload.encode(), hashlib.sha256
        ).hexdigest()

        db.execute(
            text(
                """
                INSERT INTO deletion_requests (user_id, completed_at, row_counts, receipt_hmac)
                VALUES (:u, now(), CAST(:c AS jsonb), :r)
                """
            ),
            {"u": user_id, "c": payload, "r": receipt},
        )

        # Everything else cascades from users.
        db.execute(text("DELETE FROM users WHERE id = :u"), {"u": user_id})

    return {"status": "deleted", "row_counts": counts, "receipt": receipt}
