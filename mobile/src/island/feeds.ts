/**
 * Where the island's news comes from. Each function turns something the app already knows into
 * an activity and posts it; none of them fetch anything the app was not already fetching, except
 * `trackDrop`, which watches the one reel you just shared until the Mac has read it.
 */
import type { SessionDetail } from '../data/api';
import { api } from '../data/client';
import type { RepoNames } from '../copy/repoLabel';
import { tileModel } from '../live/mission';
import { crewFor } from '../live/crew';
import { demoAsked, demoMoved, demoTakenBack, type DemoRequestCard } from '../live/demoActivity';
import { dropLanded, dropMoved } from '../live/dropActivity';
import type { FaceState } from '../motion/states';
import { DEFAULT_ANIMAL, type Animal } from '../pixel/animals';
import { creatureHue, dropHue } from '../theme';
import { DEMO_EVERY_MS, DEMO_FOR_MS, demoStepFor, DROP_DONE_HOLD_MS, type Activity, type CrewMember } from './model';
import { kitFromRequest } from '../shipkit/model';
import { island } from './store';

export const FACE_FOR_TILE: Record<'needsYou' | 'working' | 'stalled' | 'finished', FaceState> = {
  needsYou: 'waiting',
  working: 'working',
  // Not updating: the run may be thinking or the Mac may be asleep. Violet, the thinking colour,
  // because red would claim a failure nothing measured.
  stalled: 'thinking',
  finished: 'done',
};

/**
 * The crew and the runs waiting on you, from the live rows. Called by the root poll
 * (`useLiveSurfaces`) with the same rows the Lock Screen gets, so the island inside the app and
 * the system island outside it can never disagree.
 */
export function publishLive(rows: readonly SessionDetail[], nowMs: number, names?: RepoNames | null): void {
  const creatures = crewFor(rows);
  const members: CrewMember[] = [];
  const waiting: Activity[] = [];
  for (const s of rows) {
    const t = tileModel(s, nowMs, names);
    if (t.kind === 'finished') continue;
    const animal: Animal = creatures.get(s.id) ?? DEFAULT_ANIMAL;
    const ink = creatureHue(animal).ink;
    const state = FACE_FOR_TILE[t.kind];
    const started = Date.parse(s.started_at);
    const m: CrewMember = {
      sessionId: s.id,
      repo: t.repo,
      animal,
      ink,
      state,
      sentence: t.sentence,
      startedMs: Number.isFinite(started) ? started : null,
    };
    members.push(m);
    if (t.kind === 'needsYou') {
      const since = Date.parse(s.live_state?.computed_at ?? s.updated_at ?? s.started_at);
      waiting.push({
        kind: 'needsYou',
        id: `wait:${s.id}`,
        sessionId: s.id,
        repo: t.repo,
        animal,
        ink,
        sentence: t.sentence,
        sinceMs: Number.isFinite(since) ? since : nowMs,
      });
    }
  }
  island.replaceKind('crew', members.length > 0 ? [{ kind: 'crew', id: 'crew', members }] : []);
  island.replaceKind('needsYou', waiting);
}

/**
 * One beat when a session you were running ends. Said once per session for the life of the app,
 * and only for a session that did something: a sitting with no lines and no commits ended, it
 * did not ship, and a green beat over it would be the plausible wrong word this codebase refuses.
 */
export function announceFinished(s: SessionDetail, animal: Animal, names?: RepoNames | null): void {
  const commits = s.stats?.commit_count ?? 0;
  const lines = s.stats?.lines_added_agent ?? 0;
  if (commits === 0 && lines === 0) return;
  const repo = tileModel(s, Date.now(), names).repo;
  const minutes = Math.round((s.active_seconds ?? 0) / 60);
  const parts = [repo, minutes > 0 ? `${minutes}m` : null, commits > 0 ? `${commits} ${commits === 1 ? 'commit' : 'commits'}` : `+${lines} lines`].filter(Boolean);
  island.once({
    kind: 'shipped',
    id: `shipped:${s.id}`,
    sessionId: s.id,
    repo,
    animal,
    ink: creatureHue(animal).ink,
    summary: parts.join(' · '),
  });
}

/** A short word from the app itself: a move started, a link copied. */
export function notice(text: string, state: FaceState, animal: Animal, ink: string): void {
  island.post({ kind: 'notice', id: `notice:${Date.now()}`, text, state, animal, ink });
}

const tracking = new Set<string>();
/** Poll cadence while a drop is being read: fast enough to feel live, slow enough to be cheap. */
export const TRACK_EVERY_MS = 3500;
/** Stop watching after this: the Mac is asleep, and the card on the board already says so. */
export const TRACK_FOR_MS = 4 * 60_000;

/**
 * Watch one drop you just shared from `sent` to its answer, on the island, so the answer lands
 * where you are rather than behind a banner that pulls you out of the app you were in.
 */
