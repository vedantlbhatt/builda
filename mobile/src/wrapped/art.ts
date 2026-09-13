/**
 * The dithered header of each Wrapped card: WHAT it draws, and in which hue. Pure, so
 * `bun test` holds it; `CardArt.tsx` hands the field to the kit's `Dither`, which draws it
 * through the one Bayer shader in the card's two tones.
 *
 * THE COLOUR (the owner's 2026-09-13 override: "why are all of them the same color? Looks
 * horrible"). v1 dithered every header in one amber, and fifteen amber cards was exactly the
 * sameness the owner saw. Each card now wears its own hue (`tokens.spectrum.card`, run by
 * `theme.cardHue`: card one the archetype's creature hue, cards two and three stepping to coral
 * when card one already wears theirs), and its header is the THREE LEVEL recipe of DESIGN-V2
 * 1.4: paper, the hue's partner, the hue's ink, dithered on the scalar so the hue never
 * shifts toward brown. `artFor` stamps the hue on the spec (`ArtSpec.hue`), so the card view
 * needs no second lookup; `artTones` resolves it for a scheme.
 *
 * The idea that keeps fifteen cards from reading as fifteen stock illustrations: where the
 * phone holds the data behind a card, the header IS that data, dithered. Where it does not,
 * the header is a procedural field seeded by the card (or its answer), so it is the same
 * picture on every render and every phone, and never random.
 *
 * | card                | the header                                   | from                                     |
 * |---------------------|----------------------------------------------|------------------------------------------|
 * | time_put_in         | the contribution grid, hours per day         | `GET /v1/profile` `graph`                |
 * | longest_session     | that session's strip                         | its `SessionDetail.strip`                |
 * | agents_at_once      | the sessions running at the busiest moment; with none cached, every helper agent as a square, the peak's in ink | cached session windows, else the card's `subagents` and `subagents_peak` |
 * | streak              | the daily commit row                         | report `contributions.days`              |
 * | shipped             | lines, summed session by session             | cached `stats.lines_added_agent`         |
 * | change_course       | a scatter inked at the card's own share      | the card's `value`                       |
 * | kind_of_work        | the split, as bands                          | the card's `kinds` or `role_lines`       |
 * | deep_sessions       | attended time per session, the hour ones solid | cached `attended_seconds`              |
 * | prompts_per_session | prompts per session                          | cached `stats.human_prompt_count`        |
 * | go_to_prompt        | one ring for every time it was sent          | the card's `value` (sends)               |
 * | prompt_length       | the average prompt, drawn to scale: one block a word, the median's worth in ink | the card's `value` and `median` |
 * | builder_type        | an orb lit by the archetype's seed           | procedural, seeded by the answer         |
 * | work_style          | two waves, back and forth                    | procedural, seeded by the answer         |
 * | crash_out           | a burst                                      | procedural, seeded by the card           |
 * | cryptic_prompt      | a blocky mosaic                              | procedural, seeded by the card           |
 *
 * change_course would be interrupts over time, but no per session interrupt count reaches
 * the phone (the contract's `presence_count` folds interrupts in with prompts and edits),
 * so its scatter carries the one number the card has: the share, as the fraction inked.
 * prompt_length has no histogram on the wire, only the average and the median, so its
 * paragraph is exactly those two numbers: as many word blocks as the average prompt has words
 * (the last one cut to the decimal), the first `median` of them in ink; the word widths are
 * seeded, and only the widths.
 *
 * NEVER A FLAT BLOCK (the owner, 2026-09-13, on "How many agents": it must be real dithered
 * data). A solid rectangle of ink reads as a placeholder, so every data shape carries its data
 * as DENSITY too: an agent lane is densest where the most sessions overlapped, a bar is a
 * partner body under an ink cap, a scatter block and the largest split band stop short of solid.
 * The card view (`field.ts`) then breathes through the density; it never adds to it.
 *
 * The session derived headers read the sessions THIS PHONE has cached (the notable ones
 * the Sessions tab synced), not the report's whole window: they draw a shape, never a
 * number, and the card's number beside them is the report's.
 */
import type { PlainRole, ReportWrappedCard, WrappedCard } from '../generated/report';
import { decodeStrip, unpackByte } from '../strip/decode';
import { StripClass } from '../generated/strip';
import { cardHue, graphLevel, hue as hueOf, type HueName, type Scheme } from '../theme';
import { mulberry32 } from '../ui/decrypt';
import { level3 } from '../ui/bits/components/fills';
import { bayer8, fieldFromFunction, fieldFromGrid, fieldFromSeries, quantize, type Field } from '../ui/dithering';

// ─── specs ──────────────────────────────────────────────────────────────────────────────

export type Motif = 'orb' | 'ripples' | 'burst' | 'blocks' | 'lines' | 'waves' | 'drift' | 'scatter';

/** Which data a header was drawn from, so a test (and a reader of a screenshot) can tell. */
export type ArtBasis =
  | 'activity_grid'
  | 'session_strip'
  | 'peak_overlap'
  | 'commit_days'
  | 'cumulative_lines'
  | 'card_share'
  | 'role_split'
  | 'kind_split'
  | 'attended_per_session'
  | 'prompts_per_session'
  | 'send_count'
  | 'prompt_words'
  | 'agent_count'
  | 'procedural';

export interface Lane {
  /** Start and end across the window, 0 to 1. */
  from: number;
  to: number;
  /** One of the sessions running at the busiest moment. */
  peak: boolean;
}

