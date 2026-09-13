"""The report's version 2 enums are copies of Python tables, pinned both ways.

spec/report.v1.json cannot import Python, so every enum that names something a module in
this package defines (a Wrapped card, a price row, a glossary term, a stack item, a file
role) is a copy of that module's table. A copy drifts in two directions and both are
silent: a value the module can emit and the spec lacks is a 422 on somebody's upload,
months later, which they cannot act on; a value the spec keeps after the module dropped
it is a phone that renders copy for a thing that can no longer happen. Each test below
compares the whole list, in order, so either direction fails here.

The caps are pinned the same way: a list shorter than the table it holds is the 422
again, on the heaviest user first.

The second half holds `analysis/report_blocks.py` (docs/overnight-integration.md 1.3 and
7): the mapping from `wrapped.wire`, the profile and `vocab.wire` to these blocks, that
every basis, unit and refusal code the modules can emit is in the spec, that no string in
the five blocks is anything but an enum value or a clock, and that the phone's two parity
fixtures are what `scripts/gen_copy.py` writes today.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
import importlib.util
import json
import pathlib
import unittest

from analysis import burn, plain, pricing, report_blocks, vocab, wrapped
from analysis import profile as pf
from analysis import report as rp
from analysis.tests import burn_fixture, corpus_fixture as cf

ROOT = pathlib.Path(__file__).resolve().parents[2]

SPEC = json.loads((ROOT / "spec/report.v1.json").read_text())
CONTRACT = json.loads((ROOT / "privacy/upload-contract.json").read_text())
ENUMS = SPEC["enums"]


def cap(obj: str, field: str) -> int:
    return next(f["max_items"] for f in SPEC["objects"][obj] if f["name"] == field)


class TheFourCatalogCopies(unittest.TestCase):
    """docs/overnight-integration.md 1.1: four enums copy a Python table."""

    def test_wrapped_card_enum_is_card_ids(self):
        self.assertEqual(ENUMS["wrapped_card"], list(wrapped.CARD_IDS))

    def test_priced_model_enum_is_the_price_table(self):
        self.assertEqual(ENUMS["priced_model"], list(pricing.PRICES))

    def test_vocab_term_enum_is_the_catalog_in_order(self):
        self.assertEqual(ENUMS["vocab_term"], [t.id for t in vocab.CATALOG])

    def test_stack_item_enum_is_the_catalog_in_order(self):
        """80 items, not the 81 the design names: the review removed app_store_connect,
        an MCP server's identity, from the stack (docs/overnight-engine.md, review fixes)."""
        self.assertEqual(ENUMS["stack_item"], [t.id for t in vocab.STACK])


