import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text } from 'react-native';

import { timeOfDay } from '../../src/copy/time';
import type { SessionDetail } from '../../src/data/api';
import * as cache from '../../src/data/cache';
import { loadRepoNames } from '../../src/data/repoNames';
import BuilderDrops from '../../modules/builder-drops';
import BuilderLive from '../../modules/builder-live';
import { activityFor, endAllLiveActivities, liveActivitiesAvailable, renderLivePreviews, syncLiveActivities, type SyncResult } from '../../src/live/activity';
import { debugDemoCard } from '../../src/live/demoActivity';
import { debugDropCard } from '../../src/live/dropActivity';
import { crewFor } from '../../src/live/crew';
import { debugSessions, DEBUG_TODAY, parseDebugLive, type DebugLiveRequest } from '../../src/live/fixtures';
import { buildWidgetSnapshot, payloadBytes, phaseOf, toAttrs, toState, type LiveStateWire } from '../../src/live/surface';
import { writeWidgetSnapshot } from '../../src/live/widget';
import { resolveAnimal } from '../../src/pixel/animals';
import { colors, space } from '../../src/theme';
import { ANIMAL_KEY } from '../icon';

/**
 * `builder://debug/live?state=working|needsYou|done|stalled|end&n=1..4[&widget=1][&render=1]
 *  [&creature=owl][&stale=10]`
 * `builder://debug/live?payload=<urlencoded JSON>`
 *
 * Drives the Live Activity, the Dynamic Island and the Home Screen widget with no tap, for
 * `scripts/sim/capture.sh` and for looking at them on a device. It goes through the real path,
 * `syncLiveActivities` and its planner, with the realistic sessions in `src/live/fixtures.ts`
 * (the engine's own sentences, this repository and RideGT). The ids are fixed, so
 * state=working and then state=needsYou moves the same session into needs you and the alert
 * fires; state=done starts the session first if nothing shows it, so there is a card to finish.
 * The app must be in the foreground to START an activity (ActivityKit), which opening a link
 * guarantees.
 *
 *   widget=1   also writes the widget snapshot (alone: only the snapshot)
 *   render=1   renders every state to Documents/live-previews with ImageRenderer
 *   stale=10   the content goes stale after 10 s, to photograph "Not updating"
 *   creature=owl  every session wears this creature, to photograph one hue; without it each
 *              session wears its own crew creature (`crew.ts`), as a real sync does
 *
 * `payload` replaces the fixtures with rows you give it: the SAME planner and `toState`, fed a
 * session row and the engine's `live_state` exactly as the server would hand them to the phone
 * (`analysis/live.py` `wire()`). `scripts/sim/live_payload.py self` builds one from a real
 * running transcript, and `live_payload.py state <name>` the Lock Screen states the fixtures lack.
 *
 *   { "sessions": [ { "session": { "id": "...", ...SessionDetail }, "live": { ...live_state } } ],
 *     "finished"?: [ { "id": "...", ...SessionDetail } ],   rows that just went final
 *     "fresh"?: true,      end every Builda activity first, so this one STARTS
 *     "creature"?: "owl",  "stale"?: 10,  "widget"?: true }
 *
 * A session row needs only `id`; the rest defaults to a live claude_code row with no stats.
 * Sending the same ids again UPDATES their activities (and alerts on a move into needs you).
 *
 * A reel you shared (docs/drop-island.md):
 *
 *   drop=sent|reading|planned|refused|started|end[&stale=10][&render=1][&dropId=<drop>&moveId=<move>]
 *              one sample drop's card, driven to that phase through the same `dropState` a real
 *              poll uses (no server); `stale` shortens its stale date; `dropId` and `moveId` put a real
 *              drop's ids on it, so its Start button starts a move the server has
 *   drop=credential   what the share extension would find in the App Group's keychain
 *   drop=direct&url=<link>   the share extension's own send, run from the app, with no queue
 *              fallback: proves the mirrored token and the one route on a simulator
 *   drop=tokens       what the server has been handed for drop cards
 *
 * A demo you asked for (docs/demo-island.md):
 *
 *   demo=asked|filming|ready|failed|end[&stale=10][&render=1]
 *              one sample request's card, driven to that phase through the same `demoState` a
 *              real poll uses (no server, no Mac); `stale` shortens its stale date
 *   demo=tokens       what the server has been handed for demo cards
 *
 * DEV ONLY. A release build renders nothing here and redirects, touching no activity. (The root
 * layout does not list this route, because another change owns that file; listing it in the
 * `__DEV__` group there is the follow up.)
 */
export default function DebugLiveRoute() {
  if (!__DEV__) return <Redirect href="/now" />;
  return <DebugLive />;
}

const c = colors('dark');