/** What a header draws: the shape of its data, or its seeded motif. */
export type ArtShape =
  | { kind: 'grid'; grid: number[][]; basis: ArtBasis }
  | { kind: 'row'; values: number[]; basis: ArtBasis }
  | { kind: 'series'; series: number[]; shape: 'band' | 'area'; basis: ArtBasis }
  | { kind: 'bars'; bars: { h: number; d: number }[]; basis: ArtBasis }
  | { kind: 'lanes'; lanes: Lane[][]; basis: ArtBasis }
  | { kind: 'bands'; shares: number[]; basis: ArtBasis }
  /** A paragraph of `words` blocks (the last `words % 1` wide), the first `lit` in ink. */
  | { kind: 'words'; words: number; lit: number; seed: number; basis: ArtBasis }
  /** `total` squares, one each, the first `lit` in ink: a count drawn as that many marks. */
  | { kind: 'tally'; total: number; lit: number; basis: ArtBasis }
  | { kind: 'motif'; motif: Motif; seed: number; amount: number; basis: ArtBasis };

/**
 * A header: its shape, and the card's hue (`cardHue`), which `artFor` always sets. Optional so a
 * spec written by hand (a gallery, a test) still type checks; `CardArt` reads a missing hue as
 * amber, the brand.
 */
export type ArtSpec = ArtShape & { hue?: HueName };

/** A session, as much of it as the art reads. */
export interface ArtSession {
  started_at: string;
  ended_at: string;
  attended_seconds?: number | null;
  /** `stats.lines_added_agent`, when the phone holds the detail. */
  lines?: number | null;
  /** `stats.human_prompt_count`, when the phone holds the detail. */
  prompts?: number | null;
}

export interface ArtSources {
  /** Hours per day, oldest first (`Profile.graph`). */
  graph: readonly { date: string; active_seconds: number }[] | null;
  /** Days with a commit and how many (`report.contributions.days`). */
  commitDays: readonly { day: string; commits: number }[] | null;
  /** The day the commit row ends on: the report's `generated_at`. */
  windowEnd: string | null;
  sessions: readonly ArtSession[] | null;
  /** The longest session's strip, base64 of 1024 columns. */
  longestStrip: string | null;
  /**
   * The deck's builder type: card one's `value_id`, an archetype id. Cards two and three read it
   * to step off card one's hue when card one already wears theirs (`cardHue`, `spectrum.cardAlt`),
   * so no card meets its own hue across or down the grid. Absent, card one still reads its own
   * answer and every other card wears its own hue: only a velocity machine's or a skeptic's deck
   * can then show two neighbours in one hue, which is why the deck should set it.
   */
  archetype?: string | null;
}

export const NO_SOURCES: ArtSources = { graph: null, commitDays: null, windowEnd: null, sessions: null, longestStrip: null };

// ─── seeds and noise ────────────────────────────────────────────────────────────────────

