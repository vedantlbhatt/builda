/**
 * Every hue the money screens wear, decided in one place, so that ON ONE SCREEN ONE HUE MEANS ONE
 * THING. The money screens are the analysis page's "Money and burn" chapter, the Money page
 * (`app/you/money.tsx`, with the flow) and a project's money chapter.
 *
 * FOUND IN THE CAPTURE (2026-09-14, shots/now2 22-money and 21-analysis): orange was cache reads
 * and Private project 2 inside one chart, yellow cache writes and project 1's node, cyan the output
 * tokens and Fable 5 in the key right above the ring that names Fable 5 by it, and the analysis page
 * drew cache reads and "stretches where nothing was written" in the same orange in two keys one
 * above the other. Each of those was a key a person reads by colour, and read wrong.
 *
 * What wears a hue here, and the rule that keeps two things apart:
 *
 *   the models         their family's hue (Opus iris, Fable tide, ...) on every screen: the ring
 *                      names them by colour, and the flow's streams carry that colour on into the
 *                      projects. A second model of one family takes the family's partner tone.
 *   the projects       (the flow only) the hue each wears on the Projects tab, stepped past every
 *                      hue a model wears and past `NO_COMMIT_HUE` (`flow.projectHuesApart`, handed
 *                      `reservedForProjects`).
 *   no commit          heather: the Money page's "Where it went" chapter and its key, and the flow's
 *                      "no commit" ending, which is the same dollars.
 *   the kinds of token NO hue: the ground's white, each kind a segment of one bar with the bar's gap
 *                      between them, named in words beside its figure, never by a swatch. The
 *                      flow already drew tokens as grain because a token is not yet a dollar; the
 *                      bars now say the same. MEASURED (OKLab, the tokens' inks, 2026-09-14): with
 *                      three kinds in three hues, two models and two projects, every choice left
 *                      two keys on the Money page within the spectrum's own closest step (0.120:
 *                      amber and brass, which a person calls yellow twice), because nine hues do not
 *                      stretch to ten keys. The kinds are the keys that least need a colour: cache
 *                      reads are 99% of every bar they are in.
 *   the greys          the stretches that changed nothing in the grey of the flow's grey stream
 *                      (the owner's own words for it: "wasted stretches splitting off as a grey
 *                      stream"), the stretches the transcripts cannot judge in the faint grey, the
 *                      rest in the border (`BURN_GREYS`).
 *
 * A chapter's own hue (ember on the analysis page, the cost chapter's on the Money page) is the
 * chapter's voice: its band, its big figures, a bar under its own sentence. It is never a key in
 * a legend, so it may be any hue at all.
 *
 * Pure: no React Native, so `__tests__/moneyHues.test.ts` holds every rule.
 */
import { GROUND, SPECTRUM, type Hue, type HueName } from '../insights/palette';
import type { FlowPaint } from './flow';

/** A model family keeps one hue wherever it is drawn; a second row of one family takes the partner. */
export const FAMILY_HUE: Readonly<Record<string, HueName>> = { opus: 'iris', fable: 'tide', sonnet: 'cobalt', haiku: 'brass', mythos: 'orchid' };

/** The hue a family wears; a family the table does not know wears heather's. */
export function familyHue(family: string): HueName {
  return FAMILY_HUE[family] ?? 'heather';
}

/** Each model's colour, in the order given: the family's ink, then its partner for a second row of it. */
export function modelColors(families: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return families.map((f) => {
    const k = seen.get(f) ?? 0;
    seen.set(f, k + 1);
    const hue = SPECTRUM[familyHue(f)];
    return k === 0 ? hue.ink : hue.partner;
  });
}

/** The hues the models on a screen wear, each once. */
export function modelHueNames(families: readonly string[]): HueName[] {
  return [...new Set(families.map(familyHue))];
}

/** "No commit": the Where it went chapter's hue, and the flow's no commit ending. */
export const NO_COMMIT_HUE: HueName = 'heather';

/** The kinds of token, in the order the bar draws them. */
export type BucketKey = 'cache_read' | 'cache_write' | 'output' | 'input';

