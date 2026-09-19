/**
 * A project's demo on the phone (docs/demos.md, "On the phone" and "The API"), without a renderer:
 *
 *   1. the client     the three routes and their shapes, against a fixture server that answers
 *                     only to the bearer, as the local stack does; a relative url is resolved
 *                     against the API and carries the bearer, a presigned one never does
 *   2. the gallery    the order a demo is seen in, each file's label, where it came from, the count,
 *                     and what a file this build does not know becomes
 *   3. no demo yet    the empty print's words: the two Mac commands, plain, no dash
 *   4. the guard      a build without expo-video shows the poster and never throws
 *   5. the layout     where the video stands under the hero, and the door's hand of prints
 *   6. the wiring     nothing names expo-video but the one door to it, and every drawing lands
 *   7. the review     (2026-09-14) a demo held under its own key; pictures not recorded marked on the
 *                     door and named to VoiceOver; counts only from the whole list; one image per
 *                     print, decoded at its size; deleting a demo from the page
 */
import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { hasDash } from '../src/copy/plain';
import {
  countLabel,
  DELETE_DEMO,
  deleteAsk,
  deletedSentence,
  demoFor,
  demoReducer,
  demoWords,
  doorPrints,
  doorPrintsLabel,
  durationWords,
  EMPTY_DEMO,
  gallery,
  holdsWords,
  PHONE_ASPECT,
  PHONE_TOP_SHARE,
  SIDE_ASPECT,
  sourceLine,
  SOURCE_LINES,
  sourceMark,
  SOURCE_MARKS,
  STRIP_MAX_H,
  stripLayout,
  UNKNOWN,
  WIDE_MAX_H,
  type DemoLoad,
  type DemoState,
} from '../src/demos/model';
import { guardedLoad, onceGuarded } from '../src/demos/videoGuard';

// Neither native module exists in bun: the storage is injected and expo-constants is read only
// for the app version, so both are stubbed at the module boundary (as `api.test.ts` does).
mock.module('expo-secure-store', () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => {},
  deleteItemAsync: async () => {},
}));
mock.module('expo-constants', () => ({ default: { expoConfig: { version: '0.1.0-test' } } }));

const { Api, ApiError, resolveMediaUrl } = await import('../src/data/api');
type TokenStorage = import('../src/data/api').TokenStorage;
type ProjectMediaItem = import('../src/data/api').ProjectMediaItem;

const MOBILE = join(import.meta.dir, '..');
const KEY = '03624fb1c6e2cd77e365bf6cc4e567e75a81ac2772016ca1bec523a847e4a504';
const OTHER = 'b093f92080ab6e13cc2d5fd8187c4da6f1c946f7c9f38d5182dd5ce6c6c46275';

function storage(access: string): TokenStorage {
  const m = new Map([
    ['builder.access', access],
    ['builder.refresh', 'R1'],
  ]);
  return {
    get: async (k) => m.get(k) ?? null,
    set: async (k, v) => void m.set(k, v),
    remove: async (k) => void m.delete(k),
  };
}

const item = (over: Partial<ProjectMediaItem> & Pick<ProjectMediaItem, 'id'>): ProjectMediaItem => ({
  kind: 'image',
  content_type: 'image/png',
  width: 1206,
  height: 2622,
  duration_ms: null,
  position: 1,
  label: 'the Now tab, with the sample sessions running',
  source: 'capture',
  url: `/v1/media/${over.id}`,
  poster_url: null,
  ...over,
});

/** One publish as the server lists it: the video first, then six stills by position. */
const PUBLISHED: ProjectMediaItem[] = [
  item({ id: 'v0', kind: 'video', content_type: 'video/mp4', position: 0, duration_ms: 28_000, label: 'Builda running: Now, a session and its call chart', poster_url: '/v1/media/v0/poster' }),
  ...['the Now tab', 'the session page, the call chart', 'the Projects tab', 'a project page', 'Wrapped, the sample deck', 'Wrapped, every card'].map((label, i) => item({ id: `s${i + 1}`, position: i + 1, label })),
];

// ------------------------------------------------------------------ 1. the client

