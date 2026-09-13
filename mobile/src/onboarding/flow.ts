/**
 * The onboarding flow as data: the order of the steps, which of them the progress bar
 * covers, where back exists, and every number the motion uses. Pure (no React Native, no
 * expo), so `__tests__/onboarding.test.ts` and `__tests__/onboardingHouse.test.ts` hold all of
 * it in bun.
 *
 * DESIGN-DIRECTION 4, redrawn in the house style (design-refs/HOUSE-STYLE.md, 2026-09-13): every
 * step is a chapter that opens on a full bleed band in the builder's colour, and the colour is
 * the creature's. Hello (step 0) and the finale sit outside the bars; the five bars cover name,
 * creature, tools, connect and notify, so the bar is only full on the last step that asks
 * something (four bars that were full on connect, with two screens still to come, told a person
 * they were done when they were not). "That's me" (`done`) is the last route: it flips the
 * onboarded gate, and `Stack.Protected` in the root layout drops every onboarding route in the
 * same render, so back can never re-enter the flow.
 *
 * Where a number came from is said beside it. The owner's sources, GPL ones included, gave
 * NUMBERS AND PATTERNS only, never code:
 *   appllama-top-welcome-screens   duolingo, yazio, speak-language, hallow, scrl, speak-learn
 *                                  (docs/MOTION_SPEC.md and each screen's timeline); their 640pt
 *                                  canvas is converted at about 1.63 to 1
 *   appllama-liquid-glass-screens  the swipe up hero and the blur line (docs/MOTION_SPEC.md)
 *   appllama-top-paywall-screens   facetune's trial timeline (src/paywalls/facetune.tsx)
 *   awesome-ios-design-md          duolingo (the mascot, the 3D ledge), cash-app (the one huge
 *                                  typed value)
 */

/** Every route under `app/onboarding/`, in the order a person meets them. */
export const FLOW = ['hello', 'name', 'creature', 'tools', 'connect', 'notify', 'done'] as const;
export type FlowStep = (typeof FLOW)[number];
export type FlowPath = `/onboarding/${FlowStep}`;

/** The steps the segmented progress bar counts: every step that asks something. */
export const PROGRESS_STEPS = ['name', 'creature', 'tools', 'connect', 'notify'] as const satisfies readonly FlowStep[];

export function isFlowStep(value: string | null | undefined): value is FlowStep {
  return typeof value === 'string' && (FLOW as readonly string[]).includes(value);
}

export function pathFor(step: FlowStep): FlowPath {
  return `/onboarding/${step}`;
}

/** The route after `step`, or null after the last one (which finishes instead). */
export function nextPath(step: FlowStep): FlowPath | null {
  const next = FLOW[FLOW.indexOf(step) + 1];
  return next ? pathFor(next) : null;
}

/** How many of the bars are filled on `step`, or null where the bar is not shown. */
export function progressFor(step: FlowStep): { filled: number; total: number } | null {
  const i = (PROGRESS_STEPS as readonly FlowStep[]).indexOf(step);
  return i < 0 ? null : { filled: i + 1, total: PROGRESS_STEPS.length };
}

/**
 * Whether the step shows a back chevron. Every step with a step before it, except the
 * finale: "That's me" is a moment, not a form, and the edge swipe still works there until it
 * is pressed.
 */
export function showsBack(step: FlowStep): boolean {
  return step !== 'hello' && step !== 'done';
}

/**
 * The progress bar: react-bits Stepper's bars as the kit ports them (`ui/bits/components`,
 * `barFill`: a step's bar fills as its page arrives), at speak-language's size (44 x 6 px bars,
 * radius 4, gap 15 on the 640pt canvas). A page change is 267ms `inOut(cubic)` (speak-language's
 * page slide, 2.833 to 3.100 s), and an un-fill on the way back is 0.7 of that. The bars sit on
 * the band, so they are drawn in the band's ink over its partner tone (`Chrome.tsx`).
 */
export const PROGRESS = { width: 27, height: 3.7, radius: 2, gap: 9, pageMs: 267 } as const;

/** The chrome row above every step: the back chevron and the bars. */
export const CHROME_HEIGHT = 44;

