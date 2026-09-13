"""The two opt in switches (`privacy_prefs`, 0020), through the real routes AS builder_app.

docs/overnight-integration.md 2.3 and 2.4. Both switches start OFF, only the phone moves
them, and turning either OFF deletes what it let through IN THE SAME TRANSACTION as the
switch: a switch that hid the data while keeping it would be a display preference, and the
promise is that it is gone. The salt beside them is the server's alone.
"""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text
from test_capture_keys import _key_headers, _mint
from test_contract import SAMPLE_LIVE, SAMPLE_LIVE_NAMES
from test_quotes_route import _doc, _session, _stored
from test_sync import (  # noqa: F401 - fixtures are picked up by name
    TEST_DB,
    _live,
    _owner_rows,
    _pair,
    _upload,
    app_env,
    client,
    created_users,
    owner_engine,
    paired,
)

from builder import live_store, quotes

pytestmark = pytest.mark.skipif(not TEST_DB, reason="set BUILDER_TEST_DB to run")
_SHARED_FIXTURES = (app_env, client, created_users, paired)


def _prefs_row(uid: str):
    with owner_engine().connect() as c:
        return c.execute(
            text("SELECT quotes, live_names, map_salt FROM privacy_prefs WHERE user_id = :u"),
            {"u": uid},
        ).first()


def test_both_switches_default_off_and_the_salt_is_never_returned(client, paired):
    uid, headers = paired
    r = client.get("/v1/privacy/prefs", headers=headers)
    assert r.status_code == 200
    assert r.json() == {"quotes": False, "live_names": False}
    row = _prefs_row(uid)
    assert (row.quotes, row.live_names) == (False, False)
    assert row.map_salt not in r.text
    put = client.put("/v1/privacy/prefs", json={"live_names": True}, headers=headers)
    assert row.map_salt not in put.text and set(put.json()) == {"quotes", "live_names"}


def test_a_put_moves_only_the_switch_it_names(client, paired):
    uid, headers = paired
    r = client.put("/v1/privacy/prefs", json={"quotes": True}, headers=headers)
    assert r.json() == {"quotes": True, "live_names": False}
    r = client.put("/v1/privacy/prefs", json={"live_names": True}, headers=headers)
    assert r.json() == {"quotes": True, "live_names": True}
    r = client.put("/v1/privacy/prefs", json={"quotes": False}, headers=headers)
    assert r.json() == {"quotes": False, "live_names": True, "quotes_deleted": 0}
    assert client.get("/v1/privacy/prefs", headers=headers).json() == {
        "quotes": False,
        "live_names": True,
    }
    r = client.put("/v1/privacy/prefs", json={"quotes": True, "live_names": False}, headers=headers)
    assert r.json() == {"quotes": True, "live_names": False}


@pytest.mark.parametrize(
    "body",
    [{}, {"quotes": "yes"}, {"quotes": 1}, {"live_names": "true"}, {"quotes": True, "salt": "x"}],
)
def test_a_switch_takes_a_real_boolean_and_nothing_else(client, paired, body):
    """A string or a number is never read as a yes to sending a person's words, and the salt
    is not a key anyone can send."""
    uid, headers = paired
    r = client.put("/v1/privacy/prefs", json=body, headers=headers)
    assert r.status_code == 422, r.text
    assert client.get("/v1/privacy/prefs", headers=headers).json() == {
        "quotes": False,
        "live_names": False,
    }


def test_only_the_phone_flips_a_switch(client, paired):
    """A capture key can upload what the machine computes; it can never opt its own account
    into sending more, or read the switches back."""
    uid, headers = paired
    key = _key_headers(_mint(client, headers)["key"])
    assert client.get("/v1/privacy/prefs", headers=key).status_code == 401
    assert client.put("/v1/privacy/prefs", json={"quotes": True}, headers=key).status_code == 401
    assert client.put("/v1/privacy/prefs", json={"quotes": True}).status_code == 401
    assert _prefs_row(uid) is None or _prefs_row(uid).quotes is False


def test_the_switches_are_the_viewers_own(client, paired, created_users):
    a, ah = paired
    b, bh = _pair(client, created_users)
    client.put("/v1/privacy/prefs", json={"quotes": True, "live_names": True}, headers=ah)
    assert client.get("/v1/privacy/prefs", headers=bh).json() == {
        "quotes": False,
        "live_names": False,
    }
    assert _prefs_row(a).map_salt != _prefs_row(b).map_salt


def test_file_names_off_forgets_every_stored_name_in_the_same_request(client, paired):
    uid, headers = paired
    client.put("/v1/privacy/prefs", json={"live_names": True}, headers=headers)
    started = datetime.now(UTC).replace(microsecond=0) - timedelta(minutes=20)
    p = _live(started, 15, live=SAMPLE_LIVE, live_names=SAMPLE_LIVE_NAMES)
    assert _upload(client, headers, p)["accepted"] == 1
    sid = _owner_rows(uid)[0].id
    assert client.get(f"/v1/sessions/{sid}", headers=headers).json()["live_names"] == (
        SAMPLE_LIVE_NAMES
    )
    r = client.put("/v1/privacy/prefs", json={"live_names": False}, headers=headers)
    assert r.json() == {"quotes": False, "live_names": False}
    with owner_engine().connect() as c:
        names = c.execute(
            text("SELECT names FROM session_live WHERE session_id = :s"), {"s": sid}
        ).scalar()
    assert names is None, "off deletes the names; it does not only stop showing them"
    assert client.get(f"/v1/sessions/{sid}", headers=headers).json()["live_names"] is None
    # And the next upload carrying names is refused, not stored.
    again = _live(
        started,
        16,
        client_session_id=p["client_session_id"],
        live=SAMPLE_LIVE,
        live_names=SAMPLE_LIVE_NAMES,
    )
    assert _upload(client, headers, again)["accepted"] == 0


def test_an_off_that_cannot_delete_does_not_move_the_switch(client, paired, monkeypatch):
    """One transaction: when the delete fails, the switch is still ON and the quotes are
    still there, so the phone can say "Nothing changed" truthfully and try again."""
    from fastapi.testclient import TestClient

    from builder.main import app

    uid, headers = paired
    csid = _session(client, headers)
    client.put("/v1/privacy/prefs", json={"quotes": True}, headers=headers)
    assert client.put("/v1/profile/quotes", json=_doc(csid), headers=headers).status_code == 200

    def broken(db, user_id):
        raise RuntimeError("the delete failed")

    monkeypatch.setattr(quotes, "delete_quotes", broken)
    r = TestClient(app, raise_server_exceptions=False).put(
        "/v1/privacy/prefs", json={"quotes": False}, headers=headers
    )
    assert r.status_code == 500
    assert _prefs_row(uid).quotes is True
    assert _stored(uid) is not None


def test_file_names_off_is_one_transaction_too(client, paired, monkeypatch):
    from fastapi.testclient import TestClient

    from builder.main import app

    uid, headers = paired
    client.put("/v1/privacy/prefs", json={"quotes": True, "live_names": True}, headers=headers)
    real = live_store.set_live_names

    def then_fail(db, user_id, on):
        real(db, user_id, on)
        raise RuntimeError("after the names were forgotten")

    monkeypatch.setattr(live_store, "set_live_names", then_fail)
    r = TestClient(app, raise_server_exceptions=False).put(
        "/v1/privacy/prefs", json={"quotes": False, "live_names": False}, headers=headers
    )
    assert r.status_code == 500
    row = _prefs_row(uid)
    assert (row.quotes, row.live_names) == (True, True), "neither switch moved"
