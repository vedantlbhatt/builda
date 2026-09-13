/**
 * The built in sample for the codebase map and the time lapse, so both screens can be opened
 * and photographed without a running session:
 *
 *   builder://you/map/sample                 a 64 minute session that got stuck and broke out
 *   builder://you/map/sample?variant=circling    the same session while it was stuck
 *   builder://you/map/sample?variant=names       with the opt in file names
 *   builder://you/map/sample?variant=cut         more files touched than the map keeps (400)
 *   builder://you/map/sample?variant=empty       a session that has touched nothing yet
 *
 * (and the same for `you/timelapse/sample`). Any other `variant` is the session screen's
 * (`src/session/samples.ts`), so a link from its sample opens the sample it was showing.
 *
 * Not a real person's session: a fictional transit app, its paths only ever hashed into ids
 * here (and spoken as basenames in the `names` variant, as `live_names` would carry them).
 * The shape is what real sittings do (docs/approved-roadmap.md 2.8): read around, build,
 * get stuck on three files with failures between rewrites, then change a spread of files at
 * the end. Every number is derived from the frames, so the map, the counts and the replay
 * cannot disagree. Deterministic: no clock but the `nowMs` passed in, no random.
 *
 * Pure: no React Native, so `bun test` holds it.
 */

import type { SessionDetail } from '../data/api';
import type { FrameKind, LiveFile, LiveFrame, LiveNames, LiveState, PlainRole } from '../generated/live';
import { MAX_FRAMES, thinFrames } from './frames';

export const MAP_SAMPLE_VARIANTS = ['map', 'circling', 'names', 'cut', 'empty'] as const;
export type MapSampleVariant = (typeof MAP_SAMPLE_VARIANTS)[number];

/** A link's `variant` when it is one of these; none (the default sample) counts as `map`. */
export function mapSampleVariant(raw: string | string[] | undefined): MapSampleVariant | null {
  const v = (Array.isArray(raw) ? raw[0] : raw)?.trim().toLowerCase();
  if (!v) return 'map';
  return (MAP_SAMPLE_VARIANTS as readonly string[]).includes(v) ? (v as MapSampleVariant) : null;
}

// ------------------------------------------------------------------ ids