/**
 * The chrome drawn from one number: where the flow stands, `p`, in steps (0 on hello, 1 on
 * name, 5 on notify, 6 on the finale), between two whole numbers while a push, a pop or a
 * finger on the back swipe is carrying the page. So the bars fill and empty WITH the page, a
 * swipe given up half way gives the bar back, and the chevron and the button agree.
 *
 * `fill(p, i)`: how much of bar `i` (0 based) is filled; the Stepper port's `barFill(i, p - 1)`.
 * `back(p)`: the chevron's opacity (it is ink on the band; fading is fine). `bars(p)`: whether
 * the bars show at all, a cut at the half way point to hello or to the finale.
 */
const CHROME_LAST = FLOW.length - 1;
const CHROME_BARS = PROGRESS_STEPS.length;

export function chromeFill(p: number, i: number): number {
  'worklet';
  return Math.min(1, Math.max(0, p - i));
}
export function chromeBack(p: number): number {
  'worklet';
  return Math.min(1, Math.max(0, p)) * Math.min(1, Math.max(0, CHROME_LAST - p));
}
export function chromeBars(p: number): boolean {
  'worklet';
  return p > 0.5 && p < CHROME_BARS + 0.5;
}

/** A step's place for the chrome: its index in `FLOW`. */
export function chromeIndex(step: FlowStep): number {
  return FLOW.indexOf(step);
}

/** Onboarding's side margin: the analysis page's gutter, shared by every step. */
export const GUTTER = 20;

// ─── hello ───────────────────────────────────────────────────────────────────────────

/**
 * Bit on hello: 128pt, eight whole points per cell, about a third of the screen's width
 * (duolingo's mascot is 216 of 640).
 */
export const HELLO_BIT = 128;

/**
 * Bit's two blinks on hello, measured from the moment Bit has finished printing itself: once
 * as it arrives and once more while the person reads (duolingo's welcome: the owl blinks at
 * 0.400 s and again at 2.467 s). A pixel blink is a CUT: the lids shut on one frame, hold for
 * the family's `MOTION.blink.closedMs` (120ms; duolingo holds 0.417 to 0.500 s) and open on
 * one frame. A fade on the lids spends three frames with the eye holes neither ink nor band.
 */
export const HELLO_BLINK = { atMs: [400, 2467], closedMs: 120 } as const;

/**
 * Bit printing itself on hello's band (`HelloBit`): its first cell starts `fromMs` into the band's
 * clock (the band has begun to print under it), the rest start over `spreadMs` in a random order
 * a little biased to the top, and each snaps in over `cellMs`. `HELLO_PRINT_MS` is when the last
 * one has landed, which is when Bit's blinks are counted from.
 */
export const HELLO_PRINT = { fromMs: 180, spreadMs: 450, cellMs: 90 } as const;
export const HELLO_PRINT_MS = HELLO_PRINT.fromMs + HELLO_PRINT.spreadMs + HELLO_PRINT.cellMs;

/**
 * The swipe up hero (appllama-liquid-glass-screens, "The sphere"): the finger lifts the page 1:1
 * over `travel` of the screen's height, past either end the finger's travel counts at `rubber`,
 * and a release goes on when `p + flick * v` passes `commit` (v in travel units a second). The
 * page lands on liquid glass's spring; under Reduce Motion, its stiffer one. The hint under the
 * page fades between `hintFrom` and `hintTo` of the travel, as liquid glass's hint does (0.06 to
 * 0.30). Continue does the same thing with no finger.
 */
export const HELLO_SWIPE = {
  travel: 0.28,
  rubber: 0.25,
  flick: 0.18,
  commit: 0.5,
  spring: { damping: 15, stiffness: 120, mass: 1.05 },
  reducedSpring: { damping: 30, stiffness: 160, mass: 1 },
  hintFrom: 0.06,
  hintTo: 0.3,
} as const;

/** How far the page has been lifted, 0 to 1, for a finger `dy` points from where it went down (up is negative). */
export function swipeProgress(dy: number, travel: number): number {
  'worklet';
  if (!(travel > 0)) return 0;
  // 0 minus, not unary minus: a finger that has not moved is 0, never -0.
  const raw = 0 - dy / travel;
  if (raw < 0) return raw * HELLO_SWIPE.rubber;
  if (raw > 1) return 1 + (raw - 1) * HELLO_SWIPE.rubber;
  return raw;
}

