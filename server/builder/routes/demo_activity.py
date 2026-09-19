"""The demo Live Activity's tokens: `POST /v1/push/demo-activity` and its delete.

docs/demo-island.md. The phone's module (`BuilderDemoLive.swift`) posts each demo card's update
token as ActivityKit issues it; `demo_push` moves cards with them. Its own file and route, beside
`drop_activity.py` in the URL space and validated by the same patterns, for the reason 0032 gives
for its own table: a demo card points at a demo request, not at a drop.

`current_phone`, not `current_device`: only a phone has a Live Activity, and a paired Mac has no
business holding a token that receives what somebody's Lock Screen shows.
"""

from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, StrictStr, field_validator
from sqlalchemy import text

from .. import demo_push
from ..auth import CurrentDevice, current_phone
from ..db import db_session
from .push import _ACTIVITY_ID, _HEX_TOKEN

router = APIRouter(prefix="/v1/push", tags=["push"])

Phase = Literal[demo_push.PHASES]  # type: ignore[valid-type]


class DemoActivityRegistration(BaseModel):
    """One card's update token, naming its request and ActivityKit's id, and what the card shows
    now (`showing`), so a move it missed while it had no token is sent at once."""

    model_config = ConfigDict(extra="forbid")

    request_id: uuid.UUID
    activity_id: StrictStr = Field(pattern=_ACTIVITY_ID.pattern)
    token: StrictStr = Field(pattern=_HEX_TOKEN.pattern)
    environment: Literal["sandbox", "production"]
    showing: Phase | None = None

    @field_validator("token")
    @classmethod
    def _lower(cls, v: str) -> str:
        # One token, one spelling: UNIQUE (user_id, token) must not see two cases of it.
        return v.lower()


@router.post("/demo-activity")
def register_demo_activity(
    body: DemoActivityRegistration, device: CurrentDevice = Depends(current_phone)
):
    """Store a demo card's token. Upserted on (account, token). A card's newer token replaces its
    older one: ActivityKit may issue a new one during a card's life, and pushes go to the latest."""
    uid = str(device.user_id)
    rid = str(body.request_id)
    with db_session(viewer_id=uid) as db:
        owned = db.execute(
            text(
                "SELECT 1 FROM demo_requests "
                "WHERE id = CAST(:r AS uuid) AND user_id = CAST(:u AS uuid)"
            ),
            {"r": rid, "u": uid},
        ).first()
        if owned is None:
            # Not this account's request, or none at all. A token for somebody else's request
            # would receive what their card says.
            raise HTTPException(404, "unknown demo request")
        db.execute(
            text(
                "DELETE FROM demo_activity_tokens "
                "WHERE user_id = :u AND activity_id = :a AND token <> :t"
            ),
            {"u": uid, "a": body.activity_id, "t": body.token},
        )
        db.execute(
            text(
                """
                INSERT INTO demo_activity_tokens
                  (user_id, request_id, activity_id, token, environment, shown_phase)
                VALUES (:u, :r, :a, :t, :e, :p)
                ON CONFLICT (user_id, token) DO UPDATE SET
                  request_id = EXCLUDED.request_id,
                  activity_id = EXCLUDED.activity_id,
                  environment = EXCLUDED.environment
                """
            ),
            {
                "u": uid,
                "r": rid,
                "a": body.activity_id,
                "t": body.token,
                "e": body.environment,
                # A card that did not say is taken to show the least: `asked`.
                "p": body.showing or "asked",
            },
        )
    # The Mac may have picked it up, or even finished it, while the card had no token.
    caught_up = len(demo_push.after_transition(uid, [rid]))
    return {"status": "registered", "caught_up": caught_up}


@router.delete("/demo-activity/{activity_id}", status_code=204)
def forget_demo_activity(activity_id: str, device: CurrentDevice = Depends(current_phone)):
    """The card ended or was swiped away. 204 whether or not one was stored."""
    if not _ACTIVITY_ID.match(activity_id):
        raise HTTPException(422, "not an activity id")
    uid = str(device.user_id)
    with db_session(viewer_id=uid) as db:
        db.execute(
            text("DELETE FROM demo_activity_tokens WHERE user_id = :u AND activity_id = :a"),
            {"u": uid, "a": activity_id},
        )
    return Response(status_code=204)