class TheOtherTableCopies(unittest.TestCase):
    def test_archetypes_and_their_metrics_are_the_rules(self):
        self.assertEqual(ENUMS["archetype"], [r["name"] for r in pf.ARCHETYPE_RULES])
        self.assertEqual(ENUMS["archetype_metric"], [r["metric"] for r in pf.ARCHETYPE_RULES])

    def test_a_wrapped_value_is_an_archetype_a_style_a_kind_or_a_role(self):
        """The three cards whose answer is an id: builder_type (the six archetypes and
        generalist), work_style, and kind_of_work on either basis (a commit kind or the
        file role fallback). One list, first appearance wins."""
        expected = dict.fromkeys(
            [*wrapped.ARCHETYPE_DISPLAY, *wrapped.WORK_STYLES, *wrapped.KINDS, *plain.ROLES]
        )
        self.assertEqual(ENUMS["wrapped_value"], list(expected))

    def test_commit_kinds_and_file_roles_are_their_modules(self):
        self.assertEqual(ENUMS["commit_kind"], list(wrapped.KINDS))
        self.assertEqual(ENUMS["plain_role"], list(plain.ROLES))

    def test_every_lines_basis_is_the_profiles_and_the_shipped_card_can_carry_each(self):
        """The rename the review made (`project_edit_tools_and_credited_shell_writes`)
        is what the code stamps; the design's older name would refuse every real upload."""
        lines = [pf.LINES_EDIT_AND_SHELL, pf.LINES_EDIT_ONLY, pf.LINES_UPLOADED, pf.LINES_ABSENT]
        self.assertEqual(ENUMS["lines_basis"], lines)
        # The shipped card's basis IS the lines basis, with the commits half split off.
        self.assertLessEqual(set(lines), set(ENUMS["wrapped_basis"]))
        self.assertEqual(ENUMS["commits_basis"], [wrapped.COMMITS_BASIS])

    def test_the_wrapped_bases_named_as_constants_are_in_the_spec(self):
        for basis in (
            wrapped.CRYPTIC_BASIS,
            wrapped.KIND_BASIS_COMMITS,
            wrapped.KIND_BASIS_LINES,
            wrapped.KIND_BASIS_NEITHER,
        ):
            self.assertIn(basis, ENUMS["wrapped_basis"])

    def test_money_refusals_are_the_price_table_bases(self):
        """When spend is refused, its basis IS the refusal code (1.3)."""
        self.assertEqual(
            ENUMS["money_refusal"], [pricing.BASIS_TOKENS_ABSENT, pricing.BASIS_UNKNOWN_MODEL]
        )
        self.assertEqual(ENUMS["money_basis"][0], pricing.BASIS_LIST_PRICE)

    def test_burn_causes_are_the_ones_burn_has_a_sentence_for(self):
        self.assertEqual(ENUMS["burn_cause"], list(burn._CAUSE_SENTENCES))

    def test_stack_categories_and_evidence_are_vocabs(self):
        self.assertEqual(ENUMS["stack_category"], list(vocab.CATEGORIES))
        self.assertEqual(ENUMS["stack_evidence"], list(vocab.EVIDENCE))
        self.assertEqual({t.category for t in vocab.STACK}, set(vocab.CATEGORIES))


class TheCapsHoldTheirTables(unittest.TestCase):
    def test_every_list_is_long_enough_for_the_table_it_holds(self):
        self.assertEqual(cap("ReportWrapped", "cards"), len(wrapped.CARD_IDS))
        self.assertEqual(cap("ReportMoney", "by_model"), len(pricing.PRICES))
        self.assertEqual(cap("ReportWrappedExtras", "kinds"), len(wrapped.KINDS))
        self.assertEqual(cap("ReportWrappedExtras", "role_lines"), len(plain.ROLES))
        self.assertEqual(cap("ReportBurn", "causes"), len(burn._CAUSE_SENTENCES))
        self.assertGreaterEqual(cap("ReportVocab", "terms"), len(vocab.CATALOG))
        self.assertGreaterEqual(cap("ReportStack", "items"), len(vocab.STACK))

    def test_runners_up_hold_what_the_profile_ranks(self):
        """`profile.archetype` keeps the two rules after the winner."""
        self.assertEqual(cap("ReportWrappedExtras", "runners_up"), 2)



# ==================================================================== the blocks
def fields(obj: str) -> dict[str, dict]:
    return {f["name"]: f for f in SPEC["objects"][obj]}


def all_cards() -> list[tuple[str, dict, dict]]:
    """(scenario, wrapped's LOCAL card, the report's card) for every card of every fixture
    corpus: every card answered at least once and every refusal code reached."""
    out = []
    for sc in cf.scenarios():
        result = wrapped.wrapped(sc.facts, sc.sessions, **sc.kw)
        block = report_blocks.wrapped_block(wrapped.wire(result))
        for local, card in zip(result["cards"], block["cards"], strict=True):
            out.append((sc.name, local, card))
    return out


def full_report(**over) -> tuple[dict, dict | None]:
    return rp.from_corpus(cf.rich_corpus(**over), 30, quotes=True)


