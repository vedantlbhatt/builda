"""The quotes document, the second opt in exception, through the real routes AS builder_app.

docs/overnight-integration.md 2.4. Every guarantee here fails OPEN without an error if it
fails at all: a quote stored while the switch is off, one that outlives the switch, a pasted
account id quoted on a card, a quote that surfaces in somebody else's feed. So each test
drives the routes the phone and the machine use, then reads the table as its OWNER, so a
route that merely hid a row cannot pass for one that deleted it.
"""

import copy
import json

import pytest
from sqlalchemy import text
from test_capture_keys import _key_headers, _mint
from test_social import _handle_of, _person, _post
from test_sync import (  # noqa: F401 - fixtures are picked up by name
    TEST_DB,
    _owner_rows,
    _pair,
    _payload,
    _upload,
    app_env,
    client,
    created_users,
    owner_engine,
    paired,
)

from builder import quotes

pytestmark = pytest.mark.skipif(not TEST_DB, reason="set BUILDER_TEST_DB to run")
_SHARED_FIXTURES = (app_env, client, created_users, paired)

#: A quote nobody could mistake for anything else in a response body.
SENTINEL = "zqx sentinel prompt about the parser"


def _doc(csid: str, text_: str = SENTINEL, card: str = "go_to_prompt", n: int = 1) -> dict:
    q = {
        "card": card,
        "text": text_,
        "client_session_id": csid,
        "sent_at": "2026-09-12T10:00:00Z",
        "seconds_in": 42,
        "tool_calls_after": None,
        "corrected": None,
    }
    return {
        "quotes_version": 1,
        "generated_at": "2026-09-13T10:00:00Z",
        "quotes": [copy.deepcopy(q) for _ in range(n)],
    }


def _session(client, headers) -> str:
    """One uploaded final session: the quote's `client_session_id` must be one the account
    holds."""
    p = _payload()
    assert _upload(client, headers, p)["accepted"] == 1
    return p["client_session_id"]


def _switch(client, headers, on: bool) -> dict:
    r = client.put("/v1/privacy/prefs", json={"quotes": on}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _stored(uid: str):
    with owner_engine().connect() as c:
        return c.execute(
            text("SELECT quotes_version, body FROM builder_quotes WHERE user_id = :u"), {"u": uid}
        ).first()


def _put(client, headers, doc):
    return client.put("/v1/profile/quotes", json=doc, headers=headers)


def test_quotes_are_refused_while_the_account_has_them_off(client, paired):
    """The machine alone can never opt in: --quotes with the phone's switch off is a 409
    that names the switch, and nothing is stored."""
    uid, headers = paired
    csid = _session(client, headers)
    key = _mint(client, headers)["key"]
    r = _put(client, _key_headers(key), _doc(csid))
    assert r.status_code == 409
    assert r.json() == {"reason": quotes.QUOTES_OFF}
    assert "Settings" in r.json()["reason"] and "Quote my prompts" in r.json()["reason"]
    assert _stored(uid) is None


def test_quotes_round_trip_when_on(client, paired):
    uid, headers = paired
    csid = _session(client, headers)
    assert _switch(client, headers, True) == {"quotes": True, "live_names": False}
    key = _mint(client, headers)["key"]
    doc = _doc(csid, card="cryptic_prompt")
    doc["quotes"][0].update(tool_calls_after=4, corrected=False)
    r = _put(client, _key_headers(key), doc)
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "quotes_version": 1, "quotes": 1}
    row = _stored(uid)
    assert row.quotes_version == 1 and row.body == doc
    served = client.get("/v1/profile/builder", headers=headers).json()["quotes"]
    assert served == doc
    # A second document replaces the first: one row per person, no history.
    newer = _doc(csid, "ship the sync endpoint before lunch")
    assert _put(client, _key_headers(key), newer).status_code == 200
    assert _stored(uid).body == newer


def test_turning_quotes_off_deletes_them(client, paired):
    uid, headers = paired
    csid = _session(client, headers)
    _switch(client, headers, True)
    assert _put(client, headers, _doc(csid)).status_code == 200
    assert _switch(client, headers, False) == {
        "quotes": False,
        "live_names": False,
        "quotes_deleted": 1,
    }
    assert _stored(uid) is None, "off deletes; it does not hide"
    assert client.get("/v1/profile/builder", headers=headers).json()["quotes"] is None
    # A measured zero the second time, and the switch stays off.
    assert _switch(client, headers, False)["quotes_deleted"] == 0
    assert _put(client, headers, _doc(csid)).status_code == 409
    # Turning it on stores nothing by itself: the machine must still say yes.
    on = _switch(client, headers, True)
    assert "quotes_deleted" not in on and _stored(uid) is None


def test_a_quote_over_160_is_refused(client, paired):
    uid, headers = paired
    csid = _session(client, headers)
    _switch(client, headers, True)
    r = _put(client, headers, _doc(csid, "word " * 32 + "x"))  # 161 characters
    assert r.status_code == 422
    assert _put(client, headers, _doc(csid, n=4)).status_code == 422, "at most three"
    bad = _doc(csid)
    bad["quotes"][0]["card"] = "longest_session"
    assert _put(client, headers, bad).status_code == 422, "only the three quote cards"
    extra = _doc(csid)
    extra["quotes"][0]["prompt"] = "more words"
    assert _put(client, headers, extra).status_code == 422, "no undeclared key"
    assert _stored(uid) is None


