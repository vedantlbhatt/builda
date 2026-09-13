/**
 * The harness glyphs (DESIGN-DIRECTION 5): seven tool marks drawn as one family.
 *
 * The owner's complaint was that the icons were complicated and did not match: "the Claude
 * icon literally freaks out ... make all the icons the same thing". Every rule that makes
 * them one family is a number here, so a glyph that drifts louder, off-grid or lopsided is
 * a failing test instead of something that is only visible once it is on a phone. The same
 * arithmetic runs in `scripts/render_pixel_sheet.py --glyphs N`, which draws the sheet.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { GRID, ascii, mirror, validateFrame, type Frame } from '../src/pixel/frames';
import {
  GLYPH_SIZES,
  HARNESSES,
  HARNESS_GLYPHS,
  HARNESS_MARKS,
  HARNESS_NAMES,
  PICKER,
  glyphColor,
  harnessGlyph,
  isGlyphSize,
  isHarness,
  isMarkSelected,
  markFor,
  pickerTileWidth,
  sessionsFor,
  snapGlyphSize,
  statusLine,
  tileWidthInside,
  toggleMark,
  type Harness,
  type HarnessMark,
} from '../src/pixel/harness';
import { harnessInk, harnessTileInks, tileInks } from '../src/pixel/palette';
import { colors, harnessHue, type HueName } from '../src/theme';

/** The 12x12 live area, inclusive, on both axes. */
const LIVE = [2, 13] as const;
/** Every mark's filled cells within this fraction of the set's mean. */
const WEIGHT_BAND = 0.15;
/** Two marks differ by at least this many cells: shape, not the name, tells them apart. */
const DISTINCT_MIN = 24;

type Cell = readonly [x: number, y: number];

function drawn(frame: Frame): Cell[] {
  const out: Cell[] = [];
  frame.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] !== '.') out.push([x, y]);
  });
  return out;
}

function flip(frame: Frame): Frame {
  return [...frame].reverse();
}

function rotate(frame: Frame): Frame {
  return mirror(flip(frame));
}

function bbox(frame: Frame) {
  const cells = drawn(frame);
  const xs = cells.map(([x]) => x);
  const ys = cells.map(([, y]) => y);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

/**
 * Cells in the middle of a one-cell-wide line: two or more drawn neighbours, with both
 * horizontal or both vertical neighbours empty. The creature pack's rule, same definition.
 * A cell with one neighbour is a tip, which a stroke is allowed to end in.
 */
function thinCells(frame: Frame): Cell[] {
  const at = (x: number, y: number) => frame[y]?.[x] !== undefined && frame[y]![x] !== '.';
  return drawn(frame).filter(([x, y]) => {
    const l = at(x - 1, y);
    const r = at(x + 1, y);
    const u = at(x, y - 1);
    const d = at(x, y + 1);
    const n = Number(l) + Number(r) + Number(u) + Number(d);
    return n >= 2 && ((!l && !r) || (!u && !d));
  });
}

function differ(a: Frame, b: Frame): number {
  let n = 0;
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) if ((a[y]![x] !== '.') !== (b[y]![x] !== '.')) n += 1;
  return n;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (hi! + 0.05) / (lo! + 0.05);
}

const sheet = (m: HarnessMark) => `${m.id}\n${ascii(m.frame)}`;

// ─── the wire ────────────────────────────────────────────────────────────────────────

