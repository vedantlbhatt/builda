/**
 * The words and the tap target of the two notifications the phone can post on its own: a
 * session that needs you, and one that finished. Pure, so `__tests__/liveSurface.test.ts` can
 * hold every string to the no dashes rule and every payload to the router.
 *
 * These are the FALLBACK. While a Live Activity runs for a session, the activity's own alert
 * is the needs you banner and its finished card is the finish; posting a notification as well
 * is what the HIG says never to do ("don't use push notifications alongside Live Activities for
 * the same updates"). `src/live/surface.ts` `planSync` decides which one a moment gets.
 */

import type { SessionDetail } from '../data/api';
import { renderLiveSentence } from '../live/sentence';

export interface LocalNotification {
  /** Replaces an earlier notification with the same id instead of stacking a second. */
  identifier: string;
  title: string;
  body: string;
  /** What `route.ts` `routeForNotification` reads: kind, session id, and the deep link. */
  data: { kind: string; session_id: string; url: string };
}

/** Not a recap kind, so a tap opens the session itself (`routeForNotification`). */
export const KIND_NEEDS_YOU = 'needs_you';
/** The server's two finish kinds (`server/builder/notify.py`), so a tap opens the recap. */
export const KIND_SESSION_FINISHED = 'session_finished';
export const KIND_AGENT_RUN_FINISHED = 'agent_run_finished';

/** "1h 42m", "42m": the server's `_hm`, so a banner the phone posts reads like one it sends. */
export function hm(seconds: number): string {
  const total = Math.floor(Math.max(0, seconds) / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/**
 * "builder needs you" / the engine's sentence ("Waiting on you for four minutes"). The
 * sentence is the one the Lock Screen would have shown; without one it is the engine's own
 * words for a turn that has just been handed back.
 */
export function needsYouNotification(s: Pick<SessionDetail, 'id' | 'repo_name'>, sentence?: string | null): LocalNotification {
  const repo = s.repo_name ?? 'A session';
  return {
    identifier: `needs-you-${s.id}`.slice(0, 63),
    title: `${repo} needs you`,
    body: sentence?.trim() || renderLiveSentence({ activity: { kind: 'waiting_on_you', since_s: 0 } }),
    data: { kind: KIND_NEEDS_YOU, session_id: s.id, url: `builder://session/${s.id}` },
  };
}

/**
 * The server's two finish banners (`notify.compose`), from the phone's copy of the same row: an
 * attended session by its ATTENDED time, the clock that decides records; an unattended run by
 * its active time. The repo is named only when the row names it. The identifier is the
 * server's `apns-collapse-id` (the session id, cut to 63), so if the server's own push for this
 * session also arrives, it replaces this one in Notification Center rather than sitting beside it.
 */
export function finishedNotification(
  s: Pick<SessionDetail, 'id' | 'repo_name' | 'unattended' | 'active_seconds' | 'attended_seconds' | 'stats'>
): LocalNotification {
  const url = `builder://session/${s.id}?recap=1`;
  const identifier = s.id.slice(0, 63);
  if (s.unattended) {
    return {
      identifier,
      title: 'Agent run finished',
      body: `ran ${hm(s.active_seconds)} unattended`,
      data: { kind: KIND_AGENT_RUN_FINISHED, session_id: s.id, url },
    };
  }
  const where = s.repo_name ? ` in ${s.repo_name}` : '';
  const parts: string[] = [];
  const lines = s.stats?.lines_added_agent;
  const prompts = s.stats?.human_prompt_count;
  if (typeof lines === 'number') parts.push(`+${plural(lines, 'line')}`);
  if (typeof prompts === 'number') parts.push(plural(prompts, 'prompt'));
  return {
    identifier,
    title: `Session finished: ${hm(s.attended_seconds ?? s.active_seconds)}${where}`,
    body: parts.join(' \u00b7 ') || 'Open it to see what landed.',
    data: { kind: KIND_SESSION_FINISHED, session_id: s.id, url },
  };
}
