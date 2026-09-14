/**
 * The projects screens' view model (`src/projects/model.ts`, docs/projects.md), and the one
 * request that feeds a project page (`Api.project`).
 *
 * Three pins, strongest first:
 *   1. `spec/fixtures/projects/sentences.json`, written by `scripts/gen_copy.py` from
 *      `analysis/tests/projects_fixture.py`: every comparison, stage, week and refusal the
 *      engine words renders here word for word.
 *   2. `spec/fixtures/projects/block.json`, a whole projects block as `analysis.projects`
 *      builds it: the list and the page read it with no dash, no "null", no "NaN", and no
 *      window number where the window is null.
 *   3. The privacy of a label: a private repository is never given a name the server did not
 *      send and the owner did not type.
 */
import { describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ReportProjectComparison, ReportProjectHistory, ReportProjectMomentum, ReportProjects } from '../src/generated/report';
import { hasDash } from '../src/copy/plain';
import { renderCards } from '../src/copy/wrapped';
import {
  clockRefusal,
  comparisonSentence,
  costRefusal,
  languagesRefusal,
  lastSessionSentence,
  momentumSentence,
  projectDetail,
  projectLabel,
  projectsView,
  qualityRefusal,
  shortKey,
  stageLabel,
  stageSentence,
  timesWords,
} from '../src/projects/model';
import { REPO } from './pythonRef';

const SENTENCES = join(REPO, 'spec', 'fixtures', 'projects', 'sentences.json');
const BLOCK = join(REPO, 'spec', 'fixtures', 'projects', 'block.json');

type Entry =
  | { kind: 'comparison'; name: string; input: ReportProjectComparison; labels: Record<string, string>; sentence: string }
  | { kind: 'stage'; name: string; input: ReportProjectHistory; display: string; sentence: string; last: string }
  | { kind: 'momentum'; name: string; input: ReportProjectMomentum; sentence: string }
  | { kind: 'refusal'; name: string; reader: 'quality' | 'languages' | 'clock' | 'cost'; input: Record<string, number | string | null>; sentence: string };

const entries = JSON.parse(readFileSync(SENTENCES, 'utf8')) as Entry[];
const block = (): ReportProjects => JSON.parse(readFileSync(BLOCK, 'utf8')) as ReportProjects;

function strings(obj: unknown, out: string[] = []): string[] {
  if (typeof obj === 'string') out.push(obj);
  else if (Array.isArray(obj)) for (const v of obj) strings(v, out);
  else if (obj && typeof obj === 'object') for (const v of Object.values(obj)) strings(v, out);
  return out;
}

function houseRules(obj: unknown) {
  for (const s of strings(obj)) {
    expect({ s, dash: hasDash(s) }).toEqual({ s, dash: false });
    expect(s).not.toMatch(/\b(null|undefined|NaN)\b/);
  }
}

// ------------------------------------------------------------------ 1. the sentences
describe('every sentence the engine words, word for word', () => {
  test('the fixture reaches every kind', () => {
    expect(new Set(entries.map((e) => e.kind))).toEqual(new Set(['comparison', 'stage', 'momentum', 'refusal']));
    expect(entries.length).toBeGreaterThan(40);
  });

  for (const e of entries) {
    test(`${e.kind} ${e.name}`, () => {
      if (e.kind === 'comparison') {
        expect(comparisonSentence(e.input, e.labels)).toBe(e.sentence);
      } else if (e.kind === 'stage') {
        expect(stageLabel(e.input.stage)).toBe(e.display);
        expect(stageSentence(e.input)).toBe(e.sentence);
        expect(lastSessionSentence(e.input)).toBe(e.last);
      } else if (e.kind === 'momentum') {
        expect(momentumSentence(e.input)).toBe(e.sentence);
      } else {
        const reader = { quality: qualityRefusal, languages: languagesRefusal, clock: clockRefusal, cost: costRefusal }[e.reader] as (x: unknown) => string | null;
        expect(reader(e.input)).toBe(e.sentence);
      }
      expect(hasDash(e.sentence)).toBe(false);
    });
  }

  test('twice is said once the ratio says two', () => {
    expect(timesWords(2)).toBe('twice');
    expect(timesWords(2.04)).toBe('twice');
    expect(timesWords(2.15)).toBe('2.1 times');
    expect(timesWords(10.08)).toBe('10.1 times');
  });

  test('a metric or a code this build does not know renders nothing', () => {
    const base = entries.find((e) => e.kind === 'comparison')!.input as ReportProjectComparison;
    expect(comparisonSentence({ ...base, metric: 'vibes' as never }, {})).toBeNull();
    expect(comparisonSentence({ ...base, reason: 'because' as never }, {})).toBeNull();
    expect(qualityRefusal({ reason: 'mystery' as never, runs: 3, needed: 5 })).toBeNull();
    expect(stageLabel('abandoned')).toBeNull();
  });
});

