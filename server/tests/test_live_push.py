"""ActivityKit pushes: the card the server draws, when it sends one, and how.

docs/overnight-integration.md 3.6. Two halves, tested the way each can fail:

  * THE CARD (`live_push.content_state`) is pure, so it is held to the Swift struct it must
    fill (read out of BuilderSessionAttributes.swift), to the phone's own constants (read
    out of surface.ts), and to the shared fixture the phone's half is pinned to. A card with
    a key the struct lacks is silently dropped by ActivityKit; a card computed by different
    rules on the two sides flickers between two truths every time a push lands.
  * THE DECISION (`live_push.plan`) runs through the real upload route, AS builder_app, with
    the APNs http2 client mocked (APNs cannot be reached from here): what was POSTed, to
    which host, with which headers, and what the token rows remember afterwards.
"""

import copy
import importlib.util
import json
import pathlib
import re
import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from sqlalchemy import text
from test_capture_keys import _key_headers, _mint
from test_contract import SAMPLE_LIVE, SAMPLE_LIVE_NAMES
from test_live_ingest import _post as _hook_post
from test_live_ingest import _working, needs_engine
from test_sync import (  # noqa: F401 - fixtures are picked up by name
    TEST_DB,
    _live,
    _owner_rows,
    _pair,
    _payload,
    _phone_for,
    _upload,
    app_env,
    client,
    created_users,
    owner_engine,
    paired,
)

from builder import live_push, notify
from builder.live_spec import ANALYSIS_ENUM_VALUES, LiveState

_SHARED_FIXTURES = (app_env, client, created_users, paired)

ROOT = pathlib.Path(__file__).resolve().parents[2]
SWIFT = ROOT / "mobile/modules/builder-live/ios/BuilderSessionAttributes.swift"
SURFACE = ROOT / "mobile/src/live/surface.ts"
FORMAT = ROOT / "mobile/src/live/format.ts"
#: Where a card's repository words live since private projects got their numbers.
REPO_LABEL = ROOT / "mobile/src/copy/repoLabel.ts"
FIXTURE = ROOT / "spec/fixtures/live/content_state.json"
GENERATOR = ROOT / "scripts/gen_live_fixtures.py"

needs_db = pytest.mark.skipif(not TEST_DB, reason="set BUILDER_TEST_DB to run")

TEAM_ID = "TEAM123456"
KEY_ID = "KEY9876543"
TOPIC = "com.vedantlbhatt.Builder"


def _fixture() -> dict:
    return json.loads(FIXTURE.read_text())


def _swift_content_state() -> list[tuple[str, str]]:
    """`(name, swift type)` for every `public var` of `ContentState`, in declaration order."""
    src = SWIFT.read_text()
    start = src.index("struct ContentState")
    block = src[start : src.index("public init(", start)]
    return re.findall(r"public var (\w+): ([\w?]+)", block)


# ================================================================== the card, pure


def test_content_state_keys_equal_the_swift_content_state():
    """ActivityKit decodes the push's `content-state` into this struct: a key it lacks is
    dropped without an error, and a key missing from the push fails the whole update."""
    swift = _swift_content_state()
    assert [n for n, _ in swift] == list(live_push.CONTENT_STATE_KEYS)
    for case in _fixture()["cases"]:
        assert list(case["content_state"]) == list(live_push.CONTENT_STATE_KEYS), case["name"]


def test_every_value_has_the_swift_type():
    """An Int that arrives as 3.0, or a String that arrives as null, fails Codable and the
    Lock Screen keeps showing the last card it could decode."""
    swift = dict(_swift_content_state())
    for case in _fixture()["cases"]:
        for key, value in case["content_state"].items():
            t = swift[key]
            if value is None:
                assert t.endswith("?"), (case["name"], key)
                continue
            base = t.rstrip("?")
            if base == "Int":
                assert isinstance(value, int) and not isinstance(value, bool), (case["name"], key)
            elif base == "Double":
                assert isinstance(value, int | float) and not isinstance(value, bool), key
            elif base == "String":
                assert isinstance(value, str), (case["name"], key)
            else:  # pragma: no cover - a type this test does not know is a new field
                raise AssertionError(f"ContentState.{key} is a {t}; teach this test about it")


def test_the_restated_enums_are_the_live_spec():
    """live_push restates three spec enums so it imports on a bare Python (CI's make gen);
    both ways against the generated table, so neither can grow alone."""
    assert list(live_push.PHASES) == ANALYSIS_ENUM_VALUES["phase"]
    assert list(live_push.TRAJECTORIES) == ANALYSIS_ENUM_VALUES["trajectory"]
    assert list(live_push.CREATURES) == ANALYSIS_ENUM_VALUES["creature"]


def test_the_constants_are_the_phones():
    """Every constant the two halves of one card must agree on, read out of the TypeScript."""
    surface, fmt = SURFACE.read_text(), FORMAT.read_text()

    def ts(name: str, src: str = surface) -> str:
        m = re.search(rf"(?:export )?const {name} = ([^;]+);", src)
        assert m, name
        return m.group(1).strip()

    assert int(ts("SENTENCE_MAX")) == live_push.SENTENCE_MAX
    assert ts("STALE_SECONDS") == "TEMPO_STALE_SECONDS"
    assert int(ts("TEMPO_STALE_SECONDS", fmt)) == live_push.STALE_SECONDS
    assert int(ts("DISMISS_AFTER_SECONDS")) == live_push.DISMISS_AFTER_SECONDS
    assert int(ts("RELEVANCE_NEEDS_YOU")) == live_push.RELEVANCE_NEEDS_YOU
    assert int(ts("RELEVANCE_DEFAULT")) == live_push.RELEVANCE_DEFAULT
    assert int(ts("RELEVANCE_DONE")) == live_push.RELEVANCE_DONE
    assert int(ts("PAYLOAD_LIMIT_BYTES")) == live_push.PAYLOAD_LIMIT_BYTES
    assert int(ts("REPO_MAX")) == live_push.REPO_MAX
    assert ts("PRIVATE_REPO", REPO_LABEL.read_text()) == f"'{live_push.PRIVATE_REPO}'"
    assert ts("BACKGROUND_REASON") == f"'{live_push.BACKGROUND_REASON}'"


