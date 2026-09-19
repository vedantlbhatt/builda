/**
 * Monday's notification for last week's card (`push/weekly.ts`), with expo-notifications faked:
 * scheduled for nine on the next Monday while this week has hours, once per Monday however often
 * the minute poll asks, cancelled when the week has nothing, never without the permission.
 */
import { beforeEach, describe, expect, test } from 'bun:test';

import { fakeNotifications as fake } from './fakeNotifications';

const { scheduleWeekCard, WEEK_CARD_ID } = await import('../src/push/weekly');
const { hasDash } = await import('../src/copy/plain');
const { WEEK_CARD_NOTIFICATION } = await import('../src/push/localCopy');

const at = (y: number, m: number, d: number, h: number) => new Date(y, m - 1, d, h).getTime();

beforeEach(() => fake.reset());

describe("Monday's notification", () => {
  test('a week with hours: nine on Monday, once however often the poll asks', async () => {
    await scheduleWeekCard(3600, at(2026, 9, 19, 8));
    await scheduleWeekCard(3700, at(2026, 9, 19, 8) + 60_000);
    expect(fake.scheduled).toHaveLength(1);
    expect(fake.scheduled[0]!.identifier).toBe(WEEK_CARD_ID);
    expect(fake.scheduled[0]!.kind).toBe('week_card');
    expect(fake.scheduled[0]!.date.getTime()).toBe(at(2026, 9, 21, 9));
  });

  test('a week with nothing yet: cancelled, and scheduled again once it has hours', async () => {
    await scheduleWeekCard(0, at(2026, 9, 22, 8));
    expect(fake.cancelled).toEqual([WEEK_CARD_ID]);
    await scheduleWeekCard(1800, at(2026, 9, 22, 20));
    expect(fake.scheduled.map((s) => s.date.getTime())).toEqual([at(2026, 9, 28, 9)]);
  });

  test('no permission: nothing scheduled, and nothing asked', async () => {
    fake.granted = false;
    await scheduleWeekCard(3600, at(2026, 10, 3, 8));
    expect(fake.scheduled).toHaveLength(0);
  });

  test('its words carry no number and no dash', () => {
    for (const w of [WEEK_CARD_NOTIFICATION.title, WEEK_CARD_NOTIFICATION.body]) {
      expect(hasDash(w)).toBe(false);
      expect(/\\d/.test(w)).toBe(false);
    }
  });
});
