/**
 * The no dashes rule (brief.md, DESIGN-DIRECTION 9 "Copy"), enforced on the phone.
 *
 * Every string literal, template fragment and piece of JSX text under `app/` and `src/` is
 * read through the TypeScript parser, so a comment is never mistaken for copy and a regex or
 * a `.split('-')` is never mistaken for a dash. What fails is `plain.has_dash`, through the
 * phone's one copy of it (`src/copy/plain.ts`): an em dash, an en dash, a horizontal bar, a
 * U+2212 minus sign, or a hyphen alone between spaces (" - ", " -- "), a dash typed on a
 * keyboard. FOUND IN INTEGRATION (2026-09-13): this test carried a third, two character copy
 * of the rule, so a minus sign in a debug readout passed here while the engine's rule failed it.
 * Generated files are skipped: their text comes from the specs and the generators, which
 * carry their own checks.
 *
 * A failure names `file:line` and the offending text, so the fix is one jump away.
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

import { DASH, DASH_CHARS } from '../src/copy/plain';

const MOBILE = join(import.meta.dir, '..');
const ROOTS = ['app', 'src'];
const SKIP_DIRS = new Set(['generated', 'node_modules']);

/** The dash characters alone, never a spaced hyphen: what a block of code may not carry either. */
const TYPOGRAPHIC_DASH = new RegExp(`[${DASH_CHARS.join('')}]`);

/**
 * A template literal whose own text runs over several source lines is a block of code
 * (the dither shader, the kv migration's SQL, the hook setup's shell), where " - " is
 * subtraction or a shell's stdin argument. It is exempt from the spaced hyphen check only.
 * Copy is never written that way here: JSX wraps prose, and a line break inside a `${}`
 * expression is not a line break in the text.
 */
function isCodeBlock(node: ts.Node, sf: ts.SourceFile): boolean {
  if (!(ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))) {
    return false;
  }
  const raw = (node as ts.TemplateLiteralLikeNode).rawText ?? sf.text.slice(node.getStart(sf), node.end);
  return raw.includes('\n');
}

export interface CopyHit {
  file: string;
  line: number;
  text: string;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIRS.has(name)) out.push(...walk(path));
    } else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts')) {
      out.push(path);
    }
  }
  return out;
}

/** An import or export path is not copy. */
function isModuleSpecifier(node: ts.Node): boolean {
  const p = node.parent;
  if (!p) return false;
  if ((ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) && p.moduleSpecifier === node) return true;
  if (ts.isExternalModuleReference(p)) return true;
  if (ts.isLiteralTypeNode(p) && p.parent && ts.isImportTypeNode(p.parent)) return true;
  if (ts.isCallExpression(p) && (p.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(p.expression) && p.expression.text === 'require'))) {
    return true;
  }
  return false;
}

/**
 * Every dash in the text a person could read, with the line it sits on. Exported for the
 * probe below, which proves the scan can fail.
 */
export function findDashes(fileName: string, source: string): CopyHit[] {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const hits: CopyHit[] = [];

  const report = (node: ts.Node, cooked: string) => {
    const m = (isCodeBlock(node, sf) ? TYPOGRAPHIC_DASH : DASH).exec(cooked);
    if (!m) return;
    // The line of the dash itself when the raw source spells it the same way; a JSX text
    // node starts on the line of the tag before it, and a literal can span lines.
    const start = node.getStart(sf);
    const raw = source.slice(start, node.end);
    const at = raw.indexOf(m[0]);
    const pos = at >= 0 ? start + at : start;
    hits.push({
      file: fileName,
      line: sf.getLineAndCharacterOfPosition(pos).line + 1,
      text: cooked.trim().replace(/\s+/g, ' ').slice(0, 120),
    });
  };

  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!isModuleSpecifier(node)) report(node, node.text);
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      report(node, node.text);
    } else if (ts.isJsxText(node)) {
      report(node, node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

const files = ROOTS.flatMap((r) => walk(join(MOBILE, r)));

describe('the scan itself', () => {
  test('it reads the whole app: every screen and every src module but the generated ones', () => {
    const rel = files.map((f) => relative(MOBILE, f));
    expect(rel.length).toBeGreaterThan(100);
    expect(rel).toContain('app/settings.tsx');
    expect(rel).toContain('src/session/SessionPage.tsx');
    expect(rel.some((f) => f.startsWith('src/generated/'))).toBe(false);
  });

  test('a probe with every banned form fails, and comments, hyphens and minus signs pass', () => {
    const probe = [
      "// a comment — about an em dash, which is prose, not copy",
      '/* and an en dash – in a block comment */',
      "const a = 'Showing saved sessions — offline';",
      'const b = "lines nobody wrote – lockfiles";',
      'const c = `${n} runs - ${m} left`;',
      'const d = <Text>one thing - another</Text>;',
      "const e = 'well-formed and 3-20 characters';",
      "const f = raw.split('-').join(' ');",
      "const g = `+${add} -${del}`;",
      "import x from '../some-module';",
      "const h = 'escaped \\u2014 dash';",
      "const i = '+420 \\u221288 and a bar \\u2015 too';",
      'const sksl = `',
      '  float r = v - w;',
      '`;',
      'const sh = `python3 - <<EOF',
      '— still banned in code`;',
    ].join('\n');
    const lines = findDashes('probe.tsx', probe).map((h) => h.line);
    expect(lines).toEqual([3, 4, 5, 6, 11, 12, 17]);
  });
});

describe('no dashes in anything a person reads (app/ and src/)', () => {
  test('no em dash, en dash or spaced hyphen in a string literal or JSX text', () => {
    const hits = files.flatMap((f) => findDashes(relative(MOBILE, f), readFileSync(f, 'utf8')));
    const lines = hits.map((h) => `${h.file}:${h.line}: ${h.text}`);
    expect(lines).toEqual([]);
  });
});
