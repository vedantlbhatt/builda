/**
 * Your stack: what the project is made of, grouped the way Strava lists gear. Pure.
 *
 * The report sends catalog ids with a category, the first kind of evidence that put each one
 * there, and a sessions count (`report.stack`, v2); names are catalog words generated from
 * `analysis/vocab.py STACK` and read through `src/copy/vocab.ts`. An item this build's catalog
 * does not have renders nothing. An item only a manifest names has no session behind it, and
 * it says that rather than "0 sessions", which would read as a measurement of use.
 */
import { capital, count, n } from '../copy/numbers';
import { stackName, stackRefusal } from '../copy/vocab';
import { REPORT_ENUMS, type ReportStack, type ReportStackItem, type StackCategory } from '../generated/report';
import { dayOf } from './numbers';

/** The category as a section label. Lower case: section labels are captions. */
export const STACK_CATEGORY_LABEL: Record<StackCategory, string> = {
  language: 'languages',
  framework: 'frameworks',
  database: 'databases',
  infra: 'infrastructure',
  testing: 'testing',
  tooling: 'tools',
  service: 'services',
};

export interface StackRow {
  id: ReportStackItem['id'];
  /** "PostgreSQL", the catalog's name. */
  name: string;
  /** "14 sessions" on the right, the way a gear list puts the distance; null when no session used it. */
  value: string | null;
  /** "first used Jun 11", or what put it here when no session used it. */
  meta: string;
  sessions: number;
}

export interface StackGroup {
  category: StackCategory;
  label: string;
  items: StackRow[];
}

export interface StackView {
  groups: StackGroup[];
  total: number;
  summary: string;
  cutNote: string | null;
  refusal: string | null;
}

/** What put an item on the list, said for the rows no session used. */
export const EVIDENCE_ONLY: Record<ReportStackItem['evidence'], string> = {
  manifest: 'named in a manifest, not seen in a session',
  language: 'in the languages the agent wrote',
  command: 'seen in a command',
  path: 'seen in a file path',
  tool: 'seen in a tool call',
};

function rowOf(item: ReportStackItem, name: string, now: number): StackRow {
  const seen = item.first_seen ? dayOf(item.first_seen, now) : null;
  return {
    id: item.id,
    name,
    value: item.sessions > 0 ? count(item.sessions, 'session') : null,
    meta: item.sessions > 0 && seen ? `first used ${seen}` : EVIDENCE_ONLY[item.evidence],
    sessions: item.sessions,
  };
}

/**
 * Categories in the catalog's order (`vocab.CATEGORIES`, the spec's `stack_category`), items
 * inside one by sessions, most first; ties keep the report's order, which is the catalog's.
 */
export function stackView(s: ReportStack | null | undefined, now: number = Date.now()): StackView | null {
  if (!s) return null;
  if (s.reason) {
    return {
      groups: [],
      total: 0,
      summary: '',
      cutNote: null,
      // `no_evidence`, the one refusal the stack block has, in the engine's words.
      refusal: `${capital(stackRefusal(s) ?? 'there is nothing to read yet')}, so nothing is named yet.`,
    };
  }
  const groups: StackGroup[] = [];
  for (const category of REPORT_ENUMS.stack_category) {
    const items = s.items
      .map((item, i) => ({ item, i, name: stackName(item.id) }))
      .filter((x): x is { item: ReportStackItem; i: number; name: string } => x.item.category === category && x.name !== null)
      .sort((a, b) => b.item.sessions - a.item.sessions || a.i - b.i)
      .map(({ item, name }) => rowOf(item, name, now));
    if (items.length) groups.push({ category, label: STACK_CATEGORY_LABEL[category], items });
  }
  const total = groups.reduce((a, g) => a + g.items.length, 0);
  const from = [count(s.sessions, 'session')];
  if (s.manifests > 0) from.push(count(s.manifests, 'dependency name', 'dependency names'));
  const summary =
    total === 0
      ? `Nothing found yet in ${from.join(' and ')}.`
      : `${count(total, 'thing')} across ${count(groups.length, 'category', 'categories')}, from ${from.join(' and ')}.`;
  const cutNote =
    s.shell_calls_cut > 0
      ? `${n(s.shell_calls_cut)} of ${count(s.shell_calls, 'shell command')} were cut short in the digest, so a tool may have run unseen.`
      : null;
  return { groups, total, summary, cutNote, refusal: null };
}

/** The You tab's one line for this page. */
export function stackRowLine(v: StackView | null): string | null {
  if (!v) return null;
  if (v.refusal) return 'nothing named yet';
  return `${count(v.total, 'thing')} across ${count(v.groups.length, 'category', 'categories')}`;
}
