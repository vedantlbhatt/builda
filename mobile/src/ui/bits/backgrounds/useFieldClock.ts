/**
 * The clock every shader background runs on: one Reanimated frame callback that advances the
 * field at `fps` (AMBIENT 20) and stops, rather than redrawing the same frame, whenever nobody
 * can see it.
 *
 * Ported from react-bits `Backgrounds/*` (Dither, PixelBlast, Silk, Grainient, Radar, DotGrid,
 * Topography) by David Haz.
 * react-bits is MIT + Commons Clause (Copyright (c) 2026 David Haz): the notice is kept here
 * as the licence asks, and the ports are used as part of this application only; they are not
 * to be redistributed as components.
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy of this
 *   software and associated documentation files (the "Software"), to deal in the Software
 *   without restriction, including without limitation the rights to use, copy, modify,
 *   merge, publish, and distribute the Software as part of an application, website, or
 *   product, subject to the following conditions: The above copyright notice and this
 *   permission notice shall be included in all copies or substantial portions of the
 *   Software. Commons Clause Restriction: You may use this Software, including for any
 *   commercial purpose, so long as you do not sell, sublicense, or redistribute the
 *   components themselves, whether alone, in a bundle, or as a ported version.
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
 *
 * What changed in the port: every original runs its own `requestAnimationFrame` loop at the
 * display's rate and pauses on an IntersectionObserver and `document.hidden`. Here one frame
 * callback per field steps it at 20 fps (`clockStep`), and it is OFF (not idling) while the
 * screen is not focused, while the app is not active, while `paused` says so and under Reduce
 * Motion, where the field holds its `seed` frame.
 */
import { NavigationContext } from '@react-navigation/native';
import { useCallback, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useFrameCallback, useSharedValue, type FrameInfo, type SharedValue } from 'react-native-reanimated';

import { advanceField, clockStep } from './spec';

export interface FieldClock {
  /** Field seconds (from `seed`, integrating rate x speed), published at `fps` while it moves. */
  t: SharedValue<number>;
  /** Running seconds, published at `fps` while the field moves or a ripple or shock is alive. */
  now: SharedValue<number>;
  /** Running ms, every frame: what a finger's tap is stamped with (divide by 1000 for `now`). */
  realMs: SharedValue<number>;
  /** Keep publishing `now` until this running second: a ripple or a shock sets it. */
  until: SharedValue<number>;
  /** Whether the frame callback runs at all. */
  running: boolean;
}

export interface FieldClockOptions {
  /** Field seconds per running second (`RATE`), before `speed`. */
  rate: number;
  speed: number;
  fps: number;
  seed: number;
  paused?: boolean | SharedValue<boolean>;
  /** Reduce Motion: hold `seed`, run nothing. */
  still: boolean;
  /** A finger can start a ripple or a shock, so the clock must run even when the field is still. */
  interactive?: boolean;
}

/**
 * Whether this screen is the focused one. `useIsFocused` throws outside a navigator (a sheet
 * portal, a test harness); a background outside one simply counts as focused.
 */
export function useScreenFocused(): boolean {
  const navigation = useContext(NavigationContext);
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!navigation) return () => {};
      const offFocus = navigation.addListener('focus', onChange);
      const offBlur = navigation.addListener('blur', onChange);
      return () => {
        offFocus();
        offBlur();
      };
    },
    [navigation],
  );
  const read = useCallback(() => (navigation ? navigation.isFocused() : true), [navigation]);
  return useSyncExternalStore(subscribe, read, read);
}

/** Whether the app is in the foreground (a field under the app switcher draws for nobody). */
export function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}

export function useFieldClock({ rate, speed, fps, seed, paused, still, interactive = false }: FieldClockOptions): FieldClock {
  const focused = useScreenFocused();
  const active = useAppActive();
  const pausedSV = typeof paused === 'object' && paused !== null ? paused : undefined;
  const pausedFlag = paused === true;
  const moving = !still && rate * speed > 0;
  // A field that neither moves nor answers a finger has nothing to count: no callback at all.
  const running = focused && active && !still && !pausedFlag && (moving || interactive);
  const k = rate * speed;

  const t = useSharedValue(seed);
  const field = useSharedValue(seed);
  const now = useSharedValue(0);
  const realMs = useSharedValue(0);
  const since = useSharedValue(0);
  const until = useSharedValue(-1);

  // Reduce Motion, and a new seed, show the seed frame; speed 0 holds whatever frame it is on.
  useEffect(() => {
    field.value = seed;
    t.value = seed;
  }, [seed, field, t]);
  useEffect(() => {
    if (!still) return;
    field.value = seed;
    t.value = seed;
  }, [still, seed, field, t]);

  const onFrame = useCallback(
    (info: FrameInfo) => {
      'worklet';
      if (pausedSV !== undefined && pausedSV.value) return;
      const live = moving || realMs.value / 1000 <= until.value;
      const tick = clockStep({ real: realMs.value, since: since.value }, info.timeSincePreviousFrame, fps, live);
      realMs.value = tick.real;
      since.value = tick.since;
      if (moving) field.value = advanceField(field.value, tick.dt, k, 1);
      if (!tick.publish) return;
      if (moving) t.value = field.value;
      now.value = tick.real / 1000;
    },
    [pausedSV, moving, fps, k, t, field, now, realMs, since, until],
  );
  const callback = useFrameCallback(onFrame, false);
  useEffect(() => {
    callback.setActive(running);
  }, [callback, running, onFrame]);

  return { t, now, realMs, until, running };
}
