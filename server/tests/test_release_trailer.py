"""A release's readers see the trailer it went out with (0040 `release_trailer`), and nothing else
of the kit: the door is the release's own reading rule, the film only while the owner's current kit
still carries that very version.
"""

from __future__ import annotations

from test_project_media import MP4, store  # noqa: F401 - fixture by name
from test_releases import (  # noqa: F401 - fixtures by name
    _follow,
    _owner,
    _published,
    _someone,
    _star,
    pushes,
)
from test_shipkit import _doc, _file, _pub, _send
from test_sync import app_env, client, created_users  # noqa: F401 - fixtures by name

_SHARED_FIXTURES = (app_env, client, created_users, store, pushes)


def _kit_with_trailer(client, p: dict, version: int) -> dict:
    pub = _pub()
    ids = {
        "video_vertical": _send(client, p, _file(pub, "video_vertical", MP4, "video/mp4"), MP4),
        "trailer_square": _send(
            client, p, _file(pub, "trailer_square", MP4, "video/mp4", width=1080, height=1080), MP4
        ),
    }
    trailer = {"version": version, "seconds": 20.0, "scenes": ["open", "screens", "end"]}
    r = client.put(
        f"/v1/projects/{p['key']}/kit", json=_doc(pub, trailer=trailer), headers=p["mac"]
    )
    assert r.status_code == 200, r.text
    return ids


def _trailer(client, who: dict, rid: str):
    r = client.get(f"/v1/releases/{rid}/trailer", headers=who["phone"])
    assert r.status_code == 200, r.text
    return r.json()["trailer"]


def test_a_readers_trailer_is_the_one_the_release_went_out_with(
    client, store, created_users, pushes
):
    owner = _owner(client, created_users)
    ids = _kit_with_trailer(client, owner, version=2)
    rel = _published(client, owner, visibility="public", has_trailer=True, trailer_version=2)
    reader = _someone(client, created_users)
    assert _star(client, reader, owner).status_code == 200
    t = _trailer(client, reader, rel["id"])
    assert (t["slot"], t["width"], t["height"]) == ("trailer_square", 1080, 1080)
    assert client.get(t["url"], headers=reader["phone"]).content == MP4
    # Every other kit file stays the owner's.
    video = client.get(f"/v1/kit-media/{ids['video_vertical']}", headers=reader["phone"])
    assert video.status_code == 404
    # The owner replaces the film: the release's version is not served under it any more.
    _kit_with_trailer(client, owner, version=3)
    assert _trailer(client, reader, rel["id"]) is None
    assert client.get(t["url"], headers=reader["phone"]).status_code == 404


def test_no_trailer_for_a_reader_the_release_is_not_for(client, store, created_users, pushes):
    owner = _owner(client, created_users)
    _kit_with_trailer(client, owner, version=2)
    rel = _published(client, owner, has_trailer=True, trailer_version=2)  # to followers only
    stranger = _someone(client, created_users)
    assert _trailer(client, stranger, rel["id"]) is None
    follower = _someone(client, created_users)
    assert _follow(client, follower, owner) == "accepted"
    assert _trailer(client, follower, rel["id"])["slot"] == "trailer_square"
    # A release that says it has no trailer serves none, whatever the kit holds.
    plain = _published(client, owner, has_trailer=False, trailer_version=None, title="Stop times")
    assert _trailer(client, follower, plain["id"]) is None