/** FNV-1a over the text: one card id, one seed, on every phone. */
export function seedOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** An integer lattice hash in [0, 1): the same cell and seed give the same value, always. */
export function hash3(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise on the integer lattice, smoothly interpolated. */
function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const a = hash3(ix, iy, seed);
  const b = hash3(ix + 1, iy, seed);
  const c = hash3(ix, iy + 1, seed);
  const d = hash3(ix + 1, iy + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

// ─── procedural motifs ──────────────────────────────────────────────────────────────────

/**
 * A motif as a function of the cell centre (u, v in 0..1) and the box's aspect (width over
 * height), so a circle stays round in any header. `amount` is the scatter's inked share.
 */
export function motifFn(motif: Motif, seed: number, aspect: number, amount = 0): (u: number, v: number) => number {
  const r = mulberry32(seed);
  switch (motif) {
    case 'orb': {
      // A dithered sphere lit from a seeded upper side, sitting on its own shadow.
      const cx = 0.5 + (r() - 0.5) * 0.24;
      const cy = 0.45;
      const R = 0.33;
      const lx = r() < 0.5 ? -0.55 : 0.55;
      const ly = -0.55 - r() * 0.2;
      const lz = 0.62;
      const ln = Math.hypot(lx, ly, lz);
      return (u, v) => {
        const X = (u - cx) * aspect;
        const Y = v - cy;
        const d = Math.hypot(X, Y) / R;
        if (d <= 1) {
          const z = Math.sqrt(1 - d * d);
          const lambert = Math.max(0, ((X / R) * lx + (Y / R) * ly + z * lz) / ln);
          return 0.96 - 0.9 * lambert;
        }
        const sx = (X + lx * 0.3 * R) / (R * 1.25);
        const sy = (Y - R * 1.02) / (R * 0.16);
        const e = sx * sx + sy * sy;
        return e < 1 ? 0.32 * (1 - e) : 0;
      };
    }
    case 'ripples': {
      // The same words, coming back: rings out from a seeded point, fading with distance.
      const cx = 0.22 + r() * 0.2;
      const cy = 0.42 + r() * 0.16;
      const k = 5 + r() * 2;
      const rings = Math.min(MAX_RINGS, Math.round(amount));
      if (rings >= 1) {
        // One ring for every send (`amount`), evenly out to `RING_REACH`, the nearest in ink
        // and each further one a step lighter: the prompt, and each time it came back.
        const thick = Math.min(0.05, (0.4 * RING_REACH) / rings);
        return (u, v) => {
          const d = Math.hypot((u - cx) * aspect, v - cy);
          if (d < 0.045) return 1;
          for (let i = 0; i < rings; i++) {
            if (Math.abs(d - (RING_REACH * (i + 1)) / rings) < thick / 2) return 0.92 - (0.5 * i) / rings;
          }
          return 0;
        };
      }
      return (u, v) => {
        const d = Math.hypot((u - cx) * aspect, v - cy);
        const ring = 0.5 + 0.5 * Math.cos(2 * Math.PI * d * k);
        const fall = Math.max(0, 1 - d / 1.25);
        return d < 0.05 ? 1 : ring * Math.pow(fall, 0.8);
      };
    }
    case 'burst': {
      // A jagged star: seeded spikes of seeded length round a solid core.
      const cx = 0.42 + r() * 0.16;
      const cy = 0.46 + (r() - 0.5) * 0.1;
      const n = 9 + Math.floor(r() * 7);
      const phase = r() * Math.PI * 2;
      const reach = Array.from({ length: n }, () => 0.32 + r() * 0.36);
      return (u, v) => {
        const X = (u - cx) * aspect;
        const Y = v - cy;
        const d = Math.hypot(X, Y);
        if (d < 0.07) return 1;
        const a = (Math.atan2(Y, X) + Math.PI + phase) / (Math.PI * 2);
        const pos = (((a * n) % n) + n) % n;
        const i = Math.floor(pos);
        const local = pos - i;
        const tip = 1 - Math.abs(local - 0.5) * 2;
        const extent = reach[i % n]! * (0.3 + 0.7 * tip * tip);
        return d < extent ? 1 - (d / extent) * 0.55 : 0;
      };
    }
    case 'blocks': {
      // A mosaic of hashed blocks, some split finer: text nobody could read.
      const nx = Math.max(6, Math.round(9 * aspect));
      const ny = 9;
      return (u, v) => {
        const bx = Math.floor(u * nx);
        const by = Math.floor(v * ny);
        let h = hash3(bx, by, seed);
        if (hash3(bx, by, seed + 7) > 0.78) h = hash3(Math.floor(u * nx * 2), Math.floor(v * ny * 2), seed + 13);
        if (h < 0.42) return 0;
        return h < 0.62 ? 0.3 : h < 0.82 ? 0.62 : 1;
      };
    }
    case 'lines': {
      // A paragraph's silhouette: lines of seeded length, with paragraph breaks.
      const lineH = 0.07;
      const gap = 0.05;
      const lines: { top: number; length: number }[] = [];
      let top = 0.1;
      while (top + lineH < 0.94) {
        const end = r() < 0.24;
        lines.push({ top, length: end ? 0.2 + r() * 0.3 : 0.62 + r() * 0.3 });
        top += lineH + gap + (end ? gap * 1.4 : 0);
      }
      return (u, v) => {
        for (const l of lines) {
          if (v >= l.top && v < l.top + lineH) return u >= 0.06 && u < 0.06 + l.length * 0.88 ? 0.92 : 0;
        }
        return 0;
      };
    }
    case 'waves': {
      // Two voices, back and forth: sine bands half a turn apart, a faint field between.
      const f = 1.1 + r() * 0.7;
      const amp = 0.2 + r() * 0.08;
      const phase = r() * Math.PI * 2;
      const thick = 0.055;
      return (u, v) => {
        const a = 2 * Math.PI * (f * u) + phase;
        const y1 = 0.5 + amp * Math.sin(a);
        const y2 = 0.5 + amp * Math.sin(a + Math.PI);
        const b1 = 1 - smooth(clamp01(Math.abs(v - y1) / thick));
        const b2 = 1 - smooth(clamp01(Math.abs(v - y2) / thick));
        const between = v > Math.min(y1, y2) && v < Math.max(y1, y2) ? 0.16 : 0;
        return Math.max(b1, b2 * 0.7, between);
      };
    }
    case 'scatter': {
      // Blocks inked at exactly `amount` of them, chosen by hash: the card's share, drawn.
      const nx = Math.max(8, Math.round(10 * aspect));
      const ny = 10;
      const order = Array.from({ length: nx * ny }, (_, i) => ({ i, h: hash3(i % nx, Math.floor(i / nx), seed) }))
        .sort((a, b) => a.h - b.h || a.i - b.i)
        .map((c) => c.i);
      const inked = new Set(order.slice(0, Math.round(clamp01(amount) * nx * ny)));
      return (u, v) => {
        const bx = Math.min(nx - 1, Math.floor(u * nx));
        const by = Math.min(ny - 1, Math.floor(v * ny));
        const fx = u * nx - bx;
        const fy = v * ny - by;
        if (fx > 0.82 || fy > 0.82) return 0; // paper between blocks, so it reads as a count
        return inked.has(by * nx + bx) ? SCATTER_INK : 0.07;
      };
    }
    case 'drift':
    default: {
      // The generic fallback: two octaves of seeded value noise, heavier toward the bottom.
      return (u, v) => {
        const n = 0.65 * valueNoise(u * 3.2 * aspect, v * 3.2, seed) + 0.35 * valueNoise(u * 7 * aspect, v * 7, seed + 1);
        return clamp01((n - 0.18) * 1.25 * (0.35 + 0.65 * v));
      };
    }
  }
}

/** The most rings the go to prompt card draws; past this the rings would merge into a disc. */
export const MAX_RINGS = 12;
/** How far out the last ring sits, in the header's heights. */
const RING_REACH = 0.82;
/** An inked scatter block: dense, and short of a flat solid square. */
export const SCATTER_INK = 0.86;

function motif(m: Motif, seed: number, amount = 0): ArtShape {
  return { kind: 'motif', motif: m, seed, amount, basis: 'procedural' };
}

// ─── data into shapes ───────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** 'YYYY-MM-DD' (or a full ISO clock) to a whole UTC day number; NaN when unreadable. */
export function dayNumber(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return NaN;
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS);
}

/** Monday 0 to Sunday 6, the contribution grid's row order. */
function weekday(day: number): number {
  return (new Date(day * DAY_MS).getUTCDay() + 6) % 7;
}

/**
 * The contribution grid as rows of weekdays by columns of weeks, the most recent week on
 * the right, each day its hours through `graphLevel`, the same absolute buckets the You
 * tab's grid colours by. `weeks` wide. Null when no day in it has any time at all.
 */
export function activityGrid(graph: readonly { date: string; active_seconds: number }[], weeks: number): number[][] | null {
  const days = graph
    .map((g) => ({ day: dayNumber(g.date), s: g.active_seconds }))
    .filter((g) => Number.isFinite(g.day))
    .sort((a, b) => a.day - b.day);
  if (days.length === 0) return null;
  const last = days[days.length - 1]!.day;
  const pad = 6 - weekday(last);
  const grid = Array.from({ length: 7 }, () => new Array<number>(weeks).fill(0));
  let any = false;
  for (const d of days) {
    const col = weeks - 1 - Math.floor((last - d.day + pad) / 7);
    if (col < 0) continue;
    const v = graphLevel(d.s) / 5;
    if (v > 0) any = true;
    grid[weekday(d.day)]![col] = v;
  }
  return any ? grid : null;
}

/**
 * One value per day from the first commit day to `end`, 0 on a day with none. A day with a
 * commit is at least 0.4 ink so a single commit still reads; more commits, denser.
 */
export function commitRow(days: readonly { day: string; commits: number }[], end: string | null): number[] | null {
  const hits = days.map((d) => ({ day: dayNumber(d.day), n: d.commits })).filter((d) => Number.isFinite(d.day) && d.n > 0);
  if (hits.length === 0) return null;
  hits.sort((a, b) => a.day - b.day);
  const first = hits[0]!.day;
  const endDay = Math.max(hits[hits.length - 1]!.day, end ? dayNumber(end) || 0 : 0);
  const max = hits.reduce((m, h) => Math.max(m, h.n), 1);
  const byDay = new Map(hits.map((h) => [h.day, h.n]));
  const out: number[] = [];
  for (let d = first; d <= endDay; d++) {
    const n = byDay.get(d) ?? 0;
    out.push(n > 0 ? 0.4 + 0.6 * Math.min(1, n / max) : 0);
  }
  return out;
}

/** A strip's 1024 columns as heights: idle is nothing, activity is its 2 bit density. */
export function stripHeights(b64: string): number[] | null {
  try {
    const bytes = decodeStrip(b64);
    const out = Array.from(bytes, (b) => {
      const c = unpackByte(b);
      return c.klass === StripClass.idle ? 0 : (c.density + 1) / 4;
    });
    return out.some((v) => v > 0) ? out : null;
  } catch {
    // A strip this build cannot decode is drawn as nothing rather than guessed at.
    return null;
  }
}

function spanOf(s: ArtSession): [number, number] | null {
  const a = Date.parse(s.started_at);
  const b = Date.parse(s.ended_at);
  return Number.isFinite(a) && Number.isFinite(b) && b > a ? [a, b] : null;
}

/** UNMEASURED JUDGEMENT CALL: six lanes fill a header; a seventh would be a sliver. */
export const MAX_LANES = 6;

/**
 * The busiest moment among `sessions` and everything around it, packed into lanes: the
 * sessions running at that moment are the solid ones. The sweep puts an end before a start
 * at the same instant, so a handoff never reads as two at once (analysis/agents.py's rule).
 * Session windows carry the trailing idle credit, so this can overlap a little more than
 * the card's own first to last event count; it draws the shape, the card says the number.
 */
export function peakLanes(sessions: readonly ArtSession[]): Lane[][] | null {
  const spans = sessions.map(spanOf).filter((s): s is [number, number] => s !== null);
  if (spans.length < 2) return null;
  const events = spans.flatMap(([a, b]) => [
    { t: a, d: 1 },
    { t: b, d: -1 },
  ]);
  events.sort((x, y) => x.t - y.t || x.d - y.d);
  let now = 0;
  let peak = 0;
  let at = events[0]!.t;
  for (const e of events) {
    now += e.d;
    if (now > peak) {
      peak = now;
      at = e.t;
    }
  }
  if (peak < 1) return null;
  const busy = spans.filter(([a, b]) => a <= at && at < b);
  const lo0 = Math.min(...busy.map((s) => s[0]));
  const hi0 = Math.max(...busy.map((s) => s[1]));
  const padBy = (hi0 - lo0) * 0.08;
  const lo = lo0 - padBy;
  const hi = hi0 + padBy;
  const inView = spans
    .filter(([a, b]) => b > lo && a < hi)
    .map(([a, b]) => ({ a, b, peak: a <= at && at < b }))
    .sort((x, y) => x.a - y.a || x.b - y.b);
  const lanes: { end: number; items: Lane[] }[] = [];
  for (const s of inView) {
    const item: Lane = { from: clamp01((s.a - lo) / (hi - lo)), to: clamp01((s.b - lo) / (hi - lo)), peak: s.peak };
    const lane = lanes.find((l) => l.end <= s.a);
    if (lane) {
      lane.items.push(item);
      lane.end = s.b;
    } else if (lanes.length < MAX_LANES) {
      lanes.push({ end: s.b, items: [item] });
    }
  }
  return lanes.map((l) => l.items);
}

function byStart(sessions: readonly ArtSession[]): ArtSession[] {
  return [...sessions].filter((s) => Number.isFinite(Date.parse(s.started_at))).sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
}

/** Lines summed session by session, 0 to 1 of the total. Null under three sessions with lines. */
export function cumulativeLines(sessions: readonly ArtSession[]): number[] | null {
  const withLines = byStart(sessions).filter((s) => typeof s.lines === 'number' && s.lines >= 0);
  const total = withLines.reduce((t, s) => t + (s.lines ?? 0), 0);
  if (withLines.length < 3 || total <= 0) return null;
  let run = 0;
  return withLines.map((s) => {
    run += s.lines ?? 0;
    return run / total;
  });
}

/** Three hours tops a bar: the longest attended sittings measured are about that (3h 06m). */
export const ATTENDED_BAR_CAP_SEC = 3 * 3600;
/** A deep session is an attended hour (wrapped.DEEP_MIN_ATTENDED_SEC). Its bar is solid. */
export const DEEP_SEC = 3600;

export function attendedBars(sessions: readonly ArtSession[]): { h: number; d: number }[] | null {
  const bars = byStart(sessions)
    .filter((s) => typeof s.attended_seconds === 'number')
    .map((s) => {
      const a = s.attended_seconds ?? 0;
      return { h: Math.min(1, a / ATTENDED_BAR_CAP_SEC), d: a >= DEEP_SEC ? 1 : 0.34 };
    });
  return bars.length >= 3 && bars.some((b) => b.h > 0) ? bars : null;
}

export function promptBars(sessions: readonly ArtSession[]): { h: number; d: number }[] | null {
  const withPrompts = byStart(sessions).filter((s) => typeof s.prompts === 'number');
  const max = withPrompts.reduce((m, s) => Math.max(m, s.prompts ?? 0), 0);
  if (withPrompts.length < 3 || max <= 0) return null;
  return withPrompts.map((s) => ({ h: (s.prompts ?? 0) / max, d: 0.86 }));
}

/** The shares behind the kind of work card, largest first, from the basis that answered. */
export function kindShares(card: ReportWrappedCard): { shares: number[]; basis: ArtBasis } | null {
  const x = card.extras;
  const counts =
    card.basis === 'commit_subject_labels'
      ? (x.kinds ?? []).map((k) => k.commits)
      : (x.role_lines ?? []).filter((r: { role: PlainRole; lines: number }) => r.lines > 0).map((r) => r.lines);
  const total = counts.reduce((t, n) => t + n, 0);
  if (total <= 0) return null;
  return {
    shares: counts.map((n) => n / total).sort((a, b) => b - a),
    basis: card.basis === 'commit_subject_labels' ? 'kind_split' : 'role_split',
  };
}

// ─── which header each card gets ────────────────────────────────────────────────────────

/** The motif each procedural card draws, and whether its seed is the answer or the card. */
const MOTIFS: Partial<Record<WrappedCard, Motif>> = {
  builder_type: 'orb',
  work_style: 'waves',
  go_to_prompt: 'ripples',
  crash_out: 'burst',
  prompt_length: 'lines',
  cryptic_prompt: 'blocks',
};

/** The weeks the activity grid shows: square days in a header this shape, 6 to 17 weeks. */
export function weeksFor(aspect: number): number {
  return Math.max(6, Math.min(17, Math.round(7 * aspect)));
}

/**
 * The archetype card one wears, as `cardHue` wants it: card one's own answer when it has one
 * (a refused builder type is the generalist, amber), and the deck's (`ArtSources.archetype`) for
 * every other card.
 */
export function deckArchetype(card: ReportWrappedCard, src: ArtSources): string | null {
  if (card.id === 'builder_type') return card.reason == null ? (card.value_id ?? null) : null;
  return src.archetype ?? null;
}

/** A card's hue name: `tokens.spectrum.card` through `cardHue`, card one and `cardAlt` included. */
export function artHue(card: ReportWrappedCard, src: ArtSources): HueName {
  return cardHue(card.id, deckArchetype(card, src)).name;
}

/**
 * The header's two tones for a scheme (DESIGN-V2 1.4): the hue's ink for the highlights, its
 * partner for the midtones, paper (the card, through a transparent canvas) for the rest. On
 * light, the 3:1 mark tone and the light partner. A refused card keeps its hue: `FADED_INK`
 * thins its field to the partner level, so it reads as absent and still as itself.
 */
export function artTones(name: HueName, scheme: Scheme): { ink: string; partner: string } {
  const h = hueOf(name, scheme);
  return { ink: h.ink, partner: h.partner };
}

/**
 * The header for one card. `aspect` is the header box's width over its height, which the
 * activity grid needs to keep its days square. A refused card gets its seeded field: it
 * has no answer to draw, and `CardArt` thins it (`FADED_INK`) so it reads as absent.
 */
export function artFor(card: ReportWrappedCard, src: ArtSources, aspect = 1.6): ArtSpec {
  return { ...shapeFor(card, src, aspect), hue: artHue(card, src) };
}

function shapeFor(card: ReportWrappedCard, src: ArtSources, aspect: number): ArtShape {
  const fallback = motif(MOTIFS[card.id] ?? 'drift', seedOf(card.value_id ? `${card.id}:${card.value_id}` : card.id));
  if (card.reason != null) return fallback;
  switch (card.id) {
    case 'time_put_in': {
      const grid = src.graph ? activityGrid(src.graph, weeksFor(aspect)) : null;
      return grid ? { kind: 'grid', grid, basis: 'activity_grid' } : fallback;
    }
    case 'longest_session': {
      const heights = src.longestStrip ? stripHeights(src.longestStrip) : null;
      return heights ? { kind: 'series', series: heights, shape: 'area', basis: 'session_strip' } : fallback;
    }
    case 'agents_at_once': {
      const lanes = src.sessions ? peakLanes(src.sessions) : null;
      if (lanes) return { kind: 'lanes', lanes, basis: 'peak_overlap' };
      // No sessions on this phone to draw the overlap from: the card's own count of helper
      // agents, one square each, the most that ran at once in ink (the analysis page's
      // "every agent that ran, one square each"). Exact numbers from the report, never a shape.
      const total = card.extras.subagents;
      const peak = card.extras.subagents_peak;
      return typeof total === 'number' && total > 0
        ? { kind: 'tally', total: Math.min(MAX_TALLY, Math.round(total)), lit: Math.min(Math.round(total), Math.max(0, Math.round(peak ?? 0))), basis: 'agent_count' }
        : fallback;
    }
    case 'streak': {
      const values = src.commitDays ? commitRow(src.commitDays, src.windowEnd) : null;
      return values ? { kind: 'row', values, basis: 'commit_days' } : fallback;
    }
    case 'shipped': {
      const series = src.sessions ? cumulativeLines(src.sessions) : null;
      return series ? { kind: 'series', series, shape: 'area', basis: 'cumulative_lines' } : fallback;
    }
    case 'change_course':
      return typeof card.value === 'number'
        ? { kind: 'motif', motif: 'scatter', seed: seedOf(card.id), amount: clamp01(card.value), basis: 'card_share' }
        : fallback;
    case 'kind_of_work': {
      const split = kindShares(card);
      return split ? { kind: 'bands', shares: split.shares, basis: split.basis } : fallback;
    }
    case 'deep_sessions': {
      const bars = src.sessions ? attendedBars(src.sessions) : null;
      return bars ? { kind: 'bars', bars, basis: 'attended_per_session' } : fallback;
    }
    case 'prompts_per_session': {
      const bars = src.sessions ? promptBars(src.sessions) : null;
      return bars ? { kind: 'bars', bars, basis: 'prompts_per_session' } : fallback;
    }
    case 'go_to_prompt': {
      // The card's own count of sends: one ring each. A count under 2 is no repetition.
      const sends = card.value;
      return typeof sends === 'number' && sends >= 2
        ? { kind: 'motif', motif: 'ripples', seed: fallbackSeed(card), amount: Math.min(MAX_RINGS, Math.round(sends)), basis: 'send_count' }
        : fallback;
    }
    case 'prompt_length': {
      const mean = card.value;
      const median = card.extras.median;
      if (typeof mean !== 'number' || !(mean > 0)) return fallback;
      const words = Math.min(MAX_PARAGRAPH_WORDS, mean);
      return {
        kind: 'words',
        words,
        lit: typeof median === 'number' && median > 0 ? Math.min(words, median) : 0,
        seed: seedOf(card.id),
        basis: 'prompt_words',
      };
    }
    default:
      return fallback;
  }
}

function fallbackSeed(card: ReportWrappedCard): number {
  return seedOf(card.value_id ? `${card.id}:${card.value_id}` : card.id);
}

/** A paragraph longer than this is drawn at this: the blocks would shrink under a cell. */
export const MAX_PARAGRAPH_WORDS = 90;
/** The most squares a tally draws; past it a square would be under two cells. */
export const MAX_TALLY = 240;

/** Where each of `total` squares sits in `cols` by `rows` cells: the largest square that fits them all, in reading order. */
export function tallyBlocks(total: number, cols: number, rows: number): { x: number; y: number; s: number }[] {
  const n = Math.max(0, Math.floor(total));
  if (n === 0) return [];
  const margin = 2;
  const w = cols - margin * 2;
  const h = rows - margin * 2;
  for (let s = 12; s >= 1; s--) {
    const gap = Math.max(1, Math.round(s * 0.34));
    const per = Math.floor((w + gap) / (s + gap));
    if (per < 1) continue;
    const lines = Math.ceil(n / per);
    if (lines * (s + gap) - gap > h) continue;
    return Array.from({ length: n }, (_, i) => ({ x: margin + (i % per) * (s + gap), y: margin + Math.floor(i / per) * (s + gap), s }));
  }
  return [];
}

/** A word block in the paragraph, placed in cells. */
export interface WordBlock {
  x: number;
  y: number;
  w: number;
  h: number;
  lit: boolean;
}

/**
 * The paragraph laid out in `cols` by `rows` cells: `ceil(words)` blocks of seeded widths, the
 * last one cut to the decimal (29.9 words: 30 blocks, the last 0.9 of its width), wrapped left
 * to right, at the largest scale whose lines fit. The first `lit` blocks (the median prompt) are
 * lit. Deterministic in its arguments.
 */
export function paragraphBlocks(words: number, lit: number, seed: number, cols: number, rows: number): WordBlock[] {
  const count = Math.max(0, Math.ceil(words - 1e-9));
  if (count === 0 || cols < 6 || rows < 4) return [];
  const r = mulberry32(seed);
  const rel = Array.from({ length: count }, () => 0.55 + r() * 1.1);
  const frac = words - Math.floor(words);
  if (frac > 1e-9) rel[count - 1] = rel[count - 1]! * frac;
  const margin = 2;
  for (let k = 16; k >= 1; k--) {
    const h = Math.max(1, Math.round(k * 0.55));
    const gap = Math.max(1, Math.round(k * 0.3));
    const lead = Math.max(1, Math.round(k * 0.45));
    const out: WordBlock[] = [];
    let x = margin;
    let y = margin;
    let fits = true;
    for (let i = 0; i < count; i++) {
      const w = Math.max(1, Math.round(k * rel[i]!));
      if (x + w > cols - margin && x > margin) {
        x = margin;
        y += h + lead;
      }
      if (x + w > cols - margin || y + h > rows - margin) {
        fits = false;
        break;
      }
      out.push({ x, y, w, h, lit: i < Math.round(lit) });
      x += w + gap;
    }
    if (fits) return out;
  }
  return [];
}

// ─── specs into fields ──────────────────────────────────────────────────────────────────

/** A refused card's header is drawn at this much of its ink: present, and plainly thinner. */
export const FADED_INK = 0.35;

/** Paper between neighbouring data blocks, in cells, once a block is at least 3 cells. */
const GAP = 1;

function blockField(cols: number, rows: number, fill: (x: number, y: number) => number): Field {
  const data = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) data[y * cols + x] = clamp01(fill(x, y));
  return { width: cols, height: rows, data };
}