def enum_of(obj: str, name: str) -> list[str]:
    return SPEC["enums"][fields(obj)[name]["values"]]


class WrappedBlock(unittest.TestCase):
    """docs/overnight-integration.md 1.3, the wrapped half of `report_blocks`."""

    @classmethod
    def setUpClass(cls):
        cls.cards = all_cards()

    def test_every_wrapped_card_maps_to_the_spec_card_shape(self):
        want = set(fields("ReportWrappedCard"))
        extras = set(fields("ReportWrappedExtras"))
        self.assertEqual(set(report_blocks.WRAPPED_EXTRAS), set(wrapped.CARD_IDS))
        for name, _local, card in self.cards:
            with self.subTest(scenario=name, card=card["id"]):
                self.assertEqual(set(card), want)
                # Only the card's own extras, and every one the spec declares.
                self.assertEqual(set(card["extras"]), set(report_blocks.WRAPPED_EXTRAS[card["id"]]))
                self.assertLessEqual(set(card["extras"]), extras)

    def test_the_block_is_every_card_in_order_and_the_two_counts(self):
        facts, sessions = cf.corpus(*cf.rich())
        block = report_blocks.wrapped_block(wrapped.wire(wrapped.wrapped(facts, sessions)))
        self.assertEqual(set(block), set(fields("ReportWrapped")))
        self.assertEqual([c["id"] for c in block["cards"]], list(wrapped.CARD_IDS))
        self.assertEqual((block["prompts_with_text"], block["attended_sessions"]), (9, 3))

    def test_a_refused_card_carries_a_code_and_never_a_sentence(self):
        seen = 0
        for name, local, card in self.cards:
            if local["reason"] is None:
                self.assertIsNone(card["reason"], (name, card["id"]))
                self.assertIsNone(card["needed"], (name, card["id"]))
                continue
            seen += 1
            with self.subTest(scenario=name, card=card["id"]):
                self.assertEqual(card["reason"], local["code"])
                self.assertIn(card["reason"], wrapped.REFUSALS)
                self.assertEqual(card["needed"], local["needed"])
                self.assertIsNone(card["value"])
                self.assertIsNone(card["value_id"])
                # The words stay on the machine; only the code travels.
                self.assertNotIn(local["reason"], json.dumps(card))
        self.assertGreater(seen, 20)

    def test_local_cards_carry_only_id_n_and_code(self):
        """Crash out and cryptic prompt: which card, whether it answered, and the two
        constants the spec requires (its unit and basis). No number on them leaves, and no
        extra."""
        for name, local, card in self.cards:
            if card["id"] not in wrapped.LOCAL_CARDS:
                continue
            with self.subTest(scenario=name, card=card["id"]):
                self.assertIsNone(card["value"])
                self.assertIsNone(card["value_id"])
                self.assertEqual(card["extras"], {})
                self.assertEqual(card["n"], local["n"])
                self.assertEqual(card["reason"], local["code"])

    def test_every_basis_unit_value_and_code_wrapped_can_emit_is_in_the_spec(self):
        e = SPEC["enums"]
        for name, _local, card in self.cards:
            with self.subTest(scenario=name, card=card["id"]):
                self.assertIn(card["id"], e["wrapped_card"])
                self.assertIn(card["unit"], e["wrapped_unit"])
                self.assertIn(card["basis"], e["wrapped_basis"])
                if card["value_id"] is not None:
                    self.assertIn(card["value_id"], e["wrapped_value"])
                if card["reason"] is not None:
                    self.assertIn(card["reason"], e["wrapped_refusal"])
                x = card["extras"]
                if x.get("commits_basis") is not None:
                    self.assertIn(x["commits_basis"], e["commits_basis"])
                if x.get("commit_refusal") is not None:
                    self.assertIn(x["commit_refusal"], e["kind_refusal"])
                if x.get("metric") is not None:
                    self.assertIn(x["metric"], e["archetype_metric"])
                for score in [x.get("closest")] + list(x.get("runners_up") or []):
                    if score:
                        self.assertIn(score["name"], e["archetype"])
                        self.assertIn(score["metric"], e["archetype_metric"])
                for k in x.get("kinds") or []:
                    self.assertIn(k["kind"], e["commit_kind"])
                for r in x.get("role_lines") or []:
                    self.assertIn(r["role"], e["plain_role"])

    def test_every_refusal_code_is_in_the_spec_and_has_a_template(self):
        """One list, both ways, in order: the spec's codes ARE `wrapped.REFUSALS`, and the
        commit labels' codes ARE `wrapped.KIND_REFUSALS`."""
        self.assertEqual(SPEC["enums"]["wrapped_refusal"], list(wrapped.REFUSALS))
        self.assertEqual(SPEC["enums"]["kind_refusal"], list(wrapped.KIND_REFUSALS))

    def test_the_fixture_corpora_reach_every_card_and_every_code(self):
        answered = {card["id"] for _n, local, card in self.cards if local["reason"] is None}
        codes = {card["reason"] for _n, _l, card in self.cards if card["reason"]}
        commit_codes = {
            card["extras"]["commit_refusal"]
            for _n, _l, card in self.cards
            if card["id"] == "kind_of_work" and card["extras"]["commit_refusal"]
        }
        self.assertEqual(answered, set(wrapped.CARD_IDS))
        self.assertEqual(codes, set(wrapped.REFUSALS))
        self.assertEqual(commit_codes, set(wrapped.KIND_REFUSALS))
        cryptic = {local["n"] for _n, local, c in self.cards if c["reason"] == "no_cryptic_prompt"}
        self.assertTrue({0, 1} <= cryptic and any(k > 1 for k in cryptic), "all three forms")

    def test_the_units_are_the_specs_identifiers(self):
        """A unit is never rendered, so it carries no space (it was "prompts per session")."""
        for _n, local, _card in self.cards:
            self.assertRegex(local["unit"], r"^[a-z_]+$")


