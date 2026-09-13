/**
 * The Stack page as data (`src/stack/model.ts`) and where it puts things (`src/stack/layout.ts`),
 * held without a renderer on the committed report the analysis page was designed against and on
 * a report shaped like the live one (53 things, 7 categories, 143 sessions).
 *
 * What this page may never do: draw a thing no session used as a count or a tile (absent is not
 * zero), say one number two ways (the groups, names and cut note are `stackView`'s, the hues the
 * You tab's door's), land a count on a string the copy helpers would not write, put a dash in
 * front of a person, or call a plain function from a worklet.
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { hasDash } from '../src/copy/plain';
import type { BuilderProfileResponse } from '../src/data/api';
import type { ReportStack, ReportStackItem } from '../src/generated/report';
import fixture from '../src/insights/fixtures/report-2026-09-13.json';
import { formatWith, type NumSpec } from '../src/insights/format';
import { isRefused, NO_REPORT } from '../src/insights/model';
import { bubbleRadius, packBubbles, packTiles, rowsHeight, tileSize, TILE_UNITS, wrapMarks } from '../src/stack/layout';
import { CATEGORY_HUES, chapterHues, listOf, LOOP_MAX, phoneTools, projectReach, reportTools, stackPage, TOP_MAX, toolsBand, toolsFromReport, type StackBody } from '../src/stack/model';
import { stackPage as doorStackPage } from '../src/you/chapters';

const B = fixture.builder as unknown as BuilderProfileResponse;
const NOW = Date.parse('2026-09-13T14:00:00Z');
const MOBILE = join(import.meta.dir, '..');

function strings(x: unknown, out: string[] = []): string[] {
  if (typeof x === 'string') out.push(x);
  else if (Array.isArray(x)) for (const y of x) strings(y, out);
  else if (x && typeof x === 'object') for (const y of Object.values(x)) strings(y, out);
  return out;
}

function nums(x: unknown, out: NumSpec[] = []): NumSpec[] {
  if (!x || typeof x !== 'object') return out;
  if (Array.isArray(x)) {
    for (const y of x) nums(y, out);
    return out;
  }
  const o = x as Record<string, unknown>;
  if ('fmt' in o && 'final' in o && 'value' in o) {
    out.push(o as unknown as NumSpec);
    return out;
  }
  for (const y of Object.values(o)) nums(y, out);
  return out;
}

function body(b: BuilderProfileResponse, hero: Parameters<typeof stackPage>[1] = 'tide'): StackBody {
  const p = stackPage(b, hero, NOW);
  if (isRefused(p.body)) throw new Error(p.body.refusal);
  return p.body;
}

/** A report shaped like the live one: the same items, counts and evidence the phone was shown. */
const LIVE_ITEMS: [ReportStackItem['id'], ReportStackItem['category'], ReportStackItem['evidence'], number][] = [
  ['python', 'language', 'language', 60],
  ['javascript', 'language', 'language', 18],
  ['html', 'language', 'language', 6],
  ['swift', 'language', 'language', 3],
  ['typescript', 'language', 'language', 2],
  ['sql', 'language', 'language', 1],
  ['expo', 'framework', 'manifest', 13],
  ['swiftui', 'framework', 'path', 1],
  ['react', 'framework', 'manifest', 0],
  ['react_native', 'framework', 'manifest', 0],
  ['nextjs', 'framework', 'manifest', 0],
  ['fastapi', 'framework', 'manifest', 0],
  ['tailwind', 'framework', 'manifest', 0],
  ['reanimated', 'framework', 'manifest', 0],
  ['sqlalchemy', 'framework', 'manifest', 0],
  ['react_native_maps', 'framework', 'manifest', 0],
  ['sqlite', 'database', 'manifest', 21],
  ['postgres', 'database', 'manifest', 5],
  ['redis', 'database', 'manifest', 3],
  ['railway', 'infra', 'command', 49],
  ['eas', 'infra', 'command', 29],
  ['prometheus', 'infra', 'manifest', 11],
  ['docker', 'infra', 'command', 10],
  ['grafana', 'infra', 'command', 10],
  ['vercel', 'infra', 'manifest', 5],
  ['google_cloud', 'infra', 'command', 5],
  ['cloudflare', 'infra', 'command', 1],
  ['github_actions', 'infra', 'path', 1],
  ['aws', 'infra', 'manifest', 0],
  ['pytest', 'testing', 'command', 63],
  ['jest', 'testing', 'manifest', 25],
  ['maestro', 'testing', 'command', 11],
  ['xctest', 'testing', 'command', 5],
  ['bun_test', 'testing', 'command', 3],
  ['vitest', 'testing', 'manifest', 1],
  ['playwright', 'testing', 'manifest', 0],
  ['locust', 'testing', 'manifest', 0],
  ['git', 'tooling', 'command', 115],
  ['npm', 'tooling', 'command', 48],
  ['xcode', 'tooling', 'command', 26],
  ['eslint', 'tooling', 'manifest', 5],
  ['bun', 'tooling', 'manifest', 3],
  ['ruff', 'tooling', 'command', 3],
  ['android_sdk', 'tooling', 'command', 3],
  ['alembic', 'tooling', 'manifest', 3],
  ['uv', 'tooling', 'command', 2],
  ['prettier', 'tooling', 'command', 1],
  ['make', 'tooling', 'path', 1],
  ['cocoapods', 'tooling', 'command', 1],
  ['valhalla', 'service', 'command', 15],
  ['transloc', 'service', 'command', 15],
  ['posthog', 'service', 'manifest', 0],
  ['sentry', 'service', 'manifest', 0],
];

