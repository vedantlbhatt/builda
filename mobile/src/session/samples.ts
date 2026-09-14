/**
 * The built in sample session, in every state the session screen can be in, so each one can
 * be opened by a deep link and photographed without a Mac, a server or a failing network:
 *
 *   builder://session/sample                    the finished sample (every build)
 *   builder://session/sample?variant=<name>     dev builds only, one of SAMPLE_VARIANTS
 *
 * The finished sample is `data/client.ts`'s SAMPLE_SESSION (passed in, so this module stays
 * pure) with the v4 fields a current capture sends: an engineer voice title, a burn block, a
 * note worth a look and the attended split. The numbers are shaped like this machine's real
 * sessions (MEASURED over the overnight stack's 78 Claude Code sessions: cache reads 93.9% to
 * 99.8% of every session's tokens, 3 costly stretches at most, context replay the dominant
 * cause of nearly every one), and each block is internally consistent: the burn total is the
 * stats ledger's total, the lines are the stats' lines, and every share is its integers over
 * that total, so no two figures on the screen disagree about one quantity.
 *
 * Nothing here is a real person's session: no prompt, no path, no file name, as on the wire.
 */

import type { SessionDetail } from '../data/api';
import type { SessionBurn, SessionCallPoint, SessionCallTokens } from '../generated/contract';
import type { LiveState } from '../generated/live';
import type { LoadFailure } from './load';

export const SAMPLE_VARIANTS = [
  'final',
  'live',
  'refused',
  'short',
  'quiet',
  'stale',
  'loading',
  'missing',
  'error',
  'signedout',
] as const;

export type SampleVariant = (typeof SAMPLE_VARIANTS)[number];

/** A link's `variant`, or `final` for anything this build does not name. */
export function parseSampleVariant(raw: string | string[] | undefined): SampleVariant {
  const v = (Array.isArray(raw) ? raw[0] : raw)?.trim().toLowerCase();
  return (SAMPLE_VARIANTS as readonly string[]).includes(v ?? '') ? (v as SampleVariant) : 'final';
}

export interface SampleOutcome {
  session: SessionDetail | null;
  failure: LoadFailure | null;
}

const MIN = 60;

/** The finished sample's burn: the ledger's 194.11M tokens, 190M of them cache reads. */
const FINAL_BURN: SessionBurn = {
  tokens: 194_110_000,
  cache_read_share: 190_000_000 / 194_110_000,
  barren_share: 6_020_000 / 194_110_000,
  unreadable_share: 16_300_000 / 194_110_000,
  segments: 52,
  lines_added: 2101,
  lines_removed: 186,
  files_changed: 31,
  commits: 5,
  reason: null,
  spikes: [
    {
      tokens: 23_400_000,
      multiple: 8.1,
      barren: false,
      lines_added: 412,
      lines_removed: 37,
      seconds: 2280,
      causes: [
        { cause: 'context_replay', n: 22_610_000, tokens: 22_610_000, repeat: null },
        { cause: 'subagent_fanout', n: 6, tokens: 398_000, repeat: null },
        { cause: 'error_loop', n: 5, tokens: 146_000, repeat: null },
      ],
      files_changed: 7,
      commits: 1,
      unreadable: false,
    },
    {
      tokens: 12_800_000,
      multiple: 4.4,
      barren: true,
      lines_added: 0,
      lines_removed: 0,
      seconds: 1140,
      causes: [
        { cause: 'context_replay', n: 11_930_000, tokens: 11_930_000, repeat: null },
        { cause: 'investigated', n: 23, tokens: 610_000, repeat: null },
      ],
      files_changed: 0,
      commits: 0,
      unreadable: false,
    },
    {
      tokens: 9_650_000,
      multiple: 3.3,
      barren: false,
      lines_added: 96,
      lines_removed: 12,
      seconds: 840,
      causes: [
        { cause: 'context_replay', n: 9_120_000, tokens: 9_120_000, repeat: null },
        { cause: 'file_churn', n: 6, tokens: 290_000, repeat: null },
        { cause: 'repeated_call', n: 4, tokens: 188_000, repeat: 'edit' },
      ],
      files_changed: 1,
      commits: 0,
      unreadable: false,
    },
  ],
  spikes_needed: 5,
};

/** What a sample's calls add up to: the stats ledger's buckets, so no two figures disagree. */
interface CallTotals {
  read: number;
  write: number;
  input: number;
  output: number;
}

