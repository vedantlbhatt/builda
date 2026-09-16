"""Drops, through the real routes AS builder_app, with row level security on.

docs/drops.md. The rules this file exists to hold, in the order they matter:

  1. A MOVE IS INERT UNTIL A PERSON TAPS IT. There is no route, parameter or setting that can
     queue one, and the only route that can is `:start`, by id, on a move that is still
     `offered`. This is the rule the whole feature's safety rests on: a caption is a stranger's
     text, it reaches a planner, and the planner's output is a button.
  2. THE SAME REEL TWICE IS ONE CARD, and the second share does not re plan the first.
  3. A SECOND RESOLUTION CANNOT UNDO WHAT A PERSON DECIDED. Re resolving replaces the offered
     moves and leaves a declined or running one exactly where it was.
  4. THE CAPTION IS NEVER STORED. What lands is what the planner WROTE; `shared_text` is kept
     only until the resolution has used it and is NULL after.
  5. ONE PERSON'S BOARD IS THEIRS. Every route, under RLS, through another account's token.
  6. THE MIGRATION'S CHECK LISTS ARE THE SPEC'S ENUMS, both ways, so a value added to
     spec/drops.v1.json without a migration fails here rather than as a 500 on the first share.
"""

import ast
import pathlib
import re

import pytest
from sqlalchemy import text
from test_sync import (  # noqa: F401 - fixtures are picked up by name
    TEST_DB,
    _pair,
    _phone_for,
    app_env,
    client,
    created_users,
    owner_engine,
    paired,
)

from builder.drops_spec import ANALYSIS_ENUM_VALUES, DROPS_VERSION

pytestmark = pytest.mark.skipif(not TEST_DB, reason="set BUILDER_TEST_DB to run")
_SHARED_FIXTURES = (app_env, client, created_users, paired)

REEL = "https://www.tiktok.com/@nocode.joshua/video/7620790035939462407"
CAPTION = (
    "5 Claude Skills that every beginner needs to install. Before you start working in Claude "
    "here are 5 beginner Claude skills that will get you ahead of 90% of people."
)


def _source(**over):
    return {
        "platform": "tiktok",
        "url": REEL,
        "author": "nocode.joshua",
        "title": "5 Claude Skills that every beginner needs to install.",
        "thumbnail_url": "https://example.com/thumb.jpg",
        "duration_s": 42,
        "caption_chars": len(CAPTION),
        "transcript_chars": 0,
        "resolver": "oembed",
        "resolved_at": "2026-09-16T04:00:00Z",
        **over,
    }


def _move(**over):
    return {
        "move_kind": "install",
        "title": "Go find the 5 skills",
        "intent": "Track down which 5 beginner Claude skills the creator means and install them.",
        "evidence": "5 beginner Claude skills that will get you ahead of 90% of people",
        "target": "this_machine",
        "effort": "minutes",
        "source": None,
        "verification": None,
        **over,
    }


def _resolution(moves=None, **over):
    return {
        "drops_version": DROPS_VERSION,
        "source": _source(),
        "plan": {
            "kind": "skill",
            "title": "5 beginner Claude Skills to install",
            "summary": "A creator points at 5 unnamed beginner Claude skills to install.",
            "confidence": 25,
            "refusal": None,
            "moves": moves if moves is not None else [_move()],
            "recipe": None,
            "tags": ["claude", "skills", "beginner"],
        },
        "refusal": None,
        "planner_model": "claude-sonnet-5",
        "planned_at": "2026-09-16T04:00:10Z",
        **over,
    }


def _share(client, headers, url=REEL, text_=None):
    return client.post(
        "/v1/drops",
        json={"url": url, "platform": "tiktok", "shared_text": text_},
        headers=headers,
    )


def _rows(sql, **params):
    with owner_engine().connect() as c:
        return c.execute(text(sql), params).all()


# ------------------------------------------------------------------- the share door
def test_the_same_reel_twice_is_one_card(client, paired):
    _uid, headers = paired
    a = _share(client, headers)
    assert a.status_code == 201 and a.json()["created"] is True
    b = _share(client, headers, url=REEL)
    assert b.json()["created"] is False
    assert b.json()["drop"]["id"] == a.json()["drop"]["id"]
    assert len(client.get("/v1/drops", headers=headers).json()["drops"]) == 1