function liveStack(over: Partial<ReportStack> = {}): ReportStack {
  return {
    items: LIVE_ITEMS.map(([id, category, evidence, sessions]) => ({ id, category, evidence, sessions, first_seen: sessions > 0 ? '2026-08-14T20:10:49Z' : null })),
    sessions: 143,
    manifests: 130,
    shell_calls: 7978,
    shell_calls_cut: 5932,
    reason: null,
    ...over,
  };
}

const LIVE: BuilderProfileResponse = { ...B, report: { ...B.report!, stack: liveStack() } };

// ------------------------------------------------------------------ the page

describe('the hero and the bubbles', () => {
  test('the committed report: 12 things, what they split into, and what they were read from', () => {
    const s = body(B);
    expect(s.total.final).toBe('12');
    expect(s.caption).toBe('things your work is made of');
    expect(s.note).toBe('8 turned up in your sessions, and 4 more are only named in a manifest.');
    expect(s.basis).toBe('Across 2 categories, read by your Mac from 158 sessions and 130 dependency names.');
    expect(s.topLine).toBe('Python turned up in the most sessions: 63 of the 158 read.');
  });

  test('the live shape: 53 things, 40 of them used, the bubbles and the drift the most used first', () => {
    const s = body(LIVE);
    expect([s.total.final, s.chapters.length]).toEqual(['53', 7]);
    expect(s.note).toBe('40 turned up in your sessions, and 13 more are only named in a manifest.');
    expect(s.top.map((t) => t.id)).toEqual(['git', 'pytest', 'python', 'railway', 'npm', 'eas', 'xcode', 'jest', 'sqlite', 'javascript']);
    expect(s.top.length).toBe(TOP_MAX);
    expect(s.loop.length).toBe(LOOP_MAX);
    expect(s.loop.slice(0, TOP_MAX)).toEqual(s.top);
    expect(s.topLine).toBe('Git turned up in the most sessions: 115 of the 143 read.');
    expect(s.cutNote).toBe('5,932 of 7,978 shell commands were cut short in the digest, so a tool may have run unseen.');
  });

  test('a tie at the top is said as a tie', () => {
    const tie = { ...B, report: { ...B.report!, stack: liveStack({ items: liveStack().items.filter((i) => i.category === 'service') }) } };
    expect(body(tie).topLine).toBe('Valhalla and TransLoc turned up in the most sessions: 15 each, of the 143 read.');
  });

  test('a tap says the story: its sessions of all, the day it started, and what was seen', () => {
    const git = body(LIVE).top[0]!;
    expect(git.story).toMatch(/^In 115 of 143 sessions, first on [A-Z][a-z]{2} \d{1,2}\. Seen in the commands your sessions ran\.$/);
    expect(git.short).toMatch(/^115 of 143 sessions, since [A-Z][a-z]{2} \d{1,2}\.$/);
    // A tile turned over reads with its own count: [115] of 143 sessions, first on Aug 14.
    expect([git.ofTotal, git.seen]).toEqual(['of 143 sessions', 'Seen in the commands your sessions ran.']);
    expect(git.firstOn).toMatch(/^first on [A-Z][a-z]{2} \d{1,2}$/);
    const react = body(LIVE).chapters.find((c) => c.key === 'framework')!.named[0]!;
    expect([react.firstOn, react.seen]).toEqual([null, 'Named in a manifest, not seen in a session.']);
    const expo = body(LIVE).chapters.find((c) => c.key === 'framework')!.used[0]!;
    expect(expo.story).toEndWith('A manifest names it too.');
    expect(expo.share).toBeCloseTo(13 / 143, 10);
  });

  test('when the report carries projects, a story says how many used it; with fewer than two, or none sent, it says nothing of them', () => {
    const win = (ids: [string, number][]) => ({ window: { stack: { items: ids.map(([id, sessions]) => ({ id, category: 'tooling', evidence: 'command', sessions, first_seen: null })) } } });
    const projects = { projects: [win([['git', 40], ['npm', 3]]), win([['git', 70], ['npm', 0]]), win([['python', 9]]), { window: null }] };
    expect(projectReach({ projects })).toEqual({ total: 3, using: new Map([['git', 2], ['npm', 1], ['python', 1]]) });
    const withProjects = { ...LIVE, report: { ...LIVE.report!, projects } } as unknown as BuilderProfileResponse;
    const git = body(withProjects).top[0]!;
    expect(git.story).toEndWith('Seen in the commands your sessions ran. Used in 2 of the 3 projects this report read.');
    // One project is no comparison; a shape this build does not know is no answer.
    expect(projectReach({ projects: { projects: [win([['git', 1]])] } })).toBeNull();
    expect(projectReach({ projects: { projects: 'soon' } })).toBeNull();
    expect(projectReach(null)).toBeNull();
    expect(body(LIVE).top[0]!.story).not.toContain('projects');
  });

  test('the credits name the logos licence and only the attributions of marks the page shows', () => {
    expect(body(LIVE).credits).toBe(
      "The logos are each brand's own, drawn by Simple Icons (CC0) to name what you used, never to say a brand endorses Builda. Git logo by Jason Long, CC BY 3.0. Android robot by Google, CC BY 3.0.",
    );
    expect(body(B).credits).not.toContain('CC BY');
  });
});

