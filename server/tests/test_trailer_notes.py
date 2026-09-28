"""Trailer notes (0035, spec/trailer.v1.json) AS builder_app, through the routes and below them.

What this file holds, each of which would fail OPEN with no error if it failed at all:

  1. A NOTE IS A PERSON'S ASK. The phone sends it and may take it back; the Mac (a device flow
     token) cannot do either, so no machine can make the Mac run claude over a project by itself.
  2. ONE PERSON'S NOTES ARE THEIRS, through a second real account's phone and Mac (made here,
     never skipped for want of one: CLAUDE.md), and below the routes as builder_app, with the
     victim's ids resolved through the owner engine first and a positive control beside every
     refusal.
  3. A NOTE IS CLAIMED ONCE, finished once, done with a version or failed with a code, and a claim a
     Mac abandoned is taken back from when it was TAKEN (0034).
  4. AT MOST FIVE WAIT on a project.
  5. EXCLUDING THE REPOSITORY AND DELETING THE ACCOUNT take the notes.
  6. THE MIGRATION'S CHECK LISTS ARE THE SPEC'S ENUMS, both ways (read with `ast`).
"""

from __future__ import annotations

import ast
import pathlib
import re
import uuid

import pytest
from sqlalchemy import text
from test_capture_keys import _key_headers, _mint
from test_live_rls import _allowed, _as, _count, _refused
from test_project_media import _person
from test_sync import (  # noqa: F401 - fixtures are picked up by name
    TEST_DB,
    _payload,
    _upload,
    app_env,
    client,
    created_users,
    owner_engine,
)

from builder.trailer_spec import TRAILER_ENUM_VALUES, TRAILER_MAX_LENGTHS

pytestmark = pytest.mark.skipif(not TEST_DB, reason="set BUILDER_TEST_DB to run")
_SHARED_FIXTURES = (app_env, client, created_users)

ROOT = pathlib.Path(__file__).resolve().parents[2]


def _notes_url(p: dict) -> str:
    return f"/v1/projects/{p['key']}/trailer/notes"


def _send(client, p: dict, body: str = "make it shorter and orange", headers=None):
    return client.post(_notes_url(p), json={"body": body}, headers=headers or p["phone"])


def _note(client, p: dict, body: str = "make it shorter and orange") -> dict:
    r = _send(client, p, body)
    assert r.status_code == 201, r.text
    return r.json()["note"]


def _claim(client, p: dict, headers=None) -> list[dict]:
    r = client.post("/v1/trailer/notes:claim", headers=headers or p["mac"])
    assert r.status_code == 200, r.text
    return r.json()["notes"]


def _finish(client, p: dict, note_id: str, headers=None, **body):
    doc = {"status": "done", "from_version": 1, "to_version": 2, "changes": [], **body}
    return client.post(f"/v1/trailer/notes/{note_id}:finish", json=doc, headers=headers or p["mac"])


def _list(client, p: dict, headers=None, **params):
    return client.get(_notes_url(p), params=params, headers=headers or p["phone"])


# ------------------------------------------------------------------------ the conversation


def test_a_note_goes_to_the_mac_and_comes_back_with_the_new_version(client, created_users):
    a = _person(client, created_users)
    note = _note(client, a, "  make it shorter and orange  ")
    assert note["status"] == "queued" and note["body"] == "make it shorter and orange", "trimmed"
    assert set(note) == {
        "id",
        "body",
        "status",
        "created_at",
        "finished_at",
        "from_version",
        "to_version",
        "changes",
        "refusal",
        "source",
    }
    assert (note["changes"], note["to_version"], note["finished_at"]) == ([], None, None)

    claimed = _claim(client, a)
    assert claimed == [
        {
            "id": note["id"],
            "project_key": a["key"],
            "body": "make it shorter and orange",
            "created_at": note["created_at"],
        }
    ]
    assert _claim(client, a) == [], "once"
    assert _list(client, a).json()["notes"][0]["status"] == "claimed"

    changes = [
        {"code": "seconds", "before": "20", "after": "14"},
        {"code": "hue", "before": "tide", "after": "ember"},
    ]
    r = _finish(client, a, note["id"], changes=changes, source="rules")
    assert r.status_code == 200, r.text
    done = r.json()["note"]
    assert (done["status"], done["from_version"], done["to_version"]) == ("done", 1, 2)
    assert done["changes"] == changes and done["source"] == "rules" and done["refusal"] is None
    assert done["finished_at"] is not None
    listed = _list(client, a).json()["notes"]
    assert listed == [done], "the chat reads back exactly what the Mac answered"
    assert _finish(client, a, note["id"]).status_code == 409, "a finished note stays finished"


