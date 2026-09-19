// The shell's pure parts, with `node --test` (no Electron): where the island goes, what the
// bundle serves, the token store's round trip, the CORS answer, and the QR.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { islandGeometry, overPill, isAppLink, isExternalAllowed, WINDOW, NOTCH_WIDTH } = require('../src/geometry');
const { fileFor, contentSecurityPolicy } = require('../src/bundle');
const { createMemoryStore, createTokenStore } = require('../src/tokens');
const { allowHeaders } = require('../src/cors');
const { qrModules } = require('../src/qr');
const { MAX_BYTES, pngFromDataUrl, safeName, freePath, kitFiles, freeDir, writeFresh, mkdirFresh, KIT_MAX_FILES } = require('../src/image');

// A 14 inch MacBook Pro at its default scaling: the menu bar holds the notch, 37 points.
const notched = { bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 37, width: 1512, height: 945 }, internal: true };
const external = { bounds: { x: 0, y: 0, width: 2560, height: 1440 }, workArea: { x: 0, y: 25, width: 2560, height: 1415 }, internal: false };
const windows = { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1032 } };

test('a notched Mac: the island sits ON the notch, at the very top, centred', () => {
  const g = islandGeometry(notched, 'darwin');
  assert.deepEqual(g.notch, { width: NOTCH_WIDTH, height: 37 });
  assert.equal(g.y, 0);
  assert.equal(g.x + g.width / 2, 1512 / 2);
});

test('a Mac screen without a notch: just under the menu bar', () => {
  const g = islandGeometry(external, 'darwin');
  assert.equal(g.notch, null);
  assert.equal(g.y, 25 + 6);
  assert.equal(g.x, Math.round((2560 - WINDOW.width) / 2));
});

test('Windows and Linux: the top of the work area, never a notch', () => {
  for (const p of ['win32', 'linux']) {
    const g = islandGeometry(windows, p);
    assert.equal(g.notch, null);
    assert.equal(g.y, 6);
    assert.equal(g.x, Math.round((1920 - WINDOW.width) / 2));
  }
  // A taskbar docked at the top moves the work area down, and the island with it.
  const top = { ...windows, workArea: { x: 0, y: 48, width: 1920, height: 1032 } };
  assert.equal(islandGeometry(top, 'win32').y, 54);
  assert.equal(islandGeometry(notched, 'win32').notch, null);
});

test('the notch can be forced either way, and its width set', () => {
  assert.equal(islandGeometry(notched, 'darwin', { BUILDA_NOTCH: '0' }).notch, null);
  assert.deepEqual(islandGeometry(external, 'darwin', { BUILDA_NOTCH: '1', BUILDA_NOTCH_WIDTH: '186' }).notch, { width: 186, height: 37 });
});

test('the pill takes the mouse and nothing else does', () => {
  const origin = { x: 506, y: 0 };
  const hit = { x: 110, y: 0, width: 280, height: 40 };
  assert.equal(overPill({ x: 506 + 250, y: 20 }, origin, hit), true);
  assert.equal(overPill({ x: 506 + 50, y: 20 }, origin, hit), false);
  assert.equal(overPill({ x: 506 + 250, y: 80 }, origin, hit), false);
  assert.equal(overPill({ x: 506 + 250, y: 20 }, origin, null), false);
});

test('links: builder:// goes to the app; only the web and mail go to the browser', () => {
  assert.equal(isAppLink('builder://session/abc'), true);
  assert.equal(isAppLink('https://example.com'), false);
  assert.equal(isExternalAllowed('https://example.com'), true);
  assert.equal(isExternalAllowed('mailto:a@b.c'), true);
  assert.equal(isExternalAllowed('file:///etc/passwd'), false);
  assert.equal(isExternalAllowed('javascript:alert(1)'), false);
});

