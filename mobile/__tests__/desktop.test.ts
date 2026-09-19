/**
 * The desktop layout's rules (`src/desktop/`): when a window is a desktop, where each path sits
 * (which sidebar row is lit, which list stays beside it), the keyboard, the command palette's
 * ranking, the device grant's reading, the island's choices and its springs, and that the phone
 * sees none of it.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { useFormFactor, useIsDesktop } from '../src/desktop/formFactor';
import { PLACES, fold, rank, score, type PaletteItem } from '../src/desktop/paletteModel';
import { deviceLabel, devicePlatform, pairLink, readPoll } from '../src/desktop/pairing';
import { useIslandHost } from '../src/desktop/islandHost';
import { morphTarget, useFrame } from '../src/desktop/morphTarget';
import { usePaneOriginX } from '../src/desktop/paneOrigin';
import {
  CONTENT_MAX,
  DESKTOP_MIN_WIDTH,
  MASTER_WIDTH,
  SECTIONS,
  cleanPath,
  commandFor,
  formFactorFor,
  frameLayout,
  masterWidthFor,
  morphRectFor,
  paneRectFor,
  placeOf,
  shortcutLabel,
} from '../src/desktop/rules';
import { desktopTabs } from '../src/desktop/tabs';
import {
  EAR,
  EXPANDED_W,
  activitiesOf,
  PILL,
  PRIORITY,
  boxFor,
  crewLeadOf,
  dropPhase,
  dropSteps,
  hostOf,
  hrefOf,
  lead,
  minutesLabel,
  notificationFor,
  sampleActivity,
  spoken,
  type Activity,
} from '../src/desktop/island/model';
import * as islandMotion from '../src/desktop/island/motion';
import { crewFor } from '../src/live/crew';
import { missionSample } from '../src/live/mission';
import { STATE_INK } from '../src/desktop/island/palette';
import { parsePairingCode } from '../src/pairing/parse';
import { tokens } from '../src/generated/tokens';

const MOBILE = join(import.meta.dir, '..');

describe('form factor', () => {
  test('desktop is web and at least 900 wide; iOS and Android never are', () => {
    expect(formFactorFor('web', DESKTOP_MIN_WIDTH)).toBe('desktop');
    expect(formFactorFor('web', 1440)).toBe('desktop');
    expect(formFactorFor('web', DESKTOP_MIN_WIDTH - 1)).toBe('phone');
    expect(formFactorFor('web', 390)).toBe('phone');
    for (const os of ['ios', 'android']) for (const w of [390, 1024, 1366, 2732]) expect(formFactorFor(os, w)).toBe('phone');
  });

  test("the phone's hooks are constants: nothing subscribes, nothing changes", () => {
    // `formFactor.ts` is what iOS loads; the web twin reads the window.
    expect(useFormFactor()).toBe('phone');
    expect(useIsDesktop()).toBe(false);
    expect(usePaneOriginX()).toBe(0);
    // A morph grows to the whole screen, the island stays fused to the hardware one.
    expect(morphTarget('/session/abc')).toBeNull();
    expect(useFrame()).toEqual({ desktop: false, sidebar: 0, path: '/' });
    expect(useIslandHost()).toBeNull();
  });

  test('the tab navigator gets exactly the props it had on a phone', () => {
    expect(desktopTabs(false)).toEqual({});
    const d = desktopTabs(true);
    expect(typeof d.tabBar).toBe('function');
    expect(typeof d.screenLayout).toBe('function');
  });
});

describe('where a path sits', () => {
  test('group segments, queries and trailing slashes are not the path', () => {
    expect(cleanPath('/(tabs)/sessions/')).toBe('/sessions');
    expect(cleanPath('/session/abc?recap=1')).toBe('/session/abc');
    expect(cleanPath('')).toBe('/');
  });

  test('a list keeps its column beside what it opened', () => {
    expect(placeOf('/sessions')).toMatchObject({ section: 'sessions', master: 'sessions', masterRoot: true });
    expect(placeOf('/session/abc')).toMatchObject({ section: 'sessions', master: 'sessions', masterRoot: false });
    expect(placeOf('/drop/xyz')).toMatchObject({ section: 'drops', master: 'drops', masterRoot: false });
    expect(placeOf('/project/0123abcd')).toMatchObject({ section: 'projects', master: 'projects' });
    // A project's ship kit is about the project: beside the same list.
    expect(placeOf('/ship/0123abcd')).toMatchObject({ section: 'projects', master: 'projects', masterRoot: false });
  });

  test('pages without a list take the whole pane, and light their own row', () => {
    expect(placeOf('/now')).toMatchObject({ section: 'now', master: null });
    expect(placeOf('/live')).toMatchObject({ section: 'now', master: null });
    expect(placeOf('/you/money')).toMatchObject({ section: 'you', master: null });
    expect(placeOf('/analysis')).toMatchObject({ section: 'you' });
    expect(placeOf('/settings')).toMatchObject({ section: null, settings: true });
  });

  test('onboarding and the island draw their own window', () => {
    expect(placeOf('/onboarding/hello').bare).toBe(true);
    expect(placeOf('/island').bare).toBe(true);
    expect(placeOf('/now').bare).toBe(false);
  });

  test('a list never squeezes the detail beside it under a phone', () => {
    for (const m of ['sessions', 'drops', 'projects'] as const) {
      expect(masterWidthFor(m, 1440, 224)).toBe(MASTER_WIDTH[m]);
      for (const w of [900, 1000, 1100, 1280]) {
        const mw = masterWidthFor(m, w, 224);
        expect(mw).toBeGreaterThanOrEqual(320);
        expect(w - 224 - mw >= 390 || mw === 320).toBe(true);
      }
    }
    expect(CONTENT_MAX).toBeGreaterThan(900);
  });
});

describe('where a push is drawn, which is where a morph lands', () => {
  test('a detail opens in the pane right of its list', () => {
    // 1440 wide, the sidebar open (224): Sessions is 400, the wall 520.
    expect(paneRectFor('/session/abc?morph=1', 1440, 900, 224)).toEqual({ x: 624, y: 0, w: 816, h: 900 });
    expect(paneRectFor('/drop/xyz', 1440, 900, 224)).toEqual({ x: 744, y: 0, w: 696, h: 900 });
    expect(paneRectFor('/project/0123abcd', 1440, 900, 76)).toEqual({ x: 496, y: 0, w: 944, h: 900 });
  });

  test('a page with no list stops at CONTENT_MAX and sits in the middle of its room', () => {
    // 1440 - 224 = 1216 of room, 1120 of page, 48 either side.
    expect(paneRectFor('/analysis', 1440, 900, 224)).toEqual({ x: 272, y: 0, w: CONTENT_MAX, h: 900 });
    expect(paneRectFor('/live', 1100, 800, 224)).toEqual({ x: 224, y: 0, w: 876, h: 800 });
  });

  test("a list's own tab, onboarding and the island have no pane to grow into", () => {
    expect(paneRectFor('/sessions', 1440, 900, 224)).toBeNull();
    expect(paneRectFor('/drops', 1440, 900, 224)).toBeNull();
    expect(paneRectFor('/onboarding/hello', 1440, 900, 224)).toBeNull();
    expect(paneRectFor('/island', 1440, 900, 224)).toBeNull();
  });

  test('a morph covers what changes: the pane when the list stays, everything past the sidebar when it arrives', () => {
    expect(morphRectFor('/sessions', '/session/abc', 1440, 900, 224)).toEqual({ x: 624, y: 0, w: 816, h: 900 });
    expect(morphRectFor('/session/one', '/session/two', 1440, 900, 224)).toEqual({ x: 624, y: 0, w: 816, h: 900 });
    expect(morphRectFor('/drops', '/drop/xyz', 1440, 900, 224)).toEqual({ x: 744, y: 0, w: 696, h: 900 });
    // A tile on Now opens a session with the Sessions list beside it: both arrive together.
    expect(morphRectFor('/now', '/session/abc', 1440, 900, 224)).toEqual({ x: 224, y: 0, w: 1216, h: 900 });
    expect(morphRectFor('/live', '/session/abc', 1440, 900, 76)).toEqual({ x: 76, y: 0, w: 1364, h: 900 });
    // A band on You opens a page with no list: the same centred column.
    expect(morphRectFor('/you', '/analysis?morph=1', 1440, 900, 224)).toEqual({ x: 272, y: 0, w: CONTENT_MAX, h: 900 });
    expect(morphRectFor('/now', '/onboarding/hello', 1440, 900, 224)).toBeNull();
  });

  test('the frame and the morph read one rule', () => {
    const f = frameLayout(placeOf('/session/abc'), 1440, 900, 224);
    expect(f.master).toBe(masterWidthFor('sessions', 1440, 224));
    expect(f.room).toBe(1440 - 224 - f.master);
    expect(f.content).toEqual(paneRectFor('/session/abc', 1440, 900, 224)!);
  });
});

describe('the keyboard', () => {
  const k = (key: string, o: Partial<{ mod: boolean; shift: boolean; alt: boolean; typing: boolean }> = {}) =>
    commandFor({ key, mod: o.mod ?? true, shift: o.shift ?? false, alt: o.alt ?? false, typing: o.typing ?? false });

  test('Cmd or Ctrl and a number is a section, in the tab bar order', () => {
    SECTIONS.forEach((s, i) => expect(k(String(i + 1))).toEqual({ kind: 'section', section: s }));
    expect(k('6')).toBeNull();
    expect(k('1', { mod: false })).toBeNull();
    expect(k('1', { shift: true })).toBeNull();
  });

  test('comma, K, backslash; and Esc goes back unless a field has the keys', () => {
    expect(k(',')).toEqual({ kind: 'settings' });
    expect(k('k')).toEqual({ kind: 'search' });
    expect(k('K')).toEqual({ kind: 'search' });
    expect(k('\\')).toEqual({ kind: 'sidebar' });
    expect(k('Escape', { mod: false })).toEqual({ kind: 'back' });
    expect(k('Escape', { mod: false, typing: true })).toBeNull();
    expect(k('k', { alt: true })).toBeNull();
  });

  test('the shortcut is printed the way the platform prints it', () => {
    expect(shortcutLabel('darwin', '1')).toBe('⌘1');
    expect(shortcutLabel('win32', '1')).toBe('Ctrl+1');
    expect(shortcutLabel('linux', ',')).toBe('Ctrl+,');
  });
});

describe('the command palette', () => {
  const item = (id: string, kind: PaletteItem['kind'], title: string, meta = ''): PaletteItem => ({ id, kind, title, meta, href: `/${id}` });

  test('folding is case, accents and punctuation', () => {
    expect(fold('  Café — Débugged!  ')).toBe('cafe debugged');
  });

  test('every word must start a word; titles beat metas; places win ties', () => {
    const s = item('s1', 'session', 'Debugged a failing test suite', 'Private project 1 · Saturday');
    expect(score(s, 'fail test')).not.toBeNull();
    expect(score(s, 'failz')).toBeNull();
    expect(score(s, 'saturday')! < score(s, 'suite')!).toBe(true);
    const ranked = rank([s, ...PLACES], 'you');
    expect(ranked[0]!.id).toBe('you');
  });

  test('an empty query lists the places first, in order, and the limit holds', () => {
    const r = rank([...PLACES, item('s', 'session', 'x')], '', 5);
    expect(r.map((x) => x.id)).toEqual(PLACES.slice(0, 5).map((p) => p.id));
  });

  test('every place is a route that exists', () => {
    for (const p of PLACES) {
      const file = p.href === '/now' || p.href === '/sessions' || p.href === '/drops' || p.href === '/projects' || p.href === '/you' ? `app/(tabs)${p.href}.tsx` : `app${p.href}.tsx`;
      expect({ href: p.href, exists: (() => { try { readFileSync(join(MOBILE, file)); return true; } catch { return false; } })() }).toEqual({ href: p.href, exists: true });
    }
  });
});

describe('signing a desktop in with the phone', () => {
  test("the QR opens the phone's pairing screen with the code, and the phone reads it back", () => {
    const link = pairLink('AB12-CD34');
    expect(link).toBe('builder://pair?code=AB12-CD34');
    expect(parsePairingCode(link)).toBe('AB12-CD34');
  });

  test("the poll's answers, read", () => {
    expect(readPoll(200, { status: 'authorization_pending' })).toEqual({ kind: 'pending' });
    expect(readPoll(200, { status: 'ok', access_token: 'a', refresh_token: 'r' })).toEqual({ kind: 'ok', access: 'a', refresh: 'r' });
    // A 200 that says ok without the pair is not a sign in.
    expect(readPoll(200, { status: 'ok' }).kind).toBe('error');
    expect(readPoll(400, { detail: 'expired_token' })).toEqual({ kind: 'expired' });
    expect(readPoll(400, { detail: 'unknown device_code' })).toEqual({ kind: 'expired' });
    expect(readPoll(500, null)).toEqual({ kind: 'error', message: 'the server answered 500' });
  });

  test('each desktop says what it is on the phone', () => {
    expect(devicePlatform('darwin')).toBe('desktop-macos');
    expect(devicePlatform('win32')).toBe('desktop-windows');
    expect(devicePlatform('linux')).toBe('desktop-linux');
    expect(deviceLabel('darwin', 'studio')).toBe('Builda for Mac (studio)');
    expect(deviceLabel('win32', null)).toBe('Builda for Windows');
  });
});

describe('the island', () => {
  const needs = sampleActivity('needsYou')!;
  const crew = sampleActivity('crew')!;
  const drop = sampleActivity('drop')!;
  const shipped = sampleActivity('shipped')!;

  test('needs you beats a beat, a beat beats a reel, a reel beats the crew', () => {
    expect(PRIORITY.needsYou).toBeGreaterThan(PRIORITY.shipped);
    expect(PRIORITY.shipped).toBeGreaterThan(PRIORITY.drop);
    expect(PRIORITY.drop).toBeGreaterThan(PRIORITY.crew);
    expect(lead([crew, drop, needs, shipped])).toBe(needs);
    expect(lead([crew, drop])).toBe(drop);
    expect(lead([])).toBeNull();
  });

  test("over the Now tab's own sample rows: the run that needs you leads, and the crew is everyone still running", () => {
    const now = Date.parse('2026-09-19T15:00:00Z');
    const sample = missionSample('grid', now);
    const acts = activitiesOf({ live: sample.live, crew: crewFor(sample.live), drops: [], moves: [], names: null, finished: [], nowMs: now });
    const top = lead(acts);
    expect(top?.kind).toBe('needsYou');
    const crew = acts.find((a) => a.kind === 'crew') as Extract<Activity, { kind: 'crew' }> | undefined;
    expect(crew).toBeDefined();
    // Nothing finished or stale rides in the crew, and the one waiting wears the waiting face.
    const ids = new Set(sample.live.map((s) => s.id));
    for (const m of crew!.members) expect(ids.has(m.sessionId)).toBe(true);
    expect(crew!.members.some((m) => m.state === 'waiting')).toBe(true);
    // No live rows, no drops: the island has nothing to say, and is not there.
    expect(lead(activitiesOf({ live: [], crew: new Map(), drops: [], moves: [], names: null, finished: [], nowMs: now }))).toBeNull();
  });

  test('a reel still being read is the island; one planned an hour ago is not', () => {
    const now = Date.parse('2026-09-19T15:00:00Z');
    const drop = (status: 'resolving' | 'planned', resolvedMinAgo: number | null) => ({
      id: `d-${status}`,
      url: 'https://www.instagram.com/reel/abc',
      platform: 'instagram',
      status,
      kind: null,
      title: 'A reel',
      summary: null,
      thumbnail_url: null,
      refusal: null,
      resolution: null,
      created_at: new Date(now - 90 * 60_000).toISOString(),
      resolved_at: resolvedMinAgo === null ? null : new Date(now - resolvedMinAgo * 60_000).toISOString(),
      archived_at: null,
    });
    const reading = activitiesOf({ live: [], crew: new Map(), drops: [drop('resolving', null)] as never, moves: [], names: null, finished: [], nowMs: now });
    expect(lead(reading)).toMatchObject({ kind: 'drop', phase: 'reading', host: 'instagram.com' });
    const old = activitiesOf({ live: [], crew: new Map(), drops: [drop('planned', 60)] as never, moves: [], names: null, finished: [], nowMs: now });
    expect(lead(old)).toBeNull();
    const fresh = activitiesOf({ live: [], crew: new Map(), drops: [drop('planned', 1)] as never, moves: [], names: null, finished: [], nowMs: now });
    expect(lead(fresh)).toMatchObject({ kind: 'drop', phase: 'planned' });
  });

  test('on a notched Mac it grows out of the notch; elsewhere it is a pill with room for words', () => {
    const notch = { width: 200, height: 38 };
    expect(boxFor('hidden', notch, 150)).toEqual({ w: 200, h: 38, r: 19 });
    expect(boxFor('compact', notch, 150)).toEqual({ w: 200 + EAR * 2, h: 38, r: 19 });
    expect(boxFor('hidden', null, 150)).toEqual({ w: 0, h: 0, r: 0 });
    expect(boxFor('compact', null, 150)).toEqual({ w: PILL.w, h: PILL.h, r: PILL.h / 2 });
    expect(boxFor('expanded', null, 150).w).toBe(EXPANDED_W);
  });

  test('a click goes where the news is', () => {
    expect(hrefOf(needs)).toBe('/session/sample');
    expect(hrefOf(drop)).toBe('/drop/sample');
    expect(hrefOf(crew)).toBe('/now');
    expect(hrefOf({ ...(crew as Extract<Activity, { kind: 'crew' }>), members: (crew as Extract<Activity, { kind: 'crew' }>).members.slice(0, 1) })).toBe('/session/sample');
  });

  test('only needs you and shipped are notifications, and only once', () => {
    expect(notificationFor(null, needs)?.title).toBe('tramline (sample) needs you');
    expect(notificationFor(needs, needs)).toBeNull();
    expect(notificationFor(null, crew)).toBeNull();
    expect(notificationFor(crew, shipped)?.url).toBe('builder://session/sample');
  });

  test('the reel wheel and the crew face', () => {
    const d = drop as Extract<Activity, { kind: 'drop' }>;
    expect(dropSteps(d)).toEqual({ rows: ['Sent to your Mac', 'Reading instagram.com', 'What you could do with it'], index: 1 });
    expect(dropSteps({ ...d, phase: 'planned', moves: 3 }).rows[2]).toBe('3 moves ready');
    expect(dropSteps({ ...d, phase: 'planned', moves: 1 }).rows[2]).toBe('1 move ready');
    expect(dropPhase({ status: 'waiting' })).toBe('sent');
    expect(dropPhase({ status: 'resolving' })).toBe('reading');
    expect(dropPhase({ status: 'refused' })).toBe('refused');
    expect(hostOf('https://www.instagram.com/reel/x')).toBe('instagram.com');
    const members = (crew as Extract<Activity, { kind: 'crew' }>).members;
    expect(crewLeadOf(members)?.sessionId).toBe('sample');
    expect(crewLeadOf([{ ...members[0]!, state: 'working' }, { ...members[1]!, state: 'waiting' }])?.state).toBe('waiting');
  });

  test('words a person says', () => {
    expect(minutesLabel(20_000)).toBe('now');
    expect(minutesLabel(4 * 60_000)).toBe('4m');
    expect(minutesLabel(72 * 60_000)).toBe('1h 12m');
    expect(minutesLabel(120 * 60_000)).toBe('2h');
    expect(spoken(null)).toBe('');
    expect(spoken(crew)).toBe('3 sessions running');
  });

  test("the springs are the motion spec's, until the two branches share one file", () => {
    expect(islandMotion.ISLAND).toEqual({ damping: 17, stiffness: 210, mass: 1 });
    expect(islandMotion.CONTENT).toEqual({ damping: 22, stiffness: 320, mass: 0.9 });
    expect(islandMotion.POP).toEqual({ damping: 14, stiffness: 260, mass: 0.7 });
    expect(islandMotion.WHEEL).toEqual({ damping: 20, stiffness: 190, mass: 1 });
    expect(islandMotion.CONTENT_OUT[1]).toBeLessThan(islandMotion.CONTENT_IN[0]);
    expect(islandMotion.phase(0.5, [0.34, 0.84])).toBeCloseTo(0.32, 5);
    expect(islandMotion.phase(-1, [0.34, 0.84])).toBe(0);
    expect(islandMotion.phase(2, [0.34, 0.84])).toBe(1);
  });

  test('every state wears a token', () => {
    expect(STATE_INK.waiting).toBe(tokens.spectrum.hues.amber.dark);
    expect(STATE_INK.done).toBe(tokens.data.add.dark);
    expect(STATE_INK.error).toBe(tokens.data.del.dark);
    expect(STATE_INK.working).toBe(tokens.spectrum.hues.cobalt.dark);
  });
});
