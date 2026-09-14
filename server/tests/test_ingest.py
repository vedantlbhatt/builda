"""The hook channel: a transcript POSTed in tails by Claude Code's own hooks becomes the
same session rows `python -m capture` would have produced, and the raw bytes do not
outlive the session.

The fixture transcript is `spec/fixtures/boundaries/remote_sdk_prompts.jsonl` — the one
the CI reference job and the Swift digest parity test also use — re-stamped so its last
record is seconds old (the shape a hook sees) and sent as two tails split on a line
boundary, the way the shell script sends them.
"""

import json
import pathlib
import sys
import time
import uuid

from sqlalchemy import text
from test_capture_keys import _key_headers, _mint
from test_sync import (  # noqa: F401 - fixtures are picked up by name
    _pair,
    app_env,
    client,
    created_users,
    owner_engine,
    paired,
)

from builder.db import db_session

ROOT = pathlib.Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "spec" / "fixtures" / "boundaries" / "remote_sdk_prompts.jsonl"
PROJECT_DIR = "-Users-dev-proj"
_SHARED_FIXTURES = (app_env, client, created_users, paired)


def _shifted(age_of_last_record_sec: float = 300.0) -> bytes:
    """The fixture with every timestamp moved so its last record is `age` seconds ago.

    Sent as-is, a years-old transcript is final after the FIRST tail by the idle rule and
    the second tail is correctly a new sitting. Fresh, the first tail is a live session
    whose bytes are kept until the SessionEnd tail finalises it — the case under test.
    300 s: inside the idle threshold (live), outside the active gap cap, so the trailing
    credit a finalised session earns is the full cap whenever the cut happens and two
    cuts seconds apart hash identically (the replay test depends on that).
    """
    recs = [json.loads(ln) for ln in FIXTURE.read_text().splitlines() if ln.strip()]

    def secs(stamp: str) -> float:
        return time.mktime(time.strptime(stamp[:19], "%Y-%m-%dT%H:%M:%S")) - time.timezone

    last = max(secs(r["timestamp"]) for r in recs if isinstance(r.get("timestamp"), str))
    delta = (time.time() - age_of_last_record_sec) - last
    out = []
    for r in recs:
        if isinstance(r.get("timestamp"), str):
            moved = secs(r["timestamp"]) + delta
            r["timestamp"] = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(moved)) + ".000Z"
        out.append(json.dumps(r))
    return ("\n".join(out) + "\n").encode()