describe('each category a chapter', () => {
  test('the chapters in the catalog order, each with its count, its noun and how it splits', () => {
    const s = body(LIVE);
    expect(s.chapters.map((c) => [c.index, c.title, c.count.final, c.caption])).toEqual([
      ['02', 'Languages', '6', 'languages'],
      ['03', 'Frameworks', '10', 'frameworks'],
      ['04', 'Databases', '3', 'databases'],
      ['05', 'Infrastructure', '10', 'pieces of infrastructure'],
      ['06', 'Testing', '8', 'testing tools'],
      ['07', 'Tools', '12', 'tools'],
      ['08', 'Services', '4', 'services'],
    ]);
    expect(s.chapters.map((c) => c.note)).toEqual([
      'All 6 turned up in your sessions.',
      '2 turned up in your sessions, and 8 are only named in a manifest.',
      'All 3 turned up in your sessions.',
      '9 turned up in your sessions, and 1 is only named in a manifest.',
      '6 turned up in your sessions, and 2 are only named in a manifest.',
      'All 12 turned up in your sessions.',
      '2 turned up in your sessions, and 2 are only named in a manifest.',
    ]);
  });

  test('absent is not zero: what only a manifest names has no count, no tile, no bubble, and one sentence', () => {
    const s = body(LIVE);
    const fw = s.chapters.find((c) => c.key === 'framework')!;
    expect(fw.used.map((t) => t.name)).toEqual(['Expo', 'SwiftUI']);
    expect(fw.namedLine).toBe('Named in a manifest, not seen in a session: React, React Native, Next.js, FastAPI, Tailwind CSS, Reanimated, SQLAlchemy, and React Native Maps.');
    expect(s.chapters.find((c) => c.key === 'service')!.namedLine).toBe('Named in a manifest, not seen in a session: PostHog and Sentry.');
    for (const c of s.chapters) {
      for (const t of c.used) expect(t.sessions).toBeGreaterThan(0);
      for (const t of c.named) {
        expect(t.sessions).toBe(0);
        expect(t.story).not.toMatch(/\d/);
      }
    }
    const named = new Set(s.chapters.flatMap((c) => c.named.map((t) => t.id)));
    for (const t of [...s.top, ...s.loop]) expect(named.has(t.id)).toBe(false);
  });

  test('a category nobody used says so, and a category everybody used says that', () => {
    const only = { ...B, report: { ...B.report!, stack: liveStack({ items: liveStack().items.filter((i) => ['posthog', 'sentry', 'git'].includes(i.id)) }) } };
    const s = body(only);
    expect(s.chapters.map((c) => c.note)).toEqual(['It turned up in your sessions.', 'Both are only named in a manifest.']);
  });

  test('the hues are the You door’s, so a category wears one colour on both screens', () => {
    const door = doorStackPage(LIVE, NOW);
    if (isRefused(door.body)) throw new Error('the live shape has a stack');
    expect(body(LIVE, 'tide').chapters.map((c) => c.hue)).toEqual(door.body.groups.map((g) => g.hue));
    expect(CATEGORY_HUES).toEqual(['ember', 'iris', 'brass', 'orchid', 'cobalt', 'coral', 'heather']);
  });

  test('no chapter wears the hero’s hue: the one that would takes a spare no chapter wears', () => {
    expect(chapterHues(7, 'iris')).toEqual(['ember', 'tide', 'brass', 'orchid', 'cobalt', 'coral', 'heather']);
    expect(chapterHues(2, 'ember')).toEqual(['tide', 'iris']);
    for (const hero of ['amber', 'brass', 'tide', 'cobalt', 'iris', 'heather', 'orchid', 'coral', 'ember'] as const) {
      const hs = chapterHues(7, hero);
      expect(hs).not.toContain(hero);
      expect(new Set(hs).size).toBe(7);
    }
  });
});

