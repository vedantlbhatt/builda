/**
 * One layer above every screen and below the island, for a thing that grows out of a screen and
 * has to cover the whole phone while it does: a drop opening out of its poster covers the tab bar
 * too, and a view drawn inside a tab can never cover the bar that tab sits in.
 *
 * One at a time. `show` replaces whatever was up; the shown thing closes itself by calling the
 * `hide` it is handed, after its own closing motion has finished.
 *
 * `closeOnNavigate`: a thing that belongs to the screen under it (a drop opened out of the wall, a
 * card's share preview) goes when that screen does. FOUND ON THE SIMULATOR: a deep link that
 * arrived while a drop was open navigated underneath it, and the drop stayed over the new page,
 * which is what a tapped notification would do. A morph window is the opposite: it pushes the
 * route itself and fades over it, so it keeps the default and closes itself.
 */
import { usePathname } from 'expo-router';
import React, { useEffect, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';

type Render = (hide: () => void) => React.ReactNode;

let current: { key: number; render: Render; closeOnNavigate: boolean; path?: string } | null = null;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const overlay = {
  show(render: Render, opts?: { closeOnNavigate?: boolean }) {
    current = { key: ++seq, render, closeOnNavigate: opts?.closeOnNavigate ?? false };
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
  const pathname = usePathname();
  useEffect(() => {
    if (!c || !c.closeOnNavigate) return;
    // The route it was opened over, taken the first time the host sees it.
    if (c.path === undefined) c.path = pathname;
    else if (c.path !== pathname && current === c) overlay.hide();
  }, [c, pathname]);
  if (!c) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <React.Fragment key={c.key}>{c.render(overlay.hide)}</React.Fragment>
    </View>
  );
}