def test_content_state_matches_the_shared_fixtures():
    """The fixture the phone's `toState` is held to is what this module computes, case for
    case, and every case's `live` block is one the door accepts (the pydantic check the
    stdlib generator cannot run)."""
    doc = _fixture()
    assert doc["keys"] == list(live_push.CONTENT_STATE_KEYS)
    assert len(doc["cases"]) >= 14
    for case in doc["cases"]:
        row, live, ctx = case["row"], case["live"], case["ctx"]
        now = ctx["nowMs"] / 1000
        if live is not None:
            LiveState(**live)
            assert case["sentence"] == live_push.render(live)
        state = live_push.content_state(
            row,
            row["stats"],
            live,
            creature=ctx["creature"],
            running_count=ctx["runningCount"],
            now=now,
        )
        assert state == case["content_state"], case["name"]
        phase = state["phase"]
        spoken = live_push.clamp_sentence(live_push.sentence_of(row, live, phase, now))
        assert case["spoken"] == spoken
        assert case["relevance"] == live_push.relevance_of(state, live)
        assert case["alert"] == (live_push.alert_for(row, spoken) if phase == "needsYou" else None)


def test_the_fixture_is_what_the_generator_writes():
    """`make check-gen` catches a stale fixture in CI; this catches it in the suite a person
    runs after changing the engine or this module."""
    spec = importlib.util.spec_from_file_location("gen_live_fixtures", GENERATOR)
    gen = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gen)
    assert gen.missing_inputs() == []
    assert gen.build() == _fixture()


def test_the_fixture_covers_every_phase_trajectory_and_refusal():
    cases = _fixture()["cases"]
    states = [c["content_state"] for c in cases]
    assert {s["phase"] for s in states} == set(live_push.PHASES)
    assert {s["trajectory"] for s in states} == set(live_push.TRAJECTORIES)
    reasons = {c["live"]["eta"]["reason"] for c in cases if c["live"]}
    assert {None, "no_history", "repo_unresolved", "too_few_survivors"} <= reasons
    assert any(s["progress"] >= 0 for s in states) and any(s["progress"] == -1 for s in states)
    assert any(s["sinceEpoch"] is not None for s in states)
    assert any(s["endedEpoch"] is not None for s in states)
    assert {c["variant"] for c in cases} == {"live", "names", "map_cut", "final"}


def test_the_card_never_speaks_a_duration_but_the_alert_does():
    """A Lock Screen is redrawn only when a push lands, so "for two minutes" would be wrong a
    minute later; the card says when it began (`sinceEpoch`). The alert is read once, at the
    moment it arrives, so it carries the minutes."""
    case = next(c for c in _fixture()["cases"] if c["name"] == "waiting_question")
    cs = case["content_state"]
    assert cs["phase"] == "needsYou" and cs["sentence"] == "Waiting on you"
    assert case["spoken"] == "Waiting on you for two minutes"
    assert case["alert"] == {
        "title": "A session needs you",
        "body": "Waiting on you for two minutes",
        "sound": "default",
    }
    stuck = next(
        c for c in _fixture()["cases"] if (c["name"], c["variant"]) == ("circling_failures", "live")
    )
    assert stuck["content_state"]["sentence"] == "Stuck on the same failing command"
    assert stuck["spoken"] == "Stuck on the same failing command for three minutes"
    for c in _fixture()["cases"]:
        assert "minute" not in c["content_state"]["sentence"], c["name"]


def test_the_clocks_anchor_on_computed_at_not_on_the_session_row():
    """A heartbeat re-cut refreshes the live row and leaves the session row alone, so an
    ETA anchored on `updated_at` ages by however long the transcript has been quiet."""
    case = next(c for c in _fixture()["cases"] if c["name"] == "waiting_question")
    row, live = case["row"], case["live"]
    now = case["ctx"]["nowMs"] / 1000
    base = live_push.content_state(
        row, row["stats"], live, creature="fox", running_count=0, now=now
    )
    older = {**row, "updated_at": "2026-08-01T00:00:00Z"}
    moved = live_push.content_state(
        older, row["stats"], live, creature="fox", running_count=0, now=now
    )
    assert (moved["etaEpoch"], moved["sinceEpoch"]) == (base["etaEpoch"], base["sinceEpoch"])
    later = {**live, "computed_at": "2026-09-01T09:12:50Z"}  # ten minutes after it was
    shifted = live_push.content_state(
        row, row["stats"], later, creature="fox", running_count=0, now=now
    )
    assert shifted["sinceEpoch"] == base["sinceEpoch"] + 600
    assert shifted["etaEpoch"] == base["etaEpoch"] + 600


def test_a_cut_map_is_refused_not_counted():
    """The slim list body keeps one or two map rows; counting edits over them is a plausible
    wrong number ("1 file changed" of fourteen). -1 is the card's "not counted"."""
    full = next(
        c for c in _fixture()["cases"] if (c["name"], c["variant"]) == ("converging", "live")
    )
    cut = next(c for c in _fixture()["cases"] if c["variant"] == "map_cut")
    assert full["content_state"]["filesChanged"] == 2
    assert cut["live"]["map"]["files_total"] > len(cut["live"]["map"]["files"])
    assert cut["content_state"]["filesChanged"] == -1
    no_map = {**full["live"], "map": None}
    assert live_push.files_changed_of(no_map) == -1
    odd = copy.deepcopy(full["live"])
    odd["map"]["files"][0]["edits"] = None
    assert live_push.files_changed_of(odd) == -1


