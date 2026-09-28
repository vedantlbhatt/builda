/**
 * Releases and stars on the phone (docs/social.md, server routes/releases.py), PURE, so
 * `__tests__/releases.test.ts` holds every word.
 *
 * A RELEASE is what a builder says they shipped: a title, a few lines, up to five highlights. The
 * owner's Mac DRAFTS one by itself (after enough commits, after a session that shipped, on a
 * cadence the owner set, or when git says a feature is finished: a version tagged, a branch merged),
 * only once the owner turned drafting on for that project; the owner reads
 * the draft here, changes any word, and publishes it to their followers, or to everyone when the
 * project is public. Everyone who starred the project, or follows its owner, hears about it.
 *
 * NOTHING IS SAID THE SERVER DID NOT SAY: a draft's reason is its trigger code, worded here; a
 * refusal is a code, worded here; a star count the server withheld (a private project) is shown as
 * nothing, never as zero.
 */

export type ReleaseStatus = 'draft' | 'published' | 'dismissed';
/** Why the Mac drafted it (server `releases.TRIGGERS`; 0038 added `tagged` and `merged`). */
export type ReleaseTrigger = 'commits' | 'shipped' | 'cadence' | 'asked' | 'tagged' | 'merged';
export type Visibility = 'followers' | 'public';
export type Cadence = 'none' | 'weekly' | 'biweekly';

/** A release as its owner reads it (`releases.mine`). */
export interface MyRelease {
  id: string;
  project_key: string;
  name: string | null;
  status: ReleaseStatus;
  title: string;
  notes: string;
  highlights: string[];
  commits: number | null;
  trigger: ReleaseTrigger;
  has_trailer: boolean;
  trailer_version: number | null;
  visibility: Visibility;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  stars: number | null;
}

/** A published release as anyone else reads it (`releases.theirs`). */
export interface TheirRelease {
  id: string;
  owner_handle: string | null;
  owner_display_name: string | null;
  project_key: string | null;
  name: string | null;
  title: string;
  notes: string;
  highlights: string[];
  commits: number | null;
  has_trailer: boolean;
  published_at: string | null;
  stars: number | null;
}

export interface ReleaseSettings {
  project_key: string;
  every_commits: number;
  cadence: Cadence;
  on_shipped: boolean;
  drafts_to_phone: boolean;
  updated_at: string | null;
}

export interface LatestRelease {
  id: string;
  title: string;
  published_at: string | null;
}

/** A project on someone's profile (`GET /v1/users/{handle}/projects`). */
export interface TheirProject {
  key: string;
  name: string | null;
  stars: number | null;
  starred: boolean;
  latest_release: LatestRelease | null;
}

/** A project I starred (`GET /v1/me/stars`). */
export interface StarredProject {
  owner_handle: string | null;
  owner_display_name: string | null;
  key: string;
  name: string | null;
  stars: number | null;
  latest_release: LatestRelease | null;
}

/** The bounds the server holds a release to (builder/releases.py). */
export const TITLE_MAX = 80;
export const NOTES_MAX = 1200;
export const HIGHLIGHTS_MAX = 5;
export const HIGHLIGHT_MAX = 120;
export const EVERY_COMMITS: readonly [number, number] = [3, 200];

export function isMine(r: MyRelease | TheirRelease): r is MyRelease {
  return 'status' in r;
}

/** Why the Mac drafted it, in a few words. */
export function triggerLine(r: Pick<MyRelease, 'trigger' | 'commits'>): string {
  switch (r.trigger) {
    case 'commits':
      return r.commits !== null ? `drafted after ${r.commits} commits` : 'drafted after your commits';
    case 'shipped':
      return 'drafted after a session that shipped';
    case 'cadence':
      return 'drafted on your schedule';
    case 'asked':
      return 'drafted when you asked';
    case 'tagged':
      return 'drafted when you tagged a version';
    case 'merged':
      return 'drafted when a feature was merged';
  }
}