class MoneyBlock(unittest.TestCase):
    def test_money_invents_no_price_and_says_when_prices_were_read(self):
        c = cf.rich_corpus()
        profile = pf.corpus_profile(c.facts, now=c.now)
        money = report_blocks.money_block(profile, c.facts)
        self.assertEqual(set(money), set(fields("ReportMoney")))
        self.assertEqual(money["usd"], profile["metrics"]["spend_usd"]["value"])
        # The price table, read back by hand: every fact is Opus 5.
        want = sum(
            pricing.cost_usd(f.tokens, "claude-opus-5") for f in c.facts
        )
        self.assertAlmostEqual(money["usd"], round(want, 2), places=2)
        self.assertEqual(money["basis"], pricing.BASIS_LIST_PRICE)
        self.assertIsNone(money["reason"])
        self.assertEqual(money["prices_read_on"], f"{pricing.PRICES_READ_ON.isoformat()}T00:00:00Z")
        self.assertEqual(money["tokens"]["input"], sum(f.tokens.input for f in c.facts))
        self.assertEqual(money["token_sessions"], 4)
        self.assertEqual((money["lines_added"], money["lines_removed"]), (285, 0))
        self.assertEqual([r["model"] for r in money["by_model"]], ["claude-opus-5"])
        self.assertLessEqual({r["model"] for r in money["by_model"]}, set(pricing.PRICES))
        # Four priced sessions is under the share's floor: refused, never a zero.
        self.assertIsNone(money["usd_without_a_commit"])
        self.assertIsNone(money["share_without_a_commit"])

    def test_money_refuses_by_basis_when_no_tokens_were_reported(self):
        facts, _ = cf.corpus(*cf.rich())
        money = report_blocks.money_block(pf.corpus_profile(facts), facts)
        self.assertEqual(
            (money["usd"], money["basis"], money["reason"]),
            (None, None, pricing.BASIS_TOKENS_ABSENT),
        )
        self.assertEqual((money["tokens"], money["token_sessions"]), (None, 0))
        self.assertIsNone(money["usd_per_active_hour"])
        self.assertEqual(money["by_model"], [])

    def test_an_unknown_model_refuses_and_still_says_how_many_sessions(self):
        c = cf.rich_corpus()
        facts = [dataclasses.replace(f, output_tokens_by_model={"gpt-99": 1}) for f in c.facts]
        money = report_blocks.money_block(pf.corpus_profile(facts), facts)
        self.assertEqual((money["reason"], money["unpriced_sessions"]), (pricing.BASIS_UNKNOWN_MODEL, 4))

    def test_the_money_refusals_are_the_price_table_bases_with_a_template_each(self):
        self.assertEqual(list(pf.SPEND_REFUSALS), SPEC["enums"]["money_refusal"])