/** Every kind of token: the ground's white, a neutral. Kinds are told apart by the bar's gaps and their words. */
export const TOKEN_HUE: Hue = { ink: GROUND.text, partner: GROUND.dim, light: GROUND.text };

export interface BucketHues {
  /** Each kind's hue: `ink` is the colour its segment and its node are drawn in. */
  hue: Record<BucketKey, Hue>;
}

/**
 * The kinds of token's hues on a screen whose models are `families`: `TOKEN_HUE` for every one, so
 * no kind of token shares a hue with a model, a project or anything else on the page. Takes the
 * families so a screen asks one question in one place.
 */
export function bucketHues(_families: readonly string[] = []): BucketHues {
  return { hue: { cache_read: TOKEN_HUE, cache_write: TOKEN_HUE, output: TOKEN_HUE, input: TOKEN_HUE } };
}

/** A kind of token's colour; a key this table does not know is the ground's dim grey. */
export function bucketColor(key: string, hues: BucketHues): string {
  return (hues.hue as Record<string, Hue | undefined>)[key]?.ink ?? GROUND.dim;
}

/** The hues a project may not wear on the Money page: every model's, and no commit's. */
export function reservedForProjects(families: readonly string[]): HueName[] {
  return [...new Set([...modelHueNames(families), NO_COMMIT_HUE])];
}

/**
 * Where the tokens that changed nothing went, as one bar of three greys: the stretches that
 * changed nothing in the flow's grey stream's grey, the ones the transcripts cannot judge in the
 * faint grey, the rest in the border. Neutrals, so no hue on any screen means "changed nothing"
 * as well as something else.
 */
export const BURN_GREYS = { barren: GROUND.dim, unread: GROUND.faint, rest: GROUND.border } as const;

// ------------------------------------------------------------------ the flow (FlowChapter)

/** The spectrum hue whose ink (or partner) is `ink`, so a colour the page already uses keeps its partner tone. */
export function hueOfInk(ink: string): Hue {
  for (const h of Object.values(SPECTRUM)) {
    if (h.ink === ink) return h;
    if (h.partner === ink) return { ink: h.partner, partner: h.partner, light: h.light };
  }
  return { ink, partner: ink === GROUND.text ? GROUND.dim : ink, light: ink };
}

/**
 * The flow's colours, every one decided by `hues.ts` for the whole page: the kinds of token as the
 * first chapter's bar has them, each model in its family's hue as the ring has it, each project in
 * the hue it wears on the Projects tab unless something else on the page wears it
 * (`flow.projectHuesApart`), and "no commit" in the Where it went chapter's heather, because it is
 * the same dollars.
 */
export function flowPaint(buckets: BucketHues, projectHue: (key: string) => HueName): FlowPaint {
  return {
    bucket: (key) => (buckets.hue as Record<string, Hue | undefined>)[key as BucketKey] ?? hueOfInk(GROUND.dim),
    models: (families) => modelColors(families).map(hueOfInk),
    project: (key) => SPECTRUM[projectHue(key)],
    none: SPECTRUM[NO_COMMIT_HUE],
  };
}

/**
 * The chapter's hue: none drawn inside the flow (`inside`, every one of them a key read by colour),
 * and if it can, none of its neighbours' and not the builder's own (`beside`: the bands above and
 * below it and the accent). When the flow and its neighbours wear all nine, the band gives up a
 * neighbour's hue before it gives up one inside the flow: a band beside a band of its own hue is
 * two chapters, a band in the hue of a stream it heads is one hue meaning two things. FOUND ON THE
 * SIMULATOR (2026-09-14): a crab (coral) with Opus and Fable and two projects left no hue free,
 * and the band fell back to cobalt, the cache reads' blue inside it.
 */
export function flowHue(inside: readonly HueName[], beside: readonly HueName[] = []): HueName {
  const order: HueName[] = ['cobalt', 'brass', 'orchid', 'coral', 'iris', 'tide', 'heather', 'ember', 'amber'];
  return order.find((h) => !inside.includes(h) && !beside.includes(h)) ?? order.find((h) => !inside.includes(h)) ?? 'cobalt';
}

