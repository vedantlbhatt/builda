import contextlib
import json
import logging
import re
import time
import uuid
from dataclasses import dataclass
from typing import Literal

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field, StrictStr, field_validator, model_validator
from sqlalchemy import text

from .. import live_push, notify
from ..auth import CurrentDevice, current_device
from ..db import db_session
from ..settings import settings

router = APIRouter(prefix="/v1/push", tags=["push"])
log = logging.getLogger("builder.push")

_token_cache: dict[str, tuple[str, float]] = {}

#: APNs answers these when a token is not valid on the host it was sent to. The usual cause
#: is an environment mismatch (a TestFlight build holds a production token its debug
#: registration called sandbox), so the other host is tried once before the token is
#: dropped: deleting on the first failure would silently end push for that install.
_TOKEN_REJECTED = frozenset({"BadDeviceToken", "Unregistered"})

#: `apns-topic` for an ActivityKit push is the app's bundle id with this suffix (Apple,
#: "Starting and updating Live Activities with ActivityKit push notifications").
LIVEACTIVITY_TOPIC_SUFFIX = ".push-type.liveactivity"


class RegisterRequest(BaseModel):
    token: str
    environment: str = "sandbox"


@router.post("/register")
def register(body: RegisterRequest, device: CurrentDevice = Depends(current_device)):
    """Register an APNs device token.

    The environment is stored alongside it because a sandbox token and a production token
    are indistinguishable by inspection, and sending to the wrong host returns
    `BadDeviceToken`. Without this, push breaks during exactly the TestFlight phase, when
    the build is signed for production but installed like a development one.
    """
    env = "production" if body.environment == "production" else "sandbox"
    with db_session(viewer_id=str(device.user_id)) as db:
        db.execute(
            text(
                """
                INSERT INTO push_tokens (user_id, token, environment)
                VALUES (:u, :t, :e)
                ON CONFLICT (user_id, token) DO UPDATE
                  SET environment = EXCLUDED.environment, last_used_at = now()
                """
            ),
            {"u": str(device.user_id), "t": body.token, "e": env},
        )
    return {"status": "registered", "environment": env}


# ------------------------------------------------------------------ live activity tokens


#: An ActivityKit push token as the module hands it over: the token's bytes in hex. The
#: length bounds are loose on purpose (Apple does not document one; the tokens seen are 80
#: to 160 hex digits) and exist to keep a pasted paragraph out of a URL path.
_HEX_TOKEN = re.compile(r"^[0-9a-fA-F]{16,512}$")
#: `Activity.id`, a UUID string. Only the characters an id uses: it is a DELETE path segment.
_ACTIVITY_ID = re.compile(r"^[0-9A-Za-z._-]{1,128}$")

Creature = Literal[tuple(live_push.CREATURES)]  # type: ignore[valid-type]


class LiveActivityRegistration(BaseModel):
    """One ActivityKit token (`api.ts LiveActivityRegistration`). `activity`: an update token
    for one running activity, naming its server session and ActivityKit's own id.
    `push_to_start` (iOS 17.2+): an app wide token that names neither. The shape is checked
    here so a malformed body is a 422 rather than the migration's CHECK failing as a 500.

    The creature rides on the token because the server stores no creature anywhere else and
    the Live Activity's ContentState requires one."""

    model_config = ConfigDict(extra="forbid")

    kind: Literal["activity", "push_to_start"]
    session_id: uuid.UUID | None = None
    activity_id: StrictStr | None = Field(default=None, pattern=_ACTIVITY_ID.pattern)
    token: StrictStr = Field(pattern=_HEX_TOKEN.pattern)
    environment: Literal["sandbox", "production"]
    creature: Creature

    @field_validator("token")
    @classmethod
    def _lower(cls, v: str) -> str:
        # One token, one spelling: UNIQUE (user_id, token) must not see two cases of it.
        return v.lower()

    @model_validator(mode="after")
    def _shape(self):
        named = self.session_id is not None and self.activity_id is not None
        if self.kind == "activity" and not named:
            raise ValueError("an activity token names its session_id and activity_id")
        if self.kind == "push_to_start" and (
            self.session_id is not None or self.activity_id is not None
        ):
            raise ValueError("a push_to_start token names no session and no activity")
        return self


