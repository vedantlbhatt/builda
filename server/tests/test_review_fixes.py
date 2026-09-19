"""What a security review of the server found on 2026-09-19, held (the probes that reproduced
each one, with their assertions turned round):

  1. A paired machine could start a move it wrote (test_drops.py holds the refusal).
  2. Excluding a repository left drop moves naming it, with the run's last words.
  3. The pairing start took unbounded fields from anyone and kept expired grants.
  5. The media sweep deleted only the uncommitted half of an abandoned publish.
  6. A malformed id, or a reading of an archived drop, came back a 500.
"""

import uuid

import pytest
from sqlalchemy import text
from test_drops import _move, _resolution, _share
from test_project_media import (  # noqa: F401 - fixtures are picked up by name
    PNG,
    _commit,
    _image,
    _listed,
    _person,
    _presign,
    _pub,
    _put,
    store,
)
from test_sync import (  # noqa: F401 - fixtures are picked up by name
    TEST_DB,
    _phone_for,
    app_env,
    client,
    created_users,
    owner_engine,
    paired,
)

pytestmark = pytest.mark.skipif(not TEST_DB, reason="set BUILDER_TEST_DB to run")
_SHARED_FIXTURES = (app_env, client, created_users, paired, store)


def test_excluding_a_repository_clears_the_drop_moves_that_name_it(client, paired):
    _uid, mac = paired
    key = uuid.uuid4().hex * 2
    with owner_engine().begin() as c:
        c.execute(
            text(
                "INSERT INTO repos (repo_hash, pepper_version, repo_id_basis) "
                "VALUES (:h, 1, 'origin')"
            ),
            {"h": key},
        )
    try:
        drop = _share(client, mac).json()["drop"]
        mv = _move(move_kind="apply", target="existing_repo")
        client.put(f"/v1/drops/{drop['id']}/resolution", json=_resolution([mv]), headers=mac)
        (move,) = client.get(f"/v1/drops/{drop['id']}", headers=mac).json()["moves"]
        phone = _phone_for(mac)
        base = f"/v1/drops/{drop['id']}/moves/{move['id']}"
        assert (
            client.post(f"{base}:start", json={"repo_key": key}, headers=phone).status_code == 200
        )
        client.post("/v1/drops/moves:claim", headers=mac)
        r = client.post(
            f"/v1/drops/moves/{move['id']}:finish",
            json={"status": "done", "outcome": "Edited src/secret_thing.py and .env.local"},
            headers=mac,
        )
        assert r.status_code == 200, r.text
        r = client.post(
            "/v1/repos/visibility", json={"repo_hash": key, "visibility": "excluded"}, headers=phone
        )
        assert r.status_code == 200, r.text
        with owner_engine().connect() as c:
            row = c.execute(
                text("SELECT repo_key, outcome FROM drop_moves WHERE id = :i"), {"i": move["id"]}
            ).one()
        assert (row.repo_key, row.outcome) == (None, None)

        # And nothing new is started there.
        drop2 = _share(client, mac, url="https://www.tiktok.com/@a/video/77").json()["drop"]
        client.put(f"/v1/drops/{drop2['id']}/resolution", json=_resolution([mv]), headers=mac)
        (move2,) = client.get(f"/v1/drops/{drop2['id']}", headers=mac).json()["moves"]
        r = client.post(
            f"/v1/drops/{drop2['id']}/moves/{move2['id']}:start",
            json={"repo_key": key},
            headers=phone,
        )
        assert r.status_code == 409
    finally:
        with owner_engine().begin() as c:
            c.execute(text("DELETE FROM repos WHERE repo_hash = :h"), {"h": key})


def test_the_pairing_start_is_bounded_and_forgets_old_grants(client):
    too_long = client.post(
        "/v1/auth/device/start",
        json={"machine_id": "a" * 64, "label": "x" * 5000, "agent_version": "0.1"},
    )
    assert too_long.status_code == 422
    old = uuid.uuid4().hex * 2
    with owner_engine().begin() as c:
        c.execute(
            text(
                "INSERT INTO device_grants (device_code, user_code, machine_id, label, platform, "
                "agent_version, expires_at) VALUES (:dc, 'OLDG-RANT', :mid, 'l', "
                "'macos', 'v', now() - interval '2 days')"
            ),
            {"dc": old, "mid": uuid.uuid4().hex * 2},
        )
    r = client.post(
        "/v1/auth/device/start",
        json={"machine_id": "b" * 64, "label": "a Mac", "agent_version": "0.1"},
    )
    assert r.status_code == 200
    with owner_engine().connect() as c:
        left = c.execute(
            text("SELECT count(*) FROM device_grants WHERE device_code = :dc"), {"dc": old}
        ).scalar()
    assert left == 0


def test_the_sweep_takes_a_whole_abandoned_publish(client, store, created_users):
    from builder import media_sweep

    p = _person(client, created_users)
    p1 = _pub()
    for pos in (1, 2):
        s = _presign(client, p, _image(p1, pos)).json()
        assert _put(client, s, PNG).status_code == 204
        assert _commit(client, p, s["media_id"]).status_code == 200
    p2 = _pub()
    a = _presign(client, p, _image(p2, 1)).json()
    b = _presign(client, p, _image(p2, 2)).json()
    assert _put(client, a, PNG).status_code == 204
    assert _commit(client, p, a["media_id"]).status_code == 200  # b never uploaded
    with owner_engine().begin() as c:
        c.execute(
            text(
                "UPDATE project_media SET created_at = now() - interval '31 minutes' "
                "WHERE id = CAST(:m AS uuid)"
            ),
            {"m": b["media_id"]},
        )
    media_sweep.sweep_all(owner_engine())
    # The old set, whole, and nothing of the abandoned one beside it.
    assert len(_listed(client, p)) == 2


def test_a_malformed_id_is_a_404_and_an_archived_drop_takes_no_reading(app_env, paired):
    from fastapi.testclient import TestClient

    from builder.main import app

    c = TestClient(app, raise_server_exceptions=False)
    _uid, mac = paired
    assert c.get("/v1/drops/not-a-uuid", headers=mac).status_code == 404
    drop = _share(c, mac).json()["drop"]
    assert c.post(f"/v1/drops/{drop['id']}:archive", headers=mac).status_code == 200
    r = c.put(f"/v1/drops/{drop['id']}/resolution", json=_resolution(), headers=mac)
    assert r.status_code == 409
