/**
 * The board's read cadence and its Start answer, held to what a review found (2026-09-19): one
 * failed read while a move ran ended the polling for good, and a Start the server refused was
 * announced as "Sent to your Mac".
 */
import { describe, expect, test } from 'bun:test';

import { BUSY_POLL_MS, FAILED_POLL_MS, pollDelay, startEach, startLine } from '../src/drops/boardRules';
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
