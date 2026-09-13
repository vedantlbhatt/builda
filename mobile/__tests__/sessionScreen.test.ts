/**
 * The session screen around its words: which state it is in (`load.ts`), the decision feed
 * (`decisions.ts`), the links to the map and the time lapse (`links.ts`), the built in
 * sample in every state (`samples.ts`) and the deep links that open each one, and the kit
 * rules the screen's new components are held to (the ones `screens.test.ts` holds the refit
 * screens to, over the files this screen added).
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { hasDash } from '../src/copy/plain';
import type { SessionDetail } from '../src/data/api';
import { LIVE_ENUMS, type LiveDecision } from '../src/generated/live';
import { decisionRows } from '../src/session/decisions';
import { sessionLinks } from '../src/session/links';
import { resolveSessionLoad, staleLine } from '../src/session/load';
import { parseSampleVariant, SAMPLE_VARIANTS, sampleOutcome } from '../src/session/samples';
import { burnView } from '../src/session/burnView';
import { sessionTitle, summarySentences } from '../src/session/summary';

const MOBILE = join(import.meta.dir, '..');
const OFFLINE = 'Builder is not reachable right now.';

const BASE = {
  id: 'sample',
  client_session_id: 'sample',
  harness: 'claude_code',
  repo_name: 'gt-transit',
  started_at: '2026-08-29T13:12:00Z',
  ended_at: '2026-08-29T20:00:00Z',
  active_seconds: 19_020,
  idle_seconds: 5460,
  local_date: '2026-08-29',
  title: 'Wire live vehicle positions into the guidance map',
  title_source: 'harness',
  notable: true,
  unattended: false,
  timeline_fidelity: 'full',
  is_shared: false,
  post_id: null,
  strip: { cols: '', marks: [[0, 0], [6_120_000, 0], [24_474_000, 0]], t0_ms: 0, t1_ms: 24_480_000 },
  stats: {
    tokens_reported: true,
    tok_in: 2_100_000,
    tok_out: 410_000,
    tok_cache_read: 190_000_000,
    tok_cache_w5m: 1_600_000,
    tok_cache_w1h: 0,
    models: [{ model_id: 'claude-opus-5', output_token_share: 1 }],
    model_state: 'known',
    human_prompt_count: 52,
    prompt_count_basis: 'typed_promptsource',
    files_touched: 38,
    lines_added_agent: 2101,
    commit_count: 7,
    agent_line_bucket: 'nine_in_ten',
    attrib_confidence: 'high',
  },
} satisfies SessionDetail;

const NOW = Date.parse('2026-09-13T08:00:00Z');

// ------------------------------------------------------------------ states

describe('which state the screen is in', () => {
  const s = BASE as SessionDetail;

  test('nothing yet and nothing failed: the skeleton', () => {
    expect(resolveSessionLoad(null, null)).toEqual({ kind: 'loading' });
  });

  test('a saved session is never thrown away because a refresh failed: it is shown, stale, with the reason', () => {
    expect(resolveSessionLoad(s, null)).toEqual({ kind: 'ready', session: s, stale: null });
    expect(resolveSessionLoad(s, { status: 0, message: OFFLINE })).toEqual({
      kind: 'ready',
      session: s,
      stale: 'Builder is not reachable right now. Showing what this phone saved.',
    });
  });

  test('with nothing saved: signed out, not here, or the failure itself', () => {
    expect(resolveSessionLoad(null, { status: 401, message: 'not signed in' })).toEqual({ kind: 'signedOut' });
    expect(resolveSessionLoad(null, { status: 404, message: 'session not found' })).toEqual({ kind: 'missing' });
    expect(resolveSessionLoad(null, { status: 403, message: 'forbidden' })).toEqual({ kind: 'missing' });
    expect(resolveSessionLoad(null, { status: 0, message: OFFLINE })).toEqual({ kind: 'error', message: OFFLINE });
    expect(resolveSessionLoad(null, { status: 500, message: 'internal server error' })).toEqual({
      kind: 'error',
      message: 'Internal server error.',
    });
    expect(resolveSessionLoad(null, { status: -1, message: '  ' })).toEqual({ kind: 'error', message: 'Something went wrong on the way.' });
  });

  test('the stale line is one sentence per part, whatever the message looked like', () => {
    expect(staleLine('builder took too long to answer')).toBe('Builder took too long to answer. Showing what this phone saved.');
    expect(staleLine('Builder took too long to answer.')).toBe('Builder took too long to answer. Showing what this phone saved.');
  });

  test('a running session re-reads itself on the live list\'s own beat, the one constant, never a second one', () => {
    const screen = readFileSync(join(MOBILE, 'app', 'session', '[id].tsx'), 'utf8');
    expect(screen).toContain("import { LIVE_REFRESH_MS } from '../../src/live/LiveSessions';");
    expect(screen).toMatch(/setInterval\(.*, LIVE_REFRESH_MS\)/);
    expect(/LIVE_REFRESH_MS\s*=/.test(screen)).toBe(false);
  });
});

// ------------------------------------------------------------------ decisions

describe('the decision feed', () => {
  const t0 = Date.parse(BASE.started_at) / 1000;
  const d = (over: Partial<LiveDecision>): LiveDecision => ({ kind: 'added_dependency', ts: t0 + 600, event_n: 9, count: 1, ...over });

  test('the engine\'s order, its sentences, when each first happened and how often', () => {
    expect(
      decisionRows([d({ kind: 'reverted_changes', ts: t0 + 23 * 60 }), d({ kind: 'added_dependency', ts: t0 + 35 * 60, count: 2 })], BASE.started_at)
    ).toEqual([
      { key: 'reverted_changes', title: 'Threw away uncommitted changes.', meta: '23 minutes in' },
      { key: 'added_dependency', title: 'Added a dependency.', meta: '35 minutes in · twice' },
    ]);
    expect(decisionRows([d({ count: 4 })], BASE.started_at)[0]!.meta).toBe('10 minutes in · four times');
  });

  test('a kind this build cannot say is no row, and a clock before the start says no time', () => {
    expect(decisionRows([d({ kind: 'rewrote_history' as LiveDecision['kind'] }), d({})], BASE.started_at).map((r) => r.key)).toEqual([
      'added_dependency',
    ]);
    expect(decisionRows([d({ ts: t0 - 5 })], BASE.started_at)[0]!.meta).toBeNull();
    expect(decisionRows([d({ ts: t0 - 5, count: 3 })], BASE.started_at)[0]!.meta).toBe('three times');
  });

  test('no live state is no rows, never "no decisions"', () => {
    expect(decisionRows(null, BASE.started_at)).toEqual([]);
    expect(decisionRows(undefined, BASE.started_at)).toEqual([]);
  });

  test('every decision the live spec declares has a row', () => {
    for (const kind of LIVE_ENUMS.decision_kind) {
      const rows = decisionRows([d({ kind })], BASE.started_at);
      expect({ kind, n: rows.length, dash: hasDash(rows[0]?.title ?? '') }).toEqual({ kind, n: 1, dash: false });
    }
  });
});

// ------------------------------------------------------------------ links

describe('the map and the time lapse are offered only when their data is on the session', () => {
  const live = sampleOutcome(BASE, 'live', NOW, OFFLINE).session!;

  test('a finished session has no live state, so no link', () => {
    expect(sessionLinks({ id: 'abc', live_state: null })).toEqual([]);
    expect(sessionLinks({ id: 'abc', live_state: undefined })).toEqual([]);
  });

  test('both, with what each holds, and the typed route with the session id', () => {
    expect(sessionLinks({ id: 'abc', live_state: live.live_state })).toEqual([
      { key: 'map', title: 'Codebase map', meta: '25 project files it touched', href: { pathname: '/you/map/[id]', params: { id: 'abc' } } },
      {
        key: 'timelapse',
        title: 'Time lapse',
        meta: '42 minutes of the work, replayed',
        href: { pathname: '/you/timelapse/[id]', params: { id: 'abc' } },
      },
    ]);
  });

  test('the slim body the live list serves (no time lapse, the map cut) offers only the map', () => {
    const slim = { ...live.live_state!, timelapse: null };
    expect(sessionLinks({ id: 'abc', live_state: slim }).map((l) => l.key)).toEqual(['map']);
    const empty = { ...live.live_state!, map: { files: [], files_total: 0 }, timelapse: [] };
    expect(sessionLinks({ id: 'abc', live_state: empty })).toEqual([]);
  });

  test('the sample carries its variant through, so the page behind the link can draw the same sample', () => {
    expect(sessionLinks(live, 'live')[0]!.href.params).toEqual({ id: 'sample', variant: 'live' });
  });
});

// ------------------------------------------------------------------ samples

describe('the sample, in every state', () => {
  test('a link names a variant, and anything else is the finished sample', () => {
    expect(parseSampleVariant('live')).toBe('live');
    expect(parseSampleVariant(['refused', 'live'])).toBe('refused');
    expect(parseSampleVariant(' Stale ')).toBe('stale');
    expect(parseSampleVariant('bogus')).toBe('final');
    expect(parseSampleVariant(undefined)).toBe('final');
  });

  test('each variant resolves to the state it is named for', () => {
    const kinds = Object.fromEntries(
      SAMPLE_VARIANTS.map((v) => {
        const out = sampleOutcome(BASE, v, NOW, OFFLINE);
        const load = resolveSessionLoad(out.session, out.failure);
        return [v, load.kind === 'ready' ? (load.stale ? 'stale' : `ready:${load.session.state}`) : load.kind];
      })
    );
    expect(kinds).toEqual({
      final: 'ready:final',
      live: 'ready:live',
      refused: 'ready:final',
      short: 'ready:final',
      quiet: 'ready:final',
      stale: 'stale',
      loading: 'loading',
      missing: 'missing',
      error: 'error',
      signedout: 'signedOut',
    });
  });

  test('each shows the section state it exists to show', () => {
    const view = (v: (typeof SAMPLE_VARIANTS)[number]) => burnView(sampleOutcome(BASE, v, NOW, OFFLINE).session!);
    expect(view('final').kind).toBe('ready');
    expect(view('refused')).toEqual({ kind: 'refused', sentence: 'Cost is not shown for this tool yet.' });
    expect(view('quiet').kind).toBe('absent');
    const short = view('short');
    expect(short.kind === 'ready' && short.spikes.length === 0 && short.spikesNote !== null).toBe(true);
    expect(sessionTitle(sampleOutcome(BASE, 'quiet', NOW, OFFLINE).session!)).toEqual({ text: BASE.title, from: 'harness' });
  });

  test('no two figures on one sample disagree: the burn total is the ledger\'s, the lines are the stats\'', () => {
    for (const v of ['final', 'live', 'short'] as const) {
      const s = sampleOutcome(BASE, v, NOW, OFFLINE).session!;
      const st = s.stats!;
      const ledger = (st.tok_in ?? 0) + (st.tok_out ?? 0) + (st.tok_cache_read ?? 0) + (st.tok_cache_w5m ?? 0) + (st.tok_cache_w1h ?? 0);
      expect({ v, tokens: s.burn!.tokens }).toEqual({ v, tokens: ledger });
      expect({ v, lines: s.burn!.lines_added }).toEqual({ v, lines: st.lines_added_agent });
      if (typeof st.lines_removed_agent === 'number') expect({ v, removed: s.burn!.lines_removed }).toEqual({ v, removed: st.lines_removed_agent });
      expect({ v, cache: s.burn!.cache_read_share }).toEqual({ v, cache: (st.tok_cache_read ?? 0) / ledger });
      const burn = burnView(s);
      expect({ v, note: burn.kind === 'ready' ? burn.ledgerNote : 'none' }).toEqual({ v, note: null });
    }
  });

  test('the live sample\'s refused ETA is said under the live bar as a sentence, with its numbers', async () => {
    // `mission.ts` is the mission control workflow's; its `etaDetail` is documented as the
    // session screen's line, and the screen shows it for a running session.
    const { etaDetail } = await import('../src/live/mission');
    const live = sampleOutcome(BASE, 'live', NOW, OFFLINE).session!;
    expect(etaDetail(live.live_state!.eta)).toBe('No ETA yet: 5 finished sessions on this repository, 10 needed.');
  });

  test('the live sample is a valid live state: spec enums, 16 hex ids, a decision per kind at most', () => {
    const live = sampleOutcome(BASE, 'live', NOW, OFFLINE).session!.live_state!;
    expect(LIVE_ENUMS.activity_kind).toContain(live.activity!.kind);
    expect(LIVE_ENUMS.verdict_state).toContain(live.verdict.state!);
    expect(LIVE_ENUMS.verdict_basis).toContain(live.verdict.basis!);
    expect(LIVE_ENUMS.eta_refusal).toContain(live.eta.reason!);
    expect(LIVE_ENUMS.needs_you_reason).toContain(live.needs_you.reason);
    const ids = [...live.map!.files.map((f) => f.id), ...live.timelapse!.map((f) => f.file_id)];
    for (const id of ids) expect(/^[0-9a-f]{16}$/.test(id)).toBe(true);
    expect(new Set(live.decisions.map((d) => d.kind)).size).toBe(live.decisions.length);
    expect(live.decisions.length).toBeLessThanOrEqual(4);
    expect(live.timelapse!.length).toBeLessThanOrEqual(600);
    for (const f of live.timelapse!) expect(LIVE_ENUMS.frame_kind).toContain(f.kind);
  });

  test('every sample paragraph is dash free and says something', () => {
    for (const v of SAMPLE_VARIANTS) {
      const s = sampleOutcome(BASE, v, NOW, OFFLINE).session;
      if (!s) continue;
      const said = summarySentences(s);
      expect(said.length).toBeGreaterThan(0);
      for (const x of said) expect({ v, x, dash: hasDash(x) }).toEqual({ v, x, dash: false });
    }
  });

  test('every variant is in the deep link list, so the screenshot pass can open it', () => {
    const doc = readFileSync(join(MOBILE, 'src', 'nav', 'DEEPLINKS.md'), 'utf8');
    for (const v of SAMPLE_VARIANTS.filter((x) => x !== 'final')) {
      expect({ v, listed: doc.includes(`builder://session/sample?variant=${v}`) }).toEqual({ v, listed: true });
    }
  });
});

// ------------------------------------------------------------------ the kit rules, over the new files

/** Source with comments removed, as `screens.test.ts` reads it. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

const FILES = [
  'app/session/[id].tsx',
  ...readdirSync(join(MOBILE, 'src', 'session'))
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => `src/session/${f}`),
].map((name) => ({ name, src: readFileSync(join(MOBILE, name), 'utf8') }));

describe('the session screen\'s components build from the kit', () => {
  test('it reads every component the screen added', () => {
    expect(FILES.map((f) => f.name)).toEqual(
      expect.arrayContaining([
        'src/session/BurnSection.tsx',
        'src/session/DecisionList.tsx',
        'src/session/SessionLinks.tsx',
        'src/session/SessionStates.tsx',
        'src/session/TitleLine.tsx',
      ])
    );
  });

  test('text goes through <T>, sizes through the roles, radii through the rule and all continuous', () => {
    for (const f of FILES) {
      const c = code(f.src);
      const imports = c.match(/import\s*\{([^}]*)\}\s*from\s*'react-native'/g) ?? [];
      const bareText = imports.some((i) => /[{,\s]Text[,\s}]/.test(i));
      const fontSize = c.match(/fontSize:\s*\d+/g) ?? [];
      const literalRadius = c.match(/borderRadius:\s*\d+/g) ?? [];
      const radii = (c.match(/borderRadius[:=]/g) ?? []).length;
      const curves = (c.match(/borderCurve:\s*'continuous'/g) ?? []).length;
      expect({ file: f.name, bareText, fontSize, literalRadius, curves }).toEqual({
        file: f.name,
        bareText: false,
        fontSize: [],
        literalRadius: [],
        curves: radii,
      });
    }
  });

  test('no hand rolled Section, Row, Stat, Card or Button; no amber outline, gradient or emoji', () => {
    for (const f of FILES) {
      const c = code(f.src);
      const local = [...c.matchAll(/function (Section|Row|Stat|Card|Button|Chip)\b/g)].map((m) => m[1]);
      const amber = c.match(/border(?:Left|Top|Right|Bottom)?Color:[^,}\n]*\bc\.accent\b/g) ?? [];
      expect({ file: f.name, local, amber, gradient: /Gradient\b/.test(c), emoji: /\p{Extended_Pictographic}/u.test(f.src) }).toEqual({
        file: f.name,
        local: [],
        amber: [],
        gradient: false,
        emoji: false,
      });
    }
  });

  test('section labels are lower case words, never capitals', () => {
    for (const f of FILES) {
      const labels = [...code(f.src).matchAll(/<Section label="([^"]+)"/g)].map((m) => m[1]!);
      for (const l of labels) expect({ file: f.name, l, lower: l === l.toLocaleLowerCase() || l === 'Numbers' || l === 'Analysis' }).toEqual({ file: f.name, l, lower: true });
    }
  });
});
