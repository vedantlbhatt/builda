import { gateSnapshot } from '../src/nav/gateSnapshot';
import { pathWhileOnboarding } from '../src/nav/rules';

/**
 * Rewrites incoming system URLs before expo-router routes them.
 *
 * The Google redirect (`builder://auth/google#id_token=...`) is consumed by the Linking
 * listener in `_layout.tsx`; there is no `auth/google` route, so without this the router
 * would show "Unmatched route" over the top of a successful sign-in.
 *
 * `builder://session/<id>?recap=1` — the link in a completion push's data, the one the Mac
 * opens, the one a share sheet carries — routes to the session detail with the recap sheet
 * raised. The router would match `/session/<id>` on its own; the rewrite is what makes the
 * shapes people actually type or paste land on the same screen: the `/recap` suffix form,
 * a stray `session` without the leading slash, `builder:///` with three slashes.
 *
 * The root and two renamed routes are aliased (`aliasPath`): the app has no `/` route, its
 * first tab is `/now`, and on iOS a plain launch from the home screen arrives here as the root
 * URL (`builder:///`, expo-router's `getRootURL`), so that is where it lands.
 *
 * While onboarding is open (`src/nav/gateSnapshot.ts`), a link that arrives with the app
 * running only goes where a route exists (`pathWhileOnboarding`): onboarding, the dev routes,
 * and a pairing link, which becomes the connect step with its code. Anything else is dropped
 * (an empty string tells expo-router to ignore the URL). A link that LAUNCHES the app arrives
 * before the gate has been read and is passed through; the root stack's guard then filters it
 * down to onboarding.
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string {
  const next = path.includes('auth/google') ? '/settings' : recapPath(path) ?? aliasPath(path) ?? path;
  if (!initial && gateSnapshot() === false) return pathWhileOnboarding(next) ?? '';
  return next;
}

/**
 * Paths that moved, as the route they are now; null for anything else. Pure, so bun can pin
 * it. The query string is kept.
 *
 *   ``, `/`, `builder://`, `builder:///`  ->  `/now`         (the first tab; there is no index)
 *   `/profile`                            ->  `/you`         (the Profile screen became the You tab)
 *   `/onboarding`                         ->  `/onboarding/hello`
 */
export function aliasPath(path: string): string | null {
  const m = /^(?:[a-z][a-z0-9+.-]*:\/{2,3})?\/*([^?#\s]*?)\/*(\?[^#]*)?(?:#.*)?$/i.exec(path.trim());
  if (!m) return null;
  const route = (m[1] ?? '').toLowerCase();
  const qs = m[2] && m[2] !== '?' ? m[2] : '';
  const target = ALIASES.get(route);
  return target ? `${target}${qs}` : null;
}

// A Map, not an object literal: `builder://constructor` must not find Object.prototype's.
const ALIASES: ReadonlyMap<string, string> = new Map([
  ['', '/now'],
  ['index', '/now'],
  ['profile', '/you'],
  ['onboarding', '/onboarding/hello'],
]);

/**
 * The normalised route for a session link, or null when `path` is not one. Pure, so bun
 * can pin it. Accepts the path expo-router hands over (`/session/abc?recap=1`), the same
 * without the leading slash, the `/session/abc/recap` spelling, and the full URL.
 */
export function recapPath(path: string): `/session/${string}` | null {
  const m = /^(?:[a-z][a-z0-9+.-]*:\/{2,3})?\/*session\/([^/?#\s]+)(\/recap\/?)?(?:\?([^#]*))?(?:#.*)?$/i.exec(
    path.trim()
  );
  if (!m?.[1]) return null;
  const id = m[1];
  const suffixRecap = Boolean(m[2]);
  const query = new URLSearchParams(m[3] ?? '');
  const recap = suffixRecap || query.get('recap') === '1';
  query.delete('recap');
  if (recap) query.set('recap', '1');
  const qs = query.toString();
  return `/session/${id}${qs ? `?${qs}` : ''}`;
}
