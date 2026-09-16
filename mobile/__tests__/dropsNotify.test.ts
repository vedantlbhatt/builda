/**
 * What a drop's banner says, held to the server that sends the same one.
 *
 * Two senders: the server pushes when your Mac reads a link while the phone is in a pocket, the
 * phone posts a local one when it is the thing watching. Two copies of a sentence is a sentence
 * that will drift, so both run over the same table here and any difference fails, the way the
 * strip and the clustering are held.
 *
 * And the rule that matters more than the words: WHAT COUNTS AS NEWS. A drop appearing does not
 * (you shared it), a move starting does not (you tapped it), a re-read does not (the content
 * moved, the fact that it has been read did not).
 */
import { describe, expect, test } from 'bun:test';

import { CATALOG, collapseId, composeFinished, composeRead, dropUrl, trim } from '../src/drops/notifyCopy';
import { worthSaying } from '../src/drops/news';
import { havePython, python } from './pythonRef';

const READ_CASES = [
  { title: '5 beginner Claude Skills to install', kind: 'skill', refusal: null, moves: 1 },
  { title: 'Garlic Butter Pasta', kind: 'recipe', refusal: null, moves: 2 },
  { title: 'Top 5 VS Code Productivity Tips', kind: 'technique', refusal: null, moves: 5 },
  { title: 'Pet name scramble game post', kind: 'unknown', refusal: null, moves: 0 },
  { title: null, kind: null, refusal: 'private_or_gone', moves: 0 },
  { title: '   ', kind: 'tool', refusal: null, moves: 0 },
  ...CATALOG.refusals.map((r) => ({ title: 'x', kind: 'unknown', refusal: r, moves: 0 })),
  ...CATALOG.kinds.map((k) => ({ title: 'A drop', kind: k, refusal: null, moves: 3 })),
];

const FINISHED_CASES = [
  { title: 'Get the full recipe', outcome: '7 ingredients and 4 steps, from littlesunnykitchen.com', ok: true },
  { title: 'Find the 5 skills', outcome: null, ok: true },
  { title: 'Install it', outcome: null, ok: false },
  { title: '  ', outcome: 'done anyway', ok: true },
  { title: '  ', outcome: null, ok: false },
  {
    title: 'Find the 5 skills',
    outcome:
      'Wrote SKILLS.md. The drop only contained the video title, no transcript and no on screen list of which five skills it means, so I could not honestly name or evaluate specific skills without inventing them, which would be fiction with a confident title.',
    ok: true,
  },
];

describe('the words, both senders', () => {
  test('a read banner is the same sentence on both sides', () => {
    if (!havePython()) return;
    const theirs = python<[string, string][]>(
      `import json, sys
sys.path.insert(0, "server")
from builder import drops_notify as dn
print(json.dumps([list(dn.compose_read(title=c["title"], kind=c["kind"], refusal=c["refusal"], moves=c["moves"])) for c in json.loads(sys.argv[1])]))`,
      JSON.stringify(READ_CASES),
    );
    expect(READ_CASES.map((c) => { const o = composeRead(c); return [o.title, o.body]; })).toEqual(theirs ?? []);
  });

  test('a finished banner is the same sentence on both sides', () => {
    if (!havePython()) return;
    const theirs = python<[string, string][]>(
      `import json, sys
sys.path.insert(0, "server")
from builder import drops_notify as dn
print(json.dumps([list(dn.compose_finished(title=c["title"], outcome=c["outcome"], ok=c["ok"])) for c in json.loads(sys.argv[1])]))`,
      JSON.stringify(FINISHED_CASES),
    );
    expect(FINISHED_CASES.map((c) => { const o = composeFinished(c); return [o.title, o.body]; })).toEqual(theirs ?? []);
  });

  test('the collapse id and the deep link agree, so the two replace each other', () => {
    if (!havePython()) return;
    const ids = ['abc-123', 'a'.repeat(80)];
    const theirs = python<[string, string][]>(
      `import json, sys
sys.path.insert(0, "server")
from builder import drops_notify as dn
print(json.dumps([[dn.collapse_id(i), dn.drop_url(i)] for i in json.loads(sys.argv[1])]))`,
      JSON.stringify(ids),
    );
    expect(ids.map((i) => [collapseId(i), dropUrl(i)])).toEqual(theirs ?? []);
  });

  test('every kind and every refusal has a sentence', () => {
    for (const k of CATALOG.kinds) {
      expect(composeRead({ title: 'x', kind: k, refusal: null, moves: 1 }).body.length).toBeGreaterThan(0);
    }
    for (const r of CATALOG.refusals) {
      expect(composeRead({ title: 'x', kind: 'unknown', refusal: r, moves: 0 }).body).not.toBe('Nothing came back.');
    }
  });

  test('no banner carries a dash', () => {
    const all = [
      ...READ_CASES.map((c) => composeRead(c)),
      ...FINISHED_CASES.map((c) => composeFinished(c)),
    ].flatMap((o) => [o.title, o.body]);
    for (const s of all) expect(s).not.toMatch(/[—–―−]|\s-{1,2}\s/);
  });

  test('a long sentence is trimmed on a word', () => {
    const out = trim('one two three four five six seven eight nine ten', 20);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(21);
    expect(out).not.toContain('  ');
    expect(trim('short', 20)).toBe('short');
  });
});

