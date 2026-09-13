/**
 * The glossary and the stack, in words: the engine's catalog entries for the ids the report
 * carries (`BuilderReport.vocab`, `.stack`), and their refusals.
 *
 * The report sends a term's id and counts, never its word or definition, and a stack item's
 * id, never its name (docs/overnight-integration.md 1.3): the words are generated from
 * `analysis/vocab.py` into `generated/copy.ts`. An id this build's catalog does not have
 * renders nothing.
 */

import type { ReportStack, ReportVocab, StackItem, VocabTerm } from '../generated/report';
import { STACK_NAMES, STACK_REFUSALS, TERMS, VOCAB_REFUSALS } from './catalog';
import { n } from './numbers';

/** A glossary term's word and one line definition, or null for an id the catalog lacks. */
export function term(id: VocabTerm | string): { word: string; definition: string } | null {
  return (TERMS as Record<string, { word: string; definition: string }>)[id] ?? null;
}

/** A stack item's name ("Google Maps Platform"), or null for an id the catalog lacks. */
export function stackName(id: StackItem | string): string | null {
  return (STACK_NAMES as Record<string, string>)[id] ?? null;
}

/**
 * "31 more to find.", as `python -m analysis vocab` says it: catalog terms not met yet. Null
 * on a refusal, where "74 more to find" over nothing read would be a claim about a person.
 */
export function lockedLine(v: ReportVocab): string | null {
  return v.locked == null ? null : `${n(v.locked)} more to find.`;
}

/** Why there is no glossary, in the engine's words. Null when answered. */
export function vocabRefusal(v: ReportVocab): string | null {
  return v.reason == null ? null : (VOCAB_REFUSALS[v.reason] ?? null);
}

/** Why there is no stack, in the engine's words. Null when answered. */
export function stackRefusal(s: ReportStack): string | null {
  return s.reason == null ? null : (STACK_REFUSALS[s.reason] ?? null);
}
