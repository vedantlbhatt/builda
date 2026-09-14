/**
 * `builder://dev-auth?quiet=1`: the development build's warning toast ("Open debugger to view
 * warnings") off for the rest of the run, so it stops landing in screenshots. Dev builds only:
 * the call sits behind `__DEV__` inside a route that redirects in a release build, and no other
 * file silences every log. Read from the source with comments removed, so prose never trips it.
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MOBILE = join(import.meta.dir, '..');
const read = (p: string) => readFileSync(join(MOBILE, p), 'utf8');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe('quiet=1', () => {
  const src = code(read('app/dev-auth.tsx'));

  test('silences every log, behind __DEV__, only when the link asks', () => {
    expect(src).toMatch(/params\.quiet === '1'/);
    expect(src).toMatch(/if \(__DEV__ && quiet\) LogBox\.ignoreAllLogs\(true\);/);
  });

  test('inside a route that renders nothing but a redirect in a release build', () => {
    expect(src).toMatch(/if \(!__DEV__\) return <Redirect/);
  });

  test('no other file in the app silences every log', () => {
    const others = [...walk(join(MOBILE, 'app')), ...walk(join(MOBILE, 'src'))]
      .filter((p) => !p.endsWith(join('app', 'dev-auth.tsx')))
      .filter((p) => /ignoreAllLogs/.test(code(readFileSync(p, 'utf8'))));
    expect(others).toEqual([]);
  });

  test('the deep link sheet says how to use it', () => {
    const md = read('src/nav/DEEPLINKS.md');
    expect(md).toContain('builder://dev-auth?quiet=1');
    expect(md).toContain('| `quiet=1` |');
  });
});