function DebugLive() {
  const params = useLocalSearchParams();
  // A second link while this screen is up replaces the params in place; key on content.
  const key = JSON.stringify(params);
  const req = useMemo((): Request => {
    const p = params as Record<string, string | string[] | undefined>;
    const raw = Array.isArray(p.payload) ? p.payload[0] : p.payload;
    const first = (k: string) => {
      const v = p[k];
      return Array.isArray(v) ? v[0] : v;
    };
    const demo = first('demo');
    if (demo !== undefined) {
      const stale = Number(first('stale'));
      return {
        kind: 'demo',
        demo: {
          action: demo,
          stale: Number.isInteger(stale) && stale >= 1 && stale <= 3600 ? stale : null,
          render: ['1', 'true', 'yes'].includes((first('render') ?? '').toLowerCase()),
        },
      };
    }
    const drop = first('drop');
    if (drop !== undefined) {
      const stale = Number(first('stale'));
      return {
        kind: 'drop',
        drop: {
          action: drop,
          url: first('url') ?? null,
          stale: Number.isInteger(stale) && stale >= 1 && stale <= 3600 ? stale : null,
          render: ['1', 'true', 'yes'].includes((first('render') ?? '').toLowerCase()),
          id: first('dropId') ?? null,
          move: first('moveId') ?? null,
        },
      };
    }
    return raw !== undefined ? parsePayload(raw) : { kind: 'fixtures', req: parseDebugLive(p) };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const [lines, setLines] = useState<string[]>(['working']);

  useEffect(() => {
    let cancelled = false;
    (req.kind === 'demo'
      ? runDemo(req.demo)
      : req.kind === 'drop'
      ? runDrop(req.drop)
      : req.kind === 'payload'
        ? runPayload(req.payload)
        : req.kind === 'problem'
          ? Promise.resolve([req.problem])
          : run(req.req))
      .then((out) => !cancelled && setLines(out))
      .catch((e: unknown) => !cancelled && setLines([`failed: ${e instanceof Error ? e.message : String(e)}`]));
    return () => {
      cancelled = true;
    };
  }, [req]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: c.bg }} contentContainerStyle={{ padding: space.md, gap: space.sm }}>
      <Stack.Screen options={{ title: 'Live surfaces' }} />
      {lines.map((line, i) => (
        <Text key={i} style={{ color: i === 0 ? c.text : c.textDim, fontSize: i === 0 ? 17 : 13, fontWeight: i === 0 ? '600' : '500' }}>
          {line}
        </Text>
      ))}
    </ScrollView>
  );
}

function describe(label: string, r: SyncResult): string {
  const parts = [`${r.started} started`, `${r.updated} updated`, `${r.ended} ended`, `${r.notified} notified`];
  if (r.widget) parts.push('widget written');
  return `${label}: ${parts.join(', ')}${r.errors.length ? `; ${r.errors.join('; ')}` : ''}`;
}

/**
 * The creature each session wears: `creature=` forces one on every session (to photograph a hue);
 * otherwise the crew rule over these rows, remembered, as the real poll does.
 */
function crewOf(rows: readonly SessionDetail[], forced: string | null): ReadonlyMap<string, string> {
  return forced ? new Map(rows.map((s) => [s.id, forced])) : crewFor(rows);
}

