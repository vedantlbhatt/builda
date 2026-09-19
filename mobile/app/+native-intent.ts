import { gateSnapshot } from '../src/nav/gateSnapshot';
import { pathWhileOnboarding } from '../src/nav/rules';
import { isSafeId } from '../src/push/route';

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
 * `builder://drops?open=<id>` — a tapped drop banner, which opens that drop (`/drop/<id>`), over
 * whatever was on screen, as a session's banner opens its session.
 * A drop banner never opens a session: a move's Claude Code session may not exist yet, and often
 * never will (0029).
 *
 * `builder://drop?url=<link>` — a link sent in from outside: the Mac, a Shortcut, or a paste.
 * It lands on the Drops tab with the link in the query, and the tab sends it. The iOS share
 * extension does NOT use this route: it writes into the App Group and the app drains it on
 * foreground (`src/drops/intake.ts`), because a link long enough to be a URL inside a URL is a
 * link some host will truncate.
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
  const next = path.includes('auth/google')
    ? '/settings'
    : dropPath(path) ?? recapPath(path) ?? aliasPath(path) ?? path;
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

/**
 * `/drops?url=<link>` when `path` is a drop link, else null. Pure, so bun can pin it.
 *
 * The link is NOT validated here beyond being present: `src/drops/urls.ts` decides what a link
 * is, once, and a second opinion in the router would be a second rule about what a reel's URL
 * is. What this refuses is an EMPTY `url`, which would otherwise open the tab with a query
 * string that means nothing.
 */
export function dropPath(path: string): string | null {
  const m = /^(?:[a-z][a-z0-9+.-]*:\/{2,3})?\/*drops?\/?(?:\?([^#]*))?(?:#.*)?$/i.exec(path.trim());
  if (!m) return null;
  const q = new URLSearchParams(m[1] ?? '');
  const url = q.get('url')?.trim();
  if (url) return `/drops?url=${encodeURIComponent(url)}`;
  // `builder://drops?open=<id>` is what a tapped drop banner carries
  // (`server/builder/drops_notify.drop_url`). It opens the drop itself: through the board, a tap
  // while that drop was up dismissed it and presented it again at once, and UIKit stopped the app
  // (`push/route.ts` DropRoute). An id that is not one path segment is the board.
  const open = q.get('open')?.trim();
  if (open && isSafeId(open)) return `/drop/${encodeURIComponent(open)}`;
  return '/drops';
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