def test_names_never_reach_the_card():
    """The card renders `names=False` whatever it is handed: the local state's `names`, the
    row's opt in `live_names`, or both."""
    case = next(c for c in _fixture()["cases"] if c["variant"] == "names")
    assert case["row"]["live_names"]["files"], "the case must carry names to prove anything"
    basenames = {f["name"] for f in case["row"]["live_names"]["files"]}
    live = copy.deepcopy(case["live"])
    live["names"] = {"files": {f["id"]: f["name"] for f in case["row"]["live_names"]["files"]}}
    now = case["ctx"]["nowMs"] / 1000
    state = live_push.content_state(
        case["row"], case["row"]["stats"], live, creature="cat", running_count=0, now=now
    )
    blob = json.dumps(state) + live_push.sentence_of(case["row"], live, state["phase"], now)
    for name in basenames:
        assert name not in blob
    assert state["sentence"] == "Going back and forth on a source file, fourth pass"


def test_math_round_is_javascripts():
    """The phone rounds with `Math.round` (halves up); Python's `round` goes to even, which
    would move an ETA by a minute on every exact half."""
    cases = {0.5: 1, 1.5: 2, 2.5: 3, -0.5: 0, -1.5: -1, 0.49999999999999994: 0, 7.4: 7, 7.6: 8}
    for x, want in cases.items():
        assert live_push.js_round(x) == want, x


def test_a_running_row_without_a_state_has_no_card():
    """The phone draws one from its presence line; the server never pushes a card it did
    not compute."""
    with pytest.raises(live_push.NoLiveState):
        live_push.content_state(
            {"state": "live"}, None, None, creature="owl", running_count=0, now=0
        )
    final = live_push.content_state(
        {"state": "final", "ended_at": "2026-09-01T10:00:00.400Z"},
        {"lines_added_agent": 12, "lines_removed_agent": None, "commit_count": 1},
        None,
        creature="dragon",
        running_count=4,
        now=1788256800.6,
    )
    assert final == {
        "phase": "done",
        "sentence": "Finished",
        "progress": -1.0,
        "filesChanged": -1,
        "etaEpoch": None,
        "sinceEpoch": None,
        "endedEpoch": 1788256800,
        "trajectory": "none",
        "creature": "bit",
        "linesAdded": 12,
        "linesRemoved": None,
        "commits": 1,
        "runningCount": 4,
        "updatedEpoch": 1788256801,
    }


def test_the_payloads_carry_what_activitykit_reads_and_fit_its_budget():
    for case in _fixture()["cases"]:
        state = case["content_state"]
        now = case["ctx"]["nowMs"] / 1000
        up = live_push.update_payload(
            state, now=now, relevance=case["relevance"], alert=case["alert"]
        )
        aps = up["aps"]
        assert aps["event"] == "update" and aps["content-state"] == state
        assert aps["stale-date"] == aps["timestamp"] + live_push.STALE_SECONDS
        assert ("alert" in aps) == (case["alert"] is not None)
        end = live_push.end_payload(state, now=now, dismissal_date=1)["aps"]
        assert end["event"] == "end" and end["dismissal-date"] == 1 and "alert" not in end
        for body in (up, {"aps": end}):
            size = len(json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode())
            assert size < live_push.PAYLOAD_LIMIT_BYTES


def test_notify_grows_a_needs_you_kind_that_opens_the_session():
    sid = str(uuid.uuid4())
    data = notify.push_data(sid, kind=notify.KIND_NEEDS_YOU)
    assert data == {"kind": "needs_you", "session_id": sid, "url": f"builder://session/{sid}"}
    # The finish kinds are unchanged.
    assert notify.push_data(sid, unattended=True)["kind"] == "agent_run_finished"
    assert notify.push_data(sid, unattended=False)["url"] == notify.recap_url(sid)
    assert notify.compose_needs_you(None, "Waiting on you for two minutes") == (
        "A session needs you",
        "Waiting on you for two minutes",
    )
    assert notify.compose_needs_you("gt-transit", "") == ("gt-transit needs you", "Waiting on you")
    assert notify.needs_you_collapse_id(sid) == f"needs-you-{sid}"
    # The phone's own words for the same banner, read out of its source.
    local = (ROOT / "mobile/src/push/localCopy.ts").read_text()
    assert "export const KIND_NEEDS_YOU = 'needs_you';" in local
    # The one title (`notify.needs_you_title`), the same rule in the phone's words.
    title = "repoName != null ? `${repoName.slice(0, TITLE_REPO_MAX)} needs you`"
    assert f"{title} : 'A session needs you'" in local
    assert "export const TITLE_REPO_MAX = 60;" in local
    assert notify.NEEDS_YOU_REPO_MAX == live_push.REPO_MAX == 60
    assert "`needs-you-${s.id}`.slice(0, 63)" in local
    assert notify.is_news(notify.NOTIFY_HORIZON_SEC) and not notify.is_news(
        notify.NOTIFY_HORIZON_SEC + 1
    )


def test_the_topic_is_the_bundle_push_type_liveactivity(monkeypatch):
    from builder.routes import push
    from builder.settings import settings

    monkeypatch.setenv("APNS_TOPIC", TOPIC)
    monkeypatch.setattr(push, "_apns_jwt", lambda: "jwt")
    settings.cache_clear()
    try:
        assert push.liveactivity_topic() == "com.vedantlbhatt.Builder.push-type.liveactivity"
        h = push.live_activity_headers(priority=10, expiration=1788253800)
        assert h == {
            "authorization": "bearer jwt",
            "apns-push-type": "liveactivity",
            "apns-topic": "com.vedantlbhatt.Builder.push-type.liveactivity",
            "apns-priority": "10",
            "apns-expiration": "1788253800",
        }
        assert push.live_activity_headers(priority=5, expiration=None)["apns-priority"] == "5"
        with pytest.raises(ValueError):
            push.live_activity_headers(priority=7, expiration=None)
    finally:
        settings.cache_clear()