def test_a_second_share_does_not_re_plan_the_first(client, paired):
    _uid, headers = paired
    drop = _share(client, headers).json()["drop"]
    client.put(f"/v1/drops/{drop['id']}/resolution", json=_resolution(), headers=headers)
    again = _share(client, headers)
    assert again.json()["drop"]["status"] == "planned"
    assert again.json()["drop"]["kind"] == "skill"


def test_a_link_that_is_not_https_is_refused_at_the_door(client, paired):
    _uid, headers = paired
    for bad in ("http://example.com/x", "javascript:alert(1)", "notalink", "https://nodot/x"):
        r = client.post(
            "/v1/drops", json={"url": bad, "platform": "web", "shared_text": None}, headers=headers
        )
        assert r.status_code == 422, bad


def test_a_platform_the_spec_does_not_know_is_refused(client, paired):
    _uid, headers = paired
    r = client.post(
        "/v1/drops",
        json={"url": "https://example.com/x", "platform": "myspace", "shared_text": None},
        headers=headers,
    )
    assert r.status_code == 422


# ------------------------------------------------------------------- the resolution
def test_the_caption_is_never_stored_and_shared_text_is_cleared(client, paired):
    _uid, headers = paired
    drop = _share(client, headers, text_=CAPTION).json()["drop"]
    before = _rows("SELECT shared_text FROM drops WHERE id = :i", i=drop["id"])
    assert before[0].shared_text == CAPTION
    client.put(f"/v1/drops/{drop['id']}/resolution", json=_resolution(), headers=headers)
    after = _rows(
        "SELECT shared_text, resolution::text AS r FROM drops WHERE id = :i", i=drop["id"]
    )
    assert after[0].shared_text is None
    # And the caption is not anywhere in what was stored: the wire carries its LENGTH.
    assert CAPTION not in after[0].r
    assert '"caption_chars"' in after[0].r


def test_a_resolution_makes_one_row_per_move_and_they_start_offered(client, paired):
    _uid, headers = paired
    drop = _share(client, headers).json()["drop"]
    out = client.put(
        f"/v1/drops/{drop['id']}/resolution",
        json=_resolution(moves=[_move(), _move(title="Read the docs", move_kind="evaluate")]),
        headers=headers,
    )
    assert out.json() == {"status": "planned", "moves": 2}
    moves = client.get(f"/v1/drops/{drop['id']}", headers=headers).json()["moves"]
    assert [m["status"] for m in moves] == ["offered", "offered"]
    assert [m["position"] for m in moves] == [0, 1]
    assert all(m["queued_at"] is None and m["started_at"] is None for m in moves)


def test_a_resolution_with_neither_a_plan_nor_a_refusal_is_refused(client, paired):
    _uid, headers = paired
    drop = _share(client, headers).json()["drop"]
    r = client.put(
        f"/v1/drops/{drop['id']}/resolution",
        json=_resolution(plan=None, refusal=None),
        headers=headers,
    )
    assert r.status_code == 422


def test_a_resolution_with_both_is_refused(client, paired):
    _uid, headers = paired
    drop = _share(client, headers).json()["drop"]
    r = client.put(
        f"/v1/drops/{drop['id']}/resolution", json=_resolution(refusal="no_text"), headers=headers
    )
    assert r.status_code == 422


def test_an_undeclared_field_cannot_be_stored(client, paired):
    _uid, headers = paired
    drop = _share(client, headers).json()["drop"]
    body = _resolution()
    body["plan"]["moves"][0]["shell_command"] = "rm -rf /"
    r = client.put(f"/v1/drops/{drop['id']}/resolution", json=body, headers=headers)
    assert r.status_code == 422


def test_a_refusal_needs_no_source_block(client, paired):
    _uid, headers = paired
    drop = _share(client, headers).json()["drop"]
    r = client.put(
        f"/v1/drops/{drop['id']}/refusal", json={"refusal": "private_or_gone"}, headers=headers
    )
    assert r.status_code == 200
    got = client.get(f"/v1/drops/{drop['id']}", headers=headers).json()["drop"]
    assert (got["status"], got["refusal"]) == ("refused", "private_or_gone")


