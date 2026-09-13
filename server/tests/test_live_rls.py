"""Row level security on the four v4 tables, AS builder_app: session_live and
privacy_prefs (0020), builder_quotes (0021), live_activity_tokens (0022).

Owner only, all four, and no public policy on any: a running session, a salt, a quoted
prompt and a Lock Screen's push token are nobody else's business, and sharing a session
shares a FINAL session.

THE NEGATIVE TEST LESSON (CLAUDE.md). Every "cannot write" test below resolves the
victim's ids through the OWNER engine first, never inside the restricted connection, where
the lookup itself would be filtered to nothing and the INSERT would pass for the wrong
reason. And each one runs the SAME statement for the viewer's own row first, in its own
transaction, and requires it to succeed: a statement that fails for everyone (a typo, a
missing grant, a NOT NULL) would otherwise pass as a policy doing its job. The failure is
also required to be the policy's own ("row-level security"), not any error.
"""

import json
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, ProgrammingError
from test_rls import app_engine, owner_engine
from test_sync import TEST_DB

pytestmark = pytest.mark.skipif(not TEST_DB, reason="set BUILDER_TEST_DB to run")

LIVE_BODY = json.dumps({"live_version": 1})


@pytest.fixture(scope="module")
def two_owners():
    """Two users, each with a device and a final session, created as the owner. Returns
    {"a": (user, session), "b": (user, session)}; nothing else exists for either yet."""
    eng = owner_engine()
    out = {}
    with eng.begin() as c:
        for who in ("a", "b"):
            uid = uuid.uuid4()
            c.execute(text("INSERT INTO users (id) VALUES (:i)"), {"i": uid})
            dev = c.execute(
                text(
                    "INSERT INTO devices (user_id, label, platform, agent_version, machine_id) "
                    "VALUES (:u, 'test', 'macos', '0.1', :m) RETURNING id"
                ),
                {"u": uid, "m": uid.hex * 2},
            ).scalar()
            sid = c.execute(
                text(
                    """
                    INSERT INTO sessions (
                      user_id, device_id, client_session_id, content_hash,
                      sessionizer_version, active_calc_version, harness,
                      started_at, ended_at, active_seconds, tz_offset_minutes,
                      local_date, local_hour, local_dow, timeline_fidelity, agent_observed_at
                    ) VALUES (
                      :u, :d, :c, :h, 1, 1, 'claude_code',
                      now() - interval '2 hours', now(), 3600, 0,
                      CURRENT_DATE, 12, 3, 'full', now()
                    ) RETURNING id
                    """
                ),
                {"u": uid, "d": dev, "c": uid.hex * 2, "h": "0" * 64},
            ).scalar()
            out[who] = (str(uid), str(sid))
    yield out
    with eng.begin() as c:
        c.execute(
            text("DELETE FROM users WHERE id = ANY(CAST(:ids AS uuid[]))"),
            {"ids": [u for u, _ in out.values()]},
        )


def _as(viewer: str | None):
    """A restricted connection with the viewer set for the whole connection (`is_local`
    false, so it outlives the commit that ends SQLAlchemy's autobegun transaction and each
    test can open its own)."""
    c = app_engine().connect()
    c.execute(text("SELECT set_config('app.viewer_id', :v, false)"), {"v": viewer or ""})
    c.commit()
    return c


def _count(viewer: str | None, sql: str, **params) -> int:
    with _as(viewer) as c:
        return c.execute(text(sql), params).scalar()


def _allowed(viewer: str, sql: str, **params) -> None:
    """The positive control: the statement succeeds for the viewer's own row. Rolled back,
    so the fixture's state does not move."""
    with _as(viewer) as c:
        tx = c.begin()
        c.execute(text(sql), params)
        tx.rollback()


def _refused(viewer: str, sql: str, **params) -> None:
    """The statement is refused BY THE POLICY for this viewer."""
    with _as(viewer) as c:
        tx = c.begin()
        with pytest.raises(ProgrammingError) as exc:
            c.execute(text(sql), params)
        tx.rollback()
    assert "row-level security" in str(exc.value), exc.value


def _as_owner(sql: str, **params) -> None:
    with owner_engine().begin() as c:
        c.execute(text(sql), params)


def test_the_restricted_role_is_really_restricted():
    with app_engine().connect() as c:
        row = c.execute(
            text(
                "SELECT current_setting('is_superuser') AS su, "
                "(SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS brls"
            )
        ).one()
    assert row.su == "off" and row.brls is False


# ------------------------------------------------------------------------ session_live

_INSERT_LIVE = (
    "INSERT INTO session_live (session_id, user_id, live_version, source, computed_at, body) "
    "VALUES (:sid, :uid, 1, 'capture', now(), CAST(:body AS jsonb))"
)


