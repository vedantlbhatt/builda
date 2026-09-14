"""Project demos (0026, docs/demos.md) AS builder_app, through the real routes and below them.

Everything here fails OPEN without an error if it fails at all: a stranger's phone drawing
somebody else's screenshots, a follower reading a private repository's name off a demo, a
shared session opening a door to the owner's pictures, an upload URL replayed onto a file
that was already vetted, a demo left on disk after the account that made it is gone. So:

* the RLS tests connect as builder_app and resolve the VICTIM'S ids through the OWNER engine
  first (CLAUDE.md: a lookup inside the restricted connection matches nothing, and the
  statement then "passes" without ever reaching the policy), run the same statement for the
  viewer's own row as the positive control, and require the error to be the policy's;
* every route refusal has its control: the owner gets the thing on the same URL;
* the file backend is a real directory, so "deleted" is checked on disk, not in a response.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlsplit

import pytest
from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError
from test_capture_keys import _key_headers, _mint
from test_live_rls import _allowed, _as, _count, _refused
from test_social import _handle, _post
from test_sync import (  # noqa: F401 - fixtures are picked up by name
    TEST_DB,
    _pair,
    _payload,
    _phone_for,
    _upload,
    app_engine,
    app_env,
    client,
    created_users,
    owner_engine,
)

pytestmark = pytest.mark.skipif(not TEST_DB, reason="set BUILDER_TEST_DB to run")
_SHARED_FIXTURES = (app_env, client, created_users)

PNG = b"\x89PNG\r\n\x1a\n" + bytes(range(256)) * 2
JPEG = b"\xff\xd8\xff\xe0" + bytes(range(200))
MP4 = b"\x00\x00\x00\x18ftypisom" + bytes(range(256)) * 4
LABEL = "the session page, scrolled to the chart"


# ----------------------------------------------------------------------------- fixtures


@pytest.fixture
def store(app_env, monkeypatch, tmp_path):
    """The local stack's backend: OBJECT_STORE_ENDPOINT=file:///<tmp>/media."""
    from builder.settings import settings

    root = tmp_path / "media"
    monkeypatch.setenv("OBJECT_STORE_ENDPOINT", f"file://{root}")
    for var in ("OBJECT_STORE_BUCKET", "OBJECT_STORE_KEY", "OBJECT_STORE_SECRET"):
        monkeypatch.delenv(var, raising=False)
    settings.cache_clear()
    yield root
    settings.cache_clear()


