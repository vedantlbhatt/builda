/**
 * The shell's preload (`desktop/src/preload.js`) and the page's `DesktopBridge` type are one
 * contract written twice, in two languages, in two packages. A function added to one and not the
 * other fails with no error: the page's optional call finds nothing and quietly does its fallback
 * (Save image downloading instead of saving and copying). So the names are held equal here, the
 * top level and each nested object, read from the source text.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..');

/** The keys of an object literal written two spaces deeper than `indent`, from `start` to its close. */
function keysAt(text: string, indent: number): string[] {
  const re = new RegExp(`^ {${indent}}(\\w+)\\??\\s*[:(]`, 'gm');
  return [...text.matchAll(re)].map((m) => m[1]!);
}

function block(text: string, open: string): string {
  const i = text.indexOf(open);
  if (i < 0) throw new Error(`no ${open}`);
  // The block ends at the first line that closes at the opener's own indent.
  const lineStart = text.lastIndexOf('\n', i) + 1;
  const indent = i - lineStart;
  const close = new RegExp(`^ {${indent}}\\}`, 'm');
  const rest = text.slice(i + open.length);
  const m = close.exec(rest);
  return rest.slice(0, m ? m.index : rest.length);
}

const preload = readFileSync(join(ROOT, 'desktop', 'src', 'preload.js'), 'utf8');
const bridge = readFileSync(join(ROOT, 'mobile', 'src', 'desktop', 'bridge.ts'), 'utf8');

describe('the desktop bridge is one contract', () => {
  const exposed = block(preload, "contextBridge.exposeInMainWorld('builda', {");
  const declared = block(bridge, 'export interface DesktopBridge {');

  test('every function and field the page is typed to call, the shell exposes, and nothing more', () => {
    expect(keysAt(exposed, 2).sort()).toEqual(keysAt(declared, 2).sort());
    expect(keysAt(exposed, 2)).toContain('saveImage');
  });

  test('the nested objects too: the secure store and the island', () => {
    for (const name of ['secureStore', 'island']) {
      expect(keysAt(block(exposed, `${name}: {`), 4).sort()).toEqual(keysAt(block(declared, `${name}: {`), 4).sort());
    }
  });
});
