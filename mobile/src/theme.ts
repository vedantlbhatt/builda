import { FLOAT_SHADOW, tokens } from './generated/tokens';
import { StripClass, StripMarkKind } from './generated/strip';

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
  };
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

/** Duration, the way a person says it. "1h 42m", never "102 minutes". */
export function duration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
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

export function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return `${n}`;
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
