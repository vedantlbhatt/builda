/**
 * No sample and no fixture carries the name of one of the owner's real repositories.
 *
 * FOUND IN THE CAPTURE PASS (2026-09-14) and by the demo generator's Vision check: Builda's
 * built in samples drew the owner's own repositories. The sample session's header said
 * "gt-transit" (RideGT's remote), the sample Now grid and mission control showed "builder" and
 * "RideGT" under a line that said they were not the owner's, the dev galleries and the Live
 * Activity fixtures used the same names, and the projects fixture the phone's tests read wrote
 * "RideGT" and "builder" into its sentences. A sample is a picture of the app with nobody's data in
 * it: every name in one is invented ("tramline", "lantern"), and the sample session says it is one
 * in its own name ("tramline (sample)").
 *
 * What is read: every string a sample or fixture file holds (the TypeScript compiler's own string
 * literals and JSX text, so a comment that records where a shape came from is not data), the
 * string literals of the Swift fixtures and the simulator payload script, and every string value
 * in `spec/fixtures`.
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

import { SAMPLE_REPOS } from '../src/live/mission';

const MOBILE = join(import.meta.dir, '..');
const ROOT = join(MOBILE, '..');

/** The owner's repositories as a sample could spell them: RideGT (its remote is gt-transit), and Builda's own, `builder`. */
const REAL: readonly RegExp[] = [
  /ridegt/i,
  /gt[-_ ]?transit/i,
  /vedantlbhatt\/builder/i,
  /builder-overnight/i,
  // `builder` as a repository: the whole string, the head of a meta line ("builder, 2m ago",
  // "builder · today"), or the last segment of a path ("~/src/builder"). Never the word in a
  // sentence ("Which kind of builder are you?") or the app's own `builder://` scheme.
  /^builder(\s*[,·]|$)/i,
  /\/builder\/?$/i,
];

function realName(s: string): RegExp | null {
  const t = s.trim();
  return REAL.find((r) => r.test(t)) ?? null;
}

function walk(dir: string, keep: (path: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, keep, out);
    else if (keep(p)) out.push(p);
  }
  return out;
}

/** A sample or a fixture, by its name, and the two files that hold the app's samples inline. */
const SAMPLE_FILE = /(sample|fixture|gallery)/i;
const INLINE_SAMPLES = ['src/data/client.ts', 'src/live/mission.ts', 'app/debug/live.tsx'].map((p) => join(MOBILE, p));

function tsStrings(path: string): string[] {
  const src = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
    else if (ts.isTemplateExpression(n)) out.push(n.head.text, ...n.templateSpans.map((s) => s.literal.text));
    else if (ts.isJsxText(n)) out.push(n.text);
    ts.forEachChild(n, visit);
  };
  visit(src);
  return out;
}

/** Double quoted string literals outside comments (Swift, and the payload script's Python), docstrings skipped. */
function quotedStrings(path: string): string[] {
  const out: string[] = [];
  let doc = false;
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    const fences = (line.match(/"""/g) ?? []).length;
    if (doc) {
      if (fences % 2 === 1) doc = false;
      continue;
    }
    if (fences) {
      if (fences % 2 === 1) doc = true;
      continue;
    }
    if (line.startsWith('//') || line.startsWith('#')) continue;
    for (const m of line.matchAll(/"((?:[^"\\]|\\.)*)"/g)) out.push(m[1]!);
  }
  return out;
}

function jsonStrings(path: string): string[] {
  const out: string[] = [];
  const visit = (v: unknown) => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === 'object') Object.values(v as Record<string, unknown>).forEach(visit);
  };
  try {
    visit(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    // Not JSON (a JSONL or a binary); nothing here reads it as a sample.
  }
  return out;
}

function hits(files: string[], read: (p: string) => string[]): string[] {
  const found: string[] = [];
  for (const f of files) {
    for (const s of read(f)) {
      const r = realName(s);
      if (r) found.push(`${relative(ROOT, f)}: "${s.slice(0, 80)}" (${r})`);
    }
  }
  return found;
}

describe('a sample carries invented names only', () => {
  test('the rule catches the names the capture found, and not the words that only look like them', () => {
    for (const s of ['RideGT', 'gt-transit', 'builder', 'builder, 2m ago', 'builder · today', '~/src/builder', 'github.com/vedantlbhatt/builder']) expect(realName(s)).not.toBeNull();
    for (const s of ['tramline', 'lantern', 'Which kind of builder are you?', 'builder://session/sample', 'builder_type', 'tramline (sample)']) expect(realName(s)).toBeNull();
  });

  test('the phone\'s sample and fixture files hold no real repository name', () => {
    const files = [...walk(join(MOBILE, 'src'), (p) => /\.tsx?$/.test(p) && SAMPLE_FILE.test(p)), ...walk(join(MOBILE, 'app'), (p) => /\.tsx?$/.test(p) && SAMPLE_FILE.test(p)), ...INLINE_SAMPLES];
    expect(files.length).toBeGreaterThan(8);
    expect(hits(files, tsStrings)).toEqual([]);
  });

  test('the JSON fixtures the phone reads, the Live Activity fixtures and the simulator payloads hold none', () => {
    const json = [...walk(join(MOBILE, 'src'), (p) => p.endsWith('.json') && SAMPLE_FILE.test(p)), ...walk(join(ROOT, 'spec', 'fixtures'), (p) => p.endsWith('.json'))];
    expect(json.length).toBeGreaterThan(5);
    expect(hits(json, jsonStrings)).toEqual([]);
    const quoted = [...walk(join(MOBILE, 'targets'), (p) => p.endsWith('.swift') && SAMPLE_FILE.test(p)), ...walk(join(MOBILE, 'scripts', 'sim'), (p) => p.endsWith('.py'))];
    expect(quoted.length).toBeGreaterThan(1);
    expect(hits(quoted, quotedStrings)).toEqual([]);
  });

  test('the sample session says it is one in its own name, and the sample grid\'s names are invented', () => {
    // Read from the source: another suite replaces `data/client` with a stub for the whole run.
    const client = readFileSync(join(MOBILE, 'src', 'data', 'client.ts'), 'utf8');
    const name = /export const SAMPLE_REPO_NAME = '([^']+)'/.exec(client)?.[1] ?? '';
    expect(name).toMatch(/\(sample\)$/);
    expect(client).toContain('repo_name: SAMPLE_REPO_NAME');
    for (const n of [name, ...Object.values(SAMPLE_REPOS)]) expect(realName(n)).toBeNull();
  });
});
