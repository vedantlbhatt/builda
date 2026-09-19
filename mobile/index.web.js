// The app's entry on web: the browser, and the desktop shell in `desktop/`, which loads this
// same bundle. iOS and Android load `index.js`.
//
// Skia on web is CanvasKit, a WebAssembly build of the same library, and
// `@shopify/react-native-skia`'s web `Skia` object is built from `global.CanvasKit` the moment
// its module runs. So CanvasKit has to be loaded BEFORE any module that imports Skia is
// evaluated, which here means before the router requires a single route: the app is required
// inside the promise, not imported at the top. The wasm is served from the site root
// (`public/canvaskit.wasm`, copied there by `scripts/web-assets.mjs`).
import '@expo/metro-runtime';
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web';

LoadSkiaWeb({ locateFile: (file) => `/${file}` })
  .catch((e) => {
    // The app still starts: a Skia view is then empty rather than the whole page red.
    console.error('[skia] CanvasKit did not load; Skia views will be empty', e);
  })
  .then(() => {
    require('expo-router/entry');
  });
