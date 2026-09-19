"""Ship kits and demo requests (0030, docs/ship-kit.md) AS builder_app, through the real routes.

What this file holds, each of which would fail OPEN with no error if it failed at all:

  1. ONE PERSON'S REQUESTS AND KITS ARE THEIRS. Every route, through a second real account's
     token (made here, never skipped for want of one: CLAUDE.md, the drops RLS test), and the
     policies below the routes, as builder_app, with the victim's ids resolved through the owner
     engine first and a positive control beside every refusal.
  2. A REQUEST IS ONE LIVE REQUEST A PROJECT, claimed once, finished once, with a code.
  3. A KIT IS A SET: shown only once its document arrives with nothing pending, replacing the
     older kit's rows AND objects (checked on disk), never shown in parts.
  4. THE DOOR: a GIF only in the loop slot, a video with a length, a label by the demo rule, a
     caption within its platform's limit, a capture key nowhere.
  5. EXCLUDING THE REPOSITORY AND DELETING THE ACCOUNT take every kit object with them.
  6. THE MIGRATION'S CHECK LISTS ARE THE SPEC'S ENUMS, both ways (read with `ast`).
"""

from __future__ import annotations

import ast
import json
import pathlib
import re
import uuid

import pytest
from sqlalchemy import text
from test_capture_keys import _key_headers, _mint
from test_live_rls import _allowed, _count, _refused
from test_project_media import MP4, PNG, _files, _person, store  # noqa: F401 - fixture by name
from test_sync import (  # noqa: F401 - fixtures are picked up by name
    TEST_DB,
    app_env,
    client,
    created_users,
    owner_engine,
)

from builder.shipkit_spec import SHIPKIT_ENUM_VALUES, SHIPKIT_VERSION

pytestmark = pytest.mark.skipif(not TEST_DB, reason="set BUILDER_TEST_DB to run")
_SHARED_FIXTURES = (app_env, client, created_users, store)

GIF = b"GIF89a" + bytes(range(200))
ROOT = pathlib.Path(__file__).resolve().parents[2]


def _pub() -> str:
    return uuid.uuid4().hex[:16]


def _file(pub: str, slot: str, data: bytes, content_type: str, pos: int = 0, **kw) -> dict:
    return {
        "publish_id": pub,
        "slot": slot,
        "content_type": content_type,
        "bytes": len(data),
        "width": 1080,
        "height": 1920,
        "duration_ms": 14600 if content_type == "video/mp4" else None,
        "position": pos,
        "label": None,
        **kw,
    }


def _doc(pub: str, **over) -> dict:
    return {
        "shipkit_version": SHIPKIT_VERSION,
        "publish_id": pub,
        "device": "iphone-17-pro",
        "hue": "tide",
        "captions": [
            {
                "platform": "x",
                "text": "A bus route finder.",
                "thread": ["One.", "Two."],
                "source": "model",
            },
            {
                "platform": "linkedin",
                "text": "A bus route finder.",
                "thread": [],
                "source": "template",
            },
        ],
        "changelog": ["map: the buses move on a recorded day"],
        "refused": [{"what": "ipad_13", "code": "no_ipad_capture"}],
        **over,
    }


def _send(client, p: dict, body: dict, data: bytes) -> str:
    r = client.post(f"/v1/projects/{p['key']}/kit:presign", json=body, headers=p["mac"])
    assert r.status_code == 200, r.text
    slot = r.json()
    put = client.put(slot["upload_url"], content=data, headers=slot["headers"])
    assert put.status_code == 204, put.text
    c = client.post(f"/v1/projects/{p['key']}/kit/{slot['media_id']}:commit", headers=p["mac"])
    assert c.status_code == 200, c.text
    return slot["media_id"]


