/**
 * Web stand-in for React Native's `useWindowDimensions`, resolved ONLY on web: `metro.config.js`
 * points react-native-web's own `./exports/useWindowDimensions` here, so every
 * `import { useWindowDimensions } from 'react-native'` in the app gets this one. Native builds
 * never see the file.
 *
 * WHY. Forty screens size themselves from the window's width (a strip is the width less two
 * gutters, a figure is fitted to it). On a phone the screen IS the window. In the desktop layout
 * a screen is a pane beside the sidebar and a list, so the window's width is wrong by the width
 * of everything beside it and every one of those screens ran off its own right edge. A pane
 * says how big it is through `PaneSize`, and inside one this hook answers with the pane's size;
 * outside any pane (the phone layout on web, the sidebar itself) it is exactly
 * react-native-web's hook. The layout rule that needs the REAL window (phone or desktop) reads
 * `useWindowSize`.
 */
import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Dimensions, type ScaledSize } from 'react-native';

/** The pane a subtree is laid out in, in points, and where its left edge sits in the window; null outside the desktop layout. */
const PaneContext = createContext<{ width: number; height: number; x: number } | null>(null);

/** Tell a subtree how big its pane is and where it starts; `null` is no pane (the window itself), same tree. */
export function PaneSize({ size, children }: { size: { width: number; height: number; x?: number } | null; children?: ReactNode }) {
  const w = size?.width;
  const h = size?.height;
  const x = size?.x ?? 0;
  // The same object while the numbers hold, so a re-render of the frame is not a re-render of
  // every screen in the pane.
  const value = useMemo(() => (w === undefined || h === undefined ? null : { width: w, height: h, x }), [w, h, x]);
  return createElement(PaneContext.Provider, { value }, children);
}

/** Where the pane this is in starts, from the window's left edge: 0 outside the desktop layout. */
export function usePaneX(): number {
  return useContext(PaneContext)?.x ?? 0;
}

/** The browser window, whatever pane this is in: react-native-web's own hook, unchanged. */
export function useWindowSize(): ScaledSize {
  const [dims, setDims] = useState(() => Dimensions.get('window'));
  useEffect(() => {
    function handleChange({ window }: { window: ScaledSize }) {
      if (window != null) setDims(window);
    }
    const sub = Dimensions.addEventListener('change', handleChange);
    // A change between `get` in render and the listener here would be missed otherwise.
    setDims(Dimensions.get('window'));
    return () => sub?.remove?.();
  }, []);
  return dims;
}

export default function useWindowDimensions(): ScaledSize {
  const pane = useContext(PaneContext);
  const win = useWindowSize();
  return pane ? { ...win, width: pane.width, height: pane.height } : win;
}
