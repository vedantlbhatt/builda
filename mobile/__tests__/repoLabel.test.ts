/**
 * One name for one project on every surface (`src/copy/repoLabel.ts`). FOUND IN THE CAPTURE PASS
 * (2026-09-14, shots/now2): the Projects tab called the owner's two private projects "Private
 * project 1" and "Private project 2", and the Now tile, every Sessions row, the session hero, the
 * share card, the Lock Screen and the Dynamic Island still said "private repo", one of them for a
 * session running in Private project 2 at that moment.
 *
 * Also held here: the sample says it is one and names no real repository (item 14), and the
 * card's foot says Builda and no address (item 13).
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CARD_FOOT, toCardModel } from '../src/card/model';
import { PRIVATE_REPO, repoLabel, type RepoNames } from '../src/copy/repoLabel';
import type { SessionDetail } from '../src/data/api';
import { reportProjectsOf } from '../src/data/listedProjects';
import { debugSessions, DEBUG_STATES } from '../src/live/fixtures';
import { lastFinishedLine, missionSample, SAMPLE_KINDS, SAMPLE_REPOS, tileModel } from '../src/live/mission';
import { buildWidgetSnapshot, planSync, toAttrs } from '../src/live/surface';
import { EMPTY_REGISTRY, projectLabel, registerProjects } from '../src/projects/model';
import { heroOf, rowOf } from '../src/session/page';

const ROOT = join(import.meta.dir, '..');
const NOW = Date.parse('2026-09-14T03:30:00Z');
const MIN = 60_000;
const NBSP = ' ';

/** The two keys of the capture: the first project's first session is on Aug 12, the second's on Aug 16. */
const K1 = 'b093f92080ab6e13cc2d5fd8187c4da6f1c946f7c9f38d5182dd5ce6c6c46275';
const K2 = '03624fb1c6e2cd77e365bf6cc4e567e75a81ac2772016ca1bec523a847e4a504';
/** A third repository the Mac's report does not list: the phone has not numbered it. */
const K3 = '15d6610a64087cbf2cc0f346adafad54c5cc88610aa7b9ffc018229a61ba0837';

const LISTED = [
  { key: K2, history: { first_at: '2026-08-16T01:07:09Z' } },
  { key: K1, history: { first_at: '2026-08-12T00:44:30Z' } },
];

function names(nicknames: Record<string, string> = {}): RepoNames {
  return { nicknames, registry: registerProjects(EMPTY_REGISTRY, LISTED).registry };
}

function row(id: string, over: Partial<SessionDetail> = {}): SessionDetail {
  return {
    id,
    client_session_id: `${id}-c`,
    harness: 'claude_code',
    repo_name: null,
    repo_key: K2,
    started_at: new Date(NOW - 32 * MIN).toISOString(),
    ended_at: new Date(NOW - 10_000).toISOString(),
    updated_at: new Date(NOW - 10_000).toISOString(),
    active_seconds: 32 * 60,
    idle_seconds: 0,
    local_date: '2026-09-13',
    title: null,
    title_source: null,
    notable: true,
    unattended: false,
    timeline_fidelity: 'full',
    is_shared: false,
    state: 'live',
    attended_seconds: 32 * 60,
    autonomous_seconds: 0,
    stats: null,
    ...over,
  };
}

