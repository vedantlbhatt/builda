/**
 * The design system's integrity: what design/tokens.json says, what `colors()` exposes, and
 * that the kit in src/ui actually obeys it. The last group reads the kit's SOURCE, because
 * "every radius comes from the scale" and "no hex outside tokens.json" are properties of the
 * code, not of any value a test could call.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { tokens } from '../src/generated/tokens';
import { colors, floatShadow, layout, radius, space, typeRoles } from '../src/theme';
import { DASHED_FRAME_RADIUS, RADIUS_SCALE, SHAPE, concentric } from '../src/ui/shape';

// ─── contrast, WCAG 2.x ────────────────────────────────────────────────────────────────

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

describe('tokens: the section 3 additions', () => {
  test('raised and textFaint exist in both schemes with the doc values', () => {
    expect(tokens.surface.raised).toEqual({ light: '#F3EFE7', dark: '#282420' });
    expect(tokens.surface.textFaint).toEqual({ light: '#A8A29A', dark: '#6B655D' });
    expect(tokens.surface.accentPressed.dark).toBe('#E0A300');
  });

  test('the data hues: add and del, light and dark', () => {
    expect(tokens.data.add).toEqual({ light: '#2B7F3A', dark: '#7BC96F' });
    expect(tokens.data.del).toEqual({ light: '#C62A2F', dark: '#E5484D' });
  });

  test('the radius scale is 6 12 18 28 pill, and the export radius stays separate', () => {
    expect(RADIUS_SCALE).toEqual([6, 12, 18, 28, 999]);
    expect(radius.card).toBe(24);
  });

  test('the space scale is 4 8 12 16 24 32 40 64 and nothing else', () => {
    expect(Object.values(space)).toEqual([4, 8, 12, 16, 24, 32, 40, 64]);
    // The names every existing screen already uses keep their values.
    expect([space.xs, space.sm, space.md, space.lg, space.xl, space.xxl]).toEqual([4, 8, 16, 24, 40, 64]);
    expect(layout).toMatchObject({ gutter: 16, tileGap: 12, sectionGap: 32, tilePad: 14 });
  });

  test('the nine type roles, with the doc numbers', () => {
    expect(Object.keys(typeRoles)).toEqual(['hero', 'display', 'title', 'headline', 'body', 'row', 'meta', 'label', 'mono']);
    const spec = Object.fromEntries(
      Object.entries(typeRoles).map(([k, r]) => [k, [r.size, r.weight, r.tracking, r.line]]),
    );
    expect(spec).toEqual({
      hero: [56, 800, -1.5, 1.0],
      display: [40, 800, -0.8, 1.05],
      title: [22, 700, -0.3, 1.2],
      headline: [17, 600, -0.2, 1.25],
      body: [17, 400, -0.2, 1.35],
      row: [15, 600, 0, 1.3],
      meta: [13, 400, 0, 1.3],
      label: [12, 600, 0.2, 1.2],
      mono: [13, 500, 0, 1.3],
    });
    for (const r of Object.values(typeRoles)) expect(r.size).toBeGreaterThanOrEqual(11);
    expect(typeRoles.mono.design).toBe('monospaced');
  });

  test('exactly one shadow token, and it is the doc string', () => {
    expect(Object.keys(tokens.shadow)).toEqual(['float']);
    expect(floatShadow).toBe('0 12px 32px rgba(0,0,0,0.5)');
  });
});

describe('colors(scheme): new tokens, old call sites unchanged', () => {
  test('exposes raised, textFaint, accentPressed and the three data hues', () => {
    const d = colors('dark');
    expect(d.raised).toBe('#282420');
    expect(d.textFaint).toBe('#6B655D');
    expect(d.accentPressed).toBe('#E0A300');
    expect(d.data).toEqual({ human: '#19C4B0', add: '#7BC96F', del: '#E5484D' });
    expect(colors('light').data).toEqual({ human: '#0E9F8E', add: '#2B7F3A', del: '#C62A2F' });
  });

  test('every value an existing screen reads is what it was', () => {
    const d = colors('dark');
    expect([d.bg, d.card, d.border, d.text, d.textDim, d.accent]).toEqual([
      '#141210',
      '#1E1B18',
      '#2F2B27',
      '#F5F1EA',
      '#A8A29A',
      '#FFB300',
    ]);
    expect(d.onAccent).toBe('#1C1917');
    // DANGER moved into tokens.json as the del hue; the dark value is the old constant.
    expect(d.danger).toBe('#E5484D');
    expect(d.danger).toBe(d.data.del);
  });
});

describe('contrast: the claims the doc makes are true', () => {
  for (const scheme of ['dark', 'light'] as const) {
    const c = colors(scheme);
    test(`${scheme}: text 7:1, textDim 4.5:1, add and del 4.5:1 on the canvas`, () => {
      expect(contrast(c.text, c.bg)).toBeGreaterThanOrEqual(7);
      expect(contrast(c.textDim, c.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.data.add, c.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c.data.del, c.bg)).toBeGreaterThanOrEqual(4.5);
    });
    test(`${scheme}: textFaint is decoration only (under 4.5:1)`, () => {
      expect(contrast(c.textFaint, c.bg)).toBeLessThan(4.5);
    });
  }

  test('ink on amber is legible; amber as text on light is not (it is a fill there)', () => {
    const d = colors('dark');
    expect(contrast(d.onAccent, d.accent)).toBeGreaterThanOrEqual(7);
    expect(contrast(d.accent, d.bg)).toBeGreaterThanOrEqual(7);
    expect(contrast(colors('light').accent, colors('light').bg)).toBeLessThan(3);
  });

  test('every grey is warm: red >= green >= blue, both schemes', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const c = colors(scheme);
      for (const hex of [c.bg, c.card, c.raised, c.border, c.text, c.textDim, c.textFaint]) {
        const [r, g, b] = rgb(hex);
        expect(r >= g && g >= b).toBe(true);
      }
    }
  });

  test('the add green is far from the human teal (never read as one colour)', () => {
    const hue = (hex: string) => {
      const [r, g, b] = rgb(hex).map((v) => v / 255) as [number, number, number];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const d = max - min;
      const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return (h * 60 + 360) % 360;
    };
    const d = colors('dark');
    expect(Math.abs(hue(d.data.human) - hue(d.data.add))).toBeGreaterThan(45);
  });
});

describe('shape: every radius the kit uses is on the scale', () => {
  test('SHAPE is drawn from the scale only', () => {
    for (const v of Object.values(SHAPE)) expect(RADIUS_SCALE).toContain(v);
    expect(SHAPE).toEqual({ action: 999, container: 18, inner: 12, mark: 6, wrapped: 28 });
  });

  test('concentric corners: container minus the mark is the inner radius', () => {
    expect(concentric(SHAPE.container, SHAPE.mark)).toBe(SHAPE.inner);
    // The Wrapped card's dashed outline is derived, not chosen.
    expect(DASHED_FRAME_RADIUS).toBe(concentric(SHAPE.wrapped, space.sm));
    expect(DASHED_FRAME_RADIUS).toBe(20);
  });
});

// ─── the kit's source ─────────────────────────────────────────────────────────────────

const UI = join(import.meta.dir, '..', 'src', 'ui');
const files = readdirSync(UI)
  .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
  .map((f) => ({ name: f, src: readFileSync(join(UI, f), 'utf8') }));

/** Source with comments removed, so a rule is checked against code, not prose. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

/** String literals and JSX text: everything a person could read on screen. */
function visibleStrings(src: string): string[] {
  const c = code(src);
  const out: string[] = [];
  // Single-line literals only: a multi-line template is code (the SkSL), not copy.
  for (const m of c.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\\n]|\\.)*)`/g)) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '');
  }
  // JSX text: after a tag's closing `>` (not `=>`, `>=` or `->`), up to the next `<`.
  for (const m of c.matchAll(/(?<![=\-!<>])>(?![=>])([^<>{};]+)</g)) out.push(m[1] ?? '');
  return out;
}

describe('the kit obeys the tokens (static checks on src/ui)', () => {
  test('there is a kit to check', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  test('no radius literal: every borderRadius comes from SHAPE or the radius scale', () => {
    for (const f of files) {
      for (const m of code(f.src).matchAll(/borderRadius:\s*([^,}\n]+)/g)) {
        const expr = (m[1] ?? '').trim();
        expect({ file: f.name, expr, ok: /^(SHAPE[.[]|radius\.|tokens\.radius\.)/.test(expr) }).toEqual({
          file: f.name,
          expr,
          ok: true,
        });
      }
    }
  });

  test('every rounded rectangle is continuous', () => {
    for (const f of files) {
      const c = code(f.src);
      const radii = (c.match(/borderRadius:/g) ?? []).length;
      const curves = (c.match(/borderCurve:\s*'continuous'/g) ?? []).length;
      expect({ file: f.name, radii, curves }).toEqual({ file: f.name, radii, curves: radii });
    }
  });

  test('no colour literal: colours come from tokens.json through theme.ts', () => {
    for (const f of files) {
      const hits = code(f.src).match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\(/g) ?? [];
      expect({ file: f.name, hits }).toEqual({ file: f.name, hits: [] });
    }
  });

  test('no gradients: no gradient shader or component anywhere in the kit', () => {
    for (const f of files) {
      expect({ file: f.name, gradient: /Gradient\b/.test(code(f.src)) }).toEqual({ file: f.name, gradient: false });
    }
  });

  test('no emoji in the kit', () => {
    for (const f of files) {
      expect({ file: f.name, emoji: /\p{Extended_Pictographic}/u.test(f.src) }).toEqual({ file: f.name, emoji: false });
    }
  });

  test('no dashes in anything a person reads: no em dash, en dash or spaced hyphen', () => {
    for (const f of files) {
      const bad = visibleStrings(f.src).filter((s) => /[—–]|\s-\s/.test(s));
      expect({ file: f.name, bad }).toEqual({ file: f.name, bad: [] });
    }
  });

  test('no off-scale spacing literal in the kit', () => {
    const allowed = new Set<number>([0, ...Object.values(space), ...Object.values(layout)]);
    for (const f of files) {
      for (const m of code(f.src).matchAll(/\b(gap|padding(?:Horizontal|Vertical|Top|Bottom|Left|Right)?|margin(?:Horizontal|Vertical|Top|Bottom|Left|Right)?):\s*(\d+(?:\.\d+)?)\b/g)) {
        const v = Number(m[2]);
        expect({ file: f.name, prop: m[1], v, ok: allowed.has(v) }).toEqual({ file: f.name, prop: m[1], v, ok: true });
      }
    }
  });
});
