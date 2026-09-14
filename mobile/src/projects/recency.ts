/**
 * When a project was last worked on, from both of the places the phone knows it: the Mac's report,
 * and the session rows this phone holds for the project's key. Pure, so `bun test` holds it.
 *
 * FOUND IN THE CAPTURE PASS (2026-09-14, shots/now2 `12-project-2-01` and `-02`): a project page
 * said "Winding down", "No session here for 13 days" and "Last session 13 days ago" while its own
 * swarm and commit chart showed sessions on Sep 12 and 13 and the Now tab showed one running in it.
 * Every word was the report's, and the report was true of what the Mac had read: five sittings,
 * the last on Aug 31. The twenty after it came through the hook and other uploads, which the
 * report never reads. The hero read one source and spoke as if it were the only one.
 *
 * The rule now: a session on this phone that STARTED after the report's last sitting ENDED is news
 * the report does not have (a start after that end can never be the same sitting), and so is one
 * running here now. With news:
 *
 *   - nothing says the project is idle: the title is "Running now" or "Built today" in place of a
 *     stage that rests on silence (winding down, dormant), and the silence sentence is replaced by
 *     what the phone knows;
 *   - every figure says where it comes from: the phone's sentences say "on this phone", and one
 *     line says what the report read, when it was made, and that the sessions since are not in it;
 *   - a streak the report says has ended is said to be the report's.
 *
 * Without news the report stands, its day counts brought up to today (the report counts from the
 * day it was made, which may be days ago), never below what it said.
 */
import type { SessionDetail } from '../data/api';
import type { ReportProjectHistory } from '../generated/report';
import { count } from '../copy/numbers';
import { timeOfDay } from '../copy/time';
import { isStale } from '../live/mission';
import { dayOf } from '../you/numbers';
import { lastSessionSentence, localDay, stageLabel, stageSentence } from './model';

/** The fields of a session row this reads: a `SessionDetail` from the project route, the cache or the live list. */
export interface PhoneSession {
  id: string;
  started_at: string;
  ended_at?: string | null;
  state?: string;
  repo_key?: string | null;
  updated_at?: string;
  live_state?: { computed_at: string } | null;
}

export interface RecencyInput {
  /** The project's full 64 hex key. */
  key: string;
  history: Pick<ReportProjectHistory, 'stage' | 'stage_rule' | 'last_at' | 'days_since_last' | 'age_days' | 'days_built_recent' | 'days_built_before'>;
  /** When the report was made (`report.generated_at`). */
  reportAt: string | null;
  /** This project's finished sessions on the phone: the project route's rows, which are its own, and saved rows under its key. */
  finals: readonly PhoneSession[];
  /** Every live row the phone holds, any project: the ones under this key are read. */
  live: readonly PhoneSession[];
  /** The newest start the server lists for this project (`/v1/profile` projects), when the caller has only that. */
  lastStartedAt?: string | null;
  now: number;
}

export interface Recency {
  /** The phone knows of a session the report does not. */
  newer: boolean;
  /** A session is running here now (a live row under this key that is still being updated). */
  running: boolean;
  /** Sessions here that started after the report's last one ended, the live ones included. */
  since: number;
  /** The band's title: the report's stage, or what the phone knows when the stage rests on silence. */
  title: string | null;
  /** The sentence in the band. */
  stageSentence: string | null;
  /** When the last session was, and where that comes from. */
  lastSession: string | null;
  /** With news only: what the report read, when it was made, and that the sessions since are not in it. */
  reportLine: string | null;
  /** With news only: the streak note, said to be the report's. */
  streakNote: string | null;
  /** A door's short line: with news, what the phone knows; without, the report's last session. */
  doorLine: string | null;
  /** With news only: the door's word on where the report stops. */
  doorReport: string | null;
}

/** The stages that say nothing is happening. */
const IDLE_STAGES: ReadonlySet<string> = new Set(['winding_down', 'dormant']);
/** The stage rules that count days of silence. */
const QUIET_RULES: ReadonlySet<string> = new Set(['quiet_two_weeks', 'quiet_a_week']);

function ms(iso: string | null | undefined): number {
  const t = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(t) ? t : Number.NaN;
}

/** Whole Builda days (cut at 04:00) from the day of `t` to the day of `now`. */
export function daysBetween(t: number, now: number): number {
  if (!Number.isFinite(t) || !Number.isFinite(now)) return 0;
  const a = localDay(new Date(t).toISOString());
  const b = localDay(new Date(now).toISOString());
  return Math.max(0, Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000));
}

