/**
 * The projects the Mac's report lists, as the phone's register numbers them (a full key and a
 * first session each), out of a builder profile. Pure: `reportProjects.ts` reads and asks; this
 * only reads what it is handed, so `bun test` holds it (`__tests__/repoLabel.test.ts`).
 */
import type { BuilderProfileResponse } from './api';

/** A project as the register numbers it: its full key and its first session. */
export type ListedProject = { key: string; history: { first_at: string } };

/**
 * The report's projects from a builder profile (the response, or its saved JSON), each with a
 * key and a first session; null when there is no report or it has no projects block.
 */
export function reportProjectsOf(b: BuilderProfileResponse | string | null | undefined): ListedProject[] | null {
  let v: unknown = b;
  if (typeof b === 'string') {
    try {
      v = JSON.parse(b);
    } catch {
      return null;
    }
  }
  const projects = (v as { report?: { projects?: { projects?: unknown } | null } | null } | null)?.report?.projects?.projects;
  if (!Array.isArray(projects)) return null;
  return projects.filter(
    (p): p is ListedProject =>
      !!p && typeof p === 'object' && typeof (p as ListedProject).key === 'string' && typeof (p as ListedProject).history?.first_at === 'string',
  );
}
