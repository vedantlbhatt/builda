/**
 * The fifteen Wrapped cards, written on the phone from the report's ids and numbers.
 *
 * `analysis/wrapped.py` renders every card as a question, a big answer and one sentence,
 * and `wrapped.wire()` DROPS all three: the report carries `{id, value, value_id, unit,
 * basis, n, needed, reason, extras}` and nothing a person reads (docs/overnight-
 * integration.md 1.2 and 1.5). This is the other half: a line for line port of each
 * card's `display` and `sentence`, and of each refusal's reason, from the wire alone.
 *
 * THE RULES IT HOLDS are the engine's. Every answered sentence carries a digit. No dash,
 * anywhere. A number the wire does not carry is never invented: a card whose answer needs
 * one that is missing renders as `null` (nothing), not as a zero. An id this build does
 * not know renders nothing rather than a debug string.
 *
 * Two cards are LOCAL (`crash_out`, `cryptic_prompt`): every number on them is a reading of
 * what somebody typed, so only `{id, unit, basis, n, reason}` of them leaves the machine.
 * Answered, they render words only when the owner's opt in quote for that card is passed
 * in (contract v4 `quotes`); without it the card is `local` and says nothing more.
 *
 * Pinned to Python by `spec/fixtures/wrapped/cards.json` (written by `scripts/gen_copy.py`)
 * in `__tests__/wrappedCopy.test.ts`: every fixture card must render its Python question,
 * display, sentence and refusal exactly.
 */

import type { QuoteWire } from '../generated/quotes';
import type {
  ArchetypeMetric,
  CommitKind,
  PlainRole,
  ReportWrappedCard,
  ReportWrappedExtras,
  WrappedCard,
  WrappedRefusal,
} from '../generated/report';
import { REPORT_ENUMS } from '../generated/report';
import {
  ARCHETYPE_DISPLAY,
  type ArchetypeOrGeneralist,
  KIND_NOUN,
  KIND_REFUSALS,
  KINDS,
  LOCAL_CARDS,
  LOOKBACK_MINUTES,
  PROMPT_BRIEF_WORDS,
  QUESTIONS,
  REFUSAL_CONSTANTS,
  REFUSALS,
  ROLE_DISPLAY,
  ROLE_WORD,
  SHORT_PROMPT_WORDS,
  WITH_YOU,
  WORK_STYLE_DISPLAY,
  type WorkStyle,
} from './catalog';
import { count, fill, floorMins, inTen, mins, n, pct, pyRound } from './numbers';
import { ROLES } from './plain';

/**
 * A card as a person reads it. The shape of a `spec/fixtures/wrapped/cards.json` entry:
 * answered, `display` and `sentence` are set and `refusal` is null; refused, `refusal` is
 * set and the other two are null; `local` and answered without its quote, all three null.
 */
export interface RenderedCard {
  id: WrappedCard;
  /** The question, always. */
  question: string;
  /** The answer, set large. */
  display: string | null;
  /** One sentence under it, with the numbers in it. */
  sentence: string | null;
  /** Why there is no answer yet, in the engine's words (lower case, no full stop). */
  refusal: string | null;
  /** A LOCAL card (`crash_out`, `cryptic_prompt`): its words need the owner's quote. */
  local: boolean;
}

export interface RenderOptions {
  /**
   * The owner's opt in quote for this card, from `BuilderProfileResponse.quotes`. Only the
   * two LOCAL cards read it, and only for the numbers the quote carries (when it was sent,
   * how long it was, what followed). The quote's TEXT is never put in `display` or
   * `sentence`: a screen shows it on its own line, above the card, as the CLI does.
   */
  quote?: QuoteWire | null;
  /**
   * The offset the crash out's clock is said in. Defaults to this phone's offset at that
   * instant; the engine uses the session's own, which the quote does not carry.
   */
  tzOffsetMinutes?: number;
}

const CARD_IDS = REPORT_ENUMS.wrapped_card as readonly string[];