/**
 * A sample's `call_tokens` points, shaped like this machine's real sessions and summing EXACTLY
 * to `totals` (the sample's own stats). Deterministic (a Park and Miller generator, seeded), so a
 * screenshot of the sample is the same every time.
 *
 * The shape (MEASURED on the overnight stack's RideGT sittings, 2026-09-13): each call re-reads
 * the conversation so far and writes a little more, a file read now and then writes 8k to 20k,
 * and near 260k the conversation is compacted to about 64k (the drop). When `rewriteAway` is set,
 * call 1 comes back to an expired cache: it re-reads the 24k prefix other sessions keep warm and
 * writes the rest of a 120k conversation again (RideGT `0a050ea3` call 124 has that shape).
 */
function samplePoints(calls: number, span: number, totals: CallTotals, rewriteAway: number | null): SessionCallPoint[] {
  let seed = 20260913;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const read: number[] = [];
  const write: number[] = [];
  const input: number[] = [];
  const output: number[] = [];
  let ctx = rewriteAway != null ? 120_000 : 58_000;
  for (let c = 0; c < calls; c++) {
    if (c === 0 && rewriteAway != null) {
      read.push(24_000);
      write.push(96_000);
    } else if (ctx > 260_000) {
      read.push(24_000);
      write.push(40_000);
      ctx = 64_000;
    } else {
      const w = rnd() < 0.08 ? 8_000 + Math.floor(rnd() * 12_000) : 300 + Math.floor(rnd() * 900);
      read.push(ctx);
      write.push(w);
      ctx += w;
    }
    input.push(1 + Math.floor(rnd() * 3));
    output.push(60 + Math.floor(rnd() * 700));
  }
  // Scale each bucket to its total, the special calls held where they are, and put the
  // rounding's remainder on the last call, so the sums are exact.
  const fit = (xs: number[], total: number, keep: (i: number) => boolean) => {
    const fixed = xs.reduce((t, x, i) => t + (keep(i) ? x : 0), 0);
    const free = xs.reduce((t, x, i) => t + (keep(i) ? 0 : x), 0);
    const k = (total - fixed) / free;
    const out = xs.map((x, i) => (keep(i) ? x : Math.round(x * k)));
    out[out.length - 1]! += total - out.reduce((t, x) => t + x, 0);
    return out;
  };
  const special = (i: number) => (i === 0 && rewriteAway != null) || read[i] === 24_000;
  const r = fit(read, totals.read, special);
  const w = fit(write, totals.write, special);
  const inp = fit(input, totals.input, () => false);
  const out = fit(output, totals.output, () => false);
  const per = Math.max(1, Math.ceil(calls / 240));
  const points: SessionCallPoint[] = [];
  for (let i = 0; i < calls; i += per) {
    const sum = (xs: number[]) => xs.slice(i, i + per).reduce((t, x) => t + x, 0);
    points.push({ at: Math.round(4 + (i / calls) * (span - 60)), cache_read: sum(r), cache_write: sum(w), input: sum(inp), output: sum(out) });
  }
  return points;
}

/** A sample's whole block: the points, the rewrite at call 1 when there is one, and the list
 * prices Opus 5's row in `analysis/pricing.py` gives the totals (read Sep 6: $0.50 a million
 * re-read, $10 written for an hour, $6.25 for five minutes, $5 in, $25 out). */
function sampleCalls(calls: number, span: number, totals: CallTotals, lifetime: 3600 | 300, rewriteAway: number | null): SessionCallTokens {
  const writeRate = lifetime === 3600 ? 10 : 6.25;
  return {
    reason: null,
    calls,
    calls_needed: 5,
    per_point: Math.max(1, Math.ceil(calls / 240)),
    points: samplePoints(calls, span, totals, rewriteAway),
    lifetime_seconds: lifetime,
    rewrites: rewriteAway != null ? [{ call: 1, away_seconds: rewriteAway, written: 96_000 }] : [],
    rewrite_calls: rewriteAway != null ? 1 : 0,
    usd_cache_read: (totals.read * 0.5) / 1e6,
    usd_cache_write: (totals.write * writeRate) / 1e6,
    usd_input: (totals.input * 5) / 1e6,
    usd_output: (totals.output * 25) / 1e6,
    price_reason: null,
  };
}

