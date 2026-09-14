/**
 * The Projects tab and the project page: every rule their drawings and words rest on, without a
 * renderer (`src/projects/model.ts` and `src/projects/geometry.ts` are pure).
 *
 *   1. hues        a project wears one hue on every screen, never amber, and a newer project never
 *                  takes an older one's
 *   2. names       the owner's names stay on this phone: normalised, parsed strictly, kept by a
 *                  store that cannot send them, and shown everywhere a project is
 *   3. weeks       the rivers and the race read the block's weeks and nothing else: a week the
 *                  report did not send is not a week of zeroes, and the order within a week is one
 *                  rule, with no gap where the server left a project out
 *   4. geometry    the rivers stack without crossing and fill their height at the fullest week;
 *                  the race breaks a line where a week has no place; the swarm never overlaps
 *   5. the page    every figure rests on the copy helper's string, a refused number is a sentence,
 *                  and a project with nothing in the window keeps only what history can say
 *   6. the wiring  the tab sits between Sessions and You, the page is registered, and every Skia
 *                  helper a worklet calls is itself a worklet defined before it
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { hasDash } from '../src/copy/plain';
import { commas, n, shareWords } from '../src/copy/numbers';
import type { ReportProject, ReportProjects } from '../src/generated/report';
import { fixedFormatOf } from '../src/insights/format';
import { beeswarm, dotAt, insideOut, raceLayout, streamAt, streamLayout, SWARM_MAX, swarmRadius } from '../src/projects/geometry';
import {
  chapterHues,
  EMPTY_REGISTRY,
  hoursFigure,
  localDay,
  parseRegistry,
  projectLabel,
  projectLabels,
  registerProjects,
  hueDistance,
  NEIGHBOUR_DEGREES,
  hoursWords,
  NICKNAME_MAX,
  NICKNAMES_KEY,
  normalizeNickname,
  parseNicknames,
  preferredHue,
  PROJECT_HUES,
  projectDoors,
  projectHues,
  projectPage,
  projectsHero,
  projectsView,
  raceSummary,
  riverLine,
  riversLine,
  swarmLine,
  swarmSessions,
  weekLabel,
  weeklyRanks,
  weeklyView,
  WEEKS_EMPTY,
  WEEKS_NOT_SENT,
  WEEKS_QUIET,
  withNickname,
} from '../src/projects/model';
import { REPO } from './pythonRef';

const MOBILE = join(import.meta.dir, '..');
const block = (): ReportProjects => JSON.parse(readFileSync(join(REPO, 'spec', 'fixtures', 'projects', 'block.json'), 'utf8')) as ReportProjects;

function strings(obj: unknown, out: string[] = []): string[] {
  if (typeof obj === 'string') out.push(obj);
  else if (Array.isArray(obj)) for (const v of obj) strings(v, out);
  else if (obj && typeof obj === 'object') for (const v of Object.values(obj)) strings(v, out);
  return out;
}

function houseRules(obj: unknown) {
  for (const s of strings(obj)) {
    expect({ s, dash: hasDash(s) }).toEqual({ s, dash: false });
    expect(s).not.toMatch(/\b(null|undefined|NaN)\b/);
  }
}

const KEY = (c: string) => c.repeat(64);
const WEEKS = ['2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07'];

/** A block of `projects` over five weeks, each project's attended seconds a week as given. */
function weeks(projects: { key: string; first: string; attended: number[] }[], opts: { lastDays?: number } = {}): ReportProjects {
  const b = block();
  const proto = b.projects[0]!;
  b.projects = projects.map((p, i): ReportProject => ({
    ...structuredClone(proto),
    key: p.key,
    rank: i + 1,
    history: { ...structuredClone(proto.history), first_at: p.first, weeks: WEEKS.map((w, j) => ({ week: `${w}T00:00:00Z`, sessions: p.attended[j]! > 0 ? 2 : 0, attended_seconds: p.attended[j]!, active_seconds: p.attended[j]! })) },
  }));
  b.projects_total = projects.length;
  b.comparisons = [];
  b.weeks = WEEKS.map((w, j) => ({
    week: `${w}T00:00:00Z`,
    days: j === WEEKS.length - 1 ? (opts.lastDays ?? 7) : 7,
    sessions: projects.reduce((a, p) => a + (p.attended[j]! > 0 ? 2 : 0), 0),
    attended_seconds: projects.reduce((a, p) => a + p.attended[j]!, 0),
  }));
  return b;
}

