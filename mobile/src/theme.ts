import { FLOAT_SHADOW, tokens } from './generated/tokens';
import { StripClass, StripMarkKind } from './generated/strip';
import { wholeMinutes } from './copy/numbers';

export type Scheme = 'light' | 'dark';

/**
 * Colours, resolved from the generated tokens.
 *
 * Every value is sRGB hex, which is what `react-native-svg` expects — and the Swift side
 * uses `Color(.sRGB, ...)` rather than the bare initialiser for the same reason. SwiftUI's
 * `Color(red:green:blue:)` is Display P3, so using it would make the Mac card visibly more
 * saturated than the byte-identical phone card, and the difference would only show up when
 * someone put two screenshots side by side.
 */
export function colors(scheme: Scheme) {
  const pick = (pair: { light: string; dark: string }) => pair[scheme];

  return {
    strip: {
      [StripClass.idle]: pick(tokens.strip.idle),
      [StripClass.prompting]: pick(tokens.strip.prompting),
      [StripClass.agent]: pick(tokens.strip.agent),
      [StripClass.human_edit]: pick(tokens.strip.human_edit),
    } as Record<StripClass, string>,

    mark: {
      [StripMarkKind.prompt]: pick(tokens.mark.prompt),
      [StripMarkKind.commit]: pick(tokens.mark.commit),
      [StripMarkKind.compact]: pick(tokens.mark.compact),
    } as Record<StripMarkKind, string>,

    bg: pick(tokens.surface.bg),
    card: pick(tokens.surface.card),
    /** Level 2: a pressed row, an input fill, a harness tile. One step above `card`. */
    raised: pick(tokens.surface.raised),
    border: pick(tokens.surface.border),
    text: pick(tokens.surface.text),
    textDim: pick(tokens.surface.textDim),
    /** Tertiary and disabled. 3.2:1 on dark `bg`: decoration only, never information. */
    textFaint: pick(tokens.surface.textFaint),
    accent: pick(tokens.surface.accent),
    /** The primary fill while a finger is on it. */
    accentPressed: pick(tokens.surface.accentPressed),

    /**
     * The three data hues. Never chrome, never a fill behind text, never a chip: they colour
     * a number or a mark and nothing else. `human` is the strip's teal, not a second teal.
     */
    data: {
      human: pick(tokens.strip.human_edit),
      add: pick(tokens.data.add),
      del: pick(tokens.data.del),
    },

    /**
     * Ink on an accent-filled control. The amber is the same in both schemes, so the ink
     * on it is the light scheme's text colour in both — derived, not a second constant.
     */
    onAccent: tokens.surface.text.light,
    /**
     * Destructive actions, errors and the recording dot. It is the `del` data hue: one red,
     * defined once in tokens.json (the light value exists because the dark one is 3.9:1 on
     * white).
     */
    danger: pick(tokens.data.del),
    /** A hairline drawn over a camera preview, where no surface token applies. */
    overlayStroke: OVERLAY_STROKE,
    /** Google's sign-in button is white by their guideline, in either scheme. */
    googleButton: tokens.surface.card.light,

    graph: tokens.graph.levels[scheme],

    /** The nine identity hues resolved for this scheme (`hue()`): `useColors().hues.tide.ink`. */
    hues: Object.fromEntries(HUE_NAMES.map((n) => [n, hue(n, scheme)])) as Record<HueName, Hue>,
  };
}

// ─── the spectrum: identity colour (the owner's 2026-09-13 override) ─────────────────────
//
// "Why are all of them the same color? Looks horrible." (brief.md, "Owner override"). The one
// accent rule is lifted for IDENTITY: every creature, session, Wrapped card, harness tile,
// archetype and dimension wears one of nine hues from `tokens.spectrum`. Chrome does not: the
// tab bar, buttons other than the amber primary, rows, screens and sheets stay the warm greys,
// and amber stays the brand and the only action colour. The rules and every measurement are in
// design-refs/DESIGN-V2-COLOUR-MOTION.md; `scripts/gen_tokens.py` refuses a spectrum that breaks
// a contrast floor or crowds a data hue, so what arrives here is already checked.

type Spectrum = typeof tokens.spectrum;

/** One of the nine: amber, brass, tide, cobalt, iris, heather, orchid, coral, ember. */
export type HueName = keyof Spectrum['hues'];
/** Bit and the eight animals: the keys of `spectrum.creature`. */
export type CreatureId = keyof Spectrum['creature'];
/** A harness MARK id (`HARNESS_MARKS`): `cursor` covers `cursor_ide` and `cursor_agent`. */
export type HarnessHueId = keyof Spectrum['harness'];
/** A Wrapped card id, in `wrapped.CARD_IDS` order. */
export type CardId = keyof Spectrum['card'];
/** The six per session archetypes, `director` and `skeptic` from the corpus rules, and `generalist`. */
export type ArchetypeId = keyof Spectrum['archetype'];
export type DimensionId = keyof Spectrum['dimension'];
export type VerdictId = keyof Spectrum['verdict'];

