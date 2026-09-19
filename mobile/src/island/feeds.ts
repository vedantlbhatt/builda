/**
 * Where the island's news comes from. Each function turns something the app already knows into
 * an activity and posts it; none of them fetch anything the app was not already fetching, except
 * `trackDrop`, which watches the one reel you just shared until the Mac has read it.
 */
import type { SessionDetail } from '../data/api';
import { api } from '../data/client';
import { repoLabel, type RepoNames } from '../copy/repoLabel';
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
    // Signed out (resetIslandFeeds) or already answered: this tracker is done.
    if (!tracking.has(dropId)) return;
    try {
      const { drop, moves } = await api.drop(dropId);
      if (!tracking.has(dropId)) return;
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
/**
 * The project's current tracker, as a generation number: a tracker whose number is not the
 * project's any more stops at its next tick. FOUND IN REVIEW: keyed by project alone, taking a
 * request back and asking again within a tick brought the old loop back to life beside the new
 * one, and a new request while the old was still tracked was ignored, so it got no Live Activity.
 */
const demos = new Map<string, number>();
let demoGeneration = 0;

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
export function trackDemo(projectKey: string, title: string, request?: DemoRequestCard, opts?: { sinceMs?: number }): void {
  // Already watched, and nothing new to watch (a resume): leave the running tracker alone. A new
  // request (the ask itself) always takes over.
  if (demos.has(projectKey) && !request) return;
  const gen = ++demoGeneration;
  demos.set(projectKey, gen);
  const mine = () => demos.get(projectKey) === gen;
  const id = `demo:${projectKey}`;
  const sinceMs = opts?.sinceMs ?? Date.now();
  const base = { kind: 'demo' as const, id, projectKey, title, progress: null, sinceMs };
  island.post({ ...base, filming: false, ready: false }, 0);
  if (request) void demoAsked(request, title);

  const tick = async () => {
    if (!mine()) return;
    try {
      const { requests } = await api.demoRequests(projectKey);
      if (!mine()) return;
      const step = demoStepFor(requests[0]?.status);
      // The system island reads the same row through the same rule (`demoStepFor`), so the two
      // cannot say different things about it; with no row at all its card comes down too. A done
      // row waits for the kit below: the card's ready needs the same answer the island's does.
      if (!requests[0]) void demoTakenBack(projectKey);
      else if (step !== 'ready') void demoMoved(requests[0]);
      if (step === 'clear') {
        island.clear(id);
        demos.delete(projectKey);
        return;
      }
      if (step === 'ready') {
        // Done is not the same as up: a Mac that finished without publishing kept the kit, and
        // "the kit is up, tap to share it" would open a screen with nothing new on it. A kit read
        // that FAILED decides nothing (FOUND IN REVIEW: it read as "not published" and said so):
        // the next tick asks again.
        const kit = await api.shipKit(projectKey);
        if (!mine()) return;
        demos.delete(projectKey);
        const publishedAt = kit?.kit?.published_at ?? null;
        // The system card by the same rule: ready with its Share, or made, which says where the
        // kit is and moves on to ready by push if it is published later (docs/demo-island.md).
        void demoMoved(requests[0]!, { kitPublishedAt: publishedAt });
        if (kit && kitFromRequest(requests[0]!, publishedAt)) {
          island.post({ ...base, filming: false, ready: true }, DROP_DONE_HOLD_MS);
        } else {
          island.clear(id);
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
      if (mine()) demos.delete(projectKey);
      return;
    }
    setTimeout(() => void tick(), DEMO_EVERY_MS);
  };
  setTimeout(() => void tick(), 1500);
}

/**
 * How often the root poll asks whether a demo is still being made. A relaunch or a return to the
 * app is when it matters (the in-app island forgot it; the system card did not); asking on every
 * tick of the minute poll would be a request a minute for a list that is almost always empty.
 */
export const DEMO_RESUME_MS = 5 * 60_000;
let lastResume = -Infinity;

/**
 * Pick up the demos still being made after a relaunch: the newest request per project, when it is
 * queued or claimed, tracked again from when it was ASKED (so the ear's clock is right). It does
 * not start a system card: the one started at the tap is still there, carried by push.
 */
/**
 * `known`: rows that may carry a project's public name (the saved sessions). A request row has only
 * the key, and a key alone names a public repository "private repo" (review, 2026-09-19): the pill
 * the ship kit put up said "builda", and the same demo resumed a minute later said "private repo".
 */
export async function resumeDemos(
  names: RepoNames | null,
  nowMs: number,
  known: readonly { repo_key?: string | null; repo_name?: string | null }[] = [],
): Promise<void> {
  if (nowMs - lastResume < DEMO_RESUME_MS) return;
  lastResume = nowMs;
  const { requests } = await api.allDemoRequests();
  const seen = new Set<string>();
  for (const r of requests) {
    if (seen.has(r.project_key)) continue;
    seen.add(r.project_key);
    if (r.status !== 'queued' && r.status !== 'claimed') continue;
    const asked = Date.parse(r.created_at);
    // Past the island's own limit: tracked again, it showed and was cleared within a tick, every
    // five minutes for as long as the server kept the row (FOUND IN REVIEW).
    if (Number.isFinite(asked) && nowMs - asked > DEMO_FOR_MS) continue;
    const repo_name = known.find((k) => k.repo_key === r.project_key && k.repo_name)?.repo_name ?? null;
    trackDemo(r.project_key, repoLabel({ repo_key: r.project_key, repo_name }, names), undefined, { sinceMs: Number.isFinite(asked) ? asked : nowMs });
  }
}

/**
 * Signing out: every tracker stops at its next tick and the island takes everything down, so
 * nothing the last account's feeds said stays up (FOUND IN REVIEW: a demo pill was still up 29
 * minutes after sign out).
 */
export function resetIslandFeeds(): void {
  tracking.clear();
  demos.clear();
  lastResume = -Infinity;
  island.clearAll();
}