def _halves(raw: bytes) -> tuple[bytes, bytes]:
    cut = raw.index(b"\n", len(raw) // 2) + 1
    return raw[:cut], raw[cut:]


def _headers(key: str, sid: str, offset: int, hook: str) -> dict:
    return {
        **_key_headers(key),
        "Content-Type": "application/x-ndjson",
        "X-Builder-Session-Id": sid,
        "X-Builder-Project-Dir": PROJECT_DIR,
        "X-Builder-Offset": str(offset),
        "X-Builder-Hook": hook,
        "X-Builder-Tz-Offset-Minutes": "0",
    }


def _expected_payloads(raw: bytes, sid: str) -> list[dict]:
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    from builder import hook_ingest

    return hook_ingest.payloads_for(
        raw,
        native_session_id=sid,
        project_dir=PROJECT_DIR,
        tz_offset_minutes=0,
        finalize=True,
        device_id="00000000-0000-0000-0000-000000000000",
    )


def _rows(user_id: str):
    with db_session(viewer_id=user_id) as db:
        return db.execute(
            text(
                "SELECT s.client_session_id, s.state, s.end_reason, s.attended_seconds, "
                "s.autonomous_seconds, s.presence_count, st.human_prompt_count "
                "FROM sessions s JOIN session_stats st ON st.session_id = s.id "
                "WHERE s.user_id = :u ORDER BY s.started_at"
            ),
            {"u": user_id},
        ).all()


def _chunks(user_id: str, sid: str) -> int:
    with db_session(viewer_id=user_id) as db:
        return db.execute(
            text(
                "SELECT count(*) FROM transcript_chunks "
                "WHERE user_id = :u AND native_session_id = :s AND octet_length(bytes) > 0"
            ),
            {"u": user_id, "s": sid},
        ).scalar()


def test_two_tails_become_the_capture_sessions_and_the_raw_bytes_are_retired(client, paired):
    user_id, headers = paired
    key = _mint(client, headers)["key"]
    sid = "aaaaaaaa-0000-4000-8000-00000000hook"
    raw = _shifted()
    first, second = _halves(raw)

    r1 = client.post("/v1/ingest/transcript", content=first, headers=_headers(key, sid, 0, "Stop"))
    assert r1.status_code == 200, r1.text
    assert r1.json()["next_offset"] == len(first)
    # One line per live session for the uploader's terminal (`capture live`).
    assert len(r1.json()["live"]) >= 1, r1.text
    assert _chunks(user_id, sid) >= 1  # live: the bytes wait for the next tail

    r2 = client.post(
        "/v1/ingest/transcript",
        content=second,
        headers=_headers(key, sid, len(first), "SessionEnd"),
    )
    assert r2.status_code == 200, r2.text
    body = r2.json()
    assert body["next_offset"] == len(first) + len(second)
    assert body["rejected"] == []
    assert body["final"] >= 1 and body["live"] == []

    expected = _expected_payloads(raw, sid)
    rows = _rows(user_id)
    assert {r.client_session_id for r in rows} == {p["client_session_id"] for p in expected}
    by_id = {p["client_session_id"]: p for p in expected}
    for r in rows:
        p = by_id[r.client_session_id]
        assert (r.state, r.end_reason) == (p["state"], p["end_reason"])
        assert (r.attended_seconds, r.autonomous_seconds) == (
            p["attended_seconds"],
            p["autonomous_seconds"],
        )
        assert (r.presence_count, r.human_prompt_count) == (
            p["presence_count"],
            p["human_prompt_count"],
        )
        # The remote-shaped prompts count (the CLAUDE.md trap): 9 of 9 on this fixture.
        assert r.human_prompt_count > 0
    # Final everywhere -> the conversation itself is no longer on the server.
    assert _chunks(user_id, sid) == 0


def test_replay_is_unchanged_and_a_gap_is_409_with_the_real_offset(client, paired):
    user_id, headers = paired
    key = _mint(client, headers)["key"]
    sid = "bbbbbbbb-0000-4000-8000-00000000hook"
    first, second = _halves(_shifted())
    ok1 = client.post("/v1/ingest/transcript", content=first, headers=_headers(key, sid, 0, "Stop"))
    assert ok1.status_code == 200, ok1.text
    # A tail that skips ahead: refused, and told where to resume from.
    gap = client.post(
        "/v1/ingest/transcript",
        content=second,
        headers=_headers(key, sid, len(first) + 10, "Stop"),
    )
    assert gap.status_code == 409
    assert gap.json()["next_offset"] == len(first)
    ok2 = client.post(
        "/v1/ingest/transcript",
        content=second,
        headers=_headers(key, sid, len(first), "SessionEnd"),
    )
    assert ok2.status_code == 200, ok2.text
    n = len(_rows(user_id))
    assert n >= 1
    # After retirement the server still knows the offset, so the next tail is accepted
    # at the byte the script expects.
    off = client.get(f"/v1/ingest/transcript/{sid}/offset", headers=_key_headers(key))
    assert off.json()["next_offset"] == len(first) + len(second)
    # The whole file again from 0 (a script that lost its offset file): same rows,
    # nothing accepted twice.
    again = client.post(
        "/v1/ingest/transcript",
        content=first + second,
        headers=_headers(key, sid, 0, "SessionEnd"),
    )
    assert again.status_code == 200, again.text
    assert again.json()["accepted"] == 0 and again.json()["unchanged"] >= 1
    assert len(_rows(user_id)) == n
    assert _chunks(user_id, sid) == 0


def test_bad_names_and_offsets_are_422_and_the_script_is_served(client, paired):
    _, headers = paired
    key = _mint(client, headers)["key"]
    bad = _headers(key, "../etc", 0, "Stop")
    assert client.post("/v1/ingest/transcript", content=b"{}\n", headers=bad).status_code == 422
    neg = _headers(key, "ok-id", -1, "Stop")
    assert client.post("/v1/ingest/transcript", content=b"{}\n", headers=neg).status_code == 422
    script = client.get("/v1/ingest/hook.sh")
    assert script.status_code == 200
    assert script.text.startswith("#!/usr/bin/env bash")
    assert "/v1/ingest/transcript" in script.text and "exit 0" in script.text


def test_another_viewer_cannot_see_raw_chunks(client, paired, created_users):
    """Chunks that ARE retained (a session still live) are owner-only past the route."""
    user_id, headers = paired
    key = _mint(client, headers)["key"]
    sid = "cccccccc-0000-4000-8000-00000000hook"
    # One fresh prompt record: the session is live, so its bytes are kept.
    now = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(time.time() - 30))
    rec = {
        "type": "user",
        "uuid": "u1",
        "parentUuid": None,
        "sessionId": sid,
        "timestamp": now,
        "cwd": "/Users/dev/proj",
        "promptSource": "typed",
        "message": {"role": "user", "content": "hello"},
    }
    raw = (json.dumps(rec) + "\n").encode()
    r = client.post("/v1/ingest/transcript", content=raw, headers=_headers(key, sid, 0, "Stop"))
    assert r.status_code == 200, r.text
    assert _chunks(user_id, sid) >= 1
    other_id, _ = _pair(client, created_users)
    assert _chunks(other_id, sid) == 0
    # And the owner can retire them on demand.
    d = client.delete(f"/v1/ingest/transcript/{sid}", headers=_key_headers(key))
    assert d.status_code == 204
    assert _chunks(user_id, sid) == 0


# ------------------------------------------------------------- offsets after retirement
#
# `capture live` sends an EMPTY body every heartbeat while nothing new is written, so the
# retired conversation's offset marker has to survive one; and a conversation the person
# comes back to after an idle gap continues from the FILE's offset, not from the length of
# the bytes the server still holds.


