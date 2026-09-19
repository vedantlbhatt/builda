// Metro configuration. Identical to Expo's default for iOS and Android.
//
// The only addition is a resolver hook that is a no-op unless `platform === 'web'`: on web it
// swaps three modules that have no browser implementation for the shims in `src/web/`, three
// modules inside packages (below, INNER_SHIMS) that the desktop layout needs to behave, and the
// deep import of the window size hook that babel writes into every app file (DEEP_WINDOW_HOOK).
// Native bundles never see this branch, so their module graph is byte-identical to a project
// with no metro.config.js at all.
//
//   expo-sqlite        `ExpoSQLite` needs the wa-sqlite worker plus cross-origin isolation
//                      headers on web. `src/web/expoSqlite.web.ts` runs the same wa-sqlite build
//                      on the page's own thread over an in-memory database (real SQLite, so
//                      `cache.ts`'s json_extract and julianday work), with `kv` kept in
//                      localStorage between launches.
//   expo-secure-store  `ExpoSecureStore.web.js` is `export default {}` — every call throws.
//                      `src/web/secureStore.web.ts` keeps the same three async functions over
//                      the desktop shell's safeStorage bridge, or localStorage in a browser.
//   expo-symbols       No web renderer: every SF Symbol drew nothing (the tab bar's glyphs, the
//                      gear). `src/web/expoSymbols.web.tsx` draws the ones the app names.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const WEB_SHIMS = {
  'expo-sqlite': path.resolve(__dirname, 'src/web/expoSqlite.web.ts'),
  'expo-secure-store': path.resolve(__dirname, 'src/web/secureStore.web.ts'),
  'expo-symbols': path.resolve(__dirname, 'src/web/expoSymbols.web.tsx'),
};

// Modules INSIDE packages, swapped only where their own package imports them, so every other
// export stays the package's:
//   react-native-web's window size hook, so a screen laid out in a desktop pane is told the
//     pane's width rather than the window's (`src/web/useWindowDimensions.web.ts` says why);
//   react-native-skia's web canvas and its offscreen surfaces, so a page of strips and an animated
//     background stop running the browser out of WebGL contexts (`src/web/skia/` says why).
const INNER_SHIMS = [
  {
    moduleName: './exports/useWindowDimensions',
    from: /[\\/]react-native-web[\\/]dist[\\/](cjs[\\/])?index\.js$/,
    filePath: path.resolve(__dirname, 'src/web/useWindowDimensions.web.ts'),
  },
  {
    moduleName: './JsiSkSurfaceFactory',
    from: /[\\/]@shopify[\\/]react-native-skia[\\/](src|lib[\\/]module|lib[\\/]commonjs)[\\/]skia[\\/]web[\\/]JsiSkia\.(ts|js)$/,
    filePath: path.resolve(__dirname, 'src/web/skia/JsiSkSurfaceFactory.js'),
  },
  {
    moduleName: './SkiaBaseWebView',
    from: /[\\/]@shopify[\\/]react-native-skia[\\/](src|lib[\\/]module|lib[\\/]commonjs)[\\/]views[\\/]SkiaPictureView\.web\.(tsx|js)$/,
    filePath: path.resolve(__dirname, 'src/web/skia/SkiaBaseWebView.js'),
  },
];

// The same window size hook, reached the way the app's OWN files reach it. On web babel-preset-expo
// runs babel-plugin-react-native-web, which rewrites `import { useWindowDimensions } from
// 'react-native'` to a deep import of `react-native-web/dist/exports/useWindowDimensions`, so the
// index shim above never saw an app file: MEASURED in the export of 2026-09-19, 44 modules (Now,
// Sessions, the wall, Projects, a session, the analysis) imported the deep path and were laid out
// for the 1440 point window inside a 400 to 1120 point pane, which put the Now stage's words off
// its left edge and a wall poster at 450 points in a 520 point column. The shim itself imports
// only `Dimensions`, so pointing every deep import at it cannot loop.
const DEEP_WINDOW_HOOK = /^react-native-web[\\/]dist[\\/](cjs[\\/])?exports[\\/]useWindowDimensions([\\/]index(\.js)?)?$/;
const WINDOW_SHIM = path.resolve(__dirname, 'src/web/useWindowDimensions.web.ts');

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && Object.prototype.hasOwnProperty.call(WEB_SHIMS, moduleName)) {
    return { type: 'sourceFile', filePath: WEB_SHIMS[moduleName] };
  }
  if (platform === 'web') {
    const inner = INNER_SHIMS.find((x) => x.moduleName === moduleName && x.from.test(context.originModulePath));
    if (inner) return { type: 'sourceFile', filePath: inner.filePath };
    if (DEEP_WINDOW_HOOK.test(moduleName) && context.originModulePath !== WINDOW_SHIM) return { type: 'sourceFile', filePath: WINDOW_SHIM };
  }
  return (defaultResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
