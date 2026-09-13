/**
 * The Wrapped story's rules, pure, so `bun test` holds every one: which hue each card wears,
 * what its answer is drawn as (a count up, a departures board, a quote, a refusal), how a word
 * answer breaks into lines that fit, the type on each size of card, when each piece arrives, the
 * progress row, and the creature's pixels, blink and gesture.
 *
 * WHERE THE STYLE CAME FROM (design-refs/HOUSE-STYLE.md, the owner's pick on 2026-09-13: the
 * analysis page's full bleed colour bands with huge counted numbers and pixel printed creatures).
 * A Wrapped card IS one of those bands, full height: its hue, the question and the answer in dark
 * ink, the answer huge, one sentence, and the card's own data printed under them.
 *
 * What the owner's sources gave, each where it is used below:
 *   - Spotify (design-refs/awesome-ios-design-md/design-md/music/spotify): Wrapped is "full screen
 *     immersive moments ... huge display type (48 to 72pt)", one colour story per slide, and the
 *     answer set in dark ink on the colour the way Spotify sets black on its green. Taken: one hue
 *     per card, the answer at 56 to 172pt, a segmented progress row, tap right for the next card.
 *   - Strava (fitness/strava): "Hero Stat 44pt weight 900 (Black), line 1.0, tracking -0.6", every
 *     number tabular. Taken: the counted answer is SF Pro at 900, tight, tabular (`HERO_WEIGHT`).
 *   - Duolingo (misc/duolingo): the mascot is "a personality, not a decoration"; it peeks in at a
 *     corner (~80pt) and celebrates. Taken: the builder's creature prints itself where the card has
 *     room, blinks once and does its one gesture, then rests (`STAGE.blink`, `STAGE.gesture`).
 *   - Appllama top-welcome-screens (GPL: timings only): the Duolingo owl blink measured at
 *     0.400 to 0.567 s, 167 ms (`STAGE.blinkMs`); Yazio's objects "enter as separately staggered
 *     damped springs" over about half a second (the grid's stagger).
 *   - Appllama liquid-glass-screens (GPL: timings only): "headline and pill: 520 ms
 *     bezier(0.23, 1, 0.32, 1) in after landing", the kit's own curve (`STAGE.tail`), and the 25%
 *     rubber band the stack already uses past the last card.
 *   - Appllama animated-card-stack (MIT): the stack's motion tables, in `deck.ts` with its notice.
 */
import { ANIMAL_FRAMES, type Animal } from '../pixel/animals';
import { EYES } from '../pixel/frames';
import type { ReportWrappedCard, WrappedCard } from '../generated/report';
import { tokens } from '../generated/tokens';
import { formatWith, numSpec, type NumSpec } from '../insights/format';
import { cardHue, type CardId, type Hue, type HueName } from '../theme';
import { UNWORDED_REFUSAL, type Face } from './face';

// ─── hues ───────────────────────────────────────────────────────────────────────────────

/**
 * The archetype whose creature wears `name` (`tokens.spectrum.archetype`), so the one rule that
 * steps cards two and three off card one's hue (`theme.cardHue`, `spectrum.cardAlt`) is the rule
 * here too, never a second copy of it. Every hue has one; the generalist wears amber.
 */
export function archetypeWearing(name: HueName): string {
  for (const [id, wears] of Object.entries(tokens.spectrum.archetype)) {
    if (!id.startsWith('_') && wears === name) return id;
  }
  return 'generalist';
}

/**
 * A card's hue in the story. Card one ("Which kind of builder are you?") is the builder: it wears
 * the builder's creature's hue, the app's theme (HOUSE-STYLE, "the theme is your creature's
 * colour"), the way the analysis page's "Your type" band does. Every other card wears its own
 * (`tokens.spectrum.card`), stepping off card one's where the tokens say to, so no card meets its
 * own hue next to it in the story or across and down the two column grid (the test walks every
 * creature).
 */
export function storyHue(card: WrappedCard, oneHue: HueName): Hue {
  return cardHue(card as CardId, archetypeWearing(oneHue), 'dark');
}