/** Whether a release at progress `p` moving at `v` (travel units a second, up is positive) goes on. */
export function swipeCommits(p: number, v: number): boolean {
  'worklet';
  return p + HELLO_SWIPE.flick * v > HELLO_SWIPE.commit;
}

/**
 * The line under hello's headline, one tool at a time: liquid glass's third line, in and out.
 * In: a blur that wipes left to right in 560ms; hold 1950ms; out 400ms; 460ms before the next.
 */
export const LINE_CYCLE = { inMs: 560, holdMs: 1950, outMs: 400, gapMs: 460 } as const;

/**
 * Hello to the name step: react-bits PixelTransition's rule (cells switch on over the page,
 * the page changes under a full cover, the cells switch off again), drawn with onboarding's
 * wave shader (`DISSOLVE_SKSL`) in the builder's colour. The screen is cut into 32pt cells
 * (four of Bit's pixels, so a cell edge never slices one of them) laid on Bit's own grid. Each
 * cell's turn is `wave` times its distance from the finger (or the Continue that was pressed)
 * plus `jitter` times its hash: the cover gathers INTO the finger (the far cells first) and
 * the reveal leaves OUT of it, so the name step's Continue, standing exactly where hello's was,
 * clears first. A cell spends `band` of its turn in the partner tone: the front.
 *
 * `wave + jitter` is 1: the last cell turns exactly when the progress reaches 1.
 * Reduce Motion: no cells; the name step fades in over 150ms.
 */
export const DISSOLVE = { cell: 32, ms: 340, band: 0.05, wave: 0.7, jitter: 0.3, reducedMs: 150 } as const;

/**
 * When the name step raises the keyboard after the cells start clearing: as the last of them
 * turn (the keyboard takes about a tenth of a second to start moving).
 */
export const KEYBOARD_AFTER_CELLS_MS = DISSOLVE.ms - 120;

// ─── the name ────────────────────────────────────────────────────────────────────────

/**
 * The typed name IS the step's headline, set as large as it fits on one line. Cash App's Pay
 * screen (design-md/finance/cash-app): the amount opens at 96pt and "auto-shrinks down to 72pt
 * then 60pt at 4 to 5 digits to keep the number on one line", with the upper 40% of the screen
 * kept for it alone. These are the steps it shrinks through; a step, not a smooth size, so
 * typing re-renders only when the name crosses one.
 */
export const NAME_SIZES = [96, 84, 72, 60, 52, 44, 38, 32, 28] as const;

/** The largest step at which `name` fits `width` on one line (`fit` measures, `insights/format.fitSize`). */
export function nameSize(name: string, width: number, fit: (text: string, width: number, max: number, min: number) => number): number {
  const text = name.length > 0 ? name : 'Your name';
  const max = NAME_SIZES[0];
  const min = NAME_SIZES[NAME_SIZES.length - 1]!;
  const fitted = fit(text, width, max, min);
  for (const s of NAME_SIZES) if (s <= fitted) return s;
  return min;
}

// ─── the creature ────────────────────────────────────────────────────────────────────

/**
 * The creature on the creature step's stage and on the "That's me" screen: the same 192pt,
 * twelve whole points per cell, so the creature a person picked is the creature they meet at
 * the end, not a smaller copy of it. Neighbours on the stage are half: six points per cell.
 */
export const STAGE_CREATURE = 192;
export const DONE_CREATURE = STAGE_CREATURE;

/**
 * The band changing colour as the centre creature changes: the band's cells switch from the old
 * hue to the new in a random order (react-bits PixelTransition's order, the kit's `hash12`),
 * over the kit's standard 240ms, in blocks of four dither cells so the switch reads as pixels
 * and never as a blend (a hue half way to another is neither). Reduce Motion: a cut.
 */
export const BAND_SHIFT = { ms: 240, block: 12 } as const;

/** The name step into the creature step: a cross fade, so the name stays where it is. */
export const NAME_TO_CREATURE_MS = 200;

/**
 * The headline wipe: a left to right reveal over 520ms on `EASE` (liquid glass's headline, 520
 * ms on bezier 0.23 1 0.32 1, which is the kit's `EASE`). On the creature step the line after
 * the name wipes in once the page has landed. Reduce Motion skips it and the words are there.
 */