def test_another_viewer_cannot_read_a_live_state(two_owners):
    (a, sa), (b, _) = two_owners["a"], two_owners["b"]
    _as_owner(
        "INSERT INTO session_live "
        "(session_id, user_id, live_version, source, computed_at, body, names) "
        "VALUES (:s, :u, 1, 'hook', now(), CAST(:b AS jsonb), CAST(:n AS jsonb))",
        s=sa,
        u=a,
        b=LIVE_BODY,
        n=json.dumps({"files": [{"id": "0" * 16, "name": "auth.py"}]}),
    )
    try:
        sql = "SELECT count(*) FROM session_live WHERE session_id = :s"
        assert _count(a, sql, s=sa) == 1, "the owner must see their own row, or it is over-locked"
        assert _count(b, sql, s=sa) == 0
        assert _count(None, sql, s=sa) == 0
        # Even with the session SHARED: the public policy is on sessions, never here.
        _as_owner("UPDATE sessions SET is_shared = true, shared_at = now() WHERE id = :s", s=sa)
        assert _count(b, "SELECT count(*) FROM sessions WHERE id = :s", s=sa) == 1
        assert _count(b, sql, s=sa) == 0
        assert _count(None, sql, s=sa) == 0
    finally:
        _as_owner("UPDATE sessions SET is_shared = false, shared_at = NULL WHERE id = :s", s=sa)
        _as_owner("DELETE FROM session_live WHERE session_id = :s", s=sa)


def test_a_viewer_cannot_write_a_live_row_for_someone_elses_session(two_owners):
    """0008's shape: without the EXISTS, A could insert a row under B's session id (a
    primary key) and block B's own live state from ever being stored."""
    (a, sa), (b, sb) = two_owners["a"], two_owners["b"]
    _allowed(a, _INSERT_LIVE, sid=sa, uid=a, body=LIVE_BODY)
    # B's session id, as A, attributed to A: the EXISTS finds no session of A's.
    _refused(a, _INSERT_LIVE, sid=sb, uid=a, body=LIVE_BODY)
    # Attributed to B: refused on the owner column before the session is even looked at.
    _refused(a, _INSERT_LIVE, sid=sb, uid=b, body=LIVE_BODY)
    # B's session SHARED, so A can see it through sessions_public: the EXISTS now reads the
    # row, and still refuses, because it is not A's. This is the case where a predicate
    # reading another RLS table could fail open.
    _as_owner("UPDATE sessions SET is_shared = true, shared_at = now() WHERE id = :s", s=sb)
    try:
        assert _count(a, "SELECT count(*) FROM sessions WHERE id = :s", s=sb) == 1
        _refused(a, _INSERT_LIVE, sid=sb, uid=a, body=LIVE_BODY)
    finally:
        _as_owner("UPDATE sessions SET is_shared = false, shared_at = NULL WHERE id = :s", s=sb)
    with owner_engine().connect() as c:
        squatted = c.execute(
            text("SELECT count(*) FROM session_live WHERE session_id = :s"), {"s": sb}
        ).scalar()
    assert squatted == 0


def test_a_viewer_cannot_move_or_rewrite_anothers_live_row(two_owners):
    (a, sa), (b, sb) = two_owners["a"], two_owners["b"]
    _as_owner(_INSERT_LIVE, sid=sb, uid=b, body=LIVE_BODY)
    try:
        with _as(a) as c:
            tx = c.begin()
            n = c.execute(
                text("UPDATE session_live SET body = '{}'::jsonb WHERE session_id = :s"), {"s": sb}
            ).rowcount
            gone = c.execute(
                text("DELETE FROM session_live WHERE session_id = :s"), {"s": sb}
            ).rowcount
            tx.commit()
        assert (n, gone) == (0, 0)
        with owner_engine().connect() as c:
            body = c.execute(
                text("SELECT body FROM session_live WHERE session_id = :s"), {"s": sb}
            ).scalar()
        assert body == {"live_version": 1}
        # And the owner cannot hand their own row to someone else's session.
        _as_owner(_INSERT_LIVE, sid=sa, uid=a, body=LIVE_BODY)
        with _as(a) as c:
            tx = c.begin()
            with pytest.raises(ProgrammingError) as exc:
                c.execute(
                    text("UPDATE session_live SET user_id = :b WHERE session_id = :s"),
                    {"b": b, "s": sa},
                )
            tx.rollback()
        assert "row-level security" in str(exc.value)
    finally:
        _as_owner("DELETE FROM session_live WHERE session_id IN (:a, :b)", a=sa, b=sb)


# ----------------------------------------------------------------------- privacy_prefs


def test_privacy_prefs_are_owner_only(two_owners):
    (a, _), (b, _) = two_owners["a"], two_owners["b"]
    insert = "INSERT INTO privacy_prefs (user_id) VALUES (:u)"
    _allowed(b, insert, u=b)
    _refused(b, insert, u=a)

    _as_owner(insert, u=a)
    try:
        salt_sql = "SELECT count(*) FROM privacy_prefs WHERE user_id = :u"
        assert _count(a, salt_sql, u=a) == 1
        assert _count(b, salt_sql, u=a) == 0, "another viewer must never read the salt"
        assert _count(None, salt_sql, u=a) == 0
        with _as(b) as c:
            tx = c.begin()
            n = c.execute(
                text(
                    "UPDATE privacy_prefs SET live_names = true, quotes = true WHERE user_id = :u"
                ),
                {"u": a},
            ).rowcount
            tx.commit()
        assert n == 0
        with owner_engine().connect() as c:
            row = c.execute(
                text("SELECT live_names, quotes FROM privacy_prefs WHERE user_id = :u"), {"u": a}
            ).one()
        assert (row.live_names, row.quotes) == (False, False)
    finally:
        _as_owner("DELETE FROM privacy_prefs WHERE user_id IN (:a, :b)", a=a, b=b)