describe('the client, against a fixture server that answers only to the bearer', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const seen: { method: string; path: string; auth: string | null }[] = [];
  let server: ReturnType<typeof Bun.serve>;
  let base = '';

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        const auth = req.headers.get('authorization');
        seen.push({ method: req.method, path: url.pathname + url.search, auth });
        if (auth !== 'Bearer A1') return new Response(JSON.stringify({ detail: 'not signed in' }), { status: 401 });
        if (req.method === 'GET' && url.pathname === `/v1/projects/${KEY}/media`) return Response.json({ items: PUBLISHED });
        if (req.method === 'GET' && url.pathname === `/v1/projects/${OTHER}/media`) return Response.json({ items: [] });
        if (req.method === 'GET' && url.pathname === '/v1/projects/media:preview') {
          const keys = (url.searchParams.get('keys') ?? '').split(',');
          return Response.json({ projects: Object.fromEntries(keys.map((k) => [k, k === KEY ? PUBLISHED.filter((p) => p.kind === 'image').slice(0, 3) : []])) });
        }
        if (req.method === 'DELETE' && url.pathname === `/v1/projects/${KEY}/media`) return Response.json({ deleted: 7 });
        if (req.method === 'GET' && url.pathname === '/v1/media/s1') return new Response(PNG, { headers: { 'Content-Type': 'image/png' } });
        return new Response(JSON.stringify({ detail: 'not found' }), { status: 404 });
      },
    });
    base = `http://127.0.0.1:${server.port}`;
  });
  afterAll(() => server.stop(true));

  test('the list: every field the phone reads, the video first, with the bearer', async () => {
    const api = new Api(base, storage('A1'));
    const got = await api.projectMedia(KEY);
    expect(got.items.map((i) => i.id)).toEqual(['v0', 's1', 's2', 's3', 's4', 's5', 's6']);
    const v = got.items[0]!;
    expect(Object.keys(v).sort()).toEqual(['content_type', 'duration_ms', 'height', 'id', 'kind', 'label', 'position', 'poster_url', 'source', 'url', 'width']);
    expect(seen.at(-1)).toEqual({ method: 'GET', path: `/v1/projects/${KEY}/media`, auth: 'Bearer A1' });
    expect((await api.projectMedia(OTHER)).items).toEqual([]);
  });

  test('the preview asks for every door at once, and a project with no demo is an empty list', async () => {
    const api = new Api(base, storage('A1'));
    const got = await api.projectMediaPreview([KEY, OTHER]);
    expect(seen.at(-1)!.path).toBe(`/v1/projects/media:preview?keys=${KEY},${OTHER}`);
    expect(got.projects[KEY]!.map((i) => i.id)).toEqual(['s1', 's2', 's3']);
    expect(got.projects[OTHER]).toEqual([]);
  });

  test('delete is one request, and answers how many went', async () => {
    const api = new Api(base, storage('A1'));
    expect(await api.deleteProjectMedia(KEY)).toEqual({ deleted: 7 });
    expect(seen.at(-1)).toEqual({ method: 'DELETE', path: `/v1/projects/${KEY}/media`, auth: 'Bearer A1' });
  });

  test('a relative url is fetched from the API with the bearer, and without it the local stack refuses', async () => {
    const api = new Api(`${base}/`, storage('A1'));
    const src = await api.mediaSource('/v1/media/s1');
    expect(src).toEqual({ uri: `${base}/v1/media/s1`, headers: { Authorization: 'Bearer A1' } });
    const ok = await fetch(src.uri, { headers: src.headers });
    expect(ok.status).toBe(200);
    expect(new Uint8Array(await ok.arrayBuffer()).slice(0, 4)).toEqual(PNG.slice(0, 4));
    expect((await fetch(src.uri)).status).toBe(401);
  });

  test('a refused read is an ApiError the page can keep what it showed through', async () => {
    const api = new Api(base, storage('wrong'));
    const e = await api.projectMedia(KEY).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
  });
});