/** Ink on every hue: the light scheme's text, 4.5:1 or better on all nine (the V2 floor). */
export const ON_BAND = tokens.surface.text.light;

// ─── what the answer is drawn as ────────────────────────────────────────────────────────

export type StoryHero =
  /** A number that counts up from 0 and rests on exactly the copy layer's spelling. */
  | { kind: 'count'; spec: NumSpec }
  /** Words, flipped in on a departures board. */
  | { kind: 'words'; text: string }
  /** The owner's own prompt, in quotation marks: only when quotes are on and it arrived. */
  | { kind: 'quote'; text: string }
  /** No answer: why not, as a sentence, where the answer would be. Never a 0, never a dash. */
  | { kind: 'refusal'; text: string };

/**
 * The answer, as the card draws it. A counted hero counts to the number the answer WRITES
 * (`numSpec`), so its last frame is the answer's own text. A duration ("3h 06m") is a count
 * too, of the card's seconds in `floorMins` shape, but only when that shape writes exactly
 * the words the copy layer wrote; anything else stays words.
 */
export function heroOf(face: Face, card: ReportWrappedCard): StoryHero {
  if (!face.answered) return { kind: 'refusal', text: face.refusal ?? UNWORDED_REFUSAL };
  if (face.quote !== null) return { kind: 'quote', text: `“${face.quote}”` };
  const h = face.hero;
  if (h?.kind === 'count') return { kind: 'count', spec: numSpec(h.to, h.text) };
  if (h?.kind === 'words') {
    const secs = card.value;
    if (card.unit === 'seconds' && typeof secs === 'number' && secs >= 3600 && formatWith({ kind: 'floorMins' }, secs) === h.text) {
      return { kind: 'count', spec: { value: secs, final: h.text, fmt: { kind: 'floorMins' } } };
    }
    return { kind: 'words', text: h.text };
  }
  // A face with neither: its answer under a quote that did not come (`faceOf` never builds one).
  return { kind: 'words', text: face.tail ?? face.question };
}

// ─── a word answer on the board ─────────────────────────────────────────────────────────

/**
 * SF Mono's advance, in ems: every glyph is 1229 units of 2048, at every weight. The board's
 * tiles are as wide as a "0" (`SplitFlapText` measures it), so a line of n characters is
 * `n * MONO_ADVANCE * size` points wide.
 */
export const MONO_ADVANCE = 0.6;
/** The board's lines, as a multiple of the size. */
export const FLAP_LINE = 1.06;
/** A line never runs closer to the card's edge than this share of its width. */
const FIT = 0.97;

export interface FlapLayout {
  lines: string[];
  size: number;
  lineHeight: number;
}

/**
 * `words` in order, in exactly `n` lines, so the longest line is as short as it can be (the
 * lines a person would break it into), top heavy on a tie. Null when there are fewer words than
 * lines.
 */
export function balanceLines(words: readonly string[], n: number): string[] | null {
  const count = words.length;
  if (n < 1 || n > count) return null;
  const len = (a: number, b: number) => words.slice(a, b).join(' ').length;
  // best[i][k]: the shortest longest line for words[i..] in k lines, and where the first ends.
  const memo = new Map<string, { worst: number; cut: number }>();
  const solve = (i: number, k: number): { worst: number; cut: number } => {
    const key = `${i}:${k}`;
    const hit = memo.get(key);
    if (hit) return hit;
    let best = { worst: Number.POSITIVE_INFINITY, cut: count };
    if (k === 1) best = { worst: len(i, count), cut: count };
    else {
      for (let j = i + 1; j <= count - (k - 1); j++) {
        const worst = Math.max(len(i, j), solve(j, k - 1).worst);
        // On a tie the first line takes more: a headline breaks top heavy ("Sent 4 times /
        // across 4 / sessions", not "Sent 4 / times across / 4 sessions").
        if (worst <= best.worst) best = { worst, cut: j };
      }
    }
    memo.set(key, best);
    return best;
  };
  const out: string[] = [];
  let i = 0;
  for (let k = n; k >= 1; k--) {
    const { cut } = solve(i, k);
    out.push(words.slice(i, cut).join(' '));
    i = cut;
  }
  return out;
}

