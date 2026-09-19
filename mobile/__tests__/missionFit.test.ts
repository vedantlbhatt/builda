/**
 * No word on a mission control tile is broken inside itself (`src/live/fit.ts`). FOUND IN THE
 * FINAL CAPTURE (2026-09-13, shots 70 and 72): "convergin" over "g" on a half tile. These hold the
 * fit to every word a tile's state row can say, at every tile size, on the phones the app runs on,
 * at the reader's text size up to the tile's cap, and hold the width table to SF Pro itself when
 * this machine has the font and fontTools.
 */
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import {
  fitWords,
  MARGIN,
  runEms,
  STACK_AT,
  stateLayout,
  STATE_GAP,
  tileMeasures,
  unbreakableRuns,
  VARIANT,
  widestRunEms,
  type TileVariant,
} from '../src/live/fit';
import { TILE_MAX_SCALE, tileWidthFor } from '../src/live/mission';

/** Every word a state row can say (`MissionTile.StateRow`): the verdicts and the other states. */
const STATE_WORDS = ['converging', 'circling', 'lost', 'needs you', 'finished', 'starting', 'quiet', 'not updating'];
/** iPhone SE, 13 mini, 16, 16 Pro, 16 Pro Max: the widths a tile is laid out on. */
const SCREENS = [320, 375, 393, 402, 440];
const VARIANTS: TileVariant[] = ['lead', 'wide', 'half'];
const SCALES = [1, 1.15, TILE_MAX_SCALE];

/** What a run is drawn at: its ems at the size, grown by the reader's scale. */
const drawn = (text: string, size: number, scale: number, face: 'sans' | 'mono' = 'sans') => widestRunEms(text, face) * size * scale;

describe('the measure a word is set in', () => {
  test('a line breaks between words and after a hyphen or a slash, never inside a word', () => {
    expect(unbreakableRuns('not updating')).toEqual(['not', 'updating']);
    expect(unbreakableRuns('gt-transit')).toEqual(['gt-', 'transit']);
    expect(unbreakableRuns('apps/web  builder')).toEqual(['apps/', 'web', 'builder']);
    // A no-break space holds a private project's number to its words: one run, not two.
    expect(unbreakableRuns('Private project\u00a02')).toEqual(['Private', 'project\u00a02']);
    expect(unbreakableRuns('')).toEqual([]);
  });

  test('the widest run decides: "converging" is wider than "lost"', () => {
    expect(widestRunEms('converging', 'sans')).toBeGreaterThan(widestRunEms('lost', 'sans'));
    expect(widestRunEms('not updating', 'sans')).toBe(runEms('updating', 'sans'));
    // An unknown character counts as a whole em, wider than any letter in the table.
    expect(runEms('中', 'sans')).toBe(1);
    expect(runEms('abc', 'mono')).toBeCloseTo(3 * 0.618, 6);
  });

  test('a word that fits keeps its role size; one that does not is set where it does', () => {
    expect(fitWords('lost', 200, 14)).toBe(14);
    const size = fitWords('converging', 77, 14);
    expect(size).toBeLessThan(14);
    expect(drawn('converging', size, 1) * (1 + MARGIN)).toBeLessThanOrEqual(77);
    // No measure (a tile before layout) changes nothing rather than dividing by zero.
    expect(fitWords('converging', 0, 14)).toBe(14);
    expect(fitWords('', 50, 14)).toBe(14);
  });
});

describe('shot 70: the half tile on an iPhone 16 Pro', () => {
  test('"converging" stays whole beside its glyph, set a little smaller', () => {
    const v = VARIANT.half;
    const { lower } = tileMeasures('half', tileWidthFor('half', 402));
    const fit = stateLayout('converging', lower, v.glyph, STATE_GAP, v.state, 1);
    expect(fit.stacked).toBe(false);
    expect(fit.size).toBeLessThan(v.state);
    expect(fit.size).toBeGreaterThanOrEqual(v.state * STACK_AT);
    expect(drawn('converging', fit.size, 1)).toBeLessThanOrEqual(lower - v.glyph - STATE_GAP);
  });
});

describe('every state word, every tile, every phone, every text size', () => {
  test('the word is drawn inside its measure, beside the glyph or whole under it', () => {
    for (const screen of SCREENS) {
      for (const variant of VARIANTS) {
        const v = VARIANT[variant];
        const { lower } = tileMeasures(variant, tileWidthFor(variant, screen));
        for (const scale of SCALES) {
          for (const word of STATE_WORDS) {
            const fit = stateLayout(word, lower, v.glyph, STATE_GAP, v.state, scale);
            const measure = fit.stacked ? lower : lower - v.glyph - STATE_GAP;
            expect(fit.size).toBeLessThanOrEqual(v.state);
            expect(drawn(word, fit.size, scale)).toBeLessThanOrEqual(measure);
          }
        }
      }
    }
  });

  test('a repository name and a sentence are held to the same rule', () => {
    const repos = ['builder', 'gt-transit', 'private repo', 'Private project\u00a02', 'Private project\u00a012', 'RideGT', 'overnightanalysisworkspace'];
    const sentences = ['Stuck on the same failing command for twenty minutes', 'Rewriting a source file, third attempt', 'Waiting on you for four minutes'];
    for (const screen of SCREENS) {
      for (const variant of VARIANTS) {
        const v = VARIANT[variant];
        const m = tileMeasures(variant, tileWidthFor(variant, screen));
        for (const scale of SCALES) {
          for (const r of repos) expect(drawn(r, fitWords(r, m.repo, v.repo, 'mono', scale), scale, 'mono')).toBeLessThanOrEqual(m.repo);
          for (const s of sentences) expect(drawn(s, fitWords(s, m.inner, v.sentence, 'sans', scale), scale)).toBeLessThanOrEqual(m.inner);
        }
      }
    }
  });
});

describe('the width table is SF Pro itself', () => {
  const FONT = '/System/Library/Fonts/SFNS.ttf';
  const probe = existsSync(FONT) ? spawnSync('python3', ['-c', 'import fontTools'], { encoding: 'utf8' }) : null;
  const can = probe !== null && !probe.error && probe.status === 0;

  test.skipIf(!can)('every letter of the table is the advance fontTools reads at wght 800, opsz 17', () => {
    const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const run = spawnSync(
      'python3',
      [
        '-c',
        `
import json, sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
f = instancer.instantiateVariableFont(TTFont(${JSON.stringify(FONT)}), {'wght': 800, 'opsz': 17, 'wdth': 100, 'GRAD': 400})
cmap = f.getBestCmap(); upm = f['head'].unitsPerEm
print(json.dumps({c: f['hmtx'][cmap[ord(c)]][0] / upm for c in sys.argv[1]}))
`,
        letters,
      ],
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
    );
    expect(run.status).toBe(0);
    const measured = JSON.parse(run.stdout) as Record<string, number>;
    for (const ch of letters) expect(Math.abs(runEms(ch, 'sans') - measured[ch]!)).toBeLessThan(0.001);
    // Instancing the variable font takes 2 to 3 s idle and 6.6 to 9.9 s while native builds share
    // the machine (measured 2026-09-19): past bun's 5 s default, which failed a correct table on
    // load. The question is whether the widths are right, not how busy the Mac is.
  }, 30_000);
});
