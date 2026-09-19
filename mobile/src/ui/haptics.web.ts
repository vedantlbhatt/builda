/**
 * The web twin of `haptics.ts`: the same five functions, doing nothing.
 *
 * A desktop has no Taptic Engine, and expo-haptics' web build calls `navigator.vibrate`, which
 * Chromium refuses until the page has had a tap and reports as a console error. MEASURED: the
 * desktop shell's capture log carried "Blocked call to navigator.vibrate" on opening a project,
 * with nobody touching anything. iOS and Android load `haptics.ts` and never see this file.
 */
import type { HapticKind } from './hapticsGate';

export { HAPTIC_KINDS, type HapticKind } from './hapticsGate';

function none(): void {}

export const select = none;
export const snap = none;
export const commit = none;
export const success = none;
export const failure = none;

export const haptics: Record<HapticKind, () => void> = { select, snap, commit, success, failure };
