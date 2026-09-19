/**
 * This week on the Sessions band (`src/session/week.ts`): Monday first, days that start at 04:00,
 * the profile graph's seconds (never the notable only list's), the days still to come kept apart
 * from the days nothing finished, and the figure said the way the rest of the app says hours.
 */
import { describe, expect, test } from 'bun:test';

import { hasDash } from '../src/copy/plain';
import { lastWeekOf, lastWeekShown, sameDaysLastWeek, QUIET_WEEK, weekFigure, weekOf, weekOfferLine, weekToOffer } from '../src/session/week';

/** A local instant: Wednesday 16 September 2026 at 10:00 on this machine's clock. */
const WED = new Date(2026, 8, 16, 10, 0).getTime();

describe('the week', () => {
  test('runs Monday to Sunday around today, on the graph\'s own date keys', () => {
    const w = weekOf([], WED);
    expect(w.days.map((d) => d.date)).toEqual(['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20']);
    expect(w.days.map((d) => d.letter).join('')).toBe('MTWTFSS');
    expect(w.days.map((d) => d.today)).toEqual([false, false, true, false, false, false, false]);
    expect(w.days.map((d) => d.future)).toEqual([false, false, false, true, true, true, true]);
  });

  test('a day starts at 04:00: at 02:00 on a Monday it is still Sunday, and the week is the one before', () => {
    const early = new Date(2026, 8, 14, 2, 0).getTime();
    const w = weekOf([], early);
    expect(w.days[0]!.date).toBe('2026-09-07');
    expect(w.days[6]!.today).toBe(true);
  });

  test('sums the graph\'s days in the week and nothing outside it; a later day of the week counts nothing yet', () => {
    const graph = [
      { date: '2026-09-13', active_seconds: 9000 }, // Sunday before: not this week
      { date: '2026-09-14', active_seconds: 3600 },
      { date: '2026-09-16', active_seconds: 1800 },
      { date: '2026-09-16', active_seconds: 600 }, // two rows for one day add up
      { date: '2026-09-18', active_seconds: 7200 }, // Friday, in the future: impossible, never counted
    ];
    const w = weekOf(graph, WED);
    expect(w.days.map((d) => d.seconds)).toEqual([3600, 0, 2400, 0, 0, 0, 0]);
    expect(w.seconds).toBe(6000);
    expect(w.built).toBe(2);
  });
});

describe('the figure', () => {
  test('hours to one decimal from an hour up, with the days it took', () => {
    const f = weekFigure(weekOf([{ date: '2026-09-14', active_seconds: 3600 * 12 + 1440 }, { date: '2026-09-15', active_seconds: 3600 }], WED))!;
    expect(f.num.final).toBe('13.4');
    expect(f.num.value).toBe(13.4);
    expect(f.caption).toBe('hours this week');
    expect(f.note).toBe('across two days so far');
  });

  test('a whole number of hours has no ".0"', () => {
    expect(weekFigure(weekOf([{ date: '2026-09-14', active_seconds: 7200 }], WED))!.num.final).toBe('2');
  });

  test('under an hour is the duration, the way a person says it, on one day', () => {
    const f = weekFigure(weekOf([{ date: '2026-09-16', active_seconds: 42 * 60 }], WED))!;
    expect(f.num.final).toBe('42m');
    expect(f.num.fmt).toEqual({ kind: 'duration' });
    expect(f.caption).toBe('this week');
    expect(f.note).toBe('on one day so far');
  });

  test('a week with nothing finished is a sentence, never a zero', () => {
    expect(weekFigure(weekOf([], WED))).toBeNull();
    expect(hasDash(QUIET_WEEK)).toBe(false);
  });
});

describe('last week, made by itself', () => {
  // Monday 14 September 2026 at 10:00, the start of a Builda week; Sunday 13th is last week's end.
  const MON = new Date(2026, 8, 14, 10).getTime();
  const graph = [
    { date: '2026-09-07', active_seconds: 3600 * 5 },
    { date: '2026-09-11', active_seconds: 3600 * 7 + 1800 },
    // Sunday night past midnight is still Sunday on the Builda clock: the graph already says 13th.
    { date: '2026-09-13', active_seconds: 1800 },
    { date: '2026-09-14', active_seconds: 900 },
  ];

  test('last week is the seven days before this Monday, all over, none of them today', () => {
    const w = lastWeekOf(graph, MON);
    expect(w.days.map((d) => d.date)).toEqual(['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13']);
    expect(w.days.every((d) => !d.today && !d.future)).toBe(true);
    expect(w.seconds).toBe(3600 * 13);
    expect(w.built).toBe(3);
  });

  test('its figure says last week, with no "so far"', () => {
    const f = weekFigure(lastWeekOf(graph, MON))!;
    expect(f.caption).toBe('hours last week');
    expect(f.note).toBe('across three days');
    expect(weekOfferLine(lastWeekOf(graph, MON))).toBe("Last week's card is made: 13 hours. Tap to see it.");
    const short = lastWeekOf([{ date: '2026-09-09', active_seconds: 42 * 60 }], MON);
    expect(weekOfferLine(short)).toBe("Last week's card is made: 42m. Tap to see it.");
  });

  test('it is news Monday to Wednesday, offered once, and never for an empty week', () => {
    expect(weekToOffer(graph, MON, null)?.days[0]!.date).toBe('2026-09-07');
    expect(weekToOffer(graph, MON, '2026-09-07')).toBeNull();
    const wed = new Date(2026, 8, 16, 23).getTime();
    const thu = new Date(2026, 8, 17, 9).getTime();
    expect(lastWeekShown(graph, wed)).not.toBeNull();
    expect(lastWeekShown(graph, thu)).toBeNull();
    // 02:00 on Thursday is still Wednesday on the Builda clock.
    expect(lastWeekShown(graph, new Date(2026, 8, 17, 2).getTime())).not.toBeNull();
    expect(weekToOffer([{ date: '2026-09-14', active_seconds: 900 }], MON, null)).toBeNull();
  });
});

describe('against last week, fairly', () => {
  const graph = [
    { date: '2026-09-07', active_seconds: 3600 * 5 },
    { date: '2026-09-08', active_seconds: 3600 * 2 + 720 },
    { date: '2026-09-11', active_seconds: 3600 * 7 },
    { date: '2026-09-14', active_seconds: 900 },
  ];

  test('Tuesday is held to last Monday and Tuesday, not to the whole week', () => {
    const tue = new Date(2026, 8, 15, 12).getTime();
    expect(sameDaysLastWeek(graph, tue)).toBe('Same days last week: 7.2 hours');
  });

  test('Sunday is the whole of last week, said so', () => {
    const sun = new Date(2026, 8, 20, 12).getTime();
    expect(sameDaysLastWeek(graph, sun)).toBe('Last week: 14.2 hours');
  });

  test('nothing on those days last week says nothing', () => {
    expect(sameDaysLastWeek([{ date: '2026-09-11', active_seconds: 3600 }], new Date(2026, 8, 15, 12).getTime())).toBeNull();
    expect(sameDaysLastWeek([{ date: '2026-09-07', active_seconds: 1800 }], new Date(2026, 8, 14, 12).getTime())).toBe('Same days last week: 30m');
  });
});
