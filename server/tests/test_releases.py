"""Stars and releases (0037) AS builder_app, through the real routes and below them.

Every one of these fails OPEN with no error if it fails at all: a stranger starring a private
project and so learning it exists, a star count that tells the owner who, a follower reading a
draft, a release carrying a private repository's name or key to its readers, the Mac publishing on
its own, a push sent twice. So, as the rest of this suite does (CLAUDE.md): every refusal beside
its positive control; the second, third and fourth accounts made here, never skipped for want of
one; the policies exercised as builder_app with the victim's ids resolved through the owner engine
first; and the migration's CHECK lists read with `ast` and held to builder/releases.py.
"""

from __future__ import annotations

import ast
import json
import pathlib
import re
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text
from test_capture_keys import _key_headers, _mint
from test_live_rls import _allowed, _as, _count, _refused
from test_project_media import _person
from test_social import _handle
from test_sync import (  # noqa: F401 - fixtures are picked up by name
    TEST_DB,
    _payload,
    _upload,
    app_env,
    client,
    created_users,
    owner_engine,
)

from builder import releases as rel

pytestmark = pytest.mark.skipif(not TEST_DB, reason="set BUILDER_TEST_DB to run")
_SHARED_FIXTURES = (app_env, client, created_users)

ROOT = pathlib.Path(__file__).resolve().parents[2]


# ----------------------------------------------------------------------------- the cast


def _someone(client, created_users, *, public_profile: bool = True) -> dict:
    """An account with a phone, a paired Mac, one PRIVATE project and a handle."""
    p = _person(client, created_users)
    p["handle"] = f"u{p['uid'][:8]}"
    _handle(p["uid"], p["handle"], public_profile)
    return p


def _name_it(client, p: dict, name: str, key: str | None = None) -> None:
    """An upload in public mode: the server now knows the repository's name."""
    k = key or p["key"]
    assert _upload(client, p["mac"], _payload(repo_hash=k, repo_name=name))["accepted"] == 1


def _mark(client, p: dict, visibility: str, key: str | None = None) -> None:
    r = client.post(
        "/v1/repos/visibility",
        json={"repo_hash": key or p["key"], "visibility": visibility},
        headers=p["phone"],
    )
    assert r.status_code == 200, r.text


def _owner(client, created_users, name: str = "acme/rocket", **kw) -> dict:
    """An account whose project is PUBLIC: named by a public mode upload and marked public."""
    p = _someone(client, created_users, **kw)
    p["name"] = name
    _name_it(client, p, name)
    _mark(client, p, "public")
    return p


def _second_project(client, p: dict) -> str:
    key = uuid.uuid4().hex * 2
    assert _upload(client, p["mac"], _payload(repo_hash=key))["accepted"] == 1
    return key


def _follow(client, follower: dict, owner: dict) -> str:
    r = client.post(f"/v1/follows/{owner['handle']}", headers=follower["phone"])
    assert r.status_code == 200, r.text
    return r.json()["state"]


def _star_url(owner: dict, key: str | None = None) -> str:
    return f"/v1/users/{owner['handle']}/projects/{key or owner['key']}/star"


def _star(client, who: dict, owner: dict, key: str | None = None):
    return client.post(_star_url(owner, key), headers=who["phone"])


def _drafts_on(client, p: dict, key: str | None = None) -> None:
    r = client.put(
        f"/v1/projects/{key or p['key']}/release-settings",
        json={"drafts_to_phone": True},
        headers=p["phone"],
    )
    assert r.status_code == 200, r.text


def _draft_body(**over) -> dict:
    return {
        "title": "Live buses on the map",
        "notes": "The map shows every bus as it moves.",
        "highlights": ["live positions", "stop times"],
        "commits": 12,
        "trigger": "commits",
        "has_trailer": True,
        "trailer_version": 3,
        **over,
    }


def _draft(client, p: dict, key: str | None = None, **over) -> dict:
    r = client.put(
        f"/v1/projects/{key or p['key']}/releases/draft",
        json=_draft_body(**over),
        headers=p["mac"],
    )
    assert r.status_code == 200, r.text
    return r.json()["release"]


def _publish(client, p: dict, rid: str, headers=None):
    return client.post(f"/v1/releases/{rid}:publish", headers=headers or p["phone"])


def _published(client, p: dict, key: str | None = None, visibility: str | None = None, **over):
    """A draft by the Mac, its visibility set by the phone, published by the phone."""
    _drafts_on(client, p, key)
    rid = _draft(client, p, key, **over)["id"]
    if visibility is not None:
        r = client.patch(f"/v1/releases/{rid}", json={"visibility": visibility}, headers=p["phone"])
        assert r.status_code == 200, r.text
    r = _publish(client, p, rid)
    assert r.status_code == 200, r.text
    return r.json()["release"]