def test_no_apns_key_sends_nothing(monkeypatch):
    from builder.routes import push
    from builder.settings import settings

    def refuse(**kw):  # the http2 client: never constructed without a key
        raise AssertionError("an APNs client was opened with no key configured")

    monkeypatch.setenv("APNS_PRIVATE_KEY", "")
    monkeypatch.setattr(push.httpx, "Client", refuse)
    settings.cache_clear()
    try:
        target = live_push.Target(str(uuid.uuid4()), str(uuid.uuid4()), "ab" * 40, "sandbox")
        assert push.send_live_activity(target, {"aps": {}}, priority=5) is False
        assert push.send_needs_you(str(uuid.uuid4()), "t", "b", str(uuid.uuid4())) == 0
        live_push.send_after_commit(
            [
                live_push.LivePush(
                    kind=live_push.KIND_ACTIVITY,
                    user_id=target.user_id,
                    session_id=str(uuid.uuid4()),
                    priority=5,
                    event="update",
                    target=target,
                    payload={"aps": {}},
                )
            ]
        )
    finally:
        settings.cache_clear()


# ================================================================== the decision, as builder_app


class _Resp:
    def __init__(self, status: int, reason: str) -> None:
        self.status_code = status
        self._reason = reason

    def json(self) -> dict:
        return {"reason": self._reason} if self._reason else {}


class _APNs:
    """The http2 client, mocked: every POST recorded, answered from `answers` (200 when it
    runs out). APNs itself cannot be reached from a test."""

    def __init__(self) -> None:
        self.posts: list[dict] = []
        self.answers: list[tuple[int, str]] = []
        self.public_key = None

    def client(self):
        apns = self

        class _Client:
            def __init__(self, **kw) -> None:
                assert kw.get("http2") is True, "APNs requires HTTP/2"

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def post(self, url, *, content, headers):
                apns.posts.append(
                    {"url": url, "headers": dict(headers), "body": json.loads(content)}
                )
                status, reason = apns.answers.pop(0) if apns.answers else (200, "")
                return _Resp(status, reason)

        return _Client

    def live(self) -> list[dict]:
        return [p for p in self.posts if p["headers"].get("apns-push-type") == "liveactivity"]

    def banners(self) -> list[dict]:
        return [p for p in self.posts if p["headers"].get("apns-push-type") == "alert"]


@pytest.fixture
def apns(app_env, monkeypatch):
    """A real ES256 key (so the JWT is really signed) and the mocked http2 client."""
    from builder.routes import push
    from builder.settings import settings

    key = ec.generate_private_key(ec.SECP256R1())
    pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    monkeypatch.setenv("APNS_PRIVATE_KEY", pem)
    monkeypatch.setenv("APNS_KEY_ID", KEY_ID)
    monkeypatch.setenv("APNS_TEAM_ID", TEAM_ID)
    monkeypatch.setenv("APNS_TOPIC", TOPIC)
    settings.cache_clear()
    push._token_cache.clear()
    fake = _APNs()
    fake.public_key = key.public_key()
    monkeypatch.setattr(push.httpx, "Client", fake.client())
    yield fake
    push._token_cache.clear()
    settings.cache_clear()


def _now() -> datetime:
    return datetime.now(UTC).replace(microsecond=0)


def _iso(d: datetime) -> str:
    return d.isoformat().replace("+00:00", "Z")


def _state(kind: str = "editing", **v) -> dict:
    """A live state as a machine would upload it, computed just now (so an entry into needs
    you is news), with the verdict and needs you block `v` names."""
    d = copy.deepcopy(SAMPLE_LIVE)
    d["computed_at"] = _iso(v.pop("computed_at", None) or _now())
    d["activity"]["kind"] = kind
    d["activity"]["since_s"] = v.pop("since_s", 30)
    d["verdict"].update(v.pop("verdict", {"state": "starting", "basis": "segment_tool_calls"}))
    d["verdict"]["evidence"]["stuck_s"] = 0
    d["needs_you"] = v.pop("needs_you", {"score": 5, "reason": "running_fine"})
    assert not v, v
    return d


WORKING = {}
CIRCLING = {
    "verdict": {"state": "circling", "basis": "causes:file_churn_with_failures"},
    "needs_you": {"score": 64, "reason": "circling"},
}
WAITING = {
    "since_s": 120,
    "verdict": {"state": "waiting", "basis": "turn_ended"},
    "needs_you": {"score": 82, "reason": "waiting_for_input"},
}
#: A turn the engine called done: the wait that follows it, with work landed cleanly.
DONE = {
    "since_s": 60,
    "verdict": {"state": "done", "basis": "turn_ended"},
    "needs_you": {"score": 30, "reason": "finished_unreviewed"},
}


