/**
 * The navigation rules that do not need React or expo: the onboarding gate's decision, what a
 * dev-auth link asks for, and the local name. Pure, so `__tests__/nav.test.ts` pins every one
 * in bun.
 *
 * The side-effecting halves live beside this file: `onboarding.ts` (the gate store) and
 * `name.ts` (the name that waits for a sign-in).
 */

/**
 * The onboarding flag. `device.` because it describes this install, not the person signed in
 * to it: `cache.clear()` on sign-out keeps every `device.` key, so signing out does not send
 * someone back through onboarding on the next launch.
 */
export const ONBOARDED_KEY = 'device.onboarded.v1';

/** The name typed during onboarding. Kept locally until there is an account to send it to. */
export const LOCAL_NAME_KEY = 'profile.name.v1';

/** '1' while the local name has not yet reached `PATCH /v1/users/me`. */
export const NAME_PENDING_KEY = 'profile.name.pending.v1';

/**
 * Onboarding asks for 1 to 24 characters (DESIGN-DIRECTION section 4: the name is the
 * headline of the step and it has to fit on it). The server allows 40 (`MAX_DISPLAY_NAME`),
 * so anything this accepts the server accepts too.
 */
export const NAME_MAX = 24;

/**
 * Has this install been onboarded?
 *
 * `stored` is the flag as the kv holds it. '1' and '0' are answers. Absent means the flag was
 * never written, which is every install that predates onboarding: those people already signed
 * in and used the app, so a signed-in install with no flag counts as onboarded and is never
 * shown the flow it skipped. A signed-out install with no flag is a fresh one.
 */
export function decideOnboarded(stored: string | null, signedIn: boolean): boolean {
  if (stored === '1') return true;
  if (stored === '0') return false;
  return signedIn;
}

/** The name the way it is stored and sent: trimmed, inner runs of whitespace collapsed. */
export function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/**
 * Why `raw` cannot be the name yet, or null when it can. Empty is "nothing typed yet", not a
 * complaint: the step disables its button rather than printing an error at an empty field.
 */
export function nameProblem(raw: string): 'empty' | 'too_long' | null {
  const n = normalizeName(raw);
  if (n.length === 0) return 'empty';
  if ([...n].length > NAME_MAX) return 'too_long';
  return null;
}

// ----------------------------------------------------------------------------- tabs

/**
 * The tabs, in bar order, with the one title each is known by (bar label and back label).
 *
 * Drops sits in the MIDDLE, between what you did and where you did it, because it is the only
 * tab you arrive at from outside the app: you share a reel in Instagram, Builda opens, and the
 * thumb is already in the centre of the bar. Five is the ceiling; a sixth would push the labels
 * to two lines at the Dynamic Type sizes this bar does not scale.
 */
export const TABS = [
  { name: 'now', title: 'Now' },
  { name: 'sessions', title: 'Sessions' },
  { name: 'drops', title: 'Drops' },
  { name: 'projects', title: 'Projects' },
  { name: 'you', title: 'You' },
] as const;
export type TabName = (typeof TABS)[number]['name'];

/**
 * The title for the tab a route name points at; the first tab when there is none yet (the
 * tabs navigator has not reported its state on its first render).
 *
 * Used as the tabs route's title in the root stack, which iOS shows as the back label on
 * every screen pushed over the tabs: "< Sessions" from a session opened in Sessions, never
 * the group's file name "(tabs)".
 */
export function tabTitle(name: string | undefined): string {
  return TABS.find((t) => t.name === name)?.title ?? TABS[0].title;
}

// ----------------------------------------------------------------------- onboarding

