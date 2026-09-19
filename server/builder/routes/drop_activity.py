"""The drop Live Activity's tokens: `POST /v1/push/drop-activity` and its two deletes.

docs/drop-island.md. The phone's module (`BuilderDropLive.swift`) posts the app's push-to-start
token for `BuilderDropAttributes`, and each drop card's update token as ActivityKit issues it;
`drop_push` starts and moves cards with them. Kept out of `routes/push.py` so the drop island is
one file to read, and beside it in the URL space because it is the same kind of thing: an
ActivityKit token, validated by the same patterns.

`current_phone`, not `current_device`: only a phone has a Live Activity, and a paired Mac has no
business holding a token that receives what somebody's Lock Screen shows.
"""

from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, StrictStr, field_validator, model_validator
from sqlalchemy import text

from .. import drop_push
from .. import drops_store as store
from ..auth import CurrentDevice, current_phone
from ..db import db_session
from .push import _ACTIVITY_ID, _HEX_TOKEN

router = APIRouter(prefix="/v1/push", tags=["push"])

Phase = Literal[drop_push.PHASES]  # type: ignore[valid-type]


class DropActivityRegistration(BaseModel):
    """`activity`: one card's update token, naming its drop and ActivityKit's id, and what the
    card shows now (`showing`), so a move it missed while it had no token is sent at once.
    `push_to_start`: the app's token, naming neither."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["activity", "push_to_start"]
    drop_id: uuid.UUID | None = None
    activity_id: StrictStr | None = Field(default=None, pattern=_ACTIVITY_ID.pattern)
    token: StrictStr = Field(pattern=_HEX_TOKEN.pattern)
    environment: Literal["sandbox", "production"]
    showing: Phase | None = None

    @field_validator("token")
    @classmethod
    def _lower(cls, v: str) -> str:
        # One token, one spelling: UNIQUE (user_id, token) must not see two cases of it.
        return v.lower()

    @model_validator(mode="after")
    def _shape(self):
        named = self.drop_id is not None and self.activity_id is not None
        if self.kind == "activity" and not named:
            raise ValueError("an activity token names its drop_id and activity_id")
        if self.kind == "push_to_start" and (
            self.drop_id is not None or self.activity_id is not None or self.showing is not None
        ):
            raise ValueError("a push_to_start token names no drop, no activity and no phase")
        return self


@router.post("/drop-activity")
def register_drop_activity(
    body: DropActivityRegistration, device: CurrentDevice = Depends(current_phone)
):
    """Store a drop card's token. Upserted on (account, token). A card's newer token replaces
    its older one: ActivityKit may issue a new one during a card's life, and pushes go to the
    latest."""
    uid = str(device.user_id)
    drop_id = str(body.drop_id) if body.drop_id is not None else None
    with db_session(viewer_id=uid) as db:
        if body.kind == "activity":
            if store.get_drop(db, uid, drop_id) is None:
                # Not this account's drop, or none at all. A token for somebody else's drop
                # would receive what their card says.
                raise HTTPException(404, "unknown drop")
            db.execute(
                text(
                    "DELETE FROM drop_activity_tokens "
                    "WHERE user_id = :u AND activity_id = :a AND token <> :t"
                ),
                {"u": uid, "a": body.activity_id, "t": body.token},
            )
        db.execute(
            text(
                """
                INSERT INTO drop_activity_tokens
                  (user_id, kind, drop_id, activity_id, token, environment, shown_phase)
                VALUES (:u, :k, :d, :a, :t, :e, :p)
                ON CONFLICT (user_id, token) DO UPDATE SET
                  kind = EXCLUDED.kind,
                  drop_id = EXCLUDED.drop_id,
                  activity_id = EXCLUDED.activity_id,
                  environment = EXCLUDED.environment,
                  shown_phase = COALESCE(drop_activity_tokens.shown_phase, EXCLUDED.shown_phase)
                """
            ),
            {
                "u": uid,
                "k": body.kind,
                "d": drop_id,
                "a": body.activity_id,
                "t": body.token,
                "e": body.environment,
                # A card that did not say is taken to show the least: `sent`.
                "p": (body.showing or "sent") if body.kind == "activity" else None,
            },
        )
    caught_up = 0
    if drop_id is not None:
        # The Mac may have read it while the card had no token (a fast Mac, a slow wake).
        caught_up = len(drop_push.after_transition(uid, [drop_id]))
    return {"status": "registered", "kind": body.kind, "caught_up": caught_up}


@router.delete("/drop-activity/{activity_id}", status_code=204)
def forget_drop_activity(activity_id: str, device: CurrentDevice = Depends(current_phone)):
    """The card ended or was swiped away. 204 whether or not one was stored."""
    if not _ACTIVITY_ID.match(activity_id):
        raise HTTPException(422, "not an activity id")
    uid = str(device.user_id)
    with db_session(viewer_id=uid) as db:
        db.execute(
            text("DELETE FROM drop_activity_tokens WHERE user_id = :u AND activity_id = :a"),
            {"u": uid, "a": activity_id},
        )
    return Response(status_code=204)


@router.delete("/drop-activity-start/{token}", status_code=204)
def forget_drop_push_to_start(token: str, device: CurrentDevice = Depends(current_phone)):
    """Live Activities or Lock Screen details turned off: the server may not start a card."""
    if not _HEX_TOKEN.match(token):
        raise HTTPException(422, "not a token")
    uid = str(device.user_id)
    with db_session(viewer_id=uid) as db:
        db.execute(
            text(
                "DELETE FROM drop_activity_tokens "
                "WHERE user_id = :u AND kind = 'push_to_start' AND token = :t"
            ),
            {"u": uid, "t": token.lower()},
        )
    return Response(status_code=204)
