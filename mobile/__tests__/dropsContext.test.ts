import { describe, expect, test } from 'bun:test';

import { CONTEXT_FLOOR, CONTEXT_MAX, relatedDrops, sharedLine } from '../src/drops/context';
import type { DropRow } from '../src/drops/types';

function drop(id: string, kind: DropRow['kind'], title: string, summary: string, tags: string[] = []): DropRow {
  return {
    id,
    url: `https://www.youtube.com/watch?v=${id}`,
    platform: 'youtube',
    status: 'planned',
    kind,
    title,
    summary,
    thumbnail_url: null,
    refusal: null,
    resolution: { plan: { tags } } as unknown as DropRow['resolution'],
    created_at: '2026-09-18T10:00:00Z',
    resolved_at: null,
    archived_at: null,
  };
}

// The real board's shape: two editor reels, two skills reels, recipes, an unread one.
const board: DropRow[] = [
  drop('vs1', 'technique', 'Top 5 VS Code Productivity Tips Marathon', 'Keyboard shortcuts and multi cursor editing in VS Code.', ['vs-code', 'shortcuts', 'productivity']),
  drop('vs2', 'technique', '25 VS Code Productivity Tips and Speed Hacks', 'Remote repositories and command palette tricks.', ['vs-code', 'productivity']),
  drop('sk1', 'skill', 'Claude Code Skills', 'A ten minute breakdown of how Claude Code skills work and how to build custom ones.', ['claude-code', 'skills']),
  drop('rc1', 'recipe', 'Garlic Butter Noodles', 'Fifteen minute noodles with garlic butter.', ['garlic', 'noodles']),
  drop('uk1', 'unknown', 'Pet name scramble game post', 'A pet name game.', []),
];

const editorSession = {
  headline: 'Rebound VS Code shortcuts and tried remote repositories',
  summary: 'Set up keyboard shortcuts in VS Code and opened a repo remotely.',
  highlights: ['Bound double shift to the command palette'],
  growth_edge: ['Try multi cursor editing next time'],
  tags: ['vs-code', 'shortcuts', 'productivity'],
};

const unrelatedSession = {
  headline: 'Agent audited in-flight work and added mutation-tested tests',
  summary: 'Added tests for the auth routes and chased a Swift drift for most of the session.',
  highlights: ['38 minutes, 30 of them on the Swift drift'],
  growth_edge: ['Replace work with a ranked goal'],
  tags: ['mutation-testing', 'auth', 'rls', 'pytest', 'swift'],
};

describe('reels as context: a session\'s page shows the reels you saved about it', () => {
  test('the editor reels come up for the editor session, strongest first, with the words that tie them', () => {
    const r = relatedDrops(editorSession, board);
    expect(r.map((x) => x.drop.id)).toEqual(['vs1', 'vs2']);
    expect(r[0]!.score).toBeGreaterThan(r[1]!.score);
    expect(r[0]!.shared).toContain('shortcuts');
    expect(sharedLine(r[0]!)).toMatch(/^you both talk about /);
  });

  test('a session about something else gets nothing, not the least bad match', () => {
    expect(relatedDrops(unrelatedSession, board)).toEqual([]);
  });

  test('a recipe and an unread drop are never about a session', () => {
    const cooking = { ...editorSession, headline: 'Garlic butter noodles', summary: 'noodles garlic butter', tags: ['garlic', 'noodles'] };
    expect(relatedDrops(cooking, board).map((x) => x.drop.id)).not.toContain('rc1');
    expect(relatedDrops({ ...editorSession, tags: ['pet', 'name', 'game'] }, board).map((x) => x.drop.id)).not.toContain('uk1');
  });

  test('no analysis, no shelf; never more than the cap; archived and unplanned drops are out', () => {
    expect(relatedDrops(null, board)).toEqual([]);
    const many = Array.from({ length: 8 }, (_, i) => drop(`v${i}`, 'technique', `VS Code shortcuts ${i}`, 'shortcuts productivity vs code', ['shortcuts']));
    expect(relatedDrops(editorSession, many).length).toBeLessThanOrEqual(CONTEXT_MAX);
    const archived = { ...board[0]!, archived_at: '2026-09-18T00:00:00Z' };
    const waiting = { ...board[1]!, status: 'waiting' as const };
    expect(relatedDrops(editorSession, [archived, waiting])).toEqual([]);
  });

  test('the floor sits between the coincidences and the real matches measured on the real board', () => {
    expect(CONTEXT_FLOOR).toBeGreaterThan(0.039 * 2);
    expect(CONTEXT_FLOOR).toBeLessThan(0.225);
  });
});
