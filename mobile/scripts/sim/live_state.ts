/**
 * What `src/live/surface.ts` hands the Lock Screen for a `builder://debug/live?payload=` body:
 * the attributes and ContentState of each row, from the phone's own code, so the record kept
 * next to a screenshot is not a second mapping. Run by `live_payload.py --record`.
 *
 *   bun scripts/sim/live_state.ts < payload.json
 *
 * A running row's state is the one `planSync` would START its card with (so "N more running"
 * counts what the planner counts); a finished row's is `toState`'s, the card it ends with.
 * `spoken` is the sentence an alert or a notification would carry, duration and all.
 *
 * Each session wears the payload's creature when it names one (the debug route's `creature=`),
 * else its crew creature over these rows (`crew.ts`), as the debug route does. Row defaults match
 * `fillRow` in app/debug/live.tsx.
 */

import type { SessionDetail } from '../../src/data/api';
import { crewCreatures } from '../../src/live/crew';
import { renderLiveSentence } from '../../src/live/sentence';
import { payloadBytes, phaseOf, planSync, progressOf, sentenceOf, toAttrs, toState, type LiveStateWire } from '../../src/live/surface';

type RowIn = Partial<SessionDetail> & { id: string };

const input = JSON.parse(await Bun.stdin.text()) as {
  sessions: { session: RowIn; live: LiveStateWire | null }[];
  creature?: string;
};
const nowMs = Date.now();
const forced = input.creature ?? null;

function fillRow(p: RowIn): SessionDetail {
  const now = new Date(nowMs).toISOString();
  return {
    client_session_id: p.id,
    harness: 'claude_code',
    repo_name: null,
    started_at: now,
    ended_at: now,
    updated_at: now,
    active_seconds: 0,
    idle_seconds: 0,
    local_date: now.slice(0, 10),
    title: null,
    title_source: null,
    notable: false,
    unattended: false,
    timeline_fidelity: 'full',
    is_shared: false,
    stats: null,
    ...p,
    state: p.state === 'final' ? 'final' : 'live',
  };
}

const rows = input.sessions.map((x) => ({ s: fillRow(x.session), live: x.live }));
const liveStates = Object.fromEntries(rows.map(({ s, live }) => [s.id, live]));
const crew: ReadonlyMap<string, string> = forced
  ? new Map(rows.map(({ s }) => [s.id, forced]))
  : crewCreatures(rows.map(({ s }) => s));
const plan = planSync({
  sessions: rows.map(({ s }) => s),
  liveStates,
  tracked: new Map(),
  activitiesEnabled: true,
  crew,
  nowMs,
});
const out = rows.map(({ s, live }) => {
  const phase = phaseOf(s, live, nowMs);
  const start = plan.actions.find((a) => a.kind === 'start' && a.sessionId === s.id);
  const state = start && start.kind === 'start' ? start.state : toState(s, live, { nowMs, creature: crew.get(s.id), runningCount: 0 });
  const attrs = toAttrs(s);
  return {
    attrs,
    state,
    bytes: payloadBytes(attrs, state),
    progress_raw: progressOf(live),
    spoken: sentenceOf(s, live, phase, nowMs),
    sentence_ts: live ? renderLiveSentence(live) : null,
  };
});
console.log(JSON.stringify({ computed_at_ms: nowMs, creature: forced, rows: out }));
