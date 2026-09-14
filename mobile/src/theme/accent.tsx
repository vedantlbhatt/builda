/**
 * `useAccent()`: Builda's accent, the builder's creature's hue (the rule is `accentRule.ts`).
 *
 * THE API (other screens import it; keep it stable):
 *   useAccent(): AccentState        { animal, name, ink, text, partner, fill, onFill, light, ready }
 *   ThemeProvider                   optional root wrapper that starts the first read early
 *   refreshAccent(): Promise<void>  read the kv again (a screen's focus, a sign in)
 *   setAccentCreature(animal)       repaint at once, for a creature picker, before its kv write
 *
 * One small store under the provider: any screen can ask for the accent whether or not the tree
 * is wrapped, and every screen that asks gets the same object and re-renders together when it
 * changes. It reads the kv once when the first screen asks, and again:
 *   - when the app comes back to the front,
 *   - when a screen calls `refreshAccent()` (the You pages do on focus, so returning from the
 *     creature picker repaints the hero, the links and the tab at once),
 *   - or at once, with no read, when a picker calls `setAccentCreature(animal)`.
 *
 * Until the first read lands the accent is the default creature's and `ready` is false, so a
 * screen that paints a whole band in the accent can wait one read rather than flash the wrong hue.
 */
import React, { useSyncExternalStore, type ReactNode } from 'react';
import { AppState } from 'react-native';

import * as cache from '../data/cache';
import { ANIMAL_KEY, BUILDER_PROFILE_KEY } from '../onboarding/keys';
import { DEFAULT_ANIMAL, type Animal } from '../pixel/animals';
import { accentAnimal, accentOf, type Accent } from './accentRule';

export type { Accent } from './accentRule';

export interface AccentState extends Accent {
  /** False until the saved creature has been read once. */
  ready: boolean;
}

let current: AccentState = { ...accentOf(DEFAULT_ANIMAL), ready: false };
let reading: Promise<void> | null = null;
let watchingApp = false;
const listeners = new Set<() => void>();

function publish(animal: Animal): void {
  if (current.ready && current.animal === animal) return;
  current = { ...accentOf(animal), ready: true };
  for (const l of listeners) l();
}

/** Read the chosen creature and the saved archetype again, and repaint if the accent moved. */
export function refreshAccent(): Promise<void> {
  if (reading) return reading;
  reading = (async () => {
    try {
      const [chosen, builder] = await Promise.all([cache.getKv(ANIMAL_KEY), cache.getKv(BUILDER_PROFILE_KEY)]);
      publish(accentAnimal(chosen, builder));
    } catch {
      // An unreadable kv keeps the accent it has; the default is a real answer.
      publish(current.animal);
    } finally {
      reading = null;
    }
  })();
  return reading;
}

/** For a creature picker: repaint now, before the kv write has been read back. */
export function setAccentCreature(animal: Animal): void {
  publish(animal);
}

/**
 * The longest a first read may take before the accent is declared ready anyway, on the creature
 * it has. The root draws nothing until `ready`, so a kv read that never came back would otherwise
 * be a black screen with no error anywhere.
 */
export const READY_WITHIN_MS = 1500;
let readyTimer: ReturnType<typeof setTimeout> | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!current.ready) {
    void refreshAccent();
    if (!readyTimer) {
      readyTimer = setTimeout(() => {
        readyTimer = null;
        if (!current.ready) publish(current.animal);
      }, READY_WITHIN_MS);
    }
  }
  if (!watchingApp) {
    watchingApp = true;
    AppState.addEventListener('change', (s) => {
      if (s === 'active') void refreshAccent();
    });
  }
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): AccentState {
  return current;
}

/**
 * The builder's accent, and `ready` once the saved creature has been read. Every screen that
 * calls it re-renders together when the accent moves. Works with or without `ThemeProvider`.
 *
 *   const accent = useAccent();
 *   <SymbolView tintColor={accent.ink} />            a mark, a figure, a tab's active tint
 *   <Text style={{ color: accent.text }} />          the hue as a label
 *   <Band hue={accent} ... />                        a chapter band (it takes ink, partner, light)
 */
export function useAccent(): AccentState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * Optional, at the root: starts the first read as the app opens, so the first screen that paints
 * in the accent already has it. It adds no context; `useAccent()` reads the same store anywhere.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  useAccent();
  return <>{children}</>;
}
