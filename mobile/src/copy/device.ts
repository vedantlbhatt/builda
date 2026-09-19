/**
 * The words for where this copy of Builda is running: "this phone" on a phone, "this computer" in
 * the desktop shell and the web build, which run the phone's own screens (`src/desktop/`). And how
 * you ask a screen to try again: a phone pulls down, a desktop reloads (the shell's View menu,
 * Cmd+R on a Mac, Ctrl+R elsewhere).
 *
 * The desktop said "the next time this phone reaches Builda. Pull down to try." on a Mac with no
 * phone in it and nothing to pull. No React Native import, so the pure modules that build these
 * sentences (and their tests, which read the phone's words) can use it.
 */

export interface DeviceWords {
  /** "this phone" or "this computer", mid sentence. */
  here: string;
  /** "This phone" or "This computer", to start a sentence. */
  hereUp: string;
  /** The sentence that says how to try again. */
  tryAgain: string;
  /** The same as a clause after "then": "pull down here", or "press Cmd+R". */
  thenRetry: string;
  /** "Tap" on a phone, "Click" on a desktop, to start a sentence. */
  tap: string;
}

export function wordsFor(where: { web: boolean; mac: boolean }): DeviceWords {
  if (!where.web) return { here: 'this phone', hereUp: 'This phone', tryAgain: 'Pull down to try again.', thenRetry: 'pull down here', tap: 'Tap' };
  const key = where.mac ? 'Cmd+R' : 'Ctrl+R';
  return { here: 'this computer', hereUp: 'This computer', tryAgain: `Press ${key} to try again.`, thenRetry: `press ${key}`, tap: 'Click' };
}

const onWeb = typeof window !== 'undefined' && typeof document !== 'undefined';

function onMac(): boolean {
  if (!onWeb) return false;
  const shell = (window as { builda?: { platform?: string } }).builda?.platform;
  if (shell) return shell === 'darwin';
  return /Mac/.test(typeof navigator !== 'undefined' ? (navigator.platform ?? '') : '');
}

const WORDS = wordsFor({ web: onWeb, mac: onMac() });
export const HERE = WORDS.here;
export const HERE_UP = WORDS.hereUp;
export const TRY_AGAIN = WORDS.tryAgain;
export const THEN_RETRY = WORDS.thenRetry;
export const TAP = WORDS.tap;
