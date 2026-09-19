/**
 * The ship kit screen (docs/ship-kit.md), without a renderer:
 *
 *   1. the device table  every frame size comes from spec/devices.v1.json, the phone's default
 *                        shape is the table's default row, and nothing in src/ types a phone size
 *   2. the kit           a tab per format in the table's order, files sorted, refusals as the
 *                        spec's sentences and never a code
 *   3. the selection     a platform picks its format until the person picks one by hand; stills
 *                        toggle; an edit wins and can be taken back
 *   4. one share         the video and every picked still in screen order, the caption, a label
 *                        that counts what goes, nothing when nothing is picked
 *   5. asking the Mac    the button and line for each state of the server's row, a failure in the
 *                        spec's words, no dash anywhere
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { hasDash } from '../src/copy/plain';
import { PHONE_ASPECT, PHONE_TOP_SHARE } from '../src/demos/model';
import { DEFAULT_PHONE, DEVICES, FORMATS } from '../src/generated/devices';
import { PLATFORM_FORMAT, SHIPKIT_REFUSALS } from '../src/generated/shipkit';
import {
  captionCount,
  captionFor,
  fallbackLine,
  fileName,
  initialSelection,
  kitView,
  PLATFORM_NAMES,
  PLATFORMS,
  kitFromRequest,
  requestView,
  selectionReducer,
  shareHeldBack,
  sharePayload,
  threadFor,
} from '../src/shipkit/model';
import type { DemoRequestRow, KitFileRow, ShipKitResponse } from '../src/shipkit/types';

function file(id: string, slot: KitFileRow['slot'], position = 0, ct: KitFileRow['content_type'] = slot.startsWith('video') ? 'video/mp4' : 'image/png'): KitFileRow {
  return { id, slot, content_type: ct, width: 1080, height: 1920, duration_ms: ct === 'video/mp4' ? 14600 : null, bytes: 1000, position, label: 'the live map', url: `/v1/kit-media/${id}` };
}

const KIT: ShipKitResponse = {
  published_at: '2026-09-19T06:00:00Z',
  files: [
    file('s2', 'still', 2),
    file('v9', 'video_vertical'),
    file('vl', 'video_landscape'),
    file('s1', 'still', 1),
    file('f1', 'framed_still', 1),
    file('g', 'loop', 0, 'image/gif'),
    file('nourl', 'still', 3),
  ].map((f) => (f.id === 'nourl' ? { ...f, url: '' } : f)),
  document: {
    shipkit_version: 1,
    publish_id: 'a'.repeat(16),
    device: 'iphone-17-pro',
    hue: 'tide',
    captions: [
      { platform: 'linkedin', text: 'A bus route finder for campus.', thread: [], source: 'model' },
      { platform: 'x', text: 'A bus route finder.', thread: ['One.', 'Two.'], source: 'model' },
    ],
    changelog: ['map: the buses move on a recorded day'],
    refused: [
      { what: 'ipad_13', code: 'no_ipad_capture' },
      { what: 'feed', code: 'made_up_code' as never },
    ],
  },
};

describe('the device table', () => {
  test('the phone the demos are filmed on is the table default, and its shape is the table row', () => {
    const row = DEVICES.find((d) => d.id === DEFAULT_PHONE)!;
    expect(PHONE_ASPECT).toBe(row.pixels[0] / row.pixels[1]);
    expect(PHONE_TOP_SHARE).toBe(row.safe_area.top / row.points[0]);
    expect(Math.round(PHONE_TOP_SHARE * 402)).toBe(62);
  });

  test('every row is points times the panel scale, the mini included', () => {
    for (const d of DEVICES) {
      expect(Math.abs(d.points[0] * d.native_scale - d.pixels[0])).toBeLessThanOrEqual(2);
      expect(Math.abs(d.points[1] * d.native_scale - d.pixels[1])).toBeLessThanOrEqual(2);
    }
  });

  test('nothing in src types a phone size of its own', () => {
    // 1206 by 2622 and 402 by 874 are the default row's; a screen that writes them has a second
    // table, which is how a phone comes out the wrong shape (docs/ship-kit.md).
    const root = join(import.meta.dir, '..', 'src');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(n) && !p.includes(`${join('src', 'generated')}`)) {
          const text = readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
          if (/\b1206\s*\/\s*2622\b|\b62\s*\/\s*402\b/.test(text)) hits.push(relative(root, p));
        }
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });
});

describe('the kit', () => {
  const view = kitView(KIT);

  test('a tab per format of the table, in its order, each with its video or none', () => {
    expect(view.tabs.map((t) => t.id)).toEqual(FORMATS.map((f) => f.id) as never);
    expect(view.tabs.map((t) => t.label)).toEqual(['9:16', '4:5', '16:9', '1:1']);
    expect(view.tabs.find((t) => t.id === 'vertical')!.video!.id).toBe('v9');
    expect(view.tabs.find((t) => t.id === 'feed')!.video).toBeNull();
    expect(view.tabs.find((t) => t.id === 'landscape')!.aspect).toBeCloseTo(16 / 9, 5);
  });

  test('stills by position, a file with no url left out, the loop and the framed kept apart', () => {
    expect(view.stills.map((f) => f.id)).toEqual(['s1', 's2']);
    expect(view.framed.map((f) => f.id)).toEqual(['f1']);
    expect(view.loop!.id).toBe('g');
  });

  test('a refusal is its sentence, and a code this build does not know says nothing', () => {
    expect(view.refused).toEqual([SHIPKIT_REFUSALS.no_ipad_capture]);
    expect(view.refused.some((r) => r.includes('_'))).toBe(false);
  });

  test('a first demo lists the latest commits, never "since the last demo"', () => {
    expect(view.changelogTitle).toBe('What changed since the last demo');
    const first = kitView({ ...KIT, document: { ...KIT.document, refused: [{ what: 'before_after', code: 'no_previous_demo' }] } });
    expect(first.changelogTitle).toBe('The latest commits');
  });

  test('the thread is x only', () => {
    expect(threadFor(view, 'x')).toEqual(['One.', 'Two.']);
    expect(threadFor(view, 'linkedin')).toEqual([]);
  });
});

describe('the selection', () => {
  const view = kitView(KIT);

  test('it opens on the first platform with a caption, at that platform format when it has a video', () => {
    const s = initialSelection(view);
    expect(s.platform).toBe('x');
    expect(s.format).toBe(PLATFORM_FORMAT.x);
    expect(s.video).toBe(true);
  });

  test('a platform picks its format until the person picks one by hand', () => {
    let s = initialSelection(view);
    s = selectionReducer(s, { type: 'platform', platform: 'tiktok' });
    expect(s.format).toBe('vertical');
    s = selectionReducer(s, { type: 'format', format: 'square' });
    s = selectionReducer(s, { type: 'platform', platform: 'linkedin' });
    expect(s.format).toBe('square');
  });

  test('stills toggle, and an edit wins until it is taken back', () => {
    let s = initialSelection(view);
    s = selectionReducer(s, { type: 'toggle', id: 's2' });
    s = selectionReducer(s, { type: 'toggle', id: 's1' });
    s = selectionReducer(s, { type: 'toggle', id: 's2' });
    expect(s.picked).toEqual(['s1']);
    s = selectionReducer(s, { type: 'edit', platform: 'x', text: 'Mine.' });
    expect(captionFor(view, s)).toBe('Mine.');
    s = selectionReducer(s, { type: 'revert', platform: 'x' });
    expect(captionFor(view, s)).toBe('A bus route finder.');
    expect(captionFor(view, s, 'threads')).toBe('');
  });

  test('reading another platform caption never moves the format to one with no video', () => {
    // KIT has no 4:5 video; LinkedIn's own format is 4:5.
    expect(PLATFORM_FORMAT.linkedin).toBe('feed');
    let s = initialSelection(view);
    const before = sharePayload(view, s)!.files.map((f) => f.id);
    s = selectionReducer(s, { type: 'platform', platform: 'linkedin' });
    expect(s.format).not.toBe('feed');
    expect(sharePayload(view, s)!.files.map((f) => f.id)).toEqual(before);
    // A platform whose format was filmed still moves it.
    s = selectionReducer(s, { type: 'platform', platform: 'tiktok' });
    expect(s.format).toBe('vertical');
  });

  test('a kit with no video at all still follows the platform', () => {
    const bare = kitView({ ...KIT, files: KIT.files.filter((f) => !f.slot.startsWith('video_')) });
    const s = selectionReducer(initialSelection(bare), { type: 'platform', platform: 'linkedin' });
    expect(s.format).toBe('feed');
    expect(s.video).toBe(false);
  });

  test('a caption over its limit holds the share back and says by how much', () => {
    let s = initialSelection(view);
    expect(shareHeldBack(view, s)).toBeNull();
    s = selectionReducer(s, { type: 'edit', platform: 'x', text: 'y'.repeat(292) });
    expect(shareHeldBack(view, s)).toBe('The X caption is 12 over. Shorten it to share.');
    s = selectionReducer(s, { type: 'edit', platform: 'x', text: 'y'.repeat(280) });
    expect(shareHeldBack(view, s)).toBeNull();
  });

  test('the count is against the platform limit', () => {
    expect(captionCount('x'.repeat(281), 'x')).toEqual({ words: '281 of 280', over: true });
    expect(captionCount('x'.repeat(281), 'linkedin').over).toBe(false);
  });
});

describe('one share', () => {
  const view = kitView(KIT);

  test('the video and every picked still, in the order the screen shows them, with the caption', () => {
    let s = initialSelection(view);
    s = selectionReducer(s, { type: 'platform', platform: 'tiktok' });
    s = selectionReducer(s, { type: 'toggle', id: 'g' });
    s = selectionReducer(s, { type: 'toggle', id: 's2' });
    s = selectionReducer(s, { type: 'toggle', id: 's1' });
    const p = sharePayload(view, s)!;
    expect(p.files.map((f) => f.id)).toEqual(['v9', 's1', 's2', 'g']);
    expect(p.files.map((f) => f.name)).toEqual(['demo-vertical.mp4', 'screen-01.png', 'screen-02.png', 'demo-loop.gif']);
    expect(p.label).toBe('Share the 9:16 video and 3 pictures');
    expect(p.text).toBe('');
  });

  test('stills alone, and nothing picked is no share at all', () => {
    let s = selectionReducer(initialSelection(view), { type: 'video', on: false });
    expect(sharePayload(view, s)).toBeNull();
    s = selectionReducer(s, { type: 'toggle', id: 'f1' });
    const p = sharePayload(view, s)!;
    expect(p.label).toBe('Share 1 picture');
    expect(p.text).toBe('A bus route finder.');
    expect(fileName(view.framed[0]!)).toBe('screen-01-framed.png');
  });

  test('the fallback sheet never claims a share it cannot see, and says what it had', () => {
    for (const line of [fallbackLine(1, 'demo-vertical.mp4', true), fallbackLine(3, 'demo-vertical.mp4', false)]) {
      expect(line).not.toMatch(/\bShared\b/);
      expect(line).toContain('demo-vertical.mp4');
      expect(hasDash(line)).toBe(false);
    }
    expect(fallbackLine(1, 'a.png', true)).toContain('copied');
    expect(fallbackLine(3, 'a.png', false)).toContain('one file at a time');
  });

  test('a format with no video sends the stills only', () => {
    let s = selectionReducer(initialSelection(view), { type: 'format', format: 'feed' });
    s = selectionReducer(s, { type: 'toggle', id: 's1' });
    expect(sharePayload(view, s)!.files.map((f) => f.id)).toEqual(['s1']);
  });
});

describe('asking the Mac', () => {
  const row = (over: Partial<DemoRequestRow>): DemoRequestRow => ({
    id: 'r', project_key: 'k'.repeat(64), status: 'queued', refusal: null, hue: null,
    created_at: '2026-09-19T06:00:00Z', claimed_at: null, finished_at: null, ...over,
  });

  test('every state of the server row has its button and its line, and no dash', () => {
    const cases = [
      requestView(null, null),
      requestView([], KIT.published_at),
      requestView([row({ status: 'queued' })], null),
      requestView([row({ status: 'claimed' })], null),
      requestView([row({ status: 'done' })], KIT.published_at),
      requestView([row({ status: 'failed', refusal: 'no_checkout' })], null),
      requestView([row({ status: 'cancelled' })], null),
    ];
    expect(cases.map((c) => c.kind)).toEqual(['none', 'none', 'waiting', 'waiting', 'done', 'failed', 'none']);
    expect(cases[5]!.line).toBe(`It did not work: ${SHIPKIT_REFUSALS.no_checkout}.`);
    for (const c of cases) {
      expect(hasDash(c.button)).toBe(false);
      expect(hasDash(c.line)).toBe(false);
    }
  });

  test('a done request is the kit on screen only when that kit came after the Mac took it', () => {
    const done = row({ status: 'done', claimed_at: '2026-09-19T06:46:30Z', finished_at: '2026-09-19T06:50:00Z' });
    // Published between the claim and the finish: the worker publishes, then finishes.
    expect(requestView([done], '2026-09-19T06:49:58Z').line).toBe('The kit above is from the demo you asked for.');
    expect(requestView([done], '2026-09-19T06:30:00Z').line).toContain('Publish its kit there');
    expect(requestView([done], null).line).toContain('Publish its kit there');
  });

  test('every platform has a name, and every refusal sentence is plain words', () => {
    for (const p of PLATFORMS) expect(PLATFORM_NAMES[p].length).toBeGreaterThan(0);
    for (const s of Object.values(SHIPKIT_REFUSALS)) expect(/[_]/.test(s.replace(/--device ipad-pro-13|python -m capture demo/g, ''))).toBe(false);
  });
});

describe('done is not the same as up', () => {
  test('a kit counts for a request only when it was published after the Mac took it', () => {
    const r = { created_at: '2026-09-19T06:40:00Z', claimed_at: '2026-09-19T06:41:00Z' };
    expect(kitFromRequest(r, null)).toBe(false);
    expect(kitFromRequest(r, '2026-09-19T06:30:00Z')).toBe(false);
    expect(kitFromRequest(r, '2026-09-19T06:41:00Z')).toBe(true);
    expect(kitFromRequest(r, '2026-09-19T06:55:00Z')).toBe(true);
    // Never claimed (a request a person made and finished by hand): its own ask is the bar.
    expect(kitFromRequest({ created_at: '2026-09-19T06:40:00Z', claimed_at: null }, '2026-09-19T06:45:00Z')).toBe(true);
  });
});