def _reads(client, who: dict, rid: str) -> bool:
    r = client.get(f"/v1/releases/{rid}", headers=who["phone"])
    assert r.status_code in (200, 404), r.text
    return r.status_code == 200


def _feed_ids(client, who: dict, **params) -> list[str]:
    r = client.get("/v1/releases/following", params=params, headers=who["phone"])
    assert r.status_code == 200, r.text
    return [x["id"] for x in r.json()["releases"]]


@pytest.fixture
def pushes(monkeypatch):
    """Every release banner the routes hand to APNs, recorded instead of sent."""
    from builder.routes import push

    sent: list[tuple[str, str, str, str]] = []

    def record(user_id, title, body, release_id):
        sent.append((user_id, title, body, release_id))
        return 1

    monkeypatch.setattr(push, "send_release", record)
    return sent


# ----------------------------------------------------------------------------- stars


def test_a_star_follows_a_public_project(client, created_users):
    a = _owner(client, created_users)
    b = _someone(client, created_users)
    c = _someone(client, created_users)
    r = _star(client, b, a)
    assert r.status_code == 200, r.text
    assert r.json() == {"key": a["key"], "starred": True, "stars": 1}
    assert _star(client, b, a).json()["stars"] == 1, "idempotent"
    mine = client.get("/v1/me/stars", headers=b["phone"]).json()["projects"]
    assert mine == [
        {
            "owner_handle": a["handle"],
            "owner_display_name": None,
            "key": a["key"],
            "name": "acme/rocket",
            "stars": 1,
            "latest_release": None,
        }
    ]
    listed = client.get(f"/v1/users/{a['handle']}/projects", headers=b["phone"]).json()
    assert listed == {
        "projects": [
            {
                "key": a["key"],
                "name": "acme/rocket",
                "stars": 1,
                "starred": True,
                "latest_release": None,
            }
        ]
    }
    theirs = client.get(f"/v1/users/{a['handle']}/projects", headers=c["phone"]).json()
    assert theirs["projects"][0]["starred"] is False and theirs["projects"][0]["stars"] == 1
    gone = client.delete(_star_url(a), headers=b["phone"])
    assert gone.json() == {"key": a["key"], "starred": False, "stars": 0}
    assert client.delete(_star_url(a), headers=b["phone"]).status_code == 200, "idempotent"
    assert client.get("/v1/me/stars", headers=b["phone"]).json()["projects"] == []
    own = _star(client, a, a)
    assert (own.status_code, own.json()["detail"]) == (422, "own_project")


def test_a_star_is_a_persons_never_a_machines(client, created_users):
    a = _owner(client, created_users)
    b = _someone(client, created_users)
    assert client.post(_star_url(a), headers=b["mac"]).status_code == 403
    kh = _key_headers(_mint(client, b["phone"])["key"])
    assert client.post(_star_url(a), headers=kh).status_code == 401
    assert _star(client, b, a).status_code == 200, "the control: b's phone may"


def test_a_star_on_a_private_project_is_404(client, created_users):
    a = _someone(client, created_users)
    b = _someone(client, created_users)

    def refused(key=None):
        r = _star(client, b, a, key)
        return (r.status_code, r.json()["detail"])

    assert refused() == (404, "not_found"), "private: no name and no mark"
    # Somebody ELSE's public upload of the same repository names it for everyone who works in it:
    # that is not a's mark, and a's project stays unstarrable.
    c = _someone(client, created_users)
    _name_it(client, c, "acme/secret", key=a["key"])
    assert refused() == (404, "not_found")
    _name_it(client, a, "acme/secret")
    assert refused() == (404, "not_found"), "a name is not a mark: anonymous by default"
    unnamed = _second_project(client, a)
    _mark(client, a, "public", unnamed)
    assert refused(unnamed) == (404, "not_found"), "a mark with no name is not public either"
    assert refused(uuid.uuid4().hex * 2) == (404, "not_found"), "a key typed from nowhere"
    assert refused(a["key"][:12]) == (422, "bad_key")
    assert (
        client.post(
            f"/v1/users/nobody{uuid.uuid4().hex[:6]}/projects/{a['key']}/star", headers=b["phone"]
        ).json()["detail"]
        == "not_found"
    )
    assert client.get(f"/v1/users/{a['handle']}/projects", headers=b["phone"]).json() == {
        "projects": []
    }
    # The control: a marks it public, and b may star it.
    _mark(client, a, "public")
    assert _star(client, b, a).status_code == 200


