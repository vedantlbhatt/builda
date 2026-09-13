/**
 * The Wrapped story (`src/wrapped/story.ts`, `src/wrapped/field.ts`): which hue each card wears,
 * what each answer is drawn as and that a count lands on the answer's own words, the board's
 * lines, the progress row, the creature, and the living art, whose program is compiled through
 * CanvasKit (React Native Skia's own SkSL compiler) and read back cell by cell: at rest it is
 * exactly the card's data in three levels, and its motion only ever thins that data.
 */
import { beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { CanvasKit, RuntimeEffect } from 'canvaskit-wasm';

import { hasDash } from '../src/copy/plain';
import { REPORT_ENUMS, type ReportWrapped, type ReportWrappedCard } from '../src/generated/report';
import { formatWith } from '../src/insights/format';
import { ANIMAL_FRAMES, ANIMALS } from '../src/pixel/animals';
import { EYES } from '../src/pixel/frames';
import { creatureHue, hue, type HueName } from '../src/theme';
import { bayer8, premultiplied, type Field } from '../src/ui/dithering';
import { artFor, fieldOf, NO_SOURCES } from '../src/wrapped/art';
import { CARD_ORDER } from '../src/wrapped/deck';
import { deckItems } from '../src/wrapped/deckItems';
import { faceOf } from '../src/wrapped/face';
import {
  CORNERS,
  creatureSpot,
  DATA_FIELD_SKSL,
  FIELD,
  printAxis,
  restTone,
  cellValue,
} from '../src/wrapped/field';
import { refusedDeck, refusalSamples, SAMPLE_QUOTES, SAMPLE_SOURCES, SAMPLE_WRAPPED, SAMPLE_WRAPPED_WITH_QUOTES } from '../src/wrapped/sample';
import {
  archetypeWearing,
  balanceLines,
  CARD_TYPE,
  creaturePlan,
  EMPTY_COPY,
  flapLayout,
  heroOf,
  MONO_ADVANCE,
  nextSqueeze,
  ON_BAND,
  progressSegments,
  SQUEEZE,
  STAGE,
  FORCEABLE,
  forcedState,
  STORY_COPY,
  storyCardSize,
  storyHue,
} from '../src/wrapped/story';

const FIXTURE = join(import.meta.dir, '..', '..', 'spec', 'fixtures', 'wrapped', 'cards.json');

/** Every creature's hue: the builder's theme, and so card one's. */
const CREATURE_HUES: HueName[] = [...new Set(ANIMALS.map((a) => creatureHue(a).name))];

// ─── hues ───────────────────────────────────────────────────────────────────────────────

describe('each card in its own hue, card one in the builder\'s', () => {
  test('card one wears the builder\'s creature\'s hue, for every creature', () => {
    for (const animal of ANIMALS) {
      const own = creatureHue(animal).name;
      expect({ animal, hue: storyHue('builder_type', own).name }).toEqual({ animal, hue: own });
    }
  });

  test('no card meets its own hue next to it in the story, or across and down the two column grid', () => {
    for (const one of [...CREATURE_HUES, 'amber' as HueName]) {
      const hues = CARD_ORDER.map((id) => storyHue(id, one).name);
      for (let i = 0; i < hues.length; i++) {
        if (i + 1 < hues.length) expect({ one, i, next: hues[i] === hues[i + 1] }).toEqual({ one, i, next: false });
        if (i + 2 < hues.length) expect({ one, i, down: hues[i] === hues[i + 2] }).toEqual({ one, i, down: false });
      }
      // Fifteen colour worlds, not one: at least seven hues in every deck.
      expect(new Set(hues).size).toBeGreaterThanOrEqual(7);
    }
  });

  test('every hue has an archetype wearing it, so the tokens\' one step rule applies to the theme', () => {
    for (const one of CREATURE_HUES) expect(archetypeWearing(one)).not.toBe('generalist');
    expect(archetypeWearing('amber')).toBe('generalist');
  });

  test('the dark ink reads on every band: 4.5:1 or better', () => {
    const lum = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      const ch = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
    };
    for (const id of CARD_ORDER) {
      for (const one of CREATURE_HUES) {
        const band = storyHue(id, one).ink;
        const [hi, lo] = [lum(band), lum(ON_BAND)].sort((a, b) => b - a) as [number, number];
        expect((hi + 0.05) / (lo + 0.05)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

// ─── the answer ─────────────────────────────────────────────────────────────────────────

function allFaces() {
  const decks: { wrapped: ReportWrapped; quotes: typeof SAMPLE_QUOTES | null; state: 'shown' | 'off' }[] = [
    { wrapped: SAMPLE_WRAPPED, quotes: null, state: 'off' },
    { wrapped: SAMPLE_WRAPPED_WITH_QUOTES, quotes: SAMPLE_QUOTES, state: 'shown' },
    { wrapped: refusedDeck(), quotes: null, state: 'off' },
  ];
  if (existsSync(FIXTURE)) {
    const fx = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { report?: { wrapped?: ReportWrapped }; scenarios?: unknown };
    if (fx.report?.wrapped) decks.push({ wrapped: fx.report.wrapped, quotes: null, state: 'off' });
  }
  return decks.flatMap((d) => deckItems(d.wrapped, d.quotes, d.state, SAMPLE_SOURCES));
}

describe('what each answer is drawn as', () => {
  test('a counted answer counts to exactly the words the copy layer wrote', () => {
    let counted = 0;
    for (const it of allFaces()) {
      const h = heroOf(it.face, it.card);
      if (h.kind !== 'count') continue;
      counted += 1;
      expect({ id: it.card.id, last: formatWith(h.spec.fmt, h.spec.value) }).toEqual({ id: it.card.id, last: h.spec.final });
      // The final frame is the answer's own leading words, never a rounding of them.
      const face = it.face;
      const wrote = face.hero?.kind === 'count' ? face.hero.text : face.hero?.kind === 'words' ? face.hero.text : null;
      expect(h.spec.final).toBe(wrote!);
    }
    expect(counted).toBeGreaterThanOrEqual(9);
  });

  test('the longest session counts up as a duration, 0m to 3h 06m', () => {
    const it = deckItems(SAMPLE_WRAPPED, null, 'off', SAMPLE_SOURCES).find((i) => i.card.id === 'longest_session')!;
    const h = heroOf(it.face, it.card);
    expect(h.kind).toBe('count');
    if (h.kind !== 'count') return;
    expect(h.spec.final).toBe('3h 06m');
    expect(h.spec.fmt).toEqual({ kind: 'floorMins' });
    expect(formatWith(h.spec.fmt, 0)).toBe('under a minute');
  });

  test('words stay words; a refusal is its sentence, never a zero', () => {
    const items = deckItems(SAMPLE_WRAPPED, null, 'off', SAMPLE_SOURCES);
    const one = heroOf(items[0]!.face, items[0]!.card);
    expect(one).toEqual({ kind: 'words', text: 'Quality guardian' });
    for (const c of refusalSamples()) {
      const face = faceOf(c, null, 'off')!;
      const h = heroOf(face, c);
      expect(h.kind).toBe('refusal');
      if (h.kind !== 'refusal') continue;
      expect(h.text).toBe(face.refusal!);
      expect(h.text).not.toMatch(/^0\b/);
      expect(hasDash(h.text)).toBe(false);
      expect(h.text.endsWith('.')).toBe(true);
    }
  });

  test('a quote is drawn only when quotes are on and the quote arrived', () => {
    const off = deckItems(SAMPLE_WRAPPED_WITH_QUOTES, SAMPLE_QUOTES, 'off', SAMPLE_SOURCES);
    for (const it of off) expect(heroOf(it.face, it.card).kind).not.toBe('quote');
    const on = deckItems(SAMPLE_WRAPPED_WITH_QUOTES, SAMPLE_QUOTES, 'shown', SAMPLE_SOURCES);
    const quoted = on.filter((it) => heroOf(it.face, it.card).kind === 'quote').map((it) => it.card.id);
    expect(quoted.sort()).toEqual(['crash_out', 'cryptic_prompt', 'go_to_prompt']);
  });
});

// ─── the words and the art ──────────────────────────────────────────────────────────────

describe('the words keep ground under them (shot 65: card 13\'s sentence sat on its mosaic)', () => {
  test('every card, story and share, leaves more air above the art than between its own lines of words', () => {
    for (const ty of [CARD_TYPE.story, CARD_TYPE.share]) {
      expect(ty.artGap).toBeGreaterThan(ty.gap);
    }
  });
});

// ─── the board ──────────────────────────────────────────────────────────────────────────

describe('a word answer on the board', () => {
  const story = CARD_TYPE.story;
  const opts = { maxSize: story.flapMax, minSize: story.flapMin, maxLines: story.flapLines, maxHeight: 220 };

  test('balanced lines: every word, in order, the longest line as short as it can be', () => {
    expect(balanceLines(['Quality', 'guardian'], 2)).toEqual(['Quality', 'guardian']);
    expect(balanceLines('Sent 4 times across 4 sessions'.split(' '), 3)).toEqual(['Sent 4 times', 'across 4', 'sessions']);
    expect(balanceLines(['one'], 2)).toBeNull();
  });

  test('every line fits the card at its size, and the words are all there', () => {
    const texts = ['Quality guardian', 'Hands on the wheel.', 'Mostly source code.', 'Sent 4 times across 4 sessions', '3h 06m', '“keep going”'];
    for (const text of texts) {
      const l = flapLayout(text, 330, opts)!;
      expect(l).not.toBeNull();
      expect(l.lines.join(' ')).toBe(text);
      for (const line of l.lines) expect(line.length * MONO_ADVANCE * l.size).toBeLessThanOrEqual(330);
      expect(l.lines.length * l.lineHeight).toBeLessThanOrEqual(220 + l.lines.length);
      expect(l.size).toBeGreaterThanOrEqual(opts.minSize);
      expect(l.size).toBeLessThanOrEqual(opts.maxSize);
    }
    // Huge: the builder's type across two lines at well over 60pt.
    expect(flapLayout('Quality guardian', 330, opts)!.size).toBeGreaterThan(60);
  });

  test('too long for the board at any readable size: null, and the card sets it as a paragraph', () => {
    const long = 'WHY is the build STILL red?? i said leave the migrations ALONE and then you touched them anyway, twice, on purpose';
    expect(flapLayout(long, 330, { ...opts, minSize: story.quoteMin, maxLines: story.quoteLines })).toBeNull();
  });
});

// ─── layout ─────────────────────────────────────────────────────────────────────────────

describe('the card never cuts what it says', () => {
  test('the answer gives way in steps when the words would squeeze the art under its floor', () => {
    expect(nextSqueeze(0, 640, 400, 104)).toBe(0);
    expect(nextSqueeze(0, 640, 560, 104)).toBe(1);
    expect(nextSqueeze(SQUEEZE.length - 1, 640, 900, 104)).toBe(SQUEEZE.length - 1);
    for (let i = 1; i < SQUEEZE.length; i++) expect(SQUEEZE[i]!).toBeLessThan(SQUEEZE[i - 1]!);
  });

  test('the story card fills its box less the gutters; the share card is the 4:5 export', () => {
    expect(storyCardSize({ w: 390, h: 660 })).toEqual({ width: 370, height: 648 });
  });

  test('the timings land inside the reveal clock, in order', () => {
    expect(STAGE.question).toBeLessThan(STAGE.hero);
    expect(STAGE.hero).toBeLessThan(STAGE.tail);
    expect(STAGE.tail).toBe(520);
    expect(STAGE.blinkMs).toBe(167);
    expect(STAGE.gesture + STAGE.gestureMs).toBeLessThan(3200);
  });
});

describe('the progress row', () => {
  test('the cards before the front seen, the front current, the rest ahead', () => {
    expect(progressSegments(5, 2)).toEqual(['seen', 'seen', 'current', 'ahead', 'ahead']);
    expect(progressSegments(15, 0).filter((s) => s === 'ahead').length).toBe(14);
    expect(progressSegments(3, 9)).toEqual(['seen', 'seen', 'current']);
    expect(progressSegments(0, 0)).toEqual([]);
  });
});

// ─── the creature ───────────────────────────────────────────────────────────────────────

describe('the creature, printed, blinking once, gesturing once', () => {
  test('its rest pose is the pack\'s frame 0, pixel for pixel, each printing inside its spread', () => {
    for (const animal of ANIMALS) {
      const plan = creaturePlan(animal, 800, 420);
      const frame = ANIMAL_FRAMES[animal][0]!;
      const inked = frame.flatMap((row, y) => [...row].map((ch, x) => (ch !== '.' ? `${x},${y}` : null))).filter(Boolean);
      expect(plan.rest.map((c) => `${c.x},${c.y}`).sort()).toEqual((inked as string[]).sort());
      for (const c of plan.rest) {
        expect(c.at).toBeGreaterThanOrEqual(800);
        expect(c.at).toBeLessThanOrEqual(800 + 420);
      }
      // The blink fills exactly the eye holes.
      expect(plan.eyes.length).toBe(EYES.length);
      expect(plan.drop.length).toBe(plan.rest.length);
    }
  });

  test('where it stands: an empty corner of the art, never over a cell of data', () => {
    const W = 120;
    const H = 70;
    const data = new Float32Array(W * H);
    // A chart filling the left two thirds, bottom half: the right corners are empty.
    for (let y = 35; y < H; y++) for (let x = 0; x < 80; x++) data[y * W + x] = 0.6;
    const field: Field = { width: W, height: H, data };
    const spot = creatureSpot(field, 3, [64, 48])!;
    expect(spot.corner).toBe('br');
    const x0 = Math.floor(spot.x / 3);
    const y0 = Math.floor(spot.y / 3);
    const n = Math.ceil(spot.size / 3);
    for (let y = y0; y < y0 + n; y++) for (let x = x0; x < x0 + n; x++) expect(cellValue(field, x, y)).toBe(0);
    // A full field has no room: the creature goes elsewhere or nowhere.
    expect(creatureSpot({ width: W, height: H, data: new Float32Array(W * H).fill(0.5) }, 3, [64, 48])).toBeNull();
    expect(CORNERS[0]).toBe('br');
  });

  test('the sample deck\'s cards find room for it where their data leaves some', () => {
    const roomy = CARD_ORDER.filter((id) => {
      const c = SAMPLE_WRAPPED.cards.find((x) => x.id === id)!;
      const spec = artFor(c, SAMPLE_SOURCES, 370 / 230);
      return creatureSpot(fieldOf(spec, 123, 76), 3, CARD_TYPE.story.creature) !== null;
    });
    expect(roomy.length).toBeGreaterThanOrEqual(5);
  });
});

// ─── the words ──────────────────────────────────────────────────────────────────────────

describe('the screen\'s own words', () => {
  test('no dashes, and every sentence ends like one', () => {
    const lines = [...Object.values(STORY_COPY), ...Object.values(EMPTY_COPY).flatMap((c) => [c.title, c.text, c.action])];
    for (const line of lines) expect({ line, dash: hasDash(line) }).toEqual({ line, dash: false });
    for (const c of Object.values(EMPTY_COPY)) {
      expect(c.title.endsWith('.')).toBe(true);
      expect(c.text.endsWith('.')).toBe(true);
    }
  });

  test('the dev states: only the named ones, and nothing else', () => {
    for (const s of FORCEABLE) expect(forcedState(s)).toBe(s);
    expect(forcedState('ready')).toBeNull();
    expect(forcedState(undefined)).toBeNull();
    expect(forcedState('nonsense')).toBeNull();
  });

  test('the refused deck: fifteen cards, each refused by a code the engine uses for it', () => {
    const deck = refusedDeck();
    expect(deck.cards.map((c) => c.id)).toEqual([...REPORT_ENUMS.wrapped_card]);
    for (const c of deck.cards) expect(c.reason).not.toBeNull();
    const items = deckItems(deck, null, 'off', NO_SOURCES);
    expect(items.length).toBe(15);
    for (const it of items) expect(it.face.answered).toBe(false);
  });
});

// ─── the living art, through CanvasKit ──────────────────────────────────────────────────

const CK_BIN = join(import.meta.dir, '..', 'node_modules', 'canvaskit-wasm', 'bin');
let ck: CanvasKit;
let fx: RuntimeEffect | null = null;
let compileError = '';

beforeAll(async () => {
  const init = require(join(CK_BIN, 'canvaskit.js')) as (o: { locateFile: (f: string) => string }) => Promise<CanvasKit>;
  ck = await init({ locateFile: (f: string) => join(CK_BIN, f) });
  fx = ck.RuntimeEffect.Make(DATA_FIELD_SKSL, (e: string) => {
    compileError = e;
  });
});

const PARTNER = hue('coral').partner;

function uniforms(effect: RuntimeEffect, u: Record<string, number | readonly number[]>): number[] {
  const out: number[] = [];
  for (let i = 0; i < effect.getUniformCount(); i++) {
    const name = effect.getUniformName(i);
    const v = u[name];
    if (v === undefined) throw new Error(`uniform ${name} is missing`);
    if (typeof v === 'number') out.push(v);
    else out.push(...v);
  }
  return out;
}

/** The program over `field` at one pixel per point, read back: the tone of every cell. */
function drawTones(field: Field, cell: number, over: Partial<Record<string, number | readonly number[]>> = {}): Uint8Array {
  const effect = fx!;
  const w = field.width * cell;
  const h = field.height * cell;
  const bytes = new Uint8Array(field.width * field.height * 4);
  for (let i = 0; i < field.width * field.height; i++) {
    const g = Math.round((1 - Math.min(1, Math.max(0, field.data[i] ?? 0))) * 255);
    bytes.set([g, g, g, 255], i * 4);
  }
  const img = ck.MakeImage(
    { width: field.width, height: field.height, alphaType: ck.AlphaType.Opaque, colorType: ck.ColorType.RGBA_8888, colorSpace: ck.ColorSpace.SRGB },
    bytes,
    field.width * 4,
  )!;
  const child = img.makeShaderOptions(ck.TileMode.Clamp, ck.TileMode.Clamp, ck.FilterMode.Nearest, ck.MipmapMode.None, ck.Matrix.scaled(cell, cell));
  const u = uniforms(effect, {
    size: [w, h],
    cell,
    t: 0,
    now: 0,
    develop: 1,
    axis: 0,
    shimmer: 0,
    noiseUnit: FIELD.noiseUnit,
    tap: [0, 0, 0, 0],
    rippleSpeed: FIELD.rippleSpeed,
    rippleWidth: FIELD.rippleWidth,
    rippleDepth: FIELD.rippleDepth,
    rippleReach: FIELD.rippleReach,
    ink: premultiplied(ON_BAND),
    partner: premultiplied(PARTNER),
    paper: [0, 0, 0, 0],
    ...(over as Record<string, number | readonly number[]>),
  });
  const shader = effect.makeShaderWithChildren(u, [child]);
  const surface = ck.MakeSurface(w, h)!;
  const canvas = surface.getCanvas();
  canvas.clear(ck.TRANSPARENT);
  const paint = new ck.Paint();
  paint.setBlendMode(ck.BlendMode.Src);
  paint.setShader(shader);
  canvas.drawRect(ck.XYWHRect(0, 0, w, h), paint);
  surface.flush();
  const snap = surface.makeImageSnapshot();
  const px = snap.readPixels(0, 0, { width: w, height: h, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }) as Uint8Array;
  const inkKey = premultiplied(ON_BAND).map((v) => Math.round(v * 255)).join(',');
  const partnerKey = premultiplied(PARTNER).map((v) => Math.round(v * 255)).join(',');
  const tones = new Uint8Array(field.width * field.height);
  for (let y = 0; y < field.height; y++) {
    for (let x = 0; x < field.width; x++) {
      const i = ((y * cell + Math.floor(cell / 2)) * w + x * cell + Math.floor(cell / 2)) * 4;
      const key = [px[i], px[i + 1], px[i + 2], px[i + 3]].join(',');
      tones[y * field.width + x] = key === inkKey ? 2 : key === partnerKey ? 1 : px[i + 3] === 0 ? 0 : 9;
    }
  }
  shader.delete();
  child.delete();
  img.delete();
  paint.delete();
  snap.delete();
  surface.delete();
  return tones;
}

/** A cell within a grey step of a threshold can fall either side on a GPU: not a claim to make. */
function nearThreshold(v: number, b: number): boolean {
  const s = v * 2;
  return Math.abs(s - b) < 2 / 255 || Math.abs(s - 1 - b) < 2 / 255;
}

describe('the living art, through CanvasKit', () => {
  test('DATA_FIELD_SKSL compiles', () => {
    expect({ ok: fx !== null, error: compileError }).toEqual({ ok: true, error: '' });
  });

  test('at rest, every cell is exactly the card\'s data in three levels: paper, partner, dark ink', () => {
    const cards = SAMPLE_WRAPPED.cards.filter((c) => c.id !== 'builder_type');
    let checked = 0;
    for (const c of cards) {
      const field = fieldOf(artFor(c, SAMPLE_SOURCES, 1.6), 64, 40);
      const tones = drawTones(field, 3);
      for (let y = 0; y < 40; y++) {
        for (let x = 0; x < 64; x++) {
          const v = cellValue(field, x, y);
          const b = bayer8(x, y);
          if (nearThreshold(v, b)) continue;
          expect({ id: c.id, x, y, tone: tones[y * 64 + x] }).toEqual({ id: c.id, x, y, tone: restTone(v, b) });
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(30_000);
  });

  test('before it prints, nothing; half way, only cells the data has; printed, all of them', () => {
    const c = SAMPLE_WRAPPED.cards.find((x) => x.id === 'shipped')!;
    const field = fieldOf(artFor(c, SAMPLE_SOURCES, 1.6), 64, 40);
    expect(drawTones(field, 3, { develop: 0 }).every((t) => t === 0)).toBe(true);
    const half = drawTones(field, 3, { develop: 0.5, axis: printAxis(artFor(c, SAMPLE_SOURCES, 1.6)) });
    const rest = drawTones(field, 3);
    let on = 0;
    for (let i = 0; i < half.length; i++) {
      if (half[i] !== 0) {
        on += 1;
        expect(half[i]).toBe(rest[i]);
      }
    }
    expect(on).toBeGreaterThan(0);
    expect(on).toBeLessThan(rest.filter((t) => t !== 0).length);
  });

  test('the drift and the ripple only thin the data: never a cell the data leaves empty, never denser', () => {
    const cards: ReportWrappedCard[] = SAMPLE_WRAPPED.cards.filter((c) => ['shipped', 'deep_sessions', 'agents_at_once', 'kind_of_work'].includes(c.id));
    for (const c of cards) {
      const field = fieldOf(artFor(c, SAMPLE_SOURCES, 1.6), 64, 40);
      const rest = drawTones(field, 3);
      for (const frame of [
        { shimmer: FIELD.shimmer, t: 0.7 },
        { shimmer: FIELD.shimmer, t: 13.3 },
        { shimmer: 0, now: 0.6, tap: [90, 60, 0.1, 1] },
        { shimmer: FIELD.shimmer, t: 4, now: 1.2, tap: [30, 20, 0.2, 1] },
      ]) {
        const moved = drawTones(field, 3, frame);
        let thinner = 0;
        for (let i = 0; i < rest.length; i++) {
          const x = i % 64;
          const y = Math.floor(i / 64);
          if (nearThreshold(cellValue(field, x, y), bayer8(x, y))) continue;
          expect(moved[i]!).toBeLessThanOrEqual(rest[i]!);
          if (moved[i]! < rest[i]!) thinner += 1;
        }
        expect({ id: c.id, moves: thinner > 0 }).toEqual({ id: c.id, moves: true });
      }
    }
  });

  test('a refused card\'s art never reaches the ink: it is its seeded field, thinned', () => {
    for (const c of refusalSamples().slice(0, 6)) {
      const tones = drawTones(fieldOf(artFor(c, NO_SOURCES, 1.6), 64, 40, { faded: true }), 3);
      expect(tones.some((t) => t === 2)).toBe(false);
      expect(tones.every((t) => t !== 9)).toBe(true);
    }
  });
});