test('the bundle: files are files, routes are the page, nothing outside the root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builda-web-'));
  fs.writeFileSync(path.join(root, 'index.html'), '<html></html>');
  fs.mkdirSync(path.join(root, '_expo'));
  fs.writeFileSync(path.join(root, '_expo', 'a.js'), '');
  const isFile = (p) => fs.existsSync(p) && fs.statSync(p).isFile();
  assert.equal(fileFor(root, '/_expo/a.js', isFile), path.join(root, '_expo', 'a.js'));
  assert.equal(fileFor(root, '/session/abc', isFile), path.join(root, 'index.html'));
  assert.equal(fileFor(root, '/', isFile), path.join(root, 'index.html'));
  assert.equal(fileFor(root, '/missing.js', isFile), null);
  assert.equal(fileFor(root, '/../../etc/passwd', isFile), null);
  assert.equal(fileFor(root, '/%2e%2e/%2e%2e/etc/hosts', isFile), null);
});

test('the page may run the wasm it needs and nothing it was not shipped with', () => {
  const csp = contentSecurityPolicy('http://127.0.0.1:8788');
  assert.match(csp, /script-src 'self' 'wasm-unsafe-eval'/);
  assert.doesNotMatch(csp, /'unsafe-eval'/);
  assert.match(csp, /connect-src[^;]*http:\/\/127\.0\.0\.1:8788/);
});

test('the token store: a round trip, a remove, and a file nothing else can read', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'builda-tokens-'));
  const file = path.join(dir, 'tokens.bin');
  // A stand-in for safeStorage that visibly transforms, so plaintext on disk would show.
  const safe = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(Buffer.from(s, 'utf8').toString('base64'), 'utf8'),
    decryptString: (b) => Buffer.from(b.toString('utf8'), 'base64').toString('utf8'),
  };
  const a = createTokenStore(file, safe);
  a.set('builder.access', 'A1');
  a.set('builder.refresh', 'R1');
  assert.equal(fs.readFileSync(file, 'utf8').includes('R1'), false);
  assert.equal((fs.statSync(file).mode & 0o777).toString(8), '600');
  const b = createTokenStore(file, safe);
  assert.equal(b.get('builder.refresh'), 'R1');
  b.remove('builder.refresh');
  assert.equal(createTokenStore(file, safe).get('builder.refresh'), null);
  assert.equal(createTokenStore(file, safe).get('builder.access'), 'A1');
  // A file this machine's key cannot open is a signed out store, not a crash.
  fs.writeFileSync(file, 'not base64 json');
  assert.equal(createTokenStore(file, safe).get('builder.access'), null);
});

test("a preflight is answered with exactly what the page asked for, for the app's origin only", () => {
  const h = allowHeaders('app://builda', new Headers({ 'access-control-request-method': 'PATCH', 'access-control-request-headers': 'authorization, content-type' }));
  assert.equal(h['access-control-allow-origin'], 'app://builda');
  assert.equal(h['access-control-allow-methods'], 'PATCH');
  assert.equal(h['access-control-allow-headers'], 'authorization, content-type');
});

test('the pairing QR is a real QR: square, with its three finder patterns', () => {
  const m = qrModules('builder://pair?code=AB12-CD34');
  const n = m.length;
  assert.ok(n >= 21 && (n - 17) % 4 === 0);
  for (const row of m) assert.equal(row.length, n);
  // Finder corners are dark 7x7 frames.
  for (const [x, y] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
    assert.equal(m[y][x], true);
    assert.equal(m[y + 6][x + 6], true);
    assert.equal(m[y + 1][x + 1], false);
    assert.equal(m[y + 3][x + 3], true);
  }
});

// A 1x1 PNG, the smallest real one.
const DOT = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('a shared card: only a PNG data URL is written, and only up to the cap', () => {
  const png = pngFromDataUrl(`data:image/png;base64,${DOT}`);
  assert.ok(png);
  assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG');
  assert.equal(pngFromDataUrl(`data:image/jpeg;base64,${DOT}`), null);
  assert.equal(pngFromDataUrl(`data:image/png;base64,${Buffer.from('<svg/>').toString('base64')}`), null);
  assert.equal(pngFromDataUrl(null), null);
  assert.equal(pngFromDataUrl(`data:image/png;base64,${'A'.repeat(Math.ceil((MAX_BYTES * 4) / 3) + 8)}`), null);
});

