import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { HERE, TRY_AGAIN, wordsFor } from '../src/copy/device';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

describe('where Builda is running, in words', () => {
  test('a phone pulls down; a desktop reloads with its own key', () => {
    expect(wordsFor({ web: false, mac: true }).tryAgain).toBe('Pull down to try again.');
    expect(wordsFor({ web: true, mac: true }).tryAgain).toBe('Press Cmd+R to try again.');
    expect(wordsFor({ web: true, mac: false }).thenRetry).toBe('press Ctrl+R');
    expect(wordsFor({ web: true, mac: true }).here).toBe('this computer');
    expect(wordsFor({ web: false, mac: false }).tap).toBe('Tap');
    expect(wordsFor({ web: true, mac: false }).tap).toBe('Click');
  });

  test('under test (no window) the words are the phone words the other suites read', () => {
    expect(HERE).toBe('this phone');
    expect(TRY_AGAIN).toBe('Pull down to try again.');
  });

  test('no screen says "pull down" itself: a desktop has nothing to pull', () => {
    const root = join(import.meta.dir, '..');
    const offenders = [...files(join(root, 'src')), ...files(join(root, 'app'))]
      .filter((f) => !f.endsWith(join('copy', 'device.ts')))
      .flatMap((f) =>
        readFileSync(f, 'utf8')
          .split('\n')
          .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l) && /pull down/i.test(l))
          .map((l) => `${f}: ${l.trim()}`),
      );
    expect(offenders).toEqual([]);
  });
});