/** Which of `n` equal spans across `size` cells a cell is in, and whether it is the span's gap. */
function spanAt(i: number, n: number, size: number): { k: number; gap: boolean } {
  const k = Math.min(n - 1, Math.floor((i * n) / size));
  const end = Math.floor(((k + 1) * size) / n);
  const start = Math.floor((k * size) / n);
  return { k, gap: end - start >= 3 && i >= end - GAP };
}

/**
 * The field for a spec, exactly `cols` by `rows` cells (one pixel per dither cell, which the
 * kit's `Dither` samples nearest, so every datum's edge lands on a cell edge).
 */
export function fieldOf(spec: ArtSpec, cols: number, rows: number, options: { faded?: boolean } = {}): Field {
  const field = rawField(spec, cols, rows);
  if (options.faded) for (let i = 0; i < field.data.length; i++) field.data[i] = field.data[i]! * FADED_INK;
  return field;
}

function rawField(spec: ArtShape, cols: number, rows: number): Field {
  switch (spec.kind) {
    case 'grid':
      return fieldFromGrid(spec.grid, cols, rows, { gap: GAP });
    case 'series':
      return fieldFromSeries(spec.series, cols, rows, { shape: spec.shape, fill: 0.42 });
    case 'row': {
      // One bar a day, as tall as its commits (the row's value), a partner body under an ink
      // cap: a skyline of shipping days. At most a third of the columns as days, so each day
      // keeps its gap; the most recent days are kept.
      const n = Math.max(1, Math.min(spec.values.length, Math.floor(cols / 3)));
      const values = spec.values.slice(-n);
      return blockField(cols, rows, (x, y) => {
        const s = spanAt(x, values.length, cols);
        if (s.gap) return 0;
        const v = values[s.k] ?? 0;
        const h = v > 0 ? Math.max(BAR_CAP_CELLS + 1, Math.round(v * rows)) : 0;
        const fromBottom = rows - 1 - y;
        if (fromBottom >= h) return 0;
        return fromBottom >= h - BAR_CAP_CELLS ? ROW_INK : ROW_INK * BAR_BODY;
      });
    }
    case 'bars': {
      // One bar per session, bottom aligned, each its own density: a partner body under a cap
      // of its full ink, so a bar reads as a measured bar and never a flat block. The latest
      // ones that fit at two cells a bar, so bars never merge into a block.
      const n = Math.max(1, Math.min(spec.bars.length, Math.floor(cols / 2)));
      const bars = spec.bars.slice(-n);
      return blockField(cols, rows, (x, y) => {
        const s = spanAt(x, bars.length, cols);
        const start = Math.floor((s.k * cols) / bars.length);
        const end = Math.floor(((s.k + 1) * cols) / bars.length);
        if (end - start >= 2 && x === end - 1) return 0;
        const bar = bars[s.k]!;
        const h = bar.h > 0 ? Math.max(1, Math.round(bar.h * rows)) : 0;
        const fromBottom = rows - 1 - y;
        if (fromBottom >= h) return 0;
        return fromBottom >= h - BAR_CAP_CELLS ? bar.d : bar.d * BAR_BODY;
      });
    }
    case 'lanes': {
      // Each session a lane, its density the share of the busiest moment's sessions running at
      // that instant: faint where one ran alone, densest where they all overlapped, so the
      // answer ("3 at once") is the darkest stretch of the picture. A session's first and last
      // cells thin out, so a lane has ends rather than square corners.
      const n = Math.max(1, spec.lanes.length);
      const items = spec.lanes.flat();
      const running = new Float32Array(cols);
      let most = 0;
      for (let x = 0; x < cols; x++) {
        const u = (x + 0.5) / cols;
        let c = 0;
        for (const it of items) if (u >= it.from && u < it.to) c += 1;
        running[x] = c;
        if (c > most) most = c;
      }
      return blockField(cols, rows, (x, y) => {
        const s = spanAt(y, n, rows);
        if (s.gap) return 0;
        const u = (x + 0.5) / cols;
        for (const item of spec.lanes[s.k] ?? []) {
          if (u >= item.from && u < item.to) {
            const share = most > 0 ? running[x]! / most : 0;
            const edge = Math.min(u - item.from, item.to - u) * cols;
            const taper = edge < 1 ? 0.55 : edge < 2 ? 0.8 : 1;
            return (item.peak ? LANE_PEAK[0] + LANE_PEAK[1] * share : LANE_REST[0] + LANE_REST[1] * share) * taper;
          }
        }
        return 0;
      });
    }
    case 'tally': {
      const data = new Float32Array(cols * rows);
      tallyBlocks(spec.total, cols, rows).forEach((b, i) => {
        const v = i < spec.lit ? WORD_LIT : WORD_UNLIT;
        for (let y = b.y; y < b.y + b.s; y++) for (let x = b.x; x < b.x + b.s; x++) data[y * cols + x] = v;
      });
      return { width: cols, height: rows, data };
    }
    case 'words': {
      const blocks = paragraphBlocks(spec.words, spec.lit, spec.seed, cols, rows);
      const data = new Float32Array(cols * rows);
      for (const b of blocks) {
        for (let y = b.y; y < b.y + b.h; y++) {
          for (let x = b.x; x < b.x + b.w; x++) data[y * cols + x] = b.lit ? WORD_LIT : WORD_UNLIT;
        }
      }
      return { width: cols, height: rows, data };
    }
    case 'bands': {
      // The split as vertical bands, largest first, each a step lighter.
      const edges: number[] = [];
      let at = 0;
      for (const s of spec.shares) {
        at += s;
        edges.push(at);
      }
      const total = at || 1;
      return blockField(cols, rows, (x) => {
        const u = (x + 0.5) / cols;
        let k = 0;
        while (k < edges.length - 1 && u * total >= edges[k]!) k++;
        const right = Math.floor((edges[k]! / total) * cols);
        const left = k === 0 ? 0 : Math.floor((edges[k - 1]! / total) * cols);
        if (right - left >= 3 && x >= right - GAP && k < edges.length - 1) return 0;
        return BAND_INK[Math.min(k, BAND_INK.length - 1)]!;
      });
    }
    case 'motif':
      return fieldFromFunction(cols, rows, motifFn(spec.motif, spec.seed, cols / Math.max(1, rows), spec.amount));
  }
}

