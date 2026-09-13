/**
 * The generated catalogs the phone renders from (`src/generated/copy.ts`, written by
 * `scripts/gen_copy.py` out of the engine's tables).
 *
 * `copy.test.ts` skips `generated/`, so this is where the no dash rule reaches those words.
 * And each table keyed by a wire enum must cover that enum, both ways: a term, a stack item,
 * a price row, a cause or a decision the wire can carry with no words here would render as
 * nothing forever, and a key the wire can never carry is a catalog that has drifted.
 */
import { describe, expect, test } from 'bun:test';

import * as catalog from '../src/copy/catalog';
import { hasDash } from '../src/copy/plain';
import { CONTRACT_ENUMS } from '../src/generated/contract';
import { COPY } from '../src/generated/copy';
import { LIVE_ENUMS } from '../src/generated/live';
import { REPORT_ENUMS } from '../src/generated/report';
import { python } from './pythonRef';

function strings(x: unknown, at: string, out: [string, string][] = []): [string, string][] {
  if (typeof x === 'string') out.push([at, x]);
  else if (Array.isArray(x)) x.forEach((v, i) => strings(v, `${at}[${i}]`, out));
  else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) strings(v, `${at}.${k}`, out);
  return out;
}

const keys = (o: object) => Object.keys(o).sort();
const sorted = (xs: readonly string[]) => [...xs].sort();

describe('generated/copy.ts', () => {
  test('no dash in any word it holds', () => {
    const hits = strings(COPY, 'COPY').filter(([, s]) => hasDash(s));
    expect(hits).toEqual([]);
  });

  test('an entry for every id the wire can carry, and no other', () => {
    expect(keys(COPY.TERMS)).toEqual(sorted(REPORT_ENUMS.vocab_term));
    expect(keys(COPY.STACK_NAMES)).toEqual(sorted(REPORT_ENUMS.stack_item));
    expect(keys(COPY.FAMILIES)).toEqual(sorted(REPORT_ENUMS.priced_model));
    expect(keys(COPY.CAUSE_SENTENCES)).toEqual(sorted(REPORT_ENUMS.burn_cause));
    expect(keys(COPY.CAUSE_SENTENCES)).toEqual(sorted(CONTRACT_ENUMS.burn_cause));
    expect(keys(COPY.REPEAT_SENTENCES)).toEqual(sorted(CONTRACT_ENUMS.burn_repeat));
    expect(keys(COPY.DECISION_SENTENCES)).toEqual(sorted(LIVE_ENUMS.decision_kind));
    expect(keys(COPY.QUESTIONS)).toEqual(sorted(REPORT_ENUMS.wrapped_card));
    expect(keys(COPY.REFUSALS)).toEqual(sorted(REPORT_ENUMS.wrapped_refusal));
    expect(keys(COPY.KIND_REFUSALS)).toEqual(sorted(REPORT_ENUMS.kind_refusal));
    expect(keys(COPY.BARREN_REFUSALS)).toEqual(sorted(REPORT_ENUMS.burn_refusal));
    expect(keys(COPY.SPEND_REFUSALS)).toEqual(sorted(REPORT_ENUMS.money_refusal));
    expect(keys(COPY.VOCAB_REFUSALS)).toEqual(sorted(REPORT_ENUMS.vocab_refusal));
    expect(keys(COPY.STACK_REFUSALS)).toEqual(sorted(REPORT_ENUMS.stack_refusal));
    expect(keys(COPY.KIND_NOUN)).toEqual(sorted(REPORT_ENUMS.commit_kind));
    expect([...COPY.KINDS]).toEqual([...REPORT_ENUMS.commit_kind]);
    for (const table of [COPY.ROLE_DISPLAY, COPY.ROLE_WORD, COPY.ROLE_NOUN]) expect(keys(table)).toEqual(sorted(REPORT_ENUMS.plain_role));
    expect([...COPY.ROLES]).toEqual([...REPORT_ENUMS.plain_role]);
    expect([...COPY.ROLES]).toEqual([...LIVE_ENUMS.plain_role]);
  });

  test('the archetype and work style names cover every value a card can carry', () => {
    const archetypes = [...REPORT_ENUMS.archetype, 'generalist'];
    expect(keys(COPY.ARCHETYPE_DISPLAY)).toEqual(sorted(archetypes));
    for (const style of keys(COPY.WORK_STYLE_DISPLAY)) expect(REPORT_ENUMS.wrapped_value as readonly string[]).toContain(style);
  });

  test('the renderers read these tables and no copy of them', () => {
    expect(catalog.REFUSALS).toBe(COPY.REFUSALS);
    expect(catalog.QUESTIONS).toBe(COPY.QUESTIONS);
    expect(catalog.CAUSE_SENTENCES).toBe(COPY.CAUSE_SENTENCES);
    expect(catalog.FAMILIES).toBe(COPY.FAMILIES);
    expect(catalog.DECISION_SENTENCES).toBe(COPY.DECISION_SENTENCES);
    expect(catalog.ROLE_NOUN).toBe(COPY.ROLE_NOUN);
    expect(catalog.TERMS).toBe(COPY.TERMS);
  });

  test('every glossary definition is one line ending in a full stop', () => {
    for (const [id, t] of Object.entries(COPY.TERMS)) {
      expect({ id, ok: t.word.length > 0 && /\.$/.test(t.definition) && !t.definition.includes('\n') }).toEqual({ id, ok: true });
    }
  });
});

describe('against the engine\'s own tables (skipped without python3)', () => {
  test('each table is the Python table it was generated from', () => {
    const py = python<Record<string, unknown>>(`
import json
from analysis import burn, live, plain, pricing, profile, wrapped
print(json.dumps({
  "QUESTIONS": wrapped.QUESTIONS, "REFUSALS": wrapped.REFUSALS, "KIND_REFUSALS": wrapped.KIND_REFUSALS,
  "REFUSAL_CONSTANTS": wrapped.REFUSAL_CONSTANTS, "ARCHETYPE_DISPLAY": wrapped.ARCHETYPE_DISPLAY,
  "WORK_STYLE_DISPLAY": wrapped.WORK_STYLE_DISPLAY, "KIND_NOUN": {k: list(v) for k, v in wrapped._KIND_NOUN.items()},
  "ROLE_DISPLAY": wrapped.ROLE_DISPLAY, "ROLE_WORD": wrapped.ROLE_WORD, "WITH_YOU": wrapped.WITH_YOU,
  "CAUSE_SENTENCES": burn._CAUSE_SENTENCES, "CAUSE_SENTENCES_ONE": burn._CAUSE_SENTENCES_ONE,
  "REPEAT_SENTENCES": burn._REPEAT_SENTENCES, "UNREADABLE_VERDICT": burn.UNREADABLE_VERDICT,
  "BARREN_REFUSALS": profile.BARREN_REFUSALS, "SPEND_REFUSALS": profile.SPEND_REFUSALS,
  "FAMILIES": dict(pricing.FAMILIES), "DECISION_SENTENCES": live.DECISION_SENTENCES,
  "ROLE_NOUN": {k: list(v) for k, v in plain.ROLE_NOUN.items()}, "ROLES": list(plain.ROLES),
}))`);
    if (py === null) return;
    for (const [name, table] of Object.entries(py)) {
      expect({ name, table: JSON.parse(JSON.stringify((COPY as Record<string, unknown>)[name])) }).toEqual({ name, table });
    }
  });
});