/** "12 commits · a trailer" under a release, from what it carries. */
export function carriesLine(r: Pick<MyRelease, 'commits' | 'has_trailer'>): string | null {
  const parts = [r.commits ? `${r.commits} ${r.commits === 1 ? 'commit' : 'commits'}` : null, r.has_trailer ? 'a trailer' : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** A star count as the server gave it: null (a private project, nobody counted) says nothing. */
export function starsLine(stars: number | null): string | null {
  if (stars === null) return null;
  return `${stars} ${stars === 1 ? 'star' : 'stars'}`;
}

// ------------------------------------------------------------------ the draft, edited

export interface Draft {
  title: string;
  notes: string;
  highlights: string[];
}

export function draftOf(r: Pick<MyRelease, 'title' | 'notes' | 'highlights'>): Draft {
  return { title: r.title, notes: r.notes, highlights: [...r.highlights] };
}

/** What stops a draft from going out, as the words to fix it, or null when it can go. */
export function draftProblem(d: Draft): string | null {
  if (!d.title.trim()) return 'Give it a title.';
  if (d.title.length > TITLE_MAX) return `The title is ${d.title.length - TITLE_MAX} over ${TITLE_MAX}.`;
  if (d.notes.length > NOTES_MAX) return `The notes are ${d.notes.length - NOTES_MAX} over ${NOTES_MAX}.`;
  const kept = d.highlights.filter((h) => h.trim());
  if (kept.length > HIGHLIGHTS_MAX) return `At most ${HIGHLIGHTS_MAX} highlights.`;
  const long = kept.find((h) => h.length > HIGHLIGHT_MAX);
  if (long) return `A highlight is ${long.length - HIGHLIGHT_MAX} over ${HIGHLIGHT_MAX}.`;
  return null;
}

/** The PATCH body: only what changed, blank highlights left out; null when nothing did. */
export function draftPatch(before: Draft, after: Draft): Partial<Draft> | null {
  const out: Partial<Draft> = {};
  const title = after.title.trim();
  const notes = after.notes.trim();
  const highlights = after.highlights.map((h) => h.trim()).filter(Boolean);
  if (title !== before.title) out.title = title;
  if (notes !== before.notes) out.notes = notes;
  if (JSON.stringify(highlights) !== JSON.stringify(before.highlights)) out.highlights = highlights;
  return Object.keys(out).length ? out : null;
}

// ------------------------------------------------------------------ settings

export const CADENCE_WORDS: Readonly<Record<Cadence, string>> = {
  none: 'never',
  weekly: 'every week',
  biweekly: 'every two weeks',
};

/** The line under the drafting switch: what will make the Mac draft, from the settings. */
export function settingsLine(s: ReleaseSettings): string {
  if (!s.drafts_to_phone) return 'Your Mac drafts nothing for this project.';
  const when = [`every ${s.every_commits} commits`, s.on_shipped ? 'after a session that ships' : null, s.cadence !== 'none' ? CADENCE_WORDS[s.cadence] : null].filter(Boolean);
  const list = when.length > 1 ? `${when.slice(0, -1).join(', ')} or ${when[when.length - 1]}` : when[0];
  return `Your Mac drafts one ${list}. Nothing goes out until you publish it.`;
}

/** The commit steps the stepper walks, within the server's bounds. */
export function stepCommits(n: number, dir: 1 | -1): number {
  const steps = [3, 5, 10, 15, 20, 30, 50, 100, 200];
  if (dir > 0) return steps.find((s) => s > n) ?? EVERY_COMMITS[1];
  return [...steps].reverse().find((s) => s < n) ?? EVERY_COMMITS[0];
}

// ------------------------------------------------------------------ words for codes

const ERRORS: Readonly<Record<string, string>> = {
  project_not_public: 'Only a public project can be released to everyone. Mark it public first, or release it to your followers.',
  names_a_repository: 'A word in it names a private repository. Change it and publish again.',
  not_draft: 'This one was already published or put away.',
  not_editable: 'This one was put away, so it cannot change.',
  nothing_to_change: 'Nothing changed.',
  empty_title: 'Give it a title.',
  empty_highlight: 'A highlight is empty.',
  own_project: 'That one is yours.',
  not_found: 'It is not there any more.',
  not_yours: 'That release is not yours.',
  drafts_off: 'Drafting is off for this project.',
};

/** A refused request's words; a sentence (offline, a timeout) passes through; a code never shows. */
export function sayReleaseError(e: unknown, fallback: string): string {
  const m = e instanceof Error ? e.message : '';
  if (m in ERRORS) return ERRORS[m]!;
  return / /.test(m) && !/_/.test(m) ? m : fallback;
}

/** "today", "yesterday", "3 days ago", else the date: when a release went out. */
export function whenLine(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const day = 86_400_000;
  const startOf = (ms: number) => {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const days = Math.round((startOf(now) - startOf(t)) / day);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toLowerCase();
}

/** The project page's door into its releases: a waiting draft first, else what went out. */
export function doorWords(releases: readonly MyRelease[] | null): { title: string; line: string } {
  const draft = releases?.find((r) => r.status === 'draft');
  if (draft) return { title: 'A release draft is waiting', line: draft.title };
  const out = releases?.filter((r) => r.status === 'published').length ?? 0;
  if (out) return { title: 'Releases', line: `${out} out. Your Mac can draft the next one.` };
  return { title: 'Releases', line: 'Your Mac drafts what you shipped; you read it and publish it.' };
}

/** A project row's line with its waiting draft said last, joined as the row joins its words. */
export function withDraft(meta: string, draft: boolean): string {
  if (!draft) return meta;
  return meta ? `${meta} · a release draft to read` : 'a release draft to read';
}

/** The Following door's words, from how many releases came out this week (null: not heard). */
export function followingWords(n: number | null): string {
  if (n === null || n === 0) return 'releases from what you starred and who you follow';
  return `${n} ${n === 1 ? 'release' : 'releases'} this week from what you starred and who you follow`;
}

// ------------------------------------------------------------------ the star

/** The star, row by row: X is a cell. Symmetric, so it reads at 2pt cells. */
export const STAR = ['...X...', '..XXX..', 'XXXXXXX', '.XXXXX.', '..XXX..', '.XX.XX.', '.X...X.'];

/** Whether a cell of the star is on its edge: a filled cell with an empty or missing neighbour. */
export function edgeCell(r: number, c: number): boolean {
  if (STAR[r]?.[c] !== 'X') return false;
  const off = (y: number, x: number) => STAR[y]?.[x] !== 'X';
  return off(r - 1, c) || off(r + 1, c) || off(r, c - 1) || off(r, c + 1);
}

/** The line under a draft's heading: why, then what it carries, never the commit count twice. */
export function draftLine(r: Pick<MyRelease, 'trigger' | 'commits' | 'has_trailer'>): string {
  const carries = carriesLine(r.trigger === 'commits' ? { ...r, commits: null } : r);
  return [triggerLine(r), carries].filter(Boolean).join(' · ');
}

// ------------------------------------------------------------------ posting it elsewhere

/** The platforms a release is posted to straight from its row: the ones with a compose page. */
export const POST_TO = ['x', 'bluesky', 'threads', 'linkedin', 'reddit'] as const;
export type PostTo = (typeof POST_TO)[number];

/**
 * A release as a post for one platform, within its limit: the title, then as many highlights as fit
 * whole (never one cut in half), each on its own line after the middle dot. Reddit takes a title
 * only, so it is the title.
 */
export function releasePost(r: Pick<MyRelease, 'title' | 'highlights'>, limit: number, titleOnly = false): string {
  const title = r.title.trim().slice(0, limit);
  if (titleOnly) return title;
  let out = title;
  for (const h of r.highlights) {
    const next = `${out}${out === title ? '\n' : ''}\n· ${h.trim()}`;
    if ([...next].length > limit) break;
    out = next;
  }
  return out;
}
