"""The drop island: a shared reel's Live Activity, started and moved by push (docs/drop-island.md).

Two halves, tested the way each can fail, as test_live_push.py does for a session's card:

  * THE CARD (`drop_push.content_state`) is pure, so it is held to the Swift struct it must fill
    (read out of BuilderDropAttributes.swift: a key the struct lacks is dropped by ActivityKit
    with no error), to the Swift phases the views switch on, to the migration's CHECK list, and to
    `spec/fixtures/drops/activity_state.json`, the file the phone's own half is held to as well.
  * THE DECISION runs through the real routes AS builder_app, RLS on, with the APNs http2 client
    replaced by test_live_push's double (APNs cannot be reached from here): what was POSTed, to
    which token, with which headers, and what the token rows remember afterwards. The rules the
    task names, each with a test: registration and its RLS, a start on create, an update on each
    transition, nothing when there is no token, and nothing ever for a drop the person did not
    share.
"""

import ast
import json
import logging
import pathlib
import re
import uuid

import pytest
from sqlalchemy import text
from test_drops import REEL, _resolution, _share
from test_live_push import _APNs, apns  # noqa: F401 - the APNs double, picked up by name
from test_sync import (  # noqa: F401 - fixtures are picked up by name
    TEST_DB,
    _pair,
    _phone_for,
    app_engine,
    app_env,
    client,
    created_users,
    owner_engine,
    paired,
)

from builder import drop_push

_SHARED_FIXTURES = (app_env, client, created_users, paired, apns)

ROOT = pathlib.Path(__file__).resolve().parents[2]
SWIFT = ROOT / "mobile/modules/builder-live/ios/BuilderDropAttributes.swift"
VIEWS = ROOT / "mobile/targets/widget/_shared/DropActivityViews.swift"
FIXTURE = ROOT / "spec/fixtures/drops/activity_state.json"
MIGRATION = ROOT / "server/alembic/versions/0031_drop_activity_tokens.py"

needs_db = pytest.mark.skipif(not TEST_DB, reason="set BUILDER_TEST_DB to run")

PUSH_TO_START = "ab" * 40
CARD = "cd" * 40


def _swift_vars(src: str, start: str, stop: str) -> list[str]:
    i = src.index(start)
    block = src[i : src.index(stop, i + len(start))]
    return re.findall(r"public var (\w+):", block)


# ================================================================== the card, pure


def test_the_state_is_the_swift_structs_fields_in_order():
    src = SWIFT.read_text()
    assert _swift_vars(src, "struct ContentState", "public init(") == list(
        drop_push.CONTENT_STATE_KEYS
    )
    outer = src[src.index("/// The server's drop uuid.") :]
    assert _swift_vars(outer, "public var dropId", "public init(") == list(drop_push.ATTRIBUTE_KEYS)


def test_the_attributes_type_is_the_swift_structs_name():
    """A push-to-start names its type by string; a rename on the phone is a start that never
    arrives, with no error on either side."""
    assert f"public struct {drop_push.ATTRIBUTES_TYPE}: ActivityAttributes" in SWIFT.read_text()


def test_the_phases_are_the_ones_the_views_switch_on():
    m = re.search(r"enum Phase: String \{\s*case ([^\n]+)", VIEWS.read_text())
    assert m is not None
    assert [p.strip() for p in m.group(1).split(",")] == list(drop_push.PHASES)


def test_the_migrations_check_list_is_the_phases():
    """0031's CHECK, read with `ast` (test_drops.py records why a regex on a line is not enough)."""
    tree = ast.parse(MIGRATION.read_text())
    literal = next(
        ast.literal_eval(node.value)
        for node in tree.body
        if isinstance(node, ast.Assign)
        and any(getattr(t, "id", "") == "DROP_PHASE" for t in node.targets)
    )
    assert re.findall(r"'([a-z]+)'", literal) == list(drop_push.PHASES)


def test_every_status_has_a_phase_or_is_no_card():
    from builder.drops_spec import ANALYSIS_ENUM_VALUES

    for status in ANALYSIS_ENUM_VALUES["drop_status"]:
        assert status == "archived" or drop_push.phase_of(status) in drop_push.PHASES


