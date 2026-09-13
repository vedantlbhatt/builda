import { ARCHETYPE_ANIMALS, CORPUS_ARCHETYPE_ANIMALS, isAnimal, type Animal } from '../pixel/animals';
import { HARNESSES, isHarness, type Harness } from '../pixel/harness';
import { ANIMAL_KEY, TOOLS_KEY } from './keys';

/**
 * What onboarding remembers between steps and after it: the tools picked, the creature
 * picked, and what the account already says about both. Pure apart from the `Kv` passed in,
 * so the tests drive every branch with a Map.
 */

export interface Kv {
  getKv(k: string): Promise<string | null>;
  setKv(k: string, v: string): Promise<void>;
}

// ─── the tools ───────────────────────────────────────────────────────────────────────

export type HarnessCounts = Partial<Record<Harness, number>>;

/**
 * Sessions per harness in a list of sessions. A wire value this build does not know (a
 * newer server's harness) is left out rather than guessed into a tile.
 */
export function harnessCounts(sessions: readonly { harness: string }[]): HarnessCounts {
  const out: HarnessCounts = {};
  for (const s of sessions) {
    if (!isHarness(s.harness)) continue;
    out[s.harness] = (out[s.harness] ?? 0) + 1;
  }
  return out;
}

/**
 * The `found` map the picker takes, or undefined when there is nothing to state. Only the
 * tools sessions actually came from are in it: their tiles say how many, and every other tile
 * says nothing. A "not found" under six of seven tiles was noise (and it read as a
 * contradiction the moment someone picked one of them anyway); with no sessions at all it
 * would be a claim about a Mac nobody has paired yet.
 */
export function foundFor(counts: HarnessCounts | null | undefined): HarnessCounts | undefined {
  if (!counts) return undefined;
  const out: HarnessCounts = {};
  let total = 0;
  for (const h of HARNESSES) {
    const n = counts[h] ?? 0;
    if (n > 0) {
      out[h] = n;
      total += n;
    }
  }
  return total > 0 ? out : undefined;
}

/**
 * The picker's tiles in the order to show them: the tools sessions came from first, most
 * sessions first, then the rest in the pack's own order. With nothing found, the pack's order.
 */
export function marksInOrder<M extends { harnesses: readonly Harness[] }>(marks: readonly M[], found: HarnessCounts | undefined): M[] {
  const count = (m: M) => m.harnesses.reduce((n, h) => n + (found?.[h] ?? 0), 0);
  return marks
    .map((m, i) => ({ m, i, n: count(m) }))
    .sort((a, b) => (b.n > 0 || a.n > 0 ? b.n - a.n || a.i - b.i : a.i - b.i))
    .map((x) => x.m);
}

/** The harnesses a person has sessions from, in `HARNESSES` order. */
export function preselect(found: HarnessCounts | undefined): Harness[] {
  if (!found) return [];
  return HARNESSES.filter((h) => (found[h] ?? 0) > 0);
}

/** A stored selection, or null when nothing readable was ever stored (not the same as []). */
export function parseTools(raw: string | null | undefined): Harness[] | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const set = new Set(parsed.filter((v): v is string => typeof v === 'string').filter(isHarness));
  return HARNESSES.filter((h) => set.has(h));
}

/** Stored in `HARNESSES` order with no repeats, so two equal selections store equal. */
export function serializeTools(selected: readonly Harness[]): string {
  const set = new Set(selected);
  return JSON.stringify(HARNESSES.filter((h) => set.has(h)));
}

/** Their own earlier choice first (an empty one included), then what the account found. */
export function initialTools(stored: Harness[] | null, found: HarnessCounts | undefined): Harness[] {
  return stored ?? preselect(found);
}

export async function loadTools(kv: Kv): Promise<Harness[] | null> {
  try {
    return parseTools(await kv.getKv(TOOLS_KEY));
  } catch {
    return null;
  }
}

export async function saveTools(kv: Kv, selected: readonly Harness[]): Promise<void> {
  await kv.setKv(TOOLS_KEY, serializeTools(selected));
}

// ─── the creature ────────────────────────────────────────────────────────────────────

export async function loadAnimal(kv: Kv): Promise<Animal | null> {
  try {
    const v = await kv.getKv(ANIMAL_KEY);
    return isAnimal(v) ? v : null;
  } catch {
    return null;
  }
}

export async function saveAnimal(kv: Kv, animal: Animal): Promise<void> {
  await kv.setKv(ANIMAL_KEY, animal);
}

// ─── the archetype, for the suggestion ──────────────────────────────────────────────

interface ProfileLike {
  builder_profile?: { archetype?: { modal?: string | null } | null } | null;
}

interface BuilderLike {
  corpus?: { archetype?: { name?: string | null } | null } | null;
  builder_profile?: { archetype?: { modal?: string | null } | null } | null;
}

/**
 * The archetype the account already has, from what the app has cached: the corpus rules'
 * pick first (`GET /v1/profile/builder`, cached by the You tab as JSON), then the modal of the
 * per-session analyses (`GET /v1/profile`). Null when neither has one yet.
 */
export function archetypeFrom(builder: BuilderLike | string | null | undefined, profile?: ProfileLike | null): string | null {
  let b: BuilderLike | null = null;
  if (typeof builder === 'string') {
    try {
      b = JSON.parse(builder) as BuilderLike;
    } catch {
      b = null;
    }
  } else if (builder) {
    b = builder;
  }
  const candidates = [b?.corpus?.archetype?.name, b?.builder_profile?.archetype?.modal, profile?.builder_profile?.archetype?.modal];
  for (const c of candidates) if (typeof c === 'string' && c.length > 0) return c;
  return null;
}

/**
 * The creature an archetype earned, or null when there is no archetype or one this build has
 * no creature for. Unlike `animalForArchetype`, never the default crab: a suggestion that is
 * really a fallback would say "picked for how you build" about nothing.
 */
export function suggestedAnimal(archetype: string | null | undefined): Animal | null {
  if (typeof archetype !== 'string') return null;
  const hit =
    (ARCHETYPE_ANIMALS as Record<string, Animal>)[archetype] ?? (CORPUS_ARCHETYPE_ANIMALS as Record<string, Animal>)[archetype];
  return hit ?? null;
}