describe('the wire values', () => {
  test('are exactly the harness enum privacy/upload-contract.json declares, in its order', () => {
    // A contract enum value is also a migration (CLAUDE.md), and it is also a glyph: a new
    // harness on the wire must fail here until it has a mark and a name.
    const contract = JSON.parse(readFileSync(join(import.meta.dir, '..', '..', 'privacy', 'upload-contract.json'), 'utf8'));
    const found: string[][] = [];
    const walk = (node: unknown) => {
      if (Array.isArray(node)) node.forEach(walk);
      else if (node && typeof node === 'object') {
        const o = node as Record<string, unknown>;
        if (o.name === 'harness' && o.type === 'enum' && Array.isArray(o.values)) found.push(o.values as string[]);
        Object.values(o).forEach(walk);
      }
    };
    walk(contract);
    expect(found.length).toBeGreaterThan(0);
    const ours: string[] = [...HARNESSES];
    for (const values of found) expect(ours).toEqual(values);
  });

  test('every value has a glyph and a name', () => {
    expect(Object.keys(HARNESS_GLYPHS).sort()).toEqual([...HARNESSES].sort());
    expect(Object.keys(HARNESS_NAMES).sort()).toEqual([...HARNESSES].sort());
  });

  test('names are in the vendor casing', () => {
    expect(HARNESS_NAMES).toEqual({
      claude_code: 'Claude Code',
      cursor_ide: 'Cursor',
      cursor_agent: 'Cursor',
      codex: 'Codex',
      gemini_cli: 'Gemini CLI',
      cline: 'Cline',
      opencode: 'opencode',
      aider: 'Aider',
    });
  });

  test("Cursor's IDE and its CLI are one mark, drawn by one frame", () => {
    expect(HARNESS_GLYPHS.cursor_ide).toBe(HARNESS_GLYPHS.cursor_agent);
    expect(markFor('cursor_ide')).toBe(markFor('cursor_agent'));
    expect(markFor('cursor_ide').harnesses).toEqual(['cursor_ide', 'cursor_agent']);
  });

  test('every value belongs to exactly one mark, and the mark draws its glyph', () => {
    for (const h of HARNESSES) {
      const owners = HARNESS_MARKS.filter((m) => m.harnesses.includes(h));
      expect(owners.length).toBe(1);
      expect(owners[0]!.frame).toBe(HARNESS_GLYPHS[h]);
      expect(owners[0]!.name).toBe(HARNESS_NAMES[h]);
    }
  });

  test('the picker shows the seven in the order the brief names them', () => {
    expect(HARNESS_MARKS.map((m) => m.name)).toEqual(['Claude Code', 'Codex', 'Cursor', 'Gemini CLI', 'Cline', 'opencode', 'Aider']);
  });

  test('a value this build does not know has no glyph rather than somebody else’s', () => {
    expect(isHarness('windsurf')).toBe(false);
    expect(harnessGlyph('windsurf')).toBeUndefined();
    expect(harnessGlyph('codex')).toBe(HARNESS_GLYPHS.codex);
  });
});

// ─── one family ──────────────────────────────────────────────────────────────────────

describe('every mark', () => {
  for (const m of HARNESS_MARKS) {
    describe(m.id, () => {
      test(`is a valid ${GRID}x${GRID} frame`, () => {
        expect(validateFrame(m.frame), sheet(m)).toEqual([]);
      });

      test('draws one role and no other: never a brand colour, never a second tone', () => {
        const roles = new Set(m.frame.join('').replace(/\./g, ''));
        expect([...roles]).toEqual(['b']);
      });

      test('stays inside the 12x12 live area', () => {
        const { x0, x1, y0, y1 } = bbox(m.frame);
        expect([x0, y0], sheet(m)).toEqual([Math.max(x0, LIVE[0]), Math.max(y0, LIVE[0])]);
        expect([x1, y1], sheet(m)).toEqual([Math.min(x1, LIVE[1]), Math.min(y1, LIVE[1])]);
      });

      test('is centred in the live area to within a cell', () => {
        const { x0, x1, y0, y1 } = bbox(m.frame);
        const dx = x0 - LIVE[0] - (LIVE[1] - x1);
        const dy = y0 - LIVE[0] - (LIVE[1] - y1);
        expect(Math.abs(dx), `${sheet(m)}\nleft minus right margin ${dx}`).toBeLessThanOrEqual(1);
        expect(Math.abs(dy), `${sheet(m)}\ntop minus bottom margin ${dy}`).toBeLessThanOrEqual(1);
      });

      test('has no one-cell-wide line: strokes are 2 cells, ending in at most a tip', () => {
        expect(thinCells(m.frame), sheet(m)).toEqual([]);
      });

      test('keeps every symmetry its source mark has', () => {
        if (m.symmetry.includes('mirror')) expect(mirror(m.frame), sheet(m)).toEqual(m.frame);
        if (m.symmetry.includes('flip')) expect(flip(m.frame), sheet(m)).toEqual(m.frame);
        if (m.symmetry.includes('rotate')) expect(rotate(m.frame), sheet(m)).toEqual(m.frame);
      });
    });
  }

  test(`weighs within ${WEIGHT_BAND * 100}% of the set's mean, so no tool reads louder than another`, () => {
    const counts = HARNESS_MARKS.map((m) => drawn(m.frame).length);
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    HARNESS_MARKS.forEach((m, i) => {
      const dev = (counts[i]! - mean) / mean;
      expect(Math.abs(dev), `${m.id}: ${counts[i]} cells against a mean of ${mean.toFixed(1)}`).toBeLessThanOrEqual(WEIGHT_BAND);
    });
  });

  test(`differs from every other mark by at least ${DISTINCT_MIN} cells`, () => {
    for (let i = 0; i < HARNESS_MARKS.length; i++) {
      for (let j = i + 1; j < HARNESS_MARKS.length; j++) {
        const a = HARNESS_MARKS[i]!;
        const b = HARNESS_MARKS[j]!;
        expect(differ(a.frame, b.frame), `${a.id} / ${b.id}`).toBeGreaterThanOrEqual(DISTINCT_MIN);
      }
    }
  });
});

