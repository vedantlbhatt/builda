/**
 * Bit, the pixel mascot: frame geometry, glyph vocabulary, and the palette.
 *
 * A frame with one dropped character shifts the face sideways in that row; a frame with
 * an unknown glyph renders a hole. Neither crashes, both look wrong on a phone in a way
 * that is easy to miss on a diff and hard to unsee afterwards, so every frame is checked.
 */

import { describe, expect, test } from 'bun:test';

import {
  BODY_GLYPHS,
  EYES,
  GLYPHS,
  GRID,
  ascii,
  countGlyphs,
  eyesOpen,
  holes,
  isValidFrame,
  mirror,
  runsFor,
  validateFrame,
  type Frame,
} from '../src/pixel/frames';
import { closeEyes } from '../src/pixel/motion';
import { glyphInk, spritePalette } from '../src/pixel/palette';
import { SPRITES, SPRITE_STATES, framesFor } from '../src/pixel/sprites';
import { tokens } from '../src/generated/tokens';
import { colors } from '../src/theme';

const BODY_TOLERANCE = 4;

describe('sprite states', () => {
  test('every declared state has frames and every table entry is declared', () => {
    expect(Object.keys(SPRITES).sort()).toEqual([...SPRITE_STATES].sort());
    expect(SPRITE_STATES).toEqual([
      'idle',
      'blink',
      'building',
      'sleeping',
      'celebrating',
      'thinking',
      'waving',
    ]);
  });

  for (const state of SPRITE_STATES) {
    describe(state, () => {
      const frames = framesFor(state);

      test('has 2 to 4 frames', () => {
        expect(frames.length).toBeGreaterThanOrEqual(2);
        expect(frames.length).toBeLessThanOrEqual(4);
      });

      test(`every frame is ${GRID}x${GRID} and uses only known glyphs`, () => {
        frames.forEach((frame, i) => {
          expect(validateFrame(frame), `${state}[${i}]\n${ascii(frame)}`).toEqual([]);
          expect(isValidFrame(frame)).toBe(true);
        });
      });

      test(`body pixel count is consistent within ±${BODY_TOLERANCE}, eyes counted shut`, () => {
        // A frame with a dropped character is what this catches. A blink is not one: it fills
        // the two 2x2 eye holes, eight cells by design, so every frame is measured blinked.
        const counts = frames.map((f) => countGlyphs(closeEyes(f), BODY_GLYPHS));
        const min = Math.min(...counts);
        const max = Math.max(...counts);
        expect(max - min, `${state} body counts ${counts.join(', ')}`).toBeLessThanOrEqual(
          BODY_TOLERANCE
        );
      });

      test('every frame draws a body and no frame is a duplicate of its neighbour', () => {
        for (const f of frames) expect(countGlyphs(f, BODY_GLYPHS)).toBeGreaterThan(40);
        for (let i = 1; i < frames.length; i++) {
          expect(frames[i]!.join('\n')).not.toBe(frames[i - 1]!.join('\n'));
        }
      });
    });
  }

  test('the character is one character: the family eyes, open, blinking or asleep', () => {
    // Open is the family's two 2x2 holes (`EYES`). The blink frame fills them. Asleep, they
    // are two 2x1 slits on row 7, the lower half of each eye. Nothing else is allowed: no
    // glint, no eye colour.
    const slits = ['5,7', '6,7', '9,7', '10,7'];
    for (const state of SPRITE_STATES) {
      for (const f of framesFor(state)) {
        const shown = `${state}\n${ascii(f)}`;
        const eyeHoles = holes(f)
          .map(([x, y]) => `${x},${y}`)
          .filter((k) => [...slits, ...EYES.map(([x, y]) => `${x},${y}`)].includes(k));
        if (state === 'sleeping') expect(eyeHoles.sort(), shown).toEqual([...slits].sort());
        else if (f === framesFor('blink')[2]) expect(EYES.every(([x, y]) => f[y]![x] === 'b'), shown).toBe(true);
        else expect(eyesOpen(f), shown).toBe(true);
      }
    }
  });

  test('building frames read as hammering: the hammer is in every frame and comes down', () => {
    const frames = framesFor('building');
    // The hammer is `h`, a 3x2 head on a handle: 5 to 8 cells, never gone.
    for (const f of frames) expect(countGlyphs(f, ['h'])).toBeGreaterThanOrEqual(5);
    const headRows = frames.map((f) => {
      let sum = 0;
      let n = 0;
      f.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) if (row[x] === 'h') { sum += y; n += 1; }
      });
      return sum / n;
    });
    // Raised, level, struck: the head descends across the first three frames.
    expect(headRows[0]!).toBeLessThan(headRows[1]!);
    expect(headRows[1]!).toBeLessThan(headRows[2]!);
    // The strike frame has sparks; the raised frame has none.
    expect(sparks(framesFor('building')[2]!)).toBeGreaterThan(0);
    expect(sparks(framesFor('building')[0]!)).toBe(0);
  });

  test('sleeping frames have closed eyes and a z trail that grows', () => {
    const zs = framesFor('sleeping').map((f) => countGlyphs(f, ['z']));
    for (let i = 1; i < zs.length; i++) expect(zs[i]!).toBeGreaterThan(zs[i - 1]!);
    for (const f of framesFor('sleeping')) expect(countGlyphs(f, ['w'])).toBe(0);
  });

  test('blink starts from the idle pose', () => {
    expect(framesFor('blink')[0]).toBe(framesFor('idle')[0]);
  });
});