/** The nine, in the sheet's order (amber first: the brand). */
export const HUE_NAMES = Object.keys(tokens.spectrum.hues) as HueName[];

/**
 * The ring a session's creature is picked from: `CREW_RING[fnv1a32(client_session_id) % 8]`,
 * stepped forward past any creature a session running at its start already wears. Never Bit,
 * so no session is ever amber (on a live surface amber means "needs you" and nothing else).
 * The rule itself is `crewCreatures` in src/live/crew.ts, the only implementation: the server's
 * Live Activity pushes carry the creature the phone registered with each push token.
 */
export const CREW_RING = tokens.spectrum.crew.ring as readonly Exclude<CreatureId, 'bit'>[];

/**
 * A hue resolved for one scheme. Every field is sRGB hex.
 *
 *   ink      a mark: a creature, a glyph, a ring, a bar. The dark ink on dark; on light the
 *            3:1 mark tone (the dark ink is 1.3 to 2.8:1 on cream).
 *   text     the hue as a label (13 pt semibold and up, never a paragraph). The dark ink on
 *            dark; on light the 4.5:1 text tone.
 *   partner  the dither's middle tone (paper, partner, ink). Never text, never a creature on its
 *            own, never the ink at reduced opacity (that is the brown the judges saw).
 *   fill     a solid fill: a selected tile, a share card band. The dark ink in both schemes.
 *   onFill   ink on the fill: `#1C1917`, 5.2:1 or better on every hue.
 */
export interface Hue {
  name: HueName;
  ink: string;
  text: string;
  partner: string;
  fill: string;
  onFill: string;
}

export function isHueName(value: unknown): value is HueName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(tokens.spectrum.hues, value);
}

export function hue(name: HueName, scheme: Scheme = 'dark'): Hue {
  const t = tokens.spectrum.hues[name];
  const dark = scheme === 'dark';
  return {
    name,
    ink: dark ? t.dark : t.light,
    text: dark ? t.dark : t.lightText,
    partner: dark ? t.partner : t.lightPartner,
    fill: t.dark,
    onFill: tokens.surface.text.light,
  };
}

/** Bit is amber (the brand); each animal has its own hue and no two share one. */
export function creatureHue(creature: CreatureId, scheme: Scheme = 'dark'): Hue {
  return hue(tokens.spectrum.creature[creature], scheme);
}

/**
 * The wire values that are not mark ids: Cursor's IDE and its CLI are one mark and one hue
 * (`HARNESS_MARKS`). `__tests__/spectrum.test.ts` holds this against `markFor`.
 */
const HARNESS_WIRE_TO_MARK: Readonly<Record<string, HarnessHueId>> = {
  cursor_ide: 'cursor',
  cursor_agent: 'cursor',
};

/**
 * A harness's hue, by mark id or by wire value, where the harness is the object (the picker, the
 * Stack page, Settings). Undefined for a harness this build does not know: the caller shows the
 * name alone, as `HarnessGlyph` does. Where the SESSION is the object the glyph stays `textDim`,
 * so a row never carries two identity hues.
 */
export function harnessHue(id: string, scheme: Scheme = 'dark'): Hue | undefined {
  const table = tokens.spectrum.harness as Readonly<Record<string, HueName>>;
  const key = Object.prototype.hasOwnProperty.call(table, id) ? id : HARNESS_WIRE_TO_MARK[id];
  const name = key === undefined ? undefined : table[key];
  return name === undefined ? undefined : hue(name, scheme);
}

/**
 * The archetype's creature's hue, so the You hero, Wrapped card one and the creature always
 * agree. No archetype (null, a refusal, a name from a newer engine) is the generalist: Bit's amber.
 */
export function archetypeHue(archetype: string | null | undefined, scheme: Scheme = 'dark'): Hue {
  const table = tokens.spectrum.archetype as Readonly<Record<string, HueName>>;
  const name =
    typeof archetype === 'string' && Object.prototype.hasOwnProperty.call(table, archetype)
      ? table[archetype]!
      : tokens.spectrum.archetype.generalist;
  return hue(name, scheme);
}

/**
 * A Wrapped card's hue. `builder_type` wears the archetype's; cards two and three step to their
 * `cardAlt` when the archetype already wears theirs, so no card meets its own hue across or down
 * the two column grid (gen_tokens.py checks every archetype).
 */
export function cardHue(card: CardId, archetype: string | null | undefined, scheme: Scheme = 'dark'): Hue {
  const own = archetypeHue(archetype).name;
  const wears = tokens.spectrum.card[card] as HueName | 'archetype';
  if (wears === 'archetype') return hue(own, scheme);
  const alt = (tokens.spectrum.cardAlt as Readonly<Record<string, HueName>>)[card];
  return hue(alt !== undefined && wears === own ? alt : wears, scheme);
}

/** Each dimension wears the hue of the archetype whose rule reads it (tokens.json says which). */
export function dimensionHue(dimension: DimensionId, scheme: Scheme = 'dark'): Hue {
  return hue(tokens.spectrum.dimension[dimension], scheme);
}