/**
 * Band densities, largest share first. UNMEASURED JUDGEMENT CALL: a step the dither shows. The
 * largest stops short of solid (0.88: one cell in four of its partner shows), so the split is
 * printed, not a flat slab.
 */
export const BAND_INK = [0.88, 0.62, 0.42, 0.3, 0.22, 0.16, 0.12, 0.09, 0.07] as const;

/** A bar's cap, in cells, drawn at the bar's full density over a body at `BAR_BODY` of it. */
export const BAR_CAP_CELLS = 2;
export const BAR_BODY = 0.62;
/** The commit skyline's density: a day is a day, its height is how much landed. */
const ROW_INK = 0.9;
/** A lane's density: base + span x (the share of the busiest moment's sessions running then). */
export const LANE_PEAK = [0.4, 0.52] as const;
export const LANE_REST = [0.16, 0.34] as const;
/** The median prompt's words, and the rest of the average one. */
export const WORD_LIT = 0.9;
export const WORD_UNLIT = 0.4;

// ─── the three levels, as the kit draws them ────────────────────────────────────────────

/** A cell of the three level recipe: 0 paper, 1 the partner tone, 2 the ink. */
export type ToneLevel = 0 | 1 | 2;

/**
 * DESIGN-V2 1.4's recipe for one cell, at an ink amount `v` (0..1) and the cell's Bayer
 * threshold `b`: the lower half of the range dithers partner over paper, the upper half ink
 * over partner. `v` 0 stays paper, `v` 1 is solid ink, `v` 0.5 is solid partner. It is the
 * ported components' rule (`level3`), not a second copy of it, so a Wrapped header and a
 * spotlight or a ProfileCard field can never disagree about which cell is which tone.
 */
