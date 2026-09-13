"""The report's projects block over the wire (report v3, docs/projects.md), AS builder_app.

The server computes none of it. It is responsible for four things, and each has a case:
that the door takes the block the machine builds and refuses a repository NAME where a
key goes (a key is 64 lowercase hex and no name has that shape); that a public
repository's name is served beside its key from the `repos` row every session reads its
name from, and a private one's never; that a repository the account excluded is not
stored, not served and not kept (the store, the read and the exclusion sweep); and that
one person's projects are invisible to everybody else, through `GET /v1/projects/{key}`
as through the profile.

The isolation test seeds the victim as the OWNER and reads the rows back first, so it
fails for the right reason (CLAUDE.md, the negative test lesson).
"""

import copy
import sys
import uuid
from pathlib import Path

import pytest
from sqlalchemy import text
from test_report_route import assert_stored
from test_sync import (  # noqa: F401 - fixtures are picked up by name
    TEST_DB,
    _pair,
    _payload,
    _upload,
    app_env,
    client,
    created_users,
    owner_engine,
    paired,
)

pytestmark = pytest.mark.skipif(not TEST_DB, reason="set BUILDER_TEST_DB to run")

_SHARED_FIXTURES = (app_env, client, created_users, paired)


def _engine():
    repo = Path(__file__).resolve().parents[2]
    if str(repo) not in sys.path:
        sys.path.insert(0, str(repo))


def machine_report() -> dict:
    """A version 3 report built by `analysis.report.from_corpus`, the one builder `capture
    report` uploads, over the engine's own two project fixture corpus
    (`analysis/tests/projects_fixture.two_projects`): every field of the projects block filled
    by the code, never typed here."""
    _engine()
    from analysis import report as rp
    from analysis.tests import projects_fixture as tp

    built, _ = rp.from_corpus(tp.two_projects(), 30)
    assert built["report_version"] == 3
    assert len(built["projects"]["projects"]) == 2
    return built


def keys(doc: dict) -> list[str]:
    return [p["key"] for p in doc["projects"]["projects"]]


def put(client, headers, doc):
    return client.put("/v1/profile/report", json=doc, headers=headers)


def stored_body(uid: str) -> dict:
    with owner_engine().connect() as c:
        return c.execute(
            text("SELECT body FROM builder_report WHERE user_id = :u"), {"u": uid}
        ).scalar()


def test_a_v3_report_with_projects_round_trips(client, paired):
    _, headers = paired
    built = machine_report()
    r = put(client, headers, built)
    assert r.status_code == 200, r.text
    assert r.json()["report_version"] == 3
    body = client.get("/v1/profile/builder", headers=headers).json()
    assert_stored(built, body["report"])
    got = body["report"]["projects"]
    assert got["projects"][0]["window"]["cards"][0]["id"] == "builder_type"
    assert got["projects"][0]["history"]["momentum"]["days"] == 7
    # No session of this account is in either repository, so no name travels beside them.
    assert body["project_names"] == {}


def test_a_name_where_a_key_goes_is_refused_at_the_door(client, paired):
    _, headers = paired
    for bad in ("zebraride", "A" * 64, "g" * 64):
        doc = machine_report()
        doc["projects"]["projects"][0]["key"] = bad
        assert put(client, headers, doc).status_code == 422, bad


def test_a_word_anywhere_in_the_projects_block_is_refused(client, paired):
    _, headers = paired
    doc = machine_report()
    doc["projects"]["projects"][0]["name"] = "zebraride"
    assert put(client, headers, doc).status_code == 422
    doc = machine_report()
    doc["projects"]["projects"][0]["history"]["stage"] = "abandoned"
    assert put(client, headers, doc).status_code == 422
    doc = machine_report()
    doc["projects"]["comparisons"][0]["reason"] = "the two are close"
    assert put(client, headers, doc).status_code == 422


def test_a_v2_report_without_projects_still_round_trips(client, paired):
    """An older capture sends version 2 with no projects block; the null says only that
    that machine does not compute it."""
    _, headers = paired
    doc = machine_report()
    doc.pop("projects")
    doc["report_version"] = 2
    assert put(client, headers, doc).status_code == 200
    got = client.get("/v1/profile/builder", headers=headers).json()
    assert got["report"]["projects"] is None
    assert got["project_names"] == {}


def test_public_names_come_from_the_viewers_own_sessions_and_private_ones_never(
    client, created_users
):
    """A name reaches the viewer exactly as a session's `repo_name` does: from `repos`, set
    only by an upload in public mode, and only for a repository the viewer has a session
    in. A key typed into a report cannot fetch the name of somebody else's public repo."""
    uid, headers = _pair(client, created_users)
    _, other = _pair(client, created_users)
    doc = machine_report()
    public, private = keys(doc)
    theirs = uuid.uuid4().hex * 2
    # Put a third key, public but only in someone else's sessions, where the second was.
    doc = _rekey(doc, private, theirs)
    _upload(client, headers, _payload(repo_hash=public, repo_name="zebraride"))
    _upload(client, headers, _payload(repo_hash=private))
    _upload(client, other, _payload(repo_hash=theirs, repo_name="acme-public"))
    assert put(client, headers, doc).status_code == 200
    names = client.get("/v1/profile/builder", headers=headers).json()["project_names"]
    assert names == {public: "zebraride"}


def _rekey(doc: dict, old: str, new: str) -> dict:
    doc = copy.deepcopy(doc)
    for p in doc["projects"]["projects"]:
        if p["key"] == old:
            p["key"] = new
    for c in doc["projects"]["comparisons"]:
        for k in ("high", "low"):
            if c[k] == old:
                c[k] = new
    return doc


