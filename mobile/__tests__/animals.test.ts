/**
 * The pixel family: Bit and the eight creatures, one ink, one grid, one weight.
 *
 * The failure mode of a sprite pack is not a crash either. It is a creature that still
 * renders, still animates, and no longer belongs: a second tone creeping back into one frame,
 * a crab that is a third heavier than the bee, an owl standing a row lower than the fox, a
 * "subtle" loop that repaints half the grid. Every rule the family claims for itself
 * (`animals.ts`, rules 1 to 7) is asserted here, with the number measured off the actual
 * frames beside it, and Bit's idle is held to the same rules as the pack.
 */
import { describe, expect, test } from 'bun:test';

import { ANALYSIS_ENUMS, type Archetype } from '../src/generated/analysis';
import {
  ANIMALS,
  ANIMAL_FRAMES,
  ANIMAL_GLYPHS,
  ANIMAL_LABELS,
  ARCHETYPE_ANIMALS,
  CORPUS_ARCHETYPE_ANIMALS,
  DEFAULT_ANIMAL,
  PACK_EXCEPTIONS,
  animalChoices,
  animalForArchetype,
  framesForAnimal,
  isAnimal,
  resolveAnimal,
  type Animal,
  type PackException,
} from '../src/pixel/animals';
import { EMPTY, EYES, GRID, ascii, eyesOpen, holes, isValidFrame, validateFrame, type Frame } from '../src/pixel/frames';
import { ANIMAL_MOTION, MOTION, animalTimeline, clampTempo, closeEyes, timelineFor } from '../src/pixel/motion';
import { glyphColor } from '../src/pixel/harness';
import { GLYPH_INK, animalPalette, glyphInk, spritePalette } from '../src/pixel/palette';
import { SPRITES } from '../src/pixel/sprites';
import { colors, type Scheme } from '../src/theme';

// ─── measuring a frame ───────────────────────────────────────────────────────────────

type Cell = [number, number];
const key = ([x, y]: Cell) => `${x},${y}`;

function drawn(frame: Frame): Cell[] {
  const out: Cell[] = [];
  frame.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] !== EMPTY) out.push([x, y]);
  });
  return out;
}

function filled(frame: Frame): number {
  return drawn(frame).length;
}

/** Cells that differ between two frames. */
function diff(a: Frame, b: Frame): Cell[] {
  const out: Cell[] = [];
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) if (a[y]?.[x] !== b[y]?.[x]) out.push([x, y]);
  }
  return out;
}

/** Every frame change the loop actually plays, the wrap included. */
function loopSteps(frames: Frame[]): number[] {
  return frames.map((f, i) => diff(f, frames[(i + 1) % frames.length]!).length);
}

function glyphsUsed(frame: Frame): Set<string> {
  const set = new Set<string>();
  for (const row of frame) for (const ch of row) if (ch !== EMPTY) set.add(ch);
  return set;
}

/** Cells that differ between a frame and its own mirror image, over one half. */
function asymmetry(frame: Frame): number {
  let n = 0;
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID / 2; x++) if (frame[y]?.[x] !== frame[y]?.[GRID - 1 - x]) n += 1;
  }
  return n;
}