def _publish(client, p: dict) -> tuple[str, list[str]]:
    pub = _pub()
    ids = [
        _send(client, p, _file(pub, "video_vertical", MP4, "video/mp4"), MP4),
        _send(client, p, _file(pub, "loop", GIF, "image/gif", width=600, height=600), GIF),
        _send(
            client, p, _file(pub, "framed_still", PNG, "image/png", 1, label="the live map"), PNG
        ),
    ]
    r = client.put(f"/v1/projects/{p['key']}/kit", json=_doc(pub), headers=p["mac"])
    assert r.status_code == 200, r.text
    return pub, ids


def _kit(client, p: dict, headers=None):
    return client.get(f"/v1/projects/{p['key']}/kit", headers=headers or p["phone"])


def _kit_rows(uid: str) -> list:
    with owner_engine().connect() as c:
        return c.execute(
            text(
                "SELECT publish_id, slot, committed, object_key FROM ship_kit_media WHERE "
                "user_id = :u"
            ),
            {"u": uid},
        ).all()


# ------------------------------------------------------------------------ requests


def test_a_request_is_one_live_request_a_project_claimed_and_finished_once(client, created_users):
    a = _person(client, created_users)
    r = client.post(
        "/v1/demos/requests", json={"project_key": a["key"], "hue": "coral"}, headers=a["phone"]
    )
    assert r.status_code == 201, r.text
    first = r.json()["request"]
    assert first["status"] == "queued" and first["hue"] == "coral"

    again = client.post("/v1/demos/requests", json={"project_key": a["key"]}, headers=a["phone"])
    assert again.status_code == 200 and again.json()["existing"] is True
    assert again.json()["request"]["id"] == first["id"], "a second tap is the same request"

    claimed = client.post("/v1/demos/requests:claim", headers=a["mac"]).json()["requests"]
    assert [q["id"] for q in claimed] == [first["id"]] and claimed[0]["status"] == "claimed"
    assert client.post("/v1/demos/requests:claim", headers=a["mac"]).json()["requests"] == [], (
        "once"
    )

    bad = client.post(
        f"/v1/demos/requests/{first['id']}:finish",
        json={"status": "failed", "refusal": None},
        headers=a["mac"],
    )
    assert bad.status_code == 422, "a failure says why"
    done = client.post(
        f"/v1/demos/requests/{first['id']}:finish",
        json={"status": "done", "refusal": None},
        headers=a["mac"],
    )
    assert done.status_code == 200 and done.json()["request"]["status"] == "done"
    twice = client.post(
        f"/v1/demos/requests/{first['id']}:finish",
        json={"status": "done", "refusal": None},
        headers=a["mac"],
    )
    assert twice.status_code == 409, "a finished request stays finished"

    # With the one done, a new tap is a new request, and a cancel takes it back.
    new = client.post(
        "/v1/demos/requests", json={"project_key": a["key"]}, headers=a["phone"]
    ).json()["request"]
    assert new["id"] != first["id"]
    assert (
        client.delete(f"/v1/demos/requests/{new['id']}", headers=a["phone"]).json()["request"][
            "status"
        ]
        == "cancelled"
    )
    listed = client.get(f"/v1/demos/requests?project_key={a['key']}", headers=a["phone"]).json()[
        "requests"
    ]
    assert [q["status"] for q in listed] == ["cancelled", "done"], "newest first"


def test_a_failed_request_carries_its_code(client, created_users):
    a = _person(client, created_users)
    rid = client.post(
        "/v1/demos/requests", json={"project_key": a["key"]}, headers=a["phone"]
    ).json()["request"]["id"]
    client.post("/v1/demos/requests:claim", headers=a["mac"])
    r = client.post(
        f"/v1/demos/requests/{rid}:finish",
        json={"status": "failed", "refusal": "no_checkout"},
        headers=a["mac"],
    )
    assert r.status_code == 200 and r.json()["request"]["refusal"] == "no_checkout"
    unknown = client.post(
        f"/v1/demos/requests/{rid}:finish",
        json={"status": "failed", "refusal": "made_up"},
        headers=a["mac"],
    )
    assert unknown.status_code == 422, "only the spec's codes"


