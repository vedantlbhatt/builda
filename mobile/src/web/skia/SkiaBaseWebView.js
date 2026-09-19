/* global HTMLCanvasElement */
/**
 * Web stand-in for react-native-skia's `SkiaBaseWebView`, resolved ONLY on web: `metro.config.js`
 * points `SkiaPictureView.web`'s own `./SkiaBaseWebView` here. Native builds never see it.
 *
 * WHY. On web every Skia `<Canvas>` was a `<canvas>` with its own WebGL context
 * (`CanvasKit.MakeWebGLCanvasSurface`), and a browser keeps about sixteen live per page: the
 * seventeenth makes Chromium drop the OLDEST ("Too many active WebGL contexts"), which goes blank.
 * MEASURED in the desktop shell, 2026-09-19: the Sessions list draws a strip and a creature per
 * row and You draws eight bands, so opening either blanked the canvases already on screen. The
 * first fix drew the overflow on CanvasKit's CPU raster, and MEASURED again: a band's dither is a
 * runtime shader, which on the CPU is SkSL interpreted per pixel, and at 2x the main thread fell
 * to 2 frames in 500 ms on Sessions, Projects and You, so their entrances never finished.
 *
 * So there is ONE WebGL context for every Skia view on the page, the way a phone has one GPU
 * context for all of them. It draws into a shared, never-attached canvas; each view keeps a plain
 * 2D canvas and copies its pixels across (`drawImage`, GPU to GPU in Chromium) right after its own
 * flush, in the same task, so the shared buffer is still the view's. The shared canvas grows to
 * the largest view it has served (capped at 4096), and a lost context is simply made again on the
 * next frame. Only where WebGL is missing altogether does a view fall back to the CPU raster.
 *
 * Everything else (the redraw loop, `makeImageSnapshot`, layout) behaves as the original did.
 */
import React from 'react';

import { JsiSkSurface } from '@shopify/react-native-skia/src/skia/web/JsiSkSurface';
import { Platform } from '@shopify/react-native-skia/src/Platform';

const pd = Platform.PixelRatio;
const MAX_SIDE = 4096;

/** { el, surface (JsiSkSurface), canvas (JsiSkCanvas), w, h, lost } or null until first needed. */
let shared = null;
let webglMissing = false;

function sharedFor(CanvasKit, w, h) {
  if (webglMissing) return null;
  if (shared && !shared.lost && w <= shared.w && h <= shared.h) return shared;
  const el = shared?.el ?? document.createElement('canvas');
  if (!shared) {
    el.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (shared) shared.lost = true;
    });
  }
  const W = Math.min(MAX_SIDE, Math.max(w, shared && !shared.lost ? shared.w : 0, 256));
  const H = Math.min(MAX_SIDE, Math.max(h, shared && !shared.lost ? shared.h : 0, 256));
  try {
    shared?.surface?.ref.delete();
  } catch (e) {
    // Gone with its context.
  }
  el.width = W;
  el.height = H;
  const ref = CanvasKit.MakeWebGLCanvasSurface(el, undefined, { preserveDrawingBuffer: 1, antialias: 0, alpha: 1, premultipliedAlpha: 1 });
  // MakeWebGLCanvasSurface falls back to a CPU surface on its own when WebGL is refused: that is
  // no use shared (it would draw the slow way for everyone), so the views go CPU one by one.
  if (!ref || (typeof ref.reportBackendTypeIsGPU === 'function' && !ref.reportBackendTypeIsGPU())) {
    try {
      ref?.delete();
    } catch (e) {
      // Nothing to free.
    }
    webglMissing = true;
    shared = null;
    return null;
  }
  const surface = new JsiSkSurface(CanvasKit, ref);
  shared = { el, surface, canvas: surface.getCanvas(), w: W, h: H, lost: false };
  return shared;
}

export class SkiaBaseWebView extends React.Component {
  constructor(props) {
    super(props);
    this._unsubscriptions = [];
    this._canvasRef = React.createRef();
    this._ctx = null;
    /** Only where WebGL is missing: this view's own CPU surface. */
    this._cpu = null;
    this._redrawRequests = 0;
    this.requestId = 0;
    this.width = 0;
    this.height = 0;
    this.onLayout = this.onLayoutEvent.bind(this);
  }

