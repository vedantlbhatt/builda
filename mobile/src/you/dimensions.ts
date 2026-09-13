/**
 * The five per session dimensions, averaged, as the Dimensions page draws them. Pure.
 *
 * Every number is the server's (`server/builder/builder_profile.py`: one SQL query, mean over
 * the window and recent half minus older half, 0.1 points). This file decides the words for
 * the trend and nothing else, and it refuses to say one the numbers do not carry.
 */
import type { BuilderProfile } from '../data/api';
import { ANALYSIS_ENUMS, type Dimension } from '../generated/analysis';
import { archetypeDisplay } from './archetype';
import { count, n, pct } from '../copy/numbers';

/**
 * A move smaller than this share of the older half is steady. The same bar, and the same
 * UNMEASURED JUDGEMENT CALL, as `analysis/trends.py MIN_MOVE`, which the report's trends and
 * their footnote on the You tab already use; a test reads trends.py and holds the two equal.
 */
export const STEADY_SHARE = 0.15;

export type TrendDirection = 'up' | 'down' | 'steady';

export interface DimensionTrend {
  /** Null when the server sent no trend (fewer sessions than two halves need). */
  direction: TrendDirection | null;
  /** "up 4.1 points", "down 2 points", "steady", "no trend yet". */
  words: string;
}

export interface DimensionView {
  dimension: Dimension;
  /** "product instinct". */
  label: string;
  /** 0 to 100, whole: what the bar and the number show. */
  mean: number;
  sessions: number;
  trend: DimensionTrend;
}

/**
 * The older half's mean, from the three numbers the server sends. The halves are by session
 * order and the recent half holds `floor(n / 2)` sessions (`rn * 2 <= total`), so with
 * `mean = (r R + o O) / n` and `trend = R - O`, `O = mean - (r / n) trend`. Rounding on the
 * wire (0.1 on both) moves it by at most 0.1.
 */
export function olderHalfMean(mean: number, trend: number, sessions: number): number {
  if (sessions <= 0) return mean;
  const recent = Math.floor(sessions / 2);
  return mean - (recent / sessions) * trend;
}

/** "4.1 points", "1 point": the server's 0.1 points, said by `profile._n` with its noun. */
function points(p: number): string {
  return count(Math.abs(p), 'point');
}

/** Up, down or steady in words, with the size of the move. */
export function trendOf(mean: number, trend: number | null | undefined, sessions: number): DimensionTrend {
  if (typeof trend !== 'number' || !Number.isFinite(trend)) return { direction: null, words: 'no trend yet' };
  if (trend === 0) return { direction: 'steady', words: 'steady' };
  const older = olderHalfMean(mean, trend, sessions);
  // Measured against the older half, as trends.py measures a move against `before`. An older
  // half at zero has nothing to be a share of, so any move off it is a move.
  if (older > 0 && Math.abs(trend) < STEADY_SHARE * older) return { direction: 'steady', words: 'steady' };
  return trend > 0 ? { direction: 'up', words: `up ${points(trend)}` } : { direction: 'down', words: `down ${points(trend)}` };
}

/** "product_instinct" is "product instinct": the wire's snake case, said. */
export function dimensionLabel(d: string): string {
  return d.replace(/_/g, ' ');
}

/**
 * The five in spec order (`ANALYSIS_ENUMS.dimension`, the order Swift and Python use), skipping
 * any the server did not score rather than drawing an empty bar that reads as zero.
 */
export function dimensionViews(bp: Pick<BuilderProfile, 'dimensions'> | null | undefined): DimensionView[] {
  if (!bp) return [];
  const out: DimensionView[] = [];
  for (const dimension of ANALYSIS_ENUMS.dimension) {
    const d = bp.dimensions[dimension];
    if (!d || !Number.isFinite(d.mean)) continue;
    const mean = Math.round(Math.min(100, Math.max(0, d.mean)));
    out.push({ dimension, label: dimensionLabel(dimension), mean, sessions: d.sessions, trend: trendOf(d.mean, d.trend, d.sessions) });
  }
  return out;
}

/** The highest mean, ties to spec order: the number the You tab's row states. */
export function topDimension(views: readonly DimensionView[]): DimensionView | null {
  return views.reduce<DimensionView | null>((best, v) => (best === null || v.mean > best.mean ? v : best), null);
}

/** "averaged over 12 analysed sessions in the last 90 days". */
export function dimensionsBasis(bp: Pick<BuilderProfile, 'sessions_analysed' | 'window_days'>): string {
  return `Averaged over ${count(bp.sessions_analysed, 'analysed session')} in the last ${n(bp.window_days)} days.`;
}

/**
 * What the model most often called a session, as a line under the bars: the per session
 * archetype, a different question from the corpus type above it. Null when no session had one.
 */
export function modalArchetypeLine(bp: Pick<BuilderProfile, 'archetype'>): string | null {
  const a = bp.archetype;
  if (!a?.modal || !a.with_archetype) return null;
  const name = archetypeDisplay(a.modal).toLowerCase();
  const article = /^[aeiou]/.test(name) ? 'an' : 'a';
  const share =
    typeof a.share === 'number' ? `, in ${pct(a.share)} of the ${count(a.with_archetype, 'session')} that had a type` : '';
  return `Read one session at a time, the model most often called you ${article} ${name}${share}.`;
}

/** Why there are no bars: the count the server sent against the floor it needs. */
export function dimensionsPending(analysed: number, needed: number): string {
  return `${n(analysed)} of ${n(needed)} analysed sessions so far.`;
}