describe('refusals are sentences', () => {
  test('no report, no stack block, and nothing to read each say why; the first two offer the command', () => {
    const none = stackPage({ ...B, report: null }, 'tide', NOW);
    expect([isRefused(none.body) && none.body.refusal, none.notSent]).toEqual([NO_REPORT, true]);
    const old = stackPage({ ...B, report: { ...B.report!, stack: null } }, 'tide', NOW);
    expect([isRefused(old.body) && old.body.refusal, old.notSent]).toEqual(['Your Mac sent a report without the stack. A newer Mac sends it.', true]);
    const empty = stackPage({ ...B, report: { ...B.report!, stack: liveStack({ items: [], reason: 'no_evidence', manifests: 0 }) } }, 'tide', NOW);
    expect(isRefused(empty.body) && empty.body.refusal).toMatch(/, so nothing is named yet\.$/);
    expect(empty.notSent).toBe(false);
  });
});

describe('what the page says', () => {
  test('no dash in any string, and every count lands on the string the copy helper wrote', () => {
    for (const b of [B, LIVE]) {
      const page = stackPage(b, 'iris', NOW);
      for (const s of strings(page)) expect({ s, dash: hasDash(s) }).toEqual({ s, dash: false });
      for (const spec of nums(page)) expect(formatWith(spec.fmt, spec.value)).toBe(spec.final);
    }
  });

  test('lists say "and" before the last, with the house comma', () => {
    expect([listOf([]), listOf(['A']), listOf(['A', 'B']), listOf(['A', 'B', 'C'])]).toEqual(['', 'A', 'A and B', 'A, B, and C']);
  });
});

