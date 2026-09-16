/**
 * Which of your repositories a move could run in. PURE: no React Native, so `bun test` holds it
 * (`__tests__/dropsBoard.test.ts`), the way every other rule in `src/drops/` that can be pure is.
 *
 * THE PLANNER NEVER NAMES A REPOSITORY. It has never seen one: `spec/drops.v1.json` gives a move
 * `target: existing_repo` and no field to put a repository in, and the wire carries the salted key
 * rather than a name at every point after that. A move like that is not startable until a person
 * says which, and this is the list they say it from.
 *
 * IT IS THE PROJECTS TAB'S OWN LIST, not a second one: the keys come from the Mac's report, the
 * numbers from the register the tab keeps, and the words from `projectLabel`, so a project called
 * "Private project 4" here is called that everywhere.
 */
import type { ListedProject } from '../data/reportProjects';
import { projectLabel } from '../projects/model';

export interface RepoChoice {
  key: string;
  label: string;
}

export interface RepoNamesLike {
  nicknames: Readonly<Record<string, string>>;
  registry: { projects: Record<string, { n: number }> };
}

/**
 * The choices, newest first. Null means the report has not been read yet, which is a different
 * thing from a person having no projects and is said differently on screen.
 *
 * Newest first because the repository you are in right now is the one a move is most often for,
 * and on this list that is the one whose first session is most recent. A tie breaks on the key,
 * so two projects registered in the same second do not swap places between renders.
 */
export function projectChoices(
  listed: readonly ListedProject[] | null,
  names: RepoNamesLike | null,
): RepoChoice[] | null {
  if (listed === null) return null;
  return [...listed]
    .sort((a, b) =>
      a.history.first_at === b.history.first_at
        ? a.key < b.key
          ? -1
          : 1
        : a.history.first_at < b.history.first_at
          ? 1
          : -1,
    )
    .map((p) => ({
      key: p.key,
      label: projectLabel(p.key, null, names?.nicknames ?? null, names?.registry.projects[p.key]?.n ?? null).text,
    }));
}
