import { colors, creatureHue, harnessHue, type CreatureId, type Hue, type Scheme } from '../theme';
import { EFFECTS } from '../ui/bits/effects/spec';
import type { Animal, AnimalGlyph } from './animals';
import type { Glyph } from './frames';
import { glyphColor, type GlyphInk } from './harness';

/**
 * ONE INK PER CREATURE, from `design/tokens.json` `spectrum.creature`. Still one ink per FRAME:
 * a creature is a single role in a single colour, told apart by its shape first; the colour is
 * who it is.
 *
 * Until 2026-09-13 the whole family shared one ink (amber on dark), and the owner's verdict on
 * that build was "why are all of them the same color? Looks horrible" (brief.md, "Owner
 * override"). The one accent rule is lifted for identity: Bit is amber because the mascot is
 * the brand, and each of the eight animals wears its own hue (cat orchid, dog cobalt, fox ember,
 * owl heather, bee brass, whale tide, octopus iris, crab coral). What the tone says is unchanged:
 *
 *   rest      the creature's ink: the dark ink on a dark surface, the 3:1 mark tone on a light
 *             one (`creatureHue(...).ink`). The creature as the subject
 *   idle      on an unselected picker tile (`raised`): DESIGN-V2 2.1, "its ink on raised". The
 *             dark ink on dark (4.6:1 or better on raised); on light the hue's TEXT tone,
 *             because the mark tone is 2.9:1 on the light `raised` and a mark needs 3:1
 *             (MEASURED, every hue, `__tests__/animals.test.ts`). A creature on a tile is still
 *             that creature, one step darker
 *   selected  `onAccent` ink (`#1C1917`, the hue's `onFill`), on a tile filled with the
 *             creature's own hue (`creatureHue().fill`, `tileInks`)
 *   faint     `textFaint`, for a creature that is not there (a missing or disabled state). Never
 *             a hue at reduced opacity, and never the partner tone: a hue at partial opacity over
 *             the warm ground turns brown, and the partner is never a creature on its own
 *
 * Every value is a token through `theme.ts`, so re-tuning a hue in tokens.json re-tunes its
 * creature and nothing else.
 */
export type InkTone = 'rest' | 'idle' | 'selected' | 'faint';

/**
 * Where each tone takes its colour: the creature's hue as a mark (`hue`), the same hue as a label
 * (`hueText`: identical to `hue` on dark, the 4.5:1 tone on light), or one of two neutral tokens.
 */
export type InkToken = 'hue' | 'hueText' | 'onAccent' | 'textFaint';

export const GLYPH_INK: Record<Scheme, Record<InkTone, InkToken>> = {
  dark: { rest: 'hue', idle: 'hueText', selected: 'onAccent', faint: 'textFaint' },
  light: { rest: 'hue', idle: 'hueText', selected: 'onAccent', faint: 'textFaint' },
};

/**
 * How long a creature's opacity takes to arrive, in ms. Colour enters by position and scale with
 * its opacity snapping in under 120 ms (DESIGN-V2 1.3): a hue at partial opacity over the warm
 * ground reads brown for as long as it is partial, which the onboarding build found with amber.
 * It is the kit's own number for a hue arriving (`EFFECTS.enter.hueFadeMs`), not a second one.
 */
export const HUE_SNAP_MS: number = EFFECTS.enter.hueFadeMs;

/** A creature's one ink, as sRGB hex, for a scheme and a tone. */
export function creatureInk(creature: CreatureId, scheme: Scheme, tone: InkTone = 'rest'): string {
  const source = GLYPH_INK[scheme][tone];
  if (source === 'hue') return creatureHue(creature, scheme).ink;
  if (source === 'hueText') return creatureHue(creature, scheme).text;
  return colors(scheme)[source];
}

/** Bit's ink: the brand's amber on dark, amber's 3:1 mark tone on light. */
export function glyphInk(scheme: Scheme, tone: InkTone = 'rest'): string {
  return creatureInk('bit', scheme, tone);
}

/**
 * Glyph → sRGB hex for Bit. Four roles and one colour: the roles only tell `motion.ts` which
 * pixels are a spark, a tool or a trail (`frames.ts`), so every one of them is the same ink.
 */
export type SpritePalette = Record<Glyph, string>;

export function spritePalette(scheme: Scheme, tone: InkTone = 'rest'): SpritePalette {
  const ink = glyphInk(scheme, tone);
  return { b: ink, w: ink, h: ink, z: ink };
}