export function trackDrop(dropId: string, url: string): void {
  if (tracking.has(dropId)) return;
  tracking.add(dropId);
  let host = 'the post';
  try {
    host = new URL(url).host.replace(/^www\./, '');
  } catch {
    // A link the door accepted always parses; the fallback is only for the type checker.
  }
  const id = `drop:${dropId}`;
  const base = { kind: 'drop' as const, id, dropId, host, title: null, thumbnail: null, moves: 0, firstMove: null, hue: null };
  island.post({ ...base, phase: 'sent' }, 0);
  // And the system island, for the moment you leave the app (docs/drop-island.md).
  void dropLanded(dropId, url);
  const started = Date.now();

  const tick = async () => {
    try {
      const { drop, moves } = await api.drop(dropId);
      void dropMoved(drop, moves);
      const offered = moves.filter((m) => m.status === 'offered').sort((a, b) => a.position - b.position);
      const hue = drop.kind ? (dropHue(drop.kind)?.ink ?? null) : null;
      const common = { ...base, title: drop.title, thumbnail: drop.thumbnail_url, hue };
      if (drop.status === 'planned') {
        island.post({ ...common, phase: 'planned', moves: offered.length, firstMove: offered[0]?.title ?? null }, DROP_DONE_HOLD_MS);
        tracking.delete(dropId);
        return;
      }
      if (drop.status === 'refused') {
        island.post({ ...common, phase: 'refused' }, DROP_DONE_HOLD_MS);
        tracking.delete(dropId);
        return;
      }
      island.post({ ...common, phase: drop.status === 'resolving' ? 'reading' : 'sent' }, 0);
    } catch {
      // Offline for a moment: keep what the island shows and try again on the next tick.
    }
    if (Date.now() - started > TRACK_FOR_MS) {
      island.clear(id);
      tracking.delete(dropId);
      return;
    }
    setTimeout(() => void tick(), TRACK_EVERY_MS);
  };
  setTimeout(() => void tick(), 800);
}

/**
 * Watch one demo request from the moment the phone asks until the Mac publishes the kit, refuses,
 * or the request is taken back. It lives here, not on the kit screen, because the point is the
 * minutes AFTER you leave that screen: you asked, you went back to what you were doing, and the
 * island tells you when the thing you asked for exists. Tapping it opens the kit.
 */
const demos = new Set<string>();

/** Taken back on the phone: the island says nothing more about it, now rather than on the next read. */
export function untrackDemo(projectKey: string): void {
  demos.delete(projectKey);
  island.clear(`demo:${projectKey}`);
  // And the system island's card, which would otherwise hold "waiting" until its stale date.
  void demoTakenBack(projectKey);
}

/**
 * `request` is the row the server answered the ask with. With it the system island gets the
 * same request as a Live Activity (docs/demo-island.md), for the moment you leave the app; the
 * in-app island below is the same with or without it.
 */
export function trackDemo(projectKey: string, title: string, request?: DemoRequestCard): void {
  if (demos.has(projectKey)) return;
  demos.add(projectKey);
  const id = `demo:${projectKey}`;
  const sinceMs = Date.now();
  const base = { kind: 'demo' as const, id, projectKey, title, progress: null, sinceMs };
  island.post({ ...base, filming: false, ready: false }, 0);
  if (request) void demoAsked(request, title);

  const tick = async () => {
    if (!demos.has(projectKey)) return;
    try {
      const { requests } = await api.demoRequests(projectKey);
      if (!demos.has(projectKey)) return;
      // The system island reads the same row through the same rule (`demoStepFor`), so the two
      // cannot say different things about it; with no row at all its card comes down too.
      void (requests[0] ? demoMoved(requests[0]) : demoTakenBack(projectKey));
      const step = demoStepFor(requests[0]?.status);
      if (step === 'clear') {
        island.clear(id);
        demos.delete(projectKey);
        return;
      }
      if (step === 'ready') {
        demos.delete(projectKey);
        // Done is not the same as up: a Mac that finished without publishing kept the kit, and
        // "the kit is up, tap to share it" would open a screen with nothing new on it.
        const kit = await api.shipKit(projectKey).catch(() => null);
        if (kit && kitFromRequest(requests[0]!, kit.kit?.published_at ?? null)) {
          island.post({ ...base, filming: false, ready: true }, DROP_DONE_HOLD_MS);
        } else {
          island.clear(id);
          // The system card came down the same way, so it cannot say "kit up" over this notice.
          void demoTakenBack(projectKey);
          notice(`The demo of ${title} is made on your Mac. Publish it there to share it.`, 'done', DEFAULT_ANIMAL, creatureHue(DEFAULT_ANIMAL).ink);
        }
        return;
      }
      if (step === 'failed') {
        island.clear(id);
        demos.delete(projectKey);
        notice(`Your Mac could not film ${title}. The kit page says why.`, 'error', DEFAULT_ANIMAL, creatureHue(DEFAULT_ANIMAL).ink);
        return;
      }
      island.post({ ...base, filming: step === 'filming', ready: false }, 0);
    } catch {
      // Offline for a moment: keep what the island shows and try again on the next tick.
    }
    if (Date.now() - sinceMs > DEMO_FOR_MS) {
      island.clear(id);
      demos.delete(projectKey);
      return;
    }
    setTimeout(() => void tick(), DEMO_EVERY_MS);
  };
  setTimeout(() => void tick(), 1500);
}