def test_a_refusal_code_the_spec_does_not_know_is_refused(client, paired):
    _uid, headers = paired
    drop = _share(client, headers).json()["drop"]
    r = client.put(
        f"/v1/drops/{drop['id']}/refusal", json={"refusal": "i_gave_up"}, headers=headers
    )
    assert r.status_code == 422


# ------------------------------------------------------------------------ the tap
def test_a_move_only_leaves_offered_through_the_tap(client, paired):
    _uid, headers = paired
    drop = _share(client, headers).json()["drop"]
    client.put(f"/v1/drops/{drop['id']}/resolution", json=_resolution(), headers=headers)
    move = client.get(f"/v1/drops/{drop['id']}", headers=headers).json()["moves"][0]

    # Nothing else moves it: not claiming drops, not reading the board, not re resolving.
    client.post("/v1/drops:claim", headers=headers)
    client.get("/v1/drops", headers=headers)
    client.put(f"/v1/drops/{drop['id']}/resolution", json=_resolution(), headers=headers)
    assert _rows("SELECT status FROM drop_moves")[0].status == "offered"

    # Re resolving REPLACES an offered move, so its id is new. That is the point of the check
    # above and it is also why this reads the move again rather than reusing the first id: an
    # offered move is the planner's latest word, not a row a client can hold on to.
    move = client.get(f"/v1/drops/{drop['id']}", headers=headers).json()["moves"][0]
    started = client.post(
        f"/v1/drops/{drop['id']}/moves/{move['id']}:start", json={}, headers=headers
    )
    assert started.status_code == 200
    assert started.json()["move"]["status"] == "queued"
    assert started.json()["move"]["queued_at"] is not None


def test_a_double_tap_queues_once(client, paired):
    _uid, headers = paired
    drop = _share(client, headers).json()["drop"]
    client.put(f"/v1/drops/{drop['id']}/resolution", json=_resolution(), headers=headers)
    move = client.get(f"/v1/drops/{drop['id']}", headers=headers).json()["moves"][0]
    path = f"/v1/drops/{drop['id']}/moves/{move['id']}:start"
    first = client.post(path, json={}, headers=headers)
    second = client.post(path, json={}, headers=headers)
    assert (first.status_code, second.status_code) == (200, 409)
    assert "already queued" in second.json()["detail"]
    assert len(_rows("SELECT id FROM drop_moves WHERE status = 'queued'")) == 1


def test_the_persons_own_words_travel_and_are_kept(client, paired):
    _uid, headers = paired
    drop = _share(client, headers).json()["drop"]
    client.put(f"/v1/drops/{drop['id']}/resolution", json=_resolution(), headers=headers)
    move = client.get(f"/v1/drops/{drop['id']}", headers=headers).json()["moves"][0]
    said = "only the ones that work with a monorepo"
    r = client.post(
        f"/v1/drops/{drop['id']}/moves/{move['id']}:start",
        json={"adjustment": said, "repo_key": None},
        headers=headers,
    )
    assert r.json()["move"]["adjustment"] == said


def test_a_repo_key_has_to_be_a_key_and_never_a_name(client, paired):
    _uid, headers = paired
    drop = _share(client, headers).json()["drop"]
    client.put(f"/v1/drops/{drop['id']}/resolution", json=_resolution(), headers=headers)
    move = client.get(f"/v1/drops/{drop['id']}", headers=headers).json()["moves"][0]
    r = client.post(
        f"/v1/drops/{drop['id']}/moves/{move['id']}:start",
        json={"repo_key": "RideGT"},
        headers=headers,
    )
    assert r.status_code == 422


def test_a_second_resolution_leaves_a_decided_move_alone(client, paired):
    _uid, headers = paired
    drop = _share(client, headers).json()["drop"]
    client.put(
        f"/v1/drops/{drop['id']}/resolution",
        json=_resolution(moves=[_move(), _move(title="Second", move_kind="keep")]),
        headers=headers,
    )
    moves = client.get(f"/v1/drops/{drop['id']}", headers=headers).json()["moves"]
    client.post(f"/v1/drops/{drop['id']}/moves/{moves[0]['id']}:start", json={}, headers=headers)
    client.post(f"/v1/drops/{drop['id']}/moves/{moves[1]['id']}:decline", headers=headers)

    client.put(
        f"/v1/drops/{drop['id']}/resolution",
        json=_resolution(moves=[_move(title="Rewritten"), _move(title="Also rewritten")]),
        headers=headers,
    )
    got = client.get(f"/v1/drops/{drop['id']}", headers=headers).json()["moves"]
    after = {m["id"]: m for m in got}
    assert after[moves[0]["id"]]["status"] == "queued"
    assert after[moves[0]["id"]]["title"] == "Go find the 5 skills"
    assert after[moves[1]["id"]]["status"] == "declined"


