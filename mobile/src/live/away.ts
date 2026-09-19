/**
 * While you were away: what finished between the last time this phone had Builda open and now.
 * PURE, so `__tests__/away.test.ts` holds it.
 *
 * WHY THIS EXISTS. Builda's island and its tiles are about now: a run finishing shows as a tile
 * for ten minutes (`FINISHED_SHOW_MS`) and then it is a row in Sessions like any other. That is
 * right while you are watching and wrong the morning after, which is exactly when agents do the
 * most: an overnight run that finished at 3am is the first thing you want to know and the last
 * thing Now said anything about. So when the app opens after long enough away, Now leads with one
 * band that says what happened meanwhile, and goes the moment you have read it.
 *
 * What it counts: sessions whose END is after the moment you left, whether a person was there or
 * not (an autonomous run is the point here, not a thing to hide), and how much work that was in
 * active time. It never counts a run that was already over when you left, and says nothing at
 * all when nothing finished: "nothing happened while you were away" is not news.
 */
import type { SessionDetail } from '../data/api';
import { repoLabel, type RepoNames } from '../copy/repoLabel';
import { elapsedLabel } from './mission';

/**
 * How long away before the band shows. An hour: shorter than that, the finished tiles on Now (ten
 * minutes) and the top of Sessions already say it, and a band on every return from a coffee
 * would be a feature asking to be noticed. The case it is for is a night, or a working day.
 */
export const AWAY_MIN_MS = 60 * 60_000;
/** Rows named in the band; the rest are a count, and Sessions has them all. */
export const AWAY_ROWS = 3;

export interface AwayRow {
  id: string;
  title: string;
  repo: string;
  active: string;
  /** Ran with nobody there (`unattended`): an agent's run, said so plainly. */
  alone: boolean;
}

export interface AwaySummary {
  finished: number;
  /** Active time across them, as a tile says it ("5h 12m"). */
  work: string;
  /** How many of them ran with nobody there. */
  alone: number;
  rows: AwayRow[];
  /** Still running now, which the tiles under the band show. */
  running: number;
  /** "3 runs finished while you were away" */
  lead: string;
  /** "5h 12m of work, 2 of them on their own." */
  line: string;
}

export function awaySummary(
  sessions: readonly SessionDetail[],
  live: readonly SessionDetail[],
  lastSeenMs: number | null,
  nowMs: number,
  names?: RepoNames | null,
): AwaySummary | null {
  if (lastSeenMs === null || !Number.isFinite(lastSeenMs) || nowMs - lastSeenMs < AWAY_MIN_MS) return null;
  const liveIds = new Set(live.map((s) => s.id));
  const finished = sessions
    .filter((s) => !liveIds.has(s.id) && (s.state ?? 'final') !== 'live')
    .filter((s) => {
      const end = Date.parse(s.ended_at);
      return Number.isFinite(end) && end > lastSeenMs && end <= nowMs;
    })
    .sort((a, b) => Date.parse(b.ended_at) - Date.parse(a.ended_at));
  if (finished.length === 0) return null;
  const seconds = finished.reduce((t, s) => t + Math.max(0, s.active_seconds || 0), 0);
  const alone = finished.filter((s) => s.unattended).length;
  const n = finished.length;
  const work = elapsedLabel(seconds);
  const rows = finished.slice(0, AWAY_ROWS).map((s) => ({
    id: s.id,
    title: s.title?.trim() || repoLabel(s, names),
    repo: repoLabel(s, names),
    active: elapsedLabel(s.active_seconds || 0),
    alone: Boolean(s.unattended),
  }));
  const lead = `${n === 1 ? '1 run' : `${n} runs`} finished while you were away`;
  const lonely = alone === 0 ? '' : alone === n ? (n === 1 ? ', on its own' : ', all on their own') : `, ${alone} of them on their own`;
  return { finished: n, work, alone, rows, running: live.length, lead, line: `${work} of work${lonely}.` };
}