def test_the_database_refuses_a_star_on_a_private_project(client, created_users):
    """Below the route: the INSERT policy asks `project_starrable` itself."""
    a = _owner(client, created_users)
    private = _second_project(client, a)
    b = _someone(client, created_users)
    sql = (
        "INSERT INTO project_stars (user_id, owner_id, project_key) "
        "VALUES (CAST(:u AS uuid), CAST(:o AS uuid), :k)"
    )
    _allowed(b["uid"], sql, u=b["uid"], o=a["uid"], k=a["key"])
    _refused(b["uid"], sql, u=b["uid"], o=a["uid"], k=private)
    # Nor a star in somebody else's name, nor on one's own project.
    _refused(b["uid"], sql, u=a["uid"], o=b["uid"], k=b["key"])
    _refused(a["uid"], sql, u=a["uid"], o=a["uid"], k=a["key"])


def test_a_private_profiles_projects_are_its_followers(client, created_users):
    a = _owner(client, created_users, public_profile=False)
    stranger = _someone(client, created_users)
    follower = _someone(client, created_users)
    assert _follow(client, follower, a) == "pending"
    assert client.get(f"/v1/users/{a['handle']}/projects", headers=stranger["phone"]).json() == {
        "projects": []
    }
    assert _star(client, stranger, a).status_code == 404
    assert _star(client, follower, a).status_code == 404, "pending is not accepted"
    r = client.post(f"/v1/follows/{follower['handle']}:accept", headers=a["phone"])
    assert r.status_code == 200, r.text
    assert _star(client, follower, a).status_code == 200
    projects = client.get(f"/v1/users/{a['handle']}/projects", headers=follower["phone"])
    assert [p["key"] for p in projects.json()["projects"]] == [a["key"]]
    own = client.get(f"/v1/users/{a['handle']}/projects", headers=a["phone"]).json()["projects"]
    assert own[0]["stars"] == 1 and own[0]["starred"] is False


def test_star_counts_do_not_reveal_who(client, created_users):
    a = _owner(client, created_users)
    b = _someone(client, created_users)
    c = _someone(client, created_users)
    d = _someone(client, created_users)
    assert _star(client, b, a).status_code == 200
    assert _star(client, c, a).status_code == 200
    # Through every route that says anything about the project: a number, never a who.
    for viewer in (a, b, d):
        for path in ("/v1/me/stars", f"/v1/users/{a['handle']}/projects"):
            body = client.get(path, headers=viewer["phone"]).text
            for other in (b, c):
                if other is viewer:
                    continue
                assert other["uid"] not in body and other["handle"] not in body, (path, viewer)
    own = client.get(f"/v1/users/{a['handle']}/projects", headers=a["phone"]).json()
    assert own["projects"][0]["stars"] == 2
    # And below the routes, as builder_app: the owner sees no star rows at all, a stargazer only
    # their own, a stranger none; the count is the same number for all of them.
    rows = "SELECT count(*) FROM project_stars WHERE owner_id = CAST(:o AS uuid)"
    assert _count(a["uid"], rows, o=a["uid"]) == 0
    assert _count(b["uid"], rows, o=a["uid"]) == 1
    assert _count(d["uid"], rows, o=a["uid"]) == 0
    assert _count(None, rows, o=a["uid"]) == 0
    count = "SELECT star_count(CAST(:o AS uuid), :k)"
    for viewer in (a, b, d):
        assert _count(viewer["uid"], count, o=a["uid"], k=a["key"]) == 2
    # A private project's count is nobody's business but its owner's: null, not zero.
    private = _second_project(client, a)
    assert _count(d["uid"], count, o=a["uid"], k=private) is None
    assert _count(a["uid"], count, o=a["uid"], k=private) == 0


# ----------------------------------------------------------------------------- drafts