describe('resolving a media url', () => {
  const B = 'http://127.0.0.1:8787';
  test('relative: the API host and the bearer', () => {
    expect(resolveMediaUrl('/v1/media/abc', B, 'T')).toEqual({ uri: `${B}/v1/media/abc`, headers: { Authorization: 'Bearer T' } });
    expect(resolveMediaUrl('/v1/media/abc/poster', `${B}/`, 'T').uri).toBe(`${B}/v1/media/abc/poster`);
    expect(resolveMediaUrl('v1/media/abc', B, 'T').uri).toBe(`${B}/v1/media/abc`);
  });
  test('absolute on the API itself: the bearer too', () => {
    expect(resolveMediaUrl(`${B}/v1/media/abc`, B, 'T')).toEqual({ uri: `${B}/v1/media/abc`, headers: { Authorization: 'Bearer T' } });
    expect(resolveMediaUrl('https://API.example.com/v1/media/a', 'https://api.example.com', 'T').headers).toEqual({ Authorization: 'Bearer T' });
  });
  test('a presigned url on another host never carries the phone\'s token', () => {
    const s3 = 'https://bucket.s3.amazonaws.com/project-media/u/k/m.png?X-Amz-Signature=abc';
    expect(resolveMediaUrl(s3, 'https://api.example.com', 'T')).toEqual({ uri: s3 });
    // A lookalike that only starts with the API's host is another host.
    expect(resolveMediaUrl('https://api.example.com.evil.test/x', 'https://api.example.com', 'T')).toEqual({ uri: 'https://api.example.com.evil.test/x' });
  });
  test('signed out: no header at all, never "Bearer null"', () => {
    expect(resolveMediaUrl('/v1/media/abc', B, null)).toEqual({ uri: `${B}/v1/media/abc` });
    expect(resolveMediaUrl('/v1/media/abc', B, undefined)).toEqual({ uri: `${B}/v1/media/abc` });
  });
});

// ------------------------------------------------------------------ 2. the gallery

describe('the gallery', () => {
  test('the video first, then the stills by position, whatever order they arrive in', () => {
    const shuffled = [PUBLISHED[3]!, PUBLISHED[6]!, PUBLISHED[0]!, PUBLISHED[1]!, PUBLISHED[5]!, PUBLISHED[2]!, PUBLISHED[4]!];
    expect(gallery(shuffled).map((e) => e.id)).toEqual(['v0', 's1', 's2', 's3', 's4', 's5', 's6']);
    // A tie on position reads the same way every time: by id.
    const tie = gallery([item({ id: 'b', position: 2 }), item({ id: 'a', position: 2 })]);
    expect(tie.map((e) => e.id)).toEqual(['a', 'b']);
  });

  test('the count counts what is shown: "3 of 7"', () => {
    const g = gallery(PUBLISHED);
    expect(g.map((e) => e.count)).toEqual(['1 of 7', '2 of 7', '3 of 7', '4 of 7', '5 of 7', '6 of 7', '7 of 7']);
    expect(countLabel(2, 6)).toBe('3 of 6');
  });

  test('each file keeps its label, the video its length, and a picture its own shape', () => {
    const g = gallery(PUBLISHED);
    expect(g[0]!.label).toBe('Builda running: Now, a session and its call chart');
    expect(g[0]!.duration).toBe('28 seconds');
    expect(g[0]!.posterUrl).toBe('/v1/media/v0/poster');
    expect(g[1]!.duration).toBeNull();
    expect(g[1]!.aspect).toBeCloseTo(1206 / 2622, 6);
    expect(gallery([item({ id: 'x', width: 0, height: 0 })])[0]!.aspect).toBe(PHONE_ASPECT);
    expect(gallery([item({ id: 'x', label: '  ' })])[0]!.label).toBe('a still');
    expect(durationWords(12_400)).toBe('12 seconds');
    expect(durationWords(65_000)).toBe('1 minute 5 seconds');
    expect(durationWords(null)).toBeNull();
    expect(durationWords(0)).toBeNull();
  });

  test('where it came from, said only when it was not recorded from the running app', () => {
    expect(sourceLine('capture')).toBeNull();
    expect(sourceLine('previous')).toBe('The last good capture, from an earlier run.');
    expect(sourceLine('checkout')).toBe('From your repository, not recorded.');
    expect(sourceLine('transcript')).toBe('A screenshot one of your sessions opened.');
    // A source this build does not know says nothing, never a debug string.
    expect(sourceLine('generated')).toBeNull();
    expect(sourceLine('toString')).toBeNull();
    expect(sourceLine(null)).toBeNull();
    const g = gallery([item({ id: 'a', source: 'checkout' }), item({ id: 'b', position: 2 })]);
    expect(g.map((e) => e.source)).toEqual(['From your repository, not recorded.', null]);
    expect(g[0]!.a11y).toContain('From your repository');
    // The contract's four sources, every one with a decision.
    expect(Object.keys(SOURCE_LINES).sort()).toEqual(['capture', 'checkout', 'previous', 'transcript']);
  });

  test('a kind this build does not know, or a file with no url, is left out and not counted', () => {
    const odd = [...PUBLISHED, item({ id: 'z', kind: 'audio' as never }), item({ id: 'y', url: '' })];
    const g = gallery(odd);
    expect(g.map((e) => e.id)).not.toContain('z');
    expect(g.map((e) => e.id)).not.toContain('y');
    expect(g.at(-1)!.count).toBe('7 of 7');
  });

  test('a door fans at most three stills and never the video', () => {
    expect(doorPrints(PUBLISHED).map((e) => e.id)).toEqual(['s1', 's2', 's3']);
    expect(doorPrints([PUBLISHED[0]!])).toEqual([]);
    expect(doorPrints(null)).toEqual([]);
  });

  test('the words beside a demo say what it is and what a tap does', () => {
    const w = demoWords(gallery(PUBLISHED))!;
    expect(w.stills).toBe(6);
    expect(w.stillsCaption).toBe('stills from the running app');
    expect(w.videoCaption).toBe('28 seconds, recorded from the running app.');
    expect(w.tap).toBe('Tap the video to watch it with sound, or the stack to see them all.');
    const fallback = demoWords(gallery([item({ id: 'a', source: 'previous' }), item({ id: 'b', position: 2, source: 'previous' })]))!;
    expect(fallback.stillsCaption).toBe('stills from the last good capture');
    expect(demoWords([])).toBeNull();
    const one = demoWords(gallery([item({ id: 'a' })]))!;
    expect(one.stillsCaption).toBe('still from the running app');
    expect(one.tap).toBe('Tap it to see it whole.');
  });
});