/** Sparks: every `w` is one, now that Bit has no eye highlight. */
function sparks(frame: Frame): number {
  return countGlyphs(frame, ['w']);
}

describe('runsFor', () => {
  test('merges runs and preserves order', () => {
    expect(runsFor('..bbb.b')).toEqual([
      { start: 0, length: 2, ch: '.' },
      { start: 2, length: 3, ch: 'b' },
      { start: 5, length: 1, ch: '.' },
      { start: 6, length: 1, ch: 'b' },
    ]);
  });

  test('a uniform row is one run; an empty row is none', () => {
    expect(runsFor('bbbbbbbbbbbbbbbb')).toEqual([{ start: 0, length: 16, ch: 'b' }]);
    expect(runsFor('')).toEqual([]);
  });

  test('runs tile the row exactly', () => {
    for (const state of SPRITE_STATES) {
      for (const f of framesFor(state)) {
        for (const row of f) {
          const runs = runsFor(row);
          expect(runs.reduce((n, r) => n + r.length, 0)).toBe(row.length);
          let cursor = 0;
          for (const r of runs) {
            expect(r.start).toBe(cursor);
            expect(row.slice(r.start, r.start + r.length)).toBe(r.ch.repeat(r.length));
            cursor += r.length;
          }
          for (let i = 1; i < runs.length; i++) expect(runs[i]!.ch).not.toBe(runs[i - 1]!.ch);
        }
      }
    }
  });
});

describe('validateFrame', () => {
  test('rejects the wrong row count', () => {
    expect(validateFrame(['.'.repeat(16)])).toContain('expected 16 rows, got 1');
  });

  test('rejects a short row and an unknown glyph, naming the position', () => {
    const f = Array.from({ length: 16 }, () => '.'.repeat(16));
    f[3] = '.'.repeat(15);
    f[5] = '....X...........';
    const problems = validateFrame(f);
    expect(problems).toContain('row 3: expected 16 columns, got 15');
    expect(problems).toContain("row 5 col 4: unknown glyph 'X'");
    expect(problems).toHaveLength(2);
  });
});

describe('mirror', () => {
  test('is an involution on every sprite frame', () => {
    for (const state of SPRITE_STATES) {
      for (const f of framesFor(state)) {
        expect(mirror(mirror(f))).toEqual(f);
        expect(mirror(f)).not.toBe(f);
      }
    }
  });

  test('flips horizontally', () => {
    expect(mirror(['b...', '.dw.'])).toEqual(['...b', '.wd.']);
  });

  test('the idle pose faces forward: it is its own mirror image', () => {
    // It used to be symmetric only "apart from the eye highlights". There are none now.
    const idle = framesFor('idle')[0]!;
    expect(mirror(idle)).toEqual(idle);
  });
});

describe('palette', () => {
  test('every role is one ink: the roles say which pixels move, not which colour they are', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const p = spritePalette(scheme);
      expect(Object.keys(p).sort()).toEqual([...GLYPHS].sort());
      for (const v of Object.values(p)) expect(v).toMatch(/^#[0-9A-F]{6}$/i);
      expect(new Set(Object.values(p)).size, scheme).toBe(1);
    }
  });

  test('amber on dark, amber mark tone on light: Bit is never the 1.7:1 amber on the light background', () => {
    // OWNER OVERRIDE, 2026-09-13 (brief.md): the one accent rule is lifted for identity, and Bit
    // is the amber creature of the spectrum. On dark that is the accent itself; on #FBF9F5 the
    // accent is 1.7:1 (DESIGN-DIRECTION 3.1), so light draws Bit in amber's 3:1 mark tone
    // (`tokens.spectrum.hues.amber.light`) where it used to draw him in `text`.
    expect(spritePalette('dark').b).toBe(colors('dark').accent);
    expect(spritePalette('light').b).toBe(tokens.spectrum.hues.amber.light);
    expect(spritePalette('light').b).not.toBe(colors('light').accent);
    expect(spritePalette('dark', 'selected').b).toBe(String(colors('dark').onAccent));
    expect(spritePalette('dark', 'faint').b).toBe(colors('dark').textFaint);
    expect(spritePalette('dark').b).toBe(glyphInk('dark'));
  });

  test('there is no dark body role and no eye colour left to creep back in', () => {
    // The old `d` (accent x0.62) and `e` (the background, drawn as eyes) are gone from the
    // vocabulary, so a frame that uses either fails `validateFrame`.
    expect(GLYPHS).toEqual(['b', 'w', 'h', 'z']);
    expect(BODY_GLYPHS).toEqual(['b']);
    const f = Array.from({ length: GRID }, () => '.'.repeat(GRID));
    f[0] = 'd'.padEnd(GRID, '.');
    f[1] = 'e'.padEnd(GRID, '.');
    expect(validateFrame(f)).toEqual(["row 0 col 0: unknown glyph 'd'", "row 1 col 0: unknown glyph 'e'"]);
  });
});