def test_a_salt_too_short_to_hide_a_path_cannot_be_stored(two_owners):
    a, _ = two_owners["a"]
    with owner_engine().connect() as c:
        tx = c.begin()
        with pytest.raises(IntegrityError):
            c.execute(
                text("INSERT INTO privacy_prefs (user_id, map_salt) VALUES (:u, 'short')"),
                {"u": a},
            )
        tx.rollback()


# ---------------------------------------------------------------------- builder_quotes

_INSERT_QUOTES = (
    "INSERT INTO builder_quotes (user_id, quotes_version, generated_at, body) "
    "VALUES (:u, 1, now(), CAST(:b AS jsonb))"
)
QUOTES_BODY = json.dumps(
    {"quotes_version": 1, "generated_at": "2026-09-13T08:00:00Z", "quotes": []}
)


def test_quotes_are_owner_only(two_owners):
    (a, _), (b, _) = two_owners["a"], two_owners["b"]
    _allowed(b, _INSERT_QUOTES, u=b, b=QUOTES_BODY)
    _refused(b, _INSERT_QUOTES, u=a, b=QUOTES_BODY)

    _as_owner(_INSERT_QUOTES, u=a, b=QUOTES_BODY)
    try:
        sql = "SELECT count(*) FROM builder_quotes WHERE user_id = :u"
        assert _count(a, sql, u=a) == 1
        assert _count(b, sql, u=a) == 0
        assert _count(None, "SELECT count(*) FROM builder_quotes") == 0
        with _as(b) as c:
            tx = c.begin()
            n = c.execute(text("DELETE FROM builder_quotes WHERE user_id = :u"), {"u": a}).rowcount
            tx.commit()
        assert n == 0
        assert _count(a, sql, u=a) == 1
    finally:
        _as_owner("DELETE FROM builder_quotes WHERE user_id = :u", u=a)


# ----------------------------------------------------------------- live_activity_tokens

_INSERT_TOKEN = (
    "INSERT INTO live_activity_tokens "
    "(user_id, kind, session_id, activity_id, token, environment, creature) "
    "VALUES (:u, :k, :s, :act, :tok, 'sandbox', 'owl')"
)


def test_live_activity_tokens_are_owner_only(two_owners):
    (a, sa), (b, sb) = two_owners["a"], two_owners["b"]
    tok = uuid.uuid4().hex
    _allowed(a, _INSERT_TOKEN, u=a, k="activity", s=sa, act="act-1", tok=tok)
    _allowed(a, _INSERT_TOKEN, u=a, k="push_to_start", s=None, act=None, tok=tok)
    # A token against B's session would receive B's Lock Screen updates.
    _refused(a, _INSERT_TOKEN, u=a, k="activity", s=sb, act="act-1", tok=tok)
    _refused(a, _INSERT_TOKEN, u=b, k="push_to_start", s=None, act=None, tok=tok)
    _as_owner("UPDATE sessions SET is_shared = true, shared_at = now() WHERE id = :s", s=sb)
    try:
        _refused(a, _INSERT_TOKEN, u=a, k="activity", s=sb, act="act-1", tok=tok)
    finally:
        _as_owner("UPDATE sessions SET is_shared = false, shared_at = NULL WHERE id = :s", s=sb)

    _as_owner(_INSERT_TOKEN, u=b, k="activity", s=sb, act="act-b", tok=tok)
    try:
        sql = "SELECT count(*) FROM live_activity_tokens WHERE user_id = :u"
        assert _count(b, sql, u=b) == 1
        assert _count(a, sql, u=b) == 0
        assert _count(None, "SELECT count(*) FROM live_activity_tokens") == 0
    finally:
        _as_owner("DELETE FROM live_activity_tokens WHERE user_id = :u", u=b)


@pytest.mark.parametrize(
    "kind,session,activity",
    [("activity", None, "act-1"), ("activity", "own", None), ("push_to_start", "own", None)],
)
def test_a_token_names_a_session_exactly_when_it_is_an_activity_token(
    two_owners, kind, session, activity
):
    a, sa = two_owners["a"]
    with owner_engine().connect() as c:
        tx = c.begin()
        with pytest.raises(IntegrityError) as exc:
            c.execute(
                text(_INSERT_TOKEN),
                {
                    "u": a,
                    "k": kind,
                    "s": sa if session == "own" else None,
                    "act": activity,
                    "tok": uuid.uuid4().hex,
                },
            )
        tx.rollback()
    assert "live_activity_tokens_kind_ck" in str(exc.value)
