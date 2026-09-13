/**
 * The money view's words (`src/copy/money.ts`): dollars at API LIST PRICES, never a bill;
 * the day the prices were read, in UTC; and absent never said as zero.
 */
import { describe, expect, test } from 'bun:test';

import {
  dollars,
  linesAdded,
  linesRemoved,
  modelLine,
  modelName,
  moneyHeadline,
  moneyRefusal,
  NOT_A_BILL,
  perActiveHour,
  pricesAreStale,
  readOn,
  totalTokens,
  unpricedNote,
  withoutACommit,
} from '../src/copy/money';
import { hasDash } from '../src/copy/plain';
import type { ReportMoney } from '../src/generated/report';
import { REPORT_ENUMS } from '../src/generated/report';

/** The design's example block (docs/overnight-integration.md 1.4). */
const MONEY: ReportMoney = {
  usd: 1873.42, basis: 'anthropic_api_list_price', reason: null, prices_read_on: '2026-09-06T00:00:00Z', priced_sessions: 152,
  unpriced_sessions: 0, usd_per_active_hour: 22.1, usd_without_a_commit: 19.8, share_without_a_commit: 0.011,
  tokens: { input: 812_201, output: 9_912_330, cache_read: 3_900_112_034, cache_w5m: 201_334_551, cache_w1h: 0 }, token_sessions: 152,
  lines_added: 64_680, lines_removed: 9_021, lines_basis: 'project_edit_tools_and_credited_shell_writes',
  by_model: [{ model: 'claude-opus-4-8', usd: 1502.2, output_tokens: 9_120_433, sessions: 97, sessions_dominated: 88, commits: 201, usd_per_commit: 6.83 }],
};
const SEP_13 = Date.parse('2026-09-13T12:00:00Z');

describe('the money view', () => {
  test('the headline says list prices and the day they were read, never "spent"', () => {
    const h = moneyHeadline(MONEY, SEP_13)!;
    expect(h).toBe('About $1,873 of API use at list prices, read Sep 6.');
    expect(h.toLowerCase()).not.toContain('spent');
    expect(NOT_A_BILL.toLowerCase()).toContain('not a bill');
  });

  test('stale prices say they may have moved, by basis or by the clock', () => {
    expect(moneyHeadline({ ...MONEY, basis: 'stale_prices' }, SEP_13)).toBe(
      'About $1,873 of API use at list prices, read Sep 6, and they may have moved since.'
    );
    const march = Date.parse('2027-03-10T00:00:00Z');
    expect(pricesAreStale(MONEY, march)).toBe(true);
    expect(pricesAreStale(MONEY, SEP_13)).toBe(false);
  });

  test('the read on day is the UTC day: a phone west of Greenwich does not say Sep 5', () => {
    expect(readOn('2026-09-06T00:00:00Z')).toBe('Sep 6');
    expect(readOn('2026-09-06T00:00:00+00:00')).toBe('Sep 6');
    expect(readOn('not a day')).toBeNull();
  });

  test('dollars: whole from $100, cents below, thousands grouped, rounded like Python', () => {
    expect(dollars(1873.42)).toBe('$1,873');
    expect(dollars(1502.2)).toBe('$1,502');
    expect(dollars(22.1)).toBe('$22.10');
    expect(dollars(6.83)).toBe('$6.83');
    expect(dollars(0.125)).toBe('$0.12');
    expect(dollars(100)).toBe('$100');
  });

  test('the rest of the view', () => {
    expect(perActiveHour(MONEY)).toBe('$22.10 an active hour');
    expect(withoutACommit(MONEY)).toBe('$19.80 on sessions that ended with no commit, 1% of the spend');
    expect(withoutACommit({ ...MONEY, share_without_a_commit: 0.004 })).toBe('$19.80 on sessions that ended with no commit, under 1% of the spend');
    expect(modelLine(MONEY.by_model[0]!)).toBe('Opus 4.8: $1,502 over 97 sessions, $6.83 a commit');
    expect(modelLine({ ...MONEY.by_model[0]!, usd_per_commit: null })).toBe('Opus 4.8: $1,502 over 97 sessions');
    expect(totalTokens(MONEY.tokens)).toBe('4112.2M'); // 4,112,171,116
    expect(linesAdded(MONEY)).toBe('+64,680');
    expect(linesRemoved(MONEY)).toBe('-9,021');
  });

  test('every price table row has its name', () => {
    for (const model of REPORT_ENUMS.priced_model) expect(modelName(model)).not.toBe(model);
  });

  test('absent is never zero: no line count, no priced time, no tokens, a refusal', () => {
    expect(linesAdded({ lines_added: null })).toBeNull();
    expect(linesRemoved({ lines_removed: null })).toBeNull();
    expect(perActiveHour({ ...MONEY, usd_per_active_hour: null })).toBeNull();
    expect(withoutACommit({ ...MONEY, usd_without_a_commit: null })).toBeNull();
    expect(totalTokens(null)).toBeNull();
    const refused: ReportMoney = { ...MONEY, usd: null, basis: null, reason: 'tokens_not_reported', priced_sessions: 0 };
    expect(moneyHeadline(refused, SEP_13)).toBeNull();
    expect(moneyRefusal(refused)).toBe('No session reported token counts, so there is nothing to price.');
    expect(moneyRefusal({ ...refused, reason: 'model_not_in_price_table', unpriced_sessions: 1 })).toBe(
      '1 session used a model with no published price here, so it is not priced at a guess.'
    );
    expect(moneyRefusal({ ...refused, reason: 'model_not_in_price_table', unpriced_sessions: 3 })).toBe(
      '3 sessions used a model with no published price here, so it is not priced at a guess.'
    );
    // Every code the report can carry has its sentence; one this build does not know has none.
    for (const reason of REPORT_ENUMS.money_refusal) expect(typeof moneyRefusal({ ...refused, reason, unpriced_sessions: 2 })).toBe('string');
    expect(moneyRefusal({ ...refused, reason: 'priced_in_yen' as ReportMoney['reason'] })).toBeNull();
    expect(moneyRefusal(MONEY)).toBeNull();
  });

  test('sessions left out of a total say so', () => {
    expect(unpricedNote({ ...MONEY, unpriced_sessions: 2 })).toBe('2 sessions with a model the price table does not know are left out.');
    expect(unpricedNote({ ...MONEY, unpriced_sessions: 1 })).toBe('1 session with a model the price table does not know is left out.');
    expect(unpricedNote(MONEY)).toBeNull();
  });

  test('no dash in anything the view says', () => {
    const said = [
      moneyHeadline(MONEY, SEP_13), moneyHeadline({ ...MONEY, basis: 'stale_prices' }, SEP_13), perActiveHour(MONEY), withoutACommit(MONEY),
      modelLine(MONEY.by_model[0]!), linesAdded(MONEY), linesRemoved(MONEY), NOT_A_BILL, unpricedNote({ ...MONEY, unpriced_sessions: 3 }),
    ];
    for (const s of said) expect({ s, dash: hasDash(s ?? '') }).toEqual({ s, dash: false });
  });
});
