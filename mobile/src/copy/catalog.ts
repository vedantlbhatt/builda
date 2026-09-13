/**
 * The engine's fixed words, as the phone's renderers read them.
 *
 * Every table here is `generated/copy.ts`, which `scripts/gen_copy.py` reads out of the
 * engine's own Python tables (docs/overnight-integration.md 1.5): the phone never retypes a
 * catalog, and a reworded Python table reaches the phone through `make gen`. This module
 * only gives each table the type its readers look it up by (a card id, a refusal code, a
 * file role) so a renderer can ask for a code the generated `as const` literal does not
 * name and get `undefined` rather than a compile error: an id this build does not know
 * renders nothing.
 */

import type { BurnCause, BurnRepeat } from '../generated/contract';
import * as G from '../generated/copy';
import type { DecisionKind } from '../generated/live';
import type { CommitKind, PlainRole, PricedModel, StackItem, VocabTerm, WrappedCard } from '../generated/report';
import type { FillTemplate } from './numbers';

/** A refusal template (`profile.fill`, ported as `numbers.fill`). */
export type Template = FillTemplate;

// ------------------------------------------------------------------ analysis/wrapped.py

export const QUESTIONS: Readonly<Record<WrappedCard, string>> = G.QUESTIONS;
export const ARCHETYPE_DISPLAY = G.ARCHETYPE_DISPLAY;
export type ArchetypeOrGeneralist = keyof typeof G.ARCHETYPE_DISPLAY;
export const WORK_STYLE_DISPLAY = G.WORK_STYLE_DISPLAY;
export type WorkStyle = keyof typeof G.WORK_STYLE_DISPLAY;
export const KINDS: readonly CommitKind[] = G.KINDS;
export const KIND_NOUN: Readonly<Record<CommitKind, readonly [string, string]>> = G.KIND_NOUN;
export const ROLE_DISPLAY: Readonly<Record<PlainRole, string>> = G.ROLE_DISPLAY;
export const ROLE_WORD: Readonly<Record<PlainRole, string>> = G.ROLE_WORD;
export const LOCAL_CARDS: readonly WrappedCard[] = G.LOCAL_CARDS;
export const QUOTE_CARDS: readonly WrappedCard[] = G.QUOTE_CARDS;
export const WITH_YOU: string = G.WITH_YOU;
export const LOOKBACK_MINUTES: number = G.LOOKBACK_MINUTES;
export const SHORT_PROMPT_WORDS: number = G.SHORT_PROMPT_WORDS;
export const PROMPT_BRIEF_WORDS: number = G.PROMPT_BRIEF_WORDS;

/** `wrapped.REFUSALS`, keyed by string: the engine may name a code before the report spec has one. */
export const REFUSALS: Readonly<Record<string, Template>> = G.REFUSALS;
/** `wrapped.KIND_REFUSALS`, keyed by `extras.commit_refusal`. */
export const KIND_REFUSALS: Readonly<Record<string, string>> = G.KIND_REFUSALS;
/** `wrapped.REFUSAL_CONSTANTS`: the numbers a refusal names that no card carries. */
export const REFUSAL_CONSTANTS: Readonly<Record<string, number>> = G.REFUSAL_CONSTANTS;

// ------------------------------------------------------------------ analysis/profile.py

/** `profile.BARREN_REFUSALS`, by the corpus burn block's `reason`. */
export const BARREN_REFUSALS: Readonly<Record<string, string>> = G.BARREN_REFUSALS;
/** `profile.SPEND_REFUSALS`, by the money block's `reason`. */
export const SPEND_REFUSALS: Readonly<Record<string, string>> = G.SPEND_REFUSALS;

// ------------------------------------------------------------------ analysis/vocab.py

export const TERMS: Readonly<Record<VocabTerm, { readonly word: string; readonly definition: string }>> = G.TERMS;
export const STACK_NAMES: Readonly<Record<StackItem, string>> = G.STACK_NAMES;
export const VOCAB_REFUSALS: Readonly<Record<string, string>> = G.VOCAB_REFUSALS;
export const STACK_REFUSALS: Readonly<Record<string, string>> = G.STACK_REFUSALS;

// ------------------------------------------------------------------ analysis/burn.py

export const CAUSE_SENTENCES: Readonly<Record<BurnCause, string>> = G.CAUSE_SENTENCES;
export const CAUSE_SENTENCES_ONE: Readonly<Partial<Record<BurnCause, string>>> = G.CAUSE_SENTENCES_ONE;
export const REPEAT_SENTENCES: Readonly<Record<BurnRepeat, string>> = G.REPEAT_SENTENCES;
export const UNREADABLE_VERDICT: string = G.UNREADABLE_VERDICT;
export const CONTEXT_REPLAY_MIN_SHARE: number = G.CONTEXT_REPLAY_MIN_SHARE;
export const SAY_SHARE_AT: number = G.SAY_SHARE_AT;
export const USAGE_READERS: readonly string[] = G.USAGE_READERS;
export const MIN_SEGMENTS_FOR_SPIKES: number = G.MIN_SEGMENTS_FOR_SPIKES;

// ------------------------------------------------------------------ analysis/pricing.py

export const FAMILIES: Readonly<Record<PricedModel, string>> = G.FAMILIES;
export const PRICES_READ_ON: string = G.PRICES_READ_ON;
export const PRICE_STALE_DAYS: number = G.PRICE_STALE_DAYS;

// ------------------------------------------------------------------ analysis/live.py and plain.py

export const DECISION_SENTENCES: Readonly<Record<DecisionKind, string>> = G.DECISION_SENTENCES;
export const ROLES: readonly PlainRole[] = G.ROLES;
export const ROLE_NOUN: Readonly<Record<PlainRole, readonly [string, string, string]>> = G.ROLE_NOUN;