def test_a_note_that_cannot_be_done_fails_with_a_code_and_nothing_made(client, created_users):
    a = _person(client, created_users)
    nid = _note(client, a, "make it a movie about dogs")["id"]
    _claim(client, a)
    r = _finish(
        client,
        a,
        nid,
        status="failed",
        from_version=3,
        to_version=None,
        refusal="needs_new_capture",
        source="model",
    )
    assert r.status_code == 200, r.text
    n = r.json()["note"]
    assert (n["status"], n["refusal"], n["to_version"], n["changes"]) == (
        "failed",
        "needs_new_capture",
        None,
        [],
    )
    assert n["from_version"] == 3 and n["source"] == "model"


def test_the_finish_door(client, created_users):
    a = _person(client, created_users)
    nid = _note(client, a)["id"]
    assert _finish(client, a, nid).json()["detail"] == "not_claimed", "queued is not claimed"
    assert _finish(client, a, nid).status_code == 409
    _claim(client, a)
    cases = [
        ({"status": "claimed"}, "not_finishable"),
        ({"status": "cancelled"}, "not_finishable"),
        ({"to_version": None}, "done_needs_version"),
        ({"refusal": "no_model"}, "done_has_refusal"),
        ({"status": "failed", "to_version": None}, "failed_needs_refusal"),
        ({"status": "failed", "refusal": "no_model"}, "failed_has_version"),
        (
            {
                "status": "failed",
                "to_version": None,
                "refusal": "no_model",
                "changes": [{"code": "hue", "before": None, "after": "ember"}],
            },
            "failed_has_changes",
        ),
    ]
    for body, code in cases:
        r = _finish(client, a, nid, **body)
        assert (r.status_code, r.json()["detail"]) == (422, code), body
    # The generated door: only the spec's codes, only its fields, only its bounds.
    for body in (
        {"refusal": "made_up", "status": "failed", "to_version": None},
        {"changes": [{"code": "made_up"}]},
        {"changes": [{"code": "hue", "after": "x" * (TRAILER_MAX_LENGTHS["value"] + 1)}]},
        {"changes": [{"code": "hue", "after": "ember"}] * 13},
        {"source": "a person"},
        {"to_version": 1001},
        {"to_version": 0},
        {"sentence": "I made it orange for you"},
    ):
        assert _finish(client, a, nid, **body).status_code == 422, body
    assert _list(client, a).json()["notes"][0]["status"] == "claimed", "nothing moved it"
    assert _finish(client, a, str(uuid.uuid4())).status_code == 404
    assert _finish(client, a, "not-a-uuid").json()["detail"] == "not_found"


def test_a_note_is_a_persons_ask_never_the_macs(client, created_users):
    a = _person(client, created_users)
    r = _send(client, a, headers=a["mac"])
    assert r.status_code == 403, "the Mac cannot ask itself to run claude over a project"
    assert _list(client, a).json()["notes"] == []
    nid = _note(client, a)["id"]
    assert client.delete(f"/v1/trailer/notes/{nid}", headers=a["mac"]).status_code == 403
    # The Mac reads the chat, as the kit routes let it read the kit.
    assert _list(client, a, headers=a["mac"]).status_code == 200
    kh = _key_headers(_mint(client, a["phone"])["key"])
    assert client.get("/v1/sync/known", headers=kh).status_code == 200, "the key is live"
    assert client.post("/v1/trailer/notes:claim", headers=kh).status_code == 401
    assert _list(client, a, headers=kh).status_code == 401
    assert _send(client, a, headers=kh).status_code == 401


def test_the_note_door(client, created_users):
    a = _person(client, created_users)
    assert (_send(client, a, "   ").status_code, _send(client, a, "   ").json()["detail"]) == (
        422,
        "empty_note",
    )
    cap = TRAILER_MAX_LENGTHS["note"]
    assert _send(client, a, "x" * cap).status_code == 201
    assert _send(client, a, "x" * (cap + 1)).status_code == 422
    extra = client.post(
        _notes_url(a), json={"body": "shorter", "project_key": a["key"]}, headers=a["phone"]
    )
    assert extra.status_code == 422, "nothing undeclared"
    short = {**a, "key": a["key"][:12]}
    assert _send(client, short).json()["detail"] == "bad_key"
    nowhere = {**a, "key": uuid.uuid4().hex * 2}
    assert _send(client, nowhere).status_code == 404, "a key typed from nowhere"
    assert _list(client, nowhere).status_code == 404


