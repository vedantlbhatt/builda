"""The live state on the server: what a RUNNING session is doing, stored while it runs and
gone when it ends (docs/overnight-integration.md 2.2, 2.3, 3.1 to 3.4).

Two channels write it through one path (`routes/sync.py store_payloads`): the batch route,
with a `live` block a machine computed, and the hook channel, which computes it here from
the transcript bytes. Every test runs AS builder_app through the real routes, so row level
security on session_live and privacy_prefs is what the routes actually meet.

Privacy tests plant the integration's sentinels (a prompt, a path under a directory named
for them, a command) in the transcript and search every body the phone can read for them.
"""

import copy
import json
import time
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text
from test_capture_keys import _key_headers, _mint
from test_contract import SAMPLE_LIVE, SAMPLE_LIVE_NAMES, valid_payload
from test_sync import (  # noqa: F401 - fixtures are picked up by name
    TEST_DB,
    _live,
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

from builder import hook_ingest, live_store
from builder.builder_profile import eta_history
from builder.db import db_session
from builder.live_spec import LiveNames, LiveState
from builder.routes.sync import LIVE_NAMES_OFF, sanity_gate

pytestmark = pytest.mark.skipif(not TEST_DB, reason="set BUILDER_TEST_DB to run")
_SHARED_FIXTURES = (app_env, client, created_users, paired)

SENT_PROMPT = "zqx sentinel prompt"
SENT_DIR = "/tmp/zqx_sentinel_dir"
SENT_FILE = f"{SENT_DIR}/zqx_secret.py"
SENT_CMD = "zqxcmd --flag"
#: Every sentinel a body could leak: the prompt, the directory, the file and the command.
SENTINELS = ("zqx sentinel prompt", "zqx_sentinel_dir", "zqx_secret", "zqxcmd")
PROJECT_DIR = "-tmp-zqx-sentinel-dir"

#: The engine that writes spec/live.v1.json. The hook tests below need it; the batch route
#: tests do not, because a machine computed the block they upload.
needs_engine = pytest.mark.skipif(
    hook_ingest.live_engine() is None,
    reason="analysis.live does not write spec/live.v1.json here (no session_state/wire_names)",
)


# --------------------------------------------------------------------------- helpers


class _Transcript:
    """A real Claude Code transcript, written the way the harness writes one, with every
    timestamp placed so the LAST record is `age` seconds old when `raw()` is called."""

    def __init__(self, sid: str, cwd: str = SENT_DIR) -> None:
        self.sid = sid
        self.cwd = cwd
        self.records: list[tuple[float, dict]] = []
        self._parent: str | None = None

    def _rec(self, t: float, body: dict) -> None:
        u = str(uuid.uuid4())
        self.records.append(
            (
                t,
                {
                    "uuid": u,
                    "parentUuid": self._parent,
                    "sessionId": self.sid,
                    "cwd": self.cwd,
                    **body,
                },
            )
        )
        self._parent = u

    def prompt(self, t: float, text_: str) -> None:
        self._rec(
            t,
            {
                "type": "user",
                "promptSource": "typed",
                "message": {"role": "user", "content": [{"type": "text", "text": text_}]},
            },
        )

    def calls(self, t: float, mid: str, calls: list[tuple[str, str, dict]]) -> None:
        blocks = [{"type": "tool_use", "id": tid, "name": n, "input": i} for tid, n, i in calls]
        self._assistant(t, mid, blocks, "tool_use")

    def say(self, t: float, mid: str, text_: str) -> None:
        self._assistant(t, mid, [{"type": "text", "text": text_}], "end_turn")

    def _assistant(self, t: float, mid: str, blocks: list, stop: str) -> None:
        usage = {
            "input_tokens": 40,
            "output_tokens": 25,
            "cache_creation_input_tokens": 0,
            "cache_read_input_tokens": 1000,
        }
        self._rec(
            t,
            {
                "type": "assistant",
                "message": {
                    "id": mid,
                    "role": "assistant",
                    "model": "claude-opus-5",
                    "stop_reason": stop,
                    "usage": usage,
                    "content": blocks,
                },
            },
        )

    def result(self, t: float, tid: str, content: str, is_error: bool = False) -> None:
        block = {
            "type": "tool_result",
            "tool_use_id": tid,
            "content": content,
            "is_error": is_error,
        }
        self._rec(t, {"type": "user", "message": {"role": "user", "content": [block]}})

    def raw(self, age: float, now: float | None = None) -> bytes:
        now = time.time() if now is None else now
        last = max(t for t, _ in self.records)
        t0 = now - age - last
        out = []
        for t, r in self.records:
            stamp = datetime.fromtimestamp(t0 + t, UTC).isoformat(timespec="milliseconds")
            out.append(json.dumps({**r, "timestamp": stamp.replace("+00:00", "Z")}))
        return ("\n".join(out) + "\n").encode()


def _working(sid: str) -> _Transcript:
    """A sitting that reads, edits, runs a command and tests, with the sentinels planted in
    the prompt, the paths and the command, and the turn still going (no end_turn)."""
    t = _Transcript(sid)
    t.prompt(0, f"{SENT_PROMPT}: fix the parser in zqx_secret.py")
    t.calls(4, "m1", [("tu1", "Read", {"file_path": SENT_FILE})])
    t.result(5, "tu1", "def parse(): pass")
    t.calls(
        9,
        "m2",
        [("tu2", "Edit", {"file_path": SENT_FILE, "old_string": "pass", "new_string": "return 1"})],
    )
    t.result(10, "tu2", "ok")
    t.calls(14, "m3", [("tu3", "Bash", {"command": SENT_CMD})])
    t.result(15, "tu3", "done")
    t.calls(19, "m4", [("tu4", "Read", {"file_path": f"{SENT_DIR}/other.py"})])
    t.result(20, "tu4", "x = 1")
    t.calls(24, "m5", [("tu5", "Bash", {"command": "pytest -q"})])
    t.result(40, "tu5", "1 passed")
    return t


def _hook_headers(key: str, sid: str, offset: int, hook: str = "Stop") -> dict:
    return {
        **_key_headers(key),
        "Content-Type": "application/x-ndjson",
        "X-Builder-Session-Id": sid,
        "X-Builder-Project-Dir": PROJECT_DIR,
        "X-Builder-Offset": str(offset),
        "X-Builder-Hook": hook,
        "X-Builder-Tz-Offset-Minutes": "0",
    }


def _post(client, key: str, sid: str, raw: bytes, offset: int = 0, hook: str = "Stop"):
    r = client.post(
        "/v1/ingest/transcript", content=raw, headers=_hook_headers(key, sid, offset, hook)
    )
    assert r.status_code == 200, r.text
    return r.json()


def _live_rows(user_id: str) -> list:
    """session_live as the OWNER sees it, so a test can check what was stored without the
    routes' own filtering standing in for it."""
    with owner_engine().connect() as c:
        return c.execute(
            text(
                "SELECT session_id, source, live_version, computed_at, body, names "
                "FROM session_live WHERE user_id = :u"
            ),
            {"u": user_id},
        ).all()


def _set_names(user_id: str, on: bool) -> int:
    with db_session(viewer_id=user_id) as db:
        return live_store.set_live_names(db, user_id, on)


def _live_doc(**changes) -> dict:
    d = copy.deepcopy(SAMPLE_LIVE)
    d.update(changes)
    return d


A, B, C = "a" * 16, "b" * 16, "c" * 16


def _three_file_live() -> dict:
    """A live state whose map has three files: one the activity names, one the verdict
    names, and one neither does, plus a time lapse."""
    d = copy.deepcopy(SAMPLE_LIVE)
    d["activity"]["file_id"] = A
    d["verdict"]["file_id"] = B
    row = d["map"]["files"][0]
    d["map"]["files"] = [{**row, "id": fid} for fid in (A, C, B)]
    d["timelapse"] = [{"t": i, "file_id": fid, "kind": "read"} for i, fid in enumerate((A, B, C))]
    return d


# --------------------------------------------------------------------------- the gate


def test_gate_rejects_live_on_a_final_payload():
    """A finished session carrying a live block would bring back the row its final exists
    to delete: a finished session reading "Running your tests"."""
    p = valid_payload(live=SAMPLE_LIVE)  # state final
    assert "live present on a final payload" in sanity_gate(p)
    ok = valid_payload(state="live", end_reason="still_running", live=SAMPLE_LIVE)
    assert sanity_gate(ok) is None


@pytest.mark.parametrize("name", ["src/auth.py", "..\\auth.py", "auth\x00.py"])
def test_gate_rejects_names_without_live_or_with_a_separator(name):
    live = {"state": "live", "end_reason": "still_running"}
    no_map = valid_payload(**live, live_names=SAMPLE_LIVE_NAMES)
    assert sanity_gate(no_map) == "live_names present without live"

    bad = {"files": [{"id": SAMPLE_LIVE["map"]["files"][0]["id"], "name": name}]}
    p = valid_payload(**live, live=SAMPLE_LIVE, live_names=bad)
    reason = sanity_gate(p)
    assert reason == "live_names carries a path separator or NUL (basenames only)"
    # The name itself never comes back in the reason, which is logged.
    assert name not in reason

    fine = valid_payload(**live, live=SAMPLE_LIVE, live_names=SAMPLE_LIVE_NAMES)
    assert sanity_gate(fine) is None


def test_gate_rejects_a_name_for_a_file_the_map_does_not_carry():
    """A name labels a row of the live map (`live.wire_names` keeps only those). One whose id
    is on no row labels nothing the phone can show, and it is still a file name on the
    server, so it is refused like a name sent without the map. So is any name at all when
    the state has no map."""
    live = {"state": "live", "end_reason": "still_running"}
    unmapped = {"id": "0123456789abcdef", "name": "secret.py"}
    stray = {"files": [*SAMPLE_LIVE_NAMES["files"], unmapped]}
    reason = sanity_gate(valid_payload(**live, live=SAMPLE_LIVE, live_names=stray))
    assert reason == "live_names names a file the live map does not carry"
    assert "secret" not in reason and "0123456789abcdef" not in reason

    no_map = {**copy.deepcopy(SAMPLE_LIVE), "map": None}
    assert (
        sanity_gate(valid_payload(**live, live=no_map, live_names=SAMPLE_LIVE_NAMES))
        == "live_names names a file the live map does not carry"
    )
    # An empty list names nothing, so it names nothing outside the map.
    assert sanity_gate(valid_payload(**live, live=no_map, live_names={"files": []})) is None


def test_a_final_payload_with_live_arrives_as_rejected_not_as_a_row(client, paired):
    uid, headers = paired
    bad = _payload(live=SAMPLE_LIVE)
    out = _upload(client, headers, bad)
    assert out["accepted"] == 0
    assert "live present" in out["rejected"][0]["reason"]
    assert _owner_rows(uid) == [] and _live_rows(uid) == []


# --------------------------------------------------------------------- the batch route


def test_a_live_upload_stores_its_state_and_the_final_deletes_it(client, paired):
    uid, headers = paired
    started = datetime.now(UTC).replace(microsecond=0) - timedelta(minutes=20)
    csid = uuid.uuid4().hex * 2
    assert (
        _upload(client, headers, _live(started, 15, client_session_id=csid, live=SAMPLE_LIVE))[
            "accepted"
        ]
        == 1
    )
    (row,) = _live_rows(uid)
    assert row.source == "capture" and row.live_version == 1
    assert row.body == SAMPLE_LIVE and row.names is None
    assert row.computed_at == datetime(2026, 9, 13, 7, 41, 5, tzinfo=UTC)

    sid = _owner_rows(uid)[0].id
    detail = client.get(f"/v1/sessions/{sid}", headers=headers).json()
    assert detail["live_state"] == SAMPLE_LIVE
    assert detail["live_names"] is None

    final = _payload(
        client_session_id=csid, started_at=started, ended_at=started + timedelta(hours=1)
    )
    assert _upload(client, headers, final)["accepted"] == 1
    assert _live_rows(uid) == [], "the row exists exactly while the session is live"
    detail = client.get(f"/v1/sessions/{sid}", headers=headers).json()
    assert detail["state"] == "final"
    assert detail["live_state"] is None and detail["live_names"] is None


def test_an_unchanged_hash_still_refreshes_the_live_row(client, paired):
    """The content hash is taken WITHOUT `live`, because the block moves with the clock
    (idle minutes, the ETA's elapsed time) and not with the bytes."""
    uid, headers = paired
    started = datetime.now(UTC).replace(microsecond=0) - timedelta(minutes=20)
    first = _live(started, 15, live=SAMPLE_LIVE)
    _upload(client, headers, first)
    later = {**first, "live": _live_doc(computed_at="2026-09-13T07:46:05Z")}
    out = _upload(client, headers, later)
    assert out == {"accepted": 0, "unchanged": 1, "rejected": []}
    (row,) = _live_rows(uid)
    assert row.computed_at == datetime(2026, 9, 13, 7, 46, 5, tzinfo=UTC)


def test_a_live_payload_without_a_live_block_leaves_the_row_alone(client, paired):
    """The Mac app uploads live snapshots and computes no live state. Nothing must not mean
    "delete what another producer measured", exactly as with `analysis`."""
    uid, headers = paired
    started = datetime.now(UTC).replace(microsecond=0) - timedelta(minutes=20)
    csid = uuid.uuid4().hex * 2
    _upload(client, headers, _live(started, 15, client_session_id=csid, live=SAMPLE_LIVE))
    assert _upload(client, headers, _live(started, 16, client_session_id=csid))["accepted"] == 1
    (row,) = _live_rows(uid)
    assert row.body == SAMPLE_LIVE


def test_the_live_list_is_slim(client, paired):
    """Ten live sessions with a 400 row map and 600 frames each is about 600 KB a minute.
    The list carries no time lapse and only the map rows the sentence reads; the detail
    carries everything."""
    uid, headers = paired
    started = datetime.now(UTC).replace(microsecond=0) - timedelta(minutes=20)
    doc = _three_file_live()
    _upload(client, headers, _live(started, 15, live=doc))

    (row,) = client.get("/v1/sessions/live", headers=headers).json()["sessions"]
    slim = row["live_state"]
    assert slim["timelapse"] is None
    assert [f["id"] for f in slim["map"]["files"]] == [A, B]
    assert slim["map"]["files_total"] == doc["map"]["files_total"]
    # Everything else the tile reads is there, untouched.
    for key in ("activity", "verdict", "eta", "needs_you", "decisions", "sample", "computed_at"):
        assert slim[key] == doc[key], key
    # The slim form still passes the door: the phone decodes one type.
    LiveState(**slim)

    profile_live = client.get("/v1/profile", headers=headers).json()["live"]
    assert profile_live[0]["live_state"] == slim

    sid = _owner_rows(uid)[0].id
    full = client.get(f"/v1/sessions/{sid}", headers=headers).json()["live_state"]
    assert full == doc


def test_a_live_row_without_a_state_reads_back_null(client, paired):
    """Null, never absent: the phone tells "no producer computed one" from an older server
    by whether the key is there."""
    uid, headers = paired
    started = datetime.now(UTC).replace(microsecond=0) - timedelta(minutes=20)
    _upload(client, headers, _live(started, 15))
    (row,) = client.get("/v1/sessions/live", headers=headers).json()["sessions"]
    assert "live_state" in row and row["live_state"] is None
    sid = _owner_rows(uid)[0].id
    detail = client.get(f"/v1/sessions/{sid}", headers=headers).json()
    assert detail["live_state"] is None and detail["live_names"] is None


# ------------------------------------------------------------------------- file names


def test_live_names_stored_only_while_the_account_has_them_on(client, paired):
    uid, headers = paired
    started = datetime.now(UTC).replace(microsecond=0) - timedelta(minutes=20)
    csid = uuid.uuid4().hex * 2
    with_names = _live(
        started, 15, client_session_id=csid, live=SAMPLE_LIVE, live_names=SAMPLE_LIVE_NAMES
    )

    # Off by default: refused with the reason, and nothing stored at all.
    out = _upload(client, headers, with_names)
    assert out["accepted"] == 0
    assert out["rejected"] == [{"client_session_id": csid, "reason": LIVE_NAMES_OFF}]
    assert _owner_rows(uid) == [] and _live_rows(uid) == []

    assert _set_names(uid, True) == 0
    assert _upload(client, headers, with_names)["accepted"] == 1
    (row,) = _live_rows(uid)
    assert row.names == SAMPLE_LIVE_NAMES
    sid = _owner_rows(uid)[0].id
    assert client.get(f"/v1/sessions/{sid}", headers=headers).json()["live_names"] == (
        SAMPLE_LIVE_NAMES
    )

    # Off deletes, in the same transaction as the switch.
    assert _set_names(uid, False) == 1
    (row,) = _live_rows(uid)
    assert row.names is None and row.body == SAMPLE_LIVE
    assert client.get(f"/v1/sessions/{sid}", headers=headers).json()["live_names"] is None


def test_a_store_racing_the_phones_off_never_keeps_a_name(client, paired):
    """The phone's off (routes/privacy.py) sets the switch and clears every stored name in one
    transaction. A store that read the switch while that transaction was open used to see
    "on", wait on the live row, and write its names after the clear. It now reads the switch
    under a share lock (`live_store.prefs(lock=True)`), so it waits for the off and sees it."""
    import threading

    uid, headers = paired
    _set_names(uid, True)
    started = datetime.now(UTC).replace(microsecond=0) - timedelta(minutes=20)
    csid = uuid.uuid4().hex * 2
    p = _live(started, 15, client_session_id=csid, live=SAMPLE_LIVE, live_names=SAMPLE_LIVE_NAMES)
    assert _upload(client, headers, p)["accepted"] == 1
    out: dict = {}
    with owner_engine().connect() as phone:
        tx = phone.begin()
        # the off, exactly as the prefs route runs it, not yet committed
        phone.execute(
            text("UPDATE privacy_prefs SET live_names = false WHERE user_id = :u"), {"u": uid}
        )
        phone.execute(text("UPDATE session_live SET names = NULL WHERE user_id = :u"), {"u": uid})
        racer = threading.Thread(target=lambda: out.update(r=_upload(client, headers, p)))
        racer.start()
        racer.join(1.0)
        assert racer.is_alive(), "the store waits on the switch rather than reading around it"
        tx.commit()
    racer.join(20)
    assert out["r"]["rejected"] == [{"client_session_id": csid, "reason": LIVE_NAMES_OFF}]
    (row,) = _live_rows(uid)
    assert row.names is None


def test_names_are_not_served_while_the_switch_is_off_even_if_stored(client, paired):
    """The read side checks the switch too, so a row written before it was turned off, or
    by a path that forgot to null it, still shows nothing."""
    uid, headers = paired
    _set_names(uid, True)
    started = datetime.now(UTC).replace(microsecond=0) - timedelta(minutes=20)
    _upload(client, headers, _live(started, 15, live=SAMPLE_LIVE, live_names=SAMPLE_LIVE_NAMES))
    with owner_engine().begin() as c:
        c.execute(
            text("UPDATE privacy_prefs SET live_names = false WHERE user_id = :u"), {"u": uid}
        )
    sid = _owner_rows(uid)[0].id
    assert _live_rows(uid)[0].names is not None
    assert client.get(f"/v1/sessions/{sid}", headers=headers).json()["live_names"] is None


def test_live_names_never_appear_in_the_live_list(client, paired):
    """The live list feeds mission control, the widget and ActivityKit: a basename there
    could reach a Lock Screen."""
    uid, headers = paired
    _set_names(uid, True)
    started = datetime.now(UTC).replace(microsecond=0) - timedelta(minutes=20)
    _upload(client, headers, _live(started, 15, live=SAMPLE_LIVE, live_names=SAMPLE_LIVE_NAMES))
    assert _live_rows(uid)[0].names == SAMPLE_LIVE_NAMES
    for path in (
        "/v1/sessions/live",
        "/v1/profile",
        "/v1/sessions?include_live=true&notable_only=false",
    ):
        body = client.get(path, headers=headers).text
        assert "auth.py" not in body, path
        assert "live_names" not in body, path


def test_the_salt_is_created_once_and_never_served(client, paired):
    uid, headers = paired
    with db_session(viewer_id=uid) as db:
        first = live_store.prefs(db, uid)
    with db_session(viewer_id=uid) as db:
        again = live_store.prefs(db, uid)
    assert first == again
    assert (first.quotes, first.live_names) == (False, False)
    assert len(first.map_salt) == 32 and int(first.map_salt, 16) >= 0
    for path in ("/v1/sessions/live", "/v1/profile", "/v1/profile/builder"):
        assert first.map_salt not in client.get(path, headers=headers).text, path


# ------------------------------------------------------------------------ eta history


def test_eta_history_is_the_stored_sessions_of_the_same_repo_hash(client, paired):
    """Final and visible only (what `is_counted` put on the wire), keyed by repo_hash, and
    unattended as ZERO PRESENCE, the live side's test: a short robot run is stored with
    unattended false (below the notable floor) and must still count as unattended here."""
    uid, headers = paired
    here, there = "d" * 64, "e" * 64
    t0 = datetime(2026, 8, 1, 9, 0, tzinfo=UTC)

    def at(i: int, **kw) -> dict:
        s = t0 + timedelta(days=i)
        return _payload(started_at=s, ended_at=s + timedelta(hours=1), **kw)

    robot_start = t0 + timedelta(days=9)
    _upload(
        client,
        headers,
        at(0),
        at(1),
        at(2, repo_hash=there),
        at(3, visible=False),
        _payload(
            started_at=robot_start,
            ended_at=robot_start + timedelta(minutes=10),
            active_seconds=600,
            attended_seconds=0,
            autonomous_seconds=600,
            presence_count=0,
            unattended=False,
        ),
        _live(datetime.now(UTC).replace(microsecond=0) - timedelta(minutes=30), 20),
    )
    with db_session(viewer_id=uid) as db:
        every = eta_history(db, uid)
        only_there = eta_history(db, uid, repo_hash=there)
    assert every is not None
    assert [f.repo for f in every] == [here, here, there, here]
    assert [f.unattended for f in every] == [False, False, False, True]
    assert [f.active_seconds for f in every] == [3600, 3600, 3600, 600]
    assert [f.repo for f in only_there] == [there]


# -------------------------------------------------------------------- the hook channel


def _hook_session(client, headers, key: str, sid: str, raw: bytes, hook: str = "Stop") -> dict:
    body = _post(client, key, sid, raw, 0, hook)
    assert body["rejected"] == [], body
    return body


@needs_engine
def test_a_hook_tail_stores_a_live_state_for_the_open_session(client, paired):
    uid, headers = paired
    key = _mint(client, headers)["key"]
    sid = str(uuid.uuid4())
    body = _hook_session(client, headers, key, sid, _working(sid).raw(age=20))

    (line,) = body["live"]
    assert line["sentence"] and line["needs_you"]["score"] >= 0
    (row,) = _live_rows(uid)
    assert row.source == "hook"
    LiveState(**row.body)
    assert line["client_session_id"] == _owner_rows(uid)[0].client_session_id
    assert line["needs_you"] == row.body["needs_you"]
    # No repository resolves for a directory that does not exist (Railway's case too), so
    # the ETA refuses rather than guesses.
    assert row.body["eta"]["reason"] == "repo_unresolved"
    assert row.body["sample"]["tool_calls"] == 5
    assert row.body["sample"]["tokens"] is not None
    assert row.names is None, "File names are off by default: no basename is computed"

    listed = client.get("/v1/sessions/live", headers=headers).json()["sessions"]
    assert listed[0]["live_state"]["activity"] == row.body["activity"]


@needs_engine
def test_the_live_state_is_deleted_when_the_session_finalises(client, paired):
    uid, headers = paired
    key = _mint(client, headers)["key"]
    sid = str(uuid.uuid4())
    raw = _working(sid).raw(age=20)
    lines = raw.splitlines(keepends=True)
    # Seven records: the prompt and three calls with their results, which is a counted
    # sitting (three meaningful events) that is still running.
    first, rest = b"".join(lines[:7]), b"".join(lines[7:])
    _post(client, key, sid, first)
    assert len(_live_rows(uid)) == 1
    done = _post(client, key, sid, rest, len(first), "SessionEnd")
    assert done["live"] == [] and done["final"] >= 1
    assert _live_rows(uid) == []
    sid_row = _owner_rows(uid)[0]
    assert sid_row.state == "final"
    detail = client.get(f"/v1/sessions/{sid_row.id}", headers=headers).json()
    assert detail["live_state"] is None


@needs_engine
def test_live_state_never_carries_a_path_or_a_prompt(client, paired):
    """The sentinels are in the prompt, both paths and the command. Not one reaches the
    stored document or any body the phone reads, with File names off."""
    uid, headers = paired
    key = _mint(client, headers)["key"]
    sid = str(uuid.uuid4())
    response = _hook_session(client, headers, key, sid, _working(sid).raw(age=20))

    (row,) = _live_rows(uid)
    stored = json.dumps(row.body)
    session_id = _owner_rows(uid)[0].id
    bodies = {
        # The uploader's own terminal line: the names=False sentence, nothing it did not send.
        "ingest response": json.dumps(response),
        "stored": stored,
        "live": client.get("/v1/sessions/live", headers=headers).text,
        "detail": client.get(f"/v1/sessions/{session_id}", headers=headers).text,
        "profile": client.get("/v1/profile", headers=headers).text,
    }
    for where, b in bodies.items():
        for s in SENTINELS:
            assert s not in b, (where, s)
    # And the map still describes the two files, as ids only.
    assert row.body["map"]["files_total"] >= 2


@needs_engine
def test_live_names_via_the_hook_only_with_the_switch_on_and_only_on_the_detail(client, paired):
    uid, headers = paired
    key = _mint(client, headers)["key"]
    _set_names(uid, True)
    sid = str(uuid.uuid4())
    _hook_session(client, headers, key, sid, _working(sid).raw(age=20))

    (row,) = _live_rows(uid)
    names = LiveNames(**row.names).model_dump()
    assert {n["name"] for n in names["files"]} == {"zqx_secret.py", "other.py"}
    map_ids = {f["id"] for f in row.body["map"]["files"]}
    assert {n["id"] for n in names["files"]} <= map_ids
    session_id = _owner_rows(uid)[0].id
    detail = client.get(f"/v1/sessions/{session_id}", headers=headers).json()
    assert detail["live_names"] == row.names
    # A basename, never the directory, even on the detail.
    assert "zqx_sentinel_dir" not in json.dumps(detail)
    assert "zqx_secret" not in client.get("/v1/sessions/live", headers=headers).text


@needs_engine
def test_an_empty_heartbeat_recomputes_idle(client, paired, monkeypatch):
    """No new bytes, a later clock: the cut runs again and the state moves with it. This is
    what keeps "waiting on you for N minutes" true while nobody types."""
    from builder.routes import ingest

    uid, headers = paired
    key = _mint(client, headers)["key"]
    sid = str(uuid.uuid4())
    t0 = time.time()
    raw = _working(sid).raw(age=20, now=t0)
    monkeypatch.setattr(ingest, "_clock", lambda: t0)
    _post(client, key, sid, raw)
    (before,) = _live_rows(uid)

    later = t0 + 600  # still inside the 900 s idle threshold: the session stays live
    monkeypatch.setattr(ingest, "_clock", lambda: later)
    beat = _post(client, key, sid, b"", len(raw))
    assert beat["next_offset"] == len(raw)
    assert beat["unchanged"] + beat["accepted"] == 1
    (after,) = _live_rows(uid)
    assert (after.computed_at - before.computed_at).total_seconds() == pytest.approx(600, abs=1)
    grew = after.body["activity"]["since_s"] - before.body["activity"]["since_s"]
    assert grew == pytest.approx(600, abs=1)
    assert after.body["activity"]["kind"] == "idle", after.body["activity"]
    assert after.body["needs_you"]["reason"] == "idle"


# ------------------------------------------------------ burn and title_ids by the hook


def _stored_burn_and_title(user_id: str):
    with owner_engine().connect() as c:
        return c.execute(
            text(
                "SELECT s.id, st.burn, s.title_ids FROM sessions s "
                "JOIN session_stats st ON st.session_id = s.id WHERE s.user_id = :u"
            ),
            {"u": user_id},
        ).all()


def test_the_hook_channel_stores_the_burn_and_title_the_payload_builder_computes(
    client, paired, monkeypatch
):
    """The addendum: per session burn and the title ids are produced by the ONE payload
    builder both channels share (`capture.sessions.build_payload`), so a sitting that
    arrives by hook carries exactly what `capture sync` would send for the same bytes, and
    the server stores and returns it unchanged."""
    from builder.contract import SessionUpload
    from builder.routes import ingest

    uid, headers = paired
    key = _mint(client, headers)["key"]
    sid = str(uuid.uuid4())
    t0 = time.time()
    raw = _working(sid).raw(age=20, now=t0)
    monkeypatch.setattr(ingest, "_clock", lambda: t0)

    def builder(finalize: bool) -> SessionUpload:
        (p,) = hook_ingest.payloads_for(
            raw,
            native_session_id=sid,
            project_dir=PROJECT_DIR,
            tz_offset_minutes=0,
            finalize=finalize,
            device_id="00000000-0000-0000-0000-000000000000",
            now=t0,
        )
        return SessionUpload(**p)

    for hook, finalize in (("Stop", False), ("SessionEnd", True)):
        _post(client, key, sid, raw, 0, hook)
        want = builder(finalize)
        assert want.burn is not None, "the payload builder computes no burn for this sitting"
        assert want.title_ids is not None, "the payload builder computes no title for it"
        ((session_id, burn, title),) = _stored_burn_and_title(uid)
        assert burn == want.burn.model_dump(mode="json"), hook
        assert title == want.title_ids.model_dump(mode="json"), hook
        detail = client.get(f"/v1/sessions/{session_id}", headers=headers).json()
        assert (detail["burn"], detail["title_ids"]) == (burn, title)
        assert detail["state"] == ("final" if finalize else "live")