function bbox(frame: Frame): { x0: number; y0: number; x1: number; y1: number } {
  const cells = drawn(frame);
  const xs = cells.map(([x]) => x);
  const ys = cells.map(([, y]) => y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** 4-connected groups of `cells`. */
function groups(cells: Cell[]): Cell[][] {
  const pending = new Map(cells.map((c) => [key(c), c]));
  const out: Cell[][] = [];
  for (const start of cells) {
    if (!pending.has(key(start))) continue;
    const group: Cell[] = [];
    const stack = [start];
    pending.delete(key(start));
    while (stack.length) {
      const [x, y] = stack.pop()!;
      group.push([x, y]);
      for (const n of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ] as Cell[]) {
        if (pending.has(key(n))) {
          pending.delete(key(n));
          stack.push(n);
        }
      }
    }
    out.push(group);
  }
  return out;
}

/**
 * Drawn cells in the middle of a one-cell-wide line: two or more drawn neighbours, and both
 * horizontal or both vertical neighbours empty. A cell with one neighbour is a TIP (an ear
 * point, a whisker, a claw) and is allowed; a line of them is not.
 */
function thin(frame: Frame): Cell[] {
  const on = new Set(drawn(frame).map(key));
  return drawn(frame).filter(([x, y]) => {
    const l = on.has(key([x - 1, y]));
    const r = on.has(key([x + 1, y]));
    const u = on.has(key([x, y - 1]));
    const d = on.has(key([x, y + 1]));
    return Number(l) + Number(r) + Number(u) + Number(d) >= 2 && ((!l && !r) || (!u && !d));
  });
}

/** The holes that are not the family eyes: noses, beaks, slits, a smile, stripes. */
function featureHoles(frame: Frame): Cell[] {
  const eyeKeys = new Set(EYES.map(([x, y]) => key([x, y])));
  return holes(frame).filter((c) => !eyeKeys.has(key(c)));
}

/**
 * Thin cells a creature is not allowed. A striped creature (`PACK_EXCEPTIONS`) may have a
 * one-cell wall or band where it borders a stripe hole, and nowhere else.
 */
function thinBreaks(frame: Frame, exception: PackException | undefined): Cell[] {
  const cells = thin(frame);
  if (!exception?.stripes) return cells;
  const stripe = new Set(featureHoles(frame).map(key));
  const touches = ([x, y]: Cell) =>
    stripe.has(key([x - 1, y])) || stripe.has(key([x + 1, y])) || stripe.has(key([x, y - 1])) || stripe.has(key([x, y + 1]));
  return cells.filter((c) => !touches(c));
}

/** Neighbouring pairs that differ, the frame border counted as empty. */
function edges(frame: Frame): number {
  const on = new Set(drawn(frame).map(key));
  let n = 0;
  for (let y = -1; y < GRID; y++) {
    for (let x = -1; x < GRID; x++) {
      const here = on.has(key([x, y]));
      if (y >= 0 && here !== on.has(key([x + 1, y]))) n += 1;
      if (x >= 0 && here !== on.has(key([x, y + 1]))) n += 1;
    }
  }
  return n;
}

/** A frame's outline: its drawn cells plus the holes it encloses. */
function outline(frame: Frame): Set<string> {
  return new Set([...drawn(frame).map(key), ...holes(frame).map(key)]);
}

function outlineDistance(a: Frame, b: Frame): number {
  const oa = outline(a);
  const ob = outline(b);
  let n = 0;
  for (const k of oa) if (!ob.has(k)) n += 1;
  for (const k of ob) if (!oa.has(k)) n += 1;
  return n;
}

/** WCAG relative luminance, and the contrast ratio between two `#rrggbb` colours. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 0xff) + 0.7152 * channel((n >> 8) & 0xff) + 0.0722 * channel(n & 0xff);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// ─── the family ──────────────────────────────────────────────────────────────────────

/** A member of the family: its loop as played, the beat, and the holds. Bit's is its idle. */
interface Member {
  name: string;
  frames: Frame[];
  beatMs: number;
  holds: readonly number[];
}

const FAMILY: Member[] = [
  { name: 'bit', frames: SPRITES.idle, beatMs: MOTION.idle.beatMs, holds: MOTION.idle.holds },
  ...ANIMALS.map((a) => ({
    name: a,
    frames: framesForAnimal(a),
    beatMs: ANIMAL_MOTION[a].beatMs,
    holds: ANIMAL_MOTION[a].holds,
  })),
];

const rest = (m: Member) => m.frames[0]!;

/** Bit has no entry: he is held to every rule exactly. */
const exceptionOf = (m: Member): PackException | undefined =>
  isAnimal(m.name) ? PACK_EXCEPTIONS[m.name] : undefined;

/**
 * The family's mean filled-cell count at rest. MEASURED: bit 84, cat 92, dog 88, fox 86,
 * owl 96, bee 100, whale 91, octopus 98, crab 94, mean 92.1. Every member is within 15% of it
 * (Bit is the lightest at -8.8%, the bee the heaviest at +8.6%), so the heaviest is 1.19 times
 * the lightest; the pack before round 5 ran 70 to 126 cells, 1.8 times.
 */
const MEAN = FAMILY.reduce((n, m) => n + filled(rest(m)), 0) / FAMILY.length;

/** The live area: cells 2 to 13 on both axes. A gesture may reach one further, never 0 or 15. */
const LIVE = { lo: 2, hi: 13 };
const BASELINE = 13;
/**
 * Edges per filled cell. MEASURED: 0.81 (Bit, fox) to 1.13 (the crab, whose claws are on arms
 * with a slit each side); the bee's stripes put it at 1.10. The pack before round 5 reached 1.49.
 */
const EDGES_PER_CELL = 1.15;

describe('the pack', () => {
  test('eight animals, unique, and the tables agree', () => {
    expect(ANIMALS).toEqual(['cat', 'dog', 'fox', 'owl', 'bee', 'whale', 'octopus', 'crab']);
    expect(new Set(ANIMALS).size).toBe(8);
    expect(Object.keys(ANIMAL_FRAMES).sort()).toEqual([...ANIMALS].sort());
    expect(Object.keys(ANIMAL_LABELS).sort()).toEqual([...ANIMALS].sort());
    expect(Object.keys(ANIMAL_MOTION).sort()).toEqual([...ANIMALS].sort());
  });

  test('isAnimal accepts only the pack', () => {
    for (const a of ANIMALS) expect(isAnimal(a)).toBe(true);
    for (const junk of ['crustacean', 'Crab', '', null, undefined, 7]) expect(isAnimal(junk)).toBe(false);
  });

  test('the default is the first in the pack, and it is not the crab', () => {
    // An amber crab as the first creature a person sees is Clawd, Claude Code's own mascot,
    // and the owner read the old default as "the Claude icon". `app/icon.tsx` opens on
    // ANIMALS[0] and the profile falls back to DEFAULT_ANIMAL: they must be the same one.
    expect(DEFAULT_ANIMAL).toBe(ANIMALS[0]);
    expect(DEFAULT_ANIMAL).not.toBe('crab');
  });

  test('exactly two creatures depart from the rules, and only in the ways the table says', () => {
    // A whale is known by its flukes and a bee by its stripes; nobody else gets an exception.
    expect(Object.keys(PACK_EXCEPTIONS).sort()).toEqual(['bee', 'whale']);
    expect(PACK_EXCEPTIONS.whale).toEqual({ mirror: false, baseline: 12 });
    expect(PACK_EXCEPTIONS.bee).toEqual({ stripes: true });
  });
});

describe('one family: Bit and the eight, held to the same rules', () => {
  for (const m of FAMILY) {
    describe(m.name, () => {
      const r = rest(m);

      test(`every frame is ${GRID}x${GRID} and uses only known glyphs`, () => {
        m.frames.forEach((frame, i) => {
          expect(validateFrame(frame), `${m.name}[${i}]\n${ascii(frame)}`).toEqual([]);
          expect(isValidFrame(frame)).toBe(true);
        });
      });

      test('rule 1: one ink, so every frame draws the one role and nothing else', () => {
        for (const [i, frame] of m.frames.entries()) {
          expect([...glyphsUsed(frame)], `${m.name}[${i}]\n${ascii(frame)}`).toEqual([...ANIMAL_GLYPHS]);
        }
      });

      test('rule 2: the eyes are the family eyes, and the other features are small holes', () => {
        // Two 2x2 holes at columns 5-6 and 9-10 on rows 6 and 7, the same cells for all nine.
        expect(eyesOpen(r), `${m.name}\n${ascii(r)}`).toBe(true);
        const eyeKeys = new Set(EYES.map(([x, y]) => key([x, y])));
        // At most three more: a nose, a beak, two arm slits, a smile and its corners, two
        // stripes. MEASURED: none (Bit, cat, fox, octopus) to three (the whale's smile).
        const features = groups(featureHoles(r));
        expect(features.length, `${m.name} has ${features.length} other holes`).toBeLessThanOrEqual(3);
        for (const g of features) expect(g.length).toBeLessThanOrEqual(8);
        // Each eye is its own 2x2 hole, not merged into a nose or a beak.
        const eyes = groups(holes(r)).filter((g) => g.some((c) => eyeKeys.has(key(c))));
        expect(eyes.map((g) => g.length)).toEqual([4, 4]);
      });

      test('rule 3: at rest it fills the live area and stands on row 13 (the whale floats on 12)', () => {
        const b = bbox(r);
        expect(b.x0, m.name).toBeGreaterThanOrEqual(LIVE.lo);
        expect(b.x1, m.name).toBeLessThanOrEqual(LIVE.hi);
        expect(b.y0, m.name).toBeGreaterThanOrEqual(LIVE.lo);
        expect(b.y1, `${m.name} baseline`).toBe(exceptionOf(m)?.baseline ?? BASELINE);
      });

      test('rule 3: a gesture reaches at most one cell past the live area, never the edge', () => {
        for (const [i, frame] of m.frames.entries()) {
          const b = bbox(frame);
          expect(Math.min(b.x0, b.y0), `${m.name}[${i}]`).toBeGreaterThanOrEqual(LIVE.lo - 1);
          expect(Math.max(b.x1, b.y1), `${m.name}[${i}]`).toBeLessThanOrEqual(LIVE.hi + 1);
        }
      });

      test('rule 4: 10 to 12 cells wide, and within 15% of the family mean', () => {
        const b = bbox(r);
        expect(b.x1 - b.x0 + 1, m.name).toBeGreaterThanOrEqual(10);
        expect(b.x1 - b.x0 + 1, m.name).toBeLessThanOrEqual(12);
        const n = filled(r);
        expect(Math.abs(n - MEAN) / MEAN, `${m.name} ${n} cells against a mean of ${MEAN.toFixed(1)}`).toBeLessThanOrEqual(0.15);
        // The band itself, so a family that drifts heavier or lighter together still fails.
        expect(n).toBeGreaterThanOrEqual(78);
        expect(n).toBeLessThanOrEqual(106);
      });

      test('rule 5: one shape, no one-cell-thin parts, and a quiet outline', () => {
        expect(groups(drawn(r)).length, `${m.name}\n${ascii(r)}`).toBe(1);
        for (const [i, frame] of m.frames.entries()) {
          expect(thinBreaks(frame, exceptionOf(m)), `${m.name}[${i}]\n${ascii(frame)}`).toEqual([]);
        }
        expect(edges(r) / filled(r), m.name).toBeLessThanOrEqual(EDGES_PER_CELL);
      });

      test('rule 6: it faces forward (the whale excepted), and a gesture adds four asymmetric cells at most', () => {
        const own = asymmetry(r);
        if (exceptionOf(m)?.mirror === false) {
          // MEASURED: the whale's flukes and its smile's one-sided rise, 9 cells.
          expect(own, `${m.name}\n${ascii(r)}`).toBeGreaterThan(0);
          expect(own).toBeLessThanOrEqual(12);
        } else {
          expect(own, `${m.name}\n${ascii(r)}`).toBe(0);
        }
        for (const [i, frame] of m.frames.entries()) {
          expect(asymmetry(frame), `${m.name}[${i}]\n${ascii(frame)}`).toBeLessThanOrEqual(own + 4);
        }
      });

      test('rule 7: rest, a breath, rest, one gesture', () => {
        // Three or four drawings (rest, breath, a gesture of one or two frames), played as
        // four or five entries with the rest pose twice.
        const drawings = new Set(m.frames.map((f) => f.join('\n')));
        expect(m.frames.length).toBeGreaterThanOrEqual(3);
        expect(m.frames.length).toBeLessThanOrEqual(5);
        expect(drawings.size).toBeGreaterThanOrEqual(3);
        expect(drawings.size).toBeLessThanOrEqual(4);
        expect(m.frames[2], 'the rest pose returns as the SAME frame object').toBe(r);
        // The breath is drawn in four cells or fewer.
        expect(diff(r, m.frames[1]!).length).toBeGreaterThan(0);
        expect(diff(r, m.frames[1]!).length).toBeLessThanOrEqual(4);
      });

      test('rule 7: at most four cells change per frame, and twelve across the loop', () => {
        const steps = loopSteps(m.frames);
        for (const [i, n] of steps.entries()) {
          expect(n, `${m.name} ${i}→${(i + 1) % m.frames.length} changed ${n} cells`).toBeLessThanOrEqual(4);
          expect(n).toBeGreaterThan(0);
        }
        const footprint = new Set<string>();
        m.frames.forEach((f, i) => {
          for (const c of diff(f, m.frames[(i + 1) % m.frames.length]!)) footprint.add(key(c));
        });
        expect(footprint.size, m.name).toBeLessThanOrEqual(12);
      });

      test('rule 7: the loop moves two parts, the breath and one gesture, and nothing else', () => {
        // An animal whose only motion is one gesture on repeat reads as a twitch; one that
        // moves a third part has stopped idling. So the breath and the gesture are
        // different cells, and between them they are every cell the loop ever changes.
        const breath = new Set(diff(r, m.frames[1]!).map(key));
        const gesture = new Set(m.frames.slice(3).flatMap((f) => diff(r, f).map(key)));
        expect(breath.size, `${m.name} breath`).toBeGreaterThan(0);
        expect(gesture.size, `${m.name} gesture`).toBeGreaterThan(0);
        expect([...breath].filter((k) => gesture.has(k)), m.name).toEqual([]);
        m.frames.forEach((f, i) => {
          for (const c of diff(f, m.frames[(i + 1) % m.frames.length]!)) {
            expect(breath.has(key(c)) || gesture.has(key(c)), `${m.name} moves ${key(c)}`).toBe(true);
          }
        });
      });

      test('rule 7: the rest pose is on screen for at least half the loop, on a 400–600 ms beat', () => {
        expect(m.beatMs, m.name).toBeGreaterThanOrEqual(400);
        expect(m.beatMs, m.name).toBeLessThanOrEqual(600);
        expect(m.holds.length).toBe(m.frames.length);
        const total = m.holds.reduce((n, h) => n + h, 0);
        const atRest = m.frames.reduce((n, f, i) => n + (f === r ? m.holds[i]! : 0), 0);
        expect(atRest / total, m.name).toBeGreaterThanOrEqual(0.5);
      });

      test('rule 7: the blink fills exactly the two eye holes, and nothing else', () => {
        const shut = closeEyes(r);
        expect(diff(r, shut).map(key).sort()).toEqual(EYES.map(([x, y]) => key([x, y])).sort());
        expect(eyesOpen(shut)).toBe(false);
        expect(closeEyes(shut)).toBe(shut);
        // It works on every frame of the loop: the eyes never move.
        for (const f of m.frames) expect(eyesOpen(f), `${m.name}\n${ascii(f)}`).toBe(true);
      });
    });
  }

  test('any two outlines are at least 24 cells apart', () => {
    // Shape tells them apart now that colour does not. MEASURED closest pair: owl and whale,
    // 25 (both wide bodies; the owl's tufts and spread feet against the whale's flukes and
    // floating belly), then cat and owl, 26. Round 5's closest was cat and owl at 24.
    const pairs: string[] = [];
    let closest = Infinity;
    for (let i = 0; i < FAMILY.length; i++) {
      for (let j = i + 1; j < FAMILY.length; j++) {
        const d = outlineDistance(rest(FAMILY[i]!), rest(FAMILY[j]!));
        closest = Math.min(closest, d);
        if (d < 24) pairs.push(`${FAMILY[i]!.name}/${FAMILY[j]!.name} ${d}`);
      }
    }
    expect(pairs).toEqual([]);
    expect(closest).toBe(25);
  });

  test('the dog and the fox are told apart by their ears: one pair hangs, the other stands', () => {
    // Two pointy-faced animals of a similar size, head on. The fox's ears reach the top of
    // the live area at its outer corners; the dog's hang past the jaw with a gap between ear
    // and face that opens downward, where the fox's cheeks are solid.
    const fox = framesForAnimal('fox')[0]!;
    const dog = framesForAnimal('dog')[0]!;
    expect(fox[2]![2], 'the fox has an ear tip in row 2').toBe('b');
    expect(dog[2], 'the dog has nothing in row 2').toBe('.'.repeat(GRID));
    for (const y of [8, 9, 10]) {
      expect(dog[y]!.slice(2, 5), `the dog's left ear hangs free at row ${y}`).toBe('bb.');
      expect(fox[y]!.replace(/^\.+|\.+$/g, ''), `the fox's face is one solid run at row ${y}`).not.toContain('.');
    }
  });

  test('the fox is a head, the triangle every fox icon is', () => {
    // Round 5's fox pinched to a four-cell neck over a wide seated base and read as an X or a
    // bow-tie. Now each row from the cheeks down is no wider than the one above it, to a
    // two-cell chin on the baseline.
    const fox = framesForAnimal('fox')[0]!;
    const widths = fox.slice(8, 14).map((row) => row.replace(/\./g, '').length);
    for (let i = 1; i < widths.length; i++) expect(widths[i]!).toBeLessThan(widths[i - 1]!);
    expect(fox[13]).toBe('.......bb.......');
  });

  test('the owl has a brow, not a cleft, and a beak framed by the one hole under its eyes', () => {
    // Round 5's V ran four rows deep between the tufts and split the head into an M. The dip
    // is row 3 only now, and the hole under the bridge between the eyes makes that bridge a
    // beak. It is also what keeps the owl from being the cat.
    const owl = framesForAnimal('owl')[0]!;
    expect(owl[4]).toBe('...bbbbbbbbbb...');
    expect(featureHoles(owl).map(key).sort()).toEqual(['7,8', '8,8']);
  });

  test('the bee has two stripes that reach its outline, and no waist', () => {
    const bee = framesForAnimal('bee')[0]!;
    const stripes = groups(featureHoles(bee));
    expect(stripes.map((g) => g.length)).toEqual([8, 8]);
    for (const g of stripes) {
      const y = g[0]![1];
      expect(g.every(([, yy]) => yy === y), 'a stripe is one row').toBe(true);
      // A cell of wall, then the outline steps in: the stripe reads as a band round the body.
      expect(bee[y]!.replace(/^\.+|\.+$/g, '')).toMatch(/^b\.+b$/);
    }
    // Round 5's two-cell waist over an eight-cell base was a trophy. From under the eyes to
    // the lowest band the body is at least ten cells across.
    for (const row of bee.slice(8, 13)) expect(row.replace(/^\.+|\.+$/g, '').length).toBeGreaterThanOrEqual(10);
  });

  test("the whale's flukes rise on its right, and its spout is a gesture, not a stalk", () => {
    // A spout on top of a round amber body with a grin is a jack-o'-lantern, so the rest pose
    // has none: above the body there is ink on the right (the flukes) and nothing on the left.
    // The spout rises there in frame 3 and sprays in frame 4.
    const [restPose, , , spout, spray] = framesForAnimal('whale') as Frame[];
    for (const row of restPose!.slice(2, 4)) {
      expect(row.slice(0, 8)).toBe('........');
      expect(row.slice(8)).toContain('b');
    }
    expect(spout![2]!.slice(0, 8)).toContain('b');
    expect(spray![2]!.slice(0, 8)).toContain('b');
  });

  test("the crab's claws are on arms, a slit between each arm and the shell", () => {
    // Claws straight on the shell's top corners are the Space Invaders crab (round 5).
    const crab = framesForAnimal('crab')[0]!;
    expect(featureHoles(crab).map(key).sort()).toEqual(['11,4', '11,5', '4,4', '4,5']);
  });

  test('no animal draws a mascot-only role', () => {
    // `w`, `h` and `z` are Bit's sparks, hammer and trail. They resolve to the same ink, but
    // `motion.ts` lifts them out of a frame, and an animal frame is never decomposed.
    for (const animal of ANIMALS) {
      for (const frame of framesForAnimal(animal)) {
        for (const ch of ['w', 'h', 'z']) expect(glyphsUsed(frame).has(ch), `${animal} uses '${ch}'`).toBe(false);
      }
    }
  });
});

describe('one ink', () => {
  const schemes: Scheme[] = ['dark', 'light'];

  test('every creature and Bit share one ink, per scheme and per tone', () => {
    for (const scheme of schemes) {
      for (const tone of ['rest', 'idle', 'selected', 'faint'] as const) {
        const ink = glyphInk(scheme, tone);
        expect(ink).toMatch(/^#[0-9A-F]{6}$/i);
        for (const animal of ANIMALS) expect(animalPalette(animal, scheme, tone)).toEqual({ b: ink });
        const bit = spritePalette(scheme, tone);
        expect(new Set(Object.values(bit))).toEqual(new Set([ink]));
      }
    }
  });

  test('the ink is a token: amber on dark, ink on light and on the amber tile, faint when dimmed', () => {
    const dark = colors('dark');
    const light = colors('light');
    expect(glyphInk('dark')).toBe(dark.accent);
    expect(glyphInk('light')).toBe(light.text);
    expect(glyphInk('dark', 'selected')).toBe(String(dark.onAccent));
    expect(glyphInk('light', 'selected')).toBe(String(light.onAccent));
    expect(glyphInk('dark', 'faint')).toBe(dark.textFaint);
    expect(glyphInk('light', 'faint')).toBe(light.textFaint);
    expect(GLYPH_INK.dark.rest).toBe('accent');
  });

  test('on an unselected picker tile a creature is drawn as a harness glyph is: in text', () => {
    // The two pickers are one picker: amber means "selected" in both, and an idle tile shows
    // its drawing in `text` whether it is a tool or a creature (harness.ts `glyphColor`).
    for (const scheme of schemes) {
      const c = colors(scheme);
      expect(glyphInk(scheme, 'idle')).toBe(glyphColor('idle', c));
      expect(glyphInk(scheme, 'selected')).toBe(glyphColor('selected', c));
      expect(glyphInk(scheme, 'faint')).toBe(glyphColor('missing', c));
    }
    expect(glyphInk('dark', 'idle')).not.toBe(glyphInk('dark', 'rest'));
  });

  test('every tone reads on the surface it is drawn on', () => {
    // MEASURED: amber on the dark bg 10.4:1; light ink on the light bg 16.6:1; onAccent on
    // the amber tile 9.7:1; textFaint on the dark bg 3.2:1, which is decoration only, and is
    // only ever a carousel neighbour beside the creature at full ink.
    expect(contrast(glyphInk('dark'), colors('dark').bg)).toBeGreaterThan(10);
    expect(contrast(glyphInk('light'), colors('light').bg)).toBeGreaterThan(10);
    expect(contrast(glyphInk('dark', 'selected'), colors('dark').accent)).toBeGreaterThan(9);
    expect(contrast(glyphInk('dark', 'faint'), colors('dark').bg)).toBeGreaterThan(3);
    // Amber on the light background is why the light scheme draws in ink.
    expect(contrast(colors('light').accent, colors('light').bg)).toBeLessThan(2);
  });
});

describe('archetype → animal', () => {
  test('covers every archetype the spec declares, with a real animal', () => {
    const spec = ANALYSIS_ENUMS.archetype;
    expect(Object.keys(ARCHETYPE_ANIMALS).sort()).toEqual([...spec].sort());
    for (const archetype of spec) {
      const animal = animalForArchetype(archetype);
      expect(ANIMALS, archetype).toContain(animal);
      expect(isAnimal(animal)).toBe(true);
    }
  });

  test('the pairings are the documented ones', () => {
    expect(animalForArchetype('architect')).toBe('owl');
    expect(animalForArchetype('velocity_machine')).toBe('bee');
    expect(animalForArchetype('quality_guardian')).toBe('crab');
    expect(animalForArchetype('explorer')).toBe('octopus');
    expect(animalForArchetype('firefighter')).toBe('fox');
  });

  test('the night owl is NOT the owl', () => {
    // The architect has it. Two archetypes sharing a creature would make the picture
    // ambiguous exactly where it is meant to be the shorthand.
    expect(animalForArchetype('night_owl')).toBe('cat');
    expect(animalForArchetype('night_owl')).not.toBe(animalForArchetype('architect'));
  });

  test('the corpus rules reach two archetypes the per-session enum never does', () => {
    // `analysis/profile.py:ARCHETYPE_RULES` can return `director` or `skeptic`, which are
    // not in the spec's per-session enum. Before they were mapped, a director's profile
    // showed the fallback crab, which reads as a bug rather than as an archetype.
    expect(animalForArchetype('director')).toBe('dog');
    expect(animalForArchetype('skeptic')).toBe('whale');
    for (const a of Object.values(CORPUS_ARCHETYPE_ANIMALS)) expect(ANIMALS).toContain(a);
  });

  test('every archetype on either side gets a DIFFERENT animal, and the pack is used up', () => {
    // Eight archetypes across the two tables, eight animals in the pack, one-to-one. A
    // seventh per-session archetype or a seventh corpus rule fails here rather than
    // quietly sharing a creature with an existing one, which is the whole point of using
    // a creature as the shorthand.
    const keys = [...ANALYSIS_ENUMS.archetype, ...Object.keys(CORPUS_ARCHETYPE_ANIMALS)];
    expect(new Set(keys).size).toBe(keys.length);
    const chosen = keys.map((a) => animalForArchetype(a));
    expect(new Set(chosen).size).toBe(keys.length);
    expect(new Set(chosen)).toEqual(new Set(ANIMALS));
  });

  test('nothing unknown throws; it falls back', () => {
    for (const junk of [null, undefined, '', 'philosopher', 'ARCHITECT']) {
      expect(animalForArchetype(junk as Archetype | null)).toBe(DEFAULT_ANIMAL);
    }
    expect(isAnimal(DEFAULT_ANIMAL)).toBe(true);
  });
});

describe('the picker', () => {
  test('offers every animal, in pack order, labelled', () => {
    const choices = animalChoices();
    expect(choices.map((c) => c.id)).toEqual([...ANIMALS]);
    for (const c of choices) expect(c.label).toBe(ANIMAL_LABELS[c.id]);
  });

  test('a saved choice wins; anything else falls back to the archetype', () => {
    expect(resolveAnimal('whale', 'architect')).toBe('whale');
    expect(resolveAnimal(null, 'architect')).toBe('owl');
    expect(resolveAnimal(undefined, 'night_owl')).toBe('cat');
    // A stored id from a future (or older) build reads as unset rather than as nothing.
    expect(resolveAnimal('platypus', 'velocity_machine')).toBe('bee');
    expect(resolveAnimal(null, null)).toBe(DEFAULT_ANIMAL);
  });
});

describe('animal motion', () => {
  test('nothing drifts, scales or tilts: the table has no field for it', () => {
    // The pack used to drift four of eight creatures continuously (the bee two cells each
    // way every 900 ms) and breathe every one on a 1.03 scale, which keeps a pixel icon off
    // whole device pixels. The breath is drawn now, and the only transform is the entrance.
    for (const animal of ANIMALS) {
      expect(Object.keys(ANIMAL_MOTION[animal]).sort(), animal).toEqual(['beatMs', 'holds', 'note']);
    }
  });

  test('the timeline holds every frame once per loop, in order', () => {
    for (const animal of ANIMALS) {
      const timeline = animalTimeline(animal);
      expect(timeline.map((b) => b.frame)).toEqual(framesForAnimal(animal).map((_, i) => i));
      for (const beat of timeline) expect(beat.ms).toBeGreaterThan(0);
    }
  });

  test('a loop is calm: something changes at most once a second, and the gesture is brief', () => {
    // MEASURED: loops run 4.4 s (bee) to 6.6 s (owl); the gesture shows for 0.8 to 1.2 s.
    for (const animal of ANIMALS) {
      const timeline = animalTimeline(animal);
      const total = timeline.reduce((n, b) => n + b.ms, 0);
      expect(total, animal).toBeGreaterThanOrEqual(4000);
      expect(total / timeline.length, animal).toBeGreaterThanOrEqual(800);
      const gesture = timeline.slice(3).reduce((n, b) => n + b.ms, 0);
      expect(gesture, animal).toBeLessThanOrEqual(1200);
    }
  });

  test('Bit idles on the same shape of loop as the pack', () => {
    const idle = timelineFor('idle');
    expect(idle.map((b) => b.frame)).toEqual([0, 1, 2, 3]);
    expect(idle.map((b) => b.ms)).toEqual(MOTION.idle.holds.map((h) => h * MOTION.idle.beatMs));
    expect(SPRITES.idle[0]).toBe(SPRITES.idle[2]);
  });

  test('tempo shortens beats, and is clamped exactly as the mascot clamps it', () => {
    const at1 = animalTimeline('cat');
    const at2 = animalTimeline('cat', 2);
    expect(at2[0]!.ms).toBe(Math.round(at1[0]!.ms / 2));
    expect(animalTimeline('cat', 99)).toEqual(at2);
    expect(animalTimeline('cat', 0)).toEqual(at1);
    expect(animalTimeline('cat', Number.NaN)).toEqual(at1);
    expect(animalTimeline('cat', 0.1)).toEqual(animalTimeline('cat', clampTempo(0.1)));
  });

  test('every animal says what its loop is', () => {
    for (const animal of ANIMALS) expect(ANIMAL_MOTION[animal].note.length, animal).toBeGreaterThan(8);
  });
});
