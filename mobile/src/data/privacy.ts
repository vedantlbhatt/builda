/**
 * The two opt in switches and the Lock Screen switch, as Settings drives them.
 *
 * Contract v4 has exactly three places where words from a person's machine can reach the
 * server, and two of them are switched here (docs/overnight-integration.md 2.3 and 2.4):
 *
 *   - QUOTES: up to three prompts, verbatim, for the Wrapped cards that quote them. Sent
 *     only when this switch AND `--quotes` on the machine both say yes.
 *   - FILE NAMES: the basename of each file a running session touches, shown only on that
 *     session's screen.
 *
 * Both start OFF, and turning either off DELETES what it let through: the server does it in
 * the same request, and this phone clears its own copy too: the cached file names
 * (`cache.forgetLiveNames`) and any quote an older build saved with the builder profile
 * (`builderCache.forgetCachedQuotes`). The third switch, Show details on Lock Screen, is this
 * phone's alone (`cache.ts`).
 *
 * Pure apart from the calls it is handed, so `__tests__/privacyToggles.test.ts` runs it
 * without React Native.
 */

import { count } from '../copy/numbers';
import { ApiError, type Api, type PrivacyPrefs, type PrivacyPrefsResult } from './api';

/** Both off until the person turns one on (the migration's defaults, 0020). */
export const DEFAULT_PRIVACY_PREFS: Readonly<PrivacyPrefs> = { quotes: false, live_names: false };

export type PrivacySwitch = keyof PrivacyPrefs;

// ------------------------------------------------------------------ the words

/** Settings > Privacy, the quotes row (the design's own words, section 2.4). */
export const QUOTES_TITLE = 'Quote my prompts on my cards';
export const QUOTES_DETAIL =
  'Up to three of your prompts, quoted on your Wrapped cards. Only you can see them. Turning this off deletes them.';
/** The machine half of the double opt in, said under the row while it is on. */
export const QUOTES_MACHINE_HINT = 'Your Mac sends them only when you also run:';
export const QUOTES_MACHINE_COMMAND = 'python -m capture report --quotes';

/** Settings > Privacy, the file names row. */
export const FILE_NAMES_TITLE = 'File names';
export const FILE_NAMES_DETAIL =
  "The names of the files a running session touches, shown on that session's screen and nowhere else. Only you can see them. Turning this off deletes them.";

/** Settings > Privacy, this phone's Lock Screen row (DESIGN-DIRECTION 7.2). */
export const LOCK_SCREEN_TITLE = 'Show details on Lock Screen';
export const LOCK_SCREEN_ON =
  'The repository, when it is public, and what the session is doing, on the Lock Screen and in the Dynamic Island, where anyone holding your phone can read them.';
/**
 * What the card says with the switch off, as the simulator drew it (integration, 2026-09-13):
 * "Builda · 1 running", the tool and the elapsed timer, with no repository, sentence, verdict,
 * count or alert (`surface.withoutDetails`). The copy promises exactly that and no less.
 */
export const LOCK_SCREEN_OFF =
  'The Lock Screen and the Dynamic Island say only Builda, how many sessions are running, the tool and how long it has run: no repository and nothing about what it is doing.';

/** What a switch's row says under its title. */
export function lockScreenDetail(on: boolean): string {
  return on ? LOCK_SCREEN_ON : LOCK_SCREEN_OFF;
}

/** Settings > Privacy, this phone's Live Activities row (`cache.getLiveActivities`). */
export const LIVE_ACTIVITIES_TITLE = 'Live Activities';
export const LIVE_ACTIVITIES_ON =
  'A card on your Lock Screen and in the Dynamic Island for each running session. Turning this off takes down any card showing now.';
export const LIVE_ACTIVITIES_OFF = 'No cards on your Lock Screen or in the Dynamic Island.';

export function liveActivitiesDetail(on: boolean): string {
  return on ? LIVE_ACTIVITIES_ON : LIVE_ACTIVITIES_OFF;
}

/**
 * The line Settings shows after a switch moved. Turning quotes off says how many the
 * server deleted, and says nothing about a count the server did not send: an older server
 * that omits it is not a server that deleted none.
 */
export function toggledLine(key: PrivacySwitch, on: boolean, result?: Pick<PrivacyPrefsResult, 'quotes_deleted'> | null): string {
  if (key === 'quotes') {
    if (on) return `Quotes on. Your Mac sends them the next time you run ${QUOTES_MACHINE_COMMAND}.`;
    const k = result?.quotes_deleted;
    if (typeof k !== 'number') return 'Quotes off. The server deletes any it held.';
    if (k === 0) return 'Quotes off. None were stored, so there was nothing to delete.';
    return `Quotes off. ${count(k, 'quote')} deleted.`;
  }
  return on
    ? 'File names on. They show on a running session once its machine sends them.'
    : 'File names off, and deleted from the server and from this phone.';
}

// ------------------------------------------------------------------ the calls

/**
 * The switches as the account holds them, or null when this server predates them (a 404:
 * the rows are hidden rather than shown as off, because "off" would be a claim about a
 * server that has no switch at all). Any other failure is thrown for the screen to say.
 */
export async function loadPrivacyPrefs(api: Pick<Api, 'privacyPrefs'>): Promise<PrivacyPrefs | null> {
  try {
    const p = await api.privacyPrefs();
    return { quotes: p.quotes === true, live_names: p.live_names === true };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export interface ToggleOutcome {
  /** The switches as they now stand: the server's answer, or the old ones on a failure. */
  prefs: PrivacyPrefs;
  /** The line to show under the section. */
  message: string;
  ok: boolean;
}

/**
 * Move one switch. Sends ONLY that key (the other is never rewritten), and when a switch goes
 * off, clears this phone's own copy as well: the cached names (`forgetLiveNames`) for file
 * names, the saved builder profile's quotes (`forgetQuotes`) for quotes. So turning either off
 * deletes what it let through everywhere it was. On a failure nothing changes and the message
 * says why. FOUND IN THE ADVERSARIAL REVIEW (2026-09-13): quotes off cleared nothing here.
 */
export async function setPrivacySwitch(
  api: Pick<Api, 'setPrivacyPrefs'>,
  current: PrivacyPrefs,
  key: PrivacySwitch,
  on: boolean,
  forgetLiveNames: () => Promise<unknown>,
  forgetQuotes: () => Promise<unknown>
): Promise<ToggleOutcome> {
  try {
    const result = await api.setPrivacyPrefs({ [key]: on });
    if (key === 'live_names' && !on) await forgetLiveNames();
    if (key === 'quotes' && !on) await forgetQuotes();
    const prefs = { quotes: result.quotes === true, live_names: result.live_names === true };
    return { prefs, message: toggledLine(key, on, result), ok: true };
  } catch (e) {
    const why = e instanceof Error ? e.message : 'try again';
    return { prefs: current, message: `Nothing changed: ${why}`, ok: false };
  }
}
