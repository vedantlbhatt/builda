"""The demo island: a demo request's Live Activity, moved by push (docs/demo-island.md).

Two halves, tested the way each can fail, as test_drop_island.py does for a shared reel's card:

  * THE CARD (`demo_push.content_state`) is pure, so it is held to the Swift struct it must fill
    (read out of BuilderDemoAttributes.swift: a key the struct lacks is dropped by ActivityKit
    with no error), to the Swift phases the views switch on, to the migration's CHECK list, to the
    phone's `demoStepFor` (the rule the in-app island reads), and to
    `spec/fixtures/demos/activity_state.json`, the file the phone's own half is held to as well.
  * THE DECISION runs through the real routes AS builder_app, RLS on, with the APNs http2 client
    replaced by test_live_push's double: registration and its RLS through a second real account,
    an update when the Mac claims and when it finishes and never a step back, catch up on a late
    token, an end after the hold and never on the answer, an end at once when taken back, nothing
    without a token, nothing ever to somebody else, and the no-key log line. And DONE IS NOT THE
    SAME AS UP: a request the Mac finished without publishing is `made` (quietly), a kit published
    later moves it to `ready`, and a worker that publishes before it finishes goes straight there.
"""

import ast
import json
import logging
import pathlib
import re
import uuid

import pytest
from sqlalchemy import text
from test_live_push import _APNs, apns  # noqa: F401 - the APNs double, picked up by name
from test_project_media import _person, store  # noqa: F401 - the kit store, picked up by name
from test_shipkit import _publish
from test_sync import (  # noqa: F401 - fixtures are picked up by name
    TEST_DB,
    _phone_for,
    app_engine,
    app_env,
    client,
    created_users,
    owner_engine,
)

from builder import demo_push
from builder.shipkit_spec import REQUEST_REFUSAL_SENTENCES, SHIPKIT_ENUM_VALUES

_SHARED_FIXTURES = (app_env, client, created_users, apns, store)

ROOT = pathlib.Path(__file__).resolve().parents[2]
SWIFT = ROOT / "mobile/modules/builder-live/ios/BuilderDemoAttributes.swift"
VIEWS = ROOT / "mobile/targets/widget/_shared/DemoActivityViews.swift"
FIXTURE = ROOT / "spec/fixtures/demos/activity_state.json"
MIGRATION = ROOT / "server/alembic/versions/0032_demo_activity_tokens.py"
MIGRATION_MADE = ROOT / "server/alembic/versions/0033_demo_activity_made.py"
ISLAND_MODEL = ROOT / "mobile/src/island/model.ts"
WATCH = ROOT / "capture/shipkit/watch.py"

needs_db = pytest.mark.skipif(not TEST_DB, reason="set BUILDER_TEST_DB to run")

CARD = "cd" * 40


def _swift_vars(src: str, start: str, stop: str) -> list[str]:
    i = src.index(start)
    block = src[i : src.index(stop, i + len(start))]
    return re.findall(r"public var (\w+):", block)


# ================================================================== the card, pure


def test_the_state_is_the_swift_structs_fields_in_order():
    src = SWIFT.read_text()
    assert _swift_vars(src, "struct ContentState", "public init(") == list(
        demo_push.CONTENT_STATE_KEYS
    )
    outer = src[src.index("/// The server's request uuid") :]
    assert _swift_vars(outer, "public var requestId", "public init(") == list(
        demo_push.ATTRIBUTE_KEYS
    )
    assert "public struct BuilderDemoAttributes: ActivityAttributes" in src


def test_the_phases_are_the_ones_the_views_switch_on():
    m = re.search(r"enum Phase: String \{\s*case ([^\n]+)", VIEWS.read_text())
    assert m is not None
    assert [p.strip() for p in m.group(1).split(",")] == list(demo_push.PHASES)


