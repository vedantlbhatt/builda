/**
 * The decision feed on a session: the hard to undo things the agent did, one row per kind,
 * as the live engine ranked them (`live_state.decisions`, docs/overnight-engine.md 3.6). The
 * words are `live.DECISION_SENTENCES` through `copy/live.ts`; the wire carries a kind, a
 * clock and a count, never the package, the file or the command, so a row says "Added a
 * dependency." and never which one.
 *
 * The live state exists only while a session runs (it is deleted when the session
 * finalises), so a finished session has no decisions to list, and the section is absent
 * rather than claiming the agent decided nothing.
 *
 * Pure: no React Native, so `bun test` runs it.
 */

import { decisionSentence } from '../copy/live';
import { mins } from '../copy/numbers';
import { spoken } from '../copy/plain';
import type { LiveDecision } from '../generated/live';

export interface DecisionRow {
  key: string;
  /** The engine's sentence: "Threw away uncommitted changes." */
  title: string;
  /** When it first happened and how often: "23 minutes in · twice". Null when neither is known. */
  meta: string | null;
}

/** "once" is never said: a row is one occurrence unless it says otherwise. */
function times(k: number): string | null {
  if (!Number.isInteger(k) || k <= 1) return null;
  return k === 2 ? 'twice' : `${spoken(k)} times`;
}

/**
 * The rows, in the engine's order (hardest to undo first). A kind this build has no
 * sentence for renders no row rather than an id. `startedAt` is the session's start; a
 * decision stamped before it (a clock that disagrees) says no time rather than a negative.
 */
export function decisionRows(decisions: readonly LiveDecision[] | null | undefined, startedAt: string): DecisionRow[] {
  const t0 = Date.parse(startedAt) / 1000;
  const rows: DecisionRow[] = [];
  for (const d of decisions ?? []) {
    const title = decisionSentence(d.kind);
    if (!title) continue;
    const offset = Number.isFinite(t0) && Number.isFinite(d.ts) ? d.ts - t0 : NaN;
    const when = offset >= 0 ? `${mins(offset)} in` : null;
    const meta = [when, times(d.count)].filter((x): x is string => x !== null).join(' · ');
    rows.push({ key: d.kind, title, meta: meta || null });
  }
  return rows;
}
