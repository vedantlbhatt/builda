/**
 * WHAT A SESSION'S REPOSITORY IS CALLED on every surface that names it: the Now tile, a Sessions
 * row, the session page's hero, the share card, the Lock Screen, the Dynamic Island and the Home
 * Screen widget. One rule, so a project is never "Private project 2" on its own page and "private
 * repo" on the tile that opens it.
 *
 * FOUND IN THE CAPTURE PASS (2026-09-14, shots/now2): the Projects tab, a project's page and the
 * money flow called the two private projects "Private project 1" and "Private project 2", and
 * every other surface still said "private repo", including the Lock Screen card for a session
 * running in Private project 2. The number is the phone's own (`projects/model.registerProjects`,
 * kept in `projects/nicknames.ts`), so the words come from `projects/model.projectLabel`, never
 * written out a second time here.
 *
 * In order:
 *   1. The repository's public name, when the server sent one (`repo_name`).
 *   2. INSIDE THE APP ONLY: the owner's own name for the project (`nicknames`).
 *   3. "Private project" and the number this phone gave it, when it has given one.
 *   4. "private repo": no key (the sitting's repository did not resolve), or a project this phone
 *      has not numbered (one the Mac's report does not list), or names not read yet.
 *
 * `reach: 'outside'` is for what leaves the app's screens: the Lock Screen, the Dynamic Island, the
 * widget and the share card. It skips the owner's own name, because the naming field promises
 * "Only this phone knows it" and an owner may well type the repository's real name: a share card
 * leaves the phone, and the Lock Screen is read by anyone near it, whose fields are safe by
 * construction (`cache.LOCK_SCREEN_DETAILS_DEFAULT`). A number says nothing about the repository.
 *
 * Pure: no React Native, so `bun test` holds it (`__tests__/repoLabel.test.ts`).
 */
import { projectLabel, type ProjectRegistry } from '../projects/model';

/** What a surface says for a repository it cannot name. */
export const PRIVATE_REPO = 'private repo';

/** What the phone holds about its projects: the owner's names and the register's numbers. */
export interface RepoNames {
  nicknames: Readonly<Record<string, string>>;
  registry: ProjectRegistry;
}

/** Inside the app's own screens, or on a surface other people can see. */
export type RepoReach = 'app' | 'outside';

export function repoLabel(
  s: { repo_name?: string | null; repo_key?: string | null },
  names: RepoNames | null | undefined,
  reach: RepoReach = 'app',
): string {
  const pub = s.repo_name?.trim();
  if (pub) return pub;
  const key = s.repo_key;
  if (!key || !names) return PRIVATE_REPO;
  const own = reach === 'app' ? names.nicknames[key]?.trim() : undefined;
  const n = names.registry.projects[key]?.n ?? null;
  if (!own && !(n !== null && n > 0)) return PRIVATE_REPO;
  return projectLabel(key, null, own ? { [key]: own } : null, n).text;
}