describe('the coding tools band', () => {
  const own = (k: string) => (k === 'claude_code' ? 'heather' : k === 'codex' ? 'tide' : null);

  test('one tool: every session ran in it, in its own hue', () => {
    const band = toolsBand({ tools: [{ key: 'claude_code', name: 'Claude Code', count: 52 }], basis: '' }, ['iris', 'heather'], own);
    expect(band && [band.total.final, band.caption, band.note]).toEqual(['52', 'sessions on this phone', 'Every one ran in Claude Code.']);
    // Heather is the last chapter's, so the band takes the first spare.
    expect(band?.hue).toBe('tide');
    expect(toolsBand({ tools: [{ key: 'claude_code', name: 'Claude Code', count: 52 }], basis: '' }, ['iris'], own)?.hue).toBe('heather');
  });

  test('several: each by name with its count; none is no band at all', () => {
    const band = toolsBand(
      { tools: [{ key: 'claude_code', name: 'Claude Code', count: 40 }, { key: 'codex', name: 'Codex', count: 10 }, { key: 'cursor', name: 'Cursor', count: 2 }], basis: '' },
      [],
      own,
    );
    expect(band?.note).toBe('Claude Code 40, Codex 10, and Cursor 2.');
    expect(band?.total.final).toBe('52');
    expect(toolsBand(null, [], own)).toBeNull();
    expect(toolsBand({ tools: [], basis: '' }, [], own)).toBeNull();
  });

  test('counted from the report, the band says where: the sessions your Mac read', () => {
    const band = toolsBand({ tools: [{ key: 'claude_code', name: 'Claude Code', count: 142 }], basis: '' }, [], own, 'report');
    expect(band && [band.total.final, band.caption]).toEqual(['142', 'sessions your Mac read']);
  });
});

