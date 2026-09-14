import type {
  BuilderReport,
  ReportCoverage,
  ReportAgents,
  ReportContributions,
  ReportQuality,
  ReportTrend,
} from '../generated/report';
import { percentOf, pyFixed, pyRound } from '../copy/numbers';

/**
 * Turning the measured report into the words on the screen. NO REACT IN HERE, on purpose:
 * every rule below is a sentence a person reads about themselves, and `bun test` can only
 * hold them to it if they are a function.
 *
 * The one rule that runs through all of it: NULL IS NOT ZERO. Every block of the report is
 * null when the machine refused it, and each refusal carries the count that forced it.
 * Rendering a refusal as "0" is the failure mode this whole product exists to avoid, so
 * the helpers below return `null` for "say nothing" and never a zero standing in for one.
 */

/** How a trend reads out loud: "up 152%", "down 62%", "steady". */
export function trendWords(t: ReportTrend): string {
  if (t.direction === 'steady') return 'steady';
  // The one rounding rule (`copy/numbers`), as `trends.headline` says the same move.
  return `${t.direction} ${percentOf(Math.abs(t.move))}%`;
}

/**
 * The verdict, or nothing.
 *
 * DIRECTION IS NOT VIRTUE. `good` is null for every metric where the answer depends on
 * what the person wants — more hours is not better, more tokens is not worse, a night owl
 * is not broken — and a screen that put a green arrow on all of them would be inventing an
 * opinion the measurement does not have.
 */
export function trendVerdict(t: ReportTrend): 'good' | 'bad' | null {
  if (t.good === null || t.good === undefined || t.direction === 'steady') return null;
  return t.good ? 'good' : 'bad';
}

/** A trend's two values, at a precision that does not pretend to more than it has. */
export function trendValues(t: ReportTrend): string {
  return `${num(t.before)} → ${num(t.now)}`;
}

function num(v: number): string {
  if (v === 0) return '0';
  if (Math.abs(v) >= 100) return pyFixed(v, 0);
  if (Math.abs(v) >= 1) return pyFixed(v, 1);
  return pyFixed(v, 2);
}

