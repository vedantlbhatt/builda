/**
 * What each Wrapped card draws (`src/wrapped/face.ts`), through the real copy layer
 * (`src/copy/wrapped.ts` renderCard): every card of a report renders a non empty answer or
 * its refusal, never an empty card and never a 0 standing in for one; the quote cards show a
 * quote only when quotes are on; the count up can only ever land on the number the copy
 * wrote; and nothing the screen says carries a dash.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { hasDash } from '../src/copy/plain';
import type { QuoteWire } from '../src/generated/quotes';
import { REPORT_ENUMS, type ReportWrappedCard } from '../src/generated/report';
import { formatCount } from '../src/ui/format';
import { captionOf, SAMPLE_NOTE, STALE_NOTE } from '../src/wrapped/caption';
import { CARD_ORDER } from '../src/wrapped/deck';
import { deckItems } from '../src/wrapped/deckItems';
import {
  DECRYPT_CARDS,
  LOCAL_COUNTS,
  QUOTE_CARDS,
  QUOTE_NOTES,
  UNWORDED_REFUSAL,
  faceOf,
  quotesStateOf,
  refusalSentence,
  splitDisplay,
  type Face,
  type QuotesState,
} from '../src/wrapped/face';
import { NO_SOURCES } from '../src/wrapped/art';
import { parseRevealed, serializeRevealed } from '../src/wrapped/reveal';
import {
  SAMPLE_COVERAGE,
  SAMPLE_GENERATED_AT,
  SAMPLE_QUOTES,
  SAMPLE_WRAPPED,
  SAMPLE_WRAPPED_WITH_QUOTES,
  refusalSamples,
} from '../src/wrapped/sample';

const STATES: QuotesState[] = ['shown', 'waiting', 'off'];

/** The engine's own cards and words (`scripts/gen_copy.py`), the report's fixture. */
const FIXTURE = join(import.meta.dir, '..', '..', 'spec', 'fixtures', 'wrapped', 'cards.json');

interface FixtureCard {
  scenario?: string;
  card: ReportWrappedCard;
  quote?: QuoteWire | null;
  tz_offset_minutes?: number | null;
  question: string;
  display: string | null;
  sentence: string | null;
  refusal: string | null;
  local?: boolean;
}
// A fixed offset, so the crash out's clock reads the same on every machine that runs this.
const TZ = 0;

function quoteFor(card: ReportWrappedCard) {
  return SAMPLE_QUOTES.quotes.find((q) => q.card === card.id) ?? null;
}

function strings(f: Face): string[] {
  return [f.question, f.hero?.text, f.tail, f.sentence, f.refusal, f.quote, f.note, f.label].filter(
    (s): s is string => typeof s === 'string',
  );
}

/** The answer a person reads: the hero, or the quote that stands in for it. */
function answerOf(f: Face): string {
  return (f.hero?.text ?? f.quote ?? '').trim();
}