describe('one source for every count on the page', () => {
  // FOUND IN THE CAPTURE (2026-09-13): "Counted over the 52 finished sessions saved on this
  // phone" a scroll below "Git, 115 of 143 sessions": two sources, and nothing said which.
  const withProjects = (harnesses: { harness: string; sessions: number }[][], sessions = 142, over: { unresolved?: number; total?: number } = {}) => ({
    ...B.report!,
    stack: { ...B.report!.stack!, sessions },
    projects: {
      window_days: 30,
      history_sessions: 160,
      projects_total: over.total ?? harnesses.length,
      projects: harnesses.map((hs, i) => ({ key: `${i}`.repeat(64), rank: i + 1, window: { harnesses: hs.map((h) => ({ ...h, active_seconds: 1 })) } })),
      unresolved: { sessions: over.unresolved ?? 0, active_seconds: 0, attended_seconds: 0, history_sessions: 0 },
      comparisons: [],
    },
  }) as unknown as NonNullable<BuilderProfileResponse['report']>;

  test('the tools are the report\'s projects\' tools, over the very sessions the stack was read from', () => {
    const report = withProjects([[{ harness: 'claude_code', sessions: 137 }], [{ harness: 'claude_code', sessions: 5 }]]);
    expect(reportTools(report)).toEqual({ byHarness: [['claude_code', 142]], covered: 142, read: 142, unresolved: 0, cut: 0, listed: 2 });
    const mix = toolsFromReport(report)!;
    expect(mix.tools.map((t) => [t.key, t.count])).toEqual([['claude_code', 142]]);
    expect(mix.basis).toBe('Counted over the 142 sessions your Mac read, the same sessions as every count above.');
  });

  test('Cursor\'s two tools are one mark, as on the phone; what is not covered is said by the report\'s own reason', () => {
    const two = [[{ harness: 'claude_code', sessions: 100 }, { harness: 'cursor_ide', sessions: 10 }], [{ harness: 'cursor_agent', sessions: 20 }]];
    const mix = toolsFromReport(withProjects(two, 142, { unresolved: 12 }))!;
    expect(mix.tools.map((t) => [t.key, t.count])).toEqual([['claude_code', 100], ['cursor', 30]]);
    expect(mix.basis).toBe('Counted over 130 of the 142 sessions your Mac read: the other 12 belong to no project, and the report counts tools project by project.');
    // Past the report's cap, sessions in the cut projects are NOT "in no project".
    expect(toolsFromReport(withProjects(two, 142, { total: 25 }))!.basis).toBe(
      'Counted over 130 of the 142 sessions your Mac read: the other 12 are in projects past the 2 the report lists, and the report counts tools project by project.',
    );
    expect(toolsFromReport(withProjects(two, 142, { unresolved: 4, total: 25 }))!.basis).toBe(
      'Counted over 130 of the 142 sessions your Mac read: the other 12 are in no project or in projects past the 2 the report lists, and the report counts tools project by project.',
    );
    // Neither reason in the report: it says so, and names no cause of its own.
    expect(toolsFromReport(withProjects(two, 142))!.basis).toBe('Counted over 130 of the 142 sessions your Mac read: the report does not say which tool wrote the other 12.');
  });

  test('a report with no projects: the phone\'s own count, said beside what the rest of the page is out of', () => {
    expect(toolsFromReport({ ...B.report!, projects: null })).toBeNull();
    const phone = phoneTools({ tools: [], basis: 'Counted over the 52 finished sessions saved on this phone.' }, 143);
    expect(phone?.basis).toBe('Counted over the 52 finished sessions saved on this phone. Every other count on this page is out of the 143 sessions your Mac read.');
    expect(phoneTools(null, 143)).toBeNull();
  });

  test('the page reads the report first and the phone only without it, and says which on the band', () => {
    const src = readFileSync(join(MOBILE, 'app/you/stack.tsx'), 'utf8');
    expect(src).toMatch(/toolsFromReport\(data\.report\)/);
    expect(src).toMatch(/fromReport \?\? phoneTools\(phone/);
    expect(src).toMatch(/fromReport \? 'report' : 'phone'/);
  });
});

// ------------------------------------------------------------------ where things go

describe('tiles sized by use', () => {
  const W = 362;
  const GAP = 8;

  test('a leader takes the row, the middle ones half, the rest a third', () => {
    expect([tileSize(60, 60), tileSize(45, 60), tileSize(18, 60), tileSize(6, 60)]).toEqual(['lead', 'lead', 'mid', 'small']);
    const langs = packTiles([60, 18, 6, 3, 2, 1].map((v, i) => ({ key: `k${i}`, value: v })), W, GAP);
    expect(langs.map((r) => r.tiles.map((t) => `${t.size}:${t.units}`))).toEqual([['lead:6'], ['mid:4', 'small:2'], ['small:2', 'small:2', 'small:2']]);
  });

  test('a thing used once, alone on its row, stays small rather than stretching as wide as the leader', () => {
    const fw = packTiles([{ key: 'expo', value: 13 }, { key: 'swiftui', value: 1 }], W, GAP);
    expect(fw.map((r) => r.tiles.map((t) => t.units))).toEqual([[6], [4]]);
  });

  test('two leads share a row', () => {
    const svc = packTiles([{ key: 'va', value: 15 }, { key: 'tl', value: 15 }], W, GAP);
    expect(svc.map((r) => r.tiles.map((t) => `${t.size}:${t.units}`))).toEqual([['lead:3', 'lead:3']]);
  });

  test('over many shapes: most used first, no row past six units, no tile past twice its own, full rows edge to edge', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let run = 0; run < 300; run++) {
      const n = 1 + Math.floor(rand() * 14);
      const items = Array.from({ length: n }, (_, i) => ({ key: `k${i}`, value: 1 + Math.floor(rand() * rand() * 120) }));
      const rows = packTiles(items, W, GAP);
      const order = rows.flatMap((r) => r.tiles.map((t) => t.key));
      expect(order).toEqual([...items].sort((a, b) => b.value - a.value).map((i) => i.key));
      for (const r of rows) {
        const units = r.tiles.reduce((s, t) => s + t.units, 0);
        expect(units).toBeLessThanOrEqual(TILE_UNITS);
        for (const t of r.tiles) {
          const own = t.size === 'small' ? 2 : t.size === 'mid' ? 3 : t.units >= 6 ? 6 : 3;
          expect(t.units).toBeLessThanOrEqual(own * 2);
        }
        const last = r.tiles[r.tiles.length - 1]!;
        if (units === TILE_UNITS) expect(last.x + last.w).toBeCloseTo(W, 6);
        else expect(last.x + last.w).toBeLessThan(W);
      }
      expect(rowsHeight(rows, GAP)).toBe(rows.reduce((s, r) => s + r.h, 0) + GAP * Math.max(0, rows.length - 1));
    }
  });
});

