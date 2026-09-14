/**
 * Settings > Live Activities, through the real sync with ActivityKit faked.
 *
 * The owner swiped the app away and the card for a running session stayed in the Dynamic
 * Island, with no way to take it down from the app (2026-09-13). The switch has to do three
 * things a person can see: take down every card when it goes off, including one left from
 * before this launch; start none while it stays off; start them again when it comes back on.
 */
import { describe, expect, mock, test } from 'bun:test';

const calls = { endAll: 0, start: 0, update: 0, end: 0 };
// React Native defines it; activity.ts reads it at import for the push environment.
(globalThis as { __DEV__?: boolean }).__DEV__ = true;

mock.module('react-native', () => ({ Platform: { OS: 'ios', select: (o: Record<string, unknown>) => o.ios } }));
mock.module('../modules/builder-live', () => ({
  default: {
    areActivitiesEnabled: () => true,
    addListener: () => ({ remove() {} }),
    // A card from before this launch, still up: the one the owner could not get rid of.
    list: () => [{ id: 'from-before-launch', sessionId: 'debug-builder', state: 'active' }],
    endAll: async () => {
      calls.endAll += 1;
    },
    start: async () => {
      calls.start += 1;
      return `card-${calls.start}`;
    },
    update: async () => {
      calls.update += 1;
    },
    end: async () => {
      calls.end += 1;
    },
  },
}));
mock.module('../src/data/client', () => ({
  api: { registerLiveActivity: async () => ({}), forgetLiveActivity: async () => ({}) },
}));
mock.module('../src/push/local', () => ({ scheduleNeedsYou: async () => null, scheduleFinished: async () => null }));
mock.module('../src/live/widget', () => ({ writeWidgetSnapshot: () => true, clearWidgetSnapshot: () => {} }));

const NOW = Date.parse('2026-09-13T22:00:00Z');

describe('Settings > Live Activities', () => {
  test('off takes every card down, starts none, and on starts them again', async () => {
    const { syncLiveActivities } = await import('../src/live/activity');
    const { debugSessions } = await import('../src/live/fixtures');
    const d = debugSessions('working', 1, NOW);
    const opts = (nowMs: number, activities: boolean) => ({ nowMs, activities, notify: false, writeWidget: false });

    // A launch that finds the switch off: the card from before this launch comes down.
    let r = await syncLiveActivities(d.sessions, d.liveStates, opts(NOW, false));
    expect(calls.endAll).toBe(1);
    expect(r.started).toBe(0);
    expect(r.updated).toBe(0);

    // Still off: nothing starts, and nothing is taken down twice.
    r = await syncLiveActivities(d.sessions, d.liveStates, opts(NOW + 60_000, false));
    expect(calls.endAll).toBe(1);
    expect(r.started).toBe(0);

    // Back on: the running session gets its card.
    r = await syncLiveActivities(d.sessions, d.liveStates, opts(NOW + 120_000, true));
    expect(r.started).toBe(1);

    // Off again: every card comes down on the sync that hears it.
    r = await syncLiveActivities(d.sessions, d.liveStates, opts(NOW + 180_000, false));
    expect(calls.endAll).toBe(2);
    expect(r.started).toBe(0);
    expect(r.updated).toBe(0);
  });
});