@pytest.fixture
def s3(app_env, monkeypatch):
    """Production's backend, configured; the bucket itself is stood in for per test."""
    from builder.settings import settings

    monkeypatch.setenv("OBJECT_STORE_ENDPOINT", "https://acct.r2.cloudflarestorage.com")
    monkeypatch.setenv("OBJECT_STORE_BUCKET", "builder-media")
    monkeypatch.setenv("OBJECT_STORE_KEY", "AKIAIOSFODNN7EXAMPLE")
    monkeypatch.setenv("OBJECT_STORE_SECRET", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY")
    settings.cache_clear()
    yield
    settings.cache_clear()


def _person(client, created_users) -> dict:
    """A user with a paired Mac, the phone, and one project: a final session in a fresh
    repository, whose salted hash is the project key."""
    uid, mac = _pair(client, created_users)
    key = uuid.uuid4().hex * 2
    assert _upload(client, mac, _payload(repo_hash=key))["accepted"] == 1
    return {"uid": uid, "mac": mac, "phone": _phone_for(mac), "key": key}


def _pub() -> str:
    return uuid.uuid4().hex[:16]


def _image(pub: str, pos: int = 1, data: bytes = PNG, **kw) -> dict:
    return {
        "publish_id": pub,
        "kind": "image",
        "content_type": "image/png",
        "bytes": len(data),
        "width": 1206,
        "height": 2622,
        "position": pos,
        "label": LABEL,
        "source": "capture",
        **kw,
    }


def _video(pub: str, poster: bool = True, **kw) -> dict:
    return {
        "publish_id": pub,
        "kind": "video",
        "content_type": "video/mp4",
        "bytes": len(MP4),
        "width": 1206,
        "height": 2622,
        "duration_ms": 18000,
        "position": 0,
        "label": "a pass through the app",
        "source": "capture",
        "poster": {"content_type": "image/jpeg", "bytes": len(JPEG)} if poster else None,
        **kw,
    }


def _presign(client, p: dict, body: dict, key: str | None = None):
    return client.post(f"/v1/projects/{key or p['key']}/media:presign", json=body, headers=p["mac"])


def _put(client, slot: dict, data: bytes, **headers):
    return client.put(slot["upload_url"], content=data, headers={**slot["headers"], **headers})


def _commit(client, p: dict, media_id: str, headers=None):
    return client.post(
        f"/v1/projects/{p['key']}/media/{media_id}:commit", headers=headers or p["mac"]
    )


def _publish(client, p: dict, files: list[tuple[dict, bytes]]) -> list[str]:
    """Presign every file, then upload every file, then commit every file: the Mac's order."""
    slots = []
    for body, _ in files:
        r = _presign(client, p, body)
        assert r.status_code == 200, r.text
        slots.append(r.json())
    for slot, (body, data) in zip(slots, files, strict=True):
        assert _put(client, slot, data).status_code == 204
        if body["kind"] == "video" and body.get("poster"):
            assert _put(client, slot["poster"], JPEG).status_code == 204
    for slot in slots:
        r = _commit(client, p, slot["media_id"])
        assert r.status_code == 200, r.text
    return [s["media_id"] for s in slots]


def _listed(client, p: dict, headers=None) -> list[dict]:
    r = client.get(f"/v1/projects/{p['key']}/media", headers=headers or p["phone"])
    assert r.status_code == 200, r.text
    return r.json()["items"]


def _rows(uid: str) -> list:
    with owner_engine().connect() as c:
        return c.execute(
            text(
                "SELECT id, publish_id, kind, committed, object_key, poster_object_key "
                "FROM project_media WHERE user_id = :u ORDER BY position"
            ),
            {"u": uid},
        ).all()


def _files(root) -> set[str]:
    return (
        {str(p.relative_to(root)) for p in root.rglob("*") if p.is_file()}
        if root.exists()
        else set()
    )


# --------------------------------------------------------------------- the round trip


def test_publish_list_read_preview_and_delete_on_the_local_store(client, store, created_users):
    a = _person(client, created_users)
    pub = _pub()
    ids = _publish(client, a, [(_video(pub), MP4), (_image(pub, 1), PNG), (_image(pub, 2), PNG)])

    items = _listed(client, a)
    assert [i["kind"] for i in items] == ["video", "image", "image"], "the video first"
    video = items[0]
    assert video["id"] == ids[0] and video["url"] == f"/v1/media/{ids[0]}"
    assert video["poster_url"] == f"/v1/media/{ids[0]}/poster"
    assert video["duration_ms"] == 18000 and video["label"] == "a pass through the app"
    assert set(video) == {
        "id", "kind", "content_type", "width", "height", "duration_ms", "position", "label",
        "source", "url", "poster_url",
    }  # fmt: skip
    assert items[1]["poster_url"] is None and items[1]["position"] == 1

    # The bytes, to their owner's bearer: whole, ranged, the poster, and nothing to a stranger.
    got = client.get(video["url"], headers=a["phone"])
    assert got.status_code == 200 and got.content == MP4
    assert got.headers["content-type"] == "video/mp4"
    assert got.headers["cache-control"].startswith("private")
    ranged = client.get(video["url"], headers={**a["phone"], "Range": "bytes=4-11"})
    assert ranged.status_code == 206 and ranged.content == MP4[4:12]
    assert client.get(video["poster_url"], headers=a["phone"]).content == JPEG
    assert client.get(items[1]["url"], headers=a["mac"]).content == PNG
    assert client.get(video["url"]).status_code == 401

    # Everything on disk is 0700 and lives under the person's own prefix.
    assert (store.stat().st_mode & 0o777) == 0o700
    assert all(f.startswith(f"project-media/{a['uid']}/{a['key']}/") for f in _files(store))
    assert len(_files(store)) == 4

    r = client.get(f"/v1/projects/media:preview?keys={a['key']}", headers=a["phone"])
    assert r.status_code == 200
    stills = r.json()["projects"][a["key"]]
    assert [s["position"] for s in stills] == [1, 2] and all(s["kind"] == "image" for s in stills)

    r = client.delete(f"/v1/projects/{a['key']}/media", headers=a["phone"])
    assert r.status_code == 200 and r.json() == {"deleted": 3}
    assert _rows(a["uid"]) == [] and _files(store) == set(), "the rows AND the objects"
    assert _listed(client, a) == []
    assert client.get(video["url"], headers=a["phone"]).status_code == 404


def test_the_preview_is_three_stills_per_project_and_every_key_answers(
    client, store, created_users
):
    a = _person(client, created_users)
    pub = _pub()
    _publish(client, a, [(_image(pub, pos), PNG) for pos in (5, 1, 3, 2)])
    other = uuid.uuid4().hex * 2
    r = client.get(f"/v1/projects/media:preview?keys={a['key']},{other}", headers=a["phone"])
    assert r.status_code == 200
    assert [s["position"] for s in r.json()["projects"][a["key"]]] == [1, 2, 3]
    assert r.json()["projects"][other] == []
    assert client.get("/v1/projects/media:preview?keys=abc", headers=a["phone"]).status_code == 422
    too_many = ",".join(uuid.uuid4().hex * 2 for _ in range(51))
    r = client.get(f"/v1/projects/media:preview?keys={too_many}", headers=a["phone"])
    assert r.status_code == 422


# -------------------------------------------------------------------- publish replaces


def test_a_new_publish_replaces_the_old_only_once_it_has_all_committed(
    client, store, created_users
):
    a = _person(client, created_users)
    first = _pub()
    _publish(client, a, [(_image(first, 1), PNG), (_image(first, 2), PNG)])
    old_files = _files(store)
    assert len(old_files) == 2

    second = _pub()
    video = _presign(client, a, _video(second)).json()
    still = _presign(client, a, _image(second, 1, data=JPEG, content_type="image/jpeg")).json()
    assert [i["position"] for i in _listed(client, a)] == [1, 2], (
        "the old set until the new is whole"
    )
    assert _put(client, video, MP4).status_code == 204
    assert _put(client, video["poster"], JPEG).status_code == 204
    assert _put(client, still, JPEG).status_code == 204

    half = _commit(client, a, video["media_id"]).json()
    assert (half["pending"], half["replaced"]) == (1, 0)
    shown = _listed(client, a)
    assert [(i["kind"], i["position"]) for i in shown] == [("image", 1), ("image", 2)], (
        "half of the new set is never shown beside the old one"
    )

    done = _commit(client, a, still["media_id"]).json()
    assert (done["pending"], done["replaced"]) == (0, 2)
    assert [i["kind"] for i in _listed(client, a)] == ["video", "image"]
    assert {r.publish_id for r in _rows(a["uid"])} == {second}
    assert not (old_files & _files(store)), "the replaced set's objects are gone from disk"
    assert len(_files(store)) == 3

    # A commit is idempotent, and says so without replacing anything twice.
    again = _commit(client, a, still["media_id"])
    assert again.status_code == 200 and again.json()["replaced"] == 0


def test_a_new_publish_drops_an_unfinished_one_and_its_upload_url(client, store, created_users):
    a = _person(client, created_users)
    stalled = _pub()
    slot = _presign(client, a, _image(stalled, 1)).json()
    assert _put(client, slot, PNG[:10] + b"x").status_code == 400, "the size is the presign's"

    fresh = _pub()
    assert _presign(client, a, _image(fresh, 1)).status_code == 200
    assert {r.publish_id for r in _rows(a["uid"])} == {fresh}
    late = _put(client, slot, PNG)
    assert late.status_code == 404 and "nothing is waiting" in late.json()["detail"]
    assert _commit(client, a, slot["media_id"]).status_code == 404
    assert _files(store) == set()


def test_a_publish_abandoned_half_way_is_dropped_whole_and_never_shown_in_parts(
    client, store, created_users
):
    """Half of a publish committed, then a new publish starts: the half goes with the rest.
    Dropping only its pending rows would leave a committed half with nothing pending, which
    the list reads as a complete set, beside the demo it never replaced."""
    a = _person(client, created_users)
    shown = _pub()
    _publish(client, a, [(_image(shown, 5), PNG)])
    half = _pub()
    first = _presign(client, a, _image(half, 1)).json()
    _presign(client, a, _image(half, 2))
    assert _put(client, first, PNG).status_code == 204
    assert _commit(client, a, first["media_id"]).json()["pending"] == 1
    assert [i["position"] for i in _listed(client, a)] == [5]

    assert _presign(client, a, _image(_pub(), 1)).status_code == 200
    assert half not in {r.publish_id for r in _rows(a["uid"])}, "dropped whole"
    assert [i["position"] for i in _listed(client, a)] == [5], "never shown in parts"
    assert len(_files(store)) == 1, "its committed file left the disk too"


def test_a_retried_commit_never_wipes_a_newer_publish(client, store, created_users):
    a = _person(client, created_users)
    old = _pub()
    (mid,) = _publish(client, a, [(_image(old, 1), PNG)])
    new = _pub()
    slot = _presign(client, a, _image(new, 1)).json()
    again = _commit(client, a, mid)  # the answer to the first commit was lost; the Mac retries
    assert again.status_code == 200 and again.json()["replaced"] == 0
    assert {r.publish_id for r in _rows(a["uid"])} == {old, new}, "the newer publish survives"
    assert _put(client, slot, PNG).status_code == 204
    assert _commit(client, a, slot["media_id"]).json()["replaced"] == 1
    assert [i["id"] for i in _listed(client, a)] == [slot["media_id"]]


# ------------------------------------------------------------------------- the caps


def test_caps_on_count_position_and_kind(client, store, created_users):
    a = _person(client, created_users)
    pub = _pub()
    for pos in range(1, 9):
        assert _presign(client, a, _image(pub, pos)).status_code == 200
    ninth = _presign(client, a, _image(pub, 9))
    assert ninth.status_code == 409 and "at most 8 images" in ninth.json()["detail"]
    assert _presign(client, a, _video(pub)).status_code == 200
    second_video = _presign(client, a, _video(pub, position=1))
    assert second_video.status_code == 409 and "one video" in second_video.json()["detail"]

    other = _pub()
    assert _presign(client, a, _image(other, 1)).status_code == 200
    taken = _presign(client, a, _image(other, 1))
    assert taken.status_code == 409 and "position 1" in taken.json()["detail"]


def test_a_full_committed_set_refuses_the_next_presign(client, store, created_users):
    a = _person(client, created_users)
    pub = _pub()
    _publish(client, a, [(_image(pub, pos), PNG) for pos in range(1, 9)])
    assert len(_listed(client, a)) == 8
    r = _presign(client, a, _image(pub, 9))
    assert r.status_code == 409
    assert len(_listed(client, a)) == 8


@pytest.mark.parametrize(
    "change, status, needle",
    [
        ({"bytes": 6 * 1024 * 1024 + 1}, 413, "at most 6291456 bytes"),
        ({"content_type": "video/mp4"}, 422, "is a video, not an image"),
        ({"content_type": "image/gif"}, 422, "content_type"),
        ({"content_type": "text/html"}, 422, "content_type"),
        ({"duration_ms": 1000}, 422, "an image has no duration_ms"),
        ({"poster": {"content_type": "image/jpeg", "bytes": 10}}, 422, "only a video"),
        ({"label": "the sign-in screen"}, 422, "'-'"),
        ({"label": "src/app/page.tsx"}, 422, "'/'"),
        ({"label": "feat_login flow"}, 422, "'_'"),
        ({"label": "the café menu"}, 422, "plain words"),
        ({"label": "the chart — scrolled"}, 422, "plain words"),
        ({"label": "a" * 81}, 422, "label"),
        ({"label": "token AKIAIOSFODNN7EXAMPLEKEYAB here"}, 422, "reads as an id"),
        ({"label": "2026 09 14"}, 422, "at least one word"),
        ({"label": " leading space"}, 422, "single spaces"),
        ({"label": ""}, 422, "empty"),
        ({"width": 0}, 422, "width"),
        ({"height": 9000}, 422, "height"),
        ({"position": 64}, 422, "position"),
        ({"source": "generated"}, 422, "source"),
        ({"publish_id": "not hex at all!"}, 422, "publish_id"),
        # What the Mac's manifest holds and the contract does not declare: never storable.
        ({"commit": "a" * 40}, 422, "commit"),
        ({"file": "still-01.png"}, 422, "file"),
        ({"taken_at": "2026-09-14T00:00:00Z"}, 422, "taken_at"),
        ({"project_kind": "expo_ios"}, 422, "project_kind"),
    ],
)
def test_the_door_refuses_what_the_contract_does_not_declare(
    client, store, created_users, change, status, needle
):
    a = _person(client, created_users)
    r = _presign(client, a, _image(_pub(), **change))
    assert r.status_code == status, r.text
    assert needle in json.dumps(r.json()["detail"]), r.text
    assert _rows(a["uid"]) == []


def test_video_shape(client, store, created_users):
    a = _person(client, created_users)
    no_length = _presign(client, a, _video(_pub(), duration_ms=None))
    assert no_length.status_code == 422 and "needs duration_ms" in no_length.json()["detail"]
    assert _presign(client, a, _video(_pub(), duration_ms=31001)).status_code == 422
    # Over the largest cap any type has: the generated model's own bound refuses it.
    huge = _presign(client, a, _video(_pub(), bytes=40 * 1024 * 1024 + 1))
    assert huge.status_code == 422 and "41943040" in json.dumps(huge.json()["detail"])
    big_poster = _presign(
        client,
        a,
        _video(_pub(), poster=False)
        | {"poster": {"content_type": "image/png", "bytes": 7_000_000}},
    )
    assert big_poster.status_code == 422, "the poster's own bound, before the gate"
    no_poster = _presign(client, a, _video(_pub(), poster=False))
    assert no_poster.status_code == 200 and no_poster.json()["poster"] is None


# ------------------------------------------------------------------ the upload token


def test_the_upload_url_is_one_object_one_type_one_size_one_use(client, store, created_users):
    from builder import project_media as pm

    a = _person(client, created_users)
    slot = _presign(client, a, _image(_pub(), 1)).json()
    assert slot["headers"] == {"Content-Type": "image/png", "Content-Length": str(len(PNG))}
    assert slot["upload_url"].startswith("/v1/media-upload/")
    token = slot["upload_url"].rsplit("/", 1)[1]

    assert _put(client, slot, PNG, **{"Content-Type": "image/jpeg"}).status_code == 415
    html = b"<html>" + b" " * (len(PNG) - 6)
    assert _put(client, slot, html).status_code == 415, "bytes that are not a PNG"
    assert _put(client, slot, PNG + b"extra").status_code in (400, 413)
    assert _commit(client, a, slot["media_id"]).status_code == 409, "nothing landed yet"

    assert _put(client, slot, PNG).status_code == 204
    replay = _put(client, slot, PNG)
    assert replay.status_code == 409 and "used" in replay.json()["detail"]

    # Not an access token, and an access token is not an upload token.
    bearer = {"authorization": f"Bearer {token}"}
    assert client.get(f"/v1/projects/{a['key']}/media", headers=bearer).status_code == 401
    access = a["mac"]["authorization"].removeprefix("Bearer ")
    forged = client.put(f"/v1/media-upload/{access}", content=PNG, headers=slot["headers"])
    assert forged.status_code == 401

    # Expired: made fifteen minutes and a second ago.
    old = pm.upload_token(
        a["uid"], slot["media_id"], "x", "image/png", len(PNG),
        now=datetime.now(UTC) - timedelta(seconds=pm.UPLOAD_URL_SECONDS + 1),
    )  # fmt: skip
    assert (
        client.put(f"/v1/media-upload/{old}", content=PNG, headers=slot["headers"]).status_code
        == 401
    )


def test_commit_checks_the_object_is_the_file_the_presign_declared(client, store, created_users):
    from builder import objectstore

    a = _person(client, created_users)
    slot = _presign(client, a, _image(_pub(), 1)).json()
    (row,) = _rows(a["uid"])
    path = objectstore.file_path(row.object_key, root=store)
    objectstore.ensure_private_dir(path.parent)

    path.write_bytes(PNG[:-1])  # written behind the upload route's back, one byte short
    short = _commit(client, a, slot["media_id"])
    assert short.status_code == 409 and "its presign said" in short.json()["detail"]
    path.write_bytes(b"GIF89a" + PNG[6:])
    wrong = _commit(client, a, slot["media_id"])
    assert wrong.status_code == 409 and "does not start like image/png" in wrong.json()["detail"]
    path.write_bytes(PNG)
    assert _commit(client, a, slot["media_id"]).status_code == 200


# ------------------------------------------------------------------------ who may ask


def test_a_project_must_be_yours_and_not_excluded(client, store, created_users):
    a = _person(client, created_users)
    nowhere = uuid.uuid4().hex * 2
    r = _presign(client, a, _image(_pub(), 1), key=nowhere)
    assert r.status_code == 404
    assert client.get(f"/v1/projects/{nowhere}/media", headers=a["phone"]).status_code == 404
    short = _presign(client, a, _image(_pub(), 1), key=a["key"][:12])
    assert short.status_code == 422, "the whole key, never a prefix"

    pub = _pub()
    _publish(client, a, [(_video(pub), MP4), (_image(pub, 1), PNG)])
    assert len(_files(store)) == 3
    r = client.post(
        "/v1/repos/visibility",
        json={"repo_hash": a["key"], "visibility": "excluded"},
        headers=a["phone"],
    )
    assert r.status_code == 200, r.text
    assert _rows(a["uid"]) == [] and _files(store) == set(), "excluding sweeps rows and objects"
    assert client.get(f"/v1/projects/{a['key']}/media", headers=a["phone"]).status_code == 404
    assert _presign(client, a, _image(_pub(), 1)).status_code == 404


def test_a_project_in_the_stored_report_is_yours_without_a_session(client, store, created_users):
    """`held` reads the report too: a machine that sent `capture report` and no session
    still has the project on its Projects tab (docs/projects.md)."""
    from test_projects_route import _rekey, keys, machine_report

    uid, mac = _pair(client, created_users)
    key = uuid.uuid4().hex * 2
    built = machine_report()
    r = client.put("/v1/profile/report", json=_rekey(built, keys(built)[0], key), headers=mac)
    assert r.status_code == 200, r.text
    p = {"uid": uid, "mac": mac, "phone": _phone_for(mac), "key": key}
    assert _presign(client, p, _image(_pub(), 1)).status_code == 200


def test_a_capture_key_can_neither_publish_nor_read_a_demo(client, store, created_users):
    """The auth decision (routes/media.py): device tokens only. With its controls: the key
    is live on /v1/sync/known, and the device token passes on every route it was refused."""
    a = _person(client, created_users)
    pub = _pub()
    (mid,) = _publish(client, a, [(_image(pub, 1), PNG)])
    kh = _key_headers(_mint(client, a["phone"])["key"])
    assert client.get("/v1/sync/known", headers=kh).status_code == 200

    routes = [
        ("POST", f"/v1/projects/{a['key']}/media:presign", _image(_pub(), 1)),
        ("POST", f"/v1/projects/{a['key']}/media/{mid}:commit", None),
        ("GET", f"/v1/projects/{a['key']}/media", None),
        ("GET", f"/v1/projects/media:preview?keys={a['key']}", None),
        ("GET", f"/v1/media/{mid}", None),
        ("DELETE", f"/v1/projects/{a['key']}/media", None),
    ]
    for method, path, body in routes:
        refused = client.request(method, path, json=body, headers=kh)
        assert refused.status_code == 401, f"{method} {path}: {refused.text}"
        assert "capture key" in refused.json()["detail"]
    assert len(_listed(client, a)) == 1, "nothing moved"
    for method, path, body in routes:
        control = client.request(method, path, json=body, headers=a["mac"])
        assert control.status_code in (200, 204), f"{method} {path}: {control.text}"


def test_the_mac_publishes_and_the_phone_reads_one_account(client, store, created_users):
    """Two devices, one user: the paired Mac's device flow token and the phone's sign in
    token each do their half, and each can also do the other's."""
    a = _person(client, created_users)
    pub = _pub()
    slot = client.post(
        f"/v1/projects/{a['key']}/media:presign", json=_image(pub, 1), headers=a["phone"]
    )
    assert slot.status_code == 200
    assert _put(client, slot.json(), PNG).status_code == 204
    assert _commit(client, a, slot.json()["media_id"], headers=a["phone"]).status_code == 200
    assert len(_listed(client, a, headers=a["mac"])) == 1
    assert len(_listed(client, a, headers=a["phone"])) == 1


def test_a_stranger_a_follower_and_a_shared_session_viewer_get_nothing(
    client, store, created_users
):
    a = _person(client, created_users)
    pub = _pub()
    vid, still = _publish(client, a, [(_video(pub), MP4), (_image(pub, 1), PNG)])

    # A public profile, a public post of a session IN THIS PROJECT, and an accepted follower.
    _handle(a["uid"], f"demo-{a['uid'][:6]}", public=True)
    with owner_engine().connect() as c:
        sid = str(
            c.execute(
                text("SELECT id FROM sessions WHERE user_id = :u LIMIT 1"), {"u": a["uid"]}
            ).scalar()
        )
    post = _post(client, a["phone"], sid, "public")

    b = _person(client, created_users)  # a stranger with a project of their own
    _handle(b["uid"], f"follower-{b['uid'][:6]}", public=True)
    handle = f"demo-{a['uid'][:6]}"
    assert client.post(f"/v1/follows/{handle}", headers=b["phone"]).json()["state"] == "accepted"
    # b reads the shared session and the post: the social layer works for b...
    assert client.get(f"/v1/sessions/{sid}", headers=b["phone"]).status_code == 200
    assert client.get(f"/v1/posts/{post['id']}", headers=b["phone"]).status_code == 200

    # ...and reaches nothing of the demo. Each refusal has the owner's control beside it.
    for path in (f"/v1/media/{vid}", f"/v1/media/{vid}/poster", f"/v1/media/{still}"):
        assert client.get(path, headers=b["phone"]).status_code == 404, path
        assert client.get(path, headers=a["phone"]).status_code == 200, path
    listed = client.get(f"/v1/projects/{a['key']}/media", headers=b["phone"])
    assert listed.status_code == 404
    commit = client.post(f"/v1/projects/{a['key']}/media/{still}:commit", headers=b["mac"])
    assert commit.status_code == 404
    gone = client.delete(f"/v1/projects/{a['key']}/media", headers=b["phone"])
    assert gone.status_code == 404
    preview = client.get(f"/v1/projects/media:preview?keys={a['key']}", headers=b["phone"])
    assert preview.json()["projects"][a["key"]] == []
    assert len(_rows(a["uid"])) == 2, "the stranger's delete deleted nothing"
    assert len(_listed(client, a)) == 2
    feed = json.dumps(client.get("/v1/feed", headers=b["phone"]).json())
    assert vid not in feed and still not in feed and "project-media/" not in feed

    # The same repository in b's account (two people on one open source project resolve to
    # one key): b sees b's own, empty demo, and deleting it deletes b's own nothing.
    assert _upload(client, b["mac"], _payload(repo_hash=a["key"]))["accepted"] == 1
    assert client.get(f"/v1/projects/{a['key']}/media", headers=b["phone"]).json() == {"items": []}
    both = client.delete(f"/v1/projects/{a['key']}/media", headers=b["phone"])
    assert both.status_code == 200 and both.json() == {"deleted": 0}
    assert len(_rows(a["uid"])) == 2


def test_account_deletion_deletes_every_demo_and_its_objects(client, store, created_users):
    a = _person(client, created_users)
    b = _person(client, created_users)
    pub = _pub()
    _publish(client, a, [(_video(pub), MP4), (_image(pub, 1), PNG)])
    _publish(client, b, [(_image(_pub(), 1), PNG)])
    b_files = {f for f in _files(store) if b["uid"] in f}
    assert len(_files(store)) == 4 and len(b_files) == 1

    r = client.post("/v1/account/delete", headers=a["phone"])
    assert r.status_code == 200, r.text
    assert r.json()["row_counts"]["project_media"] == 2
    assert _rows(a["uid"]) == []
    assert _files(store) == b_files, "every object of the account, and only its"


# ------------------------------------------------------------------ RLS, below the routes


@pytest.fixture
def two_with_media():
    """Two users, each with one project_media row, made as the OWNER, so the ids the
    restricted connection is then asked about are known without asking it."""
    out = {}
    with owner_engine().begin() as c:
        for who in ("a", "b"):
            uid = str(uuid.uuid4())
            c.execute(text("INSERT INTO users (id) VALUES (:i)"), {"i": uid})
            mid = c.execute(text(_INSERT + " RETURNING id"), _row(uid)).scalar()
            out[who] = (uid, str(mid))
    yield out
    with owner_engine().begin() as c:
        c.execute(
            text("DELETE FROM users WHERE id = ANY(CAST(:ids AS uuid[]))"),
            {"ids": [u for u, _ in out.values()]},
        )


_INSERT = (
    "INSERT INTO project_media (user_id, project_key, publish_id, kind, object_key, "
    "content_type, width, height, bytes, position, label, source) VALUES "
    "(:u, :k, :p, 'image', :o, 'image/png', 10, 10, 100, 1, 'a still', 'capture')"
)


def _row(uid: str) -> dict:
    """A fresh row's values: its own publish, so it never collides with the fixture's slot."""
    return {
        "u": uid,
        "k": "e" * 64,
        "p": uuid.uuid4().hex[:16],
        "o": f"project-media/{uid}/{uuid.uuid4().hex}.png",
    }


def test_the_restricted_role_is_really_restricted():
    with app_engine().connect() as c:
        row = c.execute(
            text(
                "SELECT current_setting('is_superuser') AS su, "
                "(SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS brls"
            )
        ).one()
    assert row.su == "off" and row.brls is False


def test_a_viewer_cannot_write_a_row_for_someone_else(two_with_media):
    (a, _), (b, _) = two_with_media["a"], two_with_media["b"]
    _allowed(b, _INSERT, **_row(b))
    _refused(b, _INSERT, **_row(a))


def test_a_viewer_reads_only_their_own_rows(two_with_media):
    (a, ma), (b, mb) = two_with_media["a"], two_with_media["b"]
    one = "SELECT count(*) FROM project_media WHERE id = CAST(:m AS uuid)"
    assert _count(a, one, m=ma) == 1, "the control: the owner sees it"
    assert _count(b, one, m=ma) == 0
    assert _count(b, "SELECT count(*) FROM project_media") == 1
    assert (
        _count(None, "SELECT count(*) FROM project_media WHERE id = ANY(:ids)", ids=[ma, mb]) == 0
    )


def test_a_viewer_cannot_commit_delete_or_reassign_someone_elses_row(two_with_media):
    (a, ma), (b, _) = two_with_media["a"], two_with_media["b"]
    commit = (
        "UPDATE project_media SET committed = true, committed_at = now() "
        "WHERE id = CAST(:m AS uuid)"
    )
    delete = "DELETE FROM project_media WHERE id = CAST(:m AS uuid)"
    for sql in (commit, delete):
        with _as(a) as c:  # the control, rolled back: the owner's statement touches one row
            tx = c.begin()
            assert c.execute(text(sql), {"m": ma}).rowcount == 1
            tx.rollback()
        with _as(b) as c:
            tx = c.begin()
            assert c.execute(text(sql), {"m": ma}).rowcount == 0
            tx.commit()
    with owner_engine().connect() as c:
        row = c.execute(text("SELECT committed FROM project_media WHERE id = :m"), {"m": ma}).one()
    assert row.committed is False, "still there, still uncommitted"

    # The owner cannot move their own row to another person, or point it at another object:
    # builder_app holds UPDATE on committed and committed_at only (0026's column grants).
    for sql, params in (
        (
            "UPDATE project_media SET user_id = CAST(:b AS uuid) WHERE id = CAST(:m AS uuid)",
            {"b": b},
        ),
        (
            "UPDATE project_media SET object_key = 'project-media/x.png' "
            "WHERE id = CAST(:m AS uuid)",
            {},
        ),
    ):
        with _as(a) as c:
            tx = c.begin()
            with pytest.raises(ProgrammingError) as exc:
                c.execute(text(sql), {"m": ma, **params})
            tx.rollback()
        assert "permission denied" in str(exc.value)


# ----------------------------------------------------------------------- the S3 backend


def test_s3_mode_presigns_the_size_and_reads_through_short_lived_gets(
    client, s3, created_users, monkeypatch
):
    from builder import objectstore

    a = _person(client, created_users)
    pub = _pub()
    slot = _presign(client, a, _video(pub)).json()
    url = urlsplit(slot["upload_url"])
    q = {k: v[0] for k, v in parse_qs(url.query).items()}
    assert url.netloc == "acct.r2.cloudflarestorage.com"
    assert url.path.startswith(f"/builder-media/project-media/{a['uid']}/{a['key']}/")
    assert q["X-Amz-SignedHeaders"] == "content-length;content-type;host", "the size is signed"
    assert q["X-Amz-Expires"] == "900"
    assert slot["poster"]["headers"]["Content-Length"] == str(len(JPEG))

    stored: dict[str, bytes] = {}
    monkeypatch.setattr(
        objectstore,
        "s3_stat",
        lambda k, store=None: (len(stored[k]), None) if k in stored else None,
    )
    monkeypatch.setattr(
        objectstore,
        "s3_head_bytes",
        lambda k, n, store=None: stored[k][:n] if k in stored else None,
    )
    deleted: list[str] = []
    monkeypatch.setattr(objectstore, "s3_delete", lambda k, store=None: deleted.append(k))
    (row,) = _rows(a["uid"])
    assert _commit(client, a, slot["media_id"]).status_code == 409, "nothing in the bucket yet"
    stored[row.object_key] = MP4
    stored[row.poster_object_key] = JPEG[:-1]
    assert _commit(client, a, slot["media_id"]).status_code == 409, "the poster is short"
    stored[row.poster_object_key] = JPEG
    assert _commit(client, a, slot["media_id"]).status_code == 200

    (item,) = _listed(client, a)
    for link in (item["url"], item["poster_url"]):
        parts = urlsplit(link)
        q = {k: v[0] for k, v in parse_qs(parts.query).items()}
        assert parts.scheme == "https" and q["X-Amz-SignedHeaders"] == "host"
        assert q["X-Amz-Expires"] == "900"
    assert client.get(f"/v1/media/{item['id']}", headers=a["phone"]).status_code == 404

    assert client.delete(f"/v1/projects/{a['key']}/media", headers=a["phone"]).json() == {
        "deleted": 1
    }
    assert sorted(deleted) == sorted([row.object_key, row.poster_object_key])


def test_social_media_stays_s3_only_on_the_local_store(client, store, created_users):
    """A post's presign signs S3 URLs; with only a file:// endpoint it answers 503, as it
    does unconfigured, rather than signing a URL against a directory."""
    from builder import objectstore

    assert objectstore.backend() == "file" and objectstore.from_settings() is None
    a = _person(client, created_users)
    with owner_engine().connect() as c:
        sid = str(
            c.execute(text("SELECT id FROM sessions WHERE user_id = :u"), {"u": a["uid"]}).scalar()
        )
    post = _post(client, a["phone"], sid, "private")
    r = client.post(
        f"/v1/posts/{post['id']}/media:presign",
        json={"kind": "photo", "content_type": "image/jpeg", "bytes": 1000},
        headers=a["phone"],
    )
    assert r.status_code == 503


def test_unconfigured_storage_is_a_503_that_says_what_to_set(
    client, app_env, created_users, monkeypatch
):
    from builder.settings import settings

    for var in (
        "OBJECT_STORE_ENDPOINT",
        "OBJECT_STORE_BUCKET",
        "OBJECT_STORE_KEY",
        "OBJECT_STORE_SECRET",
    ):
        monkeypatch.delenv(var, raising=False)
    settings.cache_clear()
    a = _person(client, created_users)
    r = _presign(client, a, _image(_pub(), 1))
    assert r.status_code == 503 and "OBJECT_STORE_ENDPOINT" in r.json()["detail"]