// ------------------------------------------------------------------ 3. no demo yet

describe('no demo yet', () => {
  test('the empty print says where to ask first, and keeps the Mac\'s own two commands for the terminal', () => {
    expect(EMPTY_DEMO.make).toBe('python -m capture demo');
    expect(EMPTY_DEMO.publish).toBe('python -m capture demo --publish');
    expect(EMPTY_DEMO.ask).toBe('Ask your Mac for a demo');
    expect(EMPTY_DEMO.a11y).toContain(EMPTY_DEMO.make);
    expect(EMPTY_DEMO.a11y).toContain(EMPTY_DEMO.publish);
  });

  test('the door print says only its title; where to ask is spoken, and nothing is to type', () => {
    expect(EMPTY_DEMO.doorTitle).toBe('No demo yet');
    expect(EMPTY_DEMO.doorTitle).not.toMatch(/python|capture demo|--publish/);
    expect(EMPTY_DEMO.a11y).toContain('project page');
  });

  test('plain words: no dash, no spinner word, no stock picture', () => {
    const words = Object.values(EMPTY_DEMO).flat();
    for (const s of words) {
      expect({ s, dash: hasDash(s) }).toEqual({ s, dash: false });
      expect(s).not.toMatch(/loading|please wait|coming soon|placeholder/i);
    }
  });
});

// ------------------------------------------------------------------ 4. the guard

