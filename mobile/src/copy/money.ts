/**
 * The money view's words: dollars beside tokens beside lines.
 *
 * WHAT THE NUMBER IS, said everywhere it is shown (`analysis/pricing.py`): what the tokens
 * would cost on the Anthropic API at list prices. Most people running these tools are on a
 * subscription and are billed nothing per token, so it is never "you spent". "About $1,873
 * of API use at list prices" is true and useful; "You spent $1,873" is false for a
 * subscriber and is exactly the plausible wrong number this codebase refuses.
 *
 * Prices are a measurement and they go stale: every line that states a price says the day
 * the table was read, and past `PRICE_STALE_DAYS` that it may have moved.
 *
 * Absent is never zero here. A block the machine did not send, a refusal, a line count no
 * session carried: each renders as nothing (null), never as "$0" or "+0".
 */

import type { PricedModel, ReportModelCost, ReportMoney, ReportTokens } from '../generated/report';
import { everyPricedSessionCounted } from '../money/counted';
import { FAMILIES, PRICE_STALE_DAYS, SPEND_REFUSALS } from './catalog';
import { capital, commas, count, fill, human, pyFixed, shareWords } from './numbers';

/** Said beside every total, once. */
export const NOT_A_BILL = 'Not a bill: most people pay by subscription, not by the token.';

/**
 * Dollars as a person reads them: whole dollars from $100 ("$1,873"), cents below it
 * ("$22.10", "$0.43"), because a price per commit or per hour is read to the cent and a
 * total is not. UNMEASURED JUDGEMENT CALL on where the cents stop.
 */
