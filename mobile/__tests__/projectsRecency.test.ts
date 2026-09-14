/**
 * A project's last session, from both places the phone knows it (`src/projects/recency.ts`).
 *
 * THE CASE (the capture pass, 2026-09-14, shots/now2 `12-project-2-01` and `-02`): the Mac's report
 * read five sittings in Private project 2, the last ending Aug 31, and called it winding down, "No
 * session here for 13 days". The phone held that project's rows from Sep 12 to 14, uploaded through
 * the hook, and one live row the Now tab showed running. The fixtures below are those rows' shapes
 * and instants. The rule held here: never state idle while a session ran, and say where each
 * figure comes from.
 */
import { describe, expect, test } from 'bun:test';

import { hasDash } from '../src/copy/plain';
import { timeOfDay } from '../src/copy/time';
import type { ReportProjects } from '../src/generated/report';
import { projectPage } from '../src/projects/model';
import { daysBetween, dayWords, recency, type PhoneSession, type RecencyInput } from '../src/projects/recency';
import { dayOf } from '../src/you/numbers';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './pythonRef';

const KEY = '03624fb1c6e2cd77e365bf6cc4e567e75a81ac2772016ca1bec523a847e4a504';
const OTHER = 'b093f92080ab6e13cc2d5fd8187c4da6f1c946f7c9f38d5182dd5ce6c6c46275';
const NOW = Date.parse('2026-09-14T07:05:00Z');
const REPORT_AT = '2026-09-14T03:24:02Z';
const LAST_AT = '2026-08-31T18:11:52Z';

/** The report's history block for the project, as the Mac sent it. */
const HISTORY: RecencyInput['history'] = {
  stage: 'winding_down',
  stage_rule: 'quiet_a_week',
  last_at: LAST_AT,
  days_since_last: 13,
  age_days: 29,
  days_built_recent: 0,
  days_built_before: 4,
};

const row = (id: string, started: string, ended: string, extra: Partial<PhoneSession> = {}): PhoneSession => ({ id, started_at: started, ended_at: ended, state: 'final', repo_key: KEY, ...extra });

/** The project route's rows: three from the small hours of Sep 14, and two the report read. */
const FINALS: PhoneSession[] = [
  row('5720cb32', '2026-09-14T06:06:22Z', '2026-09-14T06:35:01Z'),
  row('ce41eeb3', '2026-09-14T05:39:40Z', '2026-09-14T05:53:16Z'),
  row('cc36d26f', '2026-09-14T04:51:03Z', '2026-09-14T05:23:46Z'),
  row('aug31', '2026-08-31T16:02:00Z', LAST_AT),
  row('aug16', '2026-08-16T01:07:09Z', '2026-08-16T03:00:00Z'),
];

const live = (computedAgoSec: number, key = KEY): PhoneSession => {
  const at = new Date(NOW - computedAgoSec * 1000).toISOString();
  return { id: 'e6497adc', started_at: '2026-09-14T06:51:03Z', ended_at: at, state: 'live', repo_key: key, updated_at: at, live_state: { computed_at: at } };
};

const base = (over: Partial<RecencyInput> = {}): RecencyInput => ({ key: KEY, history: HISTORY, reportAt: REPORT_AT, finals: FINALS, live: [], now: NOW, ...over });

function said(r: ReturnType<typeof recency>): string[] {
  return [r.title, r.stageSentence, r.lastSession, r.reportLine, r.streakNote, r.doorLine, r.doorReport].filter((s): s is string => typeof s === 'string');
}

/** What the page and the door may not say while a session ran, unless it is the report's own word, attributed. */
function neverIdle(r: ReturnType<typeof recency>) {
  for (const s of [r.title, r.stageSentence, r.lastSession, r.doorLine]) {
    expect(s ?? '').not.toMatch(/No session here|days ago|Winding down|Dormant|not going now/);
  }
  for (const s of said(r)) {
    if (/winding down/i.test(s)) expect(s).toContain("Your Mac's report");
    expect({ s, dash: hasDash(s) }).toEqual({ s, dash: false });
    expect(s).not.toMatch(/\b(null|undefined|NaN)\b/);
  }
}

