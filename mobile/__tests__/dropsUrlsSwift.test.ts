/**
 * The share extension's Swift port of the link normaliser, held to the TypeScript.
 *
 * Since docs/drop-island.md the extension posts a drop itself when it may, with no JavaScript, so
 * `modules/builder-drops/ios/BuilderDropsURL.swift` decides what a shared link IS on that path.
 * The server validates rather than rewriting, and a drop's natural key is the normalised link, so
 * a Swift answer that differs from `src/drops/urls.ts` by one character is the same reel as two
 * cards: one from the sheet, one from the app. `dropsUrls.test.ts` holds the TypeScript to
 * `drops/urls.py`; this holds the Swift to the TypeScript, two ways:
 *
 *   * the three tables are read out of both sources and compared, so an edit to one is a failure
 *     here rather than a duplicate card in a month;
 *   * where `swiftc` exists (every Mac this is built on), the Swift file is COMPILED and run over
 *     the same cases, and every answer must be the TypeScript's. Without `swiftc` that half skips,
 *     as `pythonRef` skips without python3, and the table half still runs.
 */
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { normalizeShared } from '../src/drops/urls';

const ROOT = join(import.meta.dir, '..');
const SWIFT = join(ROOT, 'modules/builder-drops/ios/BuilderDropsURL.swift');
const TS = join(ROOT, 'src/drops/urls.ts');

const swift = readFileSync(SWIFT, 'utf8');
const ts = readFileSync(TS, 'utf8');

/** Every quoted string between two markers, in order. */
function quoted(src: string, from: string, to: string, quote: '"' | "'"): string[] {
  const start = src.indexOf(from);
  const block = src.slice(start, src.indexOf(to, start + from.length));
  return [...block.matchAll(quote === '"' ? /"([^"]*)"/g : /'([^']*)'/g)].map((m) => m[1]!);
}

describe('the tables are the same tables', () => {
  test('HOSTS, same pairs, same order', () => {
    expect(quoted(swift, 'static let hosts', ']\n', '"')).toEqual(quoted(ts, 'const HOSTS', '];', "'"));
  });

  test('CANONICAL, same pairs', () => {
    expect(quoted(swift, 'static let canonical', ']\n', '"')).toEqual(quoted(ts, 'const CANONICAL', '};', "'"));
  });

  test('SHARE_PARAMS, same set', () => {
    const a = quoted(swift, 'static let shareParams', ']\n', '"').sort();
    const b = quoted(ts, 'const SHARE_PARAMS', ']);', "'").sort();
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(10);
  });

  test('the column cap and the utm_ rule', () => {
    expect(swift).toContain('public static let maxURL = 500');
    expect(ts).toContain('export const MAX_URL = 500;');
    expect(swift).toContain('!k.hasPrefix("utm_")');
    expect(ts).toContain("!k.startsWith('utm_')");
  });
});

/** The cases `dropsUrls.test.ts` holds against Python, and the door's own. */
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
  'check this out https://www.tiktok.com/@a/video/1 wild',
  'https://www.threads.net/@a/post/xyz',
  'https://www.instagram.com/p/abc/?img_index=1&igsh=zz',
  'https://example.com/a?q=two+words&b=%C3%A9',
  'https://example.com:8443/x/',
  'instagram.com/reel/abc',
  'Look at this: https://x.com/a/status/9.',
  'https://en.wikipedia.org/wiki/Rust_(programming_language)',
  'see (https://example.com/a) here',
  'just some words',
  '',
  'https://evil.example@instagram.com/reel/x',
  'javascript:alert(1)',
  'file:///etc/passwd',
  `https://x.com/${'a'.repeat(600)}`,
];

function haveSwiftc(): boolean {
  const probe = spawnSync('swiftc', ['--version'], { encoding: 'utf8' });
  return !probe.error && probe.status === 0;
}

describe('the Swift normaliser, compiled and run', () => {
  test('answers every case exactly as the TypeScript does', () => {
    if (!haveSwiftc()) return;
    const dir = mkdtempSync(join(tmpdir(), 'builda-urls-'));
    const main = join(dir, 'main.swift');
    writeFileSync(
      main,
      [
        'import Foundation',
        'let data = FileHandle.standardInput.readDataToEndOfFile()',
        'let cases = try! JSONSerialization.jsonObject(with: data) as! [String]',
        'var out: [[String]] = []',
        'for c in cases {',
        '  if let s = BuilderDropsURL.normalize(c) { out.append([s.url, s.platform, s.text]) } else { out.append([]) }',
        '}',
        'print(String(data: try! JSONSerialization.data(withJSONObject: out), encoding: .utf8)!)',
      ].join('\n')
    );
    const bin = join(dir, 'normalize');
    const build = spawnSync('swiftc', [SWIFT, main, '-o', bin], { encoding: 'utf8' });
    if (build.status !== 0) throw new Error(`swiftc failed:\n${build.stderr}`);
    const run = spawnSync(bin, [], { input: JSON.stringify(CASES), encoding: 'utf8' });
    if (run.status !== 0) throw new Error(`the Swift normaliser failed:\n${run.stderr}`);
    const theirs = JSON.parse(run.stdout) as string[][];
    const mine = CASES.map((c) => {
      const s = normalizeShared(c);
      return s ? [s.url, s.platform, s.text] : [];
    });
    expect(theirs).toEqual(mine);
  }, 120_000);
});
