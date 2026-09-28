/**
 * The web's door to expo-video (the desktop shell runs this build): the package itself. On the web
 * expo-video is the browser's own `<video>` element, always there, so there is no native module to
 * ask about first. FOUND ON 2026-09-28 driving the web build: `video.ts`'s probe,
 * `requireOptionalNativeModule('ExpoVideo')`, answers null on the web outside a DOM webview
 * (`expo-modules-core/src/requireNativeModule.web.ts`), so no demo video had ever played on the
 * desktop; every one showed its poster.
 */
export type ExpoVideo = typeof import('expo-video');

let mod: ExpoVideo | null | undefined;

export function expoVideo(): ExpoVideo | null {
  if (mod === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('expo-video') as ExpoVideo;
    } catch {
      mod = null;
    }
  }
  return mod ?? null;
}