/**
 * A verdict's colour. State, not identity: converging is `add`, lost is `del`, and circling is
 * `textDim`, so the neutral verdict is never the loudest word on a tile.
 */
export function verdictColor(verdict: VerdictId, scheme: Scheme = 'dark'): string {
  const [group, key] = tokens.spectrum.verdict[verdict].split('.') as [string, string];
  const table = (tokens as unknown as Record<string, Record<string, { light: string; dark: string }>>)[group];
  const pair = table?.[key];
  if (!pair) throw new Error(`spectrum.verdict.${verdict} names no token`);
  return pair[scheme];
}

const OVERLAY_STROKE = 'rgba(255,255,255,0.8)';

/** Apple's and Android's minimum comfortable tap target, in points. */
export const TAP_TARGET = 44;

/**
 * The `hitSlop` that grows a control of `height` points to `TAP_TARGET`, symmetric on all
 * four sides. Zero when it is already big enough, so a large button is not given a
 * halo that overlaps its neighbour.
 */
export function hitSlopToReach(height: number, target: number = TAP_TARGET) {
  const pad = Math.max(0, Math.ceil((target - height) / 2));
  return { top: pad, bottom: pad, left: pad, right: pad };
}

/** 4pt base: xs 4, sm 8, tile 12, md 16, lg 24, section 32, xl 40, xxl 64. Nothing else. */
export const space = tokens.space;

/**
 * Actions are capsules (`pill`); containers are `md` 18; things inside a container are `sm`
 * 12; marks are `xs` 6; Wrapped and share cards are `lg` 28. `card` (24) is the 1600px
 * export's radius, not part of the scale. Every rounded rectangle also gets
 * `borderCurve: 'continuous'`.
 */
export const radius = tokens.radius;

/** Named uses of the space scale: gutter 16, tile gap 12, section gap 32, tile padding 14. */
export const layout = tokens.layout;

/** The nine type roles. Rendered by `<T role>` in `src/ui/Text.tsx`; read the rules there. */
export const typeRoles = tokens.type;
export type TypeRole = keyof typeof tokens.type;

/** SF Mono on the New Architecture text path; the old renderer does not map it. */
export const MONO_FAMILY = 'ui-monospace';

/**
 * The one shadow, for things that float over content (a dragged card, a toast). Nothing in
 * the scroll flow gets it, and nothing gets a coloured glow.
 */
export const floatShadow = FLOAT_SHADOW;

/**
 * Duration, the way a person says it: "45s", "42m", "1h 05m", never "102 minutes". The minutes
 * are `wholeMinutes`, the one rule the session's sentence reads too (`floorMins`), and the hour
 * pads its minutes as the sentence does: "1h 05m" on the hero over "You built for 1h 05m".
 */
export function duration(seconds: number): string {
  const m = wholeMinutes(seconds);
  if (m < 1) return `${Math.floor(Math.max(0, seconds))}s`;
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

/**
 * The hour a Builda day starts (`Tuning.dayBoundaryHour` on the Mac, the same 4 in ingest,
 * derivation and the graph): a sitting that runs past midnight belongs to the day it began.
 */
export const DAY_BOUNDARY_HOUR = 4;

const DAY_MS = 86_400_000;

/** Local calendar day number of `t` on the Builda clock (days start at 04:00). */
function builderDay(t: number): number {
  const d = new Date(t - DAY_BOUNDARY_HOUR * 3_600_000);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}

/**
 * The day a session happened, the way a list says it: "today", "yesterday", the weekday
 * inside the last week, then "Aug 29", and the year only when it is not this one. Never
 * "8/29/2026", which is a database talking. Lower case where it is a word, because it sits
 * in a lower case meta line ("gt-transit · yesterday").
 */
export function dayLabel(iso: string | number, now: number = Date.now()): string {
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const ago = builderDay(now) - builderDay(t);
  if (ago === 0) return 'today';
  if (ago === 1) return 'yesterday';
  const day = new Date(t - DAY_BOUNDARY_HOUR * 3_600_000);
  if (ago > 1 && ago < 7) return day.toLocaleDateString(undefined, { weekday: 'long' });
  const sameYear = day.getFullYear() === new Date(now - DAY_BOUNDARY_HOUR * 3_600_000).getFullYear();
  return day.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

/**
 * Contribution-graph level from active hours.
 *
 * Absolute buckets, matching Tuning.graphHourBuckets on the Swift side — self-relative
 * quantiles would make two people's graphs incomparable, which defeats the point of a
 * graph anyone screenshots.
 */
const GRAPH_HOUR_BUCKETS = [0, 0.5, 2, 4, 8];

export function graphLevel(activeSeconds: number): number {
  const hours = activeSeconds / 3600;
  let level = 0;
  for (const edge of GRAPH_HOUR_BUCKETS) if (hours > edge) level += 1;
  return Math.min(level, 5);
}