class _Sitting:
    """One running session, uploaded again and again under one id and one content hash, as
    heartbeats of an unchanged transcript are: only its live state moves.

    Each sitting has a repository of its own. `repos` rows are global and keep the first
    public name any upload gave them (test_notifications names `d * 64` "gt-transit"), so a
    shared hash would make "private repo" depend on which file ran first."""

    def __init__(self, client, headers, uid: str, **overrides) -> None:
        self.client, self.headers, self.uid = client, headers, uid
        self.csid = uuid.uuid4().hex * 2
        self.hash = uuid.uuid4().hex * 2
        self.started = _now() - timedelta(minutes=25)
        self.overrides = {"repo_hash": uuid.uuid4().hex * 2, **overrides}
        self.id: str | None = None

    def _send(self, **fields) -> dict:
        p = _live(
            self.started,
            20,
            client_session_id=self.csid,
            content_hash=self.hash,
            **self.overrides,
            **fields,
        )
        out = _upload(self.client, self.headers, p)
        assert out["accepted"] + out["unchanged"] == 1, out
        if self.id is None:
            self.id = str(
                next(r.id for r in _owner_rows(self.uid) if r.client_session_id == self.csid)
            )
        return out

    def send(self, kind: str = "editing", *, live_names: dict | None = None, **v) -> dict:
        extra = {"live_names": live_names} if live_names is not None else {}
        return self._send(live=_state(kind, **dict(v)), **extra)

    def send_bare(self) -> dict:
        """As the Mac app sends a running session: no live block at all."""
        return self._send()

    def waiting(self, **v) -> dict:
        return self.send("waiting_on_you", **{**copy.deepcopy(WAITING), **v})

    def finish(self) -> dict:
        p = _payload(
            client_session_id=self.csid,
            started_at=self.started,
            ended_at=self.started + timedelta(hours=1),
            **self.overrides,
        )
        out = _upload(self.client, self.headers, p)
        assert out["accepted"] == 1, out
        return out


def _register(
    client,
    headers,
    session_id: str,
    *,
    token: str | None = None,
    activity: str | None = None,
    creature: str = "owl",
):
    token = token or uuid.uuid4().hex * 2
    r = client.post(
        "/v1/push/live-activity",
        json={
            "kind": "activity",
            "session_id": session_id,
            "activity_id": activity or str(uuid.uuid4()).upper(),
            "token": token,
            "environment": "sandbox",
            "creature": creature,
        },
        headers=headers,
    )
    assert r.status_code == 200, r.text
    return token


def _tokens(uid: str) -> list:
    with owner_engine().connect() as c:
        return c.execute(
            text(
                "SELECT id, kind, session_id, activity_id, token, environment, creature, "
                "last_phase, last_trajectory, last_pushed_at "
                "FROM live_activity_tokens WHERE user_id = :u ORDER BY created_at"
            ),
            {"u": uid},
        ).all()


def _alerted(session_id: str):
    with owner_engine().connect() as c:
        return c.execute(
            text("SELECT alerted_phase FROM session_live WHERE session_id = :s"), {"s": session_id}
        ).scalar()


# ---------------------------------------------------------------------- registration


@needs_db
def test_registering_a_token_starts_from_the_card_the_phone_shows(client, paired, apns):
    uid, headers = paired
    s = _Sitting(client, headers, uid)
    s.send(**CIRCLING)
    token = _register(client, headers, s.id, token=("AB" * 40), creature="fox")
    (row,) = _tokens(uid)
    assert row.token == "ab" * 40, "one token, one spelling"
    assert (row.kind, str(row.session_id), row.creature) == ("activity", s.id, "fox")
    assert (row.last_phase, row.last_trajectory) == ("working", "circling")
    assert apns.posts == [], "registering is not a change: nothing is pushed"
    # The same token again is one row; a new token for the same activity replaces it.
    activity = row.activity_id
    _register(client, headers, s.id, token=token, activity=activity, creature="fox")
    assert len(_tokens(uid)) == 1
    _register(client, headers, s.id, token="cd" * 40, activity=activity)
    assert [t.token for t in _tokens(uid)] == ["cd" * 40]
    # Forgetting it: 204, and 204 again for one that is already gone.
    assert client.delete(f"/v1/push/live-activity/{activity}", headers=headers).status_code == 204
    assert _tokens(uid) == []
    assert client.delete(f"/v1/push/live-activity/{activity}", headers=headers).status_code == 204


@needs_db
def test_a_token_is_refused_unless_its_shape_and_session_are_right(client, created_users):
    uid, headers = _pair(client, created_users)
    other, other_headers = _pair(client, created_users)
    mine = _Sitting(client, headers, uid)
    mine.send()
    theirs = _Sitting(client, other_headers, other)
    theirs.send()
    good = {
        "kind": "activity",
        "session_id": mine.id,
        "activity_id": str(uuid.uuid4()),
        "token": "ab" * 40,
        "environment": "sandbox",
        "creature": "owl",
    }

    def post(body, h=headers):
        return client.post("/v1/push/live-activity", json=body, headers=h)

    for bad in (
        {**good, "session_id": None},
        {**good, "activity_id": None},
        {**good, "kind": "push_to_start"},
        {**good, "creature": "dragon"},
        {**good, "environment": "staging"},
        {**good, "token": "not hex at all"},
        {**good, "activity_id": "a/b"},
        {**good, "extra": 1},
    ):
        assert post(bad).status_code == 422, bad
    # Someone else's session: not found, and nothing stored for either of them.
    assert post({**good, "session_id": theirs.id}).status_code == 404
    # A capture key uploads; it never registers a phone's token.
    key = _mint(client, headers)["key"]
    assert post(good, _key_headers(key)).status_code == 401
    # A finished session has nothing to update.
    mine.finish()
    r = post(good)
    assert r.status_code == 409 and "finished" in r.json()["reason"]
    assert _tokens(uid) == [] and _tokens(other) == []
    # Push to start names neither a session nor an activity.
    r = post(
        {
            "kind": "push_to_start",
            "token": "ef" * 40,
            "environment": "production",
            "creature": "bee",
        }
    )
    assert r.status_code == 200, r.text
    (row,) = _tokens(uid)
    assert (row.kind, row.session_id, row.activity_id) == ("push_to_start", None, None)


# ---------------------------------------------------------------------- pushes


