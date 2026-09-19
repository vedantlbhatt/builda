#!/usr/bin/env node
// Copies what the web build serves from its root and does not commit, both out of node_modules:
//   canvaskit.wasm   Skia on web (`index.web.js` loads it from `/canvaskit.wasm`)
//   wa-sqlite.wasm   SQLite on web (`src/web/expoSqlite.web.ts` loads it from `/wa-sqlite.wasm`)
// Run before `expo start --web` and `expo export --platform web`; `bun run web` and
// `bun run export:web` do.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = {
  'canvaskit.wasm': 'node_modules/canvaskit-wasm/bin/full/canvaskit.wasm',
  'wa-sqlite.wasm': 'node_modules/expo-sqlite/web/wa-sqlite/wa-sqlite.wasm',
};

for (const [name, from] of Object.entries(FILES)) {
  const src = path.join(root, from);
  const dst = path.join(root, 'public', name);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const same = fs.existsSync(dst) && fs.readFileSync(dst).equals(fs.readFileSync(src));
  if (!same) fs.copyFileSync(src, dst);
  console.log(`${same ? 'up to date' : 'copied'}: public/${name} (${fs.statSync(dst).size} bytes)`);
}