describe('a build without expo-video', () => {
  test('the package is never evaluated when the native module is missing', () => {
    let loaded = 0;
    expect(guardedLoad(() => null, () => ++loaded)).toBeNull();
    expect(guardedLoad(() => undefined, () => ++loaded)).toBeNull();
    expect(loaded).toBe(0);
  });

  test('with the module, the package; a throw anywhere is "no video", never a crash', () => {
    const mod = { VideoView: 'view', useVideoPlayer: () => null };
    expect(guardedLoad(() => ({}), () => mod)).toBe(mod);
    expect(guardedLoad(() => ({}), () => {
      throw new Error("Cannot find native module 'ExpoVideo'");
    })).toBeNull();
    expect(guardedLoad(() => {
      throw new Error('expo-modules-core is not there either');
    }, () => mod)).toBeNull();
  });

  test('asked once: the answer is kept, a binary does not grow a module', () => {
    let probes = 0;
    let loads = 0;
    const get = onceGuarded(() => ++probes, () => ({ n: ++loads }));
    expect(get()).toEqual({ n: 1 });
    expect(get()).toEqual({ n: 1 });
    expect([probes, loads]).toEqual([1, 1]);
    const missing = onceGuarded(() => null, () => 'never');
    expect(missing()).toBeNull();
    expect(missing()).toBeNull();
  });
});

// ------------------------------------------------------------------ 5. the layout

describe('where the video stands', () => {
  test('a phone recording stands at its own shape on the left half, never taller than the cap', () => {
    const l = stripLayout(402, 1206 / 2622);
    expect(l.mode).toBe('side');
    expect(l.videoW).toBe(201);
    expect(l.videoH).toBe(Math.round(201 / (1206 / 2622)));
    expect(l.videoH).toBeLessThanOrEqual(STRIP_MAX_H);
    expect(l.sideW).toBe(402 - 201 - 16 - 20);
    // The recording's own status bar and island tuck up under the band's solid ink.
    expect(l.tuck).toBe(Math.round(201 * PHONE_TOP_SHARE));
    expect(l.tuck).toBeGreaterThan(0);
    expect(l.tuck).toBeLessThan(l.videoH / 8);
    // A tall narrow screen is capped by height, and keeps its shape.
    const tall = stripLayout(430, 0.3);
    expect(tall.videoH).toBe(STRIP_MAX_H);
    expect(tall.videoW).toBe(Math.round(STRIP_MAX_H * 0.3));
  });

  test('a wide recording runs the full width, never taller than its cap', () => {
    const w = stripLayout(402, 16 / 9);
    expect(w.mode).toBe('wide');
    expect(w.videoW).toBe(402);
    expect(w.videoH).toBe(Math.round(402 / (16 / 9)));
    expect(w.tuck).toBe(0);
    expect(stripLayout(402, SIDE_ASPECT).mode).toBe('wide');
    expect(stripLayout(402, 1.2).videoH).toBeLessThanOrEqual(WIDE_MAX_H);
    // No shape at all is a phone's.
    expect(stripLayout(402, 0).mode).toBe('side');
  });
});

// ------------------------------------------------------------------ 6. the wiring