class BurnBlock(unittest.TestCase):
    def test_burn_cause_shares_are_each_at_most_one(self):
        c = cf.rich_corpus()
        b = report_blocks.burn_block(pf.corpus_profile(c.facts, now=c.now))
        self.assertEqual(set(b), set(fields("ReportBurn")))
        self.assertEqual(b["share"], 0.1)  # 6,000k of 60,000k in every session
        self.assertIsNone(b["reason"])
        self.assertEqual([x["cause"] for x in b["causes"]], ["context_replay", "investigated"])
        for x in b["causes"]:
            self.assertEqual(set(x), set(fields("ReportBurnCause")))
            self.assertLessEqual(x["tokens"], b["barren_tokens"])
            self.assertTrue(0 <= x["share"] <= 1)
        # Each cause's share is of the BARREN tokens: 5,000k of 6,000k.
        self.assertEqual(b["causes"][0]["share"], 0.833)
        self.assertEqual(b["causes"][0]["segments"], 4)

    def test_a_refused_burn_keeps_its_code_and_nulls(self):
        facts, _ = cf.corpus(*cf.rich())
        b = report_blocks.burn_block(pf.corpus_profile(facts))
        self.assertEqual((b["share"], b["causes"], b["reason"]), (None, None, "no_token_counts"))
        two = cf.rich_corpus().facts[:2]
        b = report_blocks.burn_block(pf.corpus_profile(two))
        self.assertEqual((b["reason"], b["sessions"], b["needed"]), ("below_session_floor", 2, pf.MIN_SESSIONS))

    def test_the_burn_refusals_are_the_corpus_codes_and_the_session_codes(self):
        """One enum, two producers: the corpus block (`profile.BARREN_CODES`) and one
        session's upload (`burn.SESSION_REFUSALS`), and the contract declares the same list."""
        spec = SPEC["enums"]["burn_refusal"]
        self.assertEqual(sorted(pf.BARREN_CODES), sorted(spec))
        self.assertLessEqual(set(burn.SESSION_REFUSALS), set(spec))
        self.assertEqual(set(spec) - set(burn.SESSION_REFUSALS), {"below_session_floor"})
        self.assertEqual(CONTRACT["enums"]["burn_refusal"], spec)
        self.assertEqual(list(pf.BARREN_REFUSALS), list(pf.BARREN_CODES))