# ----------------------------------------------------------------------- the queues
def test_claiming_takes_a_drop_once(client, paired):
    _uid, headers = paired
    _share(client, headers)
    first = client.post("/v1/drops:claim", headers=headers).json()["drops"]
    second = client.post("/v1/drops:claim", headers=headers).json()["drops"]
    assert len(first) == 1 and second == []
    assert _rows("SELECT status FROM drops")[0].status == "resolving"


def test_the_runner_finishes_a_move_and_points_it_at_its_session(client, paired):
    _uid, headers = paired
    drop = _share(client, headers).json()["drop"]
    client.put(f"/v1/drops/{drop['id']}/resolution", json=_resolution(), headers=headers)
    move = client.get(f"/v1/drops/{drop['id']}", headers=headers).json()["moves"][0]
    client.post(f"/v1/drops/{drop['id']}/moves/{move['id']}:start", json={}, headers=headers)

    claimed = client.post("/v1/drops/moves:claim", headers=headers).json()["moves"]
    assert len(claimed) == 1 and claimed[0]["id"] == move["id"]
    assert _rows("SELECT status FROM drop_moves")[0].status == "running"

    run = "3f2b0c84-9a1e-4c77-8d55-0a1b2c3d4e5f"
    done = client.post(
        f"/v1/drops/moves/{move['id']}:finish",
        json={"status": "done", "outcome": "installed two skills", "run_uuid": run},
        headers=headers,
    )
    assert done.json()["move"]["status"] == "done"
    assert done.json()["move"]["finished_at"] is not None
    # The run's OWN id, not a foreign key to a session that does not exist yet (0029). The first
    # real run of a real move ended in a foreign key violation and a 500 with the work done.
    assert done.json()["move"]["run_uuid"] == run
    assert done.json()["move"]["session_id"] is None


def test_a_run_id_that_is_not_a_uuid_is_refused(client, paired):
    _uid, headers = paired
    drop = _share(client, headers).json()["drop"]
    client.put(f"/v1/drops/{drop['id']}/resolution", json=_resolution(), headers=headers)
    move = client.get(f"/v1/drops/{drop['id']}", headers=headers).json()["moves"][0]
    client.post(f"/v1/drops/{drop['id']}/moves/{move['id']}:start", json={}, headers=headers)
    client.post("/v1/drops/moves:claim", headers=headers)
    r = client.post(
        f"/v1/drops/moves/{move['id']}:finish",
        json={"status": "done", "outcome": None, "run_uuid": "not-a-uuid"},
        headers=headers,
    )
    assert r.status_code == 422


def test_the_claim_carries_the_drops_own_title(client, paired):
    """A move says what to do; the drop says what it is ABOUT.

    MEASURED: a `card` move handed its own intent as the dish searched for "Find the full
    ingredients list and step by step method for this one pan garlic butter shrimp pasta" and
    came back with nothing, where the title alone finds a published recipe in one search.
    """
    _uid, headers = paired
    drop = _share(client, headers).json()["drop"]
    client.put(f"/v1/drops/{drop['id']}/resolution", json=_resolution(), headers=headers)
    move = client.get(f"/v1/drops/{drop['id']}", headers=headers).json()["moves"][0]
    client.post(f"/v1/drops/{drop['id']}/moves/{move['id']}:start", json={}, headers=headers)
    claimed = client.post("/v1/drops/moves:claim", headers=headers).json()["moves"][0]
    assert claimed["drop_title"] == "5 beginner Claude Skills to install"
    assert claimed["drop_kind"] == "skill"


