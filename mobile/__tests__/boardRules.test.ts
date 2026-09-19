/**
 * The board's read cadence and its Start answer, held to what a review found (2026-09-19): one
 * failed read while a move ran ended the polling for good, and a Start the server refused was
 * announced as "Sent to your Mac".
 */
import { describe, expect, test } from 'bun:test';

import { BUSY_POLL_MS, canStart, FAILED_POLL_MS, pollDelay, startEach, startLine, startTook } from '../src/drops/boardRules';
import type { BoardResponse } from '../src/drops/types';

const board = (drop: string, move: string | null): BoardResponse =>
  ({
    drops: [{ id: 'd1', status: drop }],
    moves: move ? [{ id: 'm1', drop_id: 'd1', status: move }] : [],
  }) as never;

describe('when the board is read again', () => {
  test('a quiet board is not polled', () => {
    expect(pollDelay(board('planned', 'offered'), false)).toBeNull();
    expect(pollDelay(board('planned', 'done'), true)).toBeNull();
  });

  test('a running move is polled, and still polled after a read that failed', () => {
    expect(pollDelay(board('planned', 'running'), false)).toBe(BUSY_POLL_MS);
    expect(pollDelay(board('planned', 'running'), true)).toBe(FAILED_POLL_MS);
    expect(pollDelay(board('waiting', null), true)).toBe(FAILED_POLL_MS);
  });

  test('a failed read backs off rather than hammering', () => {
    expect(FAILED_POLL_MS).toBeGreaterThan(BUSY_POLL_MS);
  });
});

describe('whether a Start went', () => {
  const err = (status: number) => Object.assign(new Error(`server said ${status}`), { status });

  test('every move started: true, and each carries its own repository', async () => {
    const sent: unknown[] = [];
    const went = await startEach(
      async (d, m, body) => void sent.push([d, m, body]),
      'd1',
      ['m1', 'm2'],
      'smaller',
      { m2: 'ab'.repeat(32) },
    );
    expect(went).toBe(true);
    expect(sent).toEqual([
      ['d1', 'm1', { adjustment: 'smaller', repo_key: null }],
      ['d1', 'm2', { adjustment: 'smaller', repo_key: 'ab'.repeat(32) }],
    ]);
  });

  test('already going (409) is not a failure', async () => {
    expect(await startEach(async () => Promise.reject(err(409)), 'd1', ['m1'], null, {})).toBe(true);
  });

  test('a refusal or no network is false, and the other moves are still tried', async () => {
    const tried: string[] = [];
    const went = await startEach(
      async (_d, m) => {
        tried.push(m);
        if (m === 'm1') throw err(500);
      },
      'd1',
      ['m1', 'm2'],
      null,
      {},
    );
    expect(went).toBe(false);
    expect(tried).toEqual(['m1', 'm2']);
    expect(await startEach(async () => Promise.reject(new TypeError('Network request failed')), 'd1', ['m1'], null, {})).toBe(false);
  });
});

describe('what the island says', () => {
  test('from the wall: sent, or not, by name', () => {
    expect(startLine(true, 'Cook the pasta')).toEqual({ text: 'Sent to your Mac: Cook the pasta', state: 'working' });
    expect(startLine(false, 'Cook the pasta')).toEqual({ text: 'Cook the pasta did not reach your Mac. Try it again.', state: 'error' });
  });

  test('from the open sheet: only a failure, which the sheet cannot show', () => {
    expect(startLine(true, null)).toBeNull();
    expect(startLine(false, null)?.state).toBe('error');
  });
});

describe('what a tap may start', () => {
  test('a move never started, or one that failed; nothing in flight, finished or passed on', () => {
    const can = (['offered', 'queued', 'running', 'done', 'failed', 'declined'] as const).filter((status) => canStart({ status }));
    expect(can).toEqual(['offered', 'failed']);
  });

  test('the server takes the same two', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const store = readFileSync(join(import.meta.dir, '../../server/builder/drops_store.py'), 'utf8');
    const start = store.slice(store.indexOf('def start_move'), store.indexOf('def decline_move'));
    expect(start).toContain("status IN ('offered', 'failed')");
  });
});

describe('whether a Start took, from the board after it', () => {
  test('queued, running or already done: it took', () => {
    for (const status of ['queued', 'running', 'done']) expect(startTook(['m1'], board('planned', status))).toBe(true);
  });

  test('still offered or failed after a 409: it did not, and the island says so', () => {
    expect(startTook(['m1'], board('planned', 'failed'))).toBe(false);
    expect(startTook(['m1'], board('planned', 'offered'))).toBe(false);
  });
});