def _phase_list(path: pathlib.Path, name: str) -> list[str]:
    """A migration's quoted phase list, read with `ast` (test_drops.py records why a regex on a
    line is not enough)."""
    tree = ast.parse(path.read_text())
    literal = next(
        ast.literal_eval(node.value)
        for node in tree.body
        if isinstance(node, ast.Assign) and any(getattr(t, "id", "") == name for t in node.targets)
    )
    return re.findall(r"'([a-z]+)'", literal)


def test_the_migrations_check_list_is_the_phases():
    """0033's CHECK is the phases, both ways; its way back is exactly 0032's list, and it follows
    0032, which follows 0031."""
    assert _phase_list(MIGRATION_MADE, "DEMO_PHASE") == list(demo_push.PHASES)
    assert _phase_list(MIGRATION_MADE, "OLD_PHASE") == _phase_list(MIGRATION, "DEMO_PHASE")
    assert set(demo_push.PHASES) - set(_phase_list(MIGRATION, "DEMO_PHASE")) == {"made"}
    assert 'down_revision = "0031_drop_activity_tokens"' in MIGRATION.read_text()
    assert 'down_revision = "0032_demo_activity_tokens"' in MIGRATION_MADE.read_text()


def test_made_sits_below_ready_so_a_publish_can_still_move_the_card():
    rank = demo_push.RANK
    assert rank["asked"] < rank["filming"] < rank["made"] < rank["ready"] == rank["failed"]


def test_the_phase_of_a_status_is_the_in_app_islands_step():
    """`demoStepFor` in the phone's island model, read out of the TypeScript: queued is waiting,
    claimed filming, done ready, failed failed, anything else clear. The card renames `waiting`
    `asked` and has no card for `clear`; a status added on one side only fails here."""
    ts = ISLAND_MODEL.read_text()
    body = ts[ts.index("export function demoStepFor(") :]
    body = body[: body.index("\n}\n")]
    step_of = dict(re.findall(r"case '(\w+)':\s*return '(\w+)';", body))
    rename = {"waiting": "asked", "filming": "filming", "ready": "ready", "failed": "failed"}
    for status in SHIPKIT_ENUM_VALUES["request_status"]:
        step = step_of.get(status, "clear")
        assert demo_push.phase_of(status) == rename.get(step), status


def test_the_stale_dates_are_the_workers_ceilings_and_the_in_app_give_up():
    src = WATCH.read_text()

    def minutes(name: str) -> int:
        m = re.search(rf"^{name} = (\d+) \* 60$", src, re.M)
        assert m, name
        return int(m.group(1)) * 60

    ceilings = sum(minutes(n) for n in ("CAPTURE_TIMEOUT", "SHIPPED_TIMEOUT", "KIT_TIMEOUT"))
    assert ceilings == demo_push.FILMING_STALE_SECONDS
    m = re.search(r"export const DEMO_FOR_MS = (\d+) \* 60_000;", ISLAND_MODEL.read_text())
    assert m
    assert int(m.group(1)) * 60 == demo_push.ASKED_STALE_SECONDS


def test_every_refusal_a_request_can_carry_has_words():
    assert set(REQUEST_REFUSAL_SENTENCES) == set(SHIPKIT_ENUM_VALUES["request_refusal"])
    for words in REQUEST_REFUSAL_SENTENCES.values():
        assert words and not re.search("[\u2014\u2013\u2015\u2212]", words)


@pytest.mark.parametrize("case", json.loads(FIXTURE.read_text())["cases"], ids=lambda c: c["name"])
def test_the_shared_fixture(case):
    """The file the phone's `demoState` is held to, case for case."""
    got = demo_push.content_state(
        case["request"], now=case["now"], kit_published_at=case.get("kit_published_at")
    )
    assert got == case["expect"]
    if got is not None:
        assert tuple(got) == demo_push.CONTENT_STATE_KEYS