test("a shared card's file name is never a path, and a second one does not overwrite the first", () => {
  assert.equal(safeName('../../etc/passwd'), 'etc-passwd');
  assert.equal(safeName('Builda  week of Sep 14'), 'builda-week-of-sep-14');
  assert.equal(safeName(''), 'builda');
  const taken = new Set(['/d/card.png', '/d/card 2.png']);
  assert.equal(freePath('/d', 'card', (p) => taken.has(p), path.posix.join), '/d/card 3.png');
  assert.equal(freePath('/d', 'other', (p) => taken.has(p), path.posix.join), '/d/other.png');
});

test("a capture run's store never touches safeStorage, and holds what it is given", () => {
  const m = createMemoryStore();
  assert.equal(m.get('builder.access'), null);
  m.set('builder.access', 'A1');
  assert.equal(m.get('builder.access'), 'A1');
  m.remove('builder.access');
  assert.equal(m.get('builder.access'), null);
});

test("a ship kit's files: only the four kit types, checked by their bytes, never a path", () => {
  const png = Buffer.from(DOT, 'base64');
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(12)]);
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  const u8 = (/** @type {Buffer} */ b) => new Uint8Array(b);
  const ok = kitFiles([
    { name: '01 still.png', bytes: u8(png) },
    { name: '../../demo 9x16.mp4', bytes: u8(mp4) },
    { name: 'cover.JPEG', bytes: u8(jpg) },
  ]);
  assert.ok(ok);
  assert.deepEqual(ok.map((f) => f.name), ['01-still.png', 'demo-9x16.mp4', 'cover.jpg']);
  // A name that lies about its bytes, a type a kit never holds, too many, none.
  assert.equal(kitFiles([{ name: 'x.mp4', bytes: u8(png) }]), null);
  assert.equal(kitFiles([{ name: 'x.sh', bytes: u8(Buffer.from('#!/bin/sh')) }]), null);
  assert.equal(kitFiles(Array.from({ length: KIT_MAX_FILES + 1 }, () => ({ name: 'a.png', bytes: u8(png) }))), null);
  assert.equal(kitFiles([]), null);
  // Two files with one name do not overwrite each other.
  assert.deepEqual(kitFiles([{ name: 'a.png', bytes: u8(png) }, { name: 'a.png', bytes: u8(png) }])?.map((f) => f.name), ['a.png', 'a-2.png']);
  const taken = new Set(['/d/builda kit']);
  assert.equal(freeDir('/d', 'builda kit', (p) => taken.has(p), path.posix.join), '/d/builda kit 2');
});

test('a save never replaces a file or writes into a folder that was already there', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'builda-save-'));
  const a = writeFresh(fs, path.join, dir, 'card', 'png', Buffer.from('one'));
  const b = writeFresh(fs, path.join, dir, 'card', 'png', Buffer.from('two'));
  assert.equal(path.basename(a), 'card.png');
  assert.equal(path.basename(b), 'card 2.png');
  assert.equal(fs.readFileSync(a, 'utf8'), 'one');
  const d1 = mkdirFresh(fs, path.join, dir, 'kit');
  const d2 = mkdirFresh(fs, path.join, dir, 'kit');
  assert.notEqual(d1, d2);
  assert.equal(path.basename(d2), 'kit 2');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the app origin is its own: app://builda is not "null"', () => {
  const { originOf, sameOrigin } = require('../src/origin');
  // Node's URL answers "null" for a scheme it does not know; the app's page must still match.
  assert.equal(new URL('app://builda/now').origin, 'null');
  assert.equal(originOf('app://builda/now?x=1'), 'app://builda');
  assert.equal(sameOrigin('app://builda/island', 'app://builda'), true);
  assert.equal(sameOrigin('app://evil/island', 'app://builda'), false);
  assert.equal(sameOrigin('https://builda.example/now', 'app://builda'), false);
  assert.equal(sameOrigin('http://localhost:8081/now', 'http://localhost:8081'), true);
  assert.equal(sameOrigin('not a url', 'app://builda'), false);
  assert.equal(sameOrigin('', 'app://builda'), false);
});
