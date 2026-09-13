/**
 * The saved builder profile never holds a word the owner typed.
 *
 * FOUND IN THE ADVERSARIAL REVIEW (2026-09-13): three screens save `GET /v1/profile/builder`
 * under one key (`profile.builder.v1`). The Wrapped deck dropped `quotes` before saving; the
 * You tab and the analysis page saved the response whole, so up to three verbatim prompts sat
 * in this phone's SQLite, and turning Quote my prompts off (which deletes them on the server)
 * never touched them here. One writer now drops them every time, and turning quotes off
 * rewrites the copy an older build saved, as File names off clears the cached names.
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import type { BuilderProfileResponse } from '../src/data/api';
import { forgetCachedQuotes, saveBuilderProfile } from '../src/data/builderCache';
import { BUILDER_KEY } from '../src/you/keys';

const MOBILE = join(import.meta.dir, '..');
const QUOTE = 'zqx sentinel prompt the owner typed';

function memKv() {
  const m = new Map<string, string>();
  return { m, getKv: async (k: string) => m.get(k) ?? null, setKv: async (k: string, v: string) => void m.set(k, v) };
}

function profile(): BuilderProfileResponse {
  return {
    window_days: 90,
    corpus: null,
    report: null,
    quotes: {
      quotes_version: 1,
      generated_at: '2026-09-13T10:00:00Z',
      quotes: [{ card: 'go_to_prompt', text: QUOTE, client_session_id: 'a'.repeat(64), sent_at: '2026-09-12T10:00:00Z', seconds_in: 42, tool_calls_after: null, corrected: null }],
    },
  } as unknown as BuilderProfileResponse;
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe('the saved builder profile', () => {
  test('is saved without its quotes, and with everything else', async () => {
    const kv = memKv();
    await saveBuilderProfile(profile(), kv);
    const saved = kv.m.get(BUILDER_KEY)!;
    expect(saved).not.toContain(QUOTE);
    expect(JSON.parse(saved)).toEqual({ window_days: 90, corpus: null, report: null });
  });

  test('turning quotes off rewrites a copy that still holds them, and keeps the rest', async () => {
    const kv = memKv();
    kv.m.set(BUILDER_KEY, JSON.stringify(profile()));
    expect(await forgetCachedQuotes(kv)).toBe(true);
    expect(kv.m.get(BUILDER_KEY)).not.toContain(QUOTE);
    expect(JSON.parse(kv.m.get(BUILDER_KEY)!).window_days).toBe(90);
    // Nothing saved, a copy with no quotes, or a blob from an older shape: nothing to rewrite.
    expect(await forgetCachedQuotes(memKv())).toBe(false);
    expect(await forgetCachedQuotes(kv)).toBe(false);
    const junk = memKv();
    junk.m.set(BUILDER_KEY, '{not json');
    expect(await forgetCachedQuotes(junk)).toBe(false);
  });

  test('every screen saves it through the one writer', () => {
    const writers: string[] = [];
    for (const f of [...files(join(MOBILE, 'src')), ...files(join(MOBILE, 'app'))]) {
      const src = readFileSync(f, 'utf8');
      if (/setKv\(\s*(BUILDER_KEY|BUILDER_PROFILE_KEY|'profile\.builder\.v1')/.test(src)) writers.push(relative(MOBILE, f));
    }
    expect(writers).toEqual(['src/data/builderCache.ts']);
    for (const f of ['src/you/hooks.ts', 'src/insights/useAnalysis.ts', 'src/wrapped/useWrappedDeck.ts']) {
      expect({ f, uses: readFileSync(join(MOBILE, f), 'utf8').includes('saveBuilderProfile(') }).toEqual({ f, uses: true });
    }
  });
});