describe('bubbles sized by use', () => {
  const O = { rMax: 84, rMin: 26, gap: 6, squash: 1.35 };

  test('area goes with sessions above the floor, and the floor keeps a mark carried', () => {
    expect(bubbleRadius(115, 115, O)).toBe(84);
    expect(bubbleRadius(115 / 4, 115, O)).toBeCloseTo(42, 6);
    expect(bubbleRadius(1, 115, O)).toBe(26);
  });

  test('the live top ten: none overlaps, none leaves the width, and the same values draw the same cloud', () => {
    const s = body(LIVE);
    const items = s.top.map((t) => ({ key: t.id, value: t.sessions }));
    const a = packBubbles(items, 362, O);
    const b = packBubbles(items, 362, O);
    expect(a).toEqual(b);
    expect(a.bubbles.map((x) => x.key)).toEqual(s.top.map((t) => t.id));
    for (const x of a.bubbles) {
      expect(x.x - x.r).toBeGreaterThanOrEqual(-0.01);
      expect(x.x + x.r).toBeLessThanOrEqual(362.01);
      expect(x.y - x.r).toBeGreaterThanOrEqual(-0.01);
      expect(x.y + x.r).toBeLessThanOrEqual(a.height + 0.01);
    }
    for (let i = 0; i < a.bubbles.length; i++) {
      for (let j = i + 1; j < a.bubbles.length; j++) {
        const p = a.bubbles[i]!;
        const q = a.bubbles[j]!;
        expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThanOrEqual(p.r + q.r + O.gap - 0.02);
      }
    }
    // A cloud, not a column: it is no taller than it is wide.
    expect(a.height).toBeLessThanOrEqual(362 * 1.1);
  });

  test('over many shapes, and a narrow phone', () => {
    let seed = 11;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let run = 0; run < 120; run++) {
      const width = 300 + Math.floor(rand() * 140);
      const n = 1 + Math.floor(rand() * 10);
      const items = Array.from({ length: n }, (_, i) => ({ key: `k${i}`, value: 1 + Math.floor(rand() * 200) }));
      const { bubbles } = packBubbles(items, width, { ...O, rMax: Math.min(84, Math.round(width * 0.235)) });
      expect(bubbles.length).toBe(n);
      for (let i = 0; i < bubbles.length; i++) {
        expect(bubbles[i]!.x - bubbles[i]!.r).toBeGreaterThanOrEqual(-0.01);
        expect(bubbles[i]!.x + bubbles[i]!.r).toBeLessThanOrEqual(width + 0.01);
        for (let j = i + 1; j < bubbles.length; j++) {
          const p = bubbles[i]!;
          const q = bubbles[j]!;
          expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThanOrEqual(p.r + q.r + O.gap - 0.02);
        }
      }
    }
  });
});