def test_a_request_is_for_a_project_of_yours(client, created_users):
    a = _person(client, created_users)
    nowhere = uuid.uuid4().hex * 2
    assert (
        client.post(
            "/v1/demos/requests", json={"project_key": nowhere}, headers=a["phone"]
        ).status_code
        == 404
    )
    assert (
        client.post(
            "/v1/demos/requests", json={"project_key": a["key"][:12]}, headers=a["phone"]
        ).status_code
        == 422
    )


def test_one_persons_requests_are_theirs(client, created_users):
    a = _person(client, created_users)
    b = _person(client, created_users)
    rid = client.post(
        "/v1/demos/requests", json={"project_key": a["key"]}, headers=a["phone"]
    ).json()["request"]["id"]
    assert (
        client.post(
            "/v1/demos/requests", json={"project_key": a["key"]}, headers=b["phone"]
        ).status_code
        == 404
    )
    assert client.get("/v1/demos/requests", headers=b["phone"]).json()["requests"] == []
    assert client.post("/v1/demos/requests:claim", headers=b["mac"]).json()["requests"] == [], (
        "b's Mac claims nothing of a's"
    )
    assert client.delete(f"/v1/demos/requests/{rid}", headers=b["phone"]).status_code == 404
    # The control: a's own Mac claims it.
    assert [
        q["id"]
        for q in client.post("/v1/demos/requests:claim", headers=a["mac"]).json()["requests"]
    ] == [rid]
    assert (
        client.post(
            f"/v1/demos/requests/{rid}:finish",
            json={"status": "done", "refusal": None},
            headers=b["mac"],
        ).status_code
        == 404
    )


# ------------------------------------------------------------------------ the kit


def test_a_kit_round_trips_and_its_files_stream_to_their_owner(client, store, created_users):
    a = _person(client, created_users)
    assert _kit(client, a).json() == {"kit": None}, "a project of yours with no kit yet"
    pub, ids = _publish(client, a)
    got = _kit(client, a).json()["kit"]
    assert got["document"]["publish_id"] == pub
    assert got["document"]["captions"][0]["thread"] == ["One.", "Two."]
    assert got["document"]["refused"] == [{"what": "ipad_13", "code": "no_ipad_capture"}]
    slots = {f["slot"]: f for f in got["files"]}
    assert set(slots) == {"video_vertical", "loop", "framed_still"}
    assert (
        slots["loop"]["content_type"] == "image/gif"
        and slots["framed_still"]["label"] == "the live map"
    )
    body = client.get(slots["video_vertical"]["url"], headers=a["phone"])
    assert body.status_code == 200 and body.content == MP4
    assert client.get(slots["loop"]["url"], headers=a["phone"]).content == GIF
    assert client.get(slots["loop"]["url"]).status_code == 401
    assert all(f.startswith(f"ship-kit/{a['uid']}/{a['key']}/") for f in _files(store))

    r = client.delete(f"/v1/projects/{a['key']}/kit", headers=a["phone"])
    assert r.json() == {"deleted": 3} and _files(store) == set() and _kit_rows(a["uid"]) == []


def test_a_new_kit_replaces_the_old_only_when_its_document_arrives_whole(
    client, store, created_users
):
    a = _person(client, created_users)
    old_pub, _ = _publish(client, a)
    old_files = _files(store)
    new = _pub()
    _send(client, a, _file(new, "video_square", MP4, "video/mp4", width=1080, height=1080), MP4)
    r = client.post(
        f"/v1/projects/{a['key']}/kit:presign",
        json=_file(new, "loop", GIF, "image/gif"),
        headers=a["mac"],
    )
    pending = r.json()
    assert (
        client.put(f"/v1/projects/{a['key']}/kit", json=_doc(new), headers=a["mac"]).status_code
        == 409
    ), "a document with a file still pending changes nothing"
    assert _kit(client, a).json()["kit"]["document"]["publish_id"] == old_pub, "the old kit, whole"
    client.put(pending["upload_url"], content=GIF, headers=pending["headers"])
    client.post(f"/v1/projects/{a['key']}/kit/{pending['media_id']}:commit", headers=a["mac"])
    done = client.put(f"/v1/projects/{a['key']}/kit", json=_doc(new), headers=a["mac"])
    assert done.status_code == 200 and done.json()["replaced"] == 3
    assert _kit(client, a).json()["kit"]["document"]["publish_id"] == new
    assert not (old_files & _files(store)), "the replaced kit's objects are gone from disk"
    assert {r.publish_id for r in _kit_rows(a["uid"])} == {new}


