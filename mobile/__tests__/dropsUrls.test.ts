/**
 * What one reel's link IS, held to the Python that decides it.
 *
 * `drops/urls.py` normalises on the Mac and `src/drops/urls.ts` normalises on the phone, and the
 * server validates rather than rewriting, so these two are the ONLY two opinions in the system
 * and they have to be the same one. The cases below are the ones that cost something: the
 * sharer's parameters that make one reel two cards, and the `www.` that is not noise.
 */
import { describe, expect, test } from 'bun:test';

import { normalizeShared, platformOf } from '../src/drops/urls';
import { havePython, python } from './pythonRef';

const CASES = [
  'https://www.instagram.com/reel/DGxvBNzR8vC/?igsh=MXY&utm_source=ig_web',
  'https://instagram.com/reel/DGxvBNzR8vC',
  'https://www.tiktok.com/@nocode.joshua/video/7620790035939462407?_t=1&_r=1',
  'https://tiktok.com/@a/video/1',
  'https://vm.tiktok.com/ZMabc/',
  'https://www.youtube.com/shorts/2Nn9?feature=share',
  'https://youtu.be/xyz?si=abc',
  'https://m.youtube.com/watch?v=abc&t=30',
  'https://twitter.com/x/status/1',
  'https://www.reddit.com/r/a/comments/b/c/',
  'https://example.com/a/b?z=1&a=2',
];

describe('the shared link, both sides', () => {
  test('the phone normalises exactly what the Mac does', () => {
    if (!havePython()) return;
    const theirs = python<[string, string][]>(
      `import json, sys\nfrom drops import urls as u\nprint(json.dumps([list(u.normalize(c)) for c in json.loads(sys.argv[1])]))`,
      JSON.stringify(CASES),
    );
    const mine = CASES.map((c) => {
      const s = normalizeShared(c);
      return [s?.url ?? '', s?.platform ?? ''];
    });
    expect(mine).toEqual(theirs ?? []);
  });

  test('the platform of a host agrees', () => {
    if (!havePython()) return;
    const hosts = ['www.instagram.com', 'vm.tiktok.com', 'youtu.be', 'x.com', 'redd.it', 'example.com', 'threads.net'];
    const theirs = python<string[]>(
      `import json, sys\nfrom drops import urls as u\nprint(json.dumps([u.platform_of(h) for h in json.loads(sys.argv[1])]))`,
      JSON.stringify(hosts),
    );
    expect(hosts.map(platformOf)).toEqual(theirs ?? []);
  });
});

describe('the door', () => {
  test('a share sheet that carried text as well as a link keeps both', () => {
    const s = normalizeShared('check this out https://www.tiktok.com/@a/video/1 wild');
    expect(s?.url).toBe('https://www.tiktok.com/@a/video/1');
    expect(s?.text).toBe('check this out wild');
  });

  test('no link in it is null, not a throw', () => {
    expect(normalizeShared('just some words')).toBeNull();
    expect(normalizeShared('')).toBeNull();
    expect(normalizeShared('   ')).toBeNull();
  });

  test('a host that reads as one site and resolves to another is refused', () => {
    expect(normalizeShared('https://evil.example@instagram.com/reel/x')).toBeNull();
  });

  test('a scheme that is not http is refused', () => {
    expect(normalizeShared('javascript:alert(1)')).toBeNull();
    expect(normalizeShared('file:///etc/passwd')).toBeNull();
    expect(normalizeShared('data:text/html,<script>')).toBeNull();
  });

  test('a link longer than the column is refused rather than truncated', () => {
    expect(normalizeShared(`https://x.com/${'a'.repeat(600)}`)).toBeNull();
  });

  test('the same reel shared twice is the same url', () => {
    const a = normalizeShared('https://www.instagram.com/reel/ABC/?igsh=first');
    const b = normalizeShared('https://instagram.com/reel/ABC?igsh=second&utm_source=x');
    expect(a?.url).toBe(b?.url ?? '');
  });

  test('www is kept, because dropping it breaks TikTok', () => {
    // MEASURED 2026-09-15: `https://tiktok.com/@u/video/1` is a 400 from TikTok's own oEmbed
    // endpoint and `unsupported url` to yt-dlp. See drops/urls.py.
    expect(normalizeShared('https://tiktok.com/@a/video/1')?.url).toBe('https://www.tiktok.com/@a/video/1');
  });
});
