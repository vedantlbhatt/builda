/**
 * The React Native plumbing the effects share: a touch observer that never takes a touch
 * away from anything, and the rule for when an ambient effect may run.
 *
 * Not a port: no react-bits code here.
 */
import { NavigationContext } from '@react-navigation/native';
import { useContext, useEffect, useMemo, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';

/**
 * Worklet callbacks for a finger on an element, in the element's own points. Each runs on
 * the UI thread; call `runOnJS` from inside one to reach React.
 */
export interface TouchHandlers {
  onDown?: (x: number, y: number) => void;
  onMove?: (x: number, y: number) => void;
  /** The last finger lifted at (`x`, `y`). */
  onUp?: (x: number, y: number) => void;
  /** The system took the touch (a scroll began, a sheet came up): treat it as never pressed. */
  onCancel?: () => void;
}

/**
 * A gesture that watches the first finger on an element and never activates, so it never
 * takes the touch from a `Pressable`, a `Button` or a scroll view inside or around it. That
 * is what lets ClickSpark, GlareHover and Magnet wrap the kit's own buttons without a second
 * press path: the button keeps its press, haptic and accessibility, the effect only watches.
 *
 * Put the result in a `GestureDetector` around the element. `deps` rebuild the gesture; keep
 * them to shared values and plain numbers (a gesture rebuilt while a finger is down is lost).
 */
export function useTouchObserver(handlers: TouchHandlers, enabled: boolean, deps: readonly unknown[]) {
  const { onDown, onMove, onUp, onCancel } = handlers;
  return useMemo(
    () =>
      Gesture.Manual()
        .enabled(enabled)
        .shouldCancelWhenOutside(false)
        .onTouchesDown((e) => {
          'worklet';
          const t = e.changedTouches[0];
          if (t && e.numberOfTouches <= 1 && onDown) onDown(t.x, t.y);
        })
        .onTouchesMove((e) => {
          'worklet';
          const t = e.allTouches[0];
          if (t && onMove) onMove(t.x, t.y);
        })
        .onTouchesUp((e, manager) => {
          'worklet';
          // On iOS `numberOfTouches` is the fingers still down after this one lifted.
          if (e.numberOfTouches > 0) return;
          const t = e.changedTouches[0];
          if (t && onUp) onUp(t.x, t.y);
          manager.fail();
        })
        .onTouchesCancelled((_e, manager) => {
          'worklet';
          if (onCancel) onCancel();
          manager.fail();
        }),
    // The handlers are worklets built by the caller from `deps`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, ...deps],
  );
}

/**
 * Whether an ambient effect may draw right now (DESIGN-V2 3.3, pause rules): the screen it is
 * on is focused and the app is in the foreground, and the caller has not paused it (off
 * screen, scrolled away). Outside a navigator (a gallery, a test host) focus is assumed.
 */
export function useEffectActive(paused = false): boolean {
  const navigation = useContext(NavigationContext);
  const [focused, setFocused] = useState<boolean>(() => navigation?.isFocused?.() ?? true);
  useEffect(() => {
    if (!navigation) return;
    setFocused(navigation.isFocused());
    const offFocus = navigation.addListener('focus', () => setFocused(true));
    const offBlur = navigation.addListener('blur', () => setFocused(false));
    return () => {
      offFocus();
      offBlur();
    };
  }, [navigation]);

  const [foreground, setForeground] = useState<boolean>(() => AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => setForeground(s === 'active'));
    return () => sub.remove();
  }, []);

  return !paused && focused && foreground;
}