class VocabAndStackBlocks(unittest.TestCase):
    def test_the_refusal_codes_are_what_vocab_actually_says(self):
        """`vocab` words its refusals; `report_blocks` reads the code off those exact words,
        and a new wording is a KeyError here before it is a 422 anywhere."""
        g = vocab.wire(vocab.glossary([]))
        st = vocab.wire(vocab.stack([]))
        self.assertEqual(report_blocks.vocab_block(g)["reason"], "no_events")
        self.assertEqual(report_blocks.stack_block(st)["reason"], "no_evidence")
        self.assertEqual(list(report_blocks.VOCAB_REFUSALS.values()), SPEC["enums"]["vocab_refusal"])
        self.assertEqual(list(report_blocks.STACK_REFUSALS.values()), SPEC["enums"]["stack_refusal"])

    def test_the_blocks_drop_every_word_and_name(self):
        doc, _ = full_report()
        v, st = doc["vocab"], doc["stack"]
        self.assertEqual(set(v), set(fields("ReportVocab")))
        self.assertEqual(set(st), set(fields("ReportStack")))
        for t in v["terms"]:
            self.assertEqual(set(t), set(fields("ReportTerm")))
        for i in st["items"]:
            self.assertEqual(set(i), set(fields("ReportStackItem")))
        # A manifest name reaches the stack as a catalog id, and the count of names read
        # travels, never a name.
        self.assertIn("react", [i["id"] for i in st["items"]])
        self.assertEqual(st["manifests"], 2)


class TheWholeReport(unittest.TestCase):
    """`report.from_corpus`, the one builder, over the rich fixture corpus."""

    @classmethod
    def setUpClass(cls):
        cls.doc, cls.quotes = full_report()

    def test_every_block_is_filled_and_every_level_has_the_specs_keys(self):
        self.assertEqual(set(self.doc), {f["name"] for f in SPEC["fields"]})
        for block in rp.V2_BLOCKS:
            self.assertIsNotNone(self.doc[block], block)
        tops = {f["name"]: f["item"] for f in SPEC["fields"] if f["type"] == "object"}

        def walk(obj, name):
            spec = fields(name)
            self.assertEqual(set(obj), set(spec) if name != "ReportWrappedExtras" else set(obj), name)
            for key, value in obj.items():
                f = spec[key]
                if value is None:
                    self.assertTrue(f.get("nullable"), f"{name}.{key} is null and not nullable")
                elif f["type"] == "object":
                    walk(value, f["item"])
                elif f["type"] == "list" and f["item"] in SPEC["objects"]:
                    self.assertLessEqual(len(value), f["max_items"], f"{name}.{key}")
                    for item in value:
                        walk(item, f["item"])

        for block in rp.V2_BLOCKS:
            walk(self.doc[block], tops[block])

    def test_every_string_in_the_report_is_an_enum_value_or_a_clock(self):
        values = {v for vs in SPEC["enums"].values() for v in vs}

        def strings(obj, path=""):
            if isinstance(obj, str):
                yield path, obj
            elif isinstance(obj, dict):
                for k, v in obj.items():
                    yield from strings(v, f"{path}.{k}")
            elif isinstance(obj, list):
                for v in obj:
                    yield from strings(v, f"{path}[]")

        seen = 0
        for block in rp.V2_BLOCKS:
            for path, s in strings(self.doc[block], block):
                seen += 1
                if s in values:
                    continue
                dt.datetime.fromisoformat(s.replace("Z", "+00:00"))  # a clock, or it raises
                self.assertTrue(s.endswith("Z"), (path, s))
        self.assertGreater(seen, 50)

    def test_sentinels_never_reach_the_report(self):
        """A prompt word, a path, a commit subject and a manifest name, all planted in the
        corpus: none of them is anywhere in the report. The quotes document, which only
        `--quotes` sends, is the one place a prompt's words are."""
        text = json.dumps(self.doc)
        for word in (*cf.SENTINELS, "zebrapath-kit"):
            self.assertNotIn(word, text)
        self.assertIn("zebracorn", json.dumps(self.quotes))

    def test_without_quotes_there_is_no_quotes_document(self):
        doc, quotes = rp.from_corpus(cf.rich_corpus(), 30)
        self.assertIsNone(quotes)
        self.assertEqual(doc, self.doc)

    def test_the_report_is_on_the_cuts_clock(self):
        c = cf.rich_corpus()
        self.assertEqual(self.doc["generated_at"], pf._iso(c.now))


