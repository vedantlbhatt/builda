/**
 * The desktop layout's rules, pure: no React Native, no DOM, so `__tests__/desktop.test.ts` pins
 * every one in bun. The components in this folder only lay them out.
 */

export type FormFactor = 'phone' | 'desktop';

/**
 * Where the sidebar takes over from the tab bar. 900 is two columns a list can live in (a 360
 * master and the rest), plus the sidebar: under it a split view squeezes the detail below a
 * phone's width, which is worse than the phone layout it replaced.
 */
export const DESKTOP_MIN_WIDTH = 900;

/** The rule: web and wide is desktop, everything else the phone. iOS never gets here. */
export function formFactorFor(os: string, width: number): FormFactor {
  return os === 'web' && width >= DESKTOP_MIN_WIDTH ? 'desktop' : 'phone';
}

/** The five peers, in the tab bar's order: Cmd/Ctrl+1 to 5. */
export const SECTIONS = ['now', 'sessions', 'drops', 'projects', 'you'] as const;
export type Section = (typeof SECTIONS)[number];

/** What the sidebar highlights for a pathname, and which master list sits beside it (if any). */
export interface Place {
  /** The sidebar row that is lit; null on a route that belongs to no tab (Settings is its own row). */
  section: Section | null;
  settings: boolean;
  /** A detail route of a section with a list: the list stays beside it. */
  master: 'sessions' | 'drops' | 'projects' | null;
  /** The master's own tab root (`/sessions`): the list is the master, the detail pane is empty. */
  masterRoot: boolean;
  /** Routes that draw their own full window: onboarding, the island, Wrapped's cards. */
  bare: boolean;
}

/** Strip a query, a hash and a trailing slash, and drop expo-router's group segments. */
export function cleanPath(pathname: string): string {
  const p = pathname.split(/[?#]/)[0] ?? '';
  const parts = p.split('/').filter((s) => s.length > 0 && !/^\(.*\)$/.test(s));
  return `/${parts.join('/')}`;
}

export function placeOf(pathname: string): Place {
  const p = cleanPath(pathname);
  const [head = '', second] = p.slice(1).split('/');
  const place: Place = { section: null, settings: false, master: null, masterRoot: false, bare: false };
  if (head === '' || head === 'now' || head === 'live') place.section = 'now';
  else if (head === 'sessions') {
    place.section = 'sessions';
    place.master = 'sessions';
    place.masterRoot = true;
  } else if (head === 'session') {
    place.section = 'sessions';
    place.master = second ? 'sessions' : null;
  } else if (head === 'drops') {
    place.section = 'drops';
    place.master = 'drops';
    place.masterRoot = true;
  } else if (head === 'drop') {
    place.section = 'drops';
    place.master = second ? 'drops' : null;
  } else if (head === 'projects') {
    place.section = 'projects';
    place.master = 'projects';
    place.masterRoot = true;
  } else if (head === 'project') {
    place.section = 'projects';
    place.master = second ? 'projects' : null;
  } else if (head === 'you' || head === 'analysis' || head === 'wrapped' || head === 'icon') place.section = 'you';
  else if (head === 'settings' || head === 'pair') place.settings = true;
  if (head === 'onboarding' || head === 'island') place.bare = true;
  return place;
}

/** The path each section opens at. */
export function sectionPath(s: Section): `/${Section}` {
  return `/${s}`;
}

// ------------------------------------------------------------------ keyboard

export type Command =
  | { kind: 'section'; section: Section }
  | { kind: 'settings' }
  | { kind: 'search' }
  | { kind: 'back' }
  | { kind: 'sidebar' }
  | { kind: 'refresh' };

export interface KeyInput {
  key: string;
  /** Cmd on a Mac, Ctrl elsewhere: the caller folds the two by platform. */
  mod: boolean;
  shift: boolean;
  alt: boolean;
  /** True while focus is in a text field: plain keys belong to the field then. */
  typing: boolean;
}

/**
 * The shortcuts, one table. Cmd/Ctrl+1..5 the sections, Cmd/Ctrl+, Settings, Cmd/Ctrl+K search,
 * Cmd/Ctrl+\ the sidebar, Cmd/Ctrl+R refresh, Esc back (and out of a field first, which the
 * field does itself, so Esc while typing is left to it).
 */
export function commandFor(k: KeyInput): Command | null {
  if (k.key === 'Escape') return k.typing ? null : { kind: 'back' };
  if (!k.mod || k.alt) return null;
  const n = Number(k.key);
  if (Number.isInteger(n) && n >= 1 && n <= SECTIONS.length && !k.shift) return { kind: 'section', section: SECTIONS[n - 1]! };
  const key = k.key.toLowerCase();
  if (key === ',') return { kind: 'settings' };
  if (key === 'k') return { kind: 'search' };
  if (key === '\\') return { kind: 'sidebar' };
  if (key === 'r' && !k.shift) return { kind: 'refresh' };
  return null;
}

/** How a shortcut is printed beside its row: the Mac's glyph, or Ctrl elsewhere. */
export function shortcutLabel(platform: string, key: string): string {
  return platform === 'darwin' || platform === 'mac' ? `⌘${key}` : `Ctrl+${key}`;
}

// ------------------------------------------------------------------ sizes

/** The sidebar, open and folded to its glyphs. */
export const SIDEBAR_WIDTH = 224;
export const SIDEBAR_FOLDED = 76;
/** A master list's column. The wall is wider: its frames are 9:16 and a web of them needs room. */
export const MASTER_WIDTH: Record<'sessions' | 'drops' | 'projects', number> = {
  sessions: 400,
  drops: 520,
  projects: 420,
};
/** A page with no master stops growing here and sits centred: lines past this are unreadable. */
export const CONTENT_MAX = 1120;
/** The macOS title bar the traffic lights sit in, with `titleBarStyle: 'hiddenInset'`. */
export const MAC_TITLEBAR = 52;

/**
 * How wide the master may be at this window width: its own width, but never so wide that the
 * detail beside it is narrower than a phone (390), and never under 320.
 */
export function masterWidthFor(master: 'sessions' | 'drops' | 'projects', windowWidth: number, sidebar: number): number {
  const room = windowWidth - sidebar - 390;
  return Math.max(320, Math.min(MASTER_WIDTH[master], room));
}