def test_the_mac_drafts_only_when_the_owner_turned_it_on(client, created_users):
    a = _someone(client, created_users)
    url = f"/v1/projects/{a['key']}/releases/draft"
    off = client.put(url, json=_draft_body(), headers=a["mac"])
    assert (off.status_code, off.json()["detail"]) == (403, "drafts_off")
    settings = f"/v1/projects/{a['key']}/release-settings"
    assert client.put(settings, json={"drafts_to_phone": True}, headers=a["mac"]).status_code == (
        403
    ), "the Mac cannot open its own door"
    _drafts_on(client, a)
    first = client.put(url, json=_draft_body(), headers=a["mac"])
    assert first.status_code == 200, first.text
    d = first.json()
    assert d["replaced"] is False
    rel_ = d["release"]
    assert (rel_["status"], rel_["title"], rel_["visibility"], rel_["trigger"]) == (
        "draft",
        "Live buses on the map",
        "followers",
        "commits",
    )
    assert rel_["highlights"] == ["live positions", "stop times"] and rel_["commits"] == 12
    assert (rel_["has_trailer"], rel_["trailer_version"], rel_["published_at"]) == (True, 3, None)
    assert rel_["name"] is None and rel_["stars"] == 0 and rel_["project_key"] == a["key"]
    again = client.put(
        url, json=_draft_body(title="Stop times", trigger="shipped"), headers=a["mac"]
    )
    assert again.json()["replaced"] is True
    assert again.json()["release"]["id"] == rel_["id"], "the one live draft, replaced in place"
    drafts = client.get("/v1/me/releases?status=draft", headers=a["mac"]).json()["releases"]
    assert [(x["id"], x["title"], x["trigger"]) for x in drafts] == [
        (rel_["id"], "Stop times", "shipped")
    ]
    for body, code in [
        (_draft_body(title="   "), "empty_title"),
        (_draft_body(highlights=["one", "  "]), "empty_highlight"),
        (_draft_body(has_trailer=False, trailer_version=2), "trailer_version_needs_trailer"),
    ]:
        r = client.put(url, json=body, headers=a["mac"])
        assert (r.status_code, r.json()["detail"]) == (422, code)
    for body in (
        _draft_body(trigger="because"),
        _draft_body(highlights=["h"] * 6),
        _draft_body(title="t" * 81),
        _draft_body(notes="n" * 1201),
        _draft_body(highlights=["h" * 121]),
        _draft_body(commits=-1),
        _draft_body(visibility="public"),
        _draft_body(has_trailer="yes"),
    ):
        assert client.put(url, json=body, headers=a["mac"]).status_code == 422, body
    nowhere = client.put(
        f"/v1/projects/{uuid.uuid4().hex * 2}/releases/draft", json=_draft_body(), headers=a["mac"]
    )
    assert nowhere.status_code == 404


def test_publish_is_a_persons_and_tells_each_reader_once(client, created_users, pushes):
    a = _owner(client, created_users)
    stargazer = _someone(client, created_users)
    follower = _someone(client, created_users)
    stranger = _someone(client, created_users)
    both = _someone(client, created_users)
    assert _star(client, stargazer, a).status_code == 200
    assert _follow(client, follower, a) == "accepted"
    assert _star(client, both, a).status_code == 200 and _follow(client, both, a) == "accepted"
    _drafts_on(client, a)
    rid = _draft(client, a)["id"]
    assert _publish(client, a, rid, headers=a["mac"]).status_code == 403, "never the Mac"
    assert pushes == []
    r = _publish(client, a, rid)
    assert r.status_code == 200, r.text
    published = r.json()["release"]
    assert published["status"] == "published" and published["published_at"] is not None
    assert sorted(p[0] for p in pushes) == sorted(
        [stargazer["uid"], follower["uid"], both["uid"]]
    ), "each reader once, the one who both follows and starred once too"
    assert {(p[1], p[2], p[3]) for p in pushes} == {
        (f"@{a['handle']} released acme/rocket", "Live buses on the map", rid)
    }
    assert stranger["uid"] not in {p[0] for p in pushes}
    again = _publish(client, a, rid)
    assert (again.status_code, again.json()["detail"]) == (409, "not_draft")
    assert len(pushes) == 3, "never twice"
    # Below the route: the audience is answered once, and never again, to anyone.
    ask = "SELECT count(*) FROM claim_release_audience(CAST(:r AS uuid))"
    assert _count(a["uid"], ask, r=rid) == 0
    assert _count(follower["uid"], ask, r=rid) == 0


def test_a_private_projects_release_names_nothing_and_links_nothing(client, created_users, pushes):
    a = _someone(client, created_users)
    follower = _someone(client, created_users)
    assert _follow(client, follower, a) == "accepted"
    published = _published(client, a)
    assert [p[1] for p in pushes] == [f"@{a['handle']} posted a release"]
    got = client.get(f"/v1/releases/{published['id']}", headers=follower["phone"]).json()
    item = got["release"]
    assert (item["project_key"], item["name"], item["stars"]) == (None, None, None), (
        "a private project's key is the same HMAC for everyone in that repository"
    )
    assert a["key"] not in json.dumps(got)
    feed = client.get("/v1/releases/following", headers=follower["phone"]).json()["releases"]
    assert [x["id"] for x in feed] == [published["id"]] and feed[0]["project_key"] is None
    assert set(feed[0]) == {
        "id",
        "owner_handle",
        "owner_display_name",
        "project_key",
        "name",
        "title",
        "notes",
        "highlights",
        "commits",
        "has_trailer",
        "published_at",
        "stars",
    }
    public = client.patch(
        f"/v1/releases/{published['id']}", json={"visibility": "public"}, headers=a["phone"]
    )
    assert (public.status_code, public.json()["detail"]) == (422, "project_not_public")


# ----------------------------------------------------------------------------- who reads