describe('the marks that are about a particular source', () => {
  const get = (id: HarnessMark['id']) => HARNESS_MARKS.find((m) => m.id === id)!;

  test("Gemini's star is not Claude's spark: it has no diagonal rays", () => {
    // The corner-to-centre diagonals are where an eight-ray spark has ink and a four-point
    // star with concave sides has none. Checked on the cells one step in from each corner
    // of the live area's inner 8x8.
    const probes: Cell[] = [
      [4, 4],
      [11, 4],
      [4, 11],
      [11, 11],
    ];
    const ink = (f: Frame, [x, y]: Cell) => f[y]![x] !== '.';
    expect(probes.every((p) => ink(get('claude_code').frame, p))).toBe(true);
    expect(probes.some((p) => ink(get('gemini_cli').frame, p))).toBe(false);
  });

  test('Codex is one hexagonal ring with one opening, on the right: a C, never an S', () => {
    // The two-strand knot broke the ring at opposite corners, and a ring broken twice at a
    // half turn is an S (every round-5 reviewer). One opening cannot be. Top-to-bottom the C
    // is its own reflection; a half turn and a mirror both move the opening to the left.
    const f = get('codex').frame;
    expect(flip(f)).toEqual(f);
    expect(rotate(f)).not.toEqual(f);
    expect(mirror(f)).not.toEqual(f);
    const rows = f.slice(2, 14);
    const openRight = rows.filter((row) => row.slice(8) === '........');
    expect(openRight.length).toBe(2);
    for (const row of rows) expect(row.slice(0, 8), 'the left side is never open').toContain('b');
  });

  test("Cursor's cube has a solid top face and open side faces either side of a centre edge", () => {
    const f = get('cursor').frame;
    expect(f[5]).toBe('...bbbbbbbbbb...');
    for (const y of [7, 8, 9, 10]) expect(f[y]).toBe('...bb..bb..bb...');
    expect(mirror(f)).toEqual(f);
  });

  test("opencode's o keeps the wordmark's notch, drawn solid: a window high in the block, not an empty ring", () => {
    const f = get('opencode').frame;
    const counter = f.map((row, y) => [...row].flatMap((ch, x) => (ch === '.' && x >= 6 && x <= 9 && y >= 5 && y <= 10 ? [y] : [])));
    const openRows = [...new Set(counter.flat())];
    expect(openRows).toEqual([5, 6, 7, 8]);
  });

  test("Cline's eyes are holes in the head, one either side of the middle", () => {
    const f = get('cline').frame;
    const { y0, y1 } = bbox(f);
    // A row that crosses both eyes: ink, a gap, ink, a gap, ink across the head.
    const eyeRow = f.slice(y0, y1 + 1).find((row) => /b+\.+b+\.+b+/.test(row.replace(/^\.+|\.+$/g, '')));
    expect(eyeRow, ascii(f)).toBeDefined();
    expect(eyeRow).toEqual(eyeRow!.split('').reverse().join(''));
  });

  test("Aider's prompt is two marks, the > and the _, and the _ sits on the bottom row", () => {
    const f = get('aider').frame;
    const { y1 } = bbox(f);
    const last = f[y1]!;
    expect(last.match(/b+/g)?.length).toBe(2);
  });

  test("Aider's > and _ are two clear cells apart on every row they share, so it never reads as ≥", () => {
    const f = get('aider').frame;
    for (const row of f.slice(12, 14)) expect(row.trim().match(/b\.+b/)![0].length - 2).toBeGreaterThanOrEqual(2);
  });
});

// ─── size and ink ────────────────────────────────────────────────────────────────────