class TheParityFixtures(unittest.TestCase):
    """`spec/fixtures/wrapped/cards.json` and `spec/fixtures/burn/session.json` are what
    `scripts/gen_copy.py` writes from the code as it stands, so the phone's ports are held
    to TODAY's Python (`make check-gen` holds the bytes; this holds the content)."""

    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location("gen_copy", ROOT / "scripts/gen_copy.py")
        cls.gen = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.gen)

    def test_the_committed_card_fixture_is_current(self):
        on_disk = json.loads((ROOT / "spec/fixtures/wrapped/cards.json").read_text())
        self.assertEqual(on_disk, json.loads(json.dumps(self.gen.card_entries())))

    def test_the_committed_burn_fixture_is_current(self):
        on_disk = json.loads((ROOT / "spec/fixtures/burn/session.json").read_text())
        self.assertEqual(on_disk, json.loads(json.dumps(self.gen.burn_entries())))

    def test_every_card_entry_is_worded_by_the_card_it_carries(self):
        for e in json.loads((ROOT / "spec/fixtures/wrapped/cards.json").read_text()):
            card = e["card"]
            self.assertEqual(e["question"], wrapped.QUESTIONS[card["id"]])
            if card["reason"] is None:
                self.assertIsNone(e["refusal"])
                if e["display"] is not None:
                    self.assertRegex(e["sentence"], r"\d")
            else:
                self.assertIsNotNone(e["refusal"])
                self.assertIsNone(e["display"])

    def test_the_burn_fixture_says_every_verdict_and_refusal(self):
        entries = json.loads((ROOT / "spec/fixtures/burn/session.json").read_text())
        said = " ".join(line for e in entries for line in e["sentences"])
        for phrase in (
            "re-reading the conversation so far",
            "on reading 12 files",
            "on running the same command",
            "on editing the same file",
            "on the turn that handed work to 1 helper agent",
            "under 1% of it",
            "Over 99% of that",
            "nothing was written",
            "it removed 120 lines",
            "it changed 1 file",
            "it made 1 commit",
            burn.UNREADABLE_VERDICT,
            "12k tokens",
            "About 62%",
            "1.0M tokens",
            "This transcript does not record token counts",
            "Cost is not shown for this tool yet.",
            "Nothing in this transcript could be read yet",
        ):
            self.assertIn(phrase, said)
        self.assertEqual(
            {e["burn"]["reason"] for e in entries} - {None}, set(burn.SESSION_REFUSALS) - {"nothing_inside_segments"}
        )
        for e in entries:
            for line in e["sentences"]:
                self.assertFalse(plain.has_dash(line), line)

    def test_the_session_wire_carries_only_the_contracts_keys(self):
        objects = CONTRACT["objects"]
        keys = {name: {f["name"] for f in objects[name]} for name in objects}
        for s in burn_fixture.scenarios():
            w = burn.session_wire(s.report())
            self.assertEqual(set(w), keys["SessionBurn"], s.name)
            for spike in w["spikes"] or []:
                self.assertEqual(set(spike), keys["SessionBurnSpike"], s.name)
                self.assertLessEqual(len(spike["causes"]), burn.WIRE_MAX_CAUSES)
                for c in spike["causes"]:
                    self.assertEqual(set(c), keys["SessionBurnCause"], s.name)
            self.assertLessEqual(len(w["spikes"] or []), burn.WIRE_MAX_SPIKES)

    def test_the_wire_caps_are_the_contracts(self):
        objects = CONTRACT["objects"]
        cap_of = {(o, f["name"]): f.get("max_items") for o in objects for f in objects[o]}
        self.assertEqual(cap_of[("SessionBurn", "spikes")], burn.WIRE_MAX_SPIKES)
        self.assertEqual(cap_of[("SessionBurnSpike", "causes")], burn.WIRE_MAX_CAUSES)


if __name__ == "__main__":
    unittest.main()