def test_the_door(client, store, created_users):
    a = _person(client, created_users)
    pub = _pub()
    url = f"/v1/projects/{a['key']}/kit:presign"
    assert (
        client.post(
            url, json=_file(pub, "video_feed", GIF, "image/gif"), headers=a["mac"]
        ).status_code
        == 422
    ), "a GIF is the loop"
    no_len = _file(pub, "video_feed", MP4, "video/mp4", duration_ms=None)
    assert client.post(url, json=no_len, headers=a["mac"]).status_code == 422, (
        "a video has a length"
    )
    big = _file(pub, "loop", GIF, "image/gif", bytes=8388609)
    assert client.post(url, json=big, headers=a["mac"]).status_code == 413
    dashed = _file(pub, "still", PNG, "image/png", 1, label="sk-ant-api03 key")
    assert client.post(url, json=dashed, headers=a["mac"]).status_code == 422, "the demo label rule"
    extra = {**_file(pub, "still", PNG, "image/png", 1), "commit": "abc"}
    assert client.post(url, json=extra, headers=a["mac"]).status_code == 422, "nothing undeclared"
    # A second file in a slot of one: refused, not stacked.
    _send(client, a, _file(pub, "video_feed", MP4, "video/mp4"), MP4)
    assert (
        client.post(
            url, json=_file(pub, "video_feed", MP4, "video/mp4", 1), headers=a["mac"]
        ).status_code
        == 409
    )
    long = _doc(
        pub, captions=[{"platform": "x", "text": "x" * 281, "thread": [], "source": "model"}]
    )
    assert (
        client.put(f"/v1/projects/{a['key']}/kit", json=long, headers=a["mac"]).status_code == 422
    )
    thread = _doc(
        pub, captions=[{"platform": "linkedin", "text": "hi", "thread": ["a"], "source": "model"}]
    )
    assert (
        client.put(f"/v1/projects/{a['key']}/kit", json=thread, headers=a["mac"]).status_code == 422
    )
    # The upload URL is one object, one type, one size.
    slot = client.post(url, json=_file(pub, "loop", GIF, "image/gif"), headers=a["mac"]).json()
    assert (
        client.put(slot["upload_url"], content=PNG[: len(GIF)], headers=slot["headers"]).status_code
        == 415
    )


def test_one_persons_kit_is_theirs_and_a_capture_key_gets_nothing(client, store, created_users):
    a = _person(client, created_users)
    b = _person(client, created_users)
    _, ids = _publish(client, a)
    assert _kit(client, a, headers=b["phone"]).status_code == 404
    assert client.get(f"/v1/kit-media/{ids[0]}", headers=b["phone"]).status_code == 404
    assert client.get(f"/v1/kit-media/{ids[0]}", headers=a["phone"]).status_code == 200, (
        "the control"
    )
    assert client.delete(f"/v1/projects/{a['key']}/kit", headers=b["phone"]).status_code == 404
    kh = _key_headers(_mint(client, a["phone"])["key"])
    assert client.get("/v1/sync/known", headers=kh).status_code == 200, "the key is live"
    assert _kit(client, a, headers=kh).status_code == 401
    assert client.post("/v1/demos/requests:claim", headers=kh).status_code == 401
    assert (
        client.post(
            f"/v1/projects/{a['key']}/kit:presign",
            json=_file(_pub(), "loop", GIF, "image/gif"),
            headers=kh,
        ).status_code
        == 401
    )