/** "today", "yesterday", "3 days ago": the Builda day of `t` from `now`. */
export function dayWords(t: number, now: number): string {
  const d = daysBetween(t, now);
  return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${count(d, 'day')} ago`;
}

/** "today at 2:35am", "yesterday at 11:40pm", "on Sep 3 at 9:12am". */
function whenAt(t: number, now: number): string {
  const d = daysBetween(t, now);
  const day = d === 0 ? 'today' : d === 1 ? 'yesterday' : `on ${dayOf(new Date(t).toISOString(), now) ?? ''}`;
  return `${day} at ${timeOfDay(t)}`;
}

export function recency(input: RecencyInput): Recency {
  const { key, history: h, now } = input;
  const reportEnd = ms(h.last_at);
  const liveHere = input.live.filter((r) => r.repo_key === key && r.state !== 'final');
  // Still being updated: the Now tab's own rule (a row quiet for 15 minutes is "not updating").
  const running = liveHere.some((r) => !isStale(r as unknown as SessionDetail, now));
  const seen = new Set<string>();
  const finalsHere = input.finals.filter((r) => {
    if (seen.has(r.id) || (r.state ?? 'final') !== 'final') return false;
    seen.add(r.id);
    return true;
  });
  const fresh = (r: PhoneSession) => !isStale(r as unknown as SessionDetail, now);
  const after = (r: PhoneSession) => Number.isFinite(reportEnd) && ms(r.started_at) > reportEnd;
  // Sessions the report never read: finished ones, and live ones that have gone quiet (they ran,
  // and a quiet one is not "running now"), each once.
  const ranSince = [...finalsHere.filter(after), ...liveHere.filter((r) => !seen.has(r.id) && after(r) && !fresh(r))];
  const runningSince = liveHere.some((r) => !seen.has(r.id) && after(r) && fresh(r));
  const listed = ms(input.lastStartedAt);
  const listedNewer = Number.isFinite(listed) && Number.isFinite(reportEnd) && listed > reportEnd;
  const since = ranSince.length + (runningSince ? 1 : 0) || (listedNewer ? 1 : 0);
  const newer = running || since > 0;

  // The report's own words, its day counts brought up to today.
  const reportDays = Number.isFinite(reportEnd) ? Math.max(h.days_since_last, daysBetween(reportEnd, now)) : h.days_since_last;
  const reportStage = stageLabel(h.stage);
  const reportSentence = stageSentence(QUIET_RULES.has(h.stage_rule) ? { ...h, days_since_last: reportDays } : h);
  const reportLast = lastSessionSentence({ days_since_last: reportDays });
  if (!newer) {
    return { newer: false, running: false, since: 0, title: reportStage, stageSentence: reportSentence, lastSession: reportLast, reportLine: null, streakNote: null, doorLine: reportLast, doorReport: null };
  }

  const idle = IDLE_STAGES.has(h.stage);
  const newest = (rows: readonly PhoneSession[]) => rows.reduce<PhoneSession | null>((a, r) => (!a || ms(r.started_at) > ms(a.started_at) ? r : a), null);
  const newestRan = newest(ranSince);
  const newestRunning = newest(liveHere.filter(fresh));
  // The newest start the phone knows of. Math.max answers NaN when any argument is NaN, so only
  // the instants that parsed are compared (an absent row is not "the dawn of time" either).
  const starts = [ms(newestRan?.started_at), ms(newestRunning?.started_at), listed].filter((t) => Number.isFinite(t));
  const newestStart = starts.length ? Math.max(...starts) : now;
  const reportDay = Number.isFinite(reportEnd) ? dayOf(h.last_at, now) : null;
  const madeDay = input.reportAt ? dayOf(input.reportAt, now) : null;

  const title = running ? 'Running now' : idle ? `Built ${dayWords(newestStart, now)}` : reportStage;

  const band = running
    ? `A session is running here now${ranSince.length ? `, after ${count(ranSince.length, 'more session', 'more sessions')} since ${reportDay}` : ''}.`
    : `${count(since, 'session')} here since ${reportDay ?? 'your Mac last read one'}, the last one ${dayWords(newestStart, now)}.`;

  const lastEnd = newestRan ? ms(newestRan.ended_at) : Number.NaN;
  const last =
    running && newestRunning
      ? `The session running now started ${whenAt(ms(newestRunning.started_at), now)}, as this phone has it.`
      : newestRan
        ? `Last session ${whenAt(ms(newestRan.started_at), now)}${Number.isFinite(lastEnd) && lastEnd > ms(newestRan.started_at) ? `, ended at ${timeOfDay(lastEnd)}` : ''}, as this phone has it.`
        : `Last session ${dayWords(newestStart, now)}, as this phone has it.`;

  const n = ranSince.length;
  const notIn =
    n && running
      ? `The ${count(n, 'session')} since and the one running now were uploaded from your machines and are not in it.`
      : n === 1
        ? 'The one session since was uploaded from your machines and is not in it.'
        : n > 1
          ? `The ${count(n, 'session')} since were uploaded from your machines and are not in it.`
          : running
            ? 'The one running now is not in it.'
            : 'The sessions since were uploaded from your machines and are not in it.';
  const reportLine = `Your Mac's report${madeDay ? `, made ${madeDay},` : ''} reads up to a session here on ${reportDay ?? 'a day it names'}${idle && reportStage ? `, so it says ${reportStage.toLowerCase()}` : ''}. ${notIn}`;

  return {
    newer: true,
    running,
    since,
    title,
    stageSentence: band,
    lastSession: last,
    reportLine,
    streakNote: `By your Mac's report, which reads up to ${reportDay ?? 'its last session'}.`,
    doorLine: running ? 'A session is running here now.' : `Last session ${dayWords(newestStart, now)}, as this phone has it.`,
    doorReport: `Your Mac's report stops at ${reportDay ?? 'an older session'}.`,
  };
}
