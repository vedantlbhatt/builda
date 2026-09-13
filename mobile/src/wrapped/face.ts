/**
 * What one Wrapped card draws, from the card on the wire. Pure, so `bun test` holds every
 * rule here.
 *
 * THE WORDS ARE NOT WRITTEN HERE. The question, the answer, the sentence and the refusal
 * come from `renderCard` (`src/copy/wrapped.ts`, the port of the engine pinned to Python by
 * `spec/fixtures/wrapped/cards.json`); this module only decides where each piece sits:
 *
 *   - the answer's leading number becomes the hero and counts up on its first reveal, and
 *     the rest of the answer sits under it ("50,177" over "lines written, 247 commits");
 *     an answer that does not start with a number is the hero as words ("Quality guardian");
 *   - a refused card draws its refusal where the answer would be, never a 0 and never "--";
 *   - the three cards that can quote a prompt show the quote only while quotes are on and
 *     the machine has sent one, and otherwise say, quietly, how to see it.
 *
 * The sentences this module owns: the quiet lines, the counts only answer of the two LOCAL
 * cards (crash out, cryptic prompt) when their quote is not here, and one refusal that
 * should never show. Each is held to the no dashes rule by `__tests__/wrappedFace.test.ts`.
 */
import { QUESTIONS } from '../copy/catalog';
import { capital } from '../copy/numbers';
import { renderCard, type RenderedCard } from '../copy/wrapped';
import type { QuoteWire } from '../generated/quotes';
import type { ReportWrappedCard, WrappedCard } from '../generated/report';
import { formatCount } from '../ui/format';

/**
 * Where the owner's quotes stand. `shown`: a quotes document arrived. `waiting`: the switch
 * is on and the machine has not sent one. `off`: the switch is off, or this phone could not
 * ask (either way, turning it on is the one thing that helps).
 */
export type QuotesState = 'shown' | 'waiting' | 'off';

/** The cards that can quote a prompt, in card order (the contract's `quote_card`). */
export const QUOTE_CARDS: readonly WrappedCard[] = ['go_to_prompt', 'crash_out', 'cryptic_prompt'];

/**
 * Cards 9 and 13 reveal their quote with the decrypt (DESIGN-DIRECTION 6). The go to
 * prompt quotes too, but plainly: the scramble is kept for the two cards about how a prompt
 * READ, where it is the point.
 */
export const DECRYPT_CARDS: readonly WrappedCard[] = ['crash_out', 'cryptic_prompt'];

export const QUOTE_NOTES = {
  off: 'Turn on quotes in Settings to see it.',
  waiting: 'Quotes are on. Run capture report with quotes on your Mac to send it.',
  missing: 'Its quote was not in the last quotes your Mac sent.',
} as const;

/**
 * The two LOCAL cards answered without their quote. Every number on them is a reading of
 * what somebody typed, so the wire carries only how many prompts were read (`n`); that is
 * the answer, and the sentence says where the rest is.
 */
export const LOCAL_COUNTS = {
  crash_out: { one: 'prompt read', many: 'prompts read', sentence: 'The angriest one stays on your Mac.' },
  cryptic_prompt: { one: 'short prompt read', many: 'short prompts read', sentence: 'The most cryptic one stays on your Mac.' },
} as const;

/**
 * A refused card the copy layer had no words for (a refusal code this build does not
 * know). It should never show: the face test walks every code and fails if one lands here.
 */
export const UNWORDED_REFUSAL = 'Not enough to answer this yet.';

export type Hero =
  | {
      kind: 'count';
      /** The number the count up lands on. */
      to: number;
      decimals: number;
      /** Thousands commas, exactly when the answer wrote them. */
      grouping: boolean;
      prefix: string;
      suffix: string;
      /** The number as the answer wrote it; the count up's last frame is exactly this. */
      text: string;
    }
  | { kind: 'words'; text: string };

export interface Face {
  id: WrappedCard;
  question: string;
  answered: boolean;
  /** The big answer, or null on a refusal and on a card whose quote is the answer. */
  hero: Hero | null;
  /** The rest of the answer after a counted number, or the answer under a quote. */
  tail: string | null;
  sentence: string | null;
  /** The refusal, where the answer would be, as a sentence. Null when answered. */
  refusal: string | null;
  /** The owner's own prompt, verbatim, only with quotes shown. */
  quote: string | null;
  /** Reveal the quote with the decrypt (cards 9 and 13). */
  decrypt: boolean;
  /** The quiet line under a quote card that could not show its quote. */
  note: string | null;
  /** A card that can quote: sharing it with its quote on it warns first. */
  quoteCard: boolean;
  /** Everything the card says, in reading order, for VoiceOver and the share sheet title. */
  label: string;
}

/**
 * A leading number, as a person wrote it: grouped thousands or plain digits, an optional
 * decimal part, an optional percent sign, then a space or the end. "3h 06m" does not match
 * (the "h" is glued on), so a duration is the hero as words rather than a number counting
 * up to "3" with "h 06m" stuck to it.
 */