describe('the rule', () => {
  test('a public name, else the number the phone gave the project, else "private repo"', () => {
    const n = names();
    expect(repoLabel({ repo_name: 'builder', repo_key: K2 }, n)).toBe('builder');
    expect(repoLabel({ repo_name: null, repo_key: K1 }, n)).toBe(`Private project${NBSP}1`);
    expect(repoLabel({ repo_name: null, repo_key: K2 }, n)).toBe(`Private project${NBSP}2`);
    // No key: the sitting's repository did not resolve. Not numbered: a repository the report does
    // not list. Not read yet: no names at all. Each keeps "private repo", never a guessed number.
    expect(repoLabel({ repo_name: null, repo_key: null }, n)).toBe(PRIVATE_REPO);
    expect(repoLabel({ repo_name: null }, n)).toBe(PRIVATE_REPO);
    expect(repoLabel({ repo_name: null, repo_key: K3 }, n)).toBe(PRIVATE_REPO);
    expect(repoLabel({ repo_name: null, repo_key: K2 }, null)).toBe(PRIVATE_REPO);
    expect(repoLabel({ repo_name: '  ', repo_key: null }, n)).toBe(PRIVATE_REPO);
  });

  test("the words are the Projects tab's own, never written out a second time", () => {
    const n = names();
    for (const key of [K1, K2]) {
      expect(repoLabel({ repo_name: null, repo_key: key }, n)).toBe(projectLabel(key, null, null, n.registry.projects[key]!.n).text);
    }
  });

  test("the owner's own name is used inside the app and never on what leaves it", () => {
    const n = names({ [K2]: 'the transit app' });
    expect(repoLabel({ repo_name: null, repo_key: K2 }, n, 'app')).toBe('the transit app');
    expect(repoLabel({ repo_name: null, repo_key: K2 }, n, 'outside')).toBe(`Private project${NBSP}2`);
    // A name for a project the phone has not numbered still names it inside the app.
    expect(repoLabel({ repo_name: null, repo_key: K3 }, { ...n, nicknames: { [K3]: 'side thing' } }, 'app')).toBe('side thing');
    expect(repoLabel({ repo_name: null, repo_key: K3 }, { ...n, nicknames: { [K3]: 'side thing' } }, 'outside')).toBe(PRIVATE_REPO);
  });

  test("the report's projects come out of the saved builder profile, and nothing else does", () => {
    const saved = JSON.stringify({ window_days: 90, report: { projects: { projects: LISTED } } });
    expect(reportProjectsOf(saved)).toEqual(LISTED);
    expect(reportProjectsOf(JSON.parse(saved))).toEqual(LISTED);
    expect(reportProjectsOf(JSON.stringify({ report: null }))).toBeNull();
    expect(reportProjectsOf('{not json')).toBeNull();
    expect(reportProjectsOf(null)).toBeNull();
    expect(reportProjectsOf(JSON.stringify({ report: { projects: { projects: [{ key: K1 }, 7, null] } } }))).toEqual([]);
  });
});

describe('every surface that names a repository says the same thing', () => {
  const n = names();
  const s = row('live-1');
  const two = `Private project${NBSP}2`;

  test('the Now tile and the empty band', () => {
    expect(tileModel(s, NOW, n).repo).toBe(two);
    expect(tileModel(s, NOW, n).label.startsWith(`${two}, `)).toBe(true);
    expect(tileModel(s, NOW).repo).toBe(PRIVATE_REPO);
    expect(lastFinishedLine({ ...s, state: 'final' }, () => 'today', n).startsWith(`${two} finished`)).toBe(true);
  });

  test('a Sessions row and the session hero', () => {
    const final = row('f-1', { state: 'final' });
    expect(rowOf(final, NOW, n).meta.startsWith(`${two} · `)).toBe(true);
    expect(heroOf(final, NOW, n).repo).toBe(two);
    expect(rowOf(row('f-2', { state: 'final', repo_key: null }), NOW, n).meta.startsWith(`${PRIVATE_REPO} · `)).toBe(true);
  });

  test('the Lock Screen, the Dynamic Island and the widget, with details on; Builda with them off', () => {
    expect(toAttrs(s, true, n).repo).toBe(two);
    expect(toAttrs(s, false, n).repo).toBe('Builda');
    const plan = planSync({ sessions: [s], tracked: new Map(), activitiesEnabled: true, names: n, nowMs: NOW });
    const start = plan.actions.find((a) => a.kind === 'start');
    expect(start && start.kind === 'start' ? start.attrs.repo : null).toBe(two);
    const off = planSync({ sessions: [s], tracked: new Map(), activitiesEnabled: true, names: n, details: false, nowMs: NOW });
    const offStart = off.actions.find((a) => a.kind === 'start');
    expect(offStart && offStart.kind === 'start' ? offStart.attrs.repo : null).toBe('Builda');
    expect(buildWidgetSnapshot({ sessions: [s], names: n, nowMs: NOW }).sessions[0]!.repo).toBe(two);
  });

  test('the Lock Screen never carries the name the owner typed', () => {
    const own = names({ [K2]: 'gt-transit' });
    expect(toAttrs(s, true, own).repo).toBe(two);
    expect(buildWidgetSnapshot({ sessions: [s], names: own, nowMs: NOW }).sessions[0]!.repo).toBe(two);
    // Inside the app the owner's name is theirs to see.
    expect(tileModel(s, NOW, own).repo).toBe('gt-transit');
  });

  test('the share card: the number, never the typed name, and the caption carries only a public name', () => {
    const final = row('c-1', { state: 'final', stats: { tokens_reported: false } as SessionDetail['stats'] });
    const m = toCardModel(final, names({ [K2]: 'gt-transit' }));
    expect(m.repoLabel).toBe(two);
    expect(m.repoName).toBeNull();
    expect(toCardModel({ ...final, repo_name: 'builder' }, n).repoName).toBe('builder');
    expect(toCardModel({ ...final, repo_key: null }, n).repoLabel).toBe(PRIVATE_REPO);
  });
});