@router.post("/live-activity")
def register_live_activity(
    body: LiveActivityRegistration, device: CurrentDevice = Depends(current_device)
):
    """Store an ActivityKit token so the server can update the activity while the app is in
    the background (docs/overnight-integration.md 3.6). Upserted on (account, token).

    An activity token starts from what the phone was showing: the phase and trajectory of
    the session's current live state (`live_push.seed`), which the phone drew its card from.
    The first push is then the first CHANGE, never a repeat of the card it just started, and
    a session already waiting on you when the activity starts does not alert again.

    A newer token for the same activity replaces the older one: ActivityKit may issue a new
    token during an activity's life, and updates go to the latest.
    """
    uid = str(device.user_id)
    with db_session(viewer_id=uid) as db:
        last_phase = last_trajectory = None
        session_id = str(body.session_id) if body.session_id is not None else None
        if body.kind == "activity":
            row = db.execute(
                text(
                    """
                    SELECT s.state, s.ended_at, s.updated_at, sl.body AS live_body
                    FROM sessions s LEFT JOIN session_live sl ON sl.session_id = s.id
                    WHERE s.id = :s AND s.user_id = :u
                    """
                ),
                {"s": session_id, "u": uid},
            ).first()
            if row is None:
                # Not this viewer's session (or none at all): the policy would refuse the row
                # anyway, and a token for someone else's session would receive their updates.
                raise HTTPException(404, "unknown session")
            if row.state != "live":
                return JSONResponse(
                    {"reason": "this session has finished, so there is nothing to update"},
                    status_code=409,
                )
            last_phase, last_trajectory = live_push.seed(
                {"state": row.state, "ended_at": row.ended_at, "updated_at": row.updated_at},
                row.live_body,
                time.time(),
            )
            db.execute(
                text(
                    "DELETE FROM live_activity_tokens "
                    "WHERE user_id = :u AND activity_id = :a AND token <> :t"
                ),
                {"u": uid, "a": body.activity_id, "t": body.token},
            )
        db.execute(
            text(
                """
                INSERT INTO live_activity_tokens
                  (user_id, kind, session_id, activity_id, token, environment, creature,
                   last_phase, last_trajectory)
                VALUES (:u, :k, :s, :a, :t, :e, :c, :lp, :lt)
                ON CONFLICT (user_id, token) DO UPDATE SET
                  kind = EXCLUDED.kind,
                  session_id = EXCLUDED.session_id,
                  activity_id = EXCLUDED.activity_id,
                  environment = EXCLUDED.environment,
                  creature = EXCLUDED.creature,
                  last_phase = EXCLUDED.last_phase,
                  last_trajectory = EXCLUDED.last_trajectory
                """
            ),
            {
                "u": uid,
                "k": body.kind,
                "s": session_id,
                "a": body.activity_id,
                "t": body.token,
                "e": body.environment,
                "c": body.creature,
                "lp": last_phase,
                "lt": last_trajectory,
            },
        )
    return {"status": "registered", "kind": body.kind}


@router.delete("/live-activity/{activity_id}", status_code=204)
def forget_live_activity(activity_id: str, device: CurrentDevice = Depends(current_device)):
    """The phone ended the activity: forget its tokens, so nothing pushes to it again. 204
    whether or not one was stored, so a retry after a lost answer is harmless."""
    if not _ACTIVITY_ID.match(activity_id):
        raise HTTPException(422, "not an activity id")
    uid = str(device.user_id)
    with db_session(viewer_id=uid) as db:
        db.execute(
            text("DELETE FROM live_activity_tokens WHERE user_id = :u AND activity_id = :a"),
            {"u": uid, "a": activity_id},
        )
    return Response(status_code=204)


# ------------------------------------------------------------------------------ APNs