def test_finishing_a_move_that_was_not_running_is_a_conflict(client, paired):
    _uid, headers = paired
    drop = _share(client, headers).json()["drop"]
    client.put(f"/v1/drops/{drop['id']}/resolution", json=_resolution(), headers=headers)
    move = client.get(f"/v1/drops/{drop['id']}", headers=headers).json()["moves"][0]
    r = client.post(
        f"/v1/drops/moves/{move['id']}:finish",
        json={"status": "done", "outcome": None, "run_uuid": None},
        headers=headers,
    )
    assert r.status_code == 409


# --------------------------------------------------------------------------- theirs
def test_a_board_is_one_persons(client, paired, created_users):
    """The one test in this file that would pass for the wrong reason if it were skipped.

    CLAUDE.md: "a negative test that cannot reach the code it is trying to violate passes for
    the wrong reason". The first version of this asked the fixture for a second account and
    skipped when there was not one, which is a test that reports green having checked nothing.
    It MAKES the second account.
    """
    _uid, headers = paired
    drop = _share(client, headers).json()["drop"]
    client.put(f"/v1/drops/{drop['id']}/resolution", json=_resolution(), headers=headers)
    move = client.get(f"/v1/drops/{drop['id']}", headers=headers).json()["moves"][0]

    _other_uid, other = _pair(client, created_users)
    # The second account is real and its own routes work, so a 404 below is RLS refusing this
    # board rather than a broken token refusing everything.
    assert client.get("/v1/drops", headers=other).status_code == 200
    assert client.get("/v1/drops", headers=other).json()["drops"] == []
    assert client.get(f"/v1/drops/{drop['id']}", headers=other).status_code == 404
    start_path = f"/v1/drops/{drop['id']}/moves/{move['id']}:start"
    assert client.post(start_path, json={}, headers=other).status_code == 404
    res_path = f"/v1/drops/{drop['id']}/resolution"
    assert client.put(res_path, json=_resolution(), headers=other).status_code == 404
    assert client.delete(f"/v1/drops/{drop['id']}", headers=other).status_code == 404
    # And it is still there, still offered, for the person whose board it is.
    mine = client.get(f"/v1/drops/{drop['id']}", headers=headers).json()["moves"]
    assert mine[0]["status"] == "offered"


def test_archiving_takes_it_off_the_board_and_sharing_it_again_brings_it_back(client, paired):
    _uid, headers = paired
    drop = _share(client, headers).json()["drop"]
    client.post(f"/v1/drops/{drop['id']}:archive", headers=headers)
    assert client.get("/v1/drops", headers=headers).json()["drops"] == []
    assert len(client.get("/v1/drops?archived=true", headers=headers).json()["drops"]) == 1
    again = _share(client, headers)
    assert again.json()["drop"]["archived_at"] is None
    assert len(client.get("/v1/drops", headers=headers).json()["drops"]) == 1


def test_deleting_a_drop_takes_its_moves(client, paired):
    _uid, headers = paired
    drop = _share(client, headers).json()["drop"]
    client.put(f"/v1/drops/{drop['id']}/resolution", json=_resolution(), headers=headers)
    assert client.delete(f"/v1/drops/{drop['id']}", headers=headers).status_code == 204
    assert _rows("SELECT id FROM drop_moves") == []


# ------------------------------------------------------- the migration is the spec
MIGRATION = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0028_drops.py"


@pytest.mark.parametrize(
    "constant,enum",
    [
        ("DROP_STATUS", "drop_status"),
        ("DROP_KIND", "drop_kind"),
        ("DROP_REFUSAL", "drop_refusal"),
        ("PLATFORM", "platform"),
        ("MOVE_KIND", "move_kind"),
        ("MOVE_STATUS", "move_status"),
        ("MOVE_TARGET", "move_target"),
        ("EFFORT", "effort"),
    ],
)
def test_every_check_list_in_the_migration_is_the_specs_enum(constant, enum):
    """A value added to spec/drops.v1.json is ALSO a migration.

    CLAUDE.md records what this costs when it is missed: the generated models accept the new
    value immediately and Postgres does not, so the first share carrying it is a constraint
    violation and a 500 the client cannot act on. Read from the file, both ways, rather than
    trusting a comment beside the constant.
    """
    # `ast`, not a regular expression. The first version of this matched to the end of the LINE,
    # so a constant written as parenthesised string concatenation over two lines (which
    # DROP_REFUSAL is) came back with half its values and the test passed on the half. Parsing
    # the module gets the constant the interpreter would.
    tree = ast.parse(MIGRATION.read_text())
    literal = None
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id == constant for t in node.targets
        ):
            literal = ast.literal_eval(node.value)
    assert literal is not None, f"{constant} is not in {MIGRATION.name}"
    values = re.findall(r"'([a-z_]+)'", literal)
    assert values == ANALYSIS_ENUM_VALUES[enum], (
        f"{constant} in the migration is {values}, the spec says {ANALYSIS_ENUM_VALUES[enum]}"
    )


