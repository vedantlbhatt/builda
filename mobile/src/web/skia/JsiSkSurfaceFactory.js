/**
 * Web stand-in for react-native-skia's `JsiSkSurfaceFactory`, resolved ONLY on web:
 * `metro.config.js` points `JsiSkia`'s own `./JsiSkSurfaceFactory` here.
 *
 * WHY. `Skia.Surface.MakeOffscreen` on web makes a NEW OffscreenCanvas and a new WebGL context
 * every call. The animated backgrounds (`ui/bits/backgrounds/FieldSurface.tsx`) draw their cells
 * into an offscreen surface every frame, which is right on a phone (one GPU context, a new render
 * target) and on web asked the browser for sixty WebGL contexts a second. Chromium keeps about
 * sixteen and drops the oldest: MEASURED in the desktop shell, 2026-09-19, the Now tab's first
 * seconds logged "Too many active WebGL contexts" twenty times and every other canvas on the
 * page went blank or failed ("Could not create surface").
 *
 * Here ONE offscreen context is made, once, and every offscreen surface is a render target on it,
 * which is what the native factory does with its one context. If that context cannot be made (or
 * is lost), the surface falls back to CanvasKit's CPU raster, which is what the original does when
 * OffscreenCanvas is missing. `Make` is unchanged.
 */
import { Host } from '@shopify/react-native-skia/src/skia/web/Host';
import { JsiSkSurface } from '@shopify/react-native-skia/src/skia/web/JsiSkSurface';

let shared = null; // { gr, gl }

function sharedContext(CanvasKit) {
  if (shared && shared.gl && !shared.gl.isContextLost()) return shared.gr;
  shared = null;
  const OC = globalThis.OffscreenCanvas;
  if (OC === undefined) return null;
  try {
    const canvas = new OC(1, 1);
    const handle = CanvasKit.GetWebGLContext(canvas);
    if (!handle) return null;
    const gr = CanvasKit.MakeWebGLContext(handle);
    if (!gr) return null;
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    shared = { gr, gl };
    return gr;
  } catch (e) {
    return null;
  }
}

export class JsiSkSurfaceFactory extends Host {
  constructor(CanvasKit) {
    super(CanvasKit);
  }

  Make(width, height) {
    return new JsiSkSurface(this.CanvasKit, this.CanvasKit.MakeSurface(width, height));
  }

  MakeOffscreen(width, height) {
    const gr = sharedContext(this.CanvasKit);
    let surface = null;
    if (gr) {
      try {
        surface = this.CanvasKit.MakeRenderTarget(gr, width, height);
      } catch (e) {
        surface = null;
      }
    }
    if (!surface) return this.Make(width, height);
    return new JsiSkSurface(this.CanvasKit, surface);
  }
}