@needs_db
def test_a_push_goes_out_only_on_a_phase_or_trajectory_change(client, paired, apns):
    uid, headers = paired
    s = _Sitting(client, headers, uid)
    s.send()
    _register(client, headers, s.id)  # starts from (working, none)

    s.send(since_s=90)  # the clock moved, the card did not
    assert apns.posts == []
    s.send(**CIRCLING)
    s.send(**{**CIRCLING, "since_s": 400})
    assert len(apns.live()) == 1
    s.send("idle", since_s=240)  # stalled
    s.send("idle", since_s=300)
    assert len(apns.live()) == 2
    phases = [p["body"]["aps"]["content-state"]["phase"] for p in apns.live()]
    trajectories = [p["body"]["aps"]["content-state"]["trajectory"] for p in apns.live()]
    assert phases == ["working", "stalled"] and trajectories == ["circling", "none"]
    (row,) = _tokens(uid)
    assert (row.last_phase, row.last_trajectory) == ("stalled", "none")
    assert row.last_pushed_at is not None


@needs_db
def test_needs_you_is_priority_10_with_an_alert_and_everything_else_5(client, paired, apns):
    uid, headers = paired
    s = _Sitting(client, headers, uid)
    s.send()
    _register(client, headers, s.id)

    s.waiting()
    s.send()
    s.waiting()  # a second entry is news again
    s.send()
    s.waiting(computed_at=_now() - timedelta(minutes=40))  # an entry from long ago is not
    pushes = apns.live()
    assert [p["headers"]["apns-priority"] for p in pushes] == ["10", "5", "10", "5", "5"]
    alerts = [p["body"]["aps"].get("alert") for p in pushes]
    assert (
        alerts[0]
        == alerts[2]
        == {
            "title": "A session needs you",
            "body": "Waiting on you for two minutes",
            "sound": "default",
        }
    )
    assert alerts[1] is alerts[3] is alerts[4] is None
    first = pushes[0]["body"]["aps"]
    assert first["content-state"]["sentence"] == "Waiting on you"  # the card: no duration
    assert first["relevance-score"] == 100
    assert pushes[1]["body"]["aps"]["relevance-score"] == 5
    assert apns.banners() == [], "never both: the activity said it"


@needs_db
def test_the_topic_headers_and_jwt_are_what_apns_requires(client, paired, apns):
    uid, headers = paired
    s = _Sitting(client, headers, uid)
    s.send()
    token = _register(client, headers, s.id)
    s.send(**CIRCLING)
    (p,) = apns.live()
    assert p["url"] == f"https://api.sandbox.push.apple.com/3/device/{token}"
    h = p["headers"]
    assert h["apns-topic"] == f"{TOPIC}.push-type.liveactivity"
    assert h["apns-push-type"] == "liveactivity" and h["apns-priority"] == "5"
    assert h["apns-expiration"] == str(p["body"]["aps"]["stale-date"])
    scheme, bearer = h["authorization"].split(" ", 1)
    assert scheme == "bearer"
    assert jwt.get_unverified_header(bearer)["kid"] == KEY_ID
    claims = jwt.decode(bearer, apns.public_key, algorithms=["ES256"])
    assert claims["iss"] == TEAM_ID
    aps = p["body"]["aps"]
    assert set(aps) == {"timestamp", "event", "content-state", "stale-date", "relevance-score"}
    assert aps["stale-date"] - aps["timestamp"] == live_push.STALE_SECONDS
    assert list(aps["content-state"]) == list(live_push.CONTENT_STATE_KEYS)
    assert aps["content-state"]["creature"] == "owl"
    # The session row's counts, not the map's: 200 lines added, 10 removed, 2 commits.
    cs = aps["content-state"]
    assert (cs["linesAdded"], cs["linesRemoved"], cs["commits"]) == (200, 10, 2)


@needs_db
def test_final_sends_end_with_a_dismissal_date_and_forgets_the_token(client, paired, apns):
    uid, headers = paired
    s = _Sitting(client, headers, uid)
    s.send()
    token = _register(client, headers, s.id, creature="whale")
    s.finish()
    (p,) = apns.live()
    assert p["url"].endswith(f"/3/device/{token}")
    aps = p["body"]["aps"]
    assert aps["event"] == "end"
    assert aps["dismissal-date"] == aps["timestamp"] + live_push.DISMISS_AFTER_SECONDS
    assert aps["relevance-score"] == 0 and "alert" not in aps
    cs = aps["content-state"]
    assert (cs["phase"], cs["sentence"], cs["trajectory"], cs["creature"]) == (
        "done",
        "Finished",
        "none",
        "whale",
    )
    ended = int((s.started + timedelta(hours=1)).timestamp())
    assert cs["endedEpoch"] == ended and cs["etaEpoch"] is None and cs["runningCount"] == 0
    assert p["headers"]["apns-priority"] == "5"
    assert (
        int(p["headers"]["apns-expiration"]) == aps["timestamp"] + live_push.END_EXPIRATION_SECONDS
    )
    assert _tokens(uid) == [], "the card has ended: nothing may push to it again"


@needs_db
def test_a_turn_the_engine_called_done_ends_the_card_as_finished_never_needs_you(
    client, paired, apns
):
    """The owner, 2026-09-13: a finished session waiting to be looked at is FINISHED, not needs
    you. The engine only calls a turn done while the activity is the wait that followed it, and
    `phase_of` read that wait first, so this sent "private repo needs you" at priority 10 for a
    session that had finished. It is the phone's rule too (`surface.planSync` ends the card on
    the same phase), and the card keeps the creature its token carries: its session's own."""
    uid, headers = paired
    s = _Sitting(client, headers, uid)
    s.send()
    _register(client, headers, s.id, creature="whale")
    s.send("waiting_on_you", **copy.deepcopy(DONE))
    (p,) = apns.live()
    aps = p["body"]["aps"]
    assert aps["event"] == "end" and "alert" not in aps
    assert aps["dismissal-date"] == aps["timestamp"] + live_push.DISMISS_AFTER_SECONDS
    cs = aps["content-state"]
    assert (cs["phase"], cs["creature"], cs["etaEpoch"]) == ("done", "whale", None)
    assert cs["sentence"].startswith("Finished"), cs["sentence"]
    assert cs["sinceEpoch"] is not None, "the card counts how long it ran to the turn's end"
    assert p["headers"]["apns-priority"] == "5"
    assert apns.banners() == [], "no needs you banner for a turn that finished"
    assert _tokens(uid) == [], "the card has ended: nothing may push to it again"
    assert _alerted(s.id) is None


