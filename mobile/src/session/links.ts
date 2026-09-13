/**
 * The way from a session to its codebase map and its time lapse (brief D7 and D8; the screens
 * are `app/you/map/[id].tsx` and `app/you/timelapse/[id].tsx`).
 *
 * Both are drawn from the live state's `map` and `timelapse`, which the detail endpoint serves
 * in full while the session runs and deletes when it finalises. A link is offered only when
 * its data is on this session: a row that opens onto nothing would be a promise the screen
 * behind it cannot keep. The meta line says what is there, with its number.
 *
 * Pure: no React Native, so `bun test` runs it.
 */

import { mins } from '../copy/numbers';
import { spoken } from '../copy/plain';
import type { SessionDetail } from '../data/api';

export interface SessionLink {
  key: 'map' | 'timelapse';
  title: string;
  meta: string;
  /** The typed route and the session it opens (expo-router's typed routes are on). */
  href: { pathname: '/you/map/[id]' | '/you/timelapse/[id]'; params: { id: string; variant?: string } };
}

/**
 * `variant` rides along for the built in sample (`samples.ts`), so the screen behind the link
 * can draw the same sample the session screen did; a real session never sends one.
 */
export function sessionLinks(s: Pick<SessionDetail, 'id' | 'live_state'>, variant?: string): SessionLink[] {
  const params = variant ? { id: s.id, variant } : { id: s.id };
  const live = s.live_state;
  if (!live) return [];
  const out: SessionLink[] = [];
  const total = live.map?.files_total;
  if (typeof total === 'number' && total > 0 && (live.map?.files.length ?? 0) > 0) {
    // "project files": the map leaves Claude Code's own files out (`live._map`, scratchpad and
    // `~/.claude`), while the numbers block's "files touched" counts every file any event
    // named. FOUND IN INTEGRATION (2026-09-13), this session on the simulator: "four files this
    // session touched" sat above "9 files touched", two answers to one question.
    out.push({
      key: 'map',
      title: 'Codebase map',
      meta: `${spoken(total)} project file${total === 1 ? '' : 's'} it touched`,
      href: { pathname: '/you/map/[id]', params },
    });
  }
  const frames = live.timelapse;
  if (frames && frames.length > 0) {
    // The span the frames cover, from the first event: 600 frames at most, binned when there
    // were more (overnight-engine 3.8), so a count of frames is not a count of anything.
    const span = frames.reduce((m, f) => (f.t > m ? f.t : m), 0);
    out.push({
      key: 'timelapse',
      title: 'Time lapse',
      meta: span > 0 ? `${mins(span)} of the work, replayed` : 'The work, replayed',
      href: { pathname: '/you/timelapse/[id]', params },
    });
  }
  return out;
}