def test_can_view_release(client, created_users):
    a = _owner(client, created_users)
    private = _second_project(client, a)
    follower = _someone(client, created_users)
    stargazer = _someone(client, created_users)
    stranger = _someone(client, created_users)
    assert _follow(client, follower, a) == "accepted"
    assert _star(client, stargazer, a).status_code == 200
    to_followers = _published(client, a)["id"]
    to_everyone = _published(client, a, visibility="public")["id"]
    of_private = _published(client, a, key=private)["id"]
    _drafts_on(client, a)
    draft = _draft(client, a)["id"]

    table = {
        # release: (follower, stargazer, stranger)
        to_followers: (True, True, False),
        to_everyone: (True, True, True),
        of_private: (True, False, False),
        draft: (False, False, False),
    }
    select = "SELECT count(*) FROM releases WHERE id = CAST(:r AS uuid)"
    for rid, expected in table.items():
        for who, may in zip((follower, stargazer, stranger), expected, strict=True):
            assert _reads(client, who, rid) is may, (rid, who["handle"])
            assert _count(who["uid"], select, r=rid) == int(may), "the policy, not the route"
        assert _reads(client, a, rid) and _count(a["uid"], select, r=rid) == 1, "its owner"
        assert _count(None, select, r=rid) == 0, "no viewer reads nothing"
    # Reading is not owning: a reader changes nothing, and is told so (social's 403 for a post
    # you can see and do not own).
    for method, path, body in [
        ("PATCH", f"/v1/releases/{to_followers}", {"title": "mine now"}),
        ("POST", f"/v1/releases/{to_followers}:publish", None),
        ("POST", f"/v1/releases/{to_followers}:dismiss", None),
    ]:
        r = client.request(method, path, json=body, headers=follower["phone"])
        assert (r.status_code, r.json()["detail"]) == (403, "not_yours"), (method, path)
    assert (
        client.get(f"/v1/releases/{to_followers}", headers=a["phone"]).json()["release"]["title"]
        == "Live buses on the map"
    )
    assert set(_feed_ids(client, follower)) == {to_followers, to_everyone, of_private}
    assert set(_feed_ids(client, stargazer)) == {to_followers, to_everyone}
    assert _feed_ids(client, stranger) == [], "the feed is what you starred and who you follow"

    # The project goes private: a star grants nothing, a public release reaches only followers.
    _mark(client, a, "anonymous")
    assert _reads(client, stargazer, to_followers) is False
    assert _reads(client, stranger, to_everyone) is False
    assert _reads(client, follower, to_everyone) is True
    item = client.get(f"/v1/releases/{to_everyone}", headers=follower["phone"]).json()["release"]
    assert (item["name"], item["project_key"]) == (None, None), "and its name is gone with it"


def test_a_new_draft_tells_its_owner_once_and_a_rewrite_says_nothing(
    client, created_users, monkeypatch
):
    from builder.routes import push

    sent: list[tuple[str, str, str, str]] = []

    def record(user_id, title, body, key):
        sent.append((user_id, title, body, key))
        return 1

    monkeypatch.setattr(push, "send_release_draft", record)
    a = _someone(client, created_users)
    _drafts_on(client, a)
    url = f"/v1/projects/{a['key']}/releases/draft"
    assert client.put(url, json=_draft_body(), headers=a["mac"]).status_code == 200
    assert len(sent) == 1
    uid, title, body, key = sent[0]
    assert (title, body, key) == ("A release draft is waiting", "Live buses on the map", a["key"])
    client.put(url, json=_draft_body(title="Stop times"), headers=a["mac"])
    assert len(sent) == 1, "the same draft rewritten is not news"
    data = rel.draft_push_data(a["key"])
    assert data == {
        "kind": "release_draft",
        "project_key": a["key"],
        "url": f"builder://releases/{a['key']}",
    }


