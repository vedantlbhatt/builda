// @ts-check
'use strict';
/**
 * A test run's screenshots and recording, taken from INSIDE the app (`BUILDA_CAPTURE=<dir>`).
 *
 * Why not `screencapture`: it needs the Screen Recording permission for whatever process asks,
 * and an unattended run has nobody to click Allow; it answers "could not create image from
 * display" and writes nothing. `webContents.capturePage()` asks no one, because it is the app
 * reading its own pixels: every screen exactly as the page drew it (the window's title bar and
 * traffic lights are the system's, and are not in these), and the island on its transparent
 * ground. The island's expansion is recorded frame by frame (`beginFrameSubscription`) and
 * encoded with ffmpeg by `scripts/capture.mjs`.
 *
 * Routes come from `BUILDA_CAPTURE_ROUTES` (comma separated), else every tab and Settings.
 */
const fs = require('node:fs');
const path = require('node:path');

const wait = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {import('electron').WebContents} wc
 * @param {string} file
 */
async function shoot(wc, file) {
  const img = await wc.capturePage();
  fs.writeFileSync(file, img.toPNG());
  return img.getSize();
}

/**
 * @param {{ main: import('electron').BrowserWindow, island: ReturnType<typeof import('./island').createIsland>,
 *           send: (c: string) => void, dir: string, origin: string }} o
 */
async function run(o) {
  const dir = path.resolve(o.dir);
  fs.mkdirSync(dir, { recursive: true });
  const log = (/** @type {string} */ m) => {
    fs.appendFileSync(path.join(dir, 'capture.log'), `${new Date().toISOString()} ${m}\n`);
  };
  // Every error and warning either page prints goes in the log beside the pictures.
  const listen = (/** @type {import('electron').WebContents} */ wc, /** @type {string} */ who) =>
    wc.on('console-message', (/** @type {any} */ e, /** @type {any} */ level, /** @type {any} */ message) => {
      const lv = e?.level ?? level;
      const msg = e?.message ?? message;
      if (lv === 'error' || lv === 'warning' || lv === 2 || lv === 3) log(`[${who} ${lv}] ${String(msg).slice(0, 400)}`);
    });
  listen(o.main.webContents, 'main');
  try {
    const main = o.main;
    await new Promise((r) => (main.webContents.isLoading() ? main.webContents.once('did-finish-load', r) : r(null)));
    await wait(Number(process.env.BUILDA_CAPTURE_SETTLE ?? 6000));

    const routes = (process.env.BUILDA_CAPTURE_ROUTES ?? '/now,/sessions,/drops,/projects,/you,/settings').split(',').filter(Boolean);
    let i = 0;
    for (const route of routes) {
      i += 1;
      main.webContents.send('command', `go:${route}`);
      await wait(Number(process.env.BUILDA_CAPTURE_WAIT ?? 3500));
      const name = `${String(i).padStart(2, '0')}-${route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'root'}.png`;
      const size = await shoot(main.webContents, path.join(dir, name));
      const probe = await main.webContents
        .executeJavaScript(
          `new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n += 1; if (performance.now() - t0 < 500) requestAnimationFrame(f); else r(document.visibilityState + ' ' + n + ' frames/500ms ' + location.pathname); }; requestAnimationFrame(f); setTimeout(() => r('no frames ' + document.visibilityState), 1500); })`,
        )
        .catch((e) => String(e));
      log(`main ${route} -> ${name} ${size.width}x${size.height} (${probe})`);
    }

    // The island: every state compact and open, from the sample activities.
    if (process.env.BUILDA_CAPTURE_ISLAND !== '0') {
      const win = o.island.open();
      listen(win.webContents, 'island');
      const base = new URL(win.webContents.getURL() || `${o.origin}/island`);
      for (const sample of ['needsYou', 'crew', 'drop', 'shipped']) {
        for (const expand of ['0', '1']) {
          const u = new URL(base.toString());
          u.searchParams.set('sample', sample);
          if (expand === '1') u.searchParams.set('expand', '1');
          else u.searchParams.delete('expand');
          await win.loadURL(u.toString());
          await wait(1800);
          const name = `island-${sample}-${expand === '1' ? 'open' : 'compact'}.png`;
          await shoot(win.webContents, path.join(dir, name));
          log(`island ${sample} ${expand} -> ${name}`);
        }
      }

      // The expansion, recorded: hover in over the pill, hold, hover out.
      const u = new URL(base.toString());
      u.searchParams.set('sample', 'crew');
      u.searchParams.delete('expand');
      await win.loadURL(u.toString());
      await wait(1500);
      const framesDir = path.join(dir, 'island-frames');
      fs.rmSync(framesDir, { recursive: true, force: true });
      fs.mkdirSync(framesDir, { recursive: true });
      /** @type {{ t: number, png: Buffer }[]} */
      const frames = [];
      const t0 = Date.now();
      win.webContents.beginFrameSubscription(false, (image) => {
        frames.push({ t: Date.now() - t0, png: image.toPNG() });
      });
      const b = win.getBounds();
      const cx = Math.round(b.width / 2);
      // Keep the page painting while nothing moves, so the recording has every still moment too.
      const tick = setInterval(() => win.webContents.invalidate(), 16);
      await wait(700);
      win.webContents.sendInputEvent({ type: 'mouseEnter', x: cx, y: 12 });
      win.webContents.sendInputEvent({ type: 'mouseMove', x: cx, y: 12 });
      await wait(2200);
      win.webContents.sendInputEvent({ type: 'mouseMove', x: cx, y: 230 });
      win.webContents.sendInputEvent({ type: 'mouseLeave', x: cx, y: 239 });
      await wait(1800);
      clearInterval(tick);
      win.webContents.endFrameSubscription();
      frames.forEach((f, k) => fs.writeFileSync(path.join(framesDir, `${String(k).padStart(5, '0')}-${f.t}.png`), f.png));
      log(`island frames ${frames.length} over ${frames.length ? frames[frames.length - 1].t : 0} ms`);
    }
    log('done');
  } catch (e) {
    log(`failed: ${e instanceof Error ? e.stack : String(e)}`);
  } finally {
    if (process.env.BUILDA_CAPTURE_QUIT !== '0') {
      const { app } = require('electron');
      app.exit(0);
    }
  }
}

module.exports = { run };
