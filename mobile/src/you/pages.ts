/**
 * The You tab's own decisions, apart from the four pages: the one line under each page's row,
 * the Wrapped entry's line, and the grid the Wrapped entry dithers. Pure.
 */
import type { BuilderProfileResponse, Profile } from '../data/api';
import { graphLevel } from '../theme';
import { dimensionViews, dimensionsPending, topDimension } from './dimensions';
import { glossaryRowLine, glossaryView } from './glossary';
import { count, n } from '../copy/numbers';
import { moneyRowLine, moneyView } from './money';
import { maskDollars } from './numbers';
import { stackRowLine, stackView } from './stack';

export type PageKey = 'dimensions' | 'money' | 'glossary' | 'stack';

export interface PageRow {
  key: PageKey;
  title: string;
  /** One line that states a real number, or says plainly why there is none yet. */
  line: string;
  href: `/you/${PageKey}`;
}

/** What a page says on the tab when the Mac has not sent the block it reads. */
export const NOT_SENT = 'arrives with the report from your Mac';

/** The rows into the four pages, in the order a person asks: how, what it cost, the words, the stack. */
export function pageRows(b: BuilderProfileResponse, masked: boolean, now: number = Date.now()): PageRow[] {
  const report = b.report ?? null;

  let dimensions: string;
  const views = dimensionViews(b.builder_profile);
  const top = topDimension(views);
  if (top) dimensions = `${top.label} ${top.mean} of 100, the highest of ${n(views.length)}`;
  else dimensions = dimensionsPending(b.sessions_analysed, b.min_sessions).replace(/\.$/, '');

  const said = moneyRowLine(moneyView(b.corpus, report, now))?.replace(/\.$/, '') ?? NOT_SENT;
  const money = masked ? maskDollars(said) : said;
  const glossary = glossaryRowLine(glossaryView(report?.vocab, now)) ?? NOT_SENT;
  const stack = stackRowLine(stackView(report?.stack, now)) ?? NOT_SENT;

  return [
    { key: 'dimensions', title: 'Dimensions', line: dimensions, href: '/you/dimensions' },
    { key: 'money', title: 'Money', line: money, href: '/you/money' },
    { key: 'glossary', title: 'Glossary', line: glossary, href: '/you/glossary' },
    { key: 'stack', title: 'Your stack', line: stack, href: '/you/stack' },
  ];
}

/** How many of the fifteen cards the Mac answered, or null when it sent no Wrapped block. */
export function wrappedLine(b: BuilderProfileResponse): string | null {
  const cards = b.report?.wrapped?.cards;
  if (!cards || cards.length === 0) return null;
  const answered = cards.filter((c) => !c.reason).length;
  return `${n(answered)} of ${count(cards.length, 'question')} answered`;
}

/**
 * The last `weeks` weeks of active hours as a grid for the dither: seven rows, Monday first,
 * one column a week, each day its graph level over the top level (the same absolute buckets as
 * the contribution grid, `theme.graphLevel`). Days before the first one the server sent, and
 * after today, are paper.
 */
export function activityGrid(graph: Profile['graph'], weeks: number): number[][] {
  const rows: number[][] = Array.from({ length: 7 }, () => new Array<number>(weeks).fill(0));
  if (graph.length === 0 || weeks <= 0) return rows;
  // The latest day sent, not the last row: nothing promises the rows arrive in order.
  const lastDay = graph.reduce((m, d) => {
    const t = Date.parse(`${d.date}T00:00:00Z`);
    return Number.isFinite(t) && t > m ? t : m;
  }, Number.NEGATIVE_INFINITY);
  if (!Number.isFinite(lastDay)) return rows;
  const lastWeekday = (new Date(lastDay).getUTCDay() + 6) % 7;
  for (const d of graph) {
    const t = Date.parse(`${d.date}T00:00:00Z`);
    if (!Number.isFinite(t)) continue;
    const back = Math.round((lastDay - t) / 86_400_000);
    // Column from the right: the last day's week is the last column.
    const slot = lastWeekday - back;
    const col = weeks - 1 + Math.floor(slot / 7);
    const row = ((slot % 7) + 7) % 7;
    if (col < 0 || col >= weeks) continue;
    rows[row]![col] = Math.min(graphLevel(d.active_seconds), 5) / 5;
  }
  return rows;
}