def test_an_answer_carries_the_alert_and_filming_and_made_are_quiet():
    done = {"status": "done", "refusal": None, "created_at": "2025-09-13T08:00:00+00:00"}
    made = demo_push.content_state(done, now=100)
    assert made["phase"] == "made"
    assert demo_push.answer_alert(made) is None
    assert (
        demo_push.update_payload(made, now=100)["aps"]["stale-date"]
        == 100 + demo_push.ANSWER_STALE_SECONDS
    )
    ready = demo_push.content_state(done, now=100, kit_published_at="2025-09-13T08:10:00+00:00")
    aps = demo_push.update_payload(ready, now=100, alert=demo_push.answer_alert(ready))["aps"]
    assert aps["alert"] == {"title": "The kit is up", "body": "Tap to share it anywhere."}
    assert aps["stale-date"] == 100 + demo_push.ANSWER_STALE_SECONDS
    failed = demo_push.content_state(
        {"status": "failed", "refusal": "no_checkout", "created_at": "2025-09-13T08:00:00+00:00"},
        now=100,
    )
    assert demo_push.answer_alert(failed)["body"] == (
        "It did not work: the Mac has no checkout of this project."
    )
    filming = demo_push.content_state(
        {"status": "claimed", "refusal": None, "created_at": "2025-09-13T08:00:00+00:00"}, now=100
    )
    assert demo_push.answer_alert(filming) is None
    assert (
        demo_push.update_payload(filming, now=100)["aps"]["stale-date"]
        == 100 + demo_push.FILMING_STALE_SECONDS
    )


# ================================================================== the decision, as builder_app


def _rows(sql: str, **params):
    with owner_engine().connect() as c:
        return c.execute(text(sql), params).all()


def _ask(client, p: dict) -> dict:
    r = client.post(
        "/v1/demos/requests", json={"project_key": p["key"], "hue": "orchid"}, headers=p["phone"]
    )
    assert r.status_code in (200, 201), r.text
    return r.json()["request"]


def _register(client, phone, **body):
    return client.post(
        "/v1/push/demo-activity", json={"environment": "sandbox", **body}, headers=phone
    )


def _updates(fake: _APNs) -> list[dict]:
    return [p for p in fake.live() if p["body"]["aps"]["event"] == "update"]


def _ends(fake: _APNs) -> list[dict]:
    return [p for p in fake.live() if p["body"]["aps"]["event"] == "end"]


def _finish(client, p: dict, rid: str, status: str, refusal: str | None = None):
    r = client.post(
        f"/v1/demos/requests/{rid}:finish",
        json={"status": status, "refusal": refusal},
        headers=p["mac"],
    )
    assert r.status_code == 200, r.text