@needs_db
def test_a_finished_card_is_taken_down_at_once_while_another_session_runs(client, paired, apns):
    uid, headers = paired
    s = _Sitting(client, headers, uid)
    s.send()
    _register(client, headers, s.id)
    _Sitting(client, headers, uid).send()  # still running, no card of its own
    s.finish()
    (p,) = apns.live()
    aps = p["body"]["aps"]
    assert aps["event"] == "end" and aps["dismissal-date"] == aps["timestamp"]


@needs_db
def test_every_card_counts_the_sessions_running_without_one(client, paired, apns):
    uid, headers = paired
    a, b, c = (_Sitting(client, headers, uid) for _ in range(3))
    for s in (a, b, c):
        s.send()
    _register(client, headers, a.id)
    _register(client, headers, c.id)
    a.send(**CIRCLING)
    (p,) = apns.live()
    assert p["body"]["aps"]["content-state"]["runningCount"] == 1  # b alone has no card


@needs_db
def test_names_never_reach_a_push(client, paired, apns):
    uid, headers = paired
    # The phone's switch, from the phone (0024: a paired machine's token is refused).
    r = client.put("/v1/privacy/prefs", json={"live_names": True}, headers=_phone_for(headers))
    assert r.status_code == 200, r.text
    s = _Sitting(client, headers, uid)
    s.send(live_names=SAMPLE_LIVE_NAMES)
    client.post("/v1/push/register", json={"token": "fe" * 32}, headers=headers)
    _register(client, headers, s.id)
    s.send(live_names=SAMPLE_LIVE_NAMES, **copy.deepcopy(CIRCLING))
    s.send("waiting_on_you", live_names=SAMPLE_LIVE_NAMES, **copy.deepcopy(WAITING))
    assert len(apns.live()) == 2
    assert apns.live()[1]["body"]["aps"]["alert"]["body"] == "Waiting on you for two minutes"
    everything = json.dumps(apns.posts)
    assert "auth.py" not in everything
    with owner_engine().connect() as c:
        stored = c.execute(
            text("SELECT names FROM session_live WHERE session_id = :s"), {"s": s.id}
        ).scalar()
    assert stored == SAMPLE_LIVE_NAMES, "the names were there to leak, and did not"


@needs_db
def test_no_apns_key_sends_nothing_but_still_decides(client, paired, monkeypatch):
    from builder.routes import push
    from builder.settings import settings

    posts: list = []

    class _Client:
        def __init__(self, **kw):
            posts.append(kw)

    monkeypatch.setenv("APNS_PRIVATE_KEY", "")
    monkeypatch.setattr(push.httpx, "Client", _Client)
    settings.cache_clear()
    uid, headers = paired
    s = _Sitting(client, headers, uid)
    s.send()
    _register(client, headers, s.id)
    s.waiting()
    assert posts == []
    (row,) = _tokens(uid)
    assert row.last_phase == "needsYou", "the decision is recorded; only the send is skipped"


@needs_db
def test_needs_you_banner_only_without_an_activity_and_only_once(client, paired, apns):
    uid, headers = paired
    r = client.post("/v1/push/register", json={"token": "fe" * 32}, headers=headers)
    assert r.status_code == 200
    lone = _Sitting(client, headers, uid)
    lone.send()
    lone.waiting()
    lone.waiting(since_s=240)  # still the same wait
    (banner,) = apns.banners()
    assert banner["headers"]["apns-collapse-id"] == f"needs-you-{lone.id}"
    assert banner["headers"]["apns-topic"] == TOPIC
    body = banner["body"]
    assert body["aps"]["alert"] == {
        "title": "A session needs you",
        "body": "Waiting on you for two minutes",
    }
    assert body["data"] == {
        "kind": "needs_you",
        "session_id": lone.id,
        "url": f"builder://session/{lone.id}",
    }
    assert _alerted(lone.id) == "needsYou"
    # Out of it and back in: news again.
    lone.send()
    assert _alerted(lone.id) is None
    lone.waiting()
    assert len(apns.banners()) == 2

    # A session WITH an activity: the activity alerts, and no banner is sent for it.
    carded = _Sitting(client, headers, uid)
    carded.send()
    _register(client, headers, carded.id)
    carded.waiting()
    assert len(apns.banners()) == 2
    assert apns.live()[-1]["body"]["aps"]["alert"]["title"] == "A session needs you"
    # Its activity ends while it still needs you: that entry was already said, once.
    act = _tokens(uid)[0].activity_id
    client.delete(f"/v1/push/live-activity/{act}", headers=headers)
    carded.waiting(since_s=300)
    assert len(apns.banners()) == 2

    # An entry from long ago is recorded and never announced, even on a later upload.
    old = _Sitting(client, headers, uid)
    old.send()
    old.waiting(computed_at=_now() - timedelta(hours=2))
    old.waiting(computed_at=_now() - timedelta(hours=2), since_s=200)
    assert len(apns.banners()) == 2
    assert _alerted(old.id) == "needsYou"