def test_an_excluded_repository_is_not_served_not_kept_and_not_stored(client, paired):
    """Excluding a repository on the phone, which the machine that sent the report may
    never hear about: the sweep rewrites the stored report, the read filters it again, and
    the next upload of the same report stores it without the project."""
    uid, headers = paired
    doc = machine_report()
    keep, drop = keys(doc)
    _upload(client, headers, _payload(repo_hash=keep), _payload(repo_hash=drop))
    assert put(client, headers, doc).status_code == 200
    assert keys(stored_body(uid)) == [keep, drop]

    r = client.post(
        "/v1/repos/visibility", json={"repo_hash": drop, "visibility": "excluded"}, headers=headers
    )
    assert r.status_code == 200, r.text
    body = stored_body(uid)
    assert keys(body) == [keep], "the sweep left the project behind a filter"
    block = body["projects"]
    assert block["projects_total"] == doc["projects"]["projects_total"] - 1
    assert [p["rank"] for p in block["projects"]] == [1]
    assert all(drop not in (c["high"], c["low"]) for c in block["comparisons"])
    assert drop not in str(client.get("/v1/profile/builder", headers=headers).json())

    assert put(client, headers, doc).status_code == 200
    assert keys(stored_body(uid)) == [keep], "stored again from a machine that did not know"


def test_the_project_slice_is_one_request_for_a_project_page(client, paired):
    uid, headers = paired
    doc = machine_report()
    ride, builder = keys(doc)
    _upload(
        client,
        headers,
        _payload(repo_hash=ride, repo_name="zebraride"),
        _payload(repo_hash=ride, repo_name="zebraride"),
        _payload(repo_hash=builder),
        _payload(repo_hash=uuid.uuid4().hex * 2),
    )
    assert put(client, headers, doc).status_code == 200

    r = client.get(f"/v1/projects/{ride[:12]}", headers=headers)
    assert r.status_code == 200, r.text
    got = r.json()
    assert (got["key"], got["name"], got["window_days"]) == (ride, "zebraride", 30)
    # As stored: the dump fills every nullable key a card's extras left unset, with null.
    assert_stored(doc["projects"]["projects"][0], got["project"])
    assert len(got["sessions"]) == 2 and all(s["repo_name"] == "zebraride" for s in got["sessions"])
    assert got["comparisons"] and all(ride in (c["high"], c["low"]) for c in got["comparisons"])
    assert got["project_names"] == {ride: "zebraride"}

    got = client.get(f"/v1/projects/{builder}", headers=headers).json()
    assert (got["name"], len(got["sessions"])) == (None, 1)


def test_a_project_the_report_does_not_hold_still_lists_its_sessions(client, paired):
    _, headers = paired
    only_sessions = uuid.uuid4().hex * 2
    _upload(client, headers, _payload(repo_hash=only_sessions))
    got = client.get(f"/v1/projects/{only_sessions}", headers=headers).json()
    assert (got["project"], got["generated_at"], len(got["sessions"])) == (None, None, 1)


def test_a_key_that_is_not_one_is_refused_and_a_short_prefix_that_names_two_is_a_conflict(
    client, paired
):
    _, headers = paired
    assert client.get("/v1/projects/ZEBRA", headers=headers).status_code == 422
    assert client.get("/v1/projects/abc", headers=headers).status_code == 422
    assert client.get(f"/v1/projects/{'f' * 12}", headers=headers).status_code == 404
    prefix = uuid.uuid4().hex[:12]
    _upload(
        client,
        headers,
        _payload(repo_hash=prefix + "0" * 52),
        _payload(repo_hash=prefix + "1" * 52),
    )
    assert client.get(f"/v1/projects/{prefix}", headers=headers).status_code == 409
    assert client.get(f"/v1/projects/{prefix}{'0' * 52}", headers=headers).status_code == 200


def test_an_excluded_repository_has_no_project_page(client, paired):
    _, headers = paired
    rhash = uuid.uuid4().hex * 2
    _upload(client, headers, _payload(repo_hash=rhash))
    assert client.get(f"/v1/projects/{rhash}", headers=headers).status_code == 200
    client.post(
        "/v1/repos/visibility", json={"repo_hash": rhash, "visibility": "excluded"}, headers=headers
    )
    assert client.get(f"/v1/projects/{rhash}", headers=headers).status_code == 404


def test_one_persons_project_is_invisible_to_another(client, created_users):
    victim_id, victim = _pair(client, created_users)
    _, attacker = _pair(client, created_users)
    doc = machine_report()
    ride = keys(doc)[0]
    _upload(client, victim, _payload(repo_hash=ride, repo_name="zebraride"))
    assert put(client, victim, doc).status_code == 200
    # The victim's rows are provably there, read as the owner, before the attacker looks.
    assert keys(stored_body(victim_id))[0] == ride
    with owner_engine().connect() as c:
        assert (
            c.execute(
                text(
                    "SELECT count(*) FROM sessions s JOIN repos r ON r.id = s.repo_id "
                    "WHERE s.user_id = :u AND r.repo_hash = :h"
                ),
                {"u": victim_id, "h": ride},
            ).scalar()
            == 1
        )
    assert client.get(f"/v1/projects/{ride}", headers=attacker).status_code == 404
    assert client.get(f"/v1/projects/{ride[:12]}", headers=attacker).status_code == 404
    mine = client.get("/v1/profile/builder", headers=attacker).json()
    assert mine["report"] is None and mine["project_names"] == {}