/** The one role of an animal frame (`animals.ts`). */
export type AnimalPalette = Record<AnimalGlyph, string>;

/** An animal's palette: its own hue, one role, one ink per frame. */
export function animalPalette(animal: Animal, scheme: Scheme, tone: InkTone = 'rest'): AnimalPalette {
  return { b: creatureInk(animal, scheme, tone) };
}

// ─── harness marks ───────────────────────────────────────────────────────────────────────
//
// DESIGN-V2 2.4. The glyphs keep their one role and their 16/32/48/64 pt rule; what changed is
// the colour of that role. Each mark wears its harness hue (`spectrum.harness`: Claude Code
// heather, Codex tide, Cursor brass, Gemini CLI coral, Cline iris, opencode ember, Aider cobalt),
// never the vendor's own colour and never amber, WHERE THE HARNESS IS THE OBJECT: the picker,
// the onboarding tools step, a Stack page tool row, Settings' tools list. Where the SESSION is
// the object (a mission tile, a Sessions row, a recap card) the glyph stays `dim` beside its
// name, so a row never carries two identity hues: the session's creature already wears one.

/** How a harness mark is inked: its own hue, or one of the four neutral states (`glyphColor`). */
export type HarnessInk = GlyphInk | 'hue';

/**
 * A mark's one colour. `hue` is the harness hue's mark tone (5.1:1 or better on dark `card`,
 * 3.1:1 or better on the light grounds); a wire value this build has no hue for (a harness from
 * a newer Mac) gets `text`, though `HarnessGlyph` draws nothing for it anyway.
 */
export function harnessInk(harness: string, ink: HarnessInk, scheme: Scheme): string {
  const c = colors(scheme);
  if (ink !== 'hue') return glyphColor(ink, c);
  return harnessHue(harness, scheme)?.ink ?? c.text;
}

// ─── tiles: the one way an item is picked ───────────────────────────────────────────────

/** A picker tile's state. `missing`: the tool was not found on this Mac; still tappable. */
export type TileState = 'idle' | 'selected' | 'missing';

/** Every colour on a picker tile, resolved. */
export interface TileInks {
  /** The tile's fill: `raised`, or the item's hue as a solid fill when selected. */
  fill: string;
  /** The glyph or creature. */
  mark: string;
  /** The item's name (13/600). */
  name: string;
  /** The status line under it (12/400). */
  status: string;
}

/**
 * A tile for one item (a harness, a creature), in that item's hue (DESIGN-V2 1.3 and 2.1):
 *
 *   idle      `raised`; the mark in the hue's text tone (the dark ink on dark, 4.6:1 or better on
 *             raised; the 4.2:1 tone on light, where the mark tone is 2.9:1), the name in `text`,
 *             the status in `textDim`. The hue is on the mark only
 *   selected  the hue's solid `fill`, and everything on it in `onFill` (`#1C1917`: 5.2:1 on iris,
 *             the lowest, and 13:1 on brass). A solid fill with dark ink, never the tinted chip:
 *             no pale fill, no same hue border, no same hue text
 *   missing   `raised`; the mark `textFaint`, the name `textDim` (it is still information)
 *
 * `hue` undefined is an item with no hue of its own: its selected tile is `text` with `bg` ink,
 * a neutral solid, so nothing unknown ever borrows amber, the action colour.
 */
export function tileInks(hue: Hue | undefined, state: TileState, scheme: Scheme): TileInks {
  const c = colors(scheme);
  if (state === 'selected') {
    const fill = hue?.fill ?? c.text;
    const ink = hue?.onFill ?? c.bg;
    return { fill, mark: ink, name: ink, status: ink };
  }
  if (state === 'missing') return { fill: c.raised, mark: c.textFaint, name: c.textDim, status: c.textDim };
  return { fill: c.raised, mark: hue?.text ?? c.text, name: c.text, status: c.textDim };
}

/** A harness picker tile, by mark id or wire value (`harnessHue`). */
export function harnessTileInks(harness: string, state: TileState, scheme: Scheme): TileInks {
  return tileInks(harnessHue(harness, scheme), state, scheme);
}

/** A creature picker tile: Bit's amber, or the animal's own hue. */
export function creatureTileInks(creature: CreatureId, state: TileState, scheme: Scheme): TileInks {
  return tileInks(creatureHue(creature, scheme), state, scheme);
}