@pytest.mark.parametrize("case", json.loads(FIXTURE.read_text())["cases"], ids=lambda c: c["name"])
def test_the_shared_fixture(case):
    """The file the phone's `dropState` is held to, case for case."""
    got = drop_push.content_state(
        case["drop"], case["moves"], now=case["now"], started_move_id=case.get("started_move_id")
    )
    assert got == case["expect"]
    if got is not None:
        assert tuple(got) == drop_push.CONTENT_STATE_KEYS


def test_the_host_rule():
    for url, host in json.loads(FIXTURE.read_text())["hosts"]:
        assert drop_push.host_of(url) == host, url


def test_a_start_carries_the_type_its_attributes_and_an_alert():
    drop = {
        "id": "d-1",
        "url": "https://www.instagram.com/reel/x",
        "platform": "instagram",
        "status": "waiting",
    }
    state = drop_push.content_state(drop, [], now=100, phase="sent")
    aps = drop_push.start_payload(drop, state, now=100)["aps"]
    assert aps["event"] == "start"
    assert aps["attributes-type"] == "BuilderDropAttributes"
    assert aps["attributes"] == {"dropId": "d-1", "host": "instagram.com", "platform": "instagram"}
    assert aps["content-state"]["phase"] == "sent"
    # ActivityKit shows a pushed start only with an alert.
    assert aps["alert"]["title"] and aps["alert"]["body"] == "instagram.com"
    assert "sound" not in aps["alert"]
    assert aps["stale-date"] == 100 + drop_push.READING_STALE_SECONDS


# ================================================================== the decision, as builder_app


def _rows(sql: str, **params):
    with owner_engine().connect() as c:
        return c.execute(text(sql), params).all()


def _register(client, phone, **body):
    return client.post(
        "/v1/push/drop-activity", json={"environment": "sandbox", **body}, headers=phone
    )


def _start_posts(fake: _APNs) -> list[dict]:
    return [p for p in fake.live() if p["body"]["aps"]["event"] == "start"]


def _update_posts(fake: _APNs) -> list[dict]:
    return [p for p in fake.live() if p["body"]["aps"]["event"] == "update"]


@needs_db
def test_a_token_is_registered_by_the_phone_and_is_that_persons_alone(
    client, paired, created_users
):
    uid, mac = paired
    phone = _phone_for(mac)
    drop = _share(client, mac).json()["drop"]

    assert _register(client, phone, kind="push_to_start", token=PUSH_TO_START).status_code == 200
    r = _register(
        client,
        phone,
        kind="activity",
        drop_id=drop["id"],
        activity_id="act-1",
        token=CARD,
        showing="sent",
    )
    assert r.status_code == 200, r.text
    mine = _rows(
        "SELECT kind, drop_id, shown_phase FROM drop_activity_tokens "
        "WHERE user_id = :u ORDER BY kind",
        u=uid,
    )
    assert [(m.kind, m.drop_id and str(m.drop_id), m.shown_phase) for m in mine] == [
        ("activity", drop["id"], "sent"),
        ("push_to_start", None, None),
    ]

    # A paired Mac has no Live Activity and may not hold a token.
    assert _register(client, mac, kind="push_to_start", token="ef" * 40).status_code == 403

    # Another account: a real one, whose own routes work (so a 404 is RLS, not a dead token).
    other_uid, other_mac = _pair(client, created_users)
    other = _phone_for(other_mac)
    assert _register(client, other, kind="push_to_start", token="01" * 40).status_code == 200
    stolen = _register(
        client, other, kind="activity", drop_id=drop["id"], activity_id="act-x", token="02" * 40
    )
    assert stolen.status_code == 404
    # It cannot take mine down either: its delete touches its own rows only.
    assert client.delete("/v1/push/drop-activity/act-1", headers=other).status_code == 204
    assert (
        client.delete(f"/v1/push/drop-activity-start/{PUSH_TO_START}", headers=other).status_code
        == 204
    )
    assert len(_rows("SELECT id FROM drop_activity_tokens WHERE user_id = :u", u=uid)) == 2
    assert (
        _rows(
            "SELECT id FROM drop_activity_tokens WHERE user_id = :u AND drop_id IS NOT NULL",
            u=other_uid,
        )
        == []
    )

    # And under RLS itself, as builder_app with the other account as the viewer: my rows are
    # invisible, and a row naming me, or naming my drop, is refused by WITH CHECK. The drop id is
    # resolved OUTSIDE the restricted connection, so the insert really reaches the policy
    # (CLAUDE.md: a negative test that cannot reach the code passes for the wrong reason).
    with app_engine().connect() as c:
        c.execute(text("SELECT set_config('app.viewer_id', :v, false)"), {"v": other_uid})
        assert (
            c.execute(
                text("SELECT count(*) FROM drop_activity_tokens WHERE user_id = :u"), {"u": uid}
            ).scalar()
            == 0
        )
        for row in (
            {"u": uid, "k": "push_to_start", "d": None, "a": None},
            {"u": other_uid, "k": "activity", "d": drop["id"], "a": "act-y"},
        ):
            with pytest.raises(Exception, match="row-level security"), c.begin_nested():
                c.execute(
                    text(
                        "INSERT INTO drop_activity_tokens "
                        "(user_id, kind, drop_id, activity_id, token, environment) "
                        "VALUES (:u, :k, :d, :a, :t, 'sandbox')"
                    ),
                    {**row, "t": uuid.uuid4().hex * 2},
                )
        c.rollback()

    # The card ended: its token is gone, the app's push-to-start token stays.
    assert client.delete("/v1/push/drop-activity/act-1", headers=phone).status_code == 204
    assert [
        m.kind for m in _rows("SELECT kind FROM drop_activity_tokens WHERE user_id = :u", u=uid)
    ] == ["push_to_start"]
    assert (
        client.delete(f"/v1/push/drop-activity-start/{PUSH_TO_START}", headers=phone).status_code
        == 204
    )
    assert _rows("SELECT id FROM drop_activity_tokens WHERE user_id = :u", u=uid) == []


