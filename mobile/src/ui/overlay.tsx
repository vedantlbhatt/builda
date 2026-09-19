/**
 * One layer above every screen and below the island, for a thing that grows out of a screen and
 * has to cover the whole phone while it does: a drop opening out of its poster covers the tab bar
 * too, and a view drawn inside a tab can never cover the bar that tab sits in.
 *
 * One at a time. `show` replaces whatever was up; the shown thing closes itself by calling the
 * `hide` it is handed, after its own closing motion has finished.
 *
 * A keyboard's Esc (the desktop layout, `DesktopFrame.web.tsx`) asks the shown thing to close
 * through `dismiss`, which runs the closer it registered with `onDismiss`, motion and all. Without
 * it Esc went BACK under a preview that stayed up: the page changed and the preview did not. A
 * thing that registers nothing (a morph's window, gone in half a second) is left alone.
 */
import React, { useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';

type Render = (hide: () => void) => React.ReactNode;

let current: { key: number; render: Render } | null = null;
let seq = 0;
let dismisser: (() => void) | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const overlay = {
  show(render: Render) {
    current = { key: ++seq, render };
    emit();
  },
  hide() {
    if (!current) return;
    current = null;
    emit();
  },
  isShowing(): boolean {
    return current !== null;
  },
  /** The shown thing's own way out, for Esc. Returns the unregister, for an effect's cleanup. */
  onDismiss(fn: () => void): () => void {
    dismisser = fn;
    return () => {
      if (dismisser === fn) dismisser = null;
    };
  },
  /** Close what is up the way it closes itself; false when nothing up said how. */
  dismiss(): boolean {
    if (!current || !dismisser) return false;
    dismisser();
    return true;
  },
};

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function OverlayHost() {
  const c = useSyncExternalStore(subscribe, () => current, () => current);
  if (!c) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <React.Fragment key={c.key}>{c.render(overlay.hide)}</React.Fragment>
    </View>
  );
}