/** FNV-1a over the UTF-16 units of `s`, from `seed`, as 8 hex characters. */
function fnv(s: string, seed: number): string {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** A 16 hex id for a sample path: the shape `live._hash` gives a real one, from no salt. */
export function sampleId(path: string): string {
  return fnv(path, 0x811c9dc5) + fnv(path, 0x050c5d1f);
}

// ------------------------------------------------------------------ the repository

const R: Record<string, PlainRole> = { s: 'source', t: 'test', c: 'config', d: 'docs', m: 'migration', p: 'dependency' };

/** `folder: role code + file name`, a fictional transit app. */
const TREE: readonly (readonly [string, readonly string[]])[] = [
  ['', ['d:README.md', 'p:package.json', 'c:app.config.ts', 'c:tsconfig.json', 'c:eas.json']],
  ['app', ['s:_layout.tsx', 's:index.tsx', 's:settings.tsx', 's:search.tsx']],
  ['app/trip', ['s:[id].tsx', 's:map.tsx', 's:eta.tsx']],
  ['src/guidance', ['s:store.ts', 's:map.ts', 's:vehicles.ts', 's:eta.ts', 's:route.ts', 's:snap.ts', 's:filter.ts']],
  ['src/guidance/__tests__', ['t:store.test.ts', 't:map.test.ts', 't:eta.test.ts', 't:snap.test.ts', 't:vehicles.test.ts']],
  ['src/api', ['s:client.ts', 's:transloc.ts', 's:valhalla.ts', 's:cache.ts', 's:types.ts']],
  ['src/api/__tests__', ['t:transloc.test.ts', 't:valhalla.test.ts']],
  ['src/ui', ['s:Button.tsx', 's:Sheet.tsx', 's:MapView.tsx', 's:Pin.tsx', 's:Banner.tsx', 's:Row.tsx', 's:Card.tsx']],
  ['src/theme', ['s:tokens.ts', 's:colors.ts']],
  ['src/data', ['s:db.ts', 's:schema.ts', 's:queries.ts']],
  ['src/data/migrations', ['m:0001_init.sql', 'm:0002_stops.sql', 'm:0003_routes.sql']],
  ['docs', ['d:architecture.md', 'd:guidance.md', 'd:api.md', 'd:runbook.md']],
  ['scripts', ['s:seed.ts', 's:fetch_gtfs.py']],
  ['server', ['s:main.py', 's:routes.py', 's:models.py', 's:deps.py']],
  ['server/tests', ['t:test_routes.py', 't:test_models.py', 't:conftest.py']],
  ['server/alembic/versions', ['m:0001_init.py', 'm:0002_vehicles.py']],
  ['.github/workflows', ['c:ci.yml']],
];

interface SampleFile {
  path: string;
  dir: string;
  name: string;
  role: PlainRole;
}

function files(extraStops: number): SampleFile[] {
  const out: SampleFile[] = [];
  for (const [dir, names] of TREE) {
    for (const entry of names) {
      const [code, name] = entry.split(':') as [string, string];
      out.push({ path: dir ? `${dir}/${name}` : name, dir, name, role: R[code]! });
    }
  }
  for (let i = 1; i <= extraStops; i++) {
    const name = `stop_${String(i).padStart(4, '0')}.json`;
    out.push({ path: `assets/stops/${name}`, dir: 'assets/stops', name, role: 'config' });
  }
  return out;
}

// ------------------------------------------------------------------ the session

type Step = readonly [string, FrameKind];

/**
 * `pattern` over [from, to), cycling, each step `gaps` seconds after the last (cycling too): a
 * few calls seconds apart, then a pause while it thinks, the rhythm a transcript has rather
 * than a metronome's, so the scrubber's bars rise and fall and a burst stands out as one.
 */
function run(from: number, to: number, gaps: readonly number[], pattern: readonly Step[]): [number, string, FrameKind][] {
  const out: [number, string, FrameKind][] = [];
  let k = 0;
  for (let t = from; t < to; t += gaps[k % gaps.length]!) {
    const [path, kind] = pattern[k % pattern.length]!;
    out.push([t, path, kind]);
    k += 1;
  }
  return out;
}

const G = 'src/guidance';
const GT = 'src/guidance/__tests__';

/** The whole 64 minutes, as [seconds from the first event, path, kind], in order. */
function timeline(extraStops: number): [number, string, FrameKind][] {
  // 41 reads over the first 690 seconds: every folder of the app looked at once.
  const explore: Step[] = [
    'README.md', 'package.json', 'app.config.ts', 'tsconfig.json', 'eas.json', 'app/_layout.tsx', 'app/index.tsx',
    'app/settings.tsx', `${G}/store.ts`, `${G}/map.ts`, `${G}/vehicles.ts`, `${G}/eta.ts`, 'src/api/client.ts',
    'src/api/transloc.ts', 'src/api/valhalla.ts', 'docs/architecture.md', 'docs/guidance.md', 'docs/api.md',
    'src/ui/MapView.tsx', 'src/ui/Pin.tsx', 'src/ui/Button.tsx', 'src/data/schema.ts', 'src/data/db.ts',
    'src/data/migrations/0001_init.sql', 'src/data/migrations/0002_stops.sql', 'src/data/migrations/0003_routes.sql',
    'server/main.py', 'server/routes.py', 'server/models.py', 'server/deps.py', 'server/tests/test_routes.py',
    'server/tests/conftest.py', 'server/alembic/versions/0001_init.py', 'server/alembic/versions/0002_vehicles.py',
    `${GT}/store.test.ts`, `${GT}/map.test.ts`, 'app/trip/[id].tsx', 'app/trip/map.tsx', 'app/trip/eta.tsx',
    'scripts/seed.ts', 'scripts/fetch_gtfs.py',
  ].map((p) => [p, 'read'] as const);
  const build: Step[] = [
    [`${G}/vehicles.ts`, 'read'], [`${G}/vehicles.ts`, 'edit'], [`${G}/store.ts`, 'edit'], ['src/api/transloc.ts', 'read'],
    ['src/api/transloc.ts', 'edit'], [`${G}/map.ts`, 'edit'], [`${GT}/map.test.ts`, 'read'], [`${GT}/map.test.ts`, 'edit'],
    ['app/trip/map.tsx', 'edit'], ['src/ui/Pin.tsx', 'edit'], ['src/api/types.ts', 'read'], ['src/api/types.ts', 'edit'],
    [`${GT}/vehicles.test.ts`, 'edit'], ['src/api/cache.ts', 'read'], [`${G}/filter.ts`, 'edit'], ['src/theme/tokens.ts', 'read'],
  ];
  // Three files, round and round: rewrites of the store with the store's tests failing between.
  const knot: Step[] = [
    [`${G}/store.ts`, 'edit'], [`${GT}/store.test.ts`, 'fail'], [`${GT}/store.test.ts`, 'read'], [`${G}/store.ts`, 'edit'],
    [`${G}/snap.ts`, 'edit'], [`${G}/store.ts`, 'fail'], [`${G}/store.ts`, 'read'], [`${G}/store.ts`, 'edit'],
    [`${GT}/store.test.ts`, 'fail'], [`${G}/snap.ts`, 'read'], [`${G}/store.ts`, 'edit'], [`${G}/snap.ts`, 'edit'],
  ];
  const steady: Step[] = [
    ['src/api/valhalla.ts', 'read'], ['src/api/valhalla.ts', 'edit'], ['src/api/__tests__/valhalla.test.ts', 'edit'],
    ['src/ui/MapView.tsx', 'edit'], ['app/trip/[id].tsx', 'read'], ['src/data/queries.ts', 'edit'], ['server/routes.py', 'read'],
    ['server/routes.py', 'edit'], ['server/tests/test_routes.py', 'edit'], ['src/api/__tests__/transloc.test.ts', 'read'],
    [`${G}/route.ts`, 'read'], ['src/ui/Card.tsx', 'read'], ['src/theme/colors.ts', 'edit'], ['.github/workflows/ci.yml', 'read'],
  ];
  const burst: Step[] = [
    ['src/ui/Banner.tsx', 'edit'], ['src/ui/Sheet.tsx', 'edit'], ['app/trip/eta.tsx', 'edit'], [`${G}/eta.ts`, 'edit'],
    [`${GT}/eta.test.ts`, 'edit'], ['src/ui/Row.tsx', 'edit'], ['app/trip/[id].tsx', 'edit'], [`${G}/route.ts`, 'edit'],
    ['docs/guidance.md', 'edit'], ['README.md', 'edit'], ['src/ui/Banner.tsx', 'read'], ['docs/runbook.md', 'edit'],
  ];

  const out: [number, string, FrameKind][] = [
    ...run(10, 700, [4, 6, 3, 25, 5, 40, 9, 30, 12], explore),
    ...run(720, 1850, [8, 3, 3, 30, 12, 2, 2, 45, 20, 6], build),
    ...run(1860, 2645, [10, 20, 6, 35, 15, 8, 4], knot),
    ...run(2660, 3450, [12, 40, 6, 6, 60, 9, 25], steady),
    ...run(3460, 3841, [5, 4, 6, 3, 8, 4, 2, 3], burst),
  ];
  for (let i = 1; i <= extraStops; i++) {
    out.push([100 + Math.floor((i * 500) / Math.max(1, extraStops)), `assets/stops/stop_${String(i).padStart(4, '0')}.json`, 'read']);
  }
  out.sort((a, b) => a[0] - b[0]);
  return out;
}

/** The engine's map rows from frames: reads and changes counted, the last of each stamped. */
function rows(all: SampleFile[], frames: [number, string, FrameKind][], startSec: number): LiveFile[] {
  const byPath = new Map(all.map((f) => [f.path, f]));
  const out = new Map<string, LiveFile>();
  for (const [t, path, kind] of frames) {
    const f = byPath.get(path)!;
    const id = sampleId(path);
    let row = out.get(id);
    if (!row) {
      row = {
        id,
        dir_id: f.dir ? sampleId(f.dir) : null,
        role: f.role,
        depth: f.dir ? f.dir.split('/').length : 0,
        reads: 0,
        edits: 0,
        last_read_ts: null,
        last_edit_ts: null,
      };
      out.set(id, row);
    }
    if (kind === 'read') {
      row.reads += 1;
      row.last_read_ts = startSec + t;
    } else if (kind === 'edit') {
      row.edits += 1;
      row.last_edit_ts = startSec + t;
    }
  }
  return [...out.values()];
}

/** `live._wire_map`: the MAX_MAP_FILES rows touched most recently, in their own order. */
const MAX_MAP_FILES = 400;
function wireMap(all: LiveFile[]): { files: LiveFile[]; files_total: number } {
  const at = (r: LiveFile) => Math.max(r.last_read_ts ?? Number.NEGATIVE_INFINITY, r.last_edit_ts ?? Number.NEGATIVE_INFINITY);
  const keep = all
    .map((r, i) => ({ r, i }))
    .sort((a, b) => at(b.r) - at(a.r) || a.i - b.i)
    .slice(0, MAX_MAP_FILES)
    .map((x) => x.i)
    .sort((a, b) => a - b);
  return { files: keep.map((i) => all[i]!), files_total: all.length };
}

const EMPTY_EVIDENCE = {
  window_calls: 0,
  errors_now: 0,
  errors_before: 0,
  new_files: 0,
  checkpoints: 0,
  repeats: 0,
  churn_writes: 0,
  fail_run: 0,
  blind_edits: 0,
  stuck_s: 0,
  files_changed: 0,
  commits: 0,
  background: 0,
};

const ETA = {
  elapsed_s: 3710,
  typical_s: 4410,
  p25_s: 3900,
  p75_s: 5400,
  remaining_s: 700,
  n: 23,
  needed: 10,
  unattended: false,
  basis: 'finished_sessions_same_repo_that_ran_at_least_this_long',
  reason: null,
} as const;

/** The whole sample session, first event to last, in seconds. */
const SPAN = 3840;

/** Where each variant stands: stuck at 43m 40s, just started, or the whole session. */
function spanOfVariant(variant: MapSampleVariant): number {
  return variant === 'circling' ? 2620 : variant === 'empty' ? 0 : SPAN;
}

function state(variant: MapSampleVariant, startSec: number): { live: LiveState; names: LiveNames | null } {
  const extra = variant === 'cut' ? 550 : 0;
  const all = files(extra);
  const cut = spanOfVariant(variant);
  const events = variant === 'empty' ? [] : timeline(extra).filter(([t]) => t <= cut);
  const frameList: LiveFrame[] = thinFrames(
    events.map(([t, path, kind]) => ({ t, file_id: sampleId(path), kind })),
    MAX_FRAMES,
  );
  const map = wireMap(rows(all, events, startSec));
  const computed = startSec + cut + 20;
  const last = events[events.length - 1];
  const lastFile = last ? all.find((f) => f.path === last[1]) : undefined;
  const store = sampleId(`${G}/store.ts`);
  const storeRewrites = events.filter(([t, p, k]) => t >= 1860 && p === `${G}/store.ts` && k === 'edit').length;

  const live: LiveState = {
    live_version: 1,
    computed_at: new Date(computed * 1000).toISOString(),
    activity:
      variant === 'empty'
        ? { kind: 'thinking', role: 'unknown', attempt: 0, since_s: 20, files: 0, calls: 0, file_id: null }
        : {
            kind: 'editing',
            role: lastFile?.role ?? 'unknown',
            attempt: variant === 'circling' ? storeRewrites : 0,
            since_s: variant === 'circling' ? 95 : 25,
            files: 1,
            calls: variant === 'circling' ? 4 : 1,
            file_id: variant === 'circling' ? store : last ? sampleId(last[1]) : null,
          },
    verdict:
      variant === 'empty'
        ? { state: 'starting', basis: 'segment_tool_calls', reason: null, file_id: null, evidence: EMPTY_EVIDENCE }
        : variant === 'circling'
          ? {
              state: 'circling',
              basis: 'causes:file_churn_with_failures',
              reason: null,
              file_id: store,
              evidence: { ...EMPTY_EVIDENCE, window_calls: 24, errors_now: 3, errors_before: 1, checkpoints: 8, churn_writes: storeRewrites, fail_run: 1, stuck_s: cut + 20 - 1860, files_changed: 14 },
            }
          : {
              state: 'converging',
              basis: 'error_rate_down_and_new_files',
              reason: null,
              file_id: null,
              evidence: { ...EMPTY_EVIDENCE, window_calls: 25, errors_before: 3, new_files: 6, checkpoints: 11, churn_writes: 2, files_changed: 31, commits: 1 },
            },
    eta: variant === 'empty' ? { ...ETA, elapsed_s: 20, typical_s: null, p25_s: null, p75_s: null, remaining_s: null, n: 0, reason: 'too_few_survivors' } : { ...ETA, elapsed_s: cut - 130 },
    decisions: [],
    needs_you: variant === 'circling' ? { score: 72, reason: 'circling' } : { score: 5, reason: 'running_fine' },
    map,
    timelapse: frameList,
    sample: {
      events: Math.round(events.length * 2.9),
      tool_calls: Math.round(events.length * 1.3),
      segments: variant === 'empty' ? 1 : 11,
      tokens: variant === 'empty' ? 18_400 : 41_200_000,
    },
  };

  const names: LiveNames | null =
    variant === 'names'
      ? { files: map.files.map((r) => ({ id: r.id, name: all.find((f) => sampleId(f.path) === r.id)!.name })) }
      : null;
  return { live, names };
}

/**
 * The sample session for `variant`, as the detail endpoint would serve it while it runs:
 * `base` is `data/client.ts`'s SAMPLE_SESSION (passed in, so this module stays pure).
 */
export function mapSample(base: SessionDetail, variant: MapSampleVariant, nowMs: number): SessionDetail {
  const span = spanOfVariant(variant);
  const endMs = nowMs - 20_000;
  const startMs = endMs - span * 1000;
  const startSec = Math.floor(startMs / 1000);
  const { live, names } = state(variant, startSec);
  return {
    ...base,
    id: 'sample',
    state: 'live',
    end_reason: 'still_running',
    started_at: new Date(startSec * 1000).toISOString(),
    ended_at: new Date(endMs).toISOString(),
    updated_at: live.computed_at,
    active_seconds: Math.max(0, span - 130),
    idle_seconds: 130,
    strip: null,
    live_state: live,
    live_names: names,
  };
}
