/**
 * The line under the Wrapped title: what the numbers rest on. Pure.
 *
 * A window is a question (CLAUDE.md): a deck that says "84.9 hours" has to say over how
 * many sessions and how many days it found, and when the machine worked it out, without
 * judging either. A saved copy says it is one. The dev sample says it is a sample.
 */
import type { ReportCoverage } from '../generated/report';
import { dayLabel } from '../theme';
import { formatCount } from '../ui/format';

export interface CaptionInput {
  generatedAt: string;
  coverage: ReportCoverage | null;
}

function counted(n: number, one: string, many: string): string {
  return `${formatCount(n, 0, true, '', '')} ${n === 1 ? one : many}`;
}

export const STALE_NOTE = 'saved copy, the server did not answer';
export const SAMPLE_NOTE = 'Sample deck';

export function captionOf(meta: CaptionInput | null, stale: boolean, sample: boolean, now: number = Date.now()): string | null {
  const parts: string[] = [];
  if (sample) parts.push(SAMPLE_NOTE);
  if (meta) {
    const day = dayLabel(meta.generatedAt, now);
    const cov = meta.coverage;
    const span = cov ? `${counted(cov.sessions, 'session', 'sessions')} over ${counted(cov.spans_days, 'day', 'days')}` : null;
    const said = [span, day ? `as of ${day}` : null].filter((p): p is string => p !== null).join(', ');
    if (said) parts.push(said);
  }
  if (stale) parts.push(STALE_NOTE);
  const line = parts.join('. ');
  return line.length > 0 ? line.charAt(0).toUpperCase() + line.slice(1) : null;
}
