/**
 * THE SESSION IN WORDS: its engineer voice title and the plain English paragraph under the
 * recap card (docs/approved-roadmap.md 1.4: "Every session gets a paragraph a non-technical
 * person can read. Not the analysis. Not the dimensions. What happened, in the words someone
 * would use out loud").
 *
 * Composed on the phone from wire numbers only: the session's clocks and stats, its burn
 * block (contract v4 `burn`), its title ids (`title_ids`) and its feedback notes. Nothing
 * here reads prose from the server, so nothing here can quote a prompt, a path or a command.
 *
 * `analysis/burn.explain` is the pattern: short sentences, a number in each, never a
 * scolding. Its sentences are not rewritten here: `explainBurn` (src/copy/burn.ts, the line
 * for line port pinned to Python by spec/fixtures/burn/session.json) says them, and this
 * module places them, whole and in order, between the time the session took and the notes
 * worth a second look. Counts are said with `plain.spoken` and durations with
 * `feedback._mins` (`numbers.mins`), the engine's two rules for a person's numbers.
 *
 * Two counters for one number is the same bug as a wrong number (CLAUDE.md). The burn block
 * counts commits as commit CALLS; `stats.commit_count` is git log over the window. When
 * burn's first sentence names its commits ("and made 1 commit"), this paragraph does not
 * also say what git log counted, or one paragraph would say two numbers for one thing.
 *
 * Pure: no React Native, so `bun test` runs it.
 */

import { explainBurn } from '../copy/burn';
import { capital, floorMins } from '../copy/numbers';
import { spoken } from '../copy/plain';
import { renderTitle } from '../copy/title';
import type { SessionDetail } from '../data/api';
import type { SessionBurn } from '../generated/contract';
import { minutes, renderable } from './feedback';

/** Every field the words are written from. A server older than a field omits it. */
export type SummaryInput = Pick<
  SessionDetail,
  'harness' | 'active_seconds' | 'unattended' | 'stats' | 'state' | 'attended_seconds' | 'burn' | 'feedback'
>;

export type TitleInput = Pick<SessionDetail, 'title_ids' | 'title'>;

export interface SessionTitle {
  text: string;
  /** `engine`: rendered from `title_ids`. `harness`: the title the harness wrote to disk. */
  from: 'engine' | 'harness';
}

/**
 * The line above the paragraph. The engine's title when the ids render one; else the title
 * the harness itself wrote (public repositories only, contract `title`); else nothing. A
 * pair of ids this build cannot render falls back rather than showing a half title.
 */
export function sessionTitle(s: TitleInput): SessionTitle | null {
  const engine = renderTitle(s.title_ids);
  if (engine) return { text: engine, from: 'engine' };
  const harness = s.title?.trim();
  return harness ? { text: harness, from: 'harness' } : null;
}

/**
 * The title as the line under the recap card: `sessionTitle`, except a harness title the card
 * already prints as its headline (`RecapCard.headline` falls back to it), which is not said
 * twice one line apart. An engine title is never the card's headline, so it always shows.
 */
export function titleBesideCard(s: TitleInput, cardHeadline: string): SessionTitle | null {
  const t = sessionTitle(s);
  if (!t) return null;
  return t.from === 'harness' && t.text === cardHeadline.trim() ? null : t;
}

function isLive(s: Pick<SessionDetail, 'state'>): boolean {
  return (s.state ?? 'final') === 'live';
}

/**
 * Nobody was at the keyboard for any of it: the contract's `unattended` (zero presence
 * signals), or an attended clock that measured none. `profile.is_attended` is the negation of
 * this, and it holds under both definitions of `unattended` (docs/overnight-engine.md 5.7).
 */
export function agentAlone(s: Pick<SessionDetail, 'unattended' | 'attended_seconds'>): boolean {
  return s.unattended || s.attended_seconds === 0;
}

/**
 * A part of a whole said in words, for the one place a number cannot be: both clocks come to
 * the same whole minute. UNMEASURED JUDGEMENT CALL on the two bars, 0.9 for "almost all" and 0.5 for
 * "most" (the plain meaning of each word); it only ever speaks for sittings of a few minutes.
 */
function sharePhrase(share: number): string {
  if (share >= 0.9) return 'almost all';
  if (share >= 0.5) return 'most';
  return 'part';
}

/**
 * The time the session took, and who was there. "With you there" is the one phrase for
 * attended time (docs/overnight-engine.md, the copy review). Only one part of the split is
 * said beside the total: the two parts floored separately need not add up to the floored
 * total, and a sentence whose own numbers disagree is two answers to one question.
 *
 * The minutes are `floorMins`, whose whole minutes are `wholeMinutes`, the rule the hero's
 * figure (`theme.duration`) reads: one number of minutes on the page, never two. FOUND IN
 * REVIEW (2026-09-13): this rounded (`mins`) under a hero that floored, so 3,570 s read "59m"
 * over "You built for 1h 00m".
 */