export function toneLevel(v: number, b: number): ToneLevel {
  return level3(clamp01(v), b);
}

/** The recipe over a field, one level per cell, after the 8 bit grey the shader reads. */
export function toneMask(field: Field): Uint8Array {
  const out = new Uint8Array(field.width * field.height);
  for (let y = 0; y < field.height; y++) {
    for (let x = 0; x < field.width; x++) {
      const i = y * field.width + x;
      out[i] = toneLevel(quantize(field.data[i] ?? 0), bayer8(x, y));
    }
  }
  return out;
}

/**
 * The recipe as two ONE level layers the kit's `Dither` can draw today: `partner`, inked
 * wherever `min(1, 2v)` passes the threshold, and `ink`, wherever `max(0, 2v - 1)` does. The
 * ink layer drawn over the partner layer, both on transparent paper, IS the three level
 * recipe cell for cell (the test walks every grey level against every Bayer threshold), so a
 * card can wear its two tones before the kit's shader grows a `partner` uniform, and draws
 * the same when it does.
 */
export function toneLayers(field: Field): { partner: Field; ink: Field } {
  const n = field.width * field.height;
  const partner = new Float32Array(n);
  const ink = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = quantize(field.data[i] ?? 0);
    partner[i] = Math.min(1, v * 2);
    ink[i] = Math.max(0, v * 2 - 1);
  }
  return {
    partner: { width: field.width, height: field.height, data: partner },
    ink: { width: field.width, height: field.height, data: ink },
  };
}