def test_one_persons_drafts_and_settings_are_theirs(client, created_users):
    a = _someone(client, created_users)
    b = _someone(client, created_users)
    _drafts_on(client, a)
    rid = _draft(client, a)["id"]
    for method, path in [
        ("GET", f"/v1/releases/{rid}"),
        ("PATCH", f"/v1/releases/{rid}"),
        ("POST", f"/v1/releases/{rid}:publish"),
        ("POST", f"/v1/releases/{rid}:dismiss"),
        ("GET", f"/v1/projects/{a['key']}/release-settings"),
        ("PUT", f"/v1/projects/{a['key']}/release-settings"),
        ("PUT", f"/v1/projects/{a['key']}/releases/draft"),
    ]:
        body = {"title": "mine now"} if method == "PATCH" else None
        if path.endswith("release-settings") and method == "PUT":
            body = {"drafts_to_phone": False}
        if path.endswith("draft"):
            body = _draft_body()
        headers = b["mac"] if path.endswith("draft") else b["phone"]
        r = client.request(method, path, json=body, headers=headers)
        assert r.status_code == 404, (method, path, r.text)
    assert client.get("/v1/me/releases", headers=b["phone"]).json() == {"releases": []}
    assert client.get("/v1/me/release-settings", headers=b["mac"]).json() == {"settings": []}
    # The controls: a reads all of it.
    assert _reads(client, a, rid)
    assert len(client.get("/v1/me/release-settings", headers=a["mac"]).json()["settings"]) == 1

    # Below the routes, as builder_app.
    one = "SELECT count(*) FROM releases WHERE id = CAST(:r AS uuid)"
    assert _count(a["uid"], one, r=rid) == 1 and _count(b["uid"], one, r=rid) == 0
    setting = "SELECT count(*) FROM release_settings WHERE user_id = CAST(:u AS uuid)"
    assert _count(a["uid"], setting, u=a["uid"]) == 1 and _count(b["uid"], setting, u=a["uid"]) == 0
    insert = (
        "INSERT INTO releases (owner_id, project_key, title, trigger) "
        "VALUES (CAST(:o AS uuid), :k, 'a release', 'asked')"
    )
    _allowed(b["uid"], insert, o=b["uid"], k=b["key"])
    _refused(b["uid"], insert, o=a["uid"], k=a["key"])
    settings_row = (
        "INSERT INTO release_settings (user_id, project_key, drafts_to_phone) "
        "VALUES (CAST(:u AS uuid), :k, true)"
    )
    _allowed(b["uid"], settings_row, u=b["uid"], k=b["key"])
    _refused(b["uid"], settings_row, u=a["uid"], k=b["key"])
    edit = "UPDATE releases SET title = 'taken' WHERE id = CAST(:r AS uuid)"
    with owner_engine().begin() as c:
        mine = c.execute(
            text(insert + " RETURNING id"), {"o": b["uid"], "k": uuid.uuid4().hex * 2}
        ).scalar()
    with _as(b["uid"]) as c:
        tx = c.begin()
        assert c.execute(text(edit), {"r": str(mine)}).rowcount == 1, "the control"
        assert c.execute(text(edit), {"r": rid}).rowcount == 0
        tx.rollback()
    with _as(b["uid"]) as c:
        tx = c.begin()
        with pytest.raises(Exception) as exc:
            c.execute(
                text("UPDATE releases SET notified_at = now() WHERE id = CAST(:r AS uuid)"),
                {"r": str(mine)},
            )
        tx.rollback()
    assert "permission denied" in str(exc.value), "only the audience function marks a push"


# ----------------------------------------------------------------------------- words


def test_a_release_never_names_a_private_repository(client, created_users):
    a = _someone(client, created_users)
    _name_it(client, a, "acme/rocket-app")  # the server knows the name; a has not marked it public
    _drafts_on(client, a)
    for over in (
        {"title": "Rocket-App 2 is out"},
        {"notes": "Everything new in acme/rocket-app this week."},
        {"highlights": ["faster", "the ROCKET-APP icon"]},
    ):
        rid = _draft(client, a, **over)["id"]
        r = _publish(client, a, rid)
        assert (r.status_code, r.json()["detail"]) == (422, "names_a_repository"), over
    fixed = client.patch(
        f"/v1/releases/{rid}", json={"highlights": ["faster", "a new icon"]}, headers=a["phone"]
    )
    assert fixed.status_code == 200, fixed.text
    ok = _publish(client, a, rid)
    assert ok.status_code == 200, ok.text
    later = client.patch(
        f"/v1/releases/{rid}", json={"notes": "More rocket-app soon."}, headers=a["phone"]
    )
    assert (later.status_code, later.json()["detail"]) == (422, "names_a_repository")
    assert (
        client.patch(
            f"/v1/releases/{rid}", json={"notes": "More rocket-apps soon."}, headers=a["phone"]
        ).status_code
        == 200
    )
    # Marked public, the name is the project's to say.
    _mark(client, a, "public")
    said = client.patch(
        f"/v1/releases/{rid}", json={"notes": "More rocket-app soon."}, headers=a["phone"]
    )
    assert said.status_code == 200 and said.json()["release"]["name"] == "acme/rocket-app"


