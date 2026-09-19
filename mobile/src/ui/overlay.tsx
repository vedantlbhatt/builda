/**
 * One layer above every screen and below the island, for a thing that grows out of a screen and
 * has to cover the whole phone while it does: a drop opening out of its poster covers the tab bar
 * too, and a view drawn inside a tab can never cover the bar that tab sits in.
 *
 * One at a time. `show` replaces whatever was up; the shown thing closes itself by calling the
 * `hide` it is handed, after its own closing motion has finished.
 */
import React, { useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';

type Render = (hide: () => void) => React.ReactNode;

let current: { key: number; render: Render } | null = null;
let seq = 0;
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