def _apns_jwt() -> str:
    """Token-based APNs auth. Cached: Apple rejects tokens refreshed more than once
    every 20 minutes, and requires refresh at least once an hour."""
    cached = _token_cache.get("apns")
    if cached and cached[1] > time.time():
        return cached[0]

    token = jwt.encode(
        {"iss": settings().apns_team_id, "iat": int(time.time())},
        settings().apns_private_key,
        algorithm="ES256",
        headers={"kid": settings().apns_key_id},
    )
    _token_cache["apns"] = (token, time.time() + 30 * 60)
    return token


def _host(env: str) -> str:
    return (
        "https://api.sandbox.push.apple.com" if env == "sandbox" else "https://api.push.apple.com"
    )


def _other(env: str) -> str:
    return "production" if env == "sandbox" else "sandbox"


@dataclass(frozen=True)
class _Delivery:
    """What one POST to APNs came to. `environment` is the host that took it; `gone` means
    both hosts refused the token, so the install behind it is gone."""

    sent: bool
    environment: str | None = None
    gone: bool = False


def _deliver(token: str, environment: str, content: str, headers: dict) -> _Delivery:
    """THE ONE APNs POST, for every kind of push: the token's own host, then, on a rejected
    token, the other host once. A transport error or any other refusal stops there and
    forgets nothing: only a token both hosts rejected is gone."""
    for env in (environment, _other(environment)):
        try:
            with httpx.Client(http2=True, timeout=10) as client:
                resp = client.post(
                    f"{_host(env)}/3/device/{token}", content=content, headers=headers
                )
        except Exception:
            return _Delivery(False)
        if resp.status_code == 200:
            return _Delivery(True, env)
        reason = ""
        with contextlib.suppress(Exception):
            reason = resp.json().get("reason", "")
        if reason not in _TOKEN_REJECTED:
            return _Delivery(False)
    return _Delivery(False, gone=True)


def _send_alert(user_id: str, payload: dict, *, collapse_id: str) -> int:
    """An ordinary banner to every device the user has registered. Returns how many took it.

    `push_tokens` is RLS-protected with an owner policy. This runs from a job, not a
    request, but it still knows exactly whose tokens it wants, and viewer-less it got zero
    rows, every time, with no error: the push silently never went out.
    """
    if not settings().apns_private_key:
        return 0
    with db_session(viewer_id=user_id) as db:
        rows = db.execute(
            text("SELECT id, token, environment FROM push_tokens WHERE user_id = :u"),
            {"u": user_id},
        ).all()
    if not rows:
        return 0

    headers = {
        "authorization": f"bearer {_apns_jwt()}",
        "apns-topic": settings().apns_topic,
        "apns-push-type": "alert",
        # Coalesces repeats for the same moment rather than stacking a second banner if a
        # retry lands, or if the phone posted its own copy first.
        "apns-collapse-id": collapse_id,
    }
    content = json.dumps(payload)
    sent = 0
    for row in rows:
        d = _deliver(row.token, row.environment, content, headers)
        if d.sent:
            sent += 1
            if d.environment != row.environment:
                with db_session(viewer_id=user_id) as db:
                    db.execute(
                        text("UPDATE push_tokens SET environment = :e WHERE id = :i"),
                        {"e": d.environment, "i": str(row.id)},
                    )
        elif d.gone:
            with db_session(viewer_id=user_id) as db:
                db.execute(text("DELETE FROM push_tokens WHERE id = :i"), {"i": str(row.id)})
    return sent


def send_session_finished(
    user_id: str, title: str, body: str, session_id: str, *, unattended: bool = False
) -> int:
    """Push a session-complete alert to every device the user has registered.

    `unattended` rides in the payload so the phone can open "Agent run finished" on the
    run's analysis rather than on a record card it can never be.

    A `BadDeviceToken` is retried once against the opposite host before the token is
    dropped: the usual cause is an environment mismatch rather than a dead install, and
    deleting the token on the first failure would silently disable push for a TestFlight
    user with no way to recover short of reinstalling.
    """
    payload = apns_payload(title, body, session_id, unattended=unattended)
    return _send_alert(user_id, payload, collapse_id=session_id[:63])


