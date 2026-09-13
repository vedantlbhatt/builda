/**
 * The onboarding flow as data: the order of the steps, which of them the progress bar
 * covers, where back exists, and every number the motion uses. Pure (no React Native, no
 * expo), so `__tests__/onboarding.test.ts` holds all of it in bun.
 *
 * DESIGN-DIRECTION 4. Hello (step 0) and the finale sit outside the bars; the five bars cover
 * name, creature, tools, connect and notify, so the bar is only full on the last step that
 * asks something (four bars that were full on connect, with two screens still to come, told
 * a person they were done when they were not). "That's me" (`done`) is the last route: it
 * flips the onboarded gate, and `Stack.Protected` in the root layout drops every onboarding
 * route in the same render, so back can never re-enter the flow.
 *
 * Numbers taken from the welcome screen studies are converted from their 640pt canvas at
 * about 1.63 to 1 (appllama-top-welcome-screens, GPL: values only, no code).
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
 * The segmented progress bar (speak-language: 44 x 6 px bars, radius 4, gap 15 on the
 * 640pt canvas). Filled bars are amber, empty ones the `border` grey. A page change is 267ms
 * `inOut(cubic)`, and an un-fill on the way back is 0.7 of that.
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
 * `fill(p, i)`: how much of bar `i` (0 based) is filled. `back(p)`: the chevron's opacity (it
 * is white; fading is fine). `bars(p)`: whether the bars show at all, a cut at the half way
 * point to hello or to the finale (a full amber bar fading out is brown on the way).
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

/** Onboarding's side margin: the name headline asks for 20 and every step shares it. */
export const GUTTER = 20;

/** Bit on hello: 128pt, eight whole points per cell, about a third of the screen's width
 * (duolingo's mascot is 216 of 640). */
export const HELLO_BIT = 128;

/**
 * Bit's two blinks on hello: once on arrival and once more while the person reads
 * (DESIGN-DIRECTION 4, duolingo). A pixel blink is a CUT: the lids shut on one frame, hold
 * for the family's `MOTION.blink.closedMs` (120ms), and open on one frame. A fade on the
 * lids spends three frames with the eye holes a brown that is neither ink nor canvas.
 */
export const HELLO_BLINK = { atMs: [450, 2800], closedMs: 120 } as const;

/**
 * Hello to the name step: react-bits PixelTransition's cell logic as SkSL. The screen is cut
 * into 32pt cells (four of Bit's pixels, so a cell edge never slices one of them) laid on
 * Bit's own grid, and every cell turns over from hello to the name step once. The ORDER is a
 * wave out of the finger: a cell turns at `wave` times its distance from the Continue that
 * was pressed plus `jitter` times its hash, so the button clears first and the front reaches
 * the name field last, ragged enough to read as pixels rather than a wipe. A cell spends
 * `band` of its turn as a `card` square: the front, one step off the canvas.
 *
 * `wave + jitter` is 1: the last cell turns exactly when the progress reaches 1.
 * Reduce Motion: a 150ms fade instead.
 */
export const DISSOLVE = { cell: 32, ms: 340, band: 0.05, wave: 0.7, jitter: 0.3, reducedMs: 150 } as const;

/**
 * When the name step raises the keyboard after the cells start turning: as the last of them
 * turn (the keyboard takes about a tenth of a second to start moving). Earlier, the name
 * step's Continue rode up through the breaking cells; now the wave clears the button first,
 * the name step's Continue is standing exactly where hello's was, and it rises only after.
 */
export const KEYBOARD_AFTER_CELLS_MS = DISSOLVE.ms - 120;

/**
 * The creature on the creature step's stage and on the "That's me" screen: the same 160pt,
 * ten whole points per cell, so the creature a person picked is the creature they meet at the
 * end, not a smaller copy of it. Neighbours on the stage are half: five points per cell.
 */
export const STAGE_CREATURE = 160;
export const DONE_CREATURE = STAGE_CREATURE;

/**
 * The "That's me" burst: one ring, one cell thick, of pixel squares the size of the creature's
 * own (10pt), leaving it and thinning as it goes. `from` starts just outside the creature's
 * 12 cell live area, `to` is where it has gone. The canvas is `burstBox()` square, centred on
 * the creature, and its corner sits a whole number of cells from the creature's, so the ring
 * is drawn on the creature's grid rather than beside it.
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
 * The finale's beats, from the moment the push lands (never during it: an arrival nobody
 * sees because the page is still sliding is wasted). The creature pops, the name settles over
 * it, then "That's me" comes up from under the screen's edge. On the press, the creature is
 * cut on the ring's densest frame (it bursts INTO the ring), and the gate flips as the ring's
 * last square goes, so the tabs cross fade in over a bare canvas.
 *
 * Not before: flipping the gate unmounts the onboarding group at once, while the native
 * screen stays up for the cross fade, so a ring still being drawn froze on its last frame and
 * the tabs faded in over a still ring of amber squares going brown.
 */
export const FINALE = {
  nameAtMs: 200,
  actionAtMs: 360,
  /** How long to wait for the push to land before arriving anyway (a deep link, no push). */
  landFallbackMs: 450,
  creatureCutMs: 70,
  /** The gate flips when the ring reports it has gone; this long after the press at the latest. */
  flipFallbackMs: 900,
} as const;

/** The name step into the creature step: a cross fade, so the name stays where it is. */
export const NAME_TO_CREATURE_MS = 200;

/**
 * The headline wipe: a left to right reveal over 520ms on `EASE`. Hello's headline wipes in
 * whole; on the creature step only the part after the name does (", the fox"). Reduce Motion
 * skips it and the words are simply there.
 */
export const WIPE_MS = 520;

/** Where hello's body line starts rising after its headline starts wiping. */
export const RISE_AFTER_MS = 120;
/** How far a line rises into place. */
export const RISE_PT = 8;
