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
import path from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const config = require('../metro.config.js') as {
  resolver: { resolveRequest: (context: object, moduleName: string, platform: string) => { type: string; filePath?: string } };
};

const SHIM = path.resolve(__dirname, '../src/web/useWindowDimensions.web.ts');

function resolve(moduleName: string, platform: string, origin = path.resolve(__dirname, '../src/live/LiveSessions.tsx')) {
  const context = { originModulePath: origin, resolveRequest: () => ({ type: 'fallthrough' }) };
  return config.resolver.resolveRequest(context, moduleName, platform);
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
