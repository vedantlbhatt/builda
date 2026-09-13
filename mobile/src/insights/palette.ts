/**
 * The analysis page's colours: the V2 spectrum (design-refs/DESIGN-V2-COLOUR-MOTION.md).
 *
 * THE TOKENS WIN. `design/tokens.json` carries the spectrum as `spectrum` (hues, the creature,
 * dimension and archetype mappings), generated into `generated/tokens.ts`; when it is there, every
 * hue and mapping below is read from it, so a retuned hue reaches this page through `make gen`
 * like every other colour. The table here is the V2 doc's section 1.5, the fallback for a build
 * whose tokens predate the block, and it is read loosely so this file compiles either way.
 *
 * The owner lifted the one accent rule (brief.md, "Owner override"): identity and data get real
 * colour from one harmonious spectrum on the warm dark ground; amber stays the brand. The green
 * band and the red band are left out of the spectrum on purpose: those hues are data (lines
 * added, lines removed, a green test run, a red one), never identity.
 *
 * What each hue MEANS on this page is fixed here and nowhere else:
 *   - each chapter wears one hue, so a chapter is findable by colour while scrolling;
 *   - the five dimensions wear the hues the tokens give them;
 *   - an archetype wears its creature's hue, the creature wears its own;
 *   - `DATA.add` and `DATA.del` are the only greens and reds.
 *
 * Pure (no React Native), so `bun test` holds it.
 */
import type { Dimension } from '../generated/analysis';
import { tokens } from '../generated/tokens';

export interface Hue {
  /** The bright ink: text, marks and fills on the dark ground. */
  ink: string;
  /** The same hue at the partner lightness: the dither's middle tone, a receding mark. */
  partner: string;
  /** The hue as a mark on the light ground (widgets, the light scheme). */
  light: string;
}

export type HueName = 'amber' | 'brass' | 'tide' | 'cobalt' | 'iris' | 'heather' | 'orchid' | 'coral' | 'ember';
export const HUE_NAMES: readonly HueName[] = ['amber', 'brass', 'tide', 'cobalt', 'iris', 'heather', 'orchid', 'coral', 'ember'];

/** DESIGN-V2-COLOUR-MOTION.md 1.5, for tokens that do not carry the block yet. */
const V2_TABLE: Record<HueName, Hue> = {
  amber: { ink: '#FFB300', partner: '#A17002', light: '#BC8303' },
  brass: { ink: '#E6DD5A', partner: '#867D02', light: '#999004' },
  tide: { ink: '#6CD9F1', partner: '#29889A', light: '#049BB3' },
  cobalt: { ink: '#53A3F2', partner: '#3C7EBE', light: '#4192DF' },
  iris: { ink: '#9F86F5', partner: '#7D69C3', light: '#967CEB' },
  heather: { ink: '#D8ADF2', partner: '#8C6BA1', light: '#AD79CB' },
  orchid: { ink: '#E573BE', partner: '#B05491', light: '#D565B0' },
  coral: { ink: '#FCA0A6', partner: '#AA6267', light: '#D66E77' },
  ember: { ink: '#F9833E', partner: '#BB5C21', light: '#E06C23' },
};

const V2_CREATURE: Record<string, HueName> = {
  bit: 'amber',
  cat: 'orchid',
  dog: 'cobalt',
  fox: 'ember',
  owl: 'heather',
  bee: 'brass',
  whale: 'tide',
  octopus: 'iris',
  crab: 'coral',
};

const V2_DIMENSION: Record<Dimension, HueName> = {
  steering: 'tide',
  execution: 'ember',
  engineering: 'cobalt',
  product_instinct: 'orchid',
  planning: 'brass',
};

interface SpectrumTokens {
  hues?: Record<string, { dark?: string; partner?: string; light?: string }>;
  creature?: Record<string, string>;
  dimension?: Record<string, string>;
}

const FROM_TOKENS: SpectrumTokens | undefined = (tokens as unknown as { spectrum?: SpectrumTokens }).spectrum;

function isHex(x: unknown): x is string {
  return typeof x === 'string' && /^#[0-9A-Fa-f]{6}$/.test(x);
}

function isHueName(x: unknown): x is HueName {
  return typeof x === 'string' && (HUE_NAMES as readonly string[]).includes(x);
}