def test_at_most_five_wait_on_a_project(client, created_users):
    a = _person(client, created_users)
    ids = [_note(client, a, f"note {i}")["id"] for i in range(5)]
    r = _send(client, a, "a sixth")
    assert (r.status_code, r.json()["detail"]) == (409, "too_many_notes")
    # Claimed still waits: the Mac has not answered.
    assert len(_claim(client, a)) == 5
    assert _send(client, a, "a sixth").status_code == 409
    # One answered, one more may wait.
    assert _finish(client, a, ids[0]).status_code == 200
    assert _send(client, a, "a sixth").status_code == 201
    assert _send(client, a, "a seventh").status_code == 409
    # The cap is a project's: another project of the same person has its own five.
    second = {**a, "key": uuid.uuid4().hex * 2}
    assert _upload(client, a["mac"], _payload(repo_hash=second["key"]))["accepted"] == 1
    assert _send(client, second).status_code == 201


def test_a_cancel_takes_back_only_a_note_nobody_claimed(client, created_users):
    a = _person(client, created_users)
    first = _note(client, a, "first")["id"]
    r = client.delete(f"/v1/trailer/notes/{first}", headers=a["phone"])
    assert r.status_code == 200 and r.json()["note"]["status"] == "cancelled"
    assert _claim(client, a) == [], "a cancelled note is never claimed"
    second = _note(client, a, "second")["id"]
    assert [n["id"] for n in _claim(client, a)] == [second]
    r = client.delete(f"/v1/trailer/notes/{second}", headers=a["phone"])
    assert (r.status_code, r.json()["detail"]) == (409, "not_queued")
    again = client.delete(f"/v1/trailer/notes/{first}", headers=a["phone"])
    assert (again.status_code, again.json()["detail"]) == (409, "not_queued")
    unknown = client.delete(f"/v1/trailer/notes/{uuid.uuid4()}", headers=a["phone"])
    assert (unknown.status_code, unknown.json()["detail"]) == (404, "not_found")
    assert [n["status"] for n in _list(client, a).json()["notes"]] == ["claimed", "cancelled"]


def test_a_claim_a_mac_abandoned_is_taken_back_from_when_it_was_taken(client, created_users):
    a = _person(client, created_users)
    old = _note(client, a, "an old note")["id"]
    # The note was sent long ago and claimed just now: its age is not the claim's.
    with owner_engine().begin() as c:
        c.execute(
            text(
                "UPDATE trailer_notes SET created_at = now() - interval '2 hours' "
                "WHERE id = CAST(:i AS uuid)"
            ),
            {"i": old},
        )
    assert [n["id"] for n in _claim(client, a)] == [old]
    assert _claim(client, a) == [], "a fresh claim is not stale, however old the note"
    with owner_engine().begin() as c:
        c.execute(
            text(
                "UPDATE trailer_notes SET claimed_at = now() - interval '11 minutes' "
                "WHERE id = CAST(:i AS uuid)"
            ),
            {"i": old},
        )
    assert [n["id"] for n in _claim(client, a)] == [old], "the Mac closed its lid: taken back"
    assert _finish(client, a, old).status_code == 200


def test_the_limit(client, created_users):
    a = _person(client, created_users)
    for i in range(3):
        _note(client, a, f"note {i}")
    notes = _list(client, a, limit=2).json()["notes"]
    assert [n["body"] for n in notes] == ["note 2", "note 1"], "newest first"
    assert _list(client, a, limit=0).status_code == 422
    assert _list(client, a, limit=101).status_code == 422


# ------------------------------------------------------------------ one person's notes


def test_one_persons_notes_are_theirs(client, created_users):
    a = _person(client, created_users)
    b = _person(client, created_users)
    nid = _note(client, a)["id"]
    assert _send(client, a, headers=b["phone"]).status_code == 404, "b cannot write to a's"
    assert _list(client, a, headers=b["phone"]).status_code == 404, "nor read a's"
    assert _list(client, a, headers=b["mac"]).status_code == 404
    assert _claim(client, b) == [], "b's Mac claims nothing of a's"
    assert client.delete(f"/v1/trailer/notes/{nid}", headers=b["phone"]).status_code == 404
    # The control: a's own Mac claims it, and b cannot finish it.
    assert [n["id"] for n in _claim(client, a)] == [nid]
    assert _finish(client, a, nid, headers=b["mac"]).status_code == 404
    assert _finish(client, a, nid).status_code == 200


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