async function run(req: DebugLiveRequest): Promise<string[]> {
  if (req.problem) return [req.problem];
  const out: string[] = [];
  const nowMs = Date.now();
  const creature = resolveAnimal(await cache.getKv(ANIMAL_KEY).catch(() => null));
  out.push(liveActivitiesAvailable() ? 'Live Activities are on' : 'Live Activities are off or not in this build');

  if (req.state === 'end') {
    await endAllLiveActivities();
    out.push('ended every Builda Live Activity');
  } else if (req.state) {
    const common = { creature, today: DEBUG_TODAY, nowMs, staleInSeconds: req.staleInSeconds ?? undefined };
    if (req.state === 'done' && !activityFor('debug-builder')) {
      const first = debugSessions('working', req.n, nowMs);
      const crew = crewOf(first.sessions, req.creature);
      out.push(describe('working first', await syncLiveActivities(first.sessions, first.liveStates, { ...common, crew, writeWidget: false })));
    }
    const s = debugSessions(req.state, req.n, nowMs);
    const crew = crewOf([...s.sessions, ...s.finished], req.creature);
    const r = await syncLiveActivities(s.sessions, s.liveStates, { ...common, crew, finished: s.finished, writeWidget: req.widget });
    out.push(describe(req.state, r));
    out.push(`creatures: ${[...crew].map(([id, c]) => `${id.replace('debug-', '')} ${c}`).join(', ')}`);
  } else if (req.widget) {
    const s = debugSessions('working', req.n, nowMs);
    const crew = crewOf(s.sessions, req.creature);
    const ok = writeWidgetSnapshot(buildWidgetSnapshot({ sessions: s.sessions, liveStates: s.liveStates, creature, crew, today: DEBUG_TODAY, nowMs }));
    out.push(ok ? `wrote the widget snapshot (${s.sessions.length} running)` : 'no widget storage in this build');
  }

  if (req.render) {
    try {
      const paths = await renderLivePreviews();
      out.push(`rendered ${paths.length} previews into Documents/live-previews`);
    } catch (e) {
      out.push(`render failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}

// ------------------------------------------------------------------ drop=<phase|credential|direct|tokens>

const DROP_PHASES = ['sent', 'reading', 'planned', 'refused', 'started', 'end'] as const;

async function runDrop(r: DropRequest): Promise<string[]> {
  const out: string[] = [liveActivitiesAvailable() ? 'Live Activities are on' : 'Live Activities are off or not in this build'];
  out.push(`asked: ${r.action}${r.id ? ` for drop ${r.id}` : ''}${r.move ? ` move ${r.move}` : ''}`);
  if ((DROP_PHASES as readonly string[]).includes(r.action)) {
    const real = r.id ? { dropId: r.id, moveId: r.move } : undefined;
    out.push(await debugDropCard(r.action as (typeof DROP_PHASES)[number], r.stale ?? undefined, Date.now(), real));
  } else if (r.action === 'credential') {
    const s = BuilderDrops?.credentialStatus?.();
    out.push(
      !s
        ? 'no drops module in this build'
        : s.present
          ? `credential for ${s.baseURL}: ${s.usable ? `usable, ${Math.round(s.secondsLeft)} s left` : 'expired'}`
          : 'no credential in the App Group keychain'
    );
  } else if (r.action === 'direct') {
    if (!r.url) return [...out, 'direct needs &url=<a link>'];
    const res = await BuilderDrops?.debugShareDirect?.(r.url, '');
    out.push(!res ? 'no drops module in this build' : res.sent ? `sent: drop ${res.dropId}` : `kept: ${res.why}`);
  } else if (r.action === 'tokens') {
    out.push(JSON.stringify((await BuilderLive?.flushDropTokens?.()) ?? {}));
  } else {
    out.push(`drop must be one of ${DROP_PHASES.join(', ')}, credential, direct or tokens, not "${r.action}"`);
  }
  for (const c of BuilderLive?.listDrops?.() ?? []) out.push(`card ${c.id.slice(0, 8)} ${c.dropId} ${c.state} ${c.phase}`);
  if (r.render) {
    try {
      out.push(`rendered ${(await renderLivePreviews()).length} previews into Documents/live-previews`);
    } catch (e) {
      out.push(`render failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}

// ------------------------------------------------------------------ demo=<phase|tokens>

const DEMO_PHASES = ['asked', 'filming', 'ready', 'failed', 'end'] as const;

async function runDemo(r: DemoRequest): Promise<string[]> {
  const out: string[] = [liveActivitiesAvailable() ? 'Live Activities are on' : 'Live Activities are off or not in this build'];
  out.push(`asked: ${r.action}`);
  if ((DEMO_PHASES as readonly string[]).includes(r.action)) {
    out.push(await debugDemoCard(r.action as (typeof DEMO_PHASES)[number], r.stale ?? undefined));
  } else if (r.action === 'tokens') {
    out.push(JSON.stringify((await BuilderLive?.flushDemoTokens?.()) ?? {}));
  } else {
    out.push(`demo must be one of ${DEMO_PHASES.join(', ')} or tokens, not "${r.action}"`);
  }
  for (const c of BuilderLive?.listDemos?.() ?? []) out.push(`card ${c.id.slice(0, 8)} ${c.requestId} ${c.state} ${c.phase}`);
  if (r.render) {
    try {
      out.push(`rendered ${(await renderLivePreviews()).length} previews into Documents/live-previews`);
    } catch (e) {
      out.push(`render failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}

// ------------------------------------------------------------------ payload=<JSON>

type RowIn = Partial<SessionDetail> & { id: string };

interface DebugPayload {
  sessions: { session: RowIn; live: LiveStateWire | null }[];
  finished: RowIn[];
  fresh: boolean;
  creature: string | null;
  staleInSeconds: number | null;
  widget: boolean;
}

type DropRequest = { action: string; url: string | null; stale: number | null; render: boolean; id: string | null; move: string | null };

type DemoRequest = { action: string; stale: number | null; render: boolean };

type Request =
  | { kind: 'demo'; demo: DemoRequest }
  | { kind: 'drop'; drop: DropRequest }
  | { kind: 'fixtures'; req: DebugLiveRequest }
  | { kind: 'payload'; payload: DebugPayload }
  | { kind: 'problem'; problem: string };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isRow = (x: unknown): x is RowIn => isObj(x) && typeof x.id === 'string' && x.id.length > 0;

function parsePayload(raw: string): Request {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    return { kind: 'problem', problem: `payload is not JSON (${why}); ${raw.length} chars arrived, ending "${raw.slice(-40)}"` };
  }
  if (!isObj(doc)) return { kind: 'problem', problem: 'payload must be a JSON object' };
  const list = Array.isArray(doc.sessions) ? doc.sessions : [];
  if (list.length < 1 || list.length > 4) return { kind: 'problem', problem: 'payload.sessions must hold 1 to 4 { session, live } rows' };
  const sessions: DebugPayload['sessions'] = [];
  for (const x of list) {
    if (!isObj(x) || !isRow(x.session)) return { kind: 'problem', problem: 'every payload row needs session.id' };
    sessions.push({ session: x.session, live: isObj(x.live) ? (x.live as LiveStateWire) : null });
  }
  const finished = Array.isArray(doc.finished) ? doc.finished.filter(isRow) : [];
  const stale = Number(doc.stale);
  return {
    kind: 'payload',
    payload: {
      sessions,
      finished,
      fresh: doc.fresh === true,
      creature: typeof doc.creature === 'string' && /^[a-z-]{2,20}$/.test(doc.creature) ? doc.creature : null,
      staleInSeconds: Number.isInteger(stale) && stale >= 1 && stale <= 3600 ? stale : null,
      widget: doc.widget === true,
    },
  };
}

/** "9:37am" for a Unix-seconds moment, as the surfaces draw it (`copy/time`), or null. */
function clock(epoch: number | null): string | null {
  return epoch === null ? null : timeOfDay(epoch * 1000);
}

/** A full live row from what the payload gave; nothing it left out is invented beyond "unknown". */
function fillRow(p: RowIn, nowMs: number, state: 'live' | 'final'): SessionDetail {
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
    state,
  };
}

async function runPayload(p: DebugPayload): Promise<string[]> {
  const out: string[] = [];
  const nowMs = Date.now();
  const creature = resolveAnimal(await cache.getKv(ANIMAL_KEY).catch(() => null));
  out.push(liveActivitiesAvailable() ? 'Live Activities are on' : 'Live Activities are off or not in this build');
  if (p.fresh) {
    await endAllLiveActivities();
    out.push('ended every Builda Live Activity first');
  }
  const sessions = p.sessions.map((x) => fillRow(x.session, nowMs, x.session.state === 'final' ? 'final' : 'live'));
  const liveStates = Object.fromEntries(p.sessions.map((x) => [x.session.id, x.live]));
  const finished = p.finished.map((f) => fillRow(f, nowMs, 'final'));
  const crew = crewOf([...sessions, ...finished], p.creature);
  // The phone's project names, as the real poll reads them: a row with a `repo_key` this phone
  // has numbered is "Private project 2" on its card, as it would be from a real sync.
  const names = await loadRepoNames().catch(() => null);
  const r = await syncLiveActivities(sessions, liveStates, {
    creature,
    crew,
    today: DEBUG_TODAY,
    nowMs,
    finished,
    staleInSeconds: p.staleInSeconds ?? undefined,
    writeWidget: p.widget,
    names,
  });
  out.push(describe('payload', r));
  // What each surface was handed: the same toState the planner just ran, shown for the record.
  const running = sessions.filter((s) => phaseOf(s, liveStates[s.id], nowMs) !== 'done').length;
  for (const s of sessions) {
    const live = liveStates[s.id];
    const done = phaseOf(s, live, nowMs) === 'done';
    const st = toState(s, live, { nowMs, creature: crew.get(s.id), runningCount: Math.max(0, running - (done ? 0 : 1)) });
    const attrs = toAttrs(s, true, names);
    out.push(`${attrs.repo} · ${attrs.agent} · ${s.id.slice(0, 12)}`);
    out.push(`${st.phase} · ${st.trajectory} · ${st.creature} · "${st.sentence}"`);
    out.push(
      `progress ${st.progress} · ${st.filesChanged} files changed · eta ${clock(st.etaEpoch) ?? 'refused'} · since ${clock(st.sinceEpoch) ?? 'none'} · ended ${clock(st.endedEpoch) ?? 'no'} · +${st.linesAdded ?? '?'} -${st.linesRemoved ?? '?'} · ${st.commits ?? '?'} commits · ${st.runningCount} more · ${payloadBytes(attrs, st)} bytes`
    );
  }
  return out;
}
