import { useNavigation } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

type TransitionEvent = { data?: { closing?: boolean } };
interface Listens {
  addListener(type: 'transitionEnd', callback: (e: TransitionEvent) => void): () => void;
}

/**
 * Whether this step's own arrival has landed: the native push (or fade) that brought it has
 * finished. A step that animates something of its own (the creature cutting in, the finale's
 * arrival) waits for this, because an entrance played while the page is still sliding is an
 * entrance nobody sees, and two motions at once read as a glitch.
 *
 * `waitFor` false: landed from the first frame (the step was not pushed to, or has nothing to
 * wait for). `fallbackMs`: land anyway after this long, for an arrival with no transition (a
 * deep link, an `animation: 'none'` route) that would never send the event.
 */
export function useLanded(waitFor: boolean, fallbackMs: number, onLand?: () => void): boolean {
  const navigation = useNavigation() as unknown as Listens;
  const [landed, setLanded] = useState(!waitFor);
  const onLandRef = useRef(onLand);
  onLandRef.current = onLand;

  useEffect(() => {
    if (!waitFor) return;
    let done = false;
    const land = () => {
      if (done) return;
      done = true;
      setLanded(true);
      onLandRef.current?.();
    };
    const off = navigation.addListener('transitionEnd', (e) => {
      if (!e.data?.closing) land();
    });
    const fallback = setTimeout(land, fallbackMs);
    return () => {
      off();
      clearTimeout(fallback);
    };
  }, [waitFor, fallbackMs, navigation]);

  return landed;
}