def test_edit_and_dismiss(client, created_users):
    a = _someone(client, created_users)
    _drafts_on(client, a)
    rid = _draft(client, a)["id"]
    url = f"/v1/releases/{rid}"
    empty = client.patch(url, json={}, headers=a["phone"])
    assert (empty.status_code, empty.json()["detail"]) == (422, "nothing_to_change")
    r = client.patch(
        url,
        json={"title": " Buses ", "notes": "", "highlights": ["one"], "visibility": "followers"},
        headers=a["phone"],
    )
    assert r.status_code == 200, r.text
    got = r.json()["release"]
    assert (got["title"], got["notes"], got["highlights"]) == ("Buses", "", ["one"])
    assert client.patch(url, json={"title": "x"}, headers=a["mac"]).status_code == 403
    assert client.post(f"{url}:dismiss", headers=a["mac"]).status_code == 403
    d = client.post(f"{url}:dismiss", headers=a["phone"])
    assert d.status_code == 200 and d.json()["release"]["status"] == "dismissed"
    for path in (f"{url}:dismiss", f"{url}:publish"):
        r = client.post(path, headers=a["phone"])
        assert (r.status_code, r.json()["detail"]) == (409, "not_draft")
    r = client.patch(url, json={"title": "again"}, headers=a["phone"])
    assert (r.status_code, r.json()["detail"]) == (409, "not_editable")
    fresh = _draft(client, a)
    assert fresh["id"] != rid and fresh["status"] == "draft", "the Mac may draft again"
    assert [
        x["id"] for x in client.get("/v1/me/releases", headers=a["phone"]).json()["releases"]
    ] == [fresh["id"]], "dismissed ones only when asked for"
    asked = client.get("/v1/me/releases?status=dismissed", headers=a["phone"]).json()
    assert [x["id"] for x in asked["releases"]] == [rid]
    assert client.get("/v1/me/releases?status=nope", headers=a["phone"]).status_code == 422


def test_the_following_feed_pages_by_keyset(client, created_users):
    a = _owner(client, created_users)
    reader = _someone(client, created_users)
    assert _star(client, reader, a).status_code == 200
    ids = [_published(client, a, title=f"release {i}")["id"] for i in range(3)]
    base = datetime(2026, 9, 1, tzinfo=UTC)
    with owner_engine().begin() as c:
        for i, rid in enumerate(ids):
            c.execute(
                text("UPDATE releases SET published_at = :t WHERE id = CAST(:r AS uuid)"),
                {"t": base + timedelta(hours=i), "r": rid},
            )
    page = client.get("/v1/releases/following?limit=2", headers=reader["phone"]).json()
    assert [x["id"] for x in page["releases"]] == [ids[2], ids[1]], "newest first"
    assert page["next_before_id"] == ids[1]
    rest = _feed_ids(
        client, reader, limit=2, before=page["next_before"], before_id=page["next_before_id"]
    )
    assert rest == [ids[0]]
    assert page["releases"][0]["name"] == "acme/rocket" and page["releases"][0]["stars"] == 1
    bad = client.get("/v1/releases/following?before=yesterday", headers=reader["phone"])
    assert (bad.status_code, bad.json()["detail"]) == (422, "bad_cursor")
    latest = client.get("/v1/me/stars", headers=reader["phone"]).json()["projects"][0]
    assert latest["latest_release"]["id"] == ids[2]


# ----------------------------------------------------------------------------- settings


def test_release_settings(client, created_users):
    a = _someone(client, created_users)
    url = f"/v1/projects/{a['key']}/release-settings"
    got = client.get(url, headers=a["mac"]).json()["settings"]
    assert got == {"project_key": a["key"], **rel.DEFAULT_SETTINGS, "updated_at": None}
    assert client.get("/v1/me/release-settings", headers=a["mac"]).json() == {"settings": []}
    r = client.put(url, json={"every_commits": 25, "cadence": "weekly"}, headers=a["phone"])
    assert r.status_code == 200, r.text
    s = r.json()["settings"]
    assert (s["every_commits"], s["cadence"], s["on_shipped"], s["drafts_to_phone"]) == (
        25,
        "weekly",
        True,
        False,
    )
    s = client.put(url, json={"on_shipped": False}, headers=a["phone"]).json()["settings"]
    assert (s["every_commits"], s["cadence"], s["on_shipped"]) == (25, "weekly", False), "kept"
    assert client.get("/v1/me/release-settings", headers=a["mac"]).json()["settings"] == [s]
    for body in (
        {"every_commits": 2},
        {"every_commits": 201},
        {"cadence": "daily"},
        {"drafts_to_phone": "yes"},
        {"every_commits": 10, "why": "because"},
    ):
        assert client.put(url, json=body, headers=a["phone"]).status_code == 422, body
    nothing = client.put(url, json={}, headers=a["phone"])
    assert (nothing.status_code, nothing.json()["detail"]) == (422, "nothing_to_change")


# ----------------------------------------------------------------------------- the sweeps


def test_excluding_the_repository_takes_its_releases_settings_and_stars(client, created_users):
    a = _owner(client, created_users)
    b = _someone(client, created_users)
    assert _star(client, b, a).status_code == 200
    kept = _owner(client, created_users, name="acme/kept")
    assert _star(client, a, kept).status_code == 200, "a's own star elsewhere"
    published = _published(client, a)["id"]
    _drafts_on(client, a)
    _draft(client, a)
    _mark(client, a, "excluded")

    def owned(sql: str, **params) -> int:
        with owner_engine().connect() as c:
            return c.execute(text(sql), params).scalar()

    assert owned("SELECT count(*) FROM releases WHERE owner_id = CAST(:u AS uuid)", u=a["uid"]) == 0
    assert (
        owned("SELECT count(*) FROM release_settings WHERE user_id = CAST(:u AS uuid)", u=a["uid"])
        == 0
    )
    assert owned("SELECT count(*) FROM project_stars WHERE project_key = :k", k=a["key"]) == 0, (
        "b's star on it too, which a could never see"
    )
    assert (
        owned("SELECT count(*) FROM project_stars WHERE user_id = CAST(:u AS uuid)", u=a["uid"])
        == 1
    ), "a's star on another repository stays"
    assert client.get("/v1/me/stars", headers=b["phone"]).json() == {"projects": []}
    assert not _reads(client, b, published)