export function timeSentence(s: SummaryInput): string {
  const live = isLive(s);
  const total = floorMins(s.active_seconds);
  if (agentAlone(s)) {
    return live ? `So far the agent has built for ${total} on its own.` : `The agent built for ${total} on its own.`;
  }
  let present = '';
  const attended = s.attended_seconds;
  if (typeof attended === 'number') {
    if (attended >= s.active_seconds) present = ', all of it with you there';
    else if (floorMins(attended) !== total) present = `, ${floorMins(attended)} of it with you there`;
    // Short of all of it, and the same whole number of minutes: "42 minutes, 42 minutes of
    // it" would read as all of it, which it was not. At 42 minutes the two are under a minute
    // apart; in a sitting of two or three minutes one whole minute can hide a third of it, so
    // the word follows the ratio, not the minutes.
    else present = `, ${sharePhrase(attended / s.active_seconds)} of it with you there`;
  }
  const p = s.stats?.human_prompt_count;
  // A comma before "and" only after the clause about who was there, never straight after
  // the duration: "You built for 5h 17m and sent 52 prompts."
  const joint = present ? ', and' : ' and';
  const prompts = typeof p === 'number' && p > 0 ? `${joint} sent ${spoken(p)} prompt${p === 1 ? '' : 's'}` : '';
  return live ? `So far you have built for ${total}${present}${prompts}.` : `You built for ${total}${present}${prompts}.`;
}

/**
 * Whether burn's first sentence names its own commit count: exactly when no line was added
 * or removed and no file changed, and a commit call landed (`burn._work_clause`'s order).
 */
export function burnNamesCommits(b: SessionBurn | null | undefined): boolean {
  if (!b || b.reason != null) return false;
  if (b.lines_added || b.lines_removed || b.files_changed) return false;
  return (b.commits ?? 0) > 0;
}

/**
 * What git log saw land in the session's window ("19 commits landed while you worked" is
 * the card's own sentence, CLAUDE.md). Null at zero, the way the Numbers grid drops the row:
 * git finding no commit in the window is not a fact worth a sentence, and a repository it
 * could not resolve would read the same.
 */
export function commitSentence(s: SummaryInput): string | null {
  const k = s.stats?.commit_count;
  if (typeof k !== 'number' || !Number.isInteger(k) || k <= 0) return null;
  if (burnNamesCommits(s.burn)) return null;
  const lead = `${capital(spoken(k))} commit${k === 1 ? '' : 's'}`;
  // Running: the sentence before this one already says "so far".
  if (isLive(s)) return `${lead} ${k === 1 ? 'has' : 'have'} landed.`;
  return `${lead} landed while ${agentAlone(s) ? 'it ran' : 'you worked'}.`;
}

/**
 * `burn.explain` over the session's block, when it answered. A refusal is not said here: the
 * burn section under the paragraph says it, once (`burnRefusal`).
 */
export function burnSentences(s: Pick<SessionDetail, 'burn' | 'harness'>): string[] {
  const b = s.burn;
  if (!b || b.reason != null) return [];
  return explainBurn(b, s.harness);
}

/**
 * The feedback notes, pointed at rather than repeated: the notes themselves are listed under
 * "worth a look" further down, so the paragraph says how many and what they cost together,
 * with the same duration rule that section's heading uses. Never what went wrong: the notes
 * say that, with their numbers, where a person chose to look.
 */
export function feedbackSentence(s: Pick<SessionDetail, 'feedback'>): string | null {
  const notes = renderable(s.feedback);
  if (!notes.length) return null;
  const total = minutes(notes.reduce((sum, n) => sum + n.seconds, 0));
  if (notes.length === 1) return `One thing in this session is worth a second look, ${total} of it.`;
  return `${capital(spoken(notes.length))} things in this session are worth a second look, ${total} in all.`;
}

/** The paragraph, sentence by sentence, in reading order. Empty only when nothing is known. */
export function summarySentences(s: SummaryInput): string[] {
  const out = [timeSentence(s)];
  const commits = commitSentence(s);
  if (commits) out.push(commits);
  out.push(...burnSentences(s));
  const notes = feedbackSentence(s);
  if (notes) out.push(notes);
  return out;
}

/** The paragraph as one string, for the screen and for VoiceOver. */
export function summaryParagraph(s: SummaryInput): string {
  return summarySentences(s).join(' ');
}

/**
 * Burn's refusal, said in the burn section: the engine's own sentence for the code (`burn.
 * explain` on a report with no events, or with no token counts, or with none inside a
 * segment). Null when the block answered, and when there is no block at all.
 */
export function burnRefusal(s: Pick<SessionDetail, 'burn' | 'harness'>): string | null {
  const b = s.burn;
  if (!b || b.reason == null) return null;
  const said = explainBurn(b, s.harness);
  return said.length ? said.join(' ') : null;
}