def _fresh_prompt(sid: str, text_: str, age: float = 30.0) -> bytes:
    stamp = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(time.time() - age))
    rec = {
        "type": "user",
        "uuid": str(uuid.uuid4()),
        "parentUuid": None,
        "sessionId": sid,
        "timestamp": stamp,
        "cwd": "/Users/dev/proj",
        "promptSource": "typed",
        "message": {"role": "user", "content": text_},
    }
    return (json.dumps(rec) + "\n").encode()


def test_a_heartbeat_after_retirement_keeps_the_offset(client, paired):
    user_id, headers = paired
    key = _mint(client, headers)["key"]
    sid = "dddddddd-0000-4000-8000-00000000hook"
    raw = _shifted()
    done = client.post(
        "/v1/ingest/transcript", content=raw, headers=_headers(key, sid, 0, "SessionEnd")
    )
    assert done.status_code == 200 and done.json()["next_offset"] == len(raw)
    assert _chunks(user_id, sid) == 0  # retired: only the zero-length marker is left

    beat = client.post(
        "/v1/ingest/transcript", content=b"", headers=_headers(key, sid, len(raw), "Stop")
    )
    assert beat.status_code == 200, beat.text
    # Dropping the marker here answered 0, and the watcher then resent the whole file on
    # every tick for as long as it ran.
    assert beat.json()["next_offset"] == len(raw)
    off = client.get(f"/v1/ingest/transcript/{sid}/offset", headers=_key_headers(key))
    assert off.json()["next_offset"] == len(raw)


def test_a_tail_after_retirement_continues_from_the_files_offset(client, paired):
    user_id, headers = paired
    key = _mint(client, headers)["key"]
    sid = "eeeeeeee-0000-4000-8000-00000000hook"
    raw = _shifted()
    client.post("/v1/ingest/transcript", content=raw, headers=_headers(key, sid, 0, "SessionEnd"))

    back = _fresh_prompt(sid, "back again")
    r = client.post(
        "/v1/ingest/transcript", content=back, headers=_headers(key, sid, len(raw), "Stop")
    )
    assert r.status_code == 200, r.text
    assert r.json()["next_offset"] == len(raw) + len(back), "not len(held bytes)"

    more = _fresh_prompt(sid, "and done", age=10)
    end = client.post(
        "/v1/ingest/transcript",
        content=more,
        headers=_headers(key, sid, len(raw) + len(back), "SessionEnd"),
    )
    assert end.status_code == 200, end.text
    total = len(raw) + len(back) + len(more)
    assert end.json()["next_offset"] == total
    # Retired again: the marker sits at the FILE's end, so the next tail is accepted where
    # the script will send it rather than refused as a gap.
    assert _chunks(user_id, sid) == 0
    off = client.get(f"/v1/ingest/transcript/{sid}/offset", headers=_key_headers(key))
    assert off.json()["next_offset"] == total


def test_retired_markers_never_crowd_out_a_stale_session(client, paired):
    """The stale re-cut takes five transcripts. Retired conversations keep a zero-length
    marker for their offset and have nothing to cut; counted among the five, older markers
    kept a session whose process died from ever finishing."""
    user_id, headers = paired
    key = _mint(client, headers)["key"]
    with db_session(viewer_id=user_id) as db:
        device_id = db.execute(
            text("SELECT id FROM devices WHERE user_id = :u LIMIT 1"), {"u": user_id}
        ).scalar()
    # Six retired markers, all older than the one real stale transcript, and that
    # transcript's last record old enough that the idle rule makes it final on a re-cut.
    stale_sid = "ffffffff-0000-4000-8000-00000000hook"
    stale_raw = _shifted(age_of_last_record_sec=7200)
    with owner_engine().begin() as c:
        for i in range(6):
            c.execute(
                text(
                    "INSERT INTO transcript_chunks (user_id, device_id, native_session_id, "
                    "project_dir, byte_offset, bytes, hook, received_at) VALUES "
                    "(:u, :d, :s, :p, 1000, '', 'retired', now() - interval '3 hours')"
                ),
                {"u": user_id, "d": device_id, "s": f"retired-{i}", "p": PROJECT_DIR},
            )
        c.execute(
            text(
                "INSERT INTO transcript_chunks (user_id, device_id, native_session_id, "
                "project_dir, byte_offset, bytes, hook, received_at) VALUES "
                "(:u, :d, :s, :p, 0, :b, 'Stop', now() - interval '2 hours')"
            ),
            {"u": user_id, "d": device_id, "s": stale_sid, "p": PROJECT_DIR, "b": stale_raw},
        )

    other = "abababab-0000-4000-8000-00000000hook"
    r = client.post(
        "/v1/ingest/transcript",
        content=_fresh_prompt(other, "hello"),
        headers=_headers(key, other, 0, "Stop"),
    )
    assert r.status_code == 200, r.text
    assert r.json()["recut_stale"] == 1
    # The dead session was cut, finished and retired.
    assert _chunks(user_id, stale_sid) == 0
    assert any(row.state == "final" for row in _rows(user_id))