@needs_db
def test_a_malformed_registration_is_a_422_not_a_500(client, paired):
    _uid, mac = paired
    phone = _phone_for(mac)
    drop = _share(client, mac).json()["drop"]
    bad = [
        {"kind": "activity", "token": CARD},  # names no drop
        {"kind": "push_to_start", "token": PUSH_TO_START, "drop_id": drop["id"]},
        {"kind": "push_to_start", "token": "not hex"},
        {
            "kind": "activity",
            "token": CARD,
            "drop_id": drop["id"],
            "activity_id": "a",
            "showing": "done",
        },
    ]
    for body in bad:
        assert _register(client, phone, **body).status_code == 422, body


@needs_db
def test_a_new_share_starts_a_card_by_push(client, paired, apns):
    uid, mac = paired
    phone = _phone_for(mac)
    _register(client, phone, kind="push_to_start", token=PUSH_TO_START)

    drop = _share(client, mac).json()["drop"]
    starts = _start_posts(apns)
    assert len(starts) == 1
    post = starts[0]
    assert post["url"].endswith(f"/3/device/{PUSH_TO_START}")
    assert post["headers"]["apns-push-type"] == "liveactivity"
    assert post["headers"]["apns-topic"].endswith(".push-type.liveactivity")
    assert post["headers"]["apns-priority"] == "10"
    aps = post["body"]["aps"]
    assert aps["attributes-type"] == "BuilderDropAttributes"
    assert aps["attributes"] == {"dropId": drop["id"], "host": "tiktok.com", "platform": "tiktok"}
    assert tuple(aps["content-state"]) == drop_push.CONTENT_STATE_KEYS
    assert aps["content-state"]["phase"] == "sent"

    # The same reel again is the card you already have: no second island.
    assert _share(client, mac, url=REEL).json()["created"] is False
    assert len(_start_posts(apns)) == 1


