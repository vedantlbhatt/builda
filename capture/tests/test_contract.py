"""python3 -m unittest capture.tests.test_contract

Every key in an upload payload must be declared in privacy/upload-contract.json — walking
NESTED fields properly. CLAUDE.md records the mistake this guards against: a check that
compared every scalar path against the flat list of top-level names reported
`tokens.input` and `strip_marks[].ms` as "sent but not declared", and the first person to
run it publicly would have concluded the privacy claim was false. Nested shapes are
checked against the wire models the contract's `type` names (`tokens`, `marks`, `models`,
`analysis`), which is what `server/builder/contract.py` enforces with extra="forbid".
"""

from __future__ import annotations

import base64
import json
import pathlib
import re
import unittest
import zoneinfo

from capture import identity, sessions, strip
from capture.discover import Transcript
from capture.tests import spec_walk

ROOT = pathlib.Path(__file__).resolve().parents[2]
CONTRACT = json.loads((ROOT / "privacy" / "upload-contract.json").read_text())
FIELDS = {f["name"]: f for f in CONTRACT["fields"]}
ANALYSIS_SCHEMA = json.loads((ROOT / "analysis" / "schema.json").read_text())
LIVE_SPEC = json.loads((ROOT / "spec" / "live.v1.json").read_text())
FIX = ROOT / "spec" / "fixtures" / "boundaries"
TZ = zoneinfo.ZoneInfo("America/New_York")
SHA = re.compile(r"^[0-9a-f]{64}$")
#: `analysis.live.SALT_MIN_CHARS` or longer; the value is a test's, never a machine's.
SALT = "contract-test-salt-0123456789abcdef-0123456789"

#: The insides of the four structured field types, as `server/builder/contract.py`
#: declares them (TokenBucketsWire, StripMarkWire, ModelShareWire, FeedbackNoteWire).
NESTED = {
    "tokens": {"input", "output", "cache_read", "cache_w5m", "cache_w1h"},
    "marks": {"ms", "k"},
    "models": {"model_id", "output_token_share"},
    "feedback": {"id", "seconds", "count"},
}


def _all_payloads() -> list[dict]:
    """Every boundary fixture cut one second after its last record, so each one's last
    sitting is LIVE, and every live payload carries its live state and names the way
    `capture sync --live --live-names` builds them: every v4 field reaches the walk."""
    from analysis import live as lv

    out = []
    for jsonl in sorted(FIX.glob("*.jsonl")):
        src = sessions.load_source(Transcript("fixture", jsonl))
        last = max(r["ts"] for r in src.records)
        cut = sessions.sessionize_sources([src], TZ, now=last + 1)
        history = lv.eta_history(cut)
        for s in cut:
            p = sessions.build_payload(s, TZ, "1" * 64, "test", observed_at=last)
            if s.state == "live":
                sessions.attach_live(p, s, now=last + 1, history=history, salt=SALT, names=True)
            out.append(p)
    return out


def _walk(name: str, value) -> list[str]:
    """The nested shape of one v4 structured field, against the spec its `type` names."""
    f = FIELDS[name]
    if f["type"] == "object":
        return spec_walk.errors(
            value, CONTRACT["objects"][f["item"]], objects=CONTRACT["objects"], enums=CONTRACT["enums"], where=name
        )
    if f["type"] in ("live", "live_names"):
        fields = LIVE_SPEC["fields"] if f["type"] == "live" else LIVE_SPEC["objects"]["LiveNames"]
        return spec_walk.errors(
            value,
            fields,
            objects=LIVE_SPEC["objects"],
            enums=LIVE_SPEC["enums"],
            max_lengths=LIVE_SPEC["max_lengths"],
            where=name,
        )
    raise AssertionError(f"{name} is not a structured v4 field")