/**
 * One card, rendered. Null when the card id is one this build does not know, or when an
 * answered card lacks a number its sentence needs (a producer bug, said as nothing rather
 * than as a zero).
 */
export function renderCard(card: ReportWrappedCard, opts: RenderOptions = {}): RenderedCard | null {
  if (!CARD_IDS.includes(card.id)) return null;
  const base = { id: card.id, question: QUESTIONS[card.id], local: LOCAL_CARDS.includes(card.id) };
  if (card.reason != null) {
    const refusal = refusalFor(card, card.reason);
    return refusal === null ? null : { ...base, display: null, sentence: null, refusal };
  }
  const words = answer(card, card.extras ?? {}, opts);
  if (words === LOCAL_WITHOUT_QUOTE) return { ...base, display: null, sentence: null, refusal: null };
  if (words === null) return null;
  return { ...base, display: words[0], sentence: words[1], refusal: null };
}

/** Every card of a report, in the report's order, the unknown ones left out. */
export function renderCards(cards: readonly ReportWrappedCard[], quotes?: readonly QuoteWire[] | null): RenderedCard[] {
  const byCard = new Map((quotes ?? []).map((q) => [q.card as string, q]));
  return cards
    .map((c) => renderCard(c, { quote: byCard.get(c.id) ?? null }))
    .filter((c): c is RenderedCard => c !== null);
}

// ------------------------------------------------------------------ answers

const LOCAL_WITHOUT_QUOTE = Symbol('local');
type Words = readonly [display: string, sentence: string];