describe('sizes', () => {
  test('are 16, 32, 48 and 64 pt only: whole points per cell', () => {
    expect([...GLYPH_SIZES]).toEqual([16, 32, 48, 64]);
    for (const s of GLYPH_SIZES) expect(s % GRID).toBe(0);
  });

  test('20 and 24 pt are not glyph sizes; they snap down to one', () => {
    expect(isGlyphSize(20)).toBe(false);
    expect(isGlyphSize(24)).toBe(false);
    expect(snapGlyphSize(24)).toBe(16);
    expect(snapGlyphSize(40)).toBe(32);
    expect(snapGlyphSize(64)).toBe(64);
    expect(snapGlyphSize(128)).toBe(64);
    expect(snapGlyphSize(4)).toBe(16);
  });
});

// OWNER OVERRIDE, 2026-09-13 09:22 (brief.md): "why are all of them the same color? Looks
// horrible." This block used to hold every glyph to ONE neutral ink and the selected tile to
// amber (DESIGN-DIRECTION 5). The one accent rule is lifted for identity: each mark now wears its
// harness hue where the harness is the object (DESIGN-V2 2.4), and a selected tile fills with
// THAT hue, not amber. What still holds, and is still asserted: one role, one ink per glyph,
// never the vendor's colour, and every ink readable on the surface it is drawn on.
describe('ink', () => {
  const HUES: Record<HarnessMark['id'], HueName> = {
    claude_code: 'heather',
    codex: 'tide',
    cursor: 'brass',
    gemini_cli: 'coral',
    cline: 'iris',
    opencode: 'ember',
    aider: 'cobalt',
  };

  test('each mark wears the hue the spectrum gives it, seven different hues, none of them amber', () => {
    for (const m of HARNESS_MARKS) {
      expect(harnessHue(m.id)?.name, m.id).toBe(HUES[m.id]);
      for (const h of m.harnesses) expect(harnessHue(h)?.name, h).toBe(HUES[m.id]);
    }
    expect(new Set(Object.values(HUES)).size).toBe(HARNESS_MARKS.length);
    expect(Object.values(HUES)).not.toContain('amber');
  });

  test("Claude Code is not orange: its hue sits away from Anthropic's terracotta", () => {
    // The owner's first icon complaint was "an orange and black thing". Heather is a lilac, and
    // no harness hue is the ember that sits 0.072 OKLab from Claude's #D97757.
    expect(harnessHue('claude_code')?.name).toBe('heather');
    for (const m of HARNESS_MARKS) if (m.id !== 'opencode') expect(harnessHue(m.id)?.name).not.toBe('ember');
  });

  for (const scheme of ['dark', 'light'] as const) {
    const c = colors(scheme);
    test(`${scheme}: the neutral states are still one token each`, () => {
      expect(glyphColor('idle', c)).toBe(c.text);
      expect(glyphColor('dim', c)).toBe(c.textDim);
      expect(glyphColor('missing', c)).toBe(c.textFaint);
      expect(glyphColor('selected', c)).toBe(c.onAccent);
      expect(c.onAccent).toBe('#1C1917');
      for (const ink of ['idle', 'dim', 'missing', 'selected'] as const) {
        expect(harnessInk('codex', ink, scheme)).toBe(glyphColor(ink, c));
      }
    });

    test(`${scheme}: \`hue\` is the mark tone of the harness's hue, and a harness this build does not know gets text`, () => {
      for (const m of HARNESS_MARKS) expect(harnessInk(m.id, 'hue', scheme)).toBe(harnessHue(m.id, scheme)!.ink);
      expect(harnessInk('cursor_agent', 'hue', scheme)).toBe(harnessHue('cursor', scheme)!.ink);
      expect(harnessInk('windsurf', 'hue', scheme)).toBe(c.text);
    });

    test(`${scheme}: a glyph clears the 3:1 graphics floor on every surface it is drawn on`, () => {
      expect(contrast(glyphColor('idle', c), c.raised)).toBeGreaterThanOrEqual(3);
      expect(contrast(glyphColor('idle', c), c.bg)).toBeGreaterThanOrEqual(3);
      expect(contrast(glyphColor('dim', c), c.card)).toBeGreaterThanOrEqual(3);
      for (const m of HARNESS_MARKS) {
        // In a row (bg or card) the mark tone; on a picker tile (raised) the tile's own mark ink.
        expect(contrast(harnessInk(m.id, 'hue', scheme), c.bg), `${m.id} on bg`).toBeGreaterThanOrEqual(3);
        expect(contrast(harnessInk(m.id, 'hue', scheme), c.card), `${m.id} on card`).toBeGreaterThanOrEqual(3);
        const idle = harnessTileInks(m.id, 'idle', scheme);
        expect(contrast(idle.mark, idle.fill), `${m.id} idle tile`).toBeGreaterThanOrEqual(3);
        const on = harnessTileInks(m.id, 'selected', scheme);
        expect(contrast(on.mark, on.fill), `${m.id} selected tile`).toBeGreaterThanOrEqual(4.5);
      }
    });

    test(`${scheme}: a picker tile is raised with its hue on the mark, or a solid fill of that hue with dark ink`, () => {
      for (const m of HARNESS_MARKS) {
        const h = harnessHue(m.id, scheme)!;
        expect(harnessTileInks(m.id, 'idle', scheme)).toEqual({ fill: c.raised, mark: h.text, name: c.text, status: c.textDim });
        expect(harnessTileInks(m.id, 'selected', scheme)).toEqual({ fill: h.fill, mark: '#1C1917', name: '#1C1917', status: '#1C1917' });
        expect(harnessTileInks(m.id, 'missing', scheme)).toEqual({ fill: c.raised, mark: c.textFaint, name: c.textDim, status: c.textDim });
        // Not the tinted chip: the selected tile's text is never its own fill's hue, and the
        // fill is never amber, the action colour.
        expect(harnessTileInks(m.id, 'selected', scheme).name).not.toBe(h.fill);
        expect(harnessTileInks(m.id, 'selected', scheme).fill).not.toBe(c.accent);
      }
    });
  }

  test('something with no hue of its own never borrows amber: its selected tile is a neutral solid', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const c = colors(scheme);
      expect(tileInks(undefined, 'selected', scheme)).toEqual({ fill: c.text, mark: c.bg, name: c.bg, status: c.bg });
      expect(contrast(c.bg, c.text)).toBeGreaterThanOrEqual(4.5);
      expect(tileInks(undefined, 'idle', scheme).mark).toBe(c.text);
    }
  });
});

