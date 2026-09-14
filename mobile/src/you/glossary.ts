/**
 * The glossary: the words the sessions have run into, filling in over months. Pure.
 *
 * The report carries ids, counts and first seen clocks (`report.vocab`, v2); each term's word and
 * one line definition are catalog words generated from `analysis/vocab.py` and read through
 * `src/copy/vocab.ts`, never on the wire, never retyped. A term this build's catalog does not
 * have renders nothing, and is not counted as found on a page that cannot show it.
 *
 * A collection, not a game: no unlock, no level, no score. What is left is said as the engine
 * says it, a quiet count of things still to find.
 */
import { lockedLine, term, vocabRefusal } from '../copy/vocab';
import { capital, count, n } from '../copy/numbers';
import type { ReportVocab, VocabTerm } from '../generated/report';
import { dayOf, monthKey, monthLabel } from './numbers';

export interface TermRow {
  id: VocabTerm;
  word: string;
  definition: string;
  /** "Aug 29": the Builda day a session first ran into it. */
  firstSeen: string | null;
}

export interface GlossaryMonth {
  key: string;
  /** "September", or "September 2025" in another year. */
  label: string;
  terms: TermRow[];
}

export interface GlossaryView {
  /** Newest month first; inside a month, in the order the terms were met. */
  months: GlossaryMonth[];
  found: number;
  /** "58 more to find.", or null when there is no count to say (a refusal). */
  locked: string | null;
  /** The one line at the top: how many, from how many sessions. */
  summary: string;
  /** How many shell commands were cut short, when any were: a term may have come up unseen. */
  cutNote: string | null;
  /** Why there is no glossary, when the machine refused one. */
  refusal: string | null;
}

export function glossaryView(v: ReportVocab | null | undefined, now: number = Date.now()): GlossaryView | null {
  if (!v) return null;
  const refused = vocabRefusal(v);
  if (v.reason) {
    return {
      months: [],
      found: 0,
      locked: null,
      summary: '',
      cutNote: null,
      refusal: `${capital(refused ?? 'there is nothing to read yet')}, so no terms can be found yet.`,
    };
  }
  const rows: { row: TermRow; t: number; key: string }[] = [];
  for (const t of v.terms) {
    const words = term(t.id);
    if (!words) continue;
    const at = Date.parse(t.first_seen);
    rows.push({
      row: { id: t.id, word: words.word, definition: words.definition, firstSeen: dayOf(t.first_seen, now) },
      t: Number.isFinite(at) ? at : Number.POSITIVE_INFINITY,
      key: monthKey(t.first_seen) ?? 'unknown',
    });
  }
  rows.sort((a, b) => a.t - b.t || a.row.id.localeCompare(b.row.id));

  const byMonth = new Map<string, TermRow[]>();
  for (const { row, key } of rows) byMonth.set(key, [...(byMonth.get(key) ?? []), row]);
  // Newest month first; a term with no readable date goes last rather than first.
  const months = [...byMonth.entries()]
    .sort(([a], [b]) => (a === 'unknown' ? 1 : b === 'unknown' ? -1 : b.localeCompare(a)))
    .map(([key, terms]) => ({ key, label: key === 'unknown' ? 'date unknown' : monthLabel(key, now), terms }));

  const found = rows.length;
  const summary =
    found === 0
      ? `No terms yet from ${count(v.sessions, 'session')}.`
      : `${count(found, 'term')} from ${count(v.sessions, 'session')}.`;
  const cutNote =
    v.shell_calls_cut > 0
      ? `${n(v.shell_calls_cut)} of ${count(v.shell_calls, 'shell command')} were too long to be read whole, so a term may have come up unseen.`
      : null;
  return { months, found, locked: lockedLine(v), summary, cutNote, refusal: null };
}

/** The You tab's one line for this page. */
export function glossaryRowLine(v: GlossaryView | null): string | null {
  if (!v) return null;
  if (v.refusal) return 'nothing to read yet';
  const found = `${count(v.found, 'term')} so far`;
  return v.locked ? `${found}, ${v.locked.replace(/\.$/, '')}` : found;
}
