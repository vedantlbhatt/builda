#!/usr/bin/env node
/**
 * Build the phone app's web bundle and put it where the shell loads it from (`desktop/web`).
 *
 *   BUILDER_API_URL=https://<your-server> node scripts/build-web.mjs
 *   node scripts/build-web.mjs --local          # http://127.0.0.1:8788, the local stack
 *
 * The API address is baked into the bundle at export (`mobile/app.config.ts`), exactly as it is
 * into a phone build, so the same rule holds: a release with no BUILDER_API_URL would install,
 * open, and fail every request against localhost with no error anyone could act on. This refuses
 * to build one; `--local` is the explicit way to point at a local stack.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.resolve(here, '..');
const mobile = path.resolve(desktop, '..', 'mobile');
const out = path.join(desktop, 'web');
const local = process.argv.includes('--local');
const api = process.env.BUILDER_API_URL || (local ? 'http://127.0.0.1:8788' : null);

if (!api) {
  console.error(
    'BUILDER_API_URL is not set. A desktop build without it points at localhost and fails every request.\n' +
      'Set it (BUILDER_API_URL=https://<your-server> npm run web), or pass --local for the local stack.',
  );
  process.exit(2);
}

function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) {
    console.error(`${cmd} ${args.join(' ')} failed (${r.status})`);
    process.exit(r.status ?? 1);
  }
}

// The wasm the web build serves from its root (Skia, SQLite), then the export itself.
run(process.execPath, ['scripts/web-assets.mjs'], { cwd: mobile });
const exportDir = 'dist-desktop';
run('npx', ['expo', 'export', '--platform', 'web', '--output-dir', exportDir, '--clear'], {
  cwd: mobile,
  env: { ...process.env, BUILDER_API_URL: api, EXPO_NO_TELEMETRY: '1' },
});

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(mobile, exportDir), out, { recursive: true });
fs.rmSync(path.join(mobile, exportDir), { recursive: true, force: true });

let commit = null;
const git = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: desktop, encoding: 'utf8' });
if (git.status === 0) commit = git.stdout.trim();
fs.writeFileSync(path.join(out, 'builda.json'), JSON.stringify({ apiBaseUrl: api, builtAt: new Date().toISOString(), commit }, null, 2));

const files = fs.readdirSync(out, { recursive: true }).length;
console.log(`web bundle -> ${path.relative(process.cwd(), out) || out} (${files} files), API ${api}`);