/** A refused block, as `analysis/calls.py` writes one: every number null but the calls it had. */
function refusedCalls(reason: 'no_token_counts' | 'too_few_calls', calls: number | null): SessionCallTokens {
  return {
    reason,
    calls,
    calls_needed: 5,
    per_point: null,
    points: null,
    lifetime_seconds: null,
    rewrites: null,
    rewrite_calls: null,
    usd_cache_read: null,
    usd_cache_write: null,
    usd_input: null,
    usd_output: null,
    price_reason: null,
  };
}

function finalSample(base: SessionDetail): SessionDetail {
  return {
    ...base,
    // A current capture sends the lines the agent removed (overnight-integration 5.4); the base
    // predates it. The same 186 burn counts, so the ledger's red line and burn agree.
    // ... and writes to the cache with the ONE HOUR lifetime, as Claude Code does (17,575 of
    // 17,575 writes on this machine, analysis/calls.py), so the 1.6M written are one hour writes.
    stats: base.stats
      ? { ...base.stats, lines_removed_agent: FINAL_BURN.lines_removed ?? undefined, tok_cache_w5m: 0, tok_cache_w1h: base.stats.tok_cache_w5m }
      : base.stats,
    state: 'final',
    end_reason: 'idle_gap',
    attended_seconds: 15_120,
    autonomous_seconds: base.active_seconds - 15_120,
    presence_count: 58,
    title_ids: { verb: 'shipped', object: 'source', n: 9, modules: 4 },
    burn: FINAL_BURN,
    // 1,270 calls, 6 to a bar, the first back 3h 10m after the morning's last call.
    call_tokens: sampleCalls(1270, 24_480, { read: 190_000_000, write: 1_600_000, input: 2_100_000, output: 410_000 }, 3600, 11_400),
    feedback: [{ id: 'one_file_over_and_over', seconds: 1320, count: 6 }],
    live_state: null,
    live_names: null,
  };
}

/** A strip's marks moved onto a shorter span, so they land where they did on the long one. */
function rescaleStrip(base: SessionDetail, startMs: number, spanMs: number): SessionDetail['strip'] {
  const strip = base.strip;
  if (!strip) return null;
  const from = Math.max(1, strip.t1_ms - strip.t0_ms);
  return {
    ...strip,
    marks: strip.marks.map(([ms, k]) => [Math.round(((ms ?? 0) * spanMs) / from), k ?? 0]),
    t0_ms: startMs,
    t1_ms: startMs + spanMs,
  };
}

const F = {
  store: '3f9a0c1d2e4b5a69',
  map: '8c21d0e4f7a3b915',
  guidance: 'a1b2c3d4e5f60718',
  test: '5d7e9f0a1b2c3d4e',
  docs: 'e0f1a2b3c4d5e6f7',
  config: '7a8b9c0d1e2f3a4b',
  dir: '0c1d2e3f4a5b6c7d',
} as const;