/** m and h, never "0.03 hours". Seconds below a minute round up to one. */
export function shortDuration(seconds: number): string {
  if (seconds < 60) return '1m';
  const m = pyRound(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h}h ${rest}m` : `${h}h`;
}

/**
 * The one line about fanning out.
 *
 * `parallelism` is agent-seconds over BUSY seconds, so it is never below 1.0 when anything
 * ran and reads as "this many at once". The peak is reported beside it because an average
 * of 2.9 with a peak of 8 is a different day from a steady 2.9.
 */
export function fanoutLine(a: ReportAgents): string {
  const at = a.max_concurrent > 1 ? `, up to ${a.max_concurrent} at once` : '';
  return `${a.agents} agents, ${shortDuration(a.agent_seconds)} of agent work${at}.`;
}

/**
 * What the delegation actually returned, or nothing.
 *
 * Silent when every agent produced something: "51 of 51" is a line that costs a row and
 * says nothing. It is worth the row precisely when it is not all of them.
 */
export function fanoutWaste(a: ReportAgents): string | null {
  const idle = a.agents - a.produced;
  if (idle <= 0) return null;
  return `${idle} of them produced nothing at all.`;
}

/** The share of commits an agent was in the room for, or null when there are none. */
export function assistedShare(c: ReportContributions): number | null {
  const total = c.assisted + c.alone;
  return total > 0 ? c.assisted / total : null;
}

/**
 * The streak sentence, or nothing.
 *
 * A streak counts days you SHIPPED, not days you opened the app. Zero is not a sentence:
 * telling somebody their streak is 0 is a scold, and this screen is a measurement.
 */
export function streakLine(c: ReportContributions): string | null {
  if (c.current_streak <= 0) return null;
  const d = c.current_streak === 1 ? 'day' : 'days';
  const best = c.longest_streak > c.current_streak ? `, best ${c.longest_streak}` : '';
  return `${c.current_streak} ${d} in a row${best}.`;
}

/**
 * Time to green as the VALUE beside a "Back to green" label, or null when nothing in the
 * window failed and then passed.
 *
 * It does not repeat the label. Found by looking at it: the row read "Back to green — 2m
 * back to green, 2 runs typically", which says the same three words twice in eleven.
 *
 * Null rather than a zero. A refused recovery rendered as "0m" would read as the best
 * possible score for a corpus that has no score at all; the section prints the module's
 * own reason instead, and "5 test runs, 5 needed" tells a person what would make the
 * number appear.
 */
export function greenLine(q: ReportQuality): string | null {
  if (!q.time_to_green) return null;
  const g = q.time_to_green;
  const tries = g.median_attempts > 1 ? `, ${g.median_attempts} runs typically` : '';
  return `${shortDuration(g.median_seconds)}${tries}`;
}

/** Which sections have anything to say at all, so the screen can skip its own header. */
export function hasAnything(r: BuilderReport): boolean {
  return Boolean(
    r.trends.length || r.agents || r.contributions || r.quality || r.prompting
  );
}


/**
 * What the report rests on, in one line — or null when there is nothing to caveat.
 *
 * THE BUG THIS EXISTS FOR. A fresh machine answers a thirty day question with two days of
 * transcripts and says nothing about the difference. Read out loud, "109 commits, none
 * written alone" then sounds like a fact about a person when it is a fact about a
 * container that has existed since Tuesday.
 *
 * It states both numbers and judges neither. There is no threshold and no warning colour:
 * "30 days asked for, 2 days on this machine" needs no adjective, and a reader who has
 * been building for a month knows instantly that the rest of it is somewhere else.
 *
 * Silent only when the span IS the window. Longer is said too: the numbers then rest on more
 * than the question asked, and a page that went quiet then would let "the last 30 days" stand
 * over 34 of them. FOUND IN REVIEW (2026-09-13): a report built over all history spanned Aug
 * 11 to Sep 13 under "The last 30 days", and this line said nothing.
 *
 * `spans_days` counts DATES, both ends included (`profile.py`: last day less first, plus one),
 * so a window of 30 days touches up to 31 of them: 10:00 on Aug 14 to 10:00 on Sep 13 is the
 * window, exactly, on 31 dates (`windowDates`).
 */
export function coverageLine(c: ReportCoverage): string | null {
  if (c.spans_days >= c.window_days && c.spans_days <= windowDates(c.window_days)) return null;
  const d = c.spans_days === 1 ? 'day' : 'days';
  if (c.spans_days > c.window_days) return `${c.window_days} days asked for; these numbers span ${c.spans_days} ${d}.`;
  return `${c.window_days} days asked for; these transcripts span ${c.spans_days} ${d}.`;
}

/** The most dates a window of `days` days can touch, both ends included. */
export function windowDates(days: number): number {
  return days + 1;
}

/**
 * Whether a report's numbers rest on the window it names: its first sitting no earlier than
 * `window_days` before it was made (the engine's own bound, `corpus.window`), or with no clock
 * to compare, no more dates than the window touches. THE ONE TEST every line that says "the
 * last N days" asks first (`insights/model.readSpan`); when it fails, the line says the stretch
 * it actually read. A report from an engine that read all of history fails it, however the
 * phone came by it. A second of slack: both clocks travel as whole seconds.
 */
export function withinWindow(c: ReportCoverage, generatedAt: string): boolean {
  const first = c.first_at ? Date.parse(c.first_at) : NaN;
  const made = Date.parse(generatedAt);
  if (Number.isFinite(first) && Number.isFinite(made)) return first >= made - c.window_days * 86_400_000 - 1000;
  return c.spans_days <= windowDates(c.window_days);
}

/**
 * The second half, and the one that is actually actionable: where the rest would be.
 *
 * Only shown when the gap is stark. A machine holding 28 of 30 days has nothing missing;
 * one holding 2 of 30 is either a new install, a different computer, or sessions that ran
 * in the cloud and were never captured.
 */
export function coverageHint(c: ReportCoverage): string | null {
  if (c.spans_days * 2 > c.window_days) return null;
  return 'Sessions on another machine, or in Claude Code on the web, are not in this.';
}
