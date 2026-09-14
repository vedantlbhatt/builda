import * as Notifications from 'expo-notifications';

import type { SessionDetail } from '../data/api';
import { finishedNotification, needsYouNotification, type LocalNotification } from './localCopy';

/**
 * The phone's own "needs you" and "finished" notifications, for a session that has NO Live
 * Activity (activities off in Settings, past the cap, or iOS older than 16.2). Never both: when
 * an activity runs, its alert and its finished card are the notification (HIG), and
 * `src/live/surface.ts` `planSync` only asks for one of these when none does.
 *
 * They are local, so they fire only while the app is running; a session that needs you while
 * the phone is in a pocket needs a server push, which does not exist yet. The permission is
 * never asked for here (onboarding's notify step asks, once): without it these return null.
 * The copy is in `localCopy.ts`, where bun can hold it to the no dashes rule.
 */

async function post(n: LocalNotification): Promise<string | null> {
  try {
    const perms = await Notifications.getPermissionsAsync();
    if (!perms.granted) return null;
    return await Notifications.scheduleNotificationAsync({
      identifier: n.identifier,
      content: {
        title: n.title,
        body: n.body,
        data: n.data,
        sound: 'default',
        interruptionLevel: 'active',
      },
      trigger: null,
    });
  } catch {
    return null;
  }
}

/** "builder needs you": the sentence says what it is waiting for. A tap opens the session. */
export function scheduleNeedsYou(session: Pick<SessionDetail, 'id' | 'repo_name'>, sentence?: string | null): Promise<string | null> {
  return post(needsYouNotification(session, sentence));
}

/** "Session finished: 1h 42m in builder" / "Agent run finished". A tap opens the recap. */
export function scheduleFinished(
  session: Pick<SessionDetail, 'id' | 'repo_name' | 'unattended' | 'active_seconds' | 'attended_seconds' | 'stats'>
): Promise<string | null> {
  return post(finishedNotification(session));
}
