/**
 * The web resolver's window size rule (`metro.config.js`): every way the app reaches
 * react-native-web's `useWindowDimensions` lands on the pane-aware shim, and a native platform
 * never sees any of it.
 *
 * WHY A TEST. babel-plugin-react-native-web rewrites `import { useWindowDimensions } from
 * 'react-native'` to a deep import on web, which the index shim never saw: 44 modules of the
 * 2026-09-19 export laid themselves out for the window inside a pane, and nothing failed.
 */
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const SHIM = path.resolve(__dirname, '../src/web/useWindowDimensions.web.ts');
const DEFAULT_ORIGIN = path.resolve(__dirname, '../src/live/LiveSessions.tsx');

/**
 * Every question the tests ask, answered by the real config in a CHILD process. FOUND IN THE FULL
 * SUITE: requiring `metro.config.js` in the test process (Expo's `getDefaultConfig`) left later
 * files' `spawnSync('python3', ...)` returning an empty stdout with status 0, so five Python
 * parity tests failed on JSON they never got; each file passed alone. Loading the config
 * somewhere else keeps the suite's process as it was.
 */
const QUESTIONS: [string, string, string][] = [
  ['react-native-web/dist/exports/useWindowDimensions', 'web', DEFAULT_ORIGIN],
  ['react-native-web/dist/cjs/exports/useWindowDimensions', 'web', DEFAULT_ORIGIN],
  ['./exports/useWindowDimensions', 'web', path.resolve(__dirname, '../node_modules/react-native-web/dist/index.js')],
  ['react-native-web/dist/exports/useWindowDimensions', 'web', SHIM],
  ['react-native-web/dist/exports/useWindowDimensions', 'ios', DEFAULT_ORIGIN],
  ['react-native-web/dist/exports/useWindowDimensions', 'android', DEFAULT_ORIGIN],
  ['react-native-web/dist/exports/Dimensions', 'web', DEFAULT_ORIGIN],
];
const ANSWERS: { type: string; filePath?: string }[] = (() => {
  const script = `
    const config = require(${JSON.stringify(path.resolve(__dirname, '../metro.config.js'))});
    const qs = ${JSON.stringify(QUESTIONS)};
    const out = qs.map(([m, p, origin]) => config.resolver.resolveRequest({ originModulePath: origin, resolveRequest: () => ({ type: 'fallthrough' }) }, m, p));
    process.stdout.write(JSON.stringify(out));
  `;
  const run = spawnSync(process.execPath, ['-e', script], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`loading metro.config.js failed: ${run.stderr}`);
  return JSON.parse(run.stdout);
})();

function resolve(moduleName: string, platform: string, origin = DEFAULT_ORIGIN) {
  const i = QUESTIONS.findIndex(([m, p, o]) => m === moduleName && p === platform && o === origin);
  if (i < 0) throw new Error(`not asked: ${moduleName} ${platform} ${origin}`);
  return ANSWERS[i]!;
}

describe('the pane-aware window size hook on web', () => {
  test('the deep import babel writes for an app file resolves to the shim', () => {
    expect(resolve('react-native-web/dist/exports/useWindowDimensions', 'web')).toEqual({ type: 'sourceFile', filePath: SHIM });
    expect(resolve('react-native-web/dist/cjs/exports/useWindowDimensions', 'web')).toEqual({ type: 'sourceFile', filePath: SHIM });
  });

  test("react-native-web's own index still resolves to the shim", () => {
    const index = path.resolve(__dirname, '../node_modules/react-native-web/dist/index.js');
    expect(resolve('./exports/useWindowDimensions', 'web', index)).toEqual({ type: 'sourceFile', filePath: SHIM });
  });

  test('the shim itself is never pointed at itself', () => {
    expect(resolve('react-native-web/dist/exports/useWindowDimensions', 'web', SHIM)).toEqual({ type: 'fallthrough' });
  });

  test('a phone never sees the rule', () => {
    expect(resolve('react-native-web/dist/exports/useWindowDimensions', 'ios')).toEqual({ type: 'fallthrough' });
    expect(resolve('react-native-web/dist/exports/useWindowDimensions', 'android')).toEqual({ type: 'fallthrough' });
  });

  test('other react-native-web exports are left alone', () => {
    expect(resolve('react-native-web/dist/exports/Dimensions', 'web')).toEqual({ type: 'fallthrough' });
  });
});