describe('every card renders a non empty answer or a refusal (the fixture report)', () => {
  test('all fifteen sample cards, in every quotes state, answered or refused, never empty', () => {
    for (const wrapped of [SAMPLE_WRAPPED, SAMPLE_WRAPPED_WITH_QUOTES]) {
      for (const state of STATES) {
        for (const card of wrapped.cards) {
          const f = faceOf(card, quoteFor(card), state, TZ);
          expect({ id: card.id, drawn: f !== null }).toEqual({ id: card.id, drawn: true });
          if (!f) continue;
          expect(f.question.length).toBeGreaterThan(0);
          if (card.reason == null) {
            expect({ id: card.id, answer: answerOf(f).length > 0 }).toEqual({ id: card.id, answer: true });
            expect(f.refusal).toBeNull();
          } else {
            expect(f.answered).toBe(false);
            expect(f.hero).toBeNull();
            expect((f.refusal ?? '').length).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  test('every refusal code the spec declares is worded, as a sentence, never the fallback', () => {
    const samples = refusalSamples();
    expect(samples.map((c) => c.reason).sort()).toEqual([...REPORT_ENUMS.wrapped_refusal].sort());
    for (const card of samples) {
      const f = faceOf(card, null, 'off', TZ)!;
      expect({ code: card.reason, refusal: f.refusal !== UNWORDED_REFUSAL }).toEqual({ code: card.reason, refusal: true });
      expect(f.refusal).toMatch(/^[A-Z0-9]/);
      expect(f.refusal).toMatch(/[.!?]$/);
      expect(f.answered).toBe(false);
      expect(f.hero).toBeNull();
      expect(f.quote).toBeNull();
    }
  });

  test('a refusal is never a zero standing in for an answer', () => {
    for (const card of refusalSamples()) {
      const f = faceOf(card, null, 'off', TZ)!;
      expect(f.hero).toBeNull();
      expect(f.refusal).not.toMatch(/^0\b/);
    }
  });

  test('a refused card with a code this build cannot word keeps its question and says so', () => {
    const card = { ...SAMPLE_WRAPPED.cards[0]!, value_id: null, reason: 'not_a_code' as never };
    const f = faceOf(card, null, 'off', TZ)!;
    expect(f.refusal).toBe(UNWORDED_REFUSAL);
    expect(f.question.length).toBeGreaterThan(0);
  });

  test('a card id this build does not know draws nothing, rather than a debug string', () => {
    const card = { ...SAMPLE_WRAPPED.cards[1]!, id: 'not_a_card' as never };
    expect(faceOf(card, null, 'off', TZ)).toBeNull();
  });

  test('the words are the copy layer\'s: the engine run\'s displays come back exactly', () => {
    const f = (id: string) => faceOf(SAMPLE_WRAPPED.cards.find((c) => c.id === id)!, null, 'off', TZ)!;
    // `python -m analysis wrapped ~/.builder-overnight/corpus --json`, 2026-09-13.
    expect(f('shipped').hero?.text).toBe('50,177');
    expect(f('shipped').tail).toBe('lines written, 247 commits');
    expect(f('builder_type').hero?.text).toBe('Quality guardian');
    expect(f('longest_session').hero?.text).toBe('3h 06m');
    expect(f('change_course').hero?.text).toBe('44%');
    expect(f('change_course').tail).toBe('of the time');
    expect(f('prompt_length').hero?.text).toBe('29.9');
    expect(f('time_put_in').tail).toBe('hours across 158 sessions');
  });
});

describe('the engine\'s fixture report (spec/fixtures/wrapped/cards.json)', () => {
  const fixture: FixtureCard[] = existsSync(FIXTURE) ? (JSON.parse(readFileSync(FIXTURE, 'utf8')) as FixtureCard[]) : [];

  test('the fixture is there, and covers every card id and every refusal code', () => {
    expect(fixture.length).toBeGreaterThan(0);
    expect(new Set(fixture.map((f) => f.card.id))).toEqual(new Set(REPORT_ENUMS.wrapped_card));
    const codes = new Set(fixture.map((f) => f.card.reason).filter((r) => r != null));
    for (const code of REPORT_ENUMS.wrapped_refusal) expect({ code, covered: codes.has(code) }).toEqual({ code, covered: true });
  });

  test('every fixture card draws a non empty answer or its refusal, in the engine\'s words', () => {
    for (const f of fixture) {
      const state: QuotesState = f.quote ? 'shown' : 'off';
      const face = faceOf(f.card, f.quote ?? null, state, f.tz_offset_minutes ?? undefined);
      const who = `${f.scenario ?? ''} ${f.card.id}`;
      expect({ who, drawn: face !== null }).toEqual({ who, drawn: true });
      if (!face) continue;
      expect({ who, question: face.question }).toEqual({ who, question: f.question });
      if (f.refusal !== null) {
        expect({ who, refusal: face.refusal }).toEqual({ who, refusal: refusalSentence(f.refusal) });
        expect(face.hero).toBeNull();
        continue;
      }
      expect({ who, answer: answerOf(face).length > 0 }).toEqual({ who, answer: true });
      if (face.quote !== null) {
        // The quote is the answer; the engine's display sits under it, word for word.
        expect({ who, tail: face.tail, sentence: face.sentence }).toEqual({ who, tail: f.display, sentence: f.sentence });
      } else if (f.display !== null) {
        const drawn = face.hero?.kind === 'count' && face.tail !== null ? `${face.hero.text} ${face.tail}` : face.hero?.text;
        expect({ who, display: drawn, sentence: face.sentence }).toEqual({ who, display: f.display, sentence: f.sentence });
      } else {
        // A LOCAL card without its quote: the count it has, never an invented number.
        expect({ who, hero: face.hero?.text }).toEqual({ who, hero: formatCount(f.card.n, 0, true, '', '') });
      }
    }
  });
});

describe('the quote cards', () => {
  const byId = (w: typeof SAMPLE_WRAPPED, id: string) => w.cards.find((c) => c.id === id)!;

  test('with quotes shown, the quote is the answer; cards 9 and 13 decrypt it, the go to prompt does not', () => {
    for (const id of QUOTE_CARDS) {
      const card = byId(SAMPLE_WRAPPED_WITH_QUOTES, id);
      const f = faceOf(card, quoteFor(card), 'shown', TZ)!;
      expect(f.quote).toBe(quoteFor(card)!.text);
      expect(f.hero).toBeNull();
      expect(f.note).toBeNull();
      expect(f.decrypt).toBe(DECRYPT_CARDS.includes(id));
      expect(f.label).toContain(quoteFor(card)!.text);
    }
    expect([...DECRYPT_CARDS].sort()).toEqual(['crash_out', 'cryptic_prompt']);
  });

  test('a quote the phone holds is never drawn while quotes are off or waiting', () => {
    for (const state of ['off', 'waiting'] as QuotesState[]) {
      for (const id of QUOTE_CARDS) {
        const card = byId(SAMPLE_WRAPPED_WITH_QUOTES, id);
        const f = faceOf(card, quoteFor(card), state, TZ)!;
        expect(f.quote).toBeNull();
        expect(strings(f).some((s) => s.includes(quoteFor(card)!.text))).toBe(false);
      }
    }
  });

  test('without its quote, a LOCAL card answers with the count it has and a quiet line', () => {
    const crash = faceOf(byId(SAMPLE_WRAPPED, 'crash_out'), null, 'off', TZ)!;
    expect(crash.hero?.kind).toBe('count');
    expect(crash.hero?.text).toBe('898');
    expect(crash.tail).toBe(LOCAL_COUNTS.crash_out.many);
    expect(crash.sentence).toBe(LOCAL_COUNTS.crash_out.sentence);
    expect(crash.note).toBe(QUOTE_NOTES.off);
    expect(faceOf(byId(SAMPLE_WRAPPED, 'crash_out'), null, 'waiting', TZ)!.note).toBe(QUOTE_NOTES.waiting);
    expect(faceOf(byId(SAMPLE_WRAPPED, 'crash_out'), null, 'shown', TZ)!.note).toBe(QUOTE_NOTES.missing);
    const one = faceOf({ ...byId(SAMPLE_WRAPPED, 'crash_out'), n: 1 }, null, 'off', TZ)!;
    expect(one.tail).toBe(LOCAL_COUNTS.crash_out.one);
  });

  test('the go to prompt keeps its counts answer and adds the quiet line', () => {
    const f = faceOf(byId(SAMPLE_WRAPPED, 'go_to_prompt'), null, 'off', TZ)!;
    expect(f.hero?.kind).toBe('words');
    expect(f.hero?.text).toBe('Sent 4 times across 4 sessions');
    expect(f.note).toBe(QUOTE_NOTES.off);
  });

  test('a refused quote card shows its refusal and no quiet line', () => {
    const f = faceOf(byId(SAMPLE_WRAPPED, 'cryptic_prompt'), null, 'off', TZ)!;
    expect(f.answered).toBe(false);
    expect(f.note).toBeNull();
  });

  test('where the switch stands: a document is shown unless the switch says off', () => {
    expect(quotesStateOf(SAMPLE_QUOTES, true)).toBe('shown');
    expect(quotesStateOf(SAMPLE_QUOTES, null)).toBe('shown');
    expect(quotesStateOf(SAMPLE_QUOTES, false)).toBe('off');
    expect(quotesStateOf(null, true)).toBe('waiting');
    expect(quotesStateOf(null, false)).toBe('off');
    expect(quotesStateOf(undefined, null)).toBe('off');
  });
});

describe('the count up lands on the number the copy wrote', () => {
  test('a leading number splits off and formats back to itself', () => {
    const cases: [string, string, string | null][] = [
      ['50,177 lines written, 247 commits', '50,177', 'lines written, 247 commits'],
      ['44% of the time', '44%', 'of the time'],
      ['29.9 words on average', '29.9', 'words on average'],
      ['1000 lines', '1000', 'lines'],
      ['3 sessions at once', '3', 'sessions at once'],
      ['7', '7', null],
      ['1,204,000.5 things', '1,204,000.5', 'things'],
    ];
    for (const [display, head, tail] of cases) {
      const { hero, tail: rest } = splitDisplay(display);
      expect(hero.kind).toBe('count');
      if (hero.kind !== 'count') continue;
      expect(hero.text).toBe(head);
      expect(rest).toBe(tail);
      expect(formatCount(hero.to, hero.decimals, hero.grouping, hero.prefix, hero.suffix)).toBe(head);
    }
  });

  test('an answer that does not open on a number is the hero as words', () => {
    for (const display of ['3h 06m', 'Quality guardian', 'Mostly source code.', 'No streak yet', 'A Thursday, at 7:03pm']) {
      expect(splitDisplay(display).hero).toEqual({ kind: 'words', text: display });
    }
  });

  test('every counted hero in the deck formats back to exactly its text', () => {
    for (const card of SAMPLE_WRAPPED.cards) {
      const f = faceOf(card, null, 'off', TZ);
      if (f?.hero?.kind !== 'count') continue;
      expect(formatCount(f.hero.to, f.hero.decimals, f.hero.grouping, f.hero.prefix, f.hero.suffix)).toBe(f.hero.text);
    }
  });
});

describe('no dashes in anything the deck says', () => {
  test('every string of every face, in every state, refusals included', () => {
    const faces: Face[] = [];
    for (const wrapped of [SAMPLE_WRAPPED, SAMPLE_WRAPPED_WITH_QUOTES]) {
      for (const state of STATES) {
        for (const card of wrapped.cards) {
          const f = faceOf(card, quoteFor(card), state, TZ);
          if (f) faces.push(f);
        }
      }
    }
    for (const card of refusalSamples()) faces.push(faceOf(card, null, 'off', TZ)!);
    const hits = faces.flatMap((f) => strings(f).filter((s) => s !== f.quote && hasDash(s)).map((s) => `${f.id}: ${s}`));
    expect(hits).toEqual([]);
  });

  test('the lines this module owns', () => {
    const own = [
      ...Object.values(QUOTE_NOTES),
      ...Object.values(LOCAL_COUNTS).flatMap((l) => [l.one, l.many, l.sentence]),
      UNWORDED_REFUSAL,
      SAMPLE_NOTE,
      STALE_NOTE,
      refusalSentence('fewer than 3 sessions'),
    ];
    expect(own.filter(hasDash)).toEqual([]);
  });
});

describe('the deck and its caption', () => {
  test('the deck is the report\'s cards in the engine order, each with a face', () => {
    const shuffled = { ...SAMPLE_WRAPPED, cards: [...SAMPLE_WRAPPED.cards].reverse() };
    const items = deckItems(shuffled, null, 'off', NO_SOURCES, TZ);
    expect(items.map((it) => it.card.id)).toEqual([...CARD_ORDER]);
  });

  test('a card nobody can draw honestly is left out; a refused one never is', () => {
    const broken = { ...SAMPLE_WRAPPED.cards[1]!, value: null }; // shipped, answered, no number
    const wrapped = { ...SAMPLE_WRAPPED, cards: [broken, ...refusalSamples().slice(0, 2)] };
    const items = deckItems(wrapped, null, 'off', NO_SOURCES, TZ);
    expect(items.map((it) => it.face.answered)).toEqual([false, false]);
  });

  test('the caption says what the numbers rest on and when, and labels a sample and a saved copy', () => {
    const now = Date.parse('2026-09-20T12:00:00Z');
    const meta = { generatedAt: SAMPLE_GENERATED_AT, coverage: SAMPLE_COVERAGE };
    expect(captionOf(meta, false, false, now)).toBe('158 sessions over 33 days, as of Sep 13');
    expect(captionOf(meta, true, false, now)).toBe(`158 sessions over 33 days, as of Sep 13. ${STALE_NOTE}`);
    expect(captionOf(meta, false, true, now)).toBe(`${SAMPLE_NOTE}. 158 sessions over 33 days, as of Sep 13`);
    expect(captionOf({ generatedAt: SAMPLE_GENERATED_AT, coverage: { ...SAMPLE_COVERAGE, sessions: 1, spans_days: 1 } }, false, false, now)).toBe(
      '1 session over 1 day, as of Sep 13',
    );
    expect(captionOf(null, false, false, now)).toBeNull();
    expect(hasDash(captionOf(meta, true, true, now)!)).toBe(false);
  });
});

describe('first reveal, per report', () => {
  test('the set round trips for its report and is empty for any other', () => {
    const raw = serializeRevealed('r1', ['shipped', 'builder_type', 'shipped']);
    expect([...parseRevealed(raw, 'r1')].sort()).toEqual(['builder_type', 'shipped']);
    expect(parseRevealed(raw, 'r2').size).toBe(0);
  });

  test('anything unreadable reveals again rather than being trusted', () => {
    expect(parseRevealed(null, 'r1').size).toBe(0);
    expect(parseRevealed('{not json', 'r1').size).toBe(0);
    expect(parseRevealed(JSON.stringify({ report: 'r1', ids: ['not_a_card', 7, 'streak'] }), 'r1')).toEqual(new Set(['streak']));
  });
});