@needs_db
def test_a_token_is_registered_by_the_phone_and_is_that_persons_alone(client, created_users):
    a = _person(client, created_users)
    req = _ask(client, a)
    r = _register(client, a["phone"], request_id=req["id"], activity_id="act-1", token=CARD)
    assert r.status_code == 200, r.text
    mine = _rows(
        "SELECT request_id, activity_id, shown_phase FROM demo_activity_tokens WHERE user_id = :u",
        u=a["uid"],
    )
    assert [(str(m.request_id), m.activity_id, m.shown_phase) for m in mine] == [
        (req["id"], "act-1", "asked")
    ]

    # A paired Mac has no Live Activity and may not hold a token.
    assert (
        _register(client, a["mac"], request_id=req["id"], activity_id="m", token="ef" * 40)
    ).status_code == 403

    # Another account, a real one whose own routes work (so a 404 is the owner check, not a dead
    # token): it cannot file a token under my request, nor take mine down.
    b = _person(client, created_users)
    theirs = _ask(client, b)["id"]
    ok = _register(client, b["phone"], request_id=theirs, activity_id="b-1", token="01" * 40)
    assert ok.status_code == 200
    stolen = _register(client, b["phone"], request_id=req["id"], activity_id="b-x", token="02" * 40)
    assert stolen.status_code == 404
    assert client.delete("/v1/push/demo-activity/act-1", headers=b["phone"]).status_code == 204
    assert len(_rows("SELECT id FROM demo_activity_tokens WHERE user_id = :u", u=a["uid"])) == 1

    # And under RLS itself, as builder_app with the other account as the viewer: my rows are
    # invisible, and a row naming me, or naming my request under its own id, is refused by WITH
    # CHECK. The request id is resolved OUTSIDE the restricted connection, so the insert really
    # reaches the policy (CLAUDE.md: a negative test that cannot reach the code passes for the
    # wrong reason).
    with app_engine().connect() as c:
        c.execute(text("SELECT set_config('app.viewer_id', :v, false)"), {"v": b["uid"]})
        assert (
            c.execute(
                text("SELECT count(*) FROM demo_activity_tokens WHERE user_id = :u"),
                {"u": a["uid"]},
            ).scalar()
            == 0
        )
        for owner in (a["uid"], b["uid"]):
            with pytest.raises(Exception, match="row-level security"), c.begin_nested():
                c.execute(
                    text(
                        "INSERT INTO demo_activity_tokens "
                        "(user_id, request_id, activity_id, token, environment) "
                        "VALUES (:u, :r, 'x', :t, 'sandbox')"
                    ),
                    {"u": owner, "r": req["id"], "t": uuid.uuid4().hex * 2},
                )
        c.rollback()

    # The card ended: its token is gone.
    assert client.delete("/v1/push/demo-activity/act-1", headers=a["phone"]).status_code == 204
    assert _rows("SELECT id FROM demo_activity_tokens WHERE user_id = :u", u=a["uid"]) == []


@needs_db
def test_a_malformed_registration_is_a_422_not_a_500(client, created_users):
    a = _person(client, created_users)
    req = _ask(client, a)
    bad = [
        {"activity_id": "a", "token": CARD},  # names no request
        {"request_id": "not-a-uuid", "activity_id": "a", "token": CARD},
        {"request_id": req["id"], "activity_id": "a", "token": "not hex"},
        {"request_id": req["id"], "activity_id": "a b", "token": CARD},
        {"request_id": req["id"], "activity_id": "a", "token": CARD, "showing": "sent"},
        {"request_id": req["id"], "activity_id": "a", "token": CARD, "kind": "push_to_start"},
    ]
    for body in bad:
        assert _register(client, a["phone"], **body).status_code == 422, body
    assert client.delete("/v1/push/demo-activity/a%20b", headers=a["phone"]).status_code == 422


def _shown(token: str = CARD) -> str:
    return _rows("SELECT shown_phase FROM demo_activity_tokens WHERE token = :t", t=token)[
        0
    ].shown_phase