export const WIPE_MS = 520;

/** Where hello's body line starts rising after its headline starts. */
export const RISE_AFTER_MS = 120;
/** How far a line rises into place. */
export const RISE_PT = 8;

// ─── the tools ───────────────────────────────────────────────────────────────────────

/**
 * The tool tiles arrive as yazio's welcome assets do (1.167 to 1.733 s): each one 67ms after the
 * last, over about 250ms on `out(back(1.5))`, from 0.94 of its size and a turn of 13 to 24
 * degrees, dropping 25 to 45px (15 to 28pt) into place, its opacity a cut at its start (colour
 * enters by position). The turns are yazio's five, in yazio's order, reused round the seven.
 */
export const TILE_POP = { stepMs: 67, ms: 250, back: 1.5, fromScale: 0.94, dropPt: 18, turns: [20, -13, 18, 24, -18] } as const;

/** When tile `i` starts arriving, in ms after the first. */
export function tilePopAt(i: number): number {
  return Math.max(0, Math.floor(i)) * TILE_POP.stepMs;
}

/** The turn tile `i` arrives from, in degrees. */
export function tilePopTurn(i: number): number {
  const t = TILE_POP.turns;
  return t[((Math.floor(i) % t.length) + t.length) % t.length]!;
}

// ─── notify ──────────────────────────────────────────────────────────────────────────

/**
 * The priming timeline (facetune's trial explainer, 390pt canvas, so these are points): 32pt
 * marks on a 3pt connector 52pt long, the words 25pt right of the mark, rows 120pt apart. The
 * first row, the one that happens first, is set in the builder's colour, the rest in the text
 * colour, as facetune sets "Today" in its blue and the later days in ink.
 */
export const TIMELINE = { mark: 32, connector: 3, connectorLength: 52, textGap: 25 } as const;

// ─── the finale ──────────────────────────────────────────────────────────────────────

/**
 * The "That's me" burst: one ring, one cell thick, of pixel squares the size of the creature's
 * own (12pt), leaving it and thinning as it goes. `from` starts just outside the creature's
 * 12 cell live area, `to` is where it has gone. The canvas is `burstBox()` square, centred on
 * the creature, and its corner sits a whole number of cells from the creature's, so the ring
 * is drawn on the creature's grid rather than beside it. On the band it is drawn in the band's
 * ink.
 */
export const BURST = { ms: 600, cell: STAGE_CREATURE / 16, from: 90, to: 190, ring: STAGE_CREATURE / 16, density: 0.85 } as const;

/** The burst canvas's side: big enough for the ring's last radius, on the creature's grid. */
export function burstBox(): number {
  const raw = 2 * (BURST.to + BURST.ring);
  // Round up so (box - creature) / 2 is a whole number of cells.
  const cells = Math.ceil((raw - DONE_CREATURE) / (2 * BURST.cell));
  return DONE_CREATURE + 2 * cells * BURST.cell;
}

/**
 * The finale's beats, from the moment the push lands (never during it: an arrival nobody sees
 * because the page is still sliding is wasted). The creature pops at the size it was picked,
 * the name settles over it, "That's me" comes up from under the screen's edge; then the stage
 * turns over in pixels (react-bits PixelTransition, 300ms on and 300ms off) into the card that
 * says who this is, and the tools' marks drop onto the band under it one after another.
 *
 * On the press, the card is cut on the ring's densest frame (it bursts INTO the ring), and the
 * gate flips as the ring's last square goes, so the tabs cross fade in over a bare band.
 * Not before: flipping the gate unmounts the onboarding group at once, while the native screen
 * stays up for the cross fade, so a ring still being drawn froze on its last frame.
 */
export const FINALE = {
  nameAtMs: 200,
  actionAtMs: 360,
  /** The stage turns into the card (duolingo's splash leaves at 0.900 s). */
  cardAtMs: 900,
  /** The first tool mark drops, after the card has uncovered. */
  logosAtMs: 1600,
  /** How long to wait for the push to land before arriving anyway (a deep link, no push). */
  landFallbackMs: 450,
  creatureCutMs: 70,
  /** The gate flips when the ring reports it has gone; this long after the press at the latest. */
  flipFallbackMs: 900,
} as const;