export interface FlapOptions {
  maxSize: number;
  minSize: number;
  maxLines: number;
  /** The tallest the whole board may be, in points. */
  maxHeight: number;
}

/**
 * The biggest the answer can be on the board: one to `maxLines` balanced lines, each fitting
 * the width in SF Mono, the whole under `maxHeight`. Null when no arrangement reaches
 * `minSize` (a long quote): the caller sets the words as a paragraph instead. Every word is
 * kept, in order; nothing is ever cut.
 */
export function flapLayout(text: string, width: number, o: FlapOptions): FlapLayout | null {
  const words = text.trim().split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0 || width <= 0) return null;
  let best: FlapLayout | null = null;
  for (let n = 1; n <= Math.min(o.maxLines, words.length); n++) {
    const lines = balanceLines(words, n);
    if (!lines) continue;
    const longest = lines.reduce((m, l) => Math.max(m, l.length), 0);
    let size = Math.min(o.maxSize, Math.floor((width * FIT) / (MONO_ADVANCE * longest)));
    size = Math.min(size, Math.floor(o.maxHeight / (n * FLAP_LINE)));
    if (size < o.minSize) continue;
    if (!best || size > best.size) best = { lines, size, lineHeight: Math.round(size * FLAP_LINE) };
  }
  return best;
}

// ─── the type on each size of card ──────────────────────────────────────────────────────

export type CardVariant = 'story' | 'share';

export interface CardType {
  /** Inside the band, round the words. */
  pad: number;
  gap: number;
  index: number;
  question: number;
  questionLine: number;
  /** A counted answer: fitted to the width between these (Strava's 900 weight). */
  heroMax: number;
  heroMin: number;
  /** A word answer on the board. */
  flapMax: number;
  flapMin: number;
  flapLines: number;
  quoteMin: number;
  quoteLines: number;
  /** The board may take at most this share of the card's height. */
  boardShare: number;
  tail: number;
  tailLine: number;
  sentence: number;
  sentenceLine: number;
  note: number;
  noteLine: number;
  refusal: number;
  refusalLine: number;
  /**
   * Air between the last line of words and the art under them. FOUND IN THE FINAL CAPTURE
   * (2026-09-13, shot 65): card 13's mosaic fills its box to the top, and its sentence's second
   * line sat on the first row of cells. The words keep this much ground under them on every card.
   */
  artGap: number;
  /** The art never gets less than this; the answer gives way first (`SQUEEZE`). */
  minArt: number;
  /** The creature's sizes where the art has room, largest first: whole 3 and 4 point pixels. */
  creature: readonly number[];
}

export const CARD_TYPE: Record<CardVariant, CardType> = {
  story: {
    pad: 20,
    gap: 10,
    index: 13,
    question: 24,
    questionLine: 29,
    heroMax: 172,
    heroMin: 56,
    flapMax: 104,
    flapMin: 36,
    flapLines: 3,
    quoteMin: 26,
    quoteLines: 5,
    boardShare: 0.34,
    tail: 20,
    tailLine: 25,
    sentence: 17,
    sentenceLine: 22,
    note: 14,
    noteLine: 19,
    refusal: 25,
    refusalLine: 31,
    artGap: 18,
    minArt: 104,
    creature: [64, 48],
  },
  // The 4:5 export (360 by 450 points): the same card with less height to share out.
  share: {
    pad: 18,
    gap: 6,
    index: 11,
    question: 17,
    questionLine: 21,
    heroMax: 112,
    heroMin: 44,
    flapMax: 64,
    flapMin: 26,
    flapLines: 3,
    quoteMin: 20,
    quoteLines: 5,
    boardShare: 0.3,
    tail: 15,
    tailLine: 19,
    sentence: 13,
    sentenceLine: 17,
    note: 12,
    noteLine: 16,
    refusal: 18,
    refusalLine: 23,
    artGap: 12,
    minArt: 84,
    creature: [48],
  },
};