@needs_db
def test_the_mac_claiming_and_finishing_moves_the_card_forward_once(
    client, created_users, apns, store
):
    a = _person(client, created_users)
    req = _ask(client, a)
    _register(client, a["phone"], request_id=req["id"], activity_id="act-1", token=CARD)
    assert _updates(apns) == []  # it shows asked, and the request is still queued

    # The Mac claims it: filming, quietly, still counting from the ask.
    client.post("/v1/demos/requests:claim", headers=a["mac"])
    ups = _updates(apns)
    assert len(ups) == 1
    assert ups[0]["url"].endswith(f"/3/device/{CARD}")
    assert ups[0]["headers"]["apns-push-type"] == "liveactivity"
    assert ups[0]["headers"]["apns-priority"] == "5"
    aps = ups[0]["body"]["aps"]
    assert tuple(aps["content-state"]) == demo_push.CONTENT_STATE_KEYS
    assert aps["content-state"]["phase"] == "filming"
    assert aps["content-state"]["sinceEpoch"] == demo_push.js_round(
        demo_push._epoch(req["created_at"])
    )
    assert "alert" not in aps

    # A second claim takes nothing and says nothing.
    client.post("/v1/demos/requests:claim", headers=a["mac"])
    assert len(_updates(apns)) == 1

    # Done, the default worker's way: the kit stays on the Mac, so the card says made, quietly,
    # and never "the kit is up" over a screen with nothing new on it.
    _finish(client, a, req["id"], "done")
    ups = _updates(apns)
    assert len(ups) == 2
    made = ups[1]["body"]["aps"]
    assert made["content-state"]["phase"] == "made"
    assert "alert" not in made
    assert ups[1]["headers"]["apns-priority"] == "5"
    assert _shown() == "made"

    # The kit is published on the Mac later: the card moves on to ready, with the alert, and no
    # end (iOS would pull the card as it lands).
    _publish(client, a)
    ups = _updates(apns)
    assert len(ups) == 3
    answer = ups[2]["body"]["aps"]
    assert answer["content-state"]["phase"] == "ready"
    assert answer["content-state"]["failure"] is None
    assert answer["alert"]["title"] == "The kit is up"
    assert ups[2]["headers"]["apns-priority"] == "10"
    assert _ends(apns) == []
    assert _shown() == "ready"
    # A second publish is not news.
    _publish(client, a)
    assert len(_updates(apns)) == 3
    # No banner rides along: the card's alert is the one moment.
    assert apns.banners() == []


@needs_db
def test_a_worker_that_publishes_before_it_finishes_goes_straight_to_ready(
    client, created_users, apns, store
):
    """`watch --publish-requests`: the kit is published while the request is still claimed (no
    push: the card is filming and stays filming), then the finish says ready, with the alert."""
    a = _person(client, created_users)
    req = _ask(client, a)
    _register(client, a["phone"], request_id=req["id"], activity_id="act-p", token=CARD)
    client.post("/v1/demos/requests:claim", headers=a["mac"])
    _publish(client, a)
    assert [u["body"]["aps"]["content-state"]["phase"] for u in _updates(apns)] == ["filming"]
    _finish(client, a, req["id"], "done")
    ups = _updates(apns)
    assert [u["body"]["aps"]["content-state"]["phase"] for u in ups] == ["filming", "ready"]
    assert ups[1]["body"]["aps"]["alert"]["title"] == "The kit is up"


@needs_db
def test_a_kit_from_before_the_claim_is_not_this_requests(client, created_users, apns, store):
    """An older kit of the project was already up when the Mac took this request: done is made."""
    a = _person(client, created_users)
    _publish(client, a)
    req = _ask(client, a)
    _register(client, a["phone"], request_id=req["id"], activity_id="act-o", token=CARD)
    client.post("/v1/demos/requests:claim", headers=a["mac"])
    _finish(client, a, req["id"], "done")
    assert [u["body"]["aps"]["content-state"]["phase"] for u in _updates(apns)] == [
        "filming",
        "made",
    ]


@needs_db
def test_a_publish_moves_only_that_projects_cards(client, created_users, apns, store):
    """Two projects of one person, both made; a kit for one moves that card and not the other."""
    a = _person(client, created_users)
    other_key = uuid.uuid4().hex * 2
    from test_sync import _payload, _upload

    assert _upload(client, a["mac"], _payload(repo_hash=other_key))["accepted"] == 1
    b = {**a, "key": other_key}
    for p, token, act in ((a, CARD, "act-a"), (b, "ab" * 40, "act-b")):
        r = _ask(client, p)
        _register(client, p["phone"], request_id=r["id"], activity_id=act, token=token)
    for q in client.post("/v1/demos/requests:claim", headers=a["mac"]).json()["requests"]:
        _finish(client, a, q["id"], "done")
    assert _shown(CARD) == "made" and _shown("ab" * 40) == "made"
    _publish(client, b)
    assert _shown(CARD) == "made"
    assert _shown("ab" * 40) == "ready"