def test_deleting_an_account_takes_its_stars_releases_and_settings(client, created_users):
    a = _owner(client, created_users)
    b = _owner(client, created_users, name="acme/other")
    assert _star(client, b, a).status_code == 200
    assert _star(client, a, b).status_code == 200
    _published(client, a)
    assert client.post("/v1/account/delete", headers=a["phone"]).status_code == 200
    with owner_engine().connect() as c:
        for sql in (
            "SELECT count(*) FROM project_stars WHERE user_id = CAST(:u AS uuid) "
            "OR owner_id = CAST(:u AS uuid)",
            "SELECT count(*) FROM releases WHERE owner_id = CAST(:u AS uuid)",
            "SELECT count(*) FROM release_settings WHERE user_id = CAST(:u AS uuid)",
        ):
            assert c.execute(text(sql), {"u": a["uid"]}).scalar() == 0, sql
    assert client.get("/v1/me/stars", headers=b["phone"]).json() == {"projects": []}


# ----------------------------------------------------------------------------- the migration


def test_every_check_list_in_the_migration_is_the_modules():
    src = (ROOT / "server/alembic/versions/0037_stars_releases.py").read_text()
    consts = {}
    for node in ast.parse(src).body:
        if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name):
            try:
                consts[node.targets[0].id] = ast.literal_eval(node.value)
            except ValueError:
                continue
    later = {}
    for node in ast.parse(
        (ROOT / "server/alembic/versions/0038_release_triggers.py").read_text()
    ).body:
        if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name):
            try:
                later[node.targets[0].id] = ast.literal_eval(node.value)
            except ValueError:
                continue
    # 0038 grew the trigger list at its end; its downgrade restores exactly 0037's.
    assert tuple(re.findall(r"'([^']+)'", later["RELEASE_TRIGGER"])) == rel.TRIGGERS
    assert later["OLD_RELEASE_TRIGGER"] == consts["RELEASE_TRIGGER"]
    assert rel.TRIGGERS[: len(re.findall("'", consts["RELEASE_TRIGGER"])) // 2] == tuple(
        re.findall(r"'([^']+)'", consts["RELEASE_TRIGGER"])
    )
    for const, values in [
        ("RELEASE_STATUS", rel.STATUSES),
        ("RELEASE_VISIBILITY", rel.VISIBILITIES),
        ("RELEASE_CADENCE", rel.CADENCES),
    ]:
        assert tuple(re.findall(r"'([^']+)'", consts[const])) == values, const
    assert (consts["TITLE_MAX"], consts["NOTES_MAX"]) == (rel.TITLE_MAX, rel.NOTES_MAX)
    assert (consts["HIGHLIGHTS_MAX"], consts["HIGHLIGHT_MAX"]) == (
        rel.HIGHLIGHTS_MAX,
        rel.HIGHLIGHT_MAX,
    )
    assert (consts["EVERY_COMMITS_MIN"], consts["EVERY_COMMITS_MAX"]) == rel.EVERY_COMMITS
    assert rel.DEFAULT_SETTINGS["cadence"] in rel.CADENCES
    trailer = json.loads((ROOT / "spec/trailer.v1.json").read_text())
    version = next(f for f in trailer["objects"]["Cut"] if f["name"] == "version")
    assert version["doc"].startswith(f"1-{consts['TRAILER_VERSION_MAX']} ")


def test_the_highlights_check_holds_in_the_database(client, created_users):
    a = _someone(client, created_users)
    insert = (
        "INSERT INTO releases (owner_id, project_key, title, trigger, highlights) "
        "VALUES (CAST(:o AS uuid), :k, 'a release', 'asked', CAST(:h AS jsonb))"
    )
    from sqlalchemy.exc import IntegrityError

    with owner_engine().begin() as c:
        c.execute(text(insert), {"o": a["uid"], "k": a["key"], "h": json.dumps(["ok"] * 5)})
    for bad in (["ok"] * 6, [""], ["x" * 121], [1], {"a": "b"}, "just a string"):
        with pytest.raises(IntegrityError), owner_engine().begin() as c:
            c.execute(
                text(insert), {"o": a["uid"], "k": uuid.uuid4().hex * 2, "h": json.dumps(bad)}
            )