// ------------------------------------------------------------------ 2. the block
describe('the list and the page over a real block', () => {
  const b = block();
  const [first, second] = b.projects;

  test('the list keeps the block order and says what it leaves out', () => {
    const v = projectsView(b)!;
    expect(v.rows.map((r) => r.key)).toEqual(b.projects.map((p) => p.key));
    expect(v.rows.map((r) => r.rank)).toEqual([1, 2]);
    expect(v.hidden).toBe(b.projects_total - b.projects.length);
    expect(v.windowDays).toBe(b.window_days);
    expect(v.unresolved.historySessions).toBe(b.unresolved.history_sessions);
    expect(v.rows[0]!.shortKey).toBe(first!.key.slice(0, 12));
    houseRules(v);
  });

  test('a block that is not there is not computed, never no projects', () => {
    expect(projectsView(null)).toBeNull();
    expect(projectsView(undefined)).toBeNull();
    expect(projectDetail(null, first!.key)).toBeNull();
  });

  test('a comparison shows its two projects with their two numbers', () => {
    const v = projectsView(b, { [first!.key]: 'RideGT' }, { [second!.key]: 'my side thing' })!;
    const answered = v.comparisons.filter((c) => c.answered);
    expect(answered.length).toBeGreaterThan(0);
    for (const c of answered) {
      expect(c.high).not.toBeNull();
      expect(c.low).not.toBeNull();
      expect(c.sentence).toContain(c.high!.label.text);
      expect(c.sentence).toContain(c.low!.label.text);
      expect(c.title.length).toBeGreaterThan(0);
    }
    expect(v.comparisons.map((c) => c.metric)).toEqual(b.comparisons.map((c) => c.metric));
    houseRules(v);
  });

  test('the page renders every section the window has, with the deck renderer for its cards', () => {
    const d = projectDetail(b, first!.key, null, null, Date.parse('2026-09-21T00:00:00Z'))!;
    const w = first!.window!;
    expect(d.cards).toEqual(renderCards(w.cards));
    expect(d.cards.map((c) => c.id)).toEqual(w.cards.map((c) => c.id));
    expect(d.commits!.days.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.day))).toBe(true);
    expect(d.commits!.days.map((x) => x.day)).toEqual(w.commits!.days.map((x) => x.day.slice(0, 10)));
    expect(d.money!.headline).not.toBeNull();
    expect(d.stack.length).toBe(w.stack.items.length);
    expect(d.harnesses[0]!.harness).toBe('claude_code');
    expect(d.comparisons.every((c) => c.high?.key === first!.key || c.low?.key === first!.key)).toBe(true);
    houseRules(d);
  });

  test('the page takes the short key the profile lists', () => {
    expect(projectDetail(b, shortKey(first!.key))!.key).toBe(first!.key);
    expect(projectDetail(b, 'f'.repeat(12))).toBeNull();
  });

  test('a project with no sitting in the window shows no window number at all', () => {
    const quiet = block();
    quiet.projects[1]!.window = null;
    const d = projectDetail(quiet, second!.key)!;
    expect(d.window).toBeNull();
    expect([d.tests, d.languages, d.commits, d.money, d.burn, d.agents, d.peakHour]).toEqual([null, null, null, null, null, null, null]);
    expect(d.cards).toEqual([]);
    expect(d.stageLabel).not.toBeNull();
    expect(d.lastSession).toMatch(/^Last session/);
    const row = projectsView(quiet)!.rows[1]!;
    expect(row.window).toBeNull();
    houseRules(d);
  });

  test('a null number renders its reason, never a zero', () => {
    const thin = block();
    const w = thin.projects[0]!.window!;
    w.clock = { peak_hour: null, reason: 'below_active_floor', active_minutes: 25, needed_minutes: 60 };
    w.quality = { runs: 2, passed: null, failed: null, first_try_rate: null, time_to_green: null, reason: 'below_run_floor', needed: 5 };
    const d = projectDetail(thin, thin.projects[0]!.key)!;
    expect(d.peakHour).toBeNull();
    expect(d.peakHourRefusal).toBe('25 minutes of active time here, 60 needed.');
    expect(d.tests!.alreadyGreen).toBeNull();
    expect(d.tests!.refusal).toBe('2 test runs in this window, 5 needed.');
  });
});