function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'generated' && name !== 'node_modules') walk(p, out);
    } else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('the wiring', () => {
  test('nothing imports expo-video at the top of a file: the one door requires it behind the guard', () => {
    const offenders: string[] = [];
    for (const f of [...walk(join(MOBILE, 'src')), ...walk(join(MOBILE, 'app'))]) {
      const src = code(readFileSync(f, 'utf8'));
      if (/from\s+['"]expo-video['"]/.test(src)) offenders.push(`${relative(MOBILE, f)}: a static import`);
      if (/require\(\s*['"]expo-video['"]\s*\)/.test(src) && !f.endsWith(join('src', 'demos', 'video.ts'))) offenders.push(`${relative(MOBILE, f)}: a require outside the door`);
    }
    expect(offenders).toEqual([]);
    const door = code(readFileSync(join(MOBILE, 'src/demos/video.ts'), 'utf8'));
    expect(door).toContain("requireOptionalNativeModule('ExpoVideo')");
    expect(door).toContain('onceGuarded');
  });

  test('expo-video is the SDK 53 line in package.json, and expo-av is not how a demo plays', () => {
    const pkg = JSON.parse(readFileSync(join(MOBILE, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['expo-video']).toMatch(/^~2\.2\./);
    for (const f of walk(join(MOBILE, 'src/demos'))) expect(code(readFileSync(f, 'utf8'))).not.toMatch(/expo-av/);
  });

  test('the video pauses off screen, in the background, on another screen, under Reduce Motion and under the gallery', () => {
    const src = code(readFileSync(join(MOBILE, 'src/demos/LoopVideo.tsx'), 'utf8'));
    expect(src).toContain('useAppActive()');
    expect(src).toContain('useScreenFocused()');
    expect(src).toContain('useReduceMotion()');
    expect(src).toMatch(/play=\{watching && onScreen && !held\}/);
    expect(src).toMatch(/p\.muted = true/);
    expect(src).toMatch(/p\.loop = true/);
    // The still frame until the video has drawn its own.
    expect(src).toContain('onFirstFrameRender');
  });

  test('the demo\'s words say no dash', () => {
    for (const f of walk(join(MOBILE, 'src/demos'))) {
      const src = code(readFileSync(f, 'utf8'));
      const literals = [...src.matchAll(/'([^'\n]*)'|`([^`]*)`|>([^<>{}=();\n]+)</g)].map((m) => m[1] ?? m[2]?.replace(/\$\{[^}]*\}/g, ' ') ?? m[3] ?? '');
      for (const s of literals) expect({ file: relative(MOBILE, f), s, dash: hasDash(s) }).toEqual({ file: relative(MOBILE, f), s, dash: false });
    }
  });
});

// ------------------------------------------------------------------ 7. the review's five

const ready = (ids: string[]): DemoLoad => ({ kind: 'ready', entries: gallery(ids.map((id, i) => item({ id, position: i + 1 }))), sources: { file: {}, poster: {} } });
const idsOf = (d: DemoLoad) => (d.kind === 'ready' ? d.entries.map((e) => e.id) : d.kind);

describe('1. a demo is held under its own key', () => {
  const A = 'a'.repeat(64);
  const B = 'b'.repeat(64);

  test('a new key starts from nothing: B never shows A\'s pictures, not even for a frame', () => {
    let s: DemoState = { key: A, seq: 0, demo: UNKNOWN };
    s = demoReducer(s, { type: 'answer', key: A, seq: 1, demo: ready(['a1', 'a2']) });
    expect(idsOf(demoFor(s, A))).toEqual(['a1', 'a2']);
    // The screen asks for B before the reducer has heard: what it shows is nothing, not A.
    expect(demoFor(s, B)).toEqual(UNKNOWN);
    s = demoReducer(s, { type: 'key', key: B });
    expect(s.key).toBe(B);
    expect(demoFor(s, B)).toEqual(UNKNOWN);
  });

  test('a failed read for B leaves nothing, never what A had', () => {
    let s: DemoState = { key: A, seq: 0, demo: UNKNOWN };
    s = demoReducer(s, { type: 'answer', key: A, seq: 1, demo: ready(['a1']) });
    s = demoReducer(s, { type: 'key', key: B });
    // A failure dispatches nothing: B stays unknown.
    expect(demoFor(s, B)).toEqual(UNKNOWN);
  });

  test('a late answer for A lands after B was asked for: dropped', () => {
    let s: DemoState = { key: A, seq: 0, demo: UNKNOWN };
    s = demoReducer(s, { type: 'key', key: B });
    s = demoReducer(s, { type: 'answer', key: B, seq: 5, demo: ready(['b1']) });
    s = demoReducer(s, { type: 'answer', key: A, seq: 4, demo: ready(['a1']) });
    expect(idsOf(demoFor(s, B))).toEqual(['b1']);
  });

  test('an older answer for the same key never replaces a newer one', () => {
    let s: DemoState = { key: A, seq: 0, demo: UNKNOWN };
    s = demoReducer(s, { type: 'answer', key: A, seq: 7, demo: ready(['new']) });
    s = demoReducer(s, { type: 'answer', key: A, seq: 6, demo: ready(['old']) });
    expect(idsOf(demoFor(s, A))).toEqual(['new']);
  });

  test('deleted is none, and a read that was in flight before the delete cannot bring it back', () => {
    let s: DemoState = { key: A, seq: 0, demo: UNKNOWN };
    s = demoReducer(s, { type: 'answer', key: A, seq: 1, demo: ready(['a1']) });
    s = demoReducer(s, { type: 'deleted', key: A, seq: 3 });
    expect(demoFor(s, A)).toEqual({ kind: 'none' });
    s = demoReducer(s, { type: 'answer', key: A, seq: 2, demo: ready(['a1']) });
    expect(demoFor(s, A)).toEqual({ kind: 'none' });
    // A delete for another key changes nothing here.
    expect(demoReducer(s, { type: 'deleted', key: B, seq: 9 })).toBe(s);
  });

  test('the hooks hold every answer under its key and its order', () => {
    const src = code(readFileSync(join(MOBILE, 'src/demos/useDemo.ts'), 'utf8'));
    expect(src).toContain('useReducer(demoReducer');
    expect(src).toMatch(/dispatch\(\{ type: 'key', key \}\)/);
    expect(src).toMatch(/dispatch\(\{ type: 'answer', key: k, seq, demo: got \}\)/);
    expect(src).toContain('demo: demoFor(state, key)');
    // The tab's lists and previews apply an answer for a key only when it is newer than the one shown.
    expect((src.match(/\?\? 0\) < seq/g) ?? []).length).toBe(2);
  });
});

describe('2. a picture that was not recorded says so, on the door and to VoiceOver', () => {
  test('the marks: nothing on a recording, a few plain words on each fallback', () => {
    expect(sourceMark('capture')).toBeNull();
    expect(sourceMark('previous')).toBe('an earlier run');
    expect(sourceMark('checkout')).toBe('from the repo');
    expect(sourceMark('transcript')).toBe('a screenshot');
    expect(sourceMark('something new')).toBeNull();
    expect(Object.keys(SOURCE_MARKS).sort()).toEqual(Object.keys(SOURCE_LINES).sort());
    // Short enough for a door's print, 74 points across at 10 points.
    for (const m of Object.values(SOURCE_MARKS)) if (m) expect(m.length).toBeLessThanOrEqual(14);
    const g = gallery([item({ id: 'r', source: 'checkout' }), item({ id: 'c', position: 2 })]);
    expect(g.map((e) => e.mark)).toEqual(['from the repo', null]);
  });

  test('the door\'s label names where the top print came from', () => {
    const prints = doorPrints([item({ id: 'x', label: 'the login screen', source: 'checkout' })]);
    const label = doorPrintsLabel('Private project 3', prints[0]!, null);
    expect(label).toBe('Private project 3, its demo. On top, the login screen: from your repository, not recorded. Opens the demo.');
    const rec = doorPrintsLabel('Private project 2', doorPrints(PUBLISHED)[2]!, null);
    expect(rec).not.toMatch(/repository|screenshot|earlier run/);
  });

  test('the door draws the mark on every print that has one, and the pile does too', () => {
    const door = code(readFileSync(join(MOBILE, 'src/demos/DoorPrints.tsx'), 'utf8'));
    expect(door).toMatch(/mark=\{prints\[i\]!\.mark\}/);
    expect(door).toMatch(/accessibilityLabel=\{doorPrintsLabel\(/);
    const page = code(readFileSync(join(MOBILE, 'src/demos/PageDemo.tsx'), 'utf8'));
    expect(page).toMatch(/mark=\{s\.mark\}/);
    // The mark sits on the ground's own dark, not a tinted chip.
    const print = code(readFileSync(join(MOBILE, 'src/demos/Print.tsx'), 'utf8'));
    expect(print).toMatch(/mark: \{[^}]*backgroundColor: GROUND\.bg/);
  });
});

describe('3. a count is said only from the whole list', () => {
  test('what a demo holds, counted from the whole of it', () => {
    const whole = gallery(PUBLISHED);
    expect(holdsWords(whole)).toBe('a 28 second video and 6 stills');
    expect(holdsWords(gallery([item({ id: 'one' })]))).toBe('1 still');
    expect(holdsWords([])).toBeNull();
  });

  test('the door says how much only once the list is in: never the preview\'s three as the demo', () => {
    const preview = doorPrints(PUBLISHED);
    expect(preview.length).toBe(3);
    const before = doorPrintsLabel('Private project 2', preview[2]!, null);
    expect(before).not.toMatch(/\d+ of \d+|3 stills|\bstills?\b.*\d/);
    const after = doorPrintsLabel('Private project 2', preview[2]!, gallery(PUBLISHED));
    expect(after).toBe('Private project 2, its demo: a 28 second video and 6 stills. On top, the Projects tab. Opens the demo.');
  });

  test('the tab reads the whole list of every project with prints, and the gallery counts only that', () => {
    const tab = code(readFileSync(join(MOBILE, 'src/projects/ProjectsScreen.tsx'), 'utf8'));
    expect(tab).toContain('useDemoLists(listKeys)');
    expect(tab).toMatch(/counted=\{whole !== null\}/);
    expect(tab).not.toContain('useProjectDemo(');
    const g = code(readFileSync(join(MOBILE, 'src/demos/Gallery.tsx'), 'utf8'));
    expect(g).toMatch(/\{counted \? \(current\?\.count \?\? ''\) : ''\}/);
    expect(g).toMatch(/indicators=\{counted\}/);
  });
});

describe('4. a print is one image, decoded at its own size', () => {
  test('one Image in the print, on both sides of the transition, early resized', () => {
    const src = code(readFileSync(join(MOBILE, 'src/demos/Print.tsx'), 'utf8'));
    expect((src.match(/<Image\b/g) ?? []).length).toBe(1);
    // Decoded at the print's own size where a print is small (a door, the pile), after the view has
    // its frame, so a recycled view's old bounds never size the decode.
    expect(src).toContain("enforceEarlyResizing={fit === 'cover'}");
    expect(src).toMatch(/source=\{src && sized \?/);
    expect(src).toContain('onLayout={onLayout}');
    expect(src).toContain('allowDownscaling');
    expect(src).toMatch(/style=\{\{ width, height \}\}/);
    // Both sides are one view with the same key and the same picture first in it: React keeps the
    // image mounted across the swap, and no hidden copy loads under the cover.
    expect(src).toMatch(/<View key="print"/);
    expect(src).toMatch(/first=\{side\(true\)\} second=\{side\(false\)\}/);
    expect(src).not.toMatch(/opacity: 0/);
    // One cache entry a file, shared by the door, the pile and the gallery.
    expect(src).toContain('cacheKey: `demo-${id}`');
  });
});

describe('5. deleting a demo from the page', () => {
  const whole = gallery(PUBLISHED);

  test('it asks first, saying exactly what leaves, and that the Mac keeps its copy', () => {
    expect(deleteAsk(whole)).toBe(`A 28 second video and 6 stills leave your account and this phone. ${DELETE_DEMO.mac}`);
    expect(deleteAsk([])).toMatch(/^Every file of it leaves/);
  });

  test('then says what the server removed, in the server\'s own count', () => {
    expect(deletedSentence(7, whole)).toBe(`Deleted a 28 second video and 6 stills from your account. ${DELETE_DEMO.mac}`);
    // A publish half way in was removed with it: the count is files, not dressed as the demo.
    expect(deletedSentence(9, whole)).toBe(`Deleted 9 files from your account. ${DELETE_DEMO.mac}`);
    expect(deletedSentence(0, whole)).toMatch(/nothing to delete/);
    for (const s of [deleteAsk(whole), deletedSentence(7, whole), deletedSentence(1, gallery([item({ id: 'o' })])), ...Object.values(DELETE_DEMO)]) {
      expect({ s, dash: hasDash(s) }).toEqual({ s, dash: false });
    }
  });

  test('the request is sent only from the question\'s destructive answer, and the page forgets the demo only after the server answers', () => {
    const page = code(readFileSync(join(MOBILE, 'src/demos/PageDemo.tsx'), 'utf8'));
    expect((page.match(/api\.deleteProjectMedia\(/g) ?? []).length).toBe(1);
    expect(page).toMatch(/Alert\.alert\(DELETE_DEMO\.title, deleteAsk\(entries\)/);
    expect(page).toMatch(/style: 'destructive', onPress: \(\) => void remove\(\)/);
    const i = page.indexOf('await api.deleteProjectMedia(');
    expect(page.indexOf('onDeleted()', i)).toBeGreaterThan(i);
    const route = code(readFileSync(join(MOBILE, 'src/projects/ProjectPage.tsx'), 'utf8'));
    expect(route).toMatch(/onDeleted=\{onDemoDeleted\}/);
  });
});
