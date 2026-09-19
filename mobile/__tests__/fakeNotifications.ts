/**
 * One fake of expo-notifications for every test file that reaches it. bun's `mock.module` is
 * process wide and the last one registered wins, so two files each faking it their own way would
 * pass or fail by the order they ran in; they share this one and drive its state instead.
 */
import { mock } from 'bun:test';

export const fakeNotifications = {
  granted: true,
  scheduled: [] as { identifier: string; date: Date; kind: unknown }[],
  cancelled: [] as string[],
  /** Identifiers of the notifications sitting in Notification Center. */
  presented: [] as string[],
  reset() {
    this.granted = true;
    this.scheduled.length = 0;
    this.cancelled.length = 0;
    this.presented.length = 0;
  },
};

mock.module('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { DATE: 'date' },
  getPermissionsAsync: async () => ({ granted: fakeNotifications.granted }),
  scheduleNotificationAsync: async (r: { identifier: string; content: { data: { kind: unknown } }; trigger: { date: Date } }) => {
    fakeNotifications.scheduled.push({ identifier: r.identifier, date: r.trigger.date, kind: r.content.data.kind });
    return r.identifier;
  },
  cancelScheduledNotificationAsync: async (id: string) => {
    fakeNotifications.cancelled.push(id);
  },
  getPresentedNotificationsAsync: async () => fakeNotifications.presented.map((identifier) => ({ request: { identifier } })),
}));