def test_excluding_the_repository_and_deleting_the_account_take_the_kit(
    client, store, created_users
):
    a = _person(client, created_users)
    b = _person(client, created_users)
    _publish(client, a)
    _publish(client, b)
    client.post("/v1/demos/requests", json={"project_key": a["key"]}, headers=a["phone"])
    r = client.post(
        "/v1/repos/visibility",
        json={"repo_hash": a["key"], "visibility": "excluded"},
        headers=a["phone"],
    )
    assert r.status_code == 200, r.text
    assert _kit_rows(a["uid"]) == [] and not any(a["uid"] in f for f in _files(store))
    assert _count(a["uid"], "SELECT count(*) FROM demo_requests") == 0, "its requests too"
    b_files = _files(store)
    assert len(b_files) == 3
    d = client.post("/v1/account/delete", headers=b["phone"])
    assert d.status_code == 200 and d.json()["row_counts"]["ship_kit_media"] == 3
    assert _files(store) == set()


# ------------------------------------------------------------------ RLS, below the routes


@pytest.fixture
def two_users():
    ids = []
    with owner_engine().begin() as c:
        for _ in range(2):
            uid = str(uuid.uuid4())
            c.execute(text("INSERT INTO users (id) VALUES (:i)"), {"i": uid})
            ids.append(uid)
    yield ids
    with owner_engine().begin() as c:
        c.execute(text("DELETE FROM users WHERE id = ANY(CAST(:ids AS uuid[]))"), {"ids": ids})


_REQ = "INSERT INTO demo_requests (user_id, project_key) VALUES (CAST(:u AS uuid), :k)"
_MEDIA = (
    "INSERT INTO ship_kit_media (user_id, project_key, publish_id, slot, object_key, content_type, "
    "width, height, bytes, position) VALUES (CAST(:u AS uuid), :k, :p, 'loop', :o, "
    "'image/gif', 10, 10, 10, 0)"
)


def test_the_policies_hold_below_the_routes(two_users):
    a, b = two_users
    k = "d" * 64
    _allowed(a, _REQ, u=a, k=k)
    _refused(a, _REQ, u=b, k=k)
    media = {"k": k, "p": uuid.uuid4().hex[:16]}
    _allowed(a, _MEDIA, u=a, o=f"ship-kit/{a}/{uuid.uuid4().hex}.gif", **media)
    _refused(a, _MEDIA, u=b, o=f"ship-kit/{b}/{uuid.uuid4().hex}.gif", **media)
    with owner_engine().begin() as c:
        rid = c.execute(text(_REQ + " RETURNING id"), {"u": b, "k": k}).scalar()
    one = "SELECT count(*) FROM demo_requests WHERE id = CAST(:r AS uuid)"
    assert _count(b, one, r=str(rid)) == 1, "the control: its owner sees it"
    assert _count(a, one, r=str(rid)) == 0
    assert _count(None, one, r=str(rid)) == 0, "no viewer sees nothing"


# ------------------------------------------------------------------ the migration and the spec


def test_every_check_list_in_the_migration_is_the_specs_enum():
    src = (ROOT / "server/alembic/versions/0030_ship_kits.py").read_text()
    consts = {}
    for node in ast.parse(src).body:
        if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name):
            try:
                consts[node.targets[0].id] = ast.literal_eval(node.value)
            except ValueError:
                continue
    for const, enum in [
        ("REQUEST_STATUS", "request_status"),
        ("REQUEST_REFUSAL", "request_refusal"),
        ("HUE", "hue"),
        ("KIT_SLOT", "kit_slot"),
        ("KIT_CONTENT_TYPE", "kit_content_type"),
    ]:
        assert re.findall(r"'([^']+)'", consts[const]) == SHIPKIT_ENUM_VALUES[enum], const


def test_the_generated_door_is_the_spec():
    spec = json.loads((ROOT / "spec/shipkit.v1.json").read_text())
    enums = {k: v for k, v in spec["enums"].items() if not k.startswith("_")}
    assert enums == SHIPKIT_ENUM_VALUES