/** SF Pro Black for the counted answer: Strava's hero stat. */
export const HERO_WEIGHT = '900' as const;

/**
 * When the words run long enough to squeeze the art under `minArt`, the answer gives way in
 * these steps (measured on the first layout, then fixed): the art keeps its room and nothing
 * the card says is ever cut.
 */
export const SQUEEZE = [1, 0.84, 0.7, 0.58] as const;

export function nextSqueeze(step: number, cardHeight: number, wordsHeight: number, minArt: number): number {
  if (cardHeight - wordsHeight >= minArt) return step;
  return Math.min(SQUEEZE.length - 1, step + 1);
}

// ─── when each piece arrives ────────────────────────────────────────────────────────────

/**
 * Milliseconds after a card reaches the front (read off its block's reveal clock). Everything
 * has landed by `STAGE.gesture + STAGE.gestureMs`, inside the clock's 3.2 s, and then only the
 * art breathes.
 */
export const STAGE = {
  /** The question, word by word (react-bits SplitText). */
  question: 60,
  /** The answer: the count or the board. The analysis band's words land at 240. */
  hero: 240,
  /** Lines of the board, one after another. */
  boardLine: 140,
  /** The rest of the answer: 520 ms after landing, the liquid glass headline's beat. */
  tail: 520,
  sentence: 640,
  note: 760,
  /** The art prints itself along its own axis (cells arriving in a random order, biased). */
  art: 160,
  artMs: 760,
  /** One wave through the art from where the finger was, PixelBlast's ripple. */
  ripple: 300,
  /** The creature prints once the art has, pixel by pixel. */
  creature: 820,
  creatureSpread: 420,
  /** Then it blinks, the Duolingo owl's 167 ms, */
  blink: 1640,
  blinkMs: 167,
  /** and makes its one gesture, then rests for good. */
  gesture: 2060,
  gestureMs: 360,
} as const;

/** The story arms its first card this long after it mounts, so nothing plays under the modal's slide. */
export const OPEN_HOLD_MS = 420;

// ─── the screen's states ────────────────────────────────────────────────────────────────

export type DeckStatus = 'loading' | 'signed_out' | 'no_report' | 'no_cards' | 'error' | 'ready';

/** The states a dev link can put the sample deck in (`?sample=1&state=...`), for screenshots. */
export const FORCEABLE: readonly DeckStatus[] = ['loading', 'signed_out', 'no_report', 'no_cards', 'error'];

export function forcedState(raw: string | undefined): DeckStatus | null {
  return raw !== undefined && (FORCEABLE as readonly string[]).includes(raw) ? (raw as DeckStatus) : null;
}

// ─── the progress row ───────────────────────────────────────────────────────────────────

export type Segment = 'seen' | 'current' | 'ahead';

/** One segment a card: the ones before the front seen, the front current, the rest ahead. */
export function progressSegments(count: number, front: number): Segment[] {
  const n = Math.max(0, Math.floor(count));
  const f = Math.min(Math.max(0, Math.floor(front)), Math.max(0, n - 1));
  return Array.from({ length: n }, (_, i) => (i < f ? 'seen' : i === f ? 'current' : 'ahead'));
}

// ─── the story's box ────────────────────────────────────────────────────────────────────

/** Space between the card and the screen's edge: the next cards' corners show past it. */
export const STORY_GUTTER = 10;
/** Above and below the card, inside the box between the top and bottom bars. */
export const STORY_BREATH = 6;

export function storyCardSize(box: { w: number; h: number }): { width: number; height: number } {
  return { width: Math.max(0, Math.floor(box.w - STORY_GUTTER * 2)), height: Math.max(0, Math.floor(box.h - STORY_BREATH * 2)) };
}

/** The share card: 4:5, the 1080 by 1350 portrait export (`tokens.card.portrait`). */
export const SHARE_RATIO = tokens.card.portrait.h / tokens.card.portrait.w;
/** The grid's small cards: 4:5 too, so the grid is the share cards in miniature. */
export const GRID_RATIO = SHARE_RATIO;