  unsubscribeAll() {
    this._unsubscriptions.forEach((u) => u());
    this._unsubscriptions = [];
  }

  freeCpu() {
    try {
      this._cpu?.ref.delete();
    } catch (e) {
      // Nothing to free.
    }
    this._cpu = null;
  }

  onLayoutEvent(evt) {
    const canvas = this._canvasRef.current;
    if (canvas) {
      this.width = canvas.clientWidth;
      this.height = canvas.clientHeight;
      canvas.width = Math.round(this.width * pd);
      canvas.height = Math.round(this.height * pd);
      this.freeCpu();
      this._ctx = null;
      this.redraw();
    }
    if (this.props.onLayout) {
      this.props.onLayout(evt);
    }
  }

  getSize() {
    return { width: this.width, height: this.height };
  }

  componentDidMount() {
    this.tick();
  }

  componentDidUpdate() {
    this.redraw();
  }

  componentWillUnmount() {
    this.unsubscribeAll();
    cancelAnimationFrame(this.requestId);
    this.freeCpu();
  }

  /**
   * Draw this view's picture into a surface and return it, flushed: the shared GPU one (its
   * top-left `pw` by `ph` region), or this view's own CPU one.
   */
  paint() {
    const { CanvasKit } = global;
    const el = this._canvasRef.current;
    if (!el || this.width <= 0 || this.height <= 0) return null;
    const pw = el.width;
    const ph = el.height;
    const s = sharedFor(CanvasKit, pw, ph);
    if (s) {
      const c = s.canvas;
      c.save();
      c.clipRect({ x: 0, y: 0, width: pw, height: ph }, 1, false);
      c.clear(Float32Array.of(0, 0, 0, 0));
      c.scale(pd, pd);
      this.renderInCanvas(c);
      c.restore();
      s.surface.ref.flush();
      return { surface: s.surface, source: s.el, pw, ph };
    }
    if (!this._cpu) {
      const ref = CanvasKit.MakeSWCanvasSurface(el);
      if (!ref) return null;
      this._cpu = new JsiSkSurface(CanvasKit, ref);
    }
    const c = this._cpu.getCanvas();
    c.clear(Float32Array.of(0, 0, 0, 0));
    c.save();
    c.scale(pd, pd);
    this.renderInCanvas(c);
    c.restore();
    this._cpu.ref.flush();
    return { surface: this._cpu, source: null, pw, ph };
  }

  /**
   * Creates a snapshot from the canvas in the surface
   * @param rect Rect to use as bounds. Optional.
   * @returns An Image object.
   */
  makeImageSnapshot(rect) {
    const done = this.paint();
    if (!done) return undefined;
    const b = rect ?? { x: 0, y: 0, width: this.width, height: this.height };
    return done.surface.makeImageSnapshot({ x: b.x * pd, y: b.y * pd, width: b.width * pd, height: b.height * pd });
  }

  /** Draw when asked, once per frame at most. */
  tick() {
    if (this._redrawRequests > 0) {
      this._redrawRequests = 0;
      const done = this.paint();
      if (done && done.source) {
        const el = this._canvasRef.current;
        if (!this._ctx && el) this._ctx = el.getContext('2d');
        if (this._ctx) {
          this._ctx.clearRect(0, 0, done.pw, done.ph);
          this._ctx.drawImage(done.source, 0, 0, done.pw, done.ph, 0, 0, done.pw, done.ph);
        }
      }
    }
    this.requestId = requestAnimationFrame(this.tick.bind(this));
  }

  redraw() {
    this._redrawRequests++;
  }

  render() {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { debug = false, ...viewProps } = this.props;
    return (
      <Platform.View {...viewProps} onLayout={this.onLayout}>
        <canvas ref={this._canvasRef} style={{ display: 'flex', flex: 1 }} />
      </Platform.View>
    );
  }
}
