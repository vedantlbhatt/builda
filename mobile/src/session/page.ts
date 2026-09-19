/**
 * THE SESSION PAGE, as data: what each chapter says, decided in one pure function so the screen
 * lays it out and never decides a number (`__tests__/sessionPage.test.ts`).
 *
 * Modelled on a Strava activity page (design-refs/awesome-ios-design-md/design-md/fitness/
 * strava): the headline stat huge on the hero, the route drawn under it, then the splits and
 * the analysis, then sharing. Here: the hero band (the engineer voice title, the active time,
 * the repo, the tool and the day), the strip, the ledger of what landed, the words, burn
 * forensics, the decisions, the doorways to the map and the time lapse, the model's reading and
 * the card.
 *
 * Every number is one the rest of the app already says. The ledger's lines are the card's
 * (`stats.lines_added_agent`, the rule `BuilderParse.ShellFileEffect` holds once), and a line
 * count the server did not send is a missing row, never a zero. Commits follow the paragraph's
 * rule (`summary.commitSentence`): when burn's first sentence names its own commit calls, the
 * ledger shows those and not git's count, so the page never says two numbers for one thing.
 *
 * Pure: no React Native, so `bun test` holds it.
 */

import { commas } from '../copy/numbers';
import { repoLabel, type RepoNames } from '../copy/repoLabel';
import { timeOfDay } from '../copy/time';
import { renderTitle } from '../copy/title';
import type { SessionDetail } from '../data/api';
import { numSpec, type NumSpec } from '../insights/format';
import { HARNESS_NAMES, isHarness } from '../pixel/harness';
import { dayLabel, duration } from '../theme';
import { heading, pageFactsOf, renderable, type Note } from './feedback';
import { burnNamesCommits, sessionTitle, summarySentences, type SessionTitle } from './summary';
import { whenLabel } from './when';

export function harnessLabel(harness: string): string {
  return isHarness(harness) ? HARNESS_NAMES[harness] : harness;
}

export interface HeroModel {
  /** The band's small title: "Yesterday at 1:12pm". */
  when: string;
  title: SessionTitle | null;
  /** Active time, counted up, resting on `theme.duration` (the card's and the list's figure). */
  active: NumSpec;
  /** Under the figure: "active of 6h 48m elapsed", or "active so far" while it runs. */
  caption: string;
  repo: string;
  harness: string;
  harnessName: string;
  live: boolean;
}

/**
 * `names` is `data/repoNames.useRepoNames()`: the repository is named as the Projects tab names
 * it (`copy/repoLabel`), "Private project 2" rather than "private repo" once the phone has
 * numbered it.
 */
export function heroOf(s: SessionDetail, now: number, names?: RepoNames | null): HeroModel {
  const live = (s.state ?? 'final') === 'live';
  const started = Date.parse(s.started_at);
  const ended = Date.parse(s.ended_at);
  const wall = Number.isFinite(started) && Number.isFinite(ended) ? Math.max((ended - started) / 1000, s.active_seconds) : null;
  // Elapsed is said only when it says something: a sitting with no idle in it was all active.
  const elapsed = wall !== null && duration(wall) !== duration(s.active_seconds) ? duration(wall) : null;
  return {
    when: whenLabel(s.started_at, now),
    title: sessionTitle(s),
    active: numSpec(s.active_seconds, duration(s.active_seconds), { kind: 'duration' }),
    caption: live ? 'active so far' : elapsed ? `active of ${elapsed} elapsed` : 'active',
    repo: repoLabel(s, names),
    harness: s.harness,
    harnessName: harnessLabel(s.harness),
    live,
  };
}

export type LedgerTone = 'add' | 'del' | null;

export interface LedgerLine {
  key: string;
  num: NumSpec;
  label: string;
  tone: LedgerTone;
}

export interface LedgerModel {
  lines: LedgerLine[];
  /** Added over added plus removed, for the diff bar; null unless both counts were sent. */
  diff: { addedShare: number } | null;
}

/**
 * What landed, as lines of print: lines added (green), lines removed (red), commits and the
 * prompts you sent. A count at zero is left out, as the old Numbers grid dropped commits at zero:
 * a measured zero is no finding here, and the words above say what happened.
 */
