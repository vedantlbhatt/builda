/**
 * One hue, one meaning, on the codebase map and the time lapse (`src/map/paint.ts`), and a time
 * lapse whose clock says what its playhead shows (`src/map/view.openingOf`).
 *
 * FOUND IN THE CAPTURE (2026-09-14, 73-map-sample and 74-timelapse-sample): the path, the stuck
 * files, their rings and the scrubber's bars were all the builder's purple, the purple of the band,
 * the play key and every build file; and under Reduce Motion the time lapse opened on its last
 * frame with its playhead at the right end of the scrubber while both of its clocks read "0s".
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SessionDetail } from '../src/data/api';
import type { PlainRole } from '../src/generated/live';
import { DATA, HUE_NAMES, SPECTRUM } from '../src/insights/palette';
import { spanOf } from '../src/map/frames';
import { FAIL_INK, HUE_WORD, PATH_INK, ROLE_HUE, roleInk, SCRUB_INK, STUCK_ORDER, stuckHue } from '../src/map/paint';
import { mapSample } from '../src/map/sample';
import { elapsedLabel, legend, openingOf, rolesOnMap, timelapseContent } from '../src/map/view';
import { ANIMALS } from '../src/pixel/animals';
import { accentOf } from '../src/theme/accentRule';

const read = (rel: string) => readFileSync(join(import.meta.dir, '..', rel), 'utf8');
const ALL_ROLES = Object.keys(ROLE_HUE) as PlainRole[];
const spectrumInks = new Set(HUE_NAMES.flatMap((h) => [SPECTRUM[h].ink, SPECTRUM[h].partner]));

const NOW = Date.parse('2026-09-13T15:00:00Z');
const base = {
  id: 'sample',
  client_session_id: 'sample',
  harness: 'claude_code',
  repo_name: 'sample',
  started_at: '2026-09-13T13:00:00Z',
  ended_at: '2026-09-13T14:02:00Z',
  state: 'live',
} as unknown as SessionDetail;

describe('the stuck files wear a hue no kind of file and not the band wears', () => {
  test('coral, the one hue no kind of file wears, for every builder but the crab, who wears it', () => {
    expect(Object.values(ROLE_HUE)).not.toContain('coral');
    const most: PlainRole[] = ['source', 'test', 'config', 'docs'];
    for (const animal of ANIMALS) {
      const accent = accentOf(animal).name;
      const got = stuckHue(accent, most);
      if (accent === 'coral') expect({ animal, got, clash: got === 'coral' || most.some((r) => ROLE_HUE[r] === got) }).toEqual({ animal, got, clash: false });
      else expect({ animal, got }).toEqual({ animal, got: 'coral' });
    }
  });

  test('for every builder and every mix of kinds of file on a map: never a kind\'s hue, never the band\'s', () => {
    const kinds = ALL_ROLES.filter((r) => r !== 'unknown');
    for (const animal of ANIMALS) {
      const accent = accentOf(animal).name;
      for (let mask = 0; mask < 1 << kinds.length; mask += 7) {
        const roles = kinds.filter((_, i) => mask & (1 << i));
        const got = stuckHue(accent, roles);
        const worn = new Set(roles.map((r) => ROLE_HUE[r]));
        // With every kind on the map and the builder wearing the last free hue there is nothing
        // left; the builder's own is given up first, never a kind's.
        if (roles.length < kinds.length) expect({ animal, roles, got, clash: worn.has(got) || got === accent }).toEqual({ animal, roles, got, clash: false });
        else expect({ animal, got, kind: worn.has(got) }).toEqual({ animal, got, kind: false });
      }
    }
  });

  test('every hue has a word for the key, and the order names each hue once', () => {
    expect([...STUCK_ORDER].sort()).toEqual([...HUE_NAMES].sort());
    for (const h of HUE_NAMES) expect(HUE_WORD[h]).toMatch(/^[a-z]+$/);
    const key = legend('timelapse', { knot: true, reduceMotion: true, path: true, stuck: HUE_WORD.coral });
    expect(key.find((i) => i.swatch === 'knot')!.text).toBe('Outlined in pink: the files it was stuck on, while it was stuck.');
  });
});

describe('on the sample time lapse, every mark that is read by colour is its own colour', () => {
  const lapse = mapSample(base, 'map', NOW);
  const content = timelapseContent(lapse);
  if (content.kind !== 'ready') throw new Error(`the sample has frames: ${content.kind}`);
  const roles = rolesOnMap(content.files);

  test('the kinds of file, the band, the path, the stuck files, a failure and the scrubber\'s bars', () => {
    for (const animal of ANIMALS) {
      const accent = accentOf(animal);
      const stuck = SPECTRUM[stuckHue(accent.name, roles)].ink;
      const marks: Record<string, string> = {
        band: accent.ink,
        path: PATH_INK,
        stuck,
        fail: FAIL_INK,
        change: SCRUB_INK.change,
        read: SCRUB_INK.read,
      };
      for (const r of roles) marks[`kind:${r}`] = roleInk(r).ink;
      // A kind of file is allowed to be the builder's own hue (the kinds are the same for everyone);
      // no other mark is.
      const rest = Object.entries(marks).filter(([k]) => !(k.startsWith('kind:') && marks[k] === accent.ink) && !(k === 'band' && roles.some((r) => roleInk(r).ink === accent.ink)));
      const inks = rest.map(([, v]) => v);
      expect({ animal, clash: new Set(inks).size !== inks.length }).toEqual({ animal, clash: false });
      expect({ animal, stuckIsBand: stuck === accent.ink, pathIsBand: PATH_INK === accent.ink }).toEqual({ animal, stuckIsBand: false, pathIsBand: false });
    }
  });

  test('the path and the scrubber are neutrals: no hue on the page means them as well', () => {
    for (const ink of [PATH_INK, SCRUB_INK.change, SCRUB_INK.read]) expect(spectrumInks.has(ink)).toBe(false);
    expect(FAIL_INK).toBe(DATA.del);
  });

  test('the screens hand the canvas, the scrubber, the key and the stuck sentence the one stuck ink (a source check)', () => {
    const tl = read('app/you/timelapse/[id].tsx');
    expect(tl).toMatch(/stuckHue\(accent\.name, roles\)/);
    expect(tl).toMatch(/<MapCanvas[\s\S]*?stuck=\{stuck\}/);
    expect(tl).toMatch(/<Scrubber[\s\S]*?stuck=\{stuck\}/);
    expect(tl).toMatch(/<Legend items=\{items\} roles=\{roles\} stuck=\{stuck\} \/>/);
    expect(tl).toMatch(/color: inKnot \? stuck : GROUND\.dim/);
    const map = read('app/you/map/[id].tsx');
    expect(map).toMatch(/<MapCanvas[\s\S]*?stuck=\{stuck\}/);
    expect(map).toMatch(/<Legend items=\{items\} roles=\{roles\} stuck=\{stuck\} \/>/);
    const canvas = read('src/map/MapCanvas.tsx');
    expect(canvas).not.toMatch(/inks\.accent/);
    const scrub = read('src/map/Scrubber.tsx');
    expect(scrub).not.toMatch(/partner/);
    expect(scrub).toMatch(/SCRUB_INK\.change, DATA\.del, SCRUB_INK\.read/);
  });
});

describe('the time lapse\'s clock says what its playhead shows', () => {
  const lapse = mapSample(base, 'map', NOW);
  const content = timelapseContent(lapse);
  if (content.kind !== 'ready') throw new Error('the sample has frames');
  const span = Math.max(1, spanOf(content.frames));

  test('under Reduce Motion it opens on the last frame, and so do its words', () => {
    const o = openingOf(span, true);
    expect(o).toEqual({ playhead: span, position: span, ended: true });
    // The playhead the scrubber draws, as a share of its width, and the words both clocks start from.
    expect(o.playhead / span).toBe(1);
    expect(elapsedLabel(o.position)).toBe(elapsedLabel(span));
    expect(elapsedLabel(o.position)).not.toBe('0s');
  });

  test('otherwise it opens at the start, and says 0s', () => {
    expect(openingOf(span, false)).toEqual({ playhead: 0, position: 0, ended: false });
    expect(elapsedLabel(openingOf(span, false).position)).toBe('0s');
  });

  test('both clocks start from the position, never from 0 (a source check)', () => {
    const words = read('src/map/MapWords.tsx');
    expect(words).not.toMatch(/defaultValue=\{elapsedLabel\(0\)\}/);
    expect(words.match(/defaultValue=\{elapsedLabel\(at\)\}/g)?.length).toBe(2);
    const tl = read('app/you/timelapse/[id].tsx');
    expect(tl).toMatch(/<ReplayFigure playhead=\{pb\.playhead\} at=\{pb\.position\}/);
    expect(tl).toMatch(/<ReplayControls[\s\S]*?at=\{pb\.position\}/);
    expect(read('src/map/usePlayback.ts')).toMatch(/const opening = openingOf\(span, startAtEnd\);/);
  });
});