function resolveHue(name: HueName): Hue {
  const t = FROM_TOKENS?.hues?.[name];
  const f = V2_TABLE[name];
  return {
    ink: isHex(t?.dark) ? t.dark.toUpperCase() : f.ink,
    partner: isHex(t?.partner) ? t.partner.toUpperCase() : f.partner,
    light: isHex(t?.light) ? t.light.toUpperCase() : f.light,
  };
}

/** The nine hues, from the tokens when they carry them. Amber is pinned to the brand's #FFB300. */
export const SPECTRUM: Record<HueName, Hue> = Object.fromEntries(HUE_NAMES.map((n) => [n, resolveHue(n)])) as Record<HueName, Hue>;

function mapping<K extends string>(fallback: Record<K, HueName>, fromTokens: Record<string, string> | undefined): Record<K, HueName> {
  const out = { ...fallback };
  for (const k of Object.keys(fallback) as K[]) {
    const v = fromTokens?.[k];
    if (isHueName(v)) out[k] = v;
  }
  return out;
}

/** Ink on any spectrum fill: the light scheme's text, 4.5:1 or better on every hue (the V2 floor). */
export const ON_HUE = tokens.surface.text.light;

/** The warm dark neutrals the page sits on (tokens.json, dark column). */
export const GROUND = {
  bg: tokens.surface.bg.dark,
  card: tokens.surface.card.dark,
  raised: tokens.surface.raised.dark,
  border: tokens.surface.border.dark,
  text: tokens.surface.text.dark,
  dim: tokens.surface.textDim.dark,
  faint: tokens.surface.textFaint.dark,
} as const;

/** The data hues. Green is added or passing, red is removed or failing, teal is you alone. */
export const DATA = {
  add: tokens.data.add.dark,
  del: tokens.data.del.dark,
  human: tokens.strip.human_edit.dark,
  agent: tokens.strip.agent.dark,
} as const;

/** The contribution ramp, level 0 to 5 (tokens.json `graph.levels.dark`): amber, by hours. */
export const GRAPH_LEVELS: readonly string[] = tokens.graph.levels.dark;

// ------------------------------------------------------------------ what wears which hue

/**
 * The chapters and their hues. Neighbours are never the same family, so the page reads as a
 * sequence of colour worlds rather than a gradient: amber, tide, heather, brass, ember, cobalt,
 * coral, iris, orchid. The hero wears the builder's creature instead (`creatureHue`). Time is
 * amber because the contribution graph always has been; money and burn is ember, the burn.
 */
export const SECTION_HUE = {
  time: 'amber',
  shipping: 'tide',
  agentWork: 'heather',
  agents: 'brass',
  money: 'ember',
  trends: 'cobalt',
  quality: 'coral',
  standsOut: 'iris',
  words: 'orchid',
} as const satisfies Record<string, HueName>;

export type SectionKey = keyof typeof SECTION_HUE;

export function sectionHue(key: SectionKey): Hue {
  return SPECTRUM[SECTION_HUE[key]];
}

/** The five dimensions, as the tokens assign them. */
export const DIMENSION_HUE: Record<Dimension, HueName> = mapping(V2_DIMENSION, FROM_TOKENS?.dimension);

/** Each creature wears one hue; Bit is amber. */
export const CREATURE_HUE: Record<string, HueName> = mapping(V2_CREATURE, FROM_TOKENS?.creature);

export function creatureHue(animal: string | null | undefined): Hue {
  return SPECTRUM[(animal && CREATURE_HUE[animal]) || 'amber'];
}

/**
 * Categories with no identity of their own (languages, models, agent types) take hues in this
 * order: far apart first, so two neighbouring segments never read as one colour.
 */
export const CATEGORICAL: readonly HueName[] = ['tide', 'ember', 'iris', 'brass', 'orchid', 'cobalt', 'coral', 'heather', 'amber'];

export function categorical(i: number): Hue {
  return SPECTRUM[CATEGORICAL[((i % CATEGORICAL.length) + CATEGORICAL.length) % CATEGORICAL.length]!];
}

// ------------------------------------------------------------------ contrast, for the tests

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** `#RRGGBB` at `alpha` as `#RRGGBBAA`, which Skia and React Native both read. */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  return `${hex.slice(0, 7)}${a.toString(16).padStart(2, '0').toUpperCase()}`;
}