function liveState(startSec: number, nowSec: number): LiveState {
  // A frame every minute or so across the 42 minutes, reads early, edits later, two failing
  // runs on the churned file: the shape a circling stretch has.
  const timelapse: LiveState['timelapse'] = [];
  const files = [F.store, F.map, F.guidance, F.test, F.docs];
  for (let t = 0; t <= 2520; t += 63) {
    const i = Math.floor(t / 63);
    const kind = t > 1900 && i % 5 === 0 ? 'fail' : t > 900 ? 'edit' : 'read';
    timelapse.push({ t, file_id: kind === 'fail' ? F.guidance : files[i % files.length]!, kind });
  }
  return {
    live_version: 1,
    computed_at: new Date((nowSec - 30) * 1000).toISOString(),
    activity: { kind: 'editing', role: 'source', attempt: 3, since_s: 95, files: 1, calls: 4, file_id: F.guidance },
    verdict: {
      state: 'circling',
      basis: 'causes:file_churn_with_failures',
      reason: null,
      file_id: F.guidance,
      evidence: {
        window_calls: 12,
        errors_now: 3,
        errors_before: 1,
        new_files: 0,
        checkpoints: 4,
        repeats: 0,
        churn_writes: 4,
        fail_run: 2,
        blind_edits: 0,
        stuck_s: 380,
        files_changed: 6,
        commits: 1,
        background: 0,
      },
    },
    eta: {
      elapsed_s: 2520,
      typical_s: null,
      p25_s: null,
      p75_s: null,
      remaining_s: null,
      n: 5,
      needed: 10,
      unattended: false,
      basis: 'finished_sessions_same_repo_that_ran_at_least_this_long',
      reason: 'too_few_sessions',
    },
    decisions: [
      { kind: 'reverted_changes', ts: startSec + 23 * MIN, event_n: 212, count: 1 },
      { kind: 'added_dependency', ts: startSec + 35 * MIN, event_n: 340, count: 2 },
    ],
    needs_you: { score: 66, reason: 'circling' },
    map: {
      files: [
        { id: F.guidance, dir_id: F.dir, role: 'source', depth: 2, reads: 3, edits: 5, last_read_ts: nowSec - 700, last_edit_ts: nowSec - 95 },
        { id: F.map, dir_id: F.dir, role: 'source', depth: 2, reads: 4, edits: 2, last_read_ts: nowSec - 900, last_edit_ts: nowSec - 610 },
        { id: F.store, dir_id: F.dir, role: 'source', depth: 2, reads: 2, edits: 1, last_read_ts: nowSec - 1500, last_edit_ts: nowSec - 1200 },
        { id: F.test, dir_id: null, role: 'test', depth: 1, reads: 1, edits: 1, last_read_ts: nowSec - 800, last_edit_ts: nowSec - 640 },
        { id: F.docs, dir_id: null, role: 'docs', depth: 0, reads: 1, edits: 0, last_read_ts: nowSec - 2400, last_edit_ts: null },
        { id: F.config, dir_id: null, role: 'config', depth: 0, reads: 2, edits: 0, last_read_ts: nowSec - 2300, last_edit_ts: null },
      ],
      files_total: 25,
    },
    timelapse,
    sample: { events: 412, tool_calls: 131, segments: 9, tokens: 32_691_100 },
  };
}

function liveSample(base: SessionDetail, nowMs: number): SessionDetail {
  const startMs = nowMs - 47 * MIN * 1000;
  const lastMs = nowMs - 20_000;
  return {
    ...base,
    id: 'sample',
    state: 'live',
    end_reason: 'still_running',
    started_at: new Date(startMs).toISOString(),
    ended_at: new Date(lastMs).toISOString(),
    updated_at: new Date(nowMs - 30_000).toISOString(),
    active_seconds: 2520,
    idle_seconds: 280,
    attended_seconds: 2280,
    autonomous_seconds: 240,
    presence_count: 9,
    notable: false,
    strip: rescaleStrip(base, startMs, lastMs - startMs),
    stats: {
      tokens_reported: true,
      tok_in: 3_100,
      tok_out: 88_000,
      tok_cache_read: 31_200_000,
      tok_cache_w5m: 1_400_000,
      tok_cache_w1h: 0,
      models: [{ model_id: 'claude-opus-5', output_token_share: 1 }],
      model_state: 'known',
      human_prompt_count: 9,
      prompt_count_basis: 'typed_promptsource',
      files_touched: 14,
      lines_added_agent: 486,
      lines_removed_agent: 61,
      commit_count: 1,
      agent_line_bucket: 'nine_in_ten',
      attrib_confidence: 'high',
    },
    title_ids: { verb: 'edited', object: 'source', n: 3, modules: 1 },
    burn: {
      tokens: 32_691_100,
      cache_read_share: 31_200_000 / 32_691_100,
      barren_share: 0,
      unreadable_share: 2_290_000 / 32_691_100,
      segments: 9,
      lines_added: 486,
      lines_removed: 61,
      files_changed: 6,
      commits: 1,
      reason: null,
      spikes: [
        {
          tokens: 9_800_000,
          multiple: 3.6,
          barren: false,
          lines_added: 210,
          lines_removed: 40,
          seconds: 610,
          causes: [
            { cause: 'context_replay', n: 9_310_000, tokens: 9_310_000, repeat: null },
            { cause: 'subagent_fanout', n: 3, tokens: 212_000, repeat: null },
          ],
          files_changed: 3,
          commits: 0,
          unreadable: false,
        },
      ],
      spikes_needed: 5,
    },
    call_tokens: sampleCalls(220, 2520, { read: 31_200_000, write: 1_400_000, input: 3_100, output: 88_000 }, 300, null),
    feedback: null,
    analysis: null,
    live_state: liveState(Math.floor(startMs / 1000), Math.floor(nowMs / 1000)),
    live_names: null,
  };
}