@needs_db
def test_a_failure_carries_the_kit_screens_words(client, created_users, apns):
    a = _person(client, created_users)
    req = _ask(client, a)
    _register(client, a["phone"], request_id=req["id"], activity_id="act-2", token=CARD)
    client.post("/v1/demos/requests:claim", headers=a["mac"])
    _finish(client, a, req["id"], "failed", "capture_failed")
    ups = _updates(apns)
    assert [u["body"]["aps"]["content-state"]["phase"] for u in ups] == ["filming", "failed"]
    state = ups[1]["body"]["aps"]["content-state"]
    assert state["failure"] == "the Mac could not film it"
    assert ups[1]["body"]["aps"]["alert"] == {
        "title": "No kit this time",
        "body": "It did not work: the Mac could not film it.",
    }


@needs_db
def test_a_card_that_registers_late_catches_up_at_once(client, created_users, apns):
    """A fast Mac claims (or finishes) before the phone's card has handed over its token."""
    a = _person(client, created_users)
    req = _ask(client, a)
    client.post("/v1/demos/requests:claim", headers=a["mac"])
    _finish(client, a, req["id"], "done")
    r = _register(
        client, a["phone"], request_id=req["id"], activity_id="act-3", token=CARD, showing="asked"
    )
    assert r.json()["caught_up"] == 1
    assert [u["body"]["aps"]["content-state"]["phase"] for u in _updates(apns)] == ["made"]
    # A card that already shows where it stands is not told it again; one that says more than the
    # server knows (the phone saw the kit first) is not stepped back either.
    for token, showing in (("ee" * 40, "made"), ("ef" * 40, "ready")):
        r = _register(
            client,
            a["phone"],
            request_id=req["id"],
            activity_id=f"act-{showing}",
            token=token,
            showing=showing,
        )
        assert r.json()["caught_up"] == 0


@needs_db
def test_an_answer_comes_down_after_its_hold_on_the_macs_next_poll(client, created_users, apns):
    """No end on the answer itself; the Mac's claim poll, the one clock the server has, ends it
    once it has had its time in the island, and forgets the token."""
    a = _person(client, created_users)
    req = _ask(client, a)
    _register(client, a["phone"], request_id=req["id"], activity_id="act-5", token=CARD)
    client.post("/v1/demos/requests:claim", headers=a["mac"])
    _finish(client, a, req["id"], "done")
    client.post("/v1/demos/requests:claim", headers=a["mac"])
    assert _ends(apns) == []

    with owner_engine().begin() as c:
        c.execute(
            text(
                "UPDATE demo_activity_tokens "
                "SET last_pushed_at = now() - make_interval(secs => :s) WHERE token = :t"
            ),
            {"s": demo_push.ANSWER_HOLD_SECONDS + 5, "t": CARD},
        )
    client.post("/v1/demos/requests:claim", headers=a["mac"])
    ends = _ends(apns)
    assert len(ends) == 1
    aps = ends[0]["body"]["aps"]
    assert aps["dismissal-date"] == aps["timestamp"]
    # Made, here (no kit was published): it has had its hold too, and comes down the same way.
    assert aps["content-state"]["phase"] == "made"
    assert _rows("SELECT id FROM demo_activity_tokens WHERE user_id = :u", u=a["uid"]) == []
    # And once only: the token is gone, so the next poll has nothing to end.
    client.post("/v1/demos/requests:claim", headers=a["mac"])
    assert len(_ends(apns)) == 1


@needs_db
def test_a_filming_card_is_never_ended_by_the_hold(client, created_users, apns):
    """The hold is for answers. A long film (a cold build is 25 minutes) keeps its card."""
    a = _person(client, created_users)
    req = _ask(client, a)
    _register(client, a["phone"], request_id=req["id"], activity_id="act-6", token=CARD)
    client.post("/v1/demos/requests:claim", headers=a["mac"])
    with owner_engine().begin() as c:
        c.execute(
            text(
                "UPDATE demo_activity_tokens SET last_pushed_at = now() - interval '2 hours' "
                "WHERE token = :t"
            ),
            {"t": CARD},
        )
    client.post("/v1/demos/requests:claim", headers=a["mac"])
    assert _ends(apns) == []