@needs_db
def test_each_transition_moves_the_card_forward_once(client, paired, apns):
    uid, mac = paired
    phone = _phone_for(mac)
    drop = _share(client, mac).json()["drop"]
    _register(
        client,
        phone,
        kind="activity",
        drop_id=drop["id"],
        activity_id="act-1",
        token=CARD,
        showing="sent",
    )
    assert _update_posts(apns) == []  # it shows sent, and the drop is still waiting

    # The Mac claims it: reading, quietly.
    client.post("/v1/drops:claim", headers=mac)
    ups = _update_posts(apns)
    assert len(ups) == 1
    assert ups[0]["url"].endswith(f"/3/device/{CARD}")
    assert ups[0]["body"]["aps"]["content-state"]["phase"] == "reading"
    assert ups[0]["headers"]["apns-priority"] == "5"
    assert "alert" not in ups[0]["body"]["aps"]

    # It is read: the answer, with the alert, and NOT the banner as well (one moment, one alert).
    client.put(f"/v1/drops/{drop['id']}/resolution", json=_resolution(), headers=mac)
    ups = _update_posts(apns)
    assert len(ups) == 2
    answer = ups[1]["body"]["aps"]
    move = client.get(f"/v1/drops/{drop['id']}", headers=mac).json()["moves"][0]
    assert answer["content-state"] == {
        "phase": "planned",
        "title": "5 beginner Claude Skills to install",
        "moves": 1,
        "firstMoveTitle": "Go find the 5 skills",
        "firstMoveId": move["id"],
        "kind": "skill",
        "updatedEpoch": answer["content-state"]["updatedEpoch"],
    }
    assert answer["alert"]["title"] == "5 beginner Claude Skills to install"
    assert ups[1]["headers"]["apns-priority"] == "10"
    assert apns.banners() == []
    assert (
        _rows("SELECT shown_phase FROM drop_activity_tokens WHERE token = :t", t=CARD)[
            0
        ].shown_phase
        == "planned"
    )

    # A second reading of a planned drop is not news; a claim retried is not a step back.
    client.put(f"/v1/drops/{drop['id']}/resolution", json=_resolution(), headers=mac)
    client.post("/v1/drops:claim", headers=mac)
    assert len(_update_posts(apns)) == 2

    # Start, from the board or from the island: the card says so. (The second resolution
    # replaced the offered moves, so the one to start is read again.)
    move = client.get(f"/v1/drops/{drop['id']}", headers=mac).json()["moves"][0]
    assert (
        client.post(
            f"/v1/drops/{drop['id']}/moves/{move['id']}:start", json={}, headers=mac
        ).status_code
        == 200
    )
    ups = _update_posts(apns)
    assert len(ups) == 3
    assert ups[2]["body"]["aps"]["content-state"]["phase"] == "started"
    assert ups[2]["body"]["aps"]["content-state"]["firstMoveId"] == move["id"]


@needs_db
def test_a_refusal_moves_the_card_to_refused(client, paired, apns):
    _uid, mac = paired
    phone = _phone_for(mac)
    drop = _share(client, mac).json()["drop"]
    _register(client, phone, kind="activity", drop_id=drop["id"], activity_id="act-2", token=CARD)
    client.put(f"/v1/drops/{drop['id']}/refusal", json={"refusal": "private_or_gone"}, headers=mac)
    ups = _update_posts(apns)
    assert [u["body"]["aps"]["content-state"]["phase"] for u in ups] == ["refused"]
    assert "private or has been taken down" in ups[0]["body"]["aps"]["alert"]["body"]
    assert apns.banners() == []


@needs_db
def test_a_card_that_registers_late_catches_up_at_once(client, paired, apns):
    """A fast Mac reads the reel before the phone's card has handed over its token."""
    _uid, mac = paired
    phone = _phone_for(mac)
    drop = _share(client, mac).json()["drop"]
    client.put(f"/v1/drops/{drop['id']}/resolution", json=_resolution(), headers=mac)
    r = _register(
        client,
        phone,
        kind="activity",
        drop_id=drop["id"],
        activity_id="act-3",
        token=CARD,
        showing="sent",
    )
    assert r.json()["caught_up"] == 1
    assert [u["body"]["aps"]["content-state"]["phase"] for u in _update_posts(apns)] == ["planned"]
    # A card that already shows the answer is not told it again.
    r = _register(
        client,
        phone,
        kind="activity",
        drop_id=drop["id"],
        activity_id="act-4",
        token="ee" * 40,
        showing="planned",
    )
    assert r.json()["caught_up"] == 0


@needs_db
def test_nothing_is_sent_when_there_is_no_token(client, paired, apns):
    """No card anywhere: the whole walk sends no liveactivity push, and the read banner is the
    one thing that says it was read, as it was before the island."""
    _uid, mac = paired
    drop = _share(client, mac).json()["drop"]
    client.post("/v1/drops:claim", headers=mac)
    client.put(f"/v1/drops/{drop['id']}/resolution", json=_resolution(), headers=mac)
    assert apns.live() == []