function refusedSample(base: SessionDetail): SessionDetail {
  return {
    ...base,
    harness: 'cursor_ide',
    state: 'final',
    end_reason: 'idle_gap',
    active_seconds: 4320,
    attended_seconds: 3480,
    autonomous_seconds: 840,
    presence_count: 16,
    title: null,
    title_ids: { verb: 'edited', object: 'source', n: 6, modules: 2 },
    stats: {
      tokens_reported: false,
      tok_in: null,
      tok_out: null,
      tok_cache_read: null,
      tok_cache_w5m: null,
      tok_cache_w1h: null,
      models: null,
      model_state: 'unknown',
      human_prompt_count: 14,
      prompt_count_basis: 'user_bubble',
      files_touched: 9,
      lines_added_agent: 318,
      lines_removed_agent: 40,
      commit_count: 2,
      agent_line_bucket: 'three_in_four',
      attrib_confidence: 'low',
    },
    burn: {
      tokens: null,
      cache_read_share: null,
      barren_share: null,
      unreadable_share: null,
      segments: 14,
      lines_added: 318,
      lines_removed: 40,
      files_changed: 6,
      commits: 2,
      reason: 'no_token_counts',
      spikes: null,
      spikes_needed: 5,
    },
    call_tokens: refusedCalls('no_token_counts', null),
    feedback: null,
    analysis: null,
    live_state: null,
    live_names: null,
  };
}

function shortSample(base: SessionDetail): SessionDetail {
  return {
    ...base,
    state: 'final',
    end_reason: 'idle_gap',
    active_seconds: 1080,
    attended_seconds: 1080,
    autonomous_seconds: 0,
    presence_count: 3,
    title_ids: { verb: 'debugged', object: 'test_suite', n: 1, modules: 1 },
    stats: {
      tokens_reported: true,
      tok_in: 900,
      tok_out: 14_100,
      tok_cache_read: 1_220_000,
      tok_cache_w5m: 5_000,
      tok_cache_w1h: 0,
      models: [{ model_id: 'claude-opus-5', output_token_share: 1 }],
      model_state: 'known',
      human_prompt_count: 3,
      prompt_count_basis: 'typed_promptsource',
      files_touched: 2,
      lines_added_agent: 12,
      lines_removed_agent: 3,
      commit_count: 0,
      agent_line_bucket: 'almost_all_agent',
      attrib_confidence: 'high',
    },
    burn: {
      tokens: 1_240_000,
      cache_read_share: 1_220_000 / 1_240_000,
      barren_share: 0,
      unreadable_share: 0,
      segments: 3,
      lines_added: 12,
      lines_removed: 3,
      files_changed: 1,
      commits: 0,
      reason: null,
      spikes: null,
      spikes_needed: 5,
    },
    call_tokens: refusedCalls('too_few_calls', 4),
    feedback: null,
    analysis: null,
    live_state: null,
    live_names: null,
  };
}

/** A session from a producer that computes none of the v4 fields: the sections stay quiet. */
function quietSample(base: SessionDetail): SessionDetail {
  return {
    ...base,
    state: 'final',
    title_ids: null,
    burn: null,
    call_tokens: null,
    feedback: null,
    analysis: null,
    live_state: null,
    live_names: null,
  };
}

/**
 * What the screen shows for `variant`. `offline` is the api's own sentence for no answer at
 * all (`OFFLINE_MESSAGE`), passed in so this module needs nothing but types from the api.
 * `loading` never resolves: the skeleton stays up to be photographed.
 */
export function sampleOutcome(base: SessionDetail, variant: SampleVariant, nowMs: number, offline: string): SampleOutcome {
  switch (variant) {
    case 'final':
      return { session: finalSample(base), failure: null };
    case 'stale':
      return { session: finalSample(base), failure: { status: 0, message: offline } };
    case 'live':
      return { session: liveSample(base, nowMs), failure: null };
    case 'refused':
      return { session: refusedSample(base), failure: null };
    case 'short':
      return { session: shortSample(base), failure: null };
    case 'quiet':
      return { session: quietSample(base), failure: null };
    case 'loading':
      return { session: null, failure: null };
    case 'missing':
      return { session: null, failure: { status: 404, message: 'session not found' } };
    case 'error':
      return { session: null, failure: { status: 0, message: offline } };
    case 'signedout':
      return { session: null, failure: { status: 401, message: 'not signed in' } };
  }
}
