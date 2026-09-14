/**
 * A shared Wrapped card never carries the owner's prompt.
 *
 * FOUND IN THE ADVERSARIAL REVIEW (2026-09-13): the share preview drew the story card as it
 * stood, and `heroOf` returns the quote for every variant, so the 1080 by 1350 image a person
 * sends anyone printed their prompt verbatim, while the contract's `quotes` document and
 * PRIVACY.md both say quotes are "never in a post, a feed, a share, a push or a Live Activity".
 * The share now draws the card as it stands with quotes off: the counts only answer, and no
 * quiet note (it tells the owner how to see their quote, which is nobody else's business).
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { deckItems, shareItem } from '../src/wrapped/deckItems';
import { LOCAL_COUNTS, QUOTE_CARDS } from '../src/wrapped/face';
import { SAMPLE_QUOTES, SAMPLE_SOURCES, SAMPLE_WRAPPED_WITH_QUOTES } from '../src/wrapped/sample';
import { heroOf } from '../src/wrapped/story';

const MOBILE = join(import.meta.dir, '..');
const quoted = deckItems(SAMPLE_WRAPPED_WITH_QUOTES, SAMPLE_QUOTES, 'shown', SAMPLE_SOURCES);
const texts = SAMPLE_QUOTES.quotes.map((q) => q.text);

describe('a shared card', () => {
  test('the sample really quotes: three cards draw a prompt in the story', () => {
    const drawn = quoted.filter((it) => heroOf(it.face, it.card).kind === 'quote').map((it) => it.card.id);
    expect(drawn.sort()).toEqual([...QUOTE_CARDS].sort());
  });

  test('never draws the quote, in its hero, its words or its label', () => {
    for (const item of quoted) {
      const shared = shareItem(item);
      expect({ id: item.card.id, quote: shared.face.quote }).toEqual({ id: item.card.id, quote: null });
      expect(heroOf(shared.face, shared.card).kind).not.toBe('quote');
      const drawn = JSON.stringify(shared.face);
      for (const t of texts) expect({ id: item.card.id, leaked: drawn.includes(t) }).toEqual({ id: item.card.id, leaked: false });
      expect(shared.face.note).toBeNull();
    }
  });

  test('the two LOCAL cards share the counts only answer', () => {
    for (const id of ['crash_out', 'cryptic_prompt'] as const) {
      const item = quoted.find((it) => it.card.id === id)!;
      const hero = heroOf(shareItem(item).face, item.card);
      expect(hero.kind).toBe('count');
      const words = LOCAL_COUNTS[id];
      expect([words.one, words.many] as string[]).toContain(shareItem(item).face.tail!);
      expect(shareItem(item).face.sentence).toBe(words.sentence);
    }
  });

  test('a card that quotes nothing shares exactly what the story draws', () => {
    for (const item of quoted.filter((it) => !QUOTE_CARDS.includes(it.card.id))) {
      const shared = shareItem(item);
      expect({ id: item.card.id, face: { ...shared.face, note: null } }).toEqual({ id: item.card.id, face: { ...item.face, note: null } });
    }
  });

  test('the share preview draws the share item, and makes no promise the image breaks', () => {
    const src = readFileSync(join(MOBILE, 'src', 'wrapped', 'SharePreview.tsx'), 'utf8');
    expect(src).toContain('shareItem(item)');
    expect(src).toMatch(/<StoryCard item=\{shared\}/);
    expect(src).not.toMatch(/<StoryCard item=\{item\}/);
    expect(src).not.toContain('QUOTE_WARNING');
  });
});