export function dollars(usd: number): string {
  if (Math.abs(usd) >= 100) return `$${pyFixed(usd, 0, true)}`;
  return `$${pyFixed(usd, 2, true)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/**
 * The day the price table was read, "Sep 6". Read in UTC: the report sends it at 00:00Z,
 * and a phone west of Greenwich would otherwise say Sep 5.
 */
export function readOn(iso: string): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Whether the table is older than the engine trusts, on the given clock. */
export function pricesAreStale(money: Pick<ReportMoney, 'basis' | 'prices_read_on'>, nowMs: number = Date.now()): boolean {
  if (money.basis === 'stale_prices') return true;
  const read = Date.parse(money.prices_read_on);
  return !Number.isNaN(read) && (nowMs - read) / 86_400_000 > PRICE_STALE_DAYS;
}

/**
 * The headline: "About $1,873 of API use at list prices, read Sep 6." With a stale table,
 * it says the prices may have moved. Null on a refusal (see `moneyRefusal`).
 */
export function moneyHeadline(money: ReportMoney, nowMs: number = Date.now()): string | null {
  if (money.usd == null || money.reason != null) return null;
  const day = readOn(money.prices_read_on);
  const when = day ? `, read ${day}` : '';
  const stale = pricesAreStale(money, nowMs) ? ', and they may have moved since' : '';
  return `About ${dollars(money.usd)} of API use at list prices${when}${stale}.`;
}

/**
 * What each refusal means for the money view, said after the engine's own reason. The
 * reason is `profile.SPEND_REFUSALS`'s (generated, never retyped); this is only the
 * consequence, which is the view's to say.
 */
const REFUSED_BECAUSE: Readonly<Record<string, string>> = {
  tokens_not_reported: 'so there is nothing to price',
  model_not_in_price_table: 'so it is not priced at a guess',
};

/**
 * Why there is no price, as one sentence: the engine's reason for the block's code, then
 * what that means here. "No session reported token counts, so there is nothing to price."
 * Null when priced, and for a code this build does not know.
 */
export function moneyRefusal(money: ReportMoney): string | null {
  const code = money.reason;
  const template = code == null ? undefined : SPEND_REFUSALS[code];
  const because = code == null ? undefined : REFUSED_BECAUSE[code];
  if (template === undefined || because === undefined) return null;
  const reason = fill(template, { unpriced_sessions: money.unpriced_sessions });
  return reason === null ? null : `${capital(reason)}, ${because}.`;
}

/** Sessions with token counts whose model has no price, said beside a total that left them out. */
export function unpricedNote(money: ReportMoney): string | null {
  if (money.usd == null || !money.unpriced_sessions) return null;
  return `${count(money.unpriced_sessions, 'session')} with a model the price table does not know ${money.unpriced_sessions === 1 ? 'is' : 'are'} left out.`;
}

/** "$22.10 an active hour", or null without priced time. */
export function perActiveHour(money: ReportMoney): string | null {
  return money.usd_per_active_hour == null ? null : `${dollars(money.usd_per_active_hour)} an active hour`;
}

/**
 * What the share of the no commit dollars is OF, in the Money page's words: "of every dollar at
 * API list prices" when every priced session had a commit count (the share's denominator is then
 * every priced dollar), else what the share is really over, the dollars on sessions with a commit
 * count (`money/counted.ts`). One rule for the analysis page, the Money page and a project's page.
 * FOUND IN THE CAPTURE (2026-09-14, 21-analysis-15 against 22-money-06): the analysis page said
 * "7% of the spend" where the Money page said "7% of every dollar at API list prices" for the
 * same 7%, and "the spend" is a word for money somebody paid.
 */
export function noCommitShareOf(money: Pick<ReportMoney, 'usd' | 'usd_without_a_commit' | 'share_without_a_commit'>): string {
  return everyPricedSessionCounted(money) ? 'of every dollar at API list prices' : 'of the dollars on sessions with a commit count';
}

/**
 * The postable one: what the sessions that ended with no commit cost. "$19.80 on sessions
 * that ended with no commit, 1% of every dollar at API list prices". Null below the engine's
 * session floor.
 */
export function withoutACommit(money: ReportMoney): string | null {
  if (money.usd_without_a_commit == null) return null;
  const share = money.share_without_a_commit;
  const tail = share == null ? '' : `, ${shareWords(share)} ${noCommitShareOf(money)}`;
  return `${dollars(money.usd_without_a_commit)} on sessions that ended with no commit${tail}`;
}

/** `pricing.FAMILIES`: "Opus 4.8" for a price table row. */
export function modelName(model: PricedModel): string {
  return FAMILIES[model] ?? model;
}

/**
 * One price table row: "Opus 4.8: $1,502 over 97 sessions, $6.83 a commit". The commits are
 * only those of sessions the model wrote most of, so the rows are never summed.
 */
export function modelLine(row: ReportModelCost): string {
  const perCommit = row.usd_per_commit == null ? '' : `, ${dollars(row.usd_per_commit)} a commit`;
  return `${modelName(row.model)}: ${dollars(row.usd)} over ${count(row.sessions, 'session')}${perCommit}`;
}

/**
 * Every token the priced sessions moved, as `burn._human` says it: "12.9M", and "4,168.5M"
 * (the millions grouped on both sides) rather than a unit the engine never prints.
 */
export function totalTokens(t: ReportTokens | null | undefined): string | null {
  if (!t) return null;
  return human(t.input + t.output + t.cache_read + t.cache_w5m + t.cache_w1h);
}

/**
 * Lines added and removed, for green and red: "+64,680" and "-9,021". A hyphen before the
 * digits, never a minus sign (U+2212 is a dash by `plain.DASH_CHARS`). Null for a side no
 * session counted: a line count that was not read is not "+0".
 */
export function linesAdded(money: Pick<ReportMoney, 'lines_added'>): string | null {
  return money.lines_added == null ? null : `+${commas(money.lines_added)}`;
}

export function linesRemoved(money: Pick<ReportMoney, 'lines_removed'>): string | null {
  return money.lines_removed == null ? null : `-${commas(money.lines_removed)}`;
}