@needs_db
def test_no_push_ever_reaches_somebody_who_did_not_share_it(client, paired, created_users, apns):
    uid, mac = paired
    # Somebody else, with every kind of token, and a drop of their own with a card.
    _other_uid, other_mac = _pair(client, created_users)
    other = _phone_for(other_mac)
    theirs = _share(client, other_mac, url="https://www.instagram.com/reel/theirs").json()["drop"]
    _register(client, other, kind="push_to_start", token="0a" * 40)
    _register(
        client,
        other,
        kind="activity",
        drop_id=theirs["id"],
        activity_id="theirs-1",
        token="0b" * 40,
    )
    before = len(apns.posts)

    # Mine: shared, claimed, read, started. I hold no token at all.
    drop = _share(client, mac, url="https://www.tiktok.com/@a/video/42").json()["drop"]
    client.post("/v1/drops:claim", headers=mac)
    client.put(f"/v1/drops/{drop['id']}/resolution", json=_resolution(), headers=mac)
    move = client.get(f"/v1/drops/{drop['id']}", headers=mac).json()["moves"][0]
    client.post(f"/v1/drops/{drop['id']}/moves/{move['id']}:start", json={}, headers=mac)

    sent = apns.posts[before:]
    assert [p for p in sent if "0a" * 40 in p["url"] or "0b" * 40 in p["url"]] == []
    assert [p for p in sent if p["headers"].get("apns-push-type") == "liveactivity"] == []


@needs_db
def test_without_an_apns_key_nothing_is_sent_and_it_says_so(client, paired, monkeypatch, caplog):
    from builder.routes import push
    from builder.settings import settings

    class _Refuse:
        def __init__(self, **kw):
            raise AssertionError("no APNs key, so no connection may be opened")

    monkeypatch.setenv("APNS_PRIVATE_KEY", "")
    settings.cache_clear()
    monkeypatch.setattr(push.httpx, "Client", _Refuse)
    _uid, mac = paired
    phone = _phone_for(mac)
    _register(client, phone, kind="push_to_start", token=PUSH_TO_START)
    with caplog.at_level(logging.INFO, logger="builder.drop_push"):
        drop = _share(client, mac).json()["drop"]
        _register(
            client, phone, kind="activity", drop_id=drop["id"], activity_id="act-5", token=CARD
        )
        assert client.post("/v1/drops:claim", headers=mac).status_code == 200
    assert "APNs is not configured" in caplog.text
    # The decision is still recorded, so a key added later does not replay old moves.
    assert (
        _rows("SELECT shown_phase FROM drop_activity_tokens WHERE token = :t", t=CARD)[
            0
        ].shown_phase
        == "reading"
    )


@needs_db
def test_an_answer_comes_down_after_its_hold_on_the_macs_next_poll(client, paired, apns):
    """No end on the answer itself (iOS would take the card out of the island as it lands); the
    Mac's claim poll, the one clock the server has, ends it once it has had its time there."""
    uid, mac = paired
    phone = _phone_for(mac)
    drop = _share(client, mac).json()["drop"]
    _register(client, phone, kind="activity", drop_id=drop["id"], activity_id="act-6", token=CARD)
    client.put(f"/v1/drops/{drop['id']}/resolution", json=_resolution(), headers=mac)
    client.post("/v1/drops:claim", headers=mac)
    assert [p for p in apns.live() if p["body"]["aps"]["event"] == "end"] == []

    with owner_engine().begin() as c:
        c.execute(
            text(
                "UPDATE drop_activity_tokens "
                "SET last_pushed_at = now() - make_interval(secs => :s) "
                "WHERE token = :t"
            ),
            {"s": drop_push.ANSWER_HOLD_SECONDS + 5, "t": CARD},
        )
    client.post("/v1/drops:claim", headers=mac)
    ends = [p for p in apns.live() if p["body"]["aps"]["event"] == "end"]
    assert len(ends) == 1
    aps = ends[0]["body"]["aps"]
    assert aps["dismissal-date"] == aps["timestamp"]
    assert aps["content-state"]["phase"] == "planned"
    assert _rows("SELECT id FROM drop_activity_tokens WHERE user_id = :u", u=uid) == []
    # And once only: the token is gone, so the next poll has nothing to end.
    client.post("/v1/drops:claim", headers=mac)
    assert len([p for p in apns.live() if p["body"]["aps"]["event"] == "end"]) == 1


@needs_db
def test_a_token_both_hosts_refuse_is_forgotten(client, paired, apns):
    _uid, mac = paired
    phone = _phone_for(mac)
    _register(client, phone, kind="push_to_start", token=PUSH_TO_START)
    apns.answers = [(400, "BadDeviceToken"), (410, "Unregistered")]
    _share(client, mac)
    assert _rows("SELECT id FROM drop_activity_tokens WHERE token = :t", t=PUSH_TO_START) == []
