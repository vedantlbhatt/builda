/**
 * The projects the Mac's report lists (`report.projects.projects`, each key and its first
 * session): what the phone numbers its private projects from (`projects/model.registerProjects`).
 * Read from the saved builder profile; with none saved and an account signed in, asked for once
 * (the request the You tab makes) and saved through `saveBuilderProfile`, the one writer, so the
 * Now tab of a phone that has never opened You can still call a project by the number the
 * Projects tab would give it.
 *
 * This reads the builder profile and nothing about names: the owner's names and the register
 * are read in `repoNames.ts`, which imports no way off the phone.
 */
import { BUILDER_KEY, BUILDER_SAVED_AT_KEY } from '../you/keys';
import { saveBuilderProfile } from './builderCache';
import * as cache from './cache';
import { api } from './client';
import { reportProjectsOf, type ListedProject } from './listedProjects';

export { reportProjectsOf, type ListedProject };

let asking: Promise<ListedProject[] | null> | null = null;

/** The report's projects: the saved builder profile's, else (signed in, none saved) asked for once. */
export async function reportProjects(): Promise<ListedProject[] | null> {
  const saved = reportProjectsOf(await cache.getKv(BUILDER_KEY).catch(() => null));
  if (saved) return saved;
  if (!asking) {
    const ask = (async () => {
      if (!(await api.isSignedIn().catch(() => false))) return null;
      try {
        const b = await api.builderProfile();
        await saveBuilderProfile(b, cache);
        await cache.setKv(BUILDER_SAVED_AT_KEY, String(Date.now()));
        return reportProjectsOf(b);
      } catch {
        return null;
      }
    })();
    asking = ask;
    // One question at a time, and a new one after it answers: the next account, or the next try
    // after a failure, asks again. An answer that was saved is read from the kv from then on.
    void ask.finally(() => {
      if (asking === ask) asking = null;
    });
  }
  return asking;
}