describe('the capture pass\'s page: a session running, and three since the report', () => {
  test('never idle: the title is what is happening, and every sentence says whose it is', () => {
    const r = recency(base({ live: [live(60)] }));
    expect(r.newer).toBe(true);
    expect(r.running).toBe(true);
    expect(r.since).toBe(4);
    expect(r.title).toBe('Running now');
    expect(r.stageSentence).toBe(`A session is running here now, after 3 more sessions since ${dayOf(LAST_AT, NOW)}.`);
    const started = Date.parse('2026-09-14T06:51:03Z');
    expect(r.lastSession).toBe(`The session running now started ${daysBetween(started, NOW) === 0 ? 'today' : 'yesterday'} at ${timeOfDay(started)}, as this phone has it.`);
    expect(r.reportLine).toBe(`Your Mac's report, made ${dayOf(REPORT_AT, NOW)}, reads up to a session here on ${dayOf(LAST_AT, NOW)}, so it says winding down. The 3 sessions since and the one running now were uploaded from your machines and are not in it.`);
    expect(r.streakNote).toBe(`By your Mac's report, which reads up to ${dayOf(LAST_AT, NOW)}.`);
    expect(r.doorLine).toBe('A session is running here now.');
    neverIdle(r);
  });

  test('the live row gone quiet (the Now tab\'s "not updating"): it ran, it is not running, and still nothing says idle', () => {
    const r = recency(base({ live: [live(40 * 60)] }));
    expect(r.running).toBe(false);
    expect(r.newer).toBe(true);
    expect(r.since).toBe(4);
    expect(r.title).toBe(`Built ${dayWords(Date.parse('2026-09-14T06:51:03Z'), NOW)}`);
    expect(r.stageSentence).toBe(`4 sessions here since ${dayOf(LAST_AT, NOW)}, the last one ${dayWords(Date.parse('2026-09-14T06:51:03Z'), NOW)}.`);
    expect(r.reportLine).toContain('The 4 sessions since were uploaded from your machines and are not in it.');
    neverIdle(r);
  });

  test('finished rows only: the newest one, when it started and when it ended', () => {
    const r = recency(base());
    expect(r.running).toBe(false);
    const start = Date.parse('2026-09-14T06:06:22Z');
    expect(r.lastSession).toBe(`Last session ${daysBetween(start, NOW) === 0 ? 'today' : 'yesterday'} at ${timeOfDay(start)}, ended at ${timeOfDay(Date.parse('2026-09-14T06:35:01Z'))}, as this phone has it.`);
    neverIdle(r);
  });

  test('regression: a quiet live row and no finished one (Math.max over a missing row was NaN, and the page threw)', () => {
    const r = recency(base({ finals: FINALS.slice(3), live: [live(40 * 60)] }));
    expect(r.newer).toBe(true);
    expect(r.since).toBe(1);
    neverIdle(r);
  });
});

describe('what is not news', () => {
  test('nothing on the phone after the report: the report stands, its days brought up to today and never below', () => {
    const r = recency(base({ finals: FINALS.slice(3) }));
    expect(r.newer).toBe(false);
    expect(r.title).toBe('Winding down');
    const days = Math.max(13, daysBetween(Date.parse(LAST_AT), NOW));
    expect(r.stageSentence).toBe(`No session here for ${days} days.`);
    expect(r.lastSession).toBe(`Last session ${days} days ago.`);
    expect(r.reportLine).toBeNull();
    expect(r.streakNote).toBeNull();
    // A phone whose clock reads earlier than the report's never says a smaller number.
    const early = recency(base({ finals: [], now: Date.parse(LAST_AT) + 3_600_000 }));
    expect(early.stageSentence).toBe('No session here for 13 days.');
  });

  test('the same sitting uploaded: a row that started before the report\'s last one ended is not news', () => {
    const r = recency(base({ finals: [row('same', '2026-08-31T16:02:00Z', '2026-08-31T18:20:00Z')] }));
    expect(r.newer).toBe(false);
  });

  test('another project\'s running session is not this one\'s', () => {
    const r = recency(base({ finals: [], live: [live(60, OTHER)] }));
    expect(r.newer).toBe(false);
    expect(r.running).toBe(false);
  });

  test('a stage that says nothing idle keeps its word, and the phone adds what it knows', () => {
    const r = recency(base({ history: { ...HISTORY, stage: 'active', stage_rule: 'steady', days_built_recent: 8 } }));
    expect(r.title).toBe('Active');
    expect(r.newer).toBe(true);
    expect(r.reportLine).not.toContain('so it says');
    neverIdle(r);
  });
});

describe('the door, which has only the phone\'s saved rows and the profile\'s newest start', () => {
  test('a newer start the server listed is news, said as the phone has it', () => {
    const r = recency(base({ finals: [], lastStartedAt: '2026-09-13T20:10:00Z' }));
    expect(r.newer).toBe(true);
    expect(r.since).toBe(1);
    expect(r.title?.startsWith('Built ')).toBe(true);
    expect(r.doorLine).toBe(`Last session ${dayWords(Date.parse('2026-09-13T20:10:00Z'), NOW)}, as this phone has it.`);
    neverIdle(r);
  });

  test('an older one is not', () => {
    expect(recency(base({ finals: [], lastStartedAt: '2026-08-20T10:00:00Z' })).newer).toBe(false);
  });
});

describe('the night on the day dial', () => {
  const block = (): ReportProjects => JSON.parse(readFileSync(join(REPO, 'spec', 'fixtures', 'projects', 'block.json'), 'utf8')) as ReportProjects;

  test('the night owl rule\'s own value on this project, as a share and a figure', () => {
    const b = block();
    const p = b.projects[0]!;
    p.window!.scores = p.window!.scores.map((s) => (s.metric === 'night_share' ? { ...s, value: 0.469 } : s));
    const page = projectPage(b, p.key)!;
    expect(page.time!.nightShare).toBe(0.469);
    expect(page.time!.night!.final).toBe('47%');
  });

  test('a measured zero is a zero; no value sent is no night window at all', () => {
    const b = block();
    const page = projectPage(b, b.projects[0]!.key)!;
    expect(page.time!.nightShare).toBe(0);
    expect(page.time!.night!.final).toBe('0%');
    b.projects[0]!.window!.scores = b.projects[0]!.window!.scores.filter((s) => s.metric !== 'night_share');
    const none = projectPage(b, b.projects[0]!.key)!;
    expect(none.time!.nightShare).toBeNull();
    expect(none.time!.night).toBeNull();
  });
});