function num(x: number | null | undefined): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function answer(card: ReportWrappedCard, x: ReportWrappedExtras, opts: RenderOptions): Words | null | typeof LOCAL_WITHOUT_QUOTE {
  const v = card.value;
  switch (card.id) {
    case 'builder_type':
      return builderType(card, x);
    case 'shipped': {
      if (!num(v)) return null;
      if (x.commits != null) {
        if (!num(x.assisted)) return null;
        // Two measurements side by side, never "lines ACROSS commits" (wrapped._shipped).
        return [
          `${count(v, 'line')} written, ${count(x.commits, 'commit')}`,
          `${n(x.assisted)} of those commits landed during a session or in the ${LOOKBACK_MINUTES} minutes before one.`,
        ];
      }
      return [count(v, 'line'), `Counted across ${count(card.n, 'session')} from edits and shell writes.`];
    }
    case 'work_style':
      return workStyle(card, x);
    case 'longest_session': {
      if (!num(v)) return null;
      const sentence =
        card.n > 1 ? `The longest of ${count(card.n, 'session')} ${WITH_YOU}.` : `Counted over ${count(card.n, 'session')} ${WITH_YOU}.`;
      return [floorMins(v), sentence];
    }
    case 'agents_at_once': {
      if (!num(v)) return null;
      const peak = x.subagents_peak;
      let sentence: string;
      if (num(peak) && peak >= 2) {
        // The corpus fan out sweeps every sidecar together, so its peak can span two
        // sittings side by side: "Inside them" only when more than one ran at once.
        sentence = `${v >= 2 ? 'Inside them, up to' : 'Up to'} ${peak} helper agents ran at the same moment.`;
      } else {
        sentence = `Counted from first action to last across ${count(card.n, 'session')}.`;
      }
      return [`${count(v, 'session')} at once`, sentence];
    }
    case 'go_to_prompt':
      if (!num(v) || !num(x.sessions) || !num(x.words)) return null;
      return [`Sent ${count(v, 'time')} across ${count(x.sessions, 'session')}`, `${count(x.words, 'word')} you keep coming back to.`];
    case 'streak':
      if (!num(v)) return null;
      if (v === 0) {
        // A measured zero, and said as one: "No streak yet" is a measurement.
        if (!num(x.commit_days)) return null;
        return ['No streak yet', `${count(x.commit_days, 'day')} had a commit, none alongside a session ${WITH_YOU}.`];
      }
      if (!num(x.both_days)) return null;
      return [`${count(v, 'day')} straight`, `${count(x.both_days, 'day')} in all had a commit and a session ${WITH_YOU}.`];
    case 'change_course':
      if (!num(v) || !num(x.interrupts) || !num(x.corrective_prompts)) return null;
      return [
        `${pct(v)} of the time`,
        `${count(x.interrupts, 'interrupt')} and ${count(x.corrective_prompts, 'correction')} across ${count(card.n, 'prompt')}.`,
      ];
    case 'crash_out':
      return crashOut(opts);
    case 'prompt_length': {
      if (!num(v) || !num(x.median)) return null;
      const label =
        x.median < SHORT_PROMPT_WORDS ? 'Mostly terse.' : x.median < PROMPT_BRIEF_WORDS ? 'Mostly conversational.' : 'Mostly detailed briefs.';
      return [`${count(v, 'word')} on average`, `${label} Half of them run ${count(x.median, 'word')} or fewer.`];
    }
    case 'deep_sessions':
      if (!num(v)) return null;
      if (v === 0) {
        if (!num(x.longest_minutes)) return null;
        return ['No session past an hour yet', `Your longest ran ${count(x.longest_minutes, 'minute')}.`];
      }
      if (!num(x.avg_minutes)) return null;
      return [
        count(v, 'deep session'),
        v > 1 ? `Averaging ${count(x.avg_minutes, 'minute')} of focus each.` : `It ran ${count(x.avg_minutes, 'minute')} ${WITH_YOU}.`,
      ];
    case 'time_put_in': {
      if (!num(v) || !num(x.attended_hours)) return null;
      const overlap = x.attended_overlap_hours;
      const sentence =
        num(overlap) && overlap > 0
          ? `${n(x.attended_hours)} of those hours ${WITH_YOU}, up to ${n(overlap)} of them in sessions that ran at the same time.`
          : `${n(x.attended_hours)} of those hours ${WITH_YOU}.`;
      return [`${count(v, 'hour')} across ${count(card.n, 'session')}`, sentence];
    }
    case 'cryptic_prompt':
      return crypticPrompt(opts);
    case 'prompts_per_session': {
      if (!num(v)) return null;
      const depth = x.tool_calls_per_prompt;
      if (!num(depth) && !num(x.median)) return null;
      const sentence = num(depth)
        ? `${count(depth, 'tool call')} for every prompt you send.`
        : `Half your sessions have ${n(x.median as number)} or fewer.`;
      return [`${count(v, 'prompt')} a session`, sentence];
    }
    case 'kind_of_work':
      return kindOfWork(card, x);
    default:
      return null;
  }
}

// ---- 1 builder_type

function archetypeSentence(name: ArchetypeOrGeneralist, v: number, atLeast: boolean): string | null {
  let sentence: string;
  switch (name) {
    case 'quality_guardian': {
      const every = pyRound(60 / v);
      const about = atLeast ? 'at least' : 'about';
      const cadence =
        every < 1 ? 'more than one a minute' : every === 1 ? `${about} one a minute` : `${about} one every ${every} minutes`;
      sentence = `${n(v)} test runs an hour, ${cadence}.`;
      break;
    }
    case 'architect':
      sentence = `${n(v)} prompts get a plan for every one that goes straight to work.`;
      break;
    case 'velocity_machine':
      sentence = `${n(v)} lines an hour while the agent runs.`;
      break;
    case 'night_owl':
      sentence = `${pct(v)} of your build time lands between 10pm and 4am.`;
      break;
    case 'director':
      sentence = `${pct(v)} of your build time runs without you.`;
      break;
    case 'skeptic':
      sentence = `${inTen(v)} in 10 prompts stop or redirect the agent.`;
      break;
    default:
      return null;
  }
  // Every sentence above opens on its number, so a floor reads "At least 4.7 ...".
  return atLeast ? `At least ${sentence}` : sentence;
}