// ------------------------------------------------------------------ 1. hues
describe('a project wears one hue', () => {
  test('the key names it, and the same key always names the same one', () => {
    const k = '5eed' + 'a'.repeat(60);
    expect(preferredHue(k)).toBe(preferredHue(k));
    expect(PROJECT_HUES).toContain(preferredHue(k));
  });

  test('never amber: the brand, and on a live surface the one hue that means needs you', () => {
    expect(PROJECT_HUES).not.toContain('amber');
    const many = Array.from({ length: 20 }, (_, i) => ({ key: i.toString(16).padStart(2, '0').repeat(32), history: { first_at: `2026-08-${String(i + 1).padStart(2, '0')}T00:00:00Z` } }));
    expect(Object.values(projectHues(many))).not.toContain('amber');
  });

  test('no two share a hue until there are more projects than hues', () => {
    const eight = Array.from({ length: 8 }, (_, i) => ({ key: '0'.repeat(63) + String(i), history: { first_at: `2026-08-0${i + 1}T00:00:00Z` } }));
    // Every one of these keys asks for the same hue; the oldest gets it and the rest step round.
    expect(new Set(eight.map((p) => preferredHue(p.key))).size).toBe(1);
    const hues = projectHues(eight);
    expect(new Set(Object.values(hues)).size).toBe(8);
    expect(hues[eight[0]!.key]).toBe(preferredHue(eight[0]!.key));
  });

  test('a newer project never takes an older one\'s hue', () => {
    const old = [
      { key: 'a'.repeat(64), history: { first_at: '2026-08-01T00:00:00Z' } },
      { key: 'b'.repeat(64), history: { first_at: '2026-08-05T00:00:00Z' } },
    ];
    const before = projectHues(old);
    const after = projectHues([{ key: '0'.repeat(64), history: { first_at: '2026-09-10T00:00:00Z' } }, ...old]);
    for (const p of old) expect(after[p.key]).toBe(before[p.key]!);
  });

  test('a chapter never wears its neighbour\'s hue, the hero\'s, or a project\'s on the page', () => {
    const got = chapterHues(['cobalt', 'heather', 'brass'], ['cobalt', 'tide']);
    expect(got).not.toContain('cobalt');
    expect(got).not.toContain('tide');
    expect(new Set(got).size).toBe(3);
    const page = chapterHues(['amber', 'heather', 'tide', 'ember', 'cobalt', 'coral', 'iris'], ['tide'], 'tide');
    expect(page).not.toContain('tide');
    for (let i = 1; i < page.length; i++) expect(page[i]).not.toBe(page[i - 1]);
  });

  test('no band sits beside one of its own family: 45 degrees round the wheel, hero and next door included', () => {
    expect(hueDistance('cobalt', 'iris')).toBeLessThan(NEIGHBOUR_DEGREES);
    expect(hueDistance('tide', 'cobalt')).toBeLessThan(NEIGHBOUR_DEGREES);
    for (const hero of ['iris', 'coral', 'tide', 'ember', 'brass', 'orchid', 'cobalt', 'heather', 'amber'] as const) {
      const got = chapterHues(['cobalt', 'heather', 'brass'], [hero, 'tide', 'ember'], hero, 'tide');
      const bands = [hero, ...got, 'tide' as const];
      for (let i = 1; i < bands.length; i++) expect({ hero, pair: [bands[i - 1], bands[i]], apart: hueDistance(bands[i - 1]!, bands[i]!) >= NEIGHBOUR_DEGREES }).toMatchObject({ apart: true });
    }
  });
});

// ------------------------------------------------------------------ 1b. the phone's own numbers
describe('a private project is called by a number this phone gave it, never by its key', () => {
  const at = (d: number) => `2026-08-${String(d).padStart(2, '0')}T12:00:00Z`;
  const p = (key: string, day: number) => ({ key, history: { first_at: at(day) } });
  const A = 'a'.repeat(64);
  const B = 'b'.repeat(64);
  const C = 'c'.repeat(64);

  test('numbered in the order of their first sessions, from 1', () => {
    const { registry, changed } = registerProjects(EMPTY_REGISTRY, [p(B, 16), p(A, 12)]);
    expect(changed).toBe(true);
    expect([registry.projects[A]!.n, registry.projects[B]!.n, registry.next]).toEqual([1, 2, 3]);
  });

  test('a number is never given twice, and a project keeps its number when it leaves and comes back', () => {
    const first = registerProjects(EMPTY_REGISTRY, [p(A, 12), p(B, 16)]).registry;
    // A newer report without A, with C, whose first session is OLDER than B's: C still takes 3.
    const second = registerProjects(first, [p(B, 16), p(C, 1)]).registry;
    expect(second.projects[C]!.n).toBe(3);
    const third = registerProjects(second, [p(A, 12)]);
    expect(third.changed).toBe(false);
    expect(third.registry.projects[A]!.n).toBe(1);
  });

  test('saved and read back, it is the same register; a broken or forged one is repaired to never repeat a number', () => {
    const reg = registerProjects(EMPTY_REGISTRY, [p(A, 12), p(B, 16)]).registry;
    expect(parseRegistry(JSON.stringify(reg))).toEqual(reg);
    expect(parseRegistry('{nope')).toEqual(EMPTY_REGISTRY);
    const forged = parseRegistry(JSON.stringify({ next: 1, projects: { [A]: { n: 7, hue: 'tide' }, zebra: { n: 2, hue: 'tide' }, [B]: { n: 2, hue: 'plaid' } } }));
    expect(Object.keys(forged.projects)).toEqual([A]);
    expect(forged.next).toBe(8);
  });

  test('no label ever carries a character run of the key (review, 2026-09-13: the key is an HMAC under a public pepper)', () => {
    const keys = Array.from({ length: 30 }, (_, i) => (i * 2654435761 >>> 0).toString(16).padStart(8, '0').repeat(8));
    const labels = projectLabels({ projects: keys.map((k, i) => p(k, i + 1)) });
    for (const k of keys) {
      const text = labels[k]!.text;
      expect(text).toMatch(/^Private project\u00a0\d+$/);
      for (let i = 0; i + 4 <= k.length; i++) expect(text.includes(k.slice(i, i + 4))).toBe(false);
    }
    expect(projectLabel(A, null, null)).toEqual({ text: 'Private project', source: 'private' });
    expect(projectLabel(A, null, null, 3)).toEqual({ text: 'Private project\u00a03', source: 'private' });
  });

  test('a hue once given is kept: a real clash, and the older project leaving the list', () => {
    // Every one of these keys asks for the same hue (its first eight hex digits, round the ring).
    const older = '00000000' + '1'.repeat(56);
    const younger = '00000008' + '2'.repeat(56);
    expect(preferredHue(older)).toBe(preferredHue(younger));
    const reg = registerProjects(EMPTY_REGISTRY, [p(older, 1), p(younger, 9)]).registry;
    expect(reg.projects[older]!.hue).toBe(preferredHue(older));
    expect(reg.projects[younger]!.hue).not.toBe(preferredHue(younger));
    // The older one drops out of the report's top 20: the younger keeps its stepped hue.
    expect(projectHues([p(younger, 9)], reg)[younger]).toBe(reg.projects[younger]!.hue);
    // Recomputed from nothing (no register) it would have moved: the bug the register fixes.
    expect(projectHues([p(younger, 9)])[younger]).toBe(preferredHue(younger));
  });
});

