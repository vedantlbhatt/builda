/**
 * The phone's project names, for the surfaces outside the Projects tab that name a session's
 * repository (`copy/repoLabel.ts` has the rule): the owner's names and the register of the number
 * each private project is called by, read from the one store the Projects tab keeps
 * (`projects/nicknames.ts`), never a second copy of it.
 *
 * A project is numbered the first time the phone sees it, from the Mac's report, which is what the
 * Projects tab registers from (`reportProjects.ts`). The surfaces here register from the SAME
 * list, through the store's own `registerOnThisPhone`, so a phone that has never opened the
 * Projects tab gives out the numbers the tab would have given, in the same order, and saves them
 * where the tab reads them. Nothing here is sent anywhere.
 */
import { useEffect, useMemo, useState } from 'react';

import type { RepoNames } from '../copy/repoLabel';
import { NICKNAMES_KEY, parseNicknames, parseRegistry, REGISTRY_KEY } from '../projects/model';
import { registerOnThisPhone, useNicknames, useProjectRegistry } from '../projects/nicknames';
import * as cache from './cache';
import { reportProjects, type ListedProject } from './reportProjects';

/** A read this recent is reused: a list of fifty rows asks once, not fifty times. */
const REUSE_MS = 5_000;

let held: { list: ListedProject[] | null; at: number } | null = null;
let reading: Promise<ListedProject[] | null> | null = null;

/** The report's projects, read once for every surface that asks at about the same time. */
function readList(): Promise<ListedProject[] | null> {
  if (reading) return reading;
  if (held && Date.now() - held.at < REUSE_MS) return Promise.resolve(held.list);
  const r = reportProjects()
    .catch(() => null)
    .then((list) => {
      held = { list, at: Date.now() };
      return list;
    });
  reading = r;
  void r.finally(() => {
    if (reading === r) reading = null;
  });
  return r;
}

/**
 * The names and numbers now, outside React (the Live Activity poll): the report's projects
 * registered through the store, then the saved register and names read back.
 */
export async function loadRepoNames(): Promise<RepoNames> {
  const list = await readList();
  if (list && list.length) await registerOnThisPhone(list).catch(() => undefined);
  const [names, reg] = await Promise.all([cache.getKv(NICKNAMES_KEY).catch(() => null), cache.getKv(REGISTRY_KEY).catch(() => null)]);
  return { nicknames: parseNicknames(names), registry: parseRegistry(reg) };
}

/**
 * The names and numbers for a screen, repainting when a project is renamed. Null until the saved
 * register and the report's projects have been read (a few milliseconds of SQLite), so a surface
 * says "private repo" for that moment rather than a number the saved register might contradict.
 */
export function useRepoNames(): RepoNames | null {
  const nicknames = useNicknames();
  const [list, setList] = useState<ListedProject[] | null | undefined>(held ? held.list : undefined);
  useEffect(() => {
    let live = true;
    void readList().then((l) => {
      if (live) setList(l);
    });
    return () => {
      live = false;
    };
  }, []);
  const { registry, ready } = useProjectRegistry(list ?? null);
  return useMemo(() => (ready && list !== undefined ? { nicknames, registry } : null), [ready, list, nicknames, registry]);
}