@needs_db
def test_taken_back_the_card_comes_down_at_once(client, created_users, apns):
    a = _person(client, created_users)
    req = _ask(client, a)
    _register(client, a["phone"], request_id=req["id"], activity_id="act-7", token=CARD)
    assert client.delete(f"/v1/demos/requests/{req['id']}", headers=a["phone"]).status_code == 200
    ends = _ends(apns)
    assert len(ends) == 1 and ends[0]["url"].endswith(f"/3/device/{CARD}")
    # No state to show: a cancelled request has no card, so the end carries none.
    assert "content-state" not in ends[0]["body"]["aps"]
    assert _rows("SELECT id FROM demo_activity_tokens WHERE user_id = :u", u=a["uid"]) == []


@needs_db
def test_nothing_is_sent_when_there_is_no_token(client, created_users, apns):
    a = _person(client, created_users)
    req = _ask(client, a)
    client.post("/v1/demos/requests:claim", headers=a["mac"])
    _finish(client, a, req["id"], "done")
    assert apns.live() == []


@needs_db
def test_no_push_ever_reaches_somebody_who_did_not_ask(client, created_users, apns):
    a = _person(client, created_users)
    b = _person(client, created_users)
    theirs = _ask(client, b)
    _register(client, b["phone"], request_id=theirs["id"], activity_id="b-1", token="0b" * 40)
    before = len(apns.posts)

    # Mine: asked, claimed, finished, taken back. I hold no token at all.
    mine = _ask(client, a)
    client.post("/v1/demos/requests:claim", headers=a["mac"])
    _finish(client, a, mine["id"], "done")
    again = _ask(client, a)
    client.delete(f"/v1/demos/requests/{again['id']}", headers=a["phone"])

    sent = apns.posts[before:]
    assert [p for p in sent if "0b" * 40 in p["url"]] == []
    assert [p for p in sent if p["headers"].get("apns-push-type") == "liveactivity"] == []


@needs_db
def test_without_an_apns_key_nothing_is_sent_and_it_says_so(
    client, created_users, monkeypatch, caplog
):
    from builder.routes import push
    from builder.settings import settings

    class _Refuse:
        def __init__(self, **kw):
            raise AssertionError("no APNs key, so no connection may be opened")

    monkeypatch.setenv("APNS_PRIVATE_KEY", "")
    settings.cache_clear()
    monkeypatch.setattr(push.httpx, "Client", _Refuse)
    a = _person(client, created_users)
    req = _ask(client, a)
    _register(client, a["phone"], request_id=req["id"], activity_id="act-8", token=CARD)
    with caplog.at_level(logging.INFO, logger="builder.demo_push"):
        assert client.post("/v1/demos/requests:claim", headers=a["mac"]).status_code == 200
    lines = [r for r in caplog.records if r.name == "builder.demo_push"]
    assert len(lines) == 1 and "APNs is not configured" in lines[0].getMessage()
    # The decision is still recorded, so a key added later does not replay old moves.
    assert (
        _rows("SELECT shown_phase FROM demo_activity_tokens WHERE token = :t", t=CARD)[
            0
        ].shown_phase
        == "filming"
    )


@needs_db
def test_the_token_goes_with_its_request(client, created_users):
    """Exclusion and account deletion delete requests; their tokens go with them (the cascade),
    so no push can outlive the thing it was about."""
    a = _person(client, created_users)
    req = _ask(client, a)
    _register(client, a["phone"], request_id=req["id"], activity_id="act-9", token=CARD)
    with owner_engine().begin() as c:
        c.execute(text("DELETE FROM demo_requests WHERE id = :r"), {"r": req["id"]})
    assert _rows("SELECT id FROM demo_activity_tokens WHERE token = :t", t=CARD) == []