describe('a band’s printed row', () => {
  test('marks wrap at the width, whole marks only', () => {
    const { slots, height } = wrapMarks(12, 30, 14, 322);
    // Seven 30 pt marks and six 14 pt gaps are 294 pt; an eighth would need 338.
    expect(slots.slice(0, 7).every((s) => s.y === 0)).toBe(true);
    expect(slots[6]!.x + 30).toBe(294);
    expect(slots[7]).toEqual({ x: 0, y: 44 });
    expect(height).toBe(74);
    expect(wrapMarks(0, 30, 14, 322)).toEqual({ slots: [], height: 0 });
  });
});

// ------------------------------------------------------------------ the code

describe('the stack components hold to the house', () => {
  const dir = join(MOBILE, 'src/stack');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => ({ name: `src/stack/${f}`, src: readFileSync(join(dir, f), 'utf8') }));
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

  test('no hard coded colour, gradient, emoji, kit card or chevron: colour comes from the tokens and the brands', () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const f of files) {
      const c = code(f.src);
      expect({
        file: f.name,
        hex: c.match(/['"]#[0-9a-fA-F]{3,8}['"]/g) ?? [],
        gradient: /Gradient\b/.test(c),
        emoji: /\p{Extended_Pictographic}/u.test(f.src),
        kit: /<(Surface|Row|StatGrid|Stat)\b/.test(c),
        chevron: /chevron/i.test(c),
      }).toEqual({ file: f.name, hex: [], gradient: false, emoji: false, kit: false, chevron: false });
    }
  });

  test('an animated style, reaction or frame callback calls only worklets', () => {
    // `measure` and `createPicture` are Reanimated's and Skia's own UI thread functions.
    const WORKLETS = new Set(['ease', 'phase', 'spring', 'eased', 'sprung', 'formatWith', 'runOnJS', 'measure', 'createPicture']);
    let bodies = 0;
    for (const f of files) {
      const c = code(f.src);
      for (const m of c.matchAll(/\buse(?:AnimatedStyle|AnimatedReaction|DerivedValue|AnimatedProps|FrameCallback|AnimatedScrollHandler)\(/g)) {
        let depth = 1;
        let i = m.index! + m[0].length;
        const start = i;
        for (; i < c.length && depth > 0; i++) {
          if (c[i] === '(') depth++;
          else if (c[i] === ')') depth--;
        }
        bodies++;
        for (const call of c.slice(start, i - 1).matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
          const name = call[1]!;
          if (['if', 'for', 'while', 'return', 'switch'].includes(name)) continue;
          expect({ file: f.name, name, worklet: WORKLETS.has(name) }).toEqual({ file: f.name, name, worklet: true });
        }
      }
    }
    expect(bodies).toBeGreaterThanOrEqual(4);
  });

  test('a worklet helper written here is defined before anything that calls it (worklets are not hoisted)', () => {
    for (const f of [...files, { name: 'src/stack/layout.ts', src: readFileSync(join(dir, 'layout.ts'), 'utf8') }]) {
      const c = code(f.src);
      for (const m of c.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)[^{]*\{\s*'worklet'/g)) {
        const first = c.search(new RegExp(`\\b${m[1]}\\s*\\(`));
        expect({ file: f.name, fn: m[1], definedFirst: first >= m.index! }).toEqual({ file: f.name, fn: m[1], definedFirst: true });
      }
    }
  });

  test('no dash in anything the components say', () => {
    for (const f of files) {
      const c = code(f.src).replace(/^import .*$/gm, '');
      for (const m of c.matchAll(/(['"`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)) expect({ file: f.name, s: m[2], dash: hasDash(m[2]!) }).toEqual({ file: f.name, s: m[2], dash: false });
    }
  });

  test('the react-bits the page is built from are used, visibly', () => {
    const all = files.map((f) => code(f.src)).join('\n');
    for (const part of ['<LogoLoop', '<PixelCard', '<ClickSpark', '<SparkBurst', '<Band ', '<BandFigure', '<Num ', '<GrowBar', '<CreaturePrint']) {
      expect({ part, used: all.includes(part) }).toEqual({ part, used: true });
    }
  });
});