/** The steps, in order. Each is `app/onboarding/<step>.tsx`. */
export const ONBOARDING_STEPS = ['hello', 'name', 'creature', 'tools', 'connect', 'notify'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export type OnboardingPath = `/onboarding/${OnboardingStep}`;

/** The step after `step`, or null after the last one (which finishes instead of pushing). */
export function nextOnboardingStep(step: OnboardingStep): OnboardingPath | null {
  const i = ONBOARDING_STEPS.indexOf(step);
  const next = ONBOARDING_STEPS[i + 1];
  return next ? `/onboarding/${next}` : null;
}

/** 1-based position, for "2 of 6". */
export function onboardingPosition(step: OnboardingStep): { n: number; of: number } {
  return { n: ONBOARDING_STEPS.indexOf(step) + 1, of: ONBOARDING_STEPS.length };
}

/**
 * The dev tools: the root layout's `__DEV__` group, which exists in either state of the gate
 * (and in no release build).
 */
export const DEV_ROUTES: ReadonlySet<string> = new Set(['dev-auth', 'dev-gallery', 'debug/live']);

/**
 * Where a link that arrives while onboarding is still open should go, or null to drop it.
 *
 * Until the gate opens, the app half of the route tree does not exist: a link into it can only
 * fail (React Navigation logs that it could not apply the screen, and nothing moves). So it is
 * dropped here instead, except for the ones that mean something mid-onboarding: onboarding's
 * own steps, the dev routes, and a pairing link, which is exactly what the Mac shows a person
 * who has just installed the app. That one goes to the connect step with its code, rather than
 * losing the code to a route that does not exist yet.
 */
export function pathWhileOnboarding(path: string): string | null {
  const m = /^(?:[a-z][a-z0-9+.-]*:\/{2,3})?\/*([^?#\s]*?)\/*(\?[^#]*)?(?:#.*)?$/i.exec(path.trim());
  if (!m) return null;
  const route = (m[1] ?? '').toLowerCase();
  if (route === 'onboarding' || route.startsWith('onboarding/')) return path;
  if (DEV_ROUTES.has(route)) return path;
  if (route === 'pair') {
    const code = new URLSearchParams((m[2] ?? '').replace(/^\?/, '')).get('code')?.trim();
    return code ? `/onboarding/connect?code=${encodeURIComponent(code)}` : '/onboarding/connect';
  }
  return null;
}

// -------------------------------------------------------------------------- wrapped

/** The fifteen Paxel questions (brief section C), one card each. */
export const WRAPPED_CARDS = 15;

/** `?card=` as a card number, 1 to 15. Anything missing or out of range opens on the first. */
export function clampCard(raw: string | undefined): number {
  const s = (raw ?? '').trim();
  if (!/^\d+$/.test(s)) return 1;
  const n = Number(s);
  return n >= 1 && n <= WRAPPED_CARDS ? n : 1;
}

// ------------------------------------------------------------------------- dev auth

/** What `builder://dev-auth?...` asked for, validated. */
export interface DevAuthRequest {
  /** Both tokens, or null when the link carried none. */
  tokens: { access: string; refresh: string } | null;
  /** true: mark onboarding done. false: reset it. null: leave it alone. */
  onboarded: boolean | null;
  /** Clear the stored tokens and the cache first, the way Settings signs out. */
  signOut: boolean;
  /** Where to land afterwards, an in-app path; null for the default. */
  to: string | null;
  /** A link that asked for something this cannot do, in words. Nothing is applied. */
  problem: string | null;
}

type Params = Record<string, string | string[] | undefined>;

function one(p: Params, key: string): string | undefined {
  const v = p[key];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' ? s : undefined;
}

function flag(p: Params, key: string): boolean {
  const v = one(p, key);
  return v === '1' || v === 'true';
}

/**
 * Parse the dev-auth link's params (as `useLocalSearchParams` hands them over).
 *
 * `access` and `refresh` travel together or not at all: one without the other would store a
 * half sign-in that `isSignedIn` reports as signed out and the first refresh would clear. When
 * both `reset=1` and `onboarded=1` are present the link asked for two opposite things, and
 * that is refused rather than guessed. `to` must be an in-app path (a leading slash, no
 * scheme), so a link cannot bounce the app somewhere outside itself.
 */
export function parseDevAuth(p: Params): DevAuthRequest {
  const access = one(p, 'access')?.trim() ?? '';
  const refresh = one(p, 'refresh')?.trim() ?? '';
  const reset = flag(p, 'reset');
  const done = flag(p, 'onboarded');
  const signOut = flag(p, 'signout');
  const toRaw = one(p, 'to')?.trim() ?? '';

  const base: DevAuthRequest = { tokens: null, onboarded: null, signOut, to: null, problem: null };
  if ((access === '') !== (refresh === '')) {
    return { ...base, problem: 'access and refresh have to come together' };
  }
  if (reset && done) {
    return { ...base, problem: 'reset=1 and onboarded=1 ask for opposite things' };
  }
  if (toRaw !== '' && !isInAppPath(toRaw)) {
    return { ...base, problem: 'to has to be an in-app path such as /wrapped?card=7' };
  }
  return {
    ...base,
    tokens: access ? { access, refresh } : null,
    onboarded: reset ? false : done ? true : null,
    to: toRaw || null,
  };
}

/** `/wrapped?card=7` yes; `//evil.example`, `https://...`, `wrapped` no. */
export function isInAppPath(s: string): boolean {
  return /^\/(?!\/)[^\s:]*$/.test(s);
}

/**
 * Where dev-auth lands when the link did not say: the first tab once onboarded, the first
 * onboarding step otherwise.
 */
export function devAuthLanding(onboarded: boolean, to: string | null): string {
  if (to) return to;
  return onboarded ? '/now' : '/onboarding/hello';
}
