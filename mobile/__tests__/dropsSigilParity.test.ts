/**
 * The sigil, in TypeScript and in Swift, cell for cell.
 *
 * The board draws sigils in JavaScript; the iOS share extension draws the SAME drop's sigil in
 * Swift, seconds earlier, on the sheet that comes up when you hit share. If those two differ,
 * the one thing this feature rests on — that a drop is recognisably itself — is quietly false,
 * and it is false in the one place nobody screenshots.
 *
 * `targets/share/Sigil.swift` is pure Foundation, so this compiles it with a nine line main and
 * compares. A machine with no Swift toolchain SKIPS (the rule `pythonRef.ts` uses); a machine
 * that has one must agree.
 */
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { grow } from '../src/drops/sigil';

const SEEDS = [
  'https://www.tiktok.com/@nocode.joshua/video/7620790035939462407',
  'https://www.youtube.com/shorts/UFk8uJabnIc',
  'https://www.instagram.com/reel/DGxvBNzR8vC',
  'https://www.youtube.com/watch?v=HIqONcVBEm0',
  'https://example.com/x',
  // Non ASCII on purpose: the Swift reads `utf16` because `utf8` would diverge here, and a
  // shared caption is exactly where a character like this turns up.
  'https://example.com/café',
  '',
];

function haveSwift(): boolean {
  const probe = spawnSync('swiftc', ['--version'], { encoding: 'utf8' });
  return !probe.error && probe.status === 0;
}

function swiftGrids(): number[][][] | null {
  if (!haveSwift()) return null;
  const dir = mkdtempSync(join(tmpdir(), 'builda-sigil-'));
  const main = join(dir, 'main.swift');
  writeFileSync(
    main,
    `import Foundation
let seeds = try! JSONSerialization.jsonObject(with: CommandLine.arguments[1].data(using: .utf8)!) as! [String]
let out = seeds.map { Sigil.grow(seed: $0) }
print(String(data: try! JSONSerialization.data(withJSONObject: out), encoding: .utf8)!)
`,
  );
  const bin = join(dir, 'sigil');
  const source = join(import.meta.dir, '..', 'targets', 'share', 'Sigil.swift');
  const build = spawnSync('swiftc', ['-O', '-o', bin, source, main], { encoding: 'utf8' });
  if (build.status !== 0) throw new Error(`the Swift sigil did not compile:\n${build.stderr}`);
  const run = spawnSync(bin, [JSON.stringify(SEEDS)], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (run.status !== 0) throw new Error(`the Swift sigil did not run:\n${run.stderr}`);
  return JSON.parse(run.stdout) as number[][][];
}

describe('the sigil, in both languages', () => {
  const theirs = swiftGrids();

  test('the Swift compiles and answers', () => {
    if (!haveSwift()) return;
    expect(theirs).not.toBeNull();
    expect(theirs).toHaveLength(SEEDS.length);
  });

  test('every cell of every seed agrees', () => {
    if (!theirs) return;
    SEEDS.forEach((seed, i) => {
      expect({ seed, grid: grow(seed) as unknown as number[][] }).toEqual({ seed, grid: theirs[i] as number[][] });
    });
  });
});