@pytest.mark.parametrize(
    "said",
    [
        # Each filter has a case only it catches, so none of them can be dropped silently:
        "send the invite to someone@example.com today",  # the mask alone (an address)
        "the team id is Q7ZK2M9X4P, use that",  # quotable alone: letters and digits interleaved
        "try the key sk-ant-api03-AbCdEfGhIjKlMnOpQrSt",  # a key: the mask and the id shape
        "why is /Users/someone/src/app.py so slow",  # a path on the machine
        "/model opus",  # a slash command, not somebody's words
        "the prod db password is hunter2pass",  # a secret the mask names
        "Traceback (most recent call last):\nValueError: nope",  # a paste
    ],
)
def test_a_quote_with_a_mask_or_an_identifier_is_refused(client, paired, said):
    """The machine's own filters, run on the server a third time; the refusal names the
    quote and the rule, never the text."""
    uid, headers = paired
    csid = _session(client, headers)
    _switch(client, headers, True)
    r = _put(client, headers, _doc(csid, said[:160]))
    assert r.status_code == 422, r.text
    reason = r.json()["reason"]
    assert reason.startswith("quote 1 (go_to_prompt)")
    for word in said.split():
        if len(word) > 5:
            assert word not in reason
    assert _stored(uid) is None


def test_a_quote_from_a_session_the_account_never_uploaded_is_refused(
    client, paired, created_users
):
    """An excluded repository's sessions are deleted from the server; a quote from one of
    them, or from any session the server does not hold, has no business here."""
    uid, headers = paired
    held = _session(client, headers)
    _switch(client, headers, True)
    doc = _doc(held, n=2)
    doc["quotes"][1]["client_session_id"] = "e" * 64
    r = _put(client, headers, doc)
    assert r.status_code == 422
    assert r.json()["reason"] == "quote 2 names a session this account has not uploaded"
    # Someone else's session is not held by this account either.
    _, other_headers = _pair(client, created_users)
    theirs = _session(client, other_headers)
    assert _put(client, headers, _doc(theirs)).status_code == 422
    assert _stored(uid) is None


def test_no_engine_means_nothing_is_stored(client, paired, monkeypatch):
    uid, headers = paired
    csid = _session(client, headers)
    _switch(client, headers, True)

    def missing():
        raise quotes.EngineUnavailable("no analysis here")

    monkeypatch.setattr(quotes, "_filters", missing)
    r = _put(client, headers, _doc(csid))
    assert r.status_code == 503 and r.json() == {"reason": quotes.ENGINE_MISSING}
    assert _stored(uid) is None


def test_delete_quotes_route(client, paired):
    uid, headers = paired
    csid = _session(client, headers)
    _switch(client, headers, True)
    assert _put(client, headers, _doc(csid)).status_code == 200
    key = _mint(client, headers)["key"]
    # `capture quotes --delete` holds a capture key; the phone a device token. Both may.
    r = client.delete("/v1/profile/quotes", headers=_key_headers(key))
    assert r.status_code == 204 and r.content == b""
    assert _stored(uid) is None
    assert client.delete("/v1/profile/quotes", headers=headers).status_code == 204
    # The switch is the phone's, and deleting the quotes does not turn it off.
    assert client.get("/v1/privacy/prefs", headers=headers).json()["quotes"] is True


def test_quotes_never_reach_the_feed_or_a_shared_session(client, created_users):
    """Owner only, and joined by no social query: the author's quote is on their own
    builder profile and nowhere a follower, a stranger or an anonymous reader can look."""
    author, ah = _person(client, created_users, "quoter")
    reader, rh = _person(client, created_users, "reader")
    csid = _session(client, ah)
    sid = str(next(r.id for r in _owner_rows(author) if r.client_session_id == csid))
    _switch(client, ah, True)
    assert _put(client, ah, _doc(csid)).status_code == 200
    _post(client, ah, sid, "public", caption="shipped the parser")
    handle = _handle_of(author)
    r = client.post(f"/v1/follows/{handle}", headers=rh)
    assert r.status_code in (200, 201), r.text

    assert SENTINEL in client.get("/v1/profile/builder", headers=ah).text, "the owner sees it"
    for path in (
        "/v1/feed",
        f"/v1/users/{handle}",
        f"/v1/sessions/{sid}",
        "/v1/profile/builder",
        "/v1/profile",
    ):
        r = client.get(path, headers=rh)
        assert r.status_code in (200, 404), (path, r.status_code)
        assert SENTINEL not in r.text, path
    for path in (f"/v1/users/{handle}", f"/v1/sessions/{sid}", "/v1/feed"):
        assert SENTINEL not in client.get(path).text, path
    # And as the reader's own viewer, straight at the table: the policy, not the route.
    from test_live_rls import _count

    n = _count(reader, "SELECT count(*) FROM builder_quotes WHERE user_id = :u", u=author)
    assert n == 0
    assert json.dumps(_stored(author).body).count(SENTINEL) == 1