describe('the share card says Builda (item 13)', () => {
  test('its foot is the product and its own line, never an address on a domain it does not have', () => {
    expect(CARD_FOOT).toBe('your build sessions, read back to you');
    // The code, not the notes about what it used to say.
    const code = (f: string) =>
      readFileSync(join(ROOT, f), 'utf8')
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
        .join('\n');
    const card = code('src/card/RecapCard.tsx');
    expect(card).toContain('>Builda</Text>');
    expect(card).not.toMatch(/>builder<|builder\.dev/);
    expect(code('app/session/[id].tsx')).not.toContain('builder.dev');
    const mac = code('../Packages/BuilderKit/Sources/BuilderUI/RecapCardView.swift');
    expect(mac).toContain('Text("Builda")');
    expect(mac).not.toContain('builder.dev');
  });
});

describe('a sample names no real repository and says it is a sample (item 14)', () => {
  const REAL = ['gt-transit', 'RideGT', 'builder', 'builder-overnight'];

  test('the sample session', () => {
    const client = readFileSync(join(ROOT, 'src/data/client.ts'), 'utf8');
    const name = client.match(/export const SAMPLE_REPO_NAME = '([^']+)'/)![1]!;
    expect(REAL).not.toContain(name);
    expect(name).toContain('sample');
    expect(client).toContain('repo_name: SAMPLE_REPO_NAME');
  });

  test('mission control and the Lock Screen fixtures', () => {
    for (const r of Object.values(SAMPLE_REPOS)) expect(REAL).not.toContain(r);
    for (const kind of SAMPLE_KINDS) {
      const s = missionSample(kind, NOW);
      for (const r of [...s.live, ...s.finals]) expect(REAL).not.toContain(r.repo_name ?? '');
    }
    for (const state of DEBUG_STATES) {
      const d = debugSessions(state, 4, NOW);
      for (const r of [...d.sessions, ...d.finished]) expect(REAL).not.toContain(r.repo_name ?? '');
    }
    const swift = readFileSync(join(ROOT, 'targets/widget/_shared/LiveFixtures.swift'), 'utf8');
    const renderer = readFileSync(join(ROOT, 'targets/widget/_shared/LivePreviewRenderer.swift'), 'utf8');
    for (const r of REAL) {
      expect(swift).not.toContain(`"${r}"`);
      expect(renderer).not.toContain(`"${r}"`);
    }
  });
});