// ------------------------------------------------------------------ 1c. days
describe('an instant is said on the local day it fell on', () => {
  test('the review\'s instant: a first session at 00:44 UTC on Aug 12 was Aug 11 in New York', () => {
    expect(localDay('2026-08-12T00:44:30Z', -240)).toBe('2026-08-11');
    expect(weekLabel(localDay('2026-08-12T00:44:30Z', -240))).toBe('Aug 11');
    // In Tokyo it was 09:44 on Aug 12.
    expect(localDay('2026-08-12T00:44:30Z', 540)).toBe('2026-08-12');
    // The day turns at 04:00, the app's one day rule: 03:30 local is still the day before.
    expect(localDay('2026-08-12T07:30:00Z', -240)).toBe('2026-08-11');
    expect(localDay('2026-08-12T08:30:00Z', -240)).toBe('2026-08-12');
  });

  test('the page says since with it', () => {
    const b = block();
    const key = b.projects[0]!.key;
    b.projects[0]!.history.first_at = '2026-08-12T00:44:30Z';
    const since = projectPage(b, key)!.hero.since;
    expect(since).toBe(weekLabel(localDay('2026-08-12T00:44:30Z')));
  });
});

// ------------------------------------------------------------------ 2. names
describe('the owner\'s names stay on this phone', () => {
  const k = 'b'.repeat(64);

  test('one line of words, cut at the cap', () => {
    expect(normalizeNickname('  Ride   GT \n')).toBe('Ride GT');
    expect([...normalizeNickname('x'.repeat(80))].length).toBe(NICKNAME_MAX);
    expect(normalizeNickname('   ')).toBe('');
  });

  test('a saved name is kept only for a real key, and a broken blob is no names', () => {
    expect(parseNicknames(JSON.stringify({ [k]: ' RideGT ', zebra: 'x', ['c'.repeat(64)]: 7, ['d'.repeat(64)]: '  ' }))).toEqual({ [k]: 'RideGT' });
    expect(parseNicknames('{not json')).toEqual({});
    expect(parseNicknames('[1,2]')).toEqual({});
    expect(parseNicknames(null)).toEqual({});
  });

  test('naming and un-naming', () => {
    const one = withNickname({}, k, 'RideGT');
    expect(one).toEqual({ [k]: 'RideGT' });
    expect(withNickname(one, k, '  ')).toEqual({});
    expect(withNickname(one, k, null)).toEqual({});
  });

  test('kept under a kv key that sign out clears, by a store that imports no way off the phone', () => {
    expect(NICKNAMES_KEY.startsWith('device.')).toBe(false);
    const src = readFileSync(join(MOBILE, 'src/projects/nicknames.ts'), 'utf8');
    const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual(['../data/cache', './model', 'react'].sort());
    expect(src).not.toMatch(/\bfetch\(|\bapi\b\./);
  });

  test('a name shows everywhere a project does: the list, the weeks, the race, the page', () => {
    const b = block();
    const key = b.projects[0]!.key;
    const nick = { [key]: 'my ride' };
    expect(projectsView(b, null, nick)!.rows[0]!.label).toEqual({ text: 'my ride', source: 'nickname' });
    expect(weeklyView(b, null, nick)!.series[0]!.label.text).toBe('my ride');
    expect(projectPage(b, key, null, nick)!.detail.label.text).toBe('my ride');
    // A public name still wins over the owner's own.
    expect(weeklyView(b, { [key]: 'gt-transit' }, nick)!.series[0]!.label).toEqual({ text: 'gt-transit', source: 'public' });
  });
});

// ------------------------------------------------------------------ 3. weeks
describe('the weeks are the report\'s, and nothing else', () => {
  test('the fixture block reads on its own axis, every project on every week', () => {
    const b = block();
    const v = weeklyView(b)!;
    expect(v.weeks.map((w) => w.day)).toEqual(b.weeks!.map((w) => w.week.slice(0, 10)));
    for (const s of v.series) expect(s.attended.length).toBe(v.weeks.length);
    expect(v.totalSeconds).toBe(b.projects.reduce((a, p) => a + p.history.weeks!.reduce((x, w) => x + w.attended_seconds, 0), 0));
    expect(v.refusal).toBeNull();
    houseRules(v);
  });

  test('no weeks sent is not computed; no weeks at all and no time at all are their own sentences', () => {
    const old = block();
    delete (old as { weeks?: unknown }).weeks;
    expect(weeklyView(old)!.refusal).toBe(WEEKS_NOT_SENT);
    const empty = block();
    empty.weeks = [];
    expect(weeklyView(empty)!.refusal).toBe(WEEKS_EMPTY);
    const quiet = weeks([{ key: KEY('a'), first: '2026-08-10T00:00:00Z', attended: [0, 0, 0, 0, 0] }]);
    expect(weeklyView(quiet)!.refusal).toBe(WEEKS_QUIET);
    expect(weeklyView(null)).toBeNull();
  });

  test('the date a week is written on is its own: never moved to a zone', () => {
    expect(weekLabel('2026-08-31')).toBe('Aug 31');
    expect(weekLabel('2026-01-05')).toBe('Jan 5');
  });

  test('the order of a week: most time first, a tie to the list\'s order, no time no place', () => {
    const r = weeklyRanks([{ attended: [10, 0, 5] }, { attended: [20, 0, 5] }, { attended: [0, 0, 1] }], 3);
    expect(r).toEqual([
      [2, null, 1],
      [1, null, 2],
      [null, null, 3],
    ]);
  });

  test('a project the server left out leaves no gap in anybody\'s place', () => {
    const b = weeks([
      { key: KEY('a'), first: '2026-08-10T00:00:00Z', attended: [9000, 9000, 100, 100, 100] },
      { key: KEY('b'), first: '2026-08-12T00:00:00Z', attended: [100, 200, 9000, 9000, 9000] },
      { key: KEY('c'), first: '2026-08-14T00:00:00Z', attended: [50, 50, 50, 0, 50] },
    ]);
    b.projects = b.projects.filter((p) => p.key !== KEY('b'));
    const v = weeklyView(b)!;
    for (let w = 0; w < v.weeks.length; w++) {
      const places = v.series.map((s) => s.ranks[w]).filter((x): x is number => x !== null).sort();
      expect(places).toEqual(places.map((_, i) => i + 1));
    }
  });

  test('what a tap on a river says: its hours that week and its share, or that it had none', () => {
    const b = weeks(
      [
        { key: KEY('a'), first: '2026-08-10T00:00:00Z', attended: [3600 * 10, 3600 * 6, 0, 1800, 3600] },
        { key: KEY('b'), first: '2026-08-12T00:00:00Z', attended: [3600 * 10, 3600 * 2, 3600, 0, 0] },
      ],
      { lastDays: 3 },
    );
    const v = weeklyView(b)!;
    const a = v.series[0]!;
    // Every week sentence is the Mac's report, and says so (review, 2026-09-13): another
    // machine's uploads are on the phone and not in the report.
    expect(riverLine(v, a.key, 0)).toBe(`${a.label.text}: 10 hours of the 20 hours with you there that your Mac read in the week of Aug 10.`);
    expect(riverLine(v, a.key, 2)).toBe(`Your Mac read no time with you there in ${a.label.text} in the week of Aug 24.`);
    expect(riverLine(v, a.key, 3)).toBe(`${a.label.text}: all 30 minutes with you there that your Mac read in the week of Aug 31.`);
    expect(riverLine(v, a.key, 4)).toContain("Your Mac's report covers 3 days of it.");
    expect(riverLine(v, 'nope', 0)).toBeNull();
    expect(riversLine(v)).toContain('Tap a river to see its week.');
    expect(riversLine(v)).toContain('your Mac read');
    houseRules([riverLine(v, a.key, 0), riverLine(v, a.key, 4), riversLine(v)]);
  });

  test('the race: who led, how often the lead changed, and the latest week\'s order', () => {
    const b = weeks([
      { key: KEY('a'), first: '2026-08-10T00:00:00Z', attended: [9000, 9000, 100, 100, 0] },
      { key: KEY('b'), first: '2026-08-12T00:00:00Z', attended: [100, 200, 9000, 9000, 9000] },
      { key: KEY('c'), first: '2026-08-14T00:00:00Z', attended: [50, 50, 50, 0, 50] },
    ]);
    const race = raceSummary(weeklyView(b)!)!;
    expect(race.leader!.key).toBe(KEY('b'));
    expect(race.leader!.weeksLed).toBe(3);
    expect(race.weeksRanked).toBe(5);
    expect(race.weeksRead).toBe(5);
    expect(race.changes).toBe(1);
    expect(race.latest).toBe(4);
    expect(race.order.map((o) => [o.rank, o.key])).toEqual([
      [1, KEY('b')],
      [2, KEY('c')],
    ]);
    expect(race.resting.map((l) => l.text)).toEqual([weeklyView(b)!.series[0]!.label.text]);
    expect(race.lines[0]).toBe(`${race.leader!.label.text} led 3 of the 5 weeks your Mac read.`);
    expect(race.lines).toContain('The top place changed hands once.');
    expect(race.lines).toContain(`In the week of Sep 7, your Mac read no time with you there in ${race.resting[0]!.text}.`);
    houseRules(race.lines);
  });

  test('one project alone runs a race of one, and says so', () => {
    const b = weeks([{ key: KEY('a'), first: '2026-08-10T00:00:00Z', attended: [100, 0, 100, 100, 100] }]);
    const race = raceSummary(weeklyView(b)!)!;
    expect(race.lines[0]).toMatch(/^Only .+ had time with you there on your Mac in these weeks, so it led 4 of the 5 weeks your Mac read\.$/);
    expect(race.lines).toContain('Your Mac read no time with you there in any project in the week of Aug 17.');
    expect(race.lines.some((l) => /changed hands/.test(l))).toBe(false);
  });
});

// ------------------------------------------------------------------ 4. geometry
describe('the rivers', () => {
  const streams = [
    { key: 'small', values: [1, 2, 0, 1] },
    { key: 'big', values: [5, 6, 4, 8] },
    { key: 'mid', values: [3, 1, 3, 2] },
  ];

  test('the widest river runs down the middle, the others outside it by turns', () => {
    expect(insideOut(streams)).toEqual(['mid', 'big', 'small']);
    expect(insideOut([{ key: 'x', values: [1] }])).toEqual(['x']);
    expect(insideOut([])).toEqual([]);
  });

  test('stacked edge to edge, centred, and the fullest week fills the height', () => {
    const L = streamLayout(streams, 300, 200, 6);
    expect(L.peak).toBe(11);
    for (let w = 0; w < 4; w++) {
      for (let i = 1; i < L.streams.length; i++) expect(L.streams[i]!.top[w]).toBeCloseTo(L.streams[i - 1]!.bottom[w]!, 6);
      const top = L.streams[0]!.top[w]!;
      const bottom = L.streams[L.streams.length - 1]!.bottom[w]!;
      expect((top + bottom) / 2).toBeCloseTo(100, 6);
    }
    const full = L.streams[L.streams.length - 1]!.bottom[3]! - L.streams[0]!.top[3]!;
    expect(full).toBeCloseTo(200 - 12, 6);
    expect(L.xs[0]).toBe(6);
    expect(L.xs[3]).toBe(294);
  });

  test('a tap finds the river under it, and open water finds none', () => {
    const L = streamLayout(streams, 300, 200, 6);
    const big = L.streams.find((s) => s.key === 'big')!;
    expect(streamAt(L, 300, (big.top[3]! + big.bottom[3]!) / 2)).toEqual({ key: 'big', week: 3 });
    expect(streamAt(L, 300, 2).key).toBeNull();
  });
});

describe('the race', () => {
  test('a week with no place breaks the line, and a place past the rows leaves the chart', () => {
    const L = raceLayout(
      [
        { key: 'a', ranks: [1, 1, null, 2] },
        { key: 'b', ranks: [2, 9, 1, 1] },
      ],
      200,
      30,
      10,
      3,
    );
    expect(L.rows).toEqual([10, 40, 70]);
    const a = L.lines.find((l) => l.key === 'a')!;
    expect(a.runs.map((r) => r.points.map((p) => p.week))).toEqual([[0, 1], [3]]);
    const b = L.lines.find((l) => l.key === 'b')!;
    expect(b.runs.map((r) => r.points.map((p) => p.week))).toEqual([[0], [2, 3]]);
  });
});

describe('the swarm', () => {
  const items = Array.from({ length: 60 }, (_, i) => ({ id: `s${i}`, at: Date.UTC(2026, 7, 10) + Math.floor(i / 3) * 86_400_000, size: ((i * 37) % 11) * 900 + 60 }));
  const o = { rMin: 3, rMax: 16, gap: 1.5, pad: 4 };

  test('no two dots overlap, and none leaves the width', () => {
    const { dots } = beeswarm(items, 340, o);
    for (let i = 0; i < dots.length; i++) {
      const a = dots[i]!;
      expect(a.x - a.r).toBeGreaterThanOrEqual(-1e-6);
      expect(a.x + a.r).toBeLessThanOrEqual(340 + 1e-6);
      for (let j = i + 1; j < dots.length; j++) {
        const b = dots[j]!;
        expect(Math.hypot(a.x - b.x, a.dy - b.dy)).toBeGreaterThanOrEqual(a.r + b.r + o.gap - 1e-6);
      }
    }
  });

  test('the whole mark stays inside: the arc and the press ring past the disc too (capture pass, 2026-09-14)', () => {
    // The capture's shape: most of a project's sessions on its first and last days, so whole columns
    // stand at the axis's two ends, where the disc alone used to be kept in and its arc was cut flat.
    const ends = Array.from({ length: 40 }, (_, i) => ({ id: `e${i}`, at: i < 20 ? Date.UTC(2026, 7, 15) : Date.UTC(2026, 8, 13), size: ((i * 53) % 13) * 700 + 60 }));
    const rim = 6;
    const { dots, extent } = beeswarm(ends, 353, { ...o, gap: 5, rim });
    expect(dots.length).toBe(40);
    for (const d of dots) {
      expect(d.x - d.r - rim).toBeGreaterThanOrEqual(-1e-6);
      expect(d.x + d.r + rim).toBeLessThanOrEqual(353 + 1e-6);
    }
    // The Swarm leaves the rim above and below as well: its half height covers the farthest mark.
    const swarm = readFileSync(join(MOBILE, 'src/projects/Swarm.tsx'), 'utf8');
    expect(swarm).toMatch(/const half = Math\.max\(24, Math\.ceil\(swarm\.extent \+ RIM\) \+ 1\);/);
    expect(swarm).toMatch(/rim: RIM/);
    expect(extent).toBeGreaterThan(0);
    // Without a rim, the old rule: the disc alone inside.
    expect(Math.min(...beeswarm(ends, 353, { ...o, gap: 5 }).dots.map((d) => d.x - d.r))).toBeCloseTo(0, 6);
  });

  test('area by length, a floor a finger can find, and the same swarm every time', () => {
    expect(swarmRadius(4, 16, o) / swarmRadius(16, 16, o)).toBeCloseTo(0.5, 6);
    expect(swarmRadius(0, 16, o)).toBe(3);
    expect(beeswarm(items, 340, o)).toEqual(beeswarm(items, 340, o));
    const first = beeswarm(items, 340, o).dots;
    // Back in the order the sessions happened.
    for (let i = 1; i < first.length; i++) expect(items.find((s) => s.id === first[i]!.id)!.at).toBeGreaterThanOrEqual(items.find((s) => s.id === first[i - 1]!.id)!.at);
  });

  test('a tap finds the dot under it', () => {
    const { dots, extent } = beeswarm(items, 340, o);
    const axis = extent + 6;
    const d = dots[10]!;
    expect(dotAt(dots, axis, d.x, axis + d.dy)!.id).toBe(d.id);
    expect(dotAt(dots, axis, d.x, axis + extent + 60)).toBeNull();
  });

  test('never more than the cap: the newest, and the axis reaching back to the project\'s first session', () => {
    const many = Array.from({ length: SWARM_MAX + 50 }, (_, i) => ({ id: `m${i}`, started_at: new Date(Date.UTC(2026, 7, 1) + i * 3_600_000).toISOString(), active_seconds: 600, attended_seconds: 300 }));
    const got = swarmSessions(many, [], KEY('a'));
    expect(got.length).toBe(SWARM_MAX);
    expect(got[0]!.id).toBe('m50');
    const lay = beeswarm(many.map((m) => ({ id: m.id, at: Date.parse(m.started_at), size: 600 })), 340, o);
    expect(lay.dots.length).toBe(SWARM_MAX);
    const early = Date.UTC(2026, 6, 1);
    const reach = beeswarm(items, 340, o, early);
    expect(reach.from).toBe(early);
    // A dot is never cut off by an end it was given.
    expect(beeswarm(items, 340, o, undefined, items[0]!.at).to).toBe(Math.max(...items.map((x) => x.at)));
  });

  test('its sessions: the project\'s own rows and the saved rows under its key, each once, finished only', () => {
    const key = KEY('a');
    const row = (id: string, extra: Record<string, unknown> = {}) => ({ id, started_at: '2026-09-01T10:00:00Z', active_seconds: 3600, attended_seconds: 1800, ...extra });
    const got = swarmSessions([row('1'), row('2', { state: 'live' })], [row('1'), row('3', { repo_key: key }), row('4', { repo_key: KEY('b') }), row('5'), row('6', { repo_key: key, active_seconds: 0 })], key);
    expect(got.map((s) => s.id)).toEqual(['1', '3']);
    expect(got[0]!.attendedShare).toBe(0.5);
  });

  test('what it says under it: how many of how many, and why the Mac counts another number', () => {
    // Capped: the newest the swarm holds, of every session uploaded.
    expect(swarmLine(400, 155, 612)).toContain('The newest 400 of the 612 sessions uploaded here, a dot each.');
    // The review's page (2026-09-13): 19 uploaded, 5 in the Mac's report. Both say where they come from.
    const two = swarmLine(19, 5, 19);
    expect(two).toContain('All 19 sessions uploaded here, a dot each.');
    expect(two).toContain("Your Mac's report counts 5 sessions here, only the ones it read itself");
    expect(swarmLine(3, 3, 3)).not.toContain("Your Mac's report");
    expect(swarmLine(0, 12)).toMatch(/^No session of this project is on this phone yet/);
    houseRules([swarmLine(400, 155, 612), swarmLine(19, 5, 19), swarmLine(1, 1), swarmLine(0, 1)]);
  });
});

// ------------------------------------------------------------------ 5. the tab and the page
describe('the tab\'s hero and doors', () => {
  test('the count and the hours rest on the copy helpers, and a quiet window is a sentence', () => {
    const b = block();
    const v = projectsView(b)!;
    const hero = projectsHero(v, b, null, Date.parse('2026-09-21T00:00:00Z'));
    expect(hero.count.final).toBe(n(b.projects_total));
    // The block's own total, every sitting in the window: what each share is out of.
    expect(hero.hours!.final).toBe(n(b.window_attended_seconds! / 3600));
    expect(hero.hoursCaption).toBe('hours with you there on your Mac, the last 30 days');
    // An older Mac sends no total: the listed projects and the unresolved, added up.
    const old = block();
    delete (old as { window_attended_seconds?: unknown }).window_attended_seconds;
    const listed = old.projects.reduce((a, p) => a + p.window!.attended_seconds, 0) + old.unresolved.attended_seconds;
    expect(projectsHero(projectsView(old)!, old, null).hours!.final).toBe(n(listed / 3600));
    expect(hero.small.some((s) => s.includes('ran in no repository'))).toBe(true);
    houseRules(hero);
  });

  test('each door: its hue, its hours and share said as the copy helpers say them', () => {
    const b = block();
    const doors = projectDoors(projectsView(b)!, b, null);
    const hues = projectHues(b.projects);
    for (const [i, d] of doors.entries()) {
      const w = b.projects[i]!.window!;
      expect(d.hue).toBe(hues[d.key]!);
      expect(d.hours!.final).toBe(n(w.attended_seconds / 3600));
      expect(d.share!.final).toBe(shareWords(w.share_of_attended!));
      expect(d.a11y.endsWith('Opens the project.')).toBe(true);
    }
    houseRules(doors);
  });

  test('a project with nothing in the window says so and shows no number', () => {
    const b = block();
    b.projects[1]!.window = null;
    const d = projectDoors(projectsView(b)!, b, null)[1]!;
    expect([d.hours, d.share]).toEqual([null, null]);
    expect(d.quiet).toBe('Your Mac read nothing here in the last 30 days.');
  });
});

describe('the page', () => {
  test('every chapter\'s figures, each resting on its copy helper\'s string', () => {
    const b = block();
    const p = projectPage(b, b.projects[0]!.key, null, null, null, Date.parse('2026-09-21T00:00:00Z'))!;
    const w = b.projects[0]!.window!;
    expect(p.hero.hours!.final).toBe(n(w.attended_seconds / 3600));
    expect(p.hero.sessions!.final).toBe(n(w.sessions));
    expect(p.time!.activeDays!.final).toBe(n(w.active_days));
    expect(p.shipping!.added!.final).toBe(`+${commas(w.money.lines_added!)}`);
    expect(p.shipping!.commits!.total.final).toBe(commas(w.commits!.assisted + w.commits!.alone));
    expect(p.build!.rules.length).toBeGreaterThan(0);
    expect(p.build!.rules.filter((r) => r.winner).length).toBeLessThanOrEqual(1);
    expect(p.money!.notAbill.length).toBeGreaterThan(10);
    // Every figure that counts is one plain number with words round it, so its frames match its rest.
    for (const spec of [p.hero.hours, p.hero.sessions, p.hero.share, p.time!.activeDays, p.shipping!.added, p.money!.usd, p.money!.perHour]) {
      if (spec) expect(fixedFormatOf(spec.final)).not.toBeNull();
    }
    houseRules(p);
  });

  test('a refused number is its sentence, never a zero', () => {
    const b = block();
    const w = b.projects[0]!.window!;
    w.clock = { peak_hour: null, reason: 'below_active_floor', active_minutes: 25, needed_minutes: 60 };
    w.quality = { runs: 2, passed: null, failed: null, first_try_rate: null, time_to_green: null, reason: 'below_run_floor', needed: 5 };
    w.commits = null;
    const p = projectPage(b, b.projects[0]!.key)!;
    expect(p.time!.peak).toBeNull();
    expect(p.detail.peakHourRefusal).toBe('25 minutes of active time here, 60 needed.');
    expect(p.build!.green).toBeNull();
    expect(p.build!.greenRefusal).toBe('2 test runs in this window, 5 needed.');
    expect(p.shipping!.commits).toBeNull();
    expect(p.shipping!.commitsRefusal).toMatch(/^No commit was read for this project in/);
  });

  test('a project with nothing in the window keeps only what history can say', () => {
    const b = block();
    b.projects[1]!.window = null;
    const p = projectPage(b, b.projects[1]!.key)!;
    expect([p.time, p.build, p.shipping, p.money]).toEqual([null, null, null, null]);
    expect([p.hero.hours, p.hero.sessions, p.hero.share]).toEqual([null, null, null]);
    expect(p.hero.historySessions.final).toBe(n(b.projects[1]!.history.sessions));
    expect(projectPage(b, 'f'.repeat(64))).toBeNull();
  });

  test('hours in a sentence: whole minutes under an hour, one decimal over it', () => {
    expect(hoursWords(1799)).toBe('29 minutes');
    expect(hoursWords(3600)).toBe('1 hour');
    expect(hoursWords(218157)).toBe('60.6 hours');
    expect(hoursFigure(218157).final).toBe('60.6');
  });
});

// ------------------------------------------------------------------ 6. the wiring
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

describe('the wiring', () => {
  test('the tab sits between Sessions and You, with a glyph like the others', () => {
    const layout = code(readFileSync(join(MOBILE, 'app/(tabs)/_layout.tsx'), 'utf8'));
    const order = [...layout.matchAll(/<Tabs\.Screen name="([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(['now', 'sessions', 'projects', 'you']);
    const chrome = readFileSync(join(MOBILE, 'src/nav/chrome.tsx'), 'utf8');
    expect(chrome).toMatch(/projects: \{ rest: 'folder', active: 'folder\.fill' \}/);
  });

  test('the page is registered where the gate can see it', () => {
    const root = code(readFileSync(join(MOBILE, 'app/_layout.tsx'), 'utf8'));
    expect(root).toContain('<Stack.Screen name="project/[key]"');
  });

  test('every drawing lands to a still picture: recorded once when it has landed, never again a frame', () => {
    // Two reviews on 2026-09-13 found charts re-recording their whole picture every frame long
    // after they had landed. Every picture a project drawing records on a clock goes through the
    // drawing clock, and a still one recorded once replaces it.
    const drawings = ['Rivers.tsx', 'RankRace.tsx', 'Swarm.tsx', 'CommitDays.tsx', 'DayDial.tsx'];
    // The ones that record a moving picture on the clock, and must swap in a still one.
    const recorded = ['Swarm.tsx', 'CommitDays.tsx', 'DayDial.tsx'];
    for (const f of drawings) {
      const src = code(readFileSync(join(MOBILE, 'src/projects', f), 'utf8'));
      expect({ f, clock: src.includes('useDrawClock(') }).toEqual({ f, clock: true });
      expect({ f, rests: /\blanded \?/.test(src) }).toEqual({ f, rests: true });
      if (recorded.includes(f)) {
        expect({ f, still: /landed \? createPicture\(/.test(src) }).toEqual({ f, still: true });
        expect({ f, shown: /still \?\? moving/.test(src) }).toEqual({ f, shown: true });
      }
      // Never the block's own clock, which runs 3.2 seconds whatever the drawing is doing.
      expect({ f, block: /\buseClock\(\)/.test(src) }).toEqual({ f, block: false });
    }
    // Any other file here that records a picture is one of those.
    for (const name of readdirSync(join(MOBILE, 'src/projects'))) {
      if (!/\.tsx$/.test(name)) continue;
      const src = code(readFileSync(join(MOBILE, 'src/projects', name), 'utf8'));
      if (src.includes('createPicture(')) expect(drawings).toContain(name);
    }
    // The project page's day clock is its own (the analysis page's re-records on the block clock).
    const page = code(readFileSync(join(MOBILE, 'src/projects/ProjectPage.tsx'), 'utf8'));
    expect(page).not.toMatch(/\bDayClock\b/);
    expect(page).toMatch(/<DayDial [^>]*night=\{t\.nightShare !== null\}/);
  });

  test('every helper a drawing\'s worklet calls is a worklet, defined before the first worklet', () => {
    for (const f of ['Rivers.tsx', 'RankRace.tsx', 'Swarm.tsx', 'CommitDays.tsx', 'DayDial.tsx', 'drawClock.ts']) {
      const src = code(readFileSync(join(MOBILE, 'src/projects', f), 'utf8'));
      const firstWorklet = src.search(/use(?:DerivedValue|FrameCallback)\(/);
      expect(firstWorklet).toBeGreaterThan(0);
      const helpers = [...src.matchAll(/function (\w+)\([^)]*\)[^{]*\{\s*'worklet';/g)].map((m) => ({ name: m[1]!, at: m.index! }));
      for (const h of helpers) expect({ file: f, helper: h.name, before: h.at < firstWorklet }).toEqual({ file: f, helper: h.name, before: true });
      // A module function called inside any worklet (a derived value, a frame callback) that is not
      // itself a worklet would crash the UI thread: read every such call's whole argument list.
      const local = [...src.matchAll(/^function (\w+)\(/gm)].map((m) => m[1]!);
      const worklets = new Set(helpers.map((h) => h.name));
      const bodies: string[] = [];
      for (const m of src.matchAll(/use(?:DerivedValue|FrameCallback|AnimatedStyle)\(/g)) {
        let depth = 0;
        let i = m.index! + m[0].length - 1;
        for (; i < src.length; i++) {
          if (src[i] === '(') depth++;
          else if (src[i] === ')' && --depth === 0) break;
        }
        bodies.push(src.slice(m.index!, i));
      }
      expect(bodies.length).toBeGreaterThan(0);
      for (const body of bodies) {
        for (const name of local) {
          if (new RegExp(`\\b${name}\\(`).test(body)) expect({ file: f, name, worklet: worklets.has(name) }).toEqual({ file: f, name, worklet: true });
        }
      }
    }
  });

  test('no dash in any word the new screens say', () => {
    for (const f of ['ProjectsScreen.tsx', 'ProjectPage.tsx', 'Door.tsx', 'Rivers.tsx', 'RankRace.tsx', 'Swarm.tsx', 'CommitDays.tsx', 'DayDial.tsx', 'Comparisons.tsx', 'NameField.tsx', 'model.ts', 'recency.ts']) {
      const src = code(readFileSync(join(MOBILE, 'src/projects', f), 'utf8'));
      // String literals, the words of a template (its `${...}` holes are code), and JSX text.
      const literals = [...src.matchAll(/'([^'\n]*)'|`([^`]*)`|>([^<>{}=();\n]+)</g)].map((m) => (m[1] ?? m[2]?.replace(/\$\{[^}]*\}/g, ' ') ?? m[3] ?? ''));
      expect(literals.length).toBeGreaterThan(10);
      for (const s of literals) expect({ file: f, s, dash: hasDash(s) }).toEqual({ file: f, s, dash: false });
    }
  });
});
