#!/usr/bin/env node
/**
 * Every tab and every pushed route of the web build, in the desktop layout (1440 x 900), with a
 * signed in token: a screenshot each, and every page error, console error and blank pane said out
 * loud. The desktop shell loads this same bundle, so this is the desktop app minus its window.
 *
 * What it needs (the same as scripts/e2e_web.mjs):
 *   - the exported web bundle served on $E2E_APP_URL with an SPA fallback (any static server that
 *     answers every path with index.html), built with BUILDER_API_URL pointing at the API;
 *   - a device token file at $E2E_TOKENS. Refresh tokens ROTATE: the rotated pair is written back
 *     at the end, and a file must never be used by two runs at once;
 *   - Chromium started with --disable-web-security, because the API's CORS list names its own
 *     website and not the static server (the desktop shell answers preflights itself instead).
 *
 *   PLAYWRIGHT_DIR=<dir with node_modules/playwright> E2E_APP_URL=http://127.0.0.1:8791 \
 *   E2E_TOKENS=device.json E2E_SESSION_ID=<uuid> E2E_PROJECT_KEY=<hex> E2E_DROP_ID=<uuid> \
 *   node scripts/e2e_desktop_web.mjs --out shots/motion/desktop/web [--only now,sessions]
 *
 * Exit status 1 if any route threw, logged an error, or left its pane blank.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const requireFrom = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, 'package.json') : import.meta.url);
const { chromium } = requireFrom('playwright');

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
};
const OUT = path.resolve(arg('--out', 'shots/motion/desktop/web'));
const ONLY = (arg('--only', '') || '').split(',').filter(Boolean);
const APP = process.env.E2E_APP_URL ?? 'http://127.0.0.1:8791';
const TOKENS = process.env.E2E_TOKENS;
const WIDTH = Number(process.env.E2E_WIDTH ?? 1440);
const HEIGHT = Number(process.env.E2E_HEIGHT ?? 900);
if (!TOKENS) throw new Error('set E2E_TOKENS to the device token json');
const tokens = JSON.parse(fs.readFileSync(TOKENS, 'utf8'));
fs.mkdirSync(OUT, { recursive: true });

const S = process.env.E2E_SESSION_ID;
const P = process.env.E2E_PROJECT_KEY;
const D = process.env.E2E_DROP_ID;
/** [id, route, what it is]; a route whose id is missing its fixture is skipped, and said so. */
const ROUTES = [
  ['now', '/now', 'Now: mission control'],
  ['sessions', '/sessions', 'Sessions: the list, nothing open'],
  ['session', S && `/session/${S}`, 'Sessions: the list beside one session'],
  ['drops', '/drops', 'Drops: the wall, nothing open'],
  ['drop', D && `/drop/${D}`, 'Drops: the wall beside one drop'],
  ['projects', '/projects', 'Projects: the list, nothing open'],
  ['project', P && `/project/${P}`, 'Projects: the list beside one project'],
  ['ship', P && `/ship/${P}`, "Projects: the list beside one project's ship kit"],
  ['you', '/you', 'You'],
  ['live', '/live', 'Mission control, full size'],
  ['analysis', '/analysis', 'Your analysis'],
  ['wrapped', '/wrapped', 'Wrapped'],
  ['dimensions', '/you/dimensions', 'Dimensions'],
  ['money', '/you/money', 'Money'],
  ['stack', '/you/stack', 'Your stack'],
  ['glossary', '/you/glossary', 'Glossary'],
  ['map', S && `/you/map/${S}`, 'Codebase map'],
  ['timelapse', S && `/you/timelapse/${S}`, 'Time lapse'],
  ['settings', '/settings', 'Settings'],
  ['pair', '/pair', 'Connect your Mac (the camera route)'],
  ['icon', '/icon', 'Your creature'],
  ['island-crew', '/island?sample=crew&expand=1', 'The island, open, three running (sample)'],
  ['island-needs', '/island?sample=needsYou&expand=1', 'The island, open, waiting on you (sample)'],
];

const browser = await chromium.launch({ args: ['--disable-web-security'], ...(process.env.E2E_CHROME ? { executablePath: process.env.E2E_CHROME } : {}) });
const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1, colorScheme: 'dark' });
await context.addInitScript(({ access, refresh }) => {
  try {
    localStorage.setItem('builder.access', access);
    localStorage.setItem('builder.refresh', refresh);
  } catch {}
}, { access: tokens.access_token, refresh: tokens.refresh_token });
const page = await context.newPage();

let problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${String(e).slice(0, 300)}`));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  // The browser's own complaints about a page nobody has tapped yet are not the app's.
  if (/navigator\.vibrate|Download the React DevTools|favicon/.test(t)) return;
  // A reel's poster that its platform refuses (Instagram answers 403 to a hotlink) is the post's
  // host saying no, not the app failing; a failed load from the app or the API is not skipped.
  const at = m.location()?.url ?? '';
  if (/^Failed to load resource/.test(t) && at && !at.startsWith(APP) && !(process.env.E2E_API_URL && at.startsWith(process.env.E2E_API_URL))) return;
  problems.push(`console: ${t.slice(0, 300)}${at ? ` (${at.slice(0, 120)})` : ''}`);
});

const report = [];
let failed = 0;
for (const [id, route, what] of ROUTES) {
  if (ONLY.length && !ONLY.includes(id)) continue;
  if (!route) {
    report.push(`skip  ${id}: no fixture id for it`);
    continue;
  }
  problems = [];
  await page.goto(`${APP}${route}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(Number(process.env.E2E_SETTLE ?? 4000));
  const file = `web-${id}.png`;
  await page.screenshot({ path: path.join(OUT, file) });
  // A pane that is only the ground is a screen that did not draw.
  const filled = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('div, canvas, svg, img')).filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.left < 240) return false;
      const cs = getComputedStyle(el);
      return el.tagName !== 'DIV' || (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'rgb(20, 18, 16)') || (el.textContent ?? '').trim().length > 0;
    });
    return els.length;
  });
  const bad = problems.length > 0 || filled < 3;
  if (bad) failed += 1;
  report.push(`${bad ? 'FAIL' : 'ok  '}  ${file}  ${what}${filled < 3 ? '  (blank pane)' : ''}`);
  for (const p of problems.slice(0, 5)) report.push(`        ${p}`);
}

const st = await page.evaluate(() => ({ a: localStorage.getItem('builder.access'), r: localStorage.getItem('builder.refresh') }));
if (st.a && st.r) fs.writeFileSync(TOKENS, JSON.stringify({ ...tokens, access_token: st.a, refresh_token: st.r }, null, 1));
await browser.close();

const text = report.join('\n');
fs.writeFileSync(path.join(OUT, 'web-report.txt'), `${text}\n`);
console.log(text);
process.exit(failed ? 1 : 0);