# ------------------------------------------------------------------------ banners
def test_the_first_read_is_news_and_the_second_is_not(client, paired, monkeypatch):
    """`notify.py`'s first rule, borrowed: only a TRANSITION is news.

    A bulk re-read would otherwise fire a banner for every link somebody shared days ago, which
    is the failure that module records as "backfill must be silent".
    """
    from builder.routes import drops as route

    sent: list[tuple] = []
    monkeypatch.setattr(route, "send_drop", lambda *a: sent.append(a) or 1)

    _uid, headers = paired
    drop = _share(client, headers).json()["drop"]
    client.put(f"/v1/drops/{drop['id']}/resolution", json=_resolution(), headers=headers)
    assert len(sent) == 1
    _user, title, body, drop_id, kind = sent[0]
    assert kind == "drop_read"
    assert drop_id == drop["id"]
    assert "1 thing you could do" in body
    assert title == "5 beginner Claude Skills to install"

    client.put(f"/v1/drops/{drop['id']}/resolution", json=_resolution(), headers=headers)
    assert len(sent) == 1


def test_a_refusal_is_news_too(client, paired, monkeypatch):
    """Silence after a share is indistinguishable from the Mac being asleep, and "Instagram is
    closed" is something a person can act on by sharing a different link."""
    from builder.routes import drops as route

    sent: list[tuple] = []
    monkeypatch.setattr(route, "send_drop", lambda *a: sent.append(a) or 1)

    _uid, headers = paired
    drop = _share(client, headers).json()["drop"]
    client.put(
        f"/v1/drops/{drop['id']}/refusal", json={"refusal": "private_or_gone"}, headers=headers
    )
    assert len(sent) == 1
    assert sent[0][4] == "drop_read"
    assert "private or has been taken down" in sent[0][2]


def test_a_finished_move_says_what_it_did(client, paired, monkeypatch):
    from builder.routes import drops as route

    sent: list[tuple] = []
    monkeypatch.setattr(route, "send_drop", lambda *a: sent.append(a) or 1)

    _uid, headers = paired
    drop = _share(client, headers).json()["drop"]
    client.put(f"/v1/drops/{drop['id']}/resolution", json=_resolution(), headers=headers)
    move = client.get(f"/v1/drops/{drop['id']}", headers=headers).json()["moves"][0]
    client.post(f"/v1/drops/{drop['id']}/moves/{move['id']}:start", json={}, headers=headers)
    client.post("/v1/drops/moves:claim", headers=headers)
    client.post(
        f"/v1/drops/moves/{move['id']}:finish",
        json={"status": "done", "outcome": "installed two skills", "run_uuid": None},
        headers=headers,
    )
    assert sent[-1][4] == "drop_done"
    assert sent[-1][2] == "installed two skills"
    assert sent[-1][3] == drop["id"]


def test_a_push_that_fails_does_not_lose_the_upload(client, paired, monkeypatch):
    """The send happens after the transaction commits, so a dead APNs cannot roll back what was
    read. `notify.py` states the same rule for a session finishing."""
    from builder.routes import drops as route

    def boom(*_a):
        raise RuntimeError("apns is down")

    monkeypatch.setattr(route, "send_drop", boom)
    _uid, headers = paired
    drop = _share(client, headers).json()["drop"]
    r = client.put(f"/v1/drops/{drop['id']}/resolution", json=_resolution(), headers=headers)
    assert r.status_code == 200
    assert client.get(f"/v1/drops/{drop['id']}", headers=headers).json()["drop"]["kind"] == "skill"