def send_needs_you(user_id: str, title: str, body: str, session_id: str) -> int:
    """The needs you banner (`notify.KIND_NEEDS_YOU`), for a running session with no Live
    Activity: `live_push.plan` decided it, once per entry and only while it is news. Same
    delivery as a finish; a tap opens the session, not a recap."""
    payload = apns_payload(title, body, session_id, unattended=False, kind=notify.KIND_NEEDS_YOU)
    return _send_alert(user_id, payload, collapse_id=notify.needs_you_collapse_id(session_id))


def apns_payload(
    title: str, body: str, session_id: str, *, unattended: bool, kind: str | None = None
) -> dict:
    """The APNs body for one banner. Pure, so a test can hold it up to the light.

    `aps.alert` is what the banner shows and is unchanged by anything else here. `data`
    (`notify.push_data`) is what a tap opens: kind, session id and the deep link. The two
    older top-level keys stay for any phone build that reads them.

    One trap worth writing down: expo-notifications on iOS hands a REMOTE notification's
    `userInfo["body"]` to JS as `content.data`, not the userInfo itself — so `data` here
    is NOT what `response.notification.request.content.data` returns for a raw APNs push;
    the whole userInfo is on `trigger.payload`. `mobile/src/push/push.ts` reads both.
    """
    return {
        "aps": {
            "alert": {"title": title, "body": body},
            "sound": "default",
            "thread-id": "session",
            "interruption-level": "active",
        },
        "session": session_id,
        "unattended": unattended,
        "data": notify.push_data(session_id, unattended=unattended, kind=kind),
    }


def liveactivity_topic() -> str:
    """`com.vedantlbhatt.Builder.push-type.liveactivity`: the bundle id and Apple's suffix."""
    return f"{settings().apns_topic}{LIVEACTIVITY_TOPIC_SUFFIX}"


def live_activity_headers(*, priority: int, expiration: int | None) -> dict:
    """The headers of one ActivityKit push. `apns-priority` is 10 only for needs you (it
    lights the screen and spends the activity's budget) and 5 for every other update."""
    if priority not in (live_push.PRIORITY_NEEDS_YOU, live_push.PRIORITY_TICK):
        raise ValueError(f"apns-priority {priority} is neither needs you nor a tick")
    headers = {
        "authorization": f"bearer {_apns_jwt()}",
        "apns-push-type": "liveactivity",
        "apns-topic": liveactivity_topic(),
        "apns-priority": str(priority),
    }
    if expiration is not None:
        headers["apns-expiration"] = str(int(expiration))
    return headers


def send_live_activity(row, payload: dict, *, priority: int, expiration: int | None = None) -> bool:
    """POST one ActivityKit `update` or `end` to one activity token (`live_push.Target`).

    `apns-expiration` is the update's stale date: an update APNs could not deliver before
    the card says "Not updating" is not worth delivering after. A token both hosts reject is
    forgotten, the push_tokens rule. With no APNs key configured nothing is sent and the
    answer is False, as for a banner; so is a body over APNs' 4 KB, which APNs would refuse.
    """
    if not settings().apns_private_key:
        return False
    content = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    if len(content.encode()) > live_push.PAYLOAD_LIMIT_BYTES:
        log.error(
            "live activity push for %s is over %d bytes; not sent",
            row.id,
            live_push.PAYLOAD_LIMIT_BYTES,
        )
        return False
    headers = live_activity_headers(priority=priority, expiration=expiration)
    d = _deliver(row.token, row.environment, content, headers)
    if d.sent and d.environment != row.environment:
        with db_session(viewer_id=row.user_id) as db:
            db.execute(
                text("UPDATE live_activity_tokens SET environment = :e WHERE id = :i"),
                {"e": d.environment, "i": row.id},
            )
    elif d.gone:
        with db_session(viewer_id=row.user_id) as db:
            db.execute(text("DELETE FROM live_activity_tokens WHERE id = :i"), {"i": row.id})
    return d.sent