function builderType(card: ReportWrappedCard, x: ReportWrappedExtras): Words | null {
  const name = card.value_id;
  if (name == null || !(name in ARCHETYPE_DISPLAY)) return null;
  const display = ARCHETYPE_DISPLAY[name as ArchetypeOrGeneralist];
  if (name === 'generalist') {
    const c = x.closest;
    if (!c || !num(c.value) || !num(c.threshold) || c.threshold === 0 || !(c.name in ARCHETYPE_DISPLAY)) return null;
    // Capped at 99: no rule met its threshold, so "100% of the way there" would contradict
    // "No single pattern dominates".
    const part = Math.min(pyRound((100 * c.value) / c.threshold), 99);
    const floor = x.metric_lower_bound ? 'at least ' : '';
    return [display, `No single pattern dominates. Closest is ${ARCHETYPE_DISPLAY[c.name]}, ${floor}${part}% of the way there.`];
  }
  if (!num(x.metric_value)) return null;
  const sentence = archetypeSentence(name as ArchetypeOrGeneralist, x.metric_value, x.metric_lower_bound === true);
  return sentence === null ? null : [display, sentence];
}

// ---- 3 work_style

function workStyle(card: ReportWrappedCard, x: ReportWrappedExtras): Words | null {
  const style = card.value_id;
  if (style == null || !(style in WORK_STYLE_DISPLAY)) return null;
  let sentence: string;
  switch (style as WorkStyle) {
    case 'hand_off':
      if (!num(x.autonomy)) return null;
      sentence = `${pct(x.autonomy)} of your build time runs without you.`;
      break;
    case 'dialogue':
      if (!num(x.median_prompts)) return null;
      sentence = `You work in dialogue, ${count(x.median_prompts, 'prompt')} a session.`;
      break;
    case 'steering':
      if (!num(x.steer_rate)) return null;
      sentence = `${inTen(x.steer_rate)} in 10 prompts stop or redirect it.`;
      break;
    case 'one_shot':
      if (!num(x.median_prompts)) return null;
      sentence = `${count(x.median_prompts, 'prompt')} a session, then it runs.`;
      break;
  }
  return [WORK_STYLE_DISPLAY[style as WorkStyle], sentence];
}

// ---- 9 crash_out and 13 cryptic_prompt: LOCAL, words only with the owner's quote

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** `wrapped._when`: "A Tuesday, at 11:42pm", on the given clock. */
export function when(iso: string, tzOffsetMinutes?: number): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const offset = tzOffsetMinutes ?? -new Date(ms).getTimezoneOffset();
  const local = new Date(ms + offset * 60_000);
  const h = local.getUTCHours();
  const minute = String(local.getUTCMinutes()).padStart(2, '0');
  return `A ${DAYS[local.getUTCDay()]}, at ${h % 12 || 12}:${minute}${h < 12 ? 'am' : 'pm'}`;
}

function crashOut(opts: RenderOptions): Words | null | typeof LOCAL_WITHOUT_QUOTE {
  const q = opts.quote;
  if (!q || q.card !== 'crash_out') return LOCAL_WITHOUT_QUOTE;
  const display = when(q.sent_at, opts.tzOffsetMinutes);
  if (display === null || !num(q.seconds_in)) return null;
  return [display, `Sent ${crashOutInto(q.seconds_in)} into that session. We have all been there.`];
}

function crypticPrompt(opts: RenderOptions): Words | null | typeof LOCAL_WITHOUT_QUOTE {
  const q = opts.quote;
  if (!q || q.card !== 'cryptic_prompt') return LOCAL_WITHOUT_QUOTE;
  if (q.corrected == null || (!q.corrected && !num(q.tool_calls_after))) return null;
  // `len(_quote(text))`: the characters of the text AS QUOTED, counted as Python counts them
  // (code points), so the number beside the quote is the characters shown.
  const length = [...q.text].length;
  return [crypticDisplay(length), crypticSentence(length, q.tool_calls_after ?? 0, q.corrected)];
}

/** `wrapped.cryptic_display`: never "A 11 character prompt"; the article fits every length. */
export function crypticDisplay(length: number): string {
  return `A prompt of ${count(length, 'character')}`;
}