// ─── the creature ───────────────────────────────────────────────────────────────────────

const GRID = 16;

export interface CreaturePixel {
  x: number;
  y: number;
  /** When it prints, in ms of the card's clock. */
  at: number;
}

export interface CreaturePlan {
  /** The rest pose, each pixel with its moment. */
  rest: CreaturePixel[];
  /** The eye holes, filled while it blinks. */
  eyes: { x: number; y: number }[];
  /** Pixels its gesture adds, and which rest pixels (by index) it lifts. */
  add: { x: number; y: number }[];
  drop: boolean[];
}

/** A small stable hash in [0, 1): the print order, the same on every phone. */
function orderHash(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function inked(frame: readonly string[] | undefined): Set<string> {
  const out = new Set<string>();
  (frame ?? []).forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] !== '.') out.add(`${x},${y}`);
  });
  return out;
}

/**
 * The builder's creature on a card: its rest pose (frame 0 of the pack), printing in a random
 * order biased to the top like the band it sits on (`CreaturePrint`'s rule), its eyes for the
 * blink (the pack's `EYES`, holes in every rest pose), and its signature gesture (the pack's
 * last frame) as what it adds and lifts.
 */
export function creaturePlan(animal: Animal, printAt: number, spread: number): CreaturePlan {
  const frames = ANIMAL_FRAMES[animal] ?? [];
  const rest = inked(frames[0]);
  const gesture = inked(frames[frames.length - 1]);
  const restCells: CreaturePixel[] = [];
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (!rest.has(`${x},${y}`)) continue;
      restCells.push({ x, y, at: printAt + (orderHash(x, y, 7) * 0.7 + (y / GRID) * 0.3) * spread });
    }
  }
  const eyes = EYES.filter(([x, y]) => !rest.has(`${x},${y}`)).map(([x, y]) => ({ x, y }));
  const add: { x: number; y: number }[] = [];
  for (const key of gesture) {
    if (rest.has(key)) continue;
    const [x, y] = key.split(',').map(Number) as [number, number];
    add.push({ x, y });
  }
  return { rest: restCells, eyes, add, drop: restCells.map((c) => !gesture.has(`${c.x},${c.y}`)) };
}

// ─── the words this module owns ─────────────────────────────────────────────────────────

/**
 * The screen's own sentences (the cards' words come from the copy layer). Each is held to the
 * no dashes rule by `__tests__/wrappedStory.test.ts`.
 */
export const STORY_COPY = {
  title: 'Wrapped',
  share: 'Share',
  everyCard: 'Show every card',
  oneAtATime: 'Show one card at a time',
  close: 'Close',
  gridHint: 'Tap a card to open it.',
  reading: 'Reading your cards.',
  shareTitle: 'Share this card',
  shareAction: 'Share image',
  shareBusy: 'Making the image',
  cancel: 'Cancel',
  wordmark: 'Builda',
  checking: 'Checking',
} as const;

/**
 * Every state that is not a deck, as a band: what is missing, why, and the one thing that helps
 * (DESIGN-DIRECTION 9). An error shows the api layer's own words where it has them.
 */
export const EMPTY_COPY = {
  signed_out: {
    title: 'Sign in to see your cards.',
    text: 'Your Mac works them out from the sessions you finish and sends them with its report.',
    action: 'Open Settings',
  },
  no_report: {
    title: 'No report from your Mac yet.',
    text: 'The cards are worked out on your Mac from your transcripts and arrive with its next report. If no Mac is connected to this account yet, start there.',
    action: 'Connect your Mac',
  },
  no_cards: {
    title: 'This report has no cards in it.',
    text: 'Your Mac sent it from a version of capture that does not work the cards out. They arrive with a report from a newer one.',
    action: 'Check again',
  },
  error: {
    title: 'Could not load your cards.',
    text: 'Builda is not reachable right now.',
    action: 'Try again',
  },
} as const;
