/**
 * The island's one store. Anything in the app that has news posts it here, and the island
 * decides whether it is the thing to show (`model.lead`). This is the app's ONE voice: there is
 * no toast, banner or snackbar anywhere else, because two places that say "done" is how an app
 * starts to sound like a notification centre.
 *
 * Plain module state and `useSyncExternalStore`, like `theme/accent.tsx`: every screen that asks
 * gets the same list, and the island re-renders only when the list changes.
 */
import { useSyncExternalStore } from 'react';

import { HOLD_MS, shownActivities, type Activity } from './model';

let items: Activity[] = [];
/**
 * Whether the drawn island shows the standing states (a hardware island to sit beside) or only
 * the passing beats (a desktop window, a phone with a notch or none). Set by `Island.tsx`.
 */
let standing = true;
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
const expandListeners = new Set<() => void>();
let touring = false;
/** True while a tour step runs: its posts are the tour's own and go straight through. */
let tourStep = false;
const heldKinds = new Map<Activity['kind'], Activity[]>();
/**
 * What the live feeds said while the tour played, in order, applied when it ends. FOUND IN REVIEW:
 * a tracker's post landed in the tour's list and was wiped at its end, or outlived it with no timer.
 */
const heldOps: ({ op: 'post'; a: Activity; holdMs?: number } | { op: 'clear'; id: string })[] = [];
/** When each held activity takes itself down (epoch ms), so a tour can put it back with what is left. */
const expiry = new Map<string, number>();
/** Ids already shown once, so a poll that sees the same finished session twice says it once. */
const said = new Set<string>();

function emit() {
  for (const l of listeners) l();
}

export const island = {
  /**
   * Put an activity up, or replace the one with the same id. A transient kind (shipped, notice)
   * takes itself down after its hold; pass `holdMs` to override, or 0 to keep it up.
   */
  post(a: Activity, holdMs?: number) {
    if (touring && !tourStep) {
      heldOps.push({ op: 'post', a, holdMs });
      return;
    }
    const i = items.findIndex((x) => x.id === a.id);
    items = i >= 0 ? items.map((x, j) => (j === i ? a : x)) : [...items, a];
    const hold = holdMs ?? HOLD_MS[a.kind];
    const old = timers.get(a.id);
    if (old) clearTimeout(old);
    timers.delete(a.id);
    expiry.delete(a.id);
    if (hold && hold > 0) {
      timers.set(a.id, setTimeout(() => island.clear(a.id), hold));
      expiry.set(a.id, Date.now() + hold);
    }
    emit();
  },

  /** Post once per id for the life of the app: a finished session is news the first time. */
  once(a: Activity, holdMs?: number) {
    if (said.has(a.id)) return;
    said.add(a.id);
    island.post(a, holdMs);
  },

  clear(id: string) {
    if (touring && !tourStep) {
      heldOps.push({ op: 'clear', id });
      return;
    }
    const t = timers.get(id);
    if (t) clearTimeout(t);
    timers.delete(id);
    expiry.delete(id);
    if (!items.some((x) => x.id === id)) return;
    items = items.filter((x) => x.id !== id);
    emit();
  },

  /**
   * While the island tour plays (Settings), the live feeds' replacements are held back and applied
   * when it ends: FOUND ON THE SIMULATOR, the minute poll put the real session into the middle of
   * the tour's made up crew.
   */
  setTouring(on: boolean) {
    touring = on;
    if (!on) {
      const held = [...heldKinds.entries()];
      heldKinds.clear();
      for (const [kind, next] of held) island.replaceKind(kind, next);
      const ops = heldOps.splice(0);
      for (const o of ops) {
        if (o.op === 'post') island.post(o.a, o.holdMs);
        else island.clear(o.id);
      }
    }
  },

  /** Run one step of the tour: what it posts and clears is the tour's own. */
  runTourStep(fn: () => void) {
    tourStep = true;
    try {
      fn();
    } finally {
      tourStep = false;
    }
  },

  /** What is up now, each with when it takes itself down (null: it stays), for a tour to put back. */
  saveForTour(): { a: Activity; until: number | null }[] {
    return items.map((a) => ({ a, until: expiry.get(a.id) ?? null }));
  },

  /** Take everything down (signing out: nothing the last account's feeds said stays up). */
  clearAll() {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    expiry.clear();
    heldOps.length = 0;
    heldKinds.clear();
    items = [];
    emit();
  },

  /** Replace every activity of one kind at once (the crew, the waiting runs), keeping the rest. */
  replaceKind(kind: Activity['kind'], next: Activity[]) {
    if (touring) {
      heldKinds.set(kind, next);
      return;
    }
    const kept = items.filter((x) => x.kind !== kind);
    const same =
      kept.length + next.length === items.length &&
      next.every((n) => items.some((x) => x.id === n.id && JSON.stringify(x) === JSON.stringify(n)));
    if (same) return;
    items = [...kept, ...next];
    emit();
  },

  snapshot(): Activity[] {
    return items;
  },

  /** What the island can actually show on this device (`model.shownActivities`). */
  visible(): Activity[] {
    return shownActivities(items, standing);
  },

  setShowsStanding(on: boolean) {
    standing = on;
  },

  /**
   * Open the island as if a finger had. For the demo cycle and the debug screen only: in use,
   * expanded is always a person's decision (model.ts `restingMode`).
   */
  expand() {
    for (const l of expandListeners) l();
  },

  onExpand(fn: () => void): () => void {
    expandListeners.add(fn);
    return () => expandListeners.delete(fn);
  },

  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /** Tests only. */
  reset() {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    expiry.clear();
    items = [];
    said.clear();
    emit();
  },
};

export function useIslandActivities(): Activity[] {
  return useSyncExternalStore(island.subscribe, island.snapshot, island.snapshot);
}