// ------------------------------------------------------------------ 3. labels
describe('a private repository is never named by anyone but its owner', () => {
  const key = 'a'.repeat(64);

  test('public name, then the owner label, then the number this phone gave it, never a character of the key', () => {
    expect(projectLabel(key, { [key]: 'gt-transit' }, { [key]: 'RideGT' })).toEqual({ text: 'gt-transit', source: 'public' });
    expect(projectLabel(key, {}, { [key]: 'RideGT' })).toEqual({ text: 'RideGT', source: 'nickname' });
    expect(projectLabel(key, null, null, 2)).toEqual({ text: 'Private project\u00a02', source: 'private' });
    expect(projectLabel(key, null, null)).toEqual({ text: 'Private project', source: 'private' });
  });

  test('another key\'s name is never borrowed, and a blank one is no name', () => {
    const other = 'c'.repeat(64);
    expect(projectLabel(key, { [other]: 'acme-public' }, { [other]: 'theirs' }).source).toBe('private');
    expect(projectLabel(key, { [key]: '   ' }, null).source).toBe('private');
  });

  test('the block itself carries no name for the view to leak', () => {
    const b = block();
    const v = projectsView(b)!;
    for (const r of v.rows) expect(r.label.source).toBe('private');
    // Numbered in the order of their first sessions, never by a piece of the key.
    expect(v.rows.map((r) => r.label.text).sort()).toEqual(['Private project\u00a01', 'Private project\u00a02']);
    for (const r of v.rows) expect(r.label.text.includes(r.key.slice(0, 4))).toBe(false);
    for (const s of strings(b)) expect(s).not.toMatch(/zebra|github/);
  });
});

// ------------------------------------------------------------------ the request
mock.module('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} }));
mock.module('expo-constants', () => ({ default: { expoConfig: { version: '0.1.0-test' } } }));

describe('Api.project', () => {
  test('asks for the one project route with the key it was given', async () => {
    const { Api } = await import('../src/data/api');
    const seen: string[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      seen.push(String(input));
      return new Response(JSON.stringify({ key: 'a'.repeat(64), name: null, window_days: 30, generated_at: null, project: null, comparisons: [], project_names: {}, sessions: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
    try {
      const api = new Api('http://127.0.0.1:1', {
        get: async (k) => (k === 'builder.access' ? 'a' : k === 'builder.refresh' ? 'r' : null),
        set: async () => {},
        remove: async () => {},
      });
      const got = await api.project('c0ffee00c0ff');
      expect(seen).toEqual(['http://127.0.0.1:1/v1/projects/c0ffee00c0ff']);
      // A later page: the keyset instant, encoded, and the page size.
      await api.project('c0ffee00c0ff', { before: '2026-09-01T10:00:00+00:00', limit: 200 });
      expect(seen[1]).toBe('http://127.0.0.1:1/v1/projects/c0ffee00c0ff?before=2026-09-01T10%3A00%3A00%2B00%3A00&limit=200');
      expect(got.name).toBeNull();
    } finally {
      globalThis.fetch = real;
    }
  });
});