@needs_db
def test_the_needs_you_banner_names_a_public_repo(client, paired, apns):
    uid, headers = paired
    client.post("/v1/push/register", json={"token": "fe" * 32}, headers=headers)
    s = _Sitting(client, headers, uid, repo_name="gt-transit")
    s.send()
    s.waiting()
    (banner,) = apns.banners()
    assert banner["body"]["aps"]["alert"]["title"] == "gt-transit needs you"


@needs_db
def test_a_card_whose_session_finished_without_a_live_row_still_gets_its_end(client, paired, apns):
    """A live row the Mac app sent (no live block) has no session_live row to delete, so its
    final changes no live row. The move from live to final is itself what `plan` hears
    (`routes/sync._went_final`), so the card ends on the same upload, and only once."""
    uid, headers = paired
    mac = _Sitting(client, headers, uid)
    mac.send_bare()
    _register(client, headers, mac.id)
    assert _tokens(uid)[0].last_phase is None, "no state to start from"
    mac.finish()
    (end,) = apns.live()
    assert end["body"]["aps"]["event"] == "end"
    assert end["body"]["aps"]["content-state"]["phase"] == "done"
    assert _tokens(uid) == []
    other = _Sitting(client, headers, uid)
    other.send()
    assert len(apns.live()) == 1, "the end is sent once, not again on the next live change"


@needs_db
def test_a_bad_device_token_tries_the_other_host_then_is_forgotten(client, paired, apns):
    from builder.routes import push

    uid, headers = paired
    s = _Sitting(client, headers, uid)
    s.send()
    _register(client, headers, s.id)
    (row,) = _tokens(uid)
    target = live_push.Target(str(row.id), uid, row.token, row.environment)
    body = {"aps": {"event": "update"}}

    apns.answers = [(400, "BadDeviceToken"), (200, "")]
    assert push.send_live_activity(target, body, priority=5) is True
    assert [p["url"].split("/3/")[0] for p in apns.posts] == [
        "https://api.sandbox.push.apple.com",
        "https://api.push.apple.com",
    ]
    assert _tokens(uid)[0].environment == "production", "the host that took it is remembered"

    apns.answers = [(429, "TooManyRequests")]
    assert push.send_live_activity(target, body, priority=5) is False
    assert len(apns.posts) == 3 and len(_tokens(uid)) == 1, "throttled is not gone"

    apns.answers = [(410, "Unregistered"), (400, "BadDeviceToken")]
    assert push.send_live_activity(target, body, priority=5) is False
    assert _tokens(uid) == []


@needs_db
@needs_engine
def test_a_hook_tail_that_hands_the_turn_back_alerts_the_lock_screen(
    client, paired, apns, monkeypatch
):
    """The primary producer (3.1): the server computes the state from the hook's own bytes,
    and the move into needs you reaches the card with an alert, from the same upload."""
    from builder.routes import ingest

    uid, headers = paired
    key = _mint(client, headers)["key"]
    sid = str(uuid.uuid4())
    t0 = datetime.now(UTC).timestamp()
    transcript = _working(sid)
    raw = transcript.raw(age=20, now=t0)
    monkeypatch.setattr(ingest, "_clock", lambda: t0)
    _hook_post(client, key, sid, raw)
    session_id = str(_owner_rows(uid)[0].id)
    _register(client, headers, session_id)
    assert _tokens(uid)[0].last_phase == "working"

    # The agent answers and hands the turn back with a question, a minute later. Same
    # clock base, so the bytes already sent are a prefix of the file.
    transcript.say(50, "m6", "Tests pass. Should I also update the docs?")
    more = transcript.raw(age=70, now=t0 + 60)
    assert more.startswith(raw)
    monkeypatch.setattr(ingest, "_clock", lambda: t0 + 60)
    _hook_post(client, key, sid, more[len(raw) :], len(raw))

    (p,) = apns.live()
    aps = p["body"]["aps"]
    assert p["headers"]["apns-priority"] == "10"
    assert aps["content-state"]["phase"] == "needsYou"
    assert aps["content-state"]["sentence"] == "Waiting on you"
    assert aps["alert"]["title"] == "A session needs you"
    assert aps["alert"]["body"] == "Waiting on you for one minute"
    for s in ("zqx", "sentinel", "secret"):
        assert s not in json.dumps(p["body"])


@needs_db
def test_a_plan_that_fails_never_fails_the_upload(client, paired, apns, monkeypatch):
    uid, headers = paired
    s = _Sitting(client, headers, uid)
    s.send()
    _register(client, headers, s.id)

    def boom(*a, **k):
        raise RuntimeError("a bug in the push rules")

    monkeypatch.setattr(live_push, "_plan", boom)
    out = s.send(**CIRCLING)
    assert out["unchanged"] == 1
    assert apns.posts == []
    assert _tokens(uid)[0].last_trajectory == "none", "nothing half recorded"
    with owner_engine().connect() as c:
        body = c.execute(
            text("SELECT body FROM session_live WHERE session_id = :s"), {"s": s.id}
        ).scalar()
    assert body["verdict"]["state"] == "circling", "the upload itself landed"


def test_a_needs_you_alert_names_only_a_public_repository():
    """FOUND IN REVIEW (2026-09-14): this alert said "private repo needs you" while the phone's
    for the same moment said "Private project 2 needs you", a number only the phone knows. A
    private repository is never named, here or there (`localCopy.needsYouTitle`)."""
    private = live_push.alert_for({"repo_name": None}, "Waiting on you")
    assert private["title"] == "A session needs you"
    public = live_push.alert_for({"repo_name": "tramline"}, "Waiting on you")
    assert public["title"] == "tramline needs you"
    cut = live_push.alert_for({"repo_name": "x" * 80}, "s")["title"]
    assert cut == "x" * live_push.REPO_MAX + " needs you"