const LEADING_NUMBER = /^(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(%)?(?=\s|$)/;

/**
 * Split an answer into its hero and the rest. The counted hero's last frame is the answer's
 * own spelling of the number (`formatCount(to, decimals, grouping, prefix, suffix)` gives
 * back `text` exactly; the test holds it), so the count up can never land on a different
 * number from the one the copy layer wrote.
 */
export function splitDisplay(display: string): { hero: Hero; tail: string | null } {
  const text = display.trim();
  const m = LEADING_NUMBER.exec(text);
  if (!m) return { hero: { kind: 'words', text }, tail: null };
  const whole = m[1]!;
  const fraction = m[2] ?? '';
  const percent = m[3] ?? '';
  const head = m[0];
  const tail = text.slice(head.length).trim();
  return {
    hero: {
      kind: 'count',
      to: Number(whole.replace(/,/g, '') + fraction),
      decimals: fraction ? fraction.length - 1 : 0,
      grouping: whole.includes(','),
      prefix: '',
      suffix: percent,
      text: head,
    },
    tail: tail === '' ? null : tail,
  };
}

/** The engine words a refusal lower case with no full stop; a card says it as a sentence. */
export function refusalSentence(words: string): string {
  const t = capital(words.trim());
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

function clean(s: string | null | undefined): string | null {
  const t = (s ?? '').trim();
  return t === '' ? null : t;
}

function labelOf(parts: (string | null)[]): string {
  return parts.filter((p): p is string => p !== null).join(' ');
}

function refused(card: ReportWrappedCard, question: string, refusal: string): Face {
  return {
    id: card.id,
    question,
    answered: false,
    hero: null,
    tail: null,
    sentence: null,
    refusal,
    quote: null,
    decrypt: false,
    note: null,
    quoteCard: QUOTE_CARDS.includes(card.id),
    label: labelOf([question, refusal]),
  };
}

/**
 * The face of one card, or null when there is nothing honest to draw: an id this build does
 * not know, or an answered card whose words need a number the wire left out (the copy layer
 * renders those as nothing, never as a zero, and the deck leaves them out).
 *
 * `quote` is this card's entry in the quotes document, or null. `quotes` is where the
 * switch stands; a quote reaches the copy layer and the card only when it is `shown`, so a
 * stale quote this phone still holds after the switch went off is never drawn.
 */
export function faceOf(
  card: ReportWrappedCard,
  quote: QuoteWire | null,
  quotes: QuotesState,
  tzOffsetMinutes?: number,
): Face | null {
  const quoteCard = QUOTE_CARDS.includes(card.id);
  const shown = quoteCard && quotes === 'shown' && quote !== null && quote.card === card.id ? quote : null;
  const r: RenderedCard | null = renderCard(card, { quote: shown, tzOffsetMinutes });

  if (r === null) {
    const question = (QUESTIONS as Partial<Record<string, string>>)[card.id];
    return card.reason != null && question ? refused(card, question, UNWORDED_REFUSAL) : null;
  }
  const question = r.question;
  if (r.refusal !== null) return refused(card, question, refusalSentence(r.refusal));

  const display = clean(r.display);
  const sentence = clean(r.sentence);
  const quoteText = shown ? clean(shown.text) : null;
  const note =
    quoteCard && quoteText === null
      ? quotes === 'shown'
        ? QUOTE_NOTES.missing
        : quotes === 'waiting'
          ? QUOTE_NOTES.waiting
          : QUOTE_NOTES.off
      : null;

  const base = { id: card.id, question, answered: true, refusal: null, quoteCard } as const;

  if (quoteText !== null) {
    // The quote is the answer (Paxel's own anatomy: "make it prettier" is the title); the
    // copy layer's answer sits under it as the caption.
    return {
      ...base,
      hero: null,
      tail: display,
      sentence,
      quote: quoteText,
      decrypt: DECRYPT_CARDS.includes(card.id),
      note: null,
      label: labelOf([question, `“${quoteText}”`, display, sentence]),
    };
  }

  if (r.local && display === null) {
    const words = LOCAL_COUNTS[card.id as keyof typeof LOCAL_COUNTS];
    if (!words) return null;
    const count = formatCount(card.n, 0, true, '', '');
    const tail = card.n === 1 ? words.one : words.many;
    return {
      ...base,
      hero: { kind: 'count', to: card.n, decimals: 0, grouping: true, prefix: '', suffix: '', text: count },
      tail,
      sentence: words.sentence,
      quote: null,
      decrypt: false,
      note,
      label: labelOf([question, `${count} ${tail}`, words.sentence, note]),
    };
  }

  if (display === null) return null;
  const split = splitDisplay(display);
  return {
    ...base,
    hero: split.hero,
    tail: split.tail,
    sentence,
    quote: null,
    decrypt: false,
    note,
    label: labelOf([question, display, sentence, note]),
  };
}

/** Where the switch stands, from what the phone could learn. */
export function quotesStateOf(doc: { quotes: readonly unknown[] } | null | undefined, switchOn: boolean | null): QuotesState {
  if (doc) return switchOn === false ? 'off' : 'shown';
  return switchOn === true ? 'waiting' : 'off';
}
