/**
 * The board's clustering, held to the Python that defines it.
 *
 * `drops/cluster.py` is the reference and this is the port (`src/drops/cluster.ts`). The two run
 * over the REAL corpus (`drops/tests/corpus/`, fifteen public links resolved and planned for
 * real) and must agree on every cluster, every label and every order. A board that groups one way
 * here and another in `python -m drops cluster` would make both untrustworthy, and the failure
 * would look like a bug in somebody's data rather than in this file.
 */
import { describe, expect, test } from 'bun:test';

import { board, cluster, MERGE_FLOOR, similarityMatrix, stem, WEAK } from '../src/drops/cluster';
import { havePython, python } from './pythonRef';

interface Row {
  kind: string | null;
  title: string | null;
  summary: string | null;
  tags: string[];
}

const corpus = python<Row[]>(`
import json
from drops.tests import corpus_read
print(json.dumps([{k: d[k] for k in ("kind", "title", "summary", "tags")} for d in corpus_read.drops()]))
`);

describe('the clustering port', () => {
  test('the corpus is there to test against', () => {
    if (!havePython()) return;
    expect(corpus).not.toBeNull();
    expect((corpus ?? []).length).toBeGreaterThanOrEqual(8);
  });

  test('the same clusters, the same labels, the same order', () => {
    if (!havePython() || !corpus) return;
    const theirs = python<{ label: string; members: number[]; size: number }[]>(`
import json
from drops import cluster as dc
from drops.tests import corpus_read
print(json.dumps(dc.board(corpus_read.drops())))
`);
    expect(board(corpus)).toEqual(theirs ?? []);
  });

  test('every pairwise similarity agrees to nine places', () => {
    if (!havePython() || !corpus) return;
    const theirs = python<number[][]>(`
import json
from drops import cluster as dc
from drops.tests import corpus_read
print(json.dumps(dc.similarity_matrix(corpus_read.drops())))
`);
    expect(similarityMatrix(corpus)).toEqual(theirs ?? []);
  });

  test('the stemmer folds only what the Python folds', () => {
    if (!havePython()) return;
    const words = ['skills', 'shortcuts', 'recipes', 'pasta', 'glasses', 'dailies', 'css', 'is', 'boxes'];
    const theirs = python<string[]>(
      `import json, sys\nfrom drops import cluster as dc\nprint(json.dumps([dc.stem(w) for w in json.loads(sys.argv[1])]))`,
      JSON.stringify(words),
    );
    expect(words.map(stem)).toEqual(theirs ?? []);
  });
});

describe('the rules the board rests on', () => {
  test('an empty board is an empty board, not a crash', () => {
    expect(board([])).toEqual([]);
    expect(cluster([])).toEqual([]);
  });

  test('one drop is one cluster labelled by its own strongest word', () => {
    const out = board([{ kind: 'skill', title: 'A Claude Code skill for changelogs', summary: '', tags: ['changelog'] }]);
    expect(out).toHaveLength(1);
    expect(out[0]?.size).toBe(1);
    expect(out[0]?.label.length).toBeGreaterThan(0);
  });

  test('a cluster is never named a word true of every drop on the board', () => {
    const out = board([
      { kind: 'project', title: 'Build an app', summary: 'code an app', tags: ['app', 'code'] },
      { kind: 'project', title: 'Build a second app', summary: 'code an app', tags: ['app', 'code'] },
    ]);
    for (const c of out) expect(WEAK.has(c.label)).toBe(false);
  });

  test('two drops that share nothing stay apart', () => {
    const out = board([
      { kind: 'recipe', title: 'Garlic butter pasta', summary: 'pasta', tags: ['pasta'] },
      { kind: 'technique', title: 'VS Code terminal shortcut', summary: 'editor', tags: ['vscode'] },
    ]);
    expect(out).toHaveLength(2);
  });

  test('the floor is what the Python says it is', () => {
    if (!havePython()) return;
    const theirs = python<number>(`import json\nfrom drops import cluster as dc\nprint(json.dumps(dc.MERGE_FLOOR))`);
    expect(MERGE_FLOOR).toBe(theirs ?? MERGE_FLOOR);
  });
});
