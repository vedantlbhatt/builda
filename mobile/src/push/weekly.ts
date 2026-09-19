/**
 * Last week's card, by notification: Monday at nine (`weekCardTime.ts`), for someone who does not
 * open the app Monday to Wednesday and so never sees the island offer it (`share/weekOffer.ts`).
 *
 * It is local and scheduled ahead, while the app is in front: once per launch per Monday, and only
 * when THIS week already has hours, because a card is made only for a week with something in it.
 * A week that still has none cancels it. NEVER BOTH (the rule `server/builder/notify.py` states for
 * banners and activities): the island does not offer a card the notification already delivered
 * (`weekCardDelivered`), and opening the card from either marks the week offered.
 *
 * The permission is never asked for here (onboarding's notify step asks, once).
 */
import * as Notifications from 'expo-notifications';

import { WEEK_CARD_NOTIFICATION } from './localCopy';
import { WEEK_CARD_KIND } from './route';
import { nextWeekCardAt } from './weekCardTime';

export const WEEK_CARD_ID = 'week-card';

/** The Monday it was last scheduled for this launch (ms), so the minute poll schedules it once. */
let scheduledFor: number | null = null;

export async function scheduleWeekCard(thisWeekSeconds: number, nowMs: number): Promise<void> {
  try {
    if (thisWeekSeconds <= 0) {
      scheduledFor = null;
      await Notifications.cancelScheduledNotificationAsync(WEEK_CARD_ID);
      return;
    }
    const at = nextWeekCardAt(nowMs);
    if (scheduledFor === at.getTime()) return;
    const perms = await Notifications.getPermissionsAsync();
    if (!perms.granted) return;
    await Notifications.scheduleNotificationAsync({
      identifier: WEEK_CARD_ID,
      content: { title: WEEK_CARD_NOTIFICATION.title, body: WEEK_CARD_NOTIFICATION.body, data: { kind: WEEK_CARD_KIND }, sound: 'default' },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
    });
    scheduledFor = at.getTime();
  } catch {
    // No notifications on this platform (the web build), or none allowed: the island still offers.
  }
}

/** Whether Monday's notification is sitting in Notification Center: then the island stays quiet. */
export async function weekCardDelivered(): Promise<boolean> {
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    return shown.some((n) => n.request.identifier === WEEK_CARD_ID);
  } catch {
    return false;
  }
}