describe('what counts as news', () => {
  const drop = (id: string, status: string) => ({ id, status }) as never;
  const move = (id: string, drop_id: string, status: string) => ({ id, drop_id, status }) as never;

  test('the first board says nothing at all', () => {
    const after = { drops: [drop('a', 'planned')], moves: [] };
    expect(worthSaying(null, after)).toEqual({ read: [], finished: [] });
  });

  test('a drop being read is news', () => {
    const before = { drops: [drop('a', 'waiting')], moves: [] };
    const after = { drops: [drop('a', 'planned')], moves: [] };
    expect(worthSaying(before, after).read.map((d) => d.id)).toEqual(['a']);
  });

  test('a refusal is news too', () => {
    const before = { drops: [drop('a', 'resolving')], moves: [] };
    const after = { drops: [drop('a', 'refused')], moves: [] };
    expect(worthSaying(before, after).read.map((d) => d.id)).toEqual(['a']);
  });

  test('a re-read is not news', () => {
    const before = { drops: [drop('a', 'planned')], moves: [] };
    const after = { drops: [drop('a', 'planned')], moves: [] };
    expect(worthSaying(before, after).read).toEqual([]);
  });

  test('a drop appearing is not news: you shared it', () => {
    const before = { drops: [], moves: [] };
    const after = { drops: [drop('a', 'planned')], moves: [] };
    expect(worthSaying(before, after).read).toEqual([]);
  });

  test('a move finishing is news; queuing and starting are not', () => {
    const before = { drops: [], moves: [move('m', 'a', 'offered')] };
    const queued = { drops: [], moves: [move('m', 'a', 'queued')] };
    expect(worthSaying(before, queued).finished).toEqual([]);
    const running = { drops: [], moves: [move('m', 'a', 'running')] };
    expect(worthSaying(queued, running).finished).toEqual([]);
    const done = { drops: [], moves: [move('m', 'a', 'done')] };
    expect(worthSaying(running, done).finished.map((m) => m.id)).toEqual(['m']);
  });

  test('a move that failed is news: it is the answer you were waiting for', () => {
    const before = { drops: [], moves: [move('m', 'a', 'running')] };
    const after = { drops: [], moves: [move('m', 'a', 'failed')] };
    expect(worthSaying(before, after).finished.map((m) => m.id)).toEqual(['m']);
  });

  test('a declined move is never news: you declined it', () => {
    const before = { drops: [], moves: [move('m', 'a', 'offered')] };
    const after = { drops: [], moves: [move('m', 'a', 'declined')] };
    expect(worthSaying(before, after).finished).toEqual([]);
  });
});
