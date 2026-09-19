/**
 * What Cmd/Ctrl+K can jump to, and the order a query puts it in. Pure (no React, no API), so
 * `__tests__/desktop.test.ts` holds the ranking.
 *
 * The phone has one search, the wall's; a desktop has a keyboard and expects to type its way
 * anywhere. The palette searches the places (the five sections and the pages under You), the
 * sessions the cache holds, the projects they belong to, and the drops on the wall, by the same
 * words each one is shown with. Nothing is sent anywhere: every row is already on this machine.
 */

export type PaletteKind = 'place' | 'session' | 'project' | 'drop';

export interface PaletteItem {
  id: string;
  kind: PaletteKind;
  title: string;
  /** The second line, as the row elsewhere says it: "Private project 1 · Saturday". */
  meta: string;
  /** Where Enter goes. */
  href: string;
}

/** The places, in the order an empty query lists them. */
export const PLACES: readonly PaletteItem[] = [
  { id: 'now', kind: 'place', title: 'Now', meta: 'What is running', href: '/now' },
  { id: 'sessions', kind: 'place', title: 'Sessions', meta: 'Everything that finished', href: '/sessions' },
  { id: 'drops', kind: 'place', title: 'Drops', meta: 'What you sent yourself', href: '/drops' },
  { id: 'projects', kind: 'place', title: 'Projects', meta: 'Where your hours go', href: '/projects' },
  { id: 'you', kind: 'place', title: 'You', meta: 'Who you are as a builder', href: '/you' },
  { id: 'live', kind: 'place', title: 'Mission control', meta: 'Every running session, full size', href: '/live' },
  { id: 'analysis', kind: 'place', title: 'Your analysis', meta: 'Every reading on one page', href: '/analysis' },
  { id: 'wrapped', kind: 'place', title: 'Wrapped', meta: 'The fifteen questions', href: '/wrapped' },
  { id: 'money', kind: 'place', title: 'Money', meta: 'Every dollar at list prices', href: '/you/money' },
  { id: 'stack', kind: 'place', title: 'Your stack', meta: 'What your projects are made of', href: '/you/stack' },
  { id: 'dimensions', kind: 'place', title: 'Dimensions', meta: 'The five, one session at a time', href: '/you/dimensions' },
  { id: 'glossary', kind: 'place', title: 'Glossary', meta: 'The words your sessions earned', href: '/you/glossary' },
  { id: 'settings', kind: 'place', title: 'Settings', meta: 'Account, privacy, this computer', href: '/settings' },
];

/** Lower case, accents folded, runs of anything that is not a letter or digit to one space. */
export function fold(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * How well `item` answers `query`, or null for no match. Every word of the query must start a
 * word of the title or the meta (so "fail test" finds "Debugged a failing test suite"); a title
 * hit beats a meta hit, a hit at the start of the title beats one later, and a place beats a
 * session at the same score, because typing "you" means the tab.
 */
export function score(item: PaletteItem, query: string): number | null {
  const q = fold(query);
  if (!q) return 0;
  const title = fold(item.title);
  const meta = fold(item.meta);
  const tw = title.split(' ');
  const mw = meta.split(' ');
  let total = 0;
  for (const word of q.split(' ')) {
    if (tw.some((w) => w.startsWith(word))) total += 10;
    else if (mw.some((w) => w.startsWith(word))) total += 4;
    else if (title.includes(word)) total += 2;
    else return null;
  }
  if (title.startsWith(q)) total += 8;
  if (item.kind === 'place') total += 3;
  return total;
}

/** The rows for a query, best first, at most `limit`. Stable for ties: the order they came in. */
export function rank(items: readonly PaletteItem[], query: string, limit = 12): PaletteItem[] {
  const scored: { item: PaletteItem; s: number; i: number }[] = [];
  items.forEach((item, i) => {
    const s = score(item, query);
    if (s !== null) scored.push({ item, s, i });
  });
  scored.sort((a, b) => b.s - a.s || a.i - b.i);
  return scored.slice(0, limit).map((x) => x.item);
}

/** The label a kind wears on its row. */
export const KIND_LABEL: Record<PaletteKind, string> = {
  place: 'go to',
  session: 'session',
  project: 'project',
  drop: 'drop',
};