/** `wrapped.cryptic_sentence`. */
export function crypticSentence(length: number, toolCallsAfter: number, corrected: boolean): string {
  return corrected ? `${length} characters, and it had a go anyway.` : `Somehow the agent knew. ${count(toolCallsAfter, 'tool call')} followed.`;
}

/**
 * `wrapped.crash_out_into`: how far into its session the crash out was sent, from the WHOLE
 * seconds the quotes document carries. "under a minute" has no digit and reads oddly after
 * "Sent", so it is "less than 1 minute".
 */
export function crashOutInto(secondsIn: number): string {
  const into = mins(secondsIn);
  return into === mins(0) ? 'less than 1 minute' : into;
}

// ---- 15 kind_of_work

function kindOfWork(card: ReportWrappedCard, x: ReportWrappedExtras): Words | null {
  if (card.basis === 'commit_subject_labels') {
    const kinds = (x.kinds ?? []).filter((k) => k.commits > 0);
    if (!kinds.length || !num(x.commits)) return null;
    const top = [...kinds].sort((a, b) => b.commits - a.commits || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));
    const k1 = top[0]!;
    if (card.value_id !== k1.kind) return null;
    let said = kindNoun(k1.kind, k1.commits);
    if (top.length > 1) said += ` and ${kindNoun(top[1]!.kind, top[1]!.commits)}`;
    return [`Mostly ${KIND_NOUN[k1.kind][1]}.`, `${said} in ${count(x.commits, 'commit')}.`];
  }
  if (card.basis === 'lines_by_file_role') {
    const roles = (x.role_lines ?? []).filter((r) => r.lines > 0);
    const lines = roles.reduce((s, r) => s + r.lines, 0);
    if (!roles.length || lines <= 0) return null;
    const order = (r: PlainRole) => (ROLES as readonly string[]).indexOf(r);
    const top = [...roles].sort((a, b) => b.lines - a.lines || order(a.role) - order(b.role));
    const r1 = top[0]!;
    if (card.value_id !== r1.role) return null;
    let said = `${pyRound((100 * r1.lines) / lines)}% of agent lines went to ${ROLE_WORD[r1.role]} files`;
    if (top.length > 1) said += `, ${pyRound((100 * top[1]!.lines) / lines)}% to ${ROLE_WORD[top[1]!.role]} files`;
    return [ROLE_DISPLAY[r1.role], `${said}.`];
  }
  return null;
}

function kindNoun(kind: CommitKind, c: number): string {
  const [one, many] = KIND_NOUN[kind];
  return count(c, one, many);
}

// ------------------------------------------------------------------ refusals

/**
 * `wrapped.refusal_text`: the refusal's words from its code and the numbers the card
 * carries, and nothing else: `n`, `needed`, the card's numeric extras and the refusal
 * constants. The kind of work card's commit half is its own template, chosen by
 * `extras.commit_refusal`. Null for a code this build does not know, and for a template
 * with a slot the card left empty (Python raises there; a hole is never a sentence).
 */
export function refusalFor(card: ReportWrappedCard, code: WrappedRefusal | string): string | null {
  const template = REFUSALS[code];
  if (template === undefined) return null;
  const values: Record<string, number | string | null | undefined> = {};
  for (const [k, v] of Object.entries(card.extras ?? {})) {
    if (typeof v === 'number') values[k] = v;
  }
  Object.assign(values, REFUSAL_CONSTANTS, { n: card.n, needed: card.needed ?? null });
  const commitCode = card.extras?.commit_refusal;
  if (commitCode) {
    const kind = KIND_REFUSALS[commitCode];
    if (kind === undefined) return null;
    const said = fill(kind, values);
    if (said === null) return null;
    values.commit_refusal = said;
  }
  return fill(template, values);
}

/** The metrics the builder type card can name, for a screen that labels the number. */
export const ARCHETYPE_METRICS: readonly ArchetypeMetric[] = REPORT_ENUMS.archetype_metric;
