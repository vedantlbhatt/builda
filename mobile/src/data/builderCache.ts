/**
 * The saved copy of `GET /v1/profile/builder`, and the one place it is written.
 *
 * Three screens keep the response between launches under one key (`BUILDER_KEY`,
 * `profile.builder.v1`): the You tab, the analysis page and the Wrapped deck. The response
 * can carry `quotes`, up to three of the owner's prompts verbatim, while Quote my prompts is on.
 * They are owner only and shown by the Wrapped deck alone, from its own fresh fetch; nothing
 * reads them from the saved copy. FOUND IN THE ADVERSARIAL REVIEW (2026-09-13): the deck
 * dropped them before saving and the other two saved the response whole, so the prompts sat in
 * this phone's SQLite, and turning the switch off (which deletes them on the server) never
 * touched them. Every save goes through `saveBuilderProfile` now, which drops them, and turning
 * quotes off runs `forgetCachedQuotes` over a copy an older build saved, as File names off runs
 * `cache.forgetLiveNames`.
 *
 * The store is passed in (the cache module itself, in the app) so `bun test` runs this without
 * SQLite: `__tests__/builderCache.test.ts`.
 */
import { BUILDER_KEY } from '../you/keys';
import type { BuilderProfileResponse } from './api';

/** The two calls this needs from the cache (`src/data/cache.ts` has both). */
export interface BuilderKv {
  getKv(k: string): Promise<string | null>;
  setKv(k: string, v: string): Promise<void>;
}

/** The response without its quotes: the only shape that is ever saved. */
export function withoutQuotes(b: BuilderProfileResponse): Omit<BuilderProfileResponse, 'quotes'> {
  const { quotes: _dropped, ...rest } = b;
  return rest;
}

/** Save the builder profile for the next launch, never with a quote in it. */
export async function saveBuilderProfile(b: BuilderProfileResponse, kv: BuilderKv): Promise<void> {
  await kv.setKv(BUILDER_KEY, JSON.stringify(withoutQuotes(b)));
}

/**
 * Quote my prompts went off: rewrite the saved copy without its quotes if it has any. True
 * when a copy was rewritten; a missing copy, one with no quotes, or a blob from an older shape
 * (which every reader drops unread) is left alone.
 */
export async function forgetCachedQuotes(kv: BuilderKv): Promise<boolean> {
  const raw = await kv.getKv(BUILDER_KEY);
  if (!raw) return false;
  let saved: unknown;
  try {
    saved = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!saved || typeof saved !== 'object' || !('quotes' in saved)) return false;
  await kv.setKv(BUILDER_KEY, JSON.stringify(withoutQuotes(saved as BuilderProfileResponse)));
  return true;
}