// ─── the picker ──────────────────────────────────────────────────────────────────────

describe('the picker', () => {
  const cursor = HARNESS_MARKS.find((m) => m.id === 'cursor')!;
  const claude = HARNESS_MARKS.find((m) => m.id === 'claude_code')!;

  test('tiles follow (width - 32 - 2 x 12) / 3, 88 pt tall, radius 18', () => {
    expect(pickerTileWidth(393)).toBeCloseTo(112.33, 2);
    expect(pickerTileWidth(375)).toBeCloseTo(106.33, 2);
    expect(tileWidthInside(393 - 32)).toBeCloseTo(pickerTileWidth(393), 6);
    expect(PICKER.tileHeight).toBe(88);
    expect(PICKER.radius).toBe(18);
    expect(PICKER.glyph).toBe(32);
    expect(PICKER.fadeMs).toBe(120);
  });

  test('selecting Cursor selects both of its wire values, and deselecting removes both', () => {
    const on = toggleMark([], cursor);
    expect(on).toEqual(['cursor_ide', 'cursor_agent']);
    expect(isMarkSelected(on, cursor)).toBe(true);
    expect(toggleMark(on, cursor)).toEqual([]);
  });

  test('a half-selected Cursor (one value found on the Mac) completes rather than clears', () => {
    const half: Harness[] = ['cursor_agent'];
    expect(isMarkSelected(half, cursor)).toBe(false);
    expect(toggleMark(half, cursor)).toEqual(['cursor_ide', 'cursor_agent']);
  });

  test('the selection comes back in wire order whatever order it was built in', () => {
    const a = toggleMark(toggleMark([], cursor), claude);
    const b = toggleMark(toggleMark([], claude), cursor);
    expect(a).toEqual(b);
    expect(a).toEqual(['claude_code', 'cursor_ide', 'cursor_agent']);
  });

  test('sessions are summed across the values a mark covers; no count is not zero', () => {
    expect(sessionsFor(cursor, { cursor_ide: 40, cursor_agent: 17 })).toBe(57);
    expect(sessionsFor(cursor, { cursor_agent: 3 })).toBe(3);
    expect(sessionsFor(cursor, { codex: 9 })).toBeUndefined();
    expect(sessionsFor(cursor, undefined)).toBeUndefined();
    expect(sessionsFor(claude, { claude_code: 0 })).toBe(0);
  });

  test('the status line says what was found, and nothing when there is nothing to say', () => {
    expect(statusLine(undefined)).toBeNull();
    expect(statusLine(0)).toBe('not found');
    expect(statusLine(1)).toBe('found 1 session');
    expect(statusLine(212)).toBe('found 212 sessions');
    expect(statusLine(12345)).toBe('found 12,345 sessions');
  });
});