class ContractConformance(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.payloads = _all_payloads()
        assert cls.payloads

    def test_contract_is_v4(self):
        self.assertEqual(CONTRACT["version"], 4)

    def test_the_fixtures_reach_every_v4_field(self):
        """A walk over payloads that never carry a field proves nothing about it."""
        for name in ("burn", "title_ids", "call_tokens", "live", "live_names"):
            self.assertTrue(any(name in p for p in self.payloads), name)

    def test_every_key_is_declared_nested_fields_included(self):
        for p in self.payloads:
            undeclared = set(p) - set(FIELDS)
            self.assertEqual(undeclared, set(), f"undeclared top-level keys: {undeclared}")
            for name, value in p.items():
                typ = FIELDS[name]["type"]
                if typ == "tokens" and value is not None:
                    self.assertEqual(set(value) - NESTED["tokens"], set())
                elif typ == "marks":
                    for m in value:
                        self.assertEqual(set(m) - NESTED["marks"], set())
                elif typ == "models":
                    for m in value:
                        self.assertEqual(set(m) - NESTED["models"], set())
                elif typ == "analysis" and value is not None:
                    self.assertEqual(set(value) - set(ANALYSIS_SCHEMA["properties"]), set())
                elif typ == "feedback" and value is not None:
                    for n in value:
                        self.assertEqual(set(n) - NESTED["feedback"], set())
                        self.assertIn(n["id"], FIELDS["feedback"]["values"])
                elif typ == "toolmap":
                    self.assertTrue(all(isinstance(v, int) for v in value.values()))
                    self.assertEqual(set(value) - set(FIELDS["tool_calls"]["values"]), set(), value)
                elif typ in ("object", "live", "live_names") and value is not None:
                    self.assertEqual(_walk(name, value), [], name)
                else:
                    self.assertNotIsInstance(value, dict, f"{name} is an undeclared object")

    def test_the_generated_door_accepts_every_payload(self):
        """`server/builder/contract.py SessionUpload`, extra forbidden at every level, where
        pydantic is installed (the walk above is the check CI runs)."""
        door = spec_walk.pydantic_door("contract")
        if door is None:
            self.skipTest("pydantic is not installed here; the walk covers the shape")
        for p in self.payloads:
            door.SessionUpload(**p)

    def test_tool_call_keys_are_the_contracts(self):
        self.assertEqual(list(sessions.TOOL_CALL_KEYS), FIELDS["tool_calls"]["values"])
        self.assertEqual(list(sessions.UPLOADED_TOOLS) + list(sessions.TOOL_BUCKETS), FIELDS["tool_calls"]["values"])
        for aliases in sessions.TOOL_ALIASES.values():
            self.assertTrue(set(aliases.values()) <= set(sessions.UPLOADED_TOOLS))

    def test_the_live_block_is_not_in_the_hash(self):
        """docs/overnight-integration.md 3.2: the block moves with the clock, not the bytes,
        so a payload's hash is the hash WITHOUT it, and one computed after it was attached
        agrees."""
        live = [p for p in self.payloads if "live" in p]
        self.assertTrue(live)
        for p in live:
            bare = {k: v for k, v in p.items() if k not in ("live", "live_names")}
            self.assertEqual(sessions.content_hash(bare), p["content_hash"])
            self.assertEqual(sessions.content_hash(p), p["content_hash"])
        final = next(p for p in self.payloads if p["state"] == "final")
        self.assertNotEqual(sessions.content_hash(dict(final, burn=None)), final["content_hash"])

    def test_the_salt_never_travels(self):
        blob = json.dumps(self.payloads)
        self.assertNotIn(SALT, blob)
        self.assertEqual(identity.MAP_SALT_MIN_CHARS, __import__("analysis.live", fromlist=["x"]).SALT_MIN_CHARS)

    def test_a_live_block_only_on_a_live_payload(self):
        """The server's gate refuses `live` on a final payload, so `attach_live` does too."""
        src = sessions.load_source(Transcript("fixture", FIX / "remote_sdk_prompts.jsonl"))
        last = max(r["ts"] for r in src.records)
        final = next(s for s in sessions.sessionize_sources([src], TZ, now=last + 7200) if s.state == "final")
        p = sessions.build_payload(final, TZ, "1" * 64, "test")
        with self.assertRaises(ValueError):
            sessions.attach_live(p, final, now=last + 7200, history=[], salt=SALT)
        self.assertNotIn("live", p)

    def test_anonymous_mode_carries_no_public_only_field(self):
        public_only = {n for n, f in FIELDS.items() if f["modes"] == ["public"]}
        self.assertEqual(public_only, {"repo_name", "title", "title_source"})
        for p in self.payloads:
            self.assertEqual(set(p) & public_only, set())

    def test_required_fields_are_present(self):
        optional = {n for n, f in FIELDS.items() if f.get("nullable")} | {
            "repo_name",
            "title",
            "title_source",
        }
        for p in self.payloads:
            missing = set(FIELDS) - optional - set(p)
            self.assertEqual(missing, set())

    def test_enums_hashes_and_shapes(self):
        for p in self.payloads:
            for name, f in FIELDS.items():
                if name not in p:
                    continue
                if f["type"] == "enum":
                    self.assertIn(p[name], f["values"], name)
                if f["type"] == "sha256hex":
                    self.assertRegex(p[name], SHA, name)
            cols = base64.b64decode(p["strip_columns"], validate=True)
            self.assertEqual(len(cols), strip.COLUMNS)
            self.assertFalse(any(b >> 4 for b in cols), "reserved bits must be zero")

    def test_server_sanity_gate_invariants(self):
        """The checks in server/builder/routes/sync.py::sanity_gate, locally."""
        for p in self.payloads:
            span = _ts(p["ended_at"]) - _ts(p["started_at"])
            self.assertLessEqual(p["active_seconds"], span + 1)
            self.assertEqual(p["state"] == "live", p["end_reason"] == "still_running")
            self.assertEqual(p["attended_seconds"] + p["autonomous_seconds"], p["active_seconds"])
            if p["presence_count"] == 0 and p["active_seconds"] >= 1200:
                self.assertTrue(p["unattended"])
            if p["presence_count"] > 0:
                self.assertFalse(p["unattended"])
            self.assertFalse(p["token_dedupe"] == "none" and p["tokens_reported"])
            if not p["tokens_reported"]:
                self.assertNotIn("tokens", p)
            cols = base64.b64decode(p["strip_columns"])
            strip_active = strip.non_idle_seconds(cols, span)
            if p["active_seconds"] > 0 and not (p["state"] == "live" and p["active_seconds"] < 300):
                self.assertLessEqual(
                    abs(strip_active - p["active_seconds"]), 0.25 * p["active_seconds"]
                )

    def test_tokens_are_deduped_on_message_id(self):
        """The fixtures write one usage object per assistant record with a UNIQUE message
        id each, so the deduped total equals the record count; a second record with the
        same id must add nothing (the 1.878x content-block trap)."""
        jsonl = FIX / "remote_sdk_prompts.jsonl"
        src = sessions.load_source(Transcript("fixture", jsonl))
        led = sessions.token_ledger(src.records)
        n_assistant = sum(1 for r in src.records if r["kind"] == "assistant")
        self.assertEqual(led.buckets["input"], n_assistant)
        dup = [dict(r) for r in src.records if r["kind"] == "assistant"][:1]
        dup[0]["line"] = 10**6
        led2 = sessions.token_ledger(src.records + dup)
        self.assertEqual(led2.buckets["input"], n_assistant)

    def test_content_hash_ignores_only_volatile_fields(self):
        p = dict(self.payloads[0])
        h = sessions.content_hash(p)
        q = dict(p, agent_observed_at="2030-01-01T00:00:00.000Z")
        self.assertEqual(sessions.content_hash(q), h)
        r = dict(p, active_seconds=p["active_seconds"] + 1)
        self.assertNotEqual(sessions.content_hash(r), h)

    def test_a_change_to_the_rules_moves_every_hash(self):
        """FOUND IN REVIEW (2026-09-14): a sitting kept an old rule's note after the re-upload
        that followed the fix, because nothing about it moved its hash and `/v1/sync/known`
        skipped it. The feedback rules' version is in the hash, so a change to them re-uploads
        every sitting, the ones with nothing to say included; and it is never on the wire."""
        from unittest import mock

        from analysis import feedback as fb

        p = dict(self.payloads[0])
        h = sessions.content_hash(p)
        self.assertEqual(sessions.content_hash(dict(p)), h, "stable while the rules stand still")
        with mock.patch.object(fb, "RULES_VERSION", fb.RULES_VERSION + 1):
            self.assertNotEqual(sessions.content_hash(p), h)
        self.assertNotIn("rules", p)
        self.assertEqual(sessions._derived_rules(), {"feedback": fb.RULES_VERSION})


def _ts(iso: str) -> float:
    import datetime as dt

    return dt.datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()


if __name__ == "__main__":
    unittest.main()