_NOTE = (
    "INSERT INTO trailer_notes (user_id, project_key, body) "
    "VALUES (CAST(:u AS uuid), :k, 'shorter')"
)


def test_the_policies_hold_below_the_routes(two_users):
    a, b = two_users
    k = "e" * 64
    _allowed(a, _NOTE, u=a, k=k)
    _refused(a, _NOTE, u=b, k=k)
    with owner_engine().begin() as c:
        mine = c.execute(text(_NOTE + " RETURNING id"), {"u": a, "k": k}).scalar()
        theirs = c.execute(text(_NOTE + " RETURNING id"), {"u": b, "k": k}).scalar()
    one = "SELECT count(*) FROM trailer_notes WHERE id = CAST(:n AS uuid)"
    assert _count(b, one, n=str(theirs)) == 1, "the control: its owner sees it"
    assert _count(a, one, n=str(theirs)) == 0
    assert _count(None, one, n=str(theirs)) == 0, "no viewer sees nothing"
    claim = (
        "UPDATE trailer_notes SET status = 'claimed', claimed_at = now() "
        "WHERE id = CAST(:n AS uuid)"
    )
    with _as(a) as c:
        tx = c.begin()
        assert c.execute(text(claim), {"n": str(mine)}).rowcount == 1, "the control"
        assert c.execute(text(claim), {"n": str(theirs)}).rowcount == 0, "b's note is not a's"
        tx.rollback()
    with owner_engine().connect() as c:
        assert (
            c.execute(
                text("SELECT status FROM trailer_notes WHERE id = CAST(:n AS uuid)"),
                {"n": str(theirs)},
            ).scalar()
            == "queued"
        )


def test_the_owners_words_are_fixed_at_insert(two_users):
    a, _ = two_users
    with owner_engine().begin() as c:
        mine = c.execute(text(_NOTE + " RETURNING id"), {"u": a, "k": "e" * 64}).scalar()
    with _as(a) as c:
        tx = c.begin()
        with pytest.raises(Exception) as exc:
            c.execute(
                text("UPDATE trailer_notes SET body = 'longer' WHERE id = CAST(:n AS uuid)"),
                {"n": str(mine)},
            )
        tx.rollback()
    assert "permission denied" in str(exc.value)


# ------------------------------------------------------------------ the sweeps


def test_excluding_the_repository_and_deleting_the_account_take_the_notes(client, created_users):
    a = _person(client, created_users)
    b = _person(client, created_users)
    _note(client, a)
    _note(client, b)
    r = client.post(
        "/v1/repos/visibility",
        json={"repo_hash": a["key"], "visibility": "excluded"},
        headers=a["phone"],
    )
    assert r.status_code == 200, r.text
    assert _count(a["uid"], "SELECT count(*) FROM trailer_notes") == 0
    assert _send(client, a).status_code == 404, "an excluded project takes no new notes"
    assert _count(b["uid"], "SELECT count(*) FROM trailer_notes") == 1, "b's are b's"
    assert client.post("/v1/account/delete", headers=b["phone"]).status_code == 200
    with owner_engine().connect() as c:
        left = c.execute(
            text("SELECT count(*) FROM trailer_notes WHERE user_id = CAST(:u AS uuid)"),
            {"u": b["uid"]},
        ).scalar()
    assert left == 0


# ------------------------------------------------------------------ the migration and the spec


def _consts(path: str) -> dict:
    src = (ROOT / path).read_text()
    out = {}
    for node in ast.parse(src).body:
        if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name):
            try:
                out[node.targets[0].id] = ast.literal_eval(node.value)
            except ValueError:
                continue
    return out


def test_every_check_list_in_the_migration_is_the_specs_enum():
    consts = _consts("server/alembic/versions/0035_trailer_notes.py")
    for const, enum in [
        ("NOTE_STATUS", "note_status"),
        ("NOTE_REFUSAL", "note_refusal"),
        ("NOTE_SOURCE", "note_source"),
    ]:
        assert re.findall(r"'([^']+)'", consts[const]) == TRAILER_ENUM_VALUES[enum], const
    assert consts["NOTE_MAX"] == TRAILER_MAX_LENGTHS["note"]
    from builder.trailer_spec import CutEdit, NoteFinish

    assert consts["CHANGES_MAX"] == CutEdit.model_fields["changes"].metadata[0].max_length
    assert consts["CHANGES_MAX"] == NoteFinish.model_fields["changes"].metadata[0].max_length
    bounds = {type(m).__name__: m for m in NoteFinish.model_fields["to_version"].metadata}
    assert consts["VERSION_MAX"] == bounds["Le"].le