export function ledgerOf(s: SessionDetail): LedgerModel {
  const st = s.stats;
  const lines: LedgerLine[] = [];
  const added = typeof st?.lines_added_agent === 'number' ? st.lines_added_agent : null;
  const removed = typeof st?.lines_removed_agent === 'number' ? st.lines_removed_agent : null;
  // A hyphen before a removed count, never U+2212: the one dash rule (`copy/plain.ts`).
  if (added !== null && added > 0) lines.push({ key: 'added', num: numSpec(added, `+${commas(added)}`), label: added === 1 ? 'line added' : 'lines added', tone: 'add' });
  if (removed !== null && removed > 0) lines.push({ key: 'removed', num: numSpec(removed, `-${commas(removed)}`), label: removed === 1 ? 'line removed' : 'lines removed', tone: 'del' });

  const b = s.burn;
  if (burnNamesCommits(b) && typeof b?.commits === 'number') {
    const k = b.commits;
    lines.push({ key: 'commits', num: numSpec(k, commas(k)), label: k === 1 ? 'commit made' : 'commits made', tone: null });
  } else if (typeof st?.commit_count === 'number' && Number.isInteger(st.commit_count) && st.commit_count > 0) {
    const k = st.commit_count;
    const running = (s.state ?? 'final') === 'live';
    lines.push({ key: 'commits', num: numSpec(k, commas(k)), label: `${k === 1 ? 'commit' : 'commits'} landed${running ? ' so far' : ''}`, tone: null });
  }

  const p = st?.human_prompt_count;
  if (typeof p === 'number' && p > 0) lines.push({ key: 'prompts', num: numSpec(p, commas(p)), label: p === 1 ? 'prompt you sent' : 'prompts you sent', tone: null });

  // Only when BOTH sides counted a line: the transcript sees a removal only in an edit's patch, so
  // a 0 on one side is not a count, and a bar split at its very end drew "removed 0" beside a
  // paragraph that no longer says it (60256e3a, whose commits deleted 57 lines; 2026-09-14).
  const diff = added !== null && removed !== null && added > 0 && removed > 0 ? { addedShare: added / (added + removed) } : null;
  return { lines, diff };
}

export interface WordsModel {
  sentences: string[];
  notes: Note[];
  /** Over the notes: "22 minutes of this session went here". */
  notesHeading: string | null;
}

export function wordsOf(s: SessionDetail): WordsModel {
  const notes = renderable(s.feedback, pageFactsOf(s));
  return { sentences: summarySentences(s), notes, notesHeading: heading(notes) };
}

// ------------------------------------------------------------------ a row in the list

export interface RowModel {
  id: string;
  /** The engineer voice title, else the harness's, else the day and its part ("Saturday afternoon session"). */
  title: string;
  /** Active time, the card's figure. */
  figure: string;
  /** "gt-transit · yesterday", with "on its own" when nobody was there. */
  meta: string;
  harness: string;
  harnessName: string;
}

/**
 * When a session has no title of its own, it is named the way Strava names an activity nobody
 * titled ("Tuesday Morning Run"): the day and the part of it the sitting started in. A fact
 * about the session, never a guess about what it did.
 */
export function partOfDay(iso: string): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const h = new Date(t).getHours();
  if (h >= 4 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 21) return 'evening';
  return 'late night';
}

export function untitledName(iso: string, now: number): string {
  const part = partOfDay(iso);
  const day = dayLabel(iso, now);
  if (!part || !day) return 'A session';
  const cap = `${day.charAt(0).toUpperCase()}${day.slice(1)}`;
  // "Today afternoon" is not English; the part leads on the two relative days.
  if (day === 'today') return part === 'late night' ? 'Late night session' : `This ${part}'s session`;
  if (day === 'yesterday') return `Yesterday ${part === 'late night' ? 'late night' : part} session`;
  return `${cap} ${part} session`;
}

export function rowOf(s: SessionDetail, now: number, names?: RepoNames | null): RowModel {
  const title = renderTitle(s.title_ids) ?? (s.title?.trim() || null) ?? untitledName(s.started_at, now);
  // The day AND the time it started (the day is the Builda day, as the hero's `when.whenLabel` says
  // it: a sitting begun at 00:30 is filed under the evening before): FOUND ON THE DESKTOP, four rows in a row read "Debugged a
  // failing test suite / Private project 1 · Sep 12", the same two lines four times, because the
  // title rule has no count to vary. The start time is what tells four sittings of one day apart.
  const start = Date.parse(s.started_at);
  const day = dayLabel(s.started_at, now);
  const when = day && Number.isFinite(start) ? `${day}, ${timeOfDay(start)}` : day;
  const meta = [repoLabel(s, names), when, s.unattended ? 'on its own' : null].filter(Boolean).join(' · ');
  return { id: s.id, title, figure: duration(s.active_seconds), meta, harness: s.harness, harnessName: harnessLabel(s.harness) };
}
