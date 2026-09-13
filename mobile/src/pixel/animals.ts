/**
 * The creature pack: eight small animals in ONE ink, drawn as one family with Bit.
 *
 * The owner's note was that the icons were "very complicated" and that the Claude one "freaks
 * out: it's an orange and black thing". The pack used to wear a second, dark amber (2.6:1 on
 * the background) for its eyes and feet, change a frame every 300 ms, drift sideways and
 * breathe on a scale. Round 5 fixed that and then three reviewers found the opposite problem:
 * one stamped face on nine symmetric blocks, a crab and an octopus that were Space Invaders, a
 * fox that was an X, an owl that was an M, a whale that was a beetle and a bee that was a
 * horned trophy. This round keeps round 5's discipline and gives each animal back the one
 * thing it is known by. `__tests__/animals.test.ts` holds every rule below:
 *
 *   1. ONE INK. Frames draw only `b`, which renders as the accent amber on a dark surface
 *      and as ink on an amber tile or a light surface (`palette.ts`). No second tone, no
 *      teal, bone or grey, and no opacity dimming.
 *   2. FEATURES ARE HOLES. Two 2x2 eye holes on rows 6 and 7 at columns 5-6 and 9-10, the
 *      same eight cells in all nine (`EYES` in `frames.ts`), plus at most three other holes of
 *      eight cells or fewer: the dog's nose, the owl's beak, the slits that put the crab's
 *      claws on arms, the whale's smile, the bee's stripes. A blink fills the eyes at run time.
 *   3. ONE GRID. At rest everything sits in cells 2 to 13 on both axes and stands on row 13
 *      (the whale floats a row higher: `PACK_EXCEPTIONS`). A gesture may reach one cell further
 *      out, never the frame edge.
 *   4. ONE WEIGHT. 10 to 12 cells wide, and every rest pose within 15% of the family's mean
 *      filled-cell count (about 92), so no creature looks heavier than another in a row.
 *   5. CLEAN SILHOUETTES. One connected shape; no part a single cell thin except a one-cell
 *      tip (a claw point, an ear tip, an antenna) and the walls and bands of the bee's stripes;
 *      edges per filled cell of 1.15 or less; and any two outlines at least 24 cells apart, so
 *      shape tells them apart, not colour.
 *   6. FACE FORWARD. Every rest pose is mirror-symmetric except the whale's, whose flukes rise
 *      on its right. A gesture adds four asymmetric cells at most.
 *   7. IDLE IS BREATH, BLINK AND ONE GESTURE. A loop is the rest pose, a breath drawn in
 *      four cells or fewer, the rest pose again, and one signature gesture of one or two
 *      frames. At most four cells change per frame and twelve across the loop; the rest pose
 *      holds for at least half of it (`ANIMAL_MOTION` in `motion.ts`). No drift, no scale
 *      breath and no tilt: those put a pixel icon between device pixels.
 *
 * Every loop is `[REST, BREATH, REST, GESTURE]`, and the two REST entries are the same
 * frame object, so the renderer sees a repeat as no change at all.
 */

import type { Frame } from './frames';

export type { Frame } from './frames';

/**
 * The pack, in presentation order: the picker in Settings and the contact sheet both read
 * this list, so the order here is the order a person sees. The first is the default
 * (`DEFAULT_ANIMAL`), and it is not the crab any more: an amber crab first in line is Clawd,
 * Claude Code's mascot, and the owner already read it as "the Claude icon". Land animals, then
 * the bird, the insect and the three from the sea.
 */
export const ANIMALS = [
  'cat',
  'dog',
  'fox',
  'owl',
  'bee',
  'whale',
  'octopus',
  'crab',
] as const;

export type Animal = (typeof ANIMALS)[number];

/** The only glyph an animal frame may draw: one ink (`palette.ts`). */
export const ANIMAL_GLYPHS = ['b'] as const;
export type AnimalGlyph = (typeof ANIMAL_GLYPHS)[number];

/** Display names. Lower case, because every other caption in the app is. */
export const ANIMAL_LABELS: Record<Animal, string> = {
  cat: 'cat',
  dog: 'dog',
  fox: 'fox',
  owl: 'owl',
  bee: 'bee',
  whale: 'whale',
  octopus: 'octopus',
  crab: 'crab',
};

/**
 * Where one creature departs from the rules above, and exactly how far. Each is the one thing
 * that creature cannot be read without, and the tests hold it to this table and no further.
 */
export interface PackException {
  /** The rest pose may differ from its mirror image (rule 6). */
  mirror?: false;
  /** The row the rest pose stands on, when it is not row 13 (rule 3). */
  baseline?: number;
  /** One-cell-thin ink is allowed where it borders a stripe hole (rule 5). */
  stripes?: true;
}

export const PACK_EXCEPTIONS: Partial<Record<Animal, PackException>> = {
  /**
   * A whale is known by its flukes, and flukes seen head on are not flukes: they rise on its
   * right, like the tail of the spouting-whale emoji. It floats a row above the baseline,
   * because a whale standing on row 13 is ten rows tall and reads as a ball.
   */
  whale: { mirror: false, baseline: 12 },
  /**
   * A bee is known by its stripes. They run to within a cell of its outline, so they read as
   * bands around a body rather than a mouth under a face (a slot with two-cell walls did), and
   * the one-cell walls and bands between them are the only thin ink in the pack.
   */
  bee: { stripes: true },
};

// ─── cat ─────────────────────────────────────────────────────────────────────────────
// Small pointed ears, whiskers, a neck and a sitting body. The neck fills, then the tail tip
// flicks out past the right haunch.

const CAT_REST: Frame = [
  '................',
  '................',
  '...b........b...',
  '...bb......bb...',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '...bb..bb..bb...',
  '..bbb..bb..bbb..',
  '...bbbbbbbbbb...',
  '..bbbbbbbbbbbb..',
  '....bbbbbbbb....',
  '.....bbbbbb.....',
  '....bbbbbbbb....',
  '....bbbbbbbb....',
  '................',
  '................',
];

/** The breath: the neck fills a cell each side. */
const CAT_BREATH: Frame = [
  '................',
  '................',
  '...b........b...',
  '...bb......bb...',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '...bb..bb..bb...',
  '..bbb..bb..bbb..',
  '...bbbbbbbbbb...',
  '..bbbbbbbbbbbb..',
  '....bbbbbbbb....',
  '....bbbbbbbb....',
  '....bbbbbbbb....',
  '....bbbbbbbb....',
  '................',
  '................',
];

/** The tail tip appears beside the right haunch. */
const CAT_FLICK: Frame = [
  '................',
  '................',
  '...b........b...',
  '...bb......bb...',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '...bb..bb..bb...',
  '..bbb..bb..bbb..',
  '...bbbbbbbbbb...',
  '..bbbbbbbbbbbb..',
  '....bbbbbbbb....',
  '.....bbbbbb.....',
  '....bbbbbbbbbb..',
  '....bbbbbbbbb...',
  '................',
  '................',
];

const CAT: Frame[] = [CAT_REST, CAT_BREATH, CAT_REST, CAT_FLICK];

// ─── dog ─────────────────────────────────────────────────────────────────────────────
// Ears that hang past the jaw with a gap under them, a nose, a small body. The chest fills, then
// one ear flops out.

const DOG_REST: Frame = [
  '................',
  '................',
  '................',
  '....bbbbbbbb....',
  '..bbbbbbbbbbbb..',
  '..bbbbbbbbbbbb..',
  '..bbb..bb..bbb..',
  '..bbb..bb..bbb..',
  '..bb.bbbbbb.bb..',
  '..bb.bb..bb.bb..',
  '..bb..bbbb..bb..',
  '......bbbb......',
  '.....bbbbbb.....',
  '.....bb..bb.....',
  '................',
  '................',
];

/** The breath: the chest and shoulders widen. */
const DOG_BREATH: Frame = [
  '................',
  '................',
  '................',
  '....bbbbbbbb....',
  '..bbbbbbbbbbbb..',
  '..bbbbbbbbbbbb..',
  '..bbb..bb..bbb..',
  '..bbb..bb..bbb..',
  '..bb.bbbbbb.bb..',
  '..bb.bb..bb.bb..',
  '..bb..bbbb..bb..',
  '.....bbbbbb.....',
  '....bbbbbbbb....',
  '.....bb..bb.....',
  '................',
  '................',
];

/** The left ear swings out a cell at its tip. */
const DOG_FLOP: Frame = [
  '................',
  '................',
  '................',
  '....bbbbbbbb....',
  '..bbbbbbbbbbbb..',
  '..bbbbbbbbbbbb..',
  '..bbb..bb..bbb..',
  '..bbb..bb..bbb..',
  '..bb.bbbbbb.bb..',
  '.bb..bb..bb.bb..',
  '.bb...bbbb..bb..',
  '......bbbb......',
  '.....bbbbbb.....',
  '.....bb..bb.....',
  '................',
  '................',
];

const DOG: Frame[] = [DOG_REST, DOG_BREATH, DOG_REST, DOG_FLOP];

// ─── fox ─────────────────────────────────────────────────────────────────────────────
// A head and nothing else: tall ears at the corners, cheeks at their widest under the eyes, and a
// muzzle that tapers to a two-cell chin on the baseline. Every fox icon is this triangle; the
// seated body under a pinched neck made round 5's fox a bow-tie. The jaw fills, then one ear folds.

const FOX_REST: Frame = [
  '................',
  '................',
  '..b..........b..',
  '..bb........bb..',
  '..bbbbb..bbbbb..',
  '..bbbbbbbbbbbb..',
  '..bbb..bb..bbb..',
  '..bbb..bb..bbb..',
  '..bbbbbbbbbbbb..',
  '...bbbbbbbbbb...',
  '....bbbbbbbb....',
  '.....bbbbbb.....',
  '......bbbb......',
  '.......bb.......',
  '................',
  '................',
];

/** The breath: the jaw widens a cell each side. */
const FOX_BREATH: Frame = [
  '................',
  '................',
  '..b..........b..',
  '..bb........bb..',
  '..bbbbb..bbbbb..',
  '..bbbbbbbbbbbb..',
  '..bbb..bb..bbb..',
  '..bbb..bb..bbb..',
  '..bbbbbbbbbbbb..',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '.....bbbbbb.....',
  '......bbbb......',
  '.......bb.......',
  '................',
  '................',
];

/** The left ear loses its tip. */
const FOX_FOLD: Frame = [
  '................',
  '................',
  '.............b..',
  '...b........bb..',
  '..bbbbb..bbbbb..',
  '..bbbbbbbbbbbb..',
  '..bbb..bb..bbb..',
  '..bbb..bb..bbb..',
  '..bbbbbbbbbbbb..',
  '...bbbbbbbbbb...',
  '....bbbbbbbb....',
  '.....bbbbbb.....',
  '......bbbb......',
  '.......bb.......',
  '................',
  '................',
];

const FOX: Frame[] = [FOX_REST, FOX_BREATH, FOX_REST, FOX_FOLD];

// ─── owl ─────────────────────────────────────────────────────────────────────────────
// Tufts at the corners over a brow that dips on row 3 only (the deep V of round 5 split the head
// into a bat's cowl), a beak framed by one hole under the bridge between the eyes, a round body
// and spread feet. The chest puffs, then the tufts flatten.

const OWL_REST: Frame = [
  '................',
  '................',
  '..bb........bb..',
  '..bbbb....bbbb..',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '...bb..bb..bb...',
  '...bb..bb..bb...',
  '...bbbb..bbbb...',
  '...bbbbbbbbbb...',
  '..bbbbbbbbbbbb..',
  '...bbbbbbbbbb...',
  '....bbbbbbbb....',
  '...bb......bb...',
  '................',
  '................',
];

/** The breath: the chest widens a cell each side. */
const OWL_BREATH: Frame = [
  '................',
  '................',
  '..bb........bb..',
  '..bbbb....bbbb..',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '...bb..bb..bb...',
  '...bb..bb..bb...',
  '...bbbb..bbbb...',
  '...bbbbbbbbbb...',
  '..bbbbbbbbbbbb..',
  '..bbbbbbbbbbbb..',
  '....bbbbbbbb....',
  '...bb......bb...',
  '................',
  '................',
];

/** The tips of both tufts fold down. */
const OWL_FLAT: Frame = [
  '................',
  '................',
  '................',
  '..bbbb....bbbb..',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '...bb..bb..bb...',
  '...bb..bb..bb...',
  '...bbbb..bbbb...',
  '...bbbbbbbbbb...',
  '..bbbbbbbbbbbb..',
  '...bbbbbbbbbb...',
  '....bbbbbbbb....',
  '...bb......bb...',
  '................',
  '................',
];

const OWL: Frame[] = [OWL_REST, OWL_BREATH, OWL_REST, OWL_FLAT];

// ─── bee ─────────────────────────────────────────────────────────────────────────────
// A round striped body with two antennae. No waist and no base (round 5's made a trophy) and no
// wings: at this size a wing beside the head is a horn, in every variant tried. The two stripes
// cut to within a cell of the outline, which is what makes them stripes. The lowest band swells,
// then the antennae twitch out.

const BEE_REST: Frame = [
  '................',
  '................',
  '....b......b....',
  '...bbbbbbbbbb...',
  '..bbbbbbbbbbbb..',
  '..bbbbbbbbbbbb..',
  '..bbb..bb..bbb..',
  '..bbb..bb..bbb..',
  '..bbbbbbbbbbbb..',
  '...b........b...',
  '..bbbbbbbbbbbb..',
  '...b........b...',
  '..bbbbbbbbbbbb..',
  '....bbbbbbbb....',
  '................',
  '................',
];

/** The breath: the lowest band widens a cell each side. */
const BEE_BREATH: Frame = [
  '................',
  '................',
  '....b......b....',
  '...bbbbbbbbbb...',
  '..bbbbbbbbbbbb..',
  '..bbbbbbbbbbbb..',
  '..bbb..bb..bbb..',
  '..bbb..bb..bbb..',
  '..bbbbbbbbbbbb..',
  '...b........b...',
  '..bbbbbbbbbbbb..',
  '...b........b...',
  '..bbbbbbbbbbbb..',
  '...bbbbbbbbbb...',
  '................',
  '................',
];

/** Both antennae lean out a cell. */
const BEE_TWITCH: Frame = [
  '................',
  '................',
  '...b........b...',
  '...bbbbbbbbbb...',
  '..bbbbbbbbbbbb..',
  '..bbbbbbbbbbbb..',
  '..bbb..bb..bbb..',
  '..bbb..bb..bbb..',
  '..bbbbbbbbbbbb..',
  '...b........b...',
  '..bbbbbbbbbbbb..',
  '...b........b...',
  '..bbbbbbbbbbbb..',
  '....bbbbbbbb....',
  '................',
  '................',
];

const BEE: Frame[] = [BEE_REST, BEE_BREATH, BEE_REST, BEE_TWITCH];

// ─── whale ───────────────────────────────────────────────────────────────────────────
// A wide body with a smile, flukes rising on the right, floating a row above the baseline
// (`PACK_EXCEPTIONS`). No spout at rest: a stalk on top of a round amber body with a grin is a
// jack-o'-lantern. The belly fills, then the spout rises and sprays.

const WHALE_REST: Frame = [
  '................',
  '................',
  '.........bb.bb..',
  '..........bbb...',
  '....bbbbbbbbb...',
  '...bbbbbbbbbb...',
  '..bbb..bb..bb...',
  '..bbb..bb..bbb..',
  '..bbbbbbbbbbbb..',
  '..bb.bbbbbb.bb..',
  '..bbb......bbb..',
  '..bbbbbbbbbbbb..',
  '...bbbbbbbbbb...',
  '................',
  '................',
  '................',
];

/** The breath: the belly widens a cell each side. */
const WHALE_BREATH: Frame = [
  '................',
  '................',
  '.........bb.bb..',
  '..........bbb...',
  '....bbbbbbbbb...',
  '...bbbbbbbbbb...',
  '..bbb..bb..bb...',
  '..bbb..bb..bbb..',
  '..bbbbbbbbbbbb..',
  '..bb.bbbbbb.bb..',
  '..bbb......bbb..',
  '..bbbbbbbbbbbb..',
  '..bbbbbbbbbbbb..',
  '................',
  '................',
  '................',
];

/** The spout rises from the blowhole. */
const WHALE_SPOUT: Frame = [
  '................',
  '................',
  '.....bb..bb.bb..',
  '.....bb...bbb...',
  '....bbbbbbbbb...',
  '...bbbbbbbbbb...',
  '..bbb..bb..bb...',
  '..bbb..bb..bbb..',
  '..bbbbbbbbbbbb..',
  '..bb.bbbbbb.bb..',
  '..bbb......bbb..',
  '..bbbbbbbbbbbb..',
  '...bbbbbbbbbb...',
  '................',
  '................',
  '................',
];

/** And forks into spray. */
const WHALE_SPRAY: Frame = [
  '................',
  '................',
  '....b..b.bb.bb..',
  '.....bb...bbb...',
  '....bbbbbbbbb...',
  '...bbbbbbbbbb...',
  '..bbb..bb..bb...',
  '..bbb..bb..bbb..',
  '..bbbbbbbbbbbb..',
  '..bb.bbbbbb.bb..',
  '..bbb......bbb..',
  '..bbbbbbbbbbbb..',
  '...bbbbbbbbbb...',
  '................',
  '................',
  '................',
];

const WHALE: Frame[] = [WHALE_REST, WHALE_BREATH, WHALE_REST, WHALE_SPOUT, WHALE_SPRAY];

// ─── octopus ─────────────────────────────────────────────────────────────────────────
// A bulb of a head on a neck, over four arms that splay at the tips. The neck swells, then the two
// outer arm tips lift and point out.

const OCTOPUS_REST: Frame = [
  '................',
  '................',
  '.....bbbbbb.....',
  '....bbbbbbbb....',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '...bb..bb..bb...',
  '...bb..bb..bb...',
  '...bbbbbbbbbb...',
  '....bbbbbbbb....',
  '...bbbbbbbbbb...',
  '..bb.bbbbbb.bb..',
  '..bb.bb..bb.bb..',
  '..b..bb..bb..b..',
  '................',
  '................',
];

/** The breath: the neck widens a cell each side. */
const OCTOPUS_BREATH: Frame = [
  '................',
  '................',
  '.....bbbbbb.....',
  '....bbbbbbbb....',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '...bb..bb..bb...',
  '...bb..bb..bb...',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '..bb.bbbbbb.bb..',
  '..bb.bb..bb.bb..',
  '..b..bb..bb..b..',
  '................',
  '................',
];

/** The outer tips lift and point outward. */
const OCTOPUS_CURL: Frame = [
  '................',
  '................',
  '.....bbbbbb.....',
  '....bbbbbbbb....',
  '...bbbbbbbbbb...',
  '...bbbbbbbbbb...',
  '...bb..bb..bb...',
  '...bb..bb..bb...',
  '...bbbbbbbbbb...',
  '....bbbbbbbb....',
  '...bbbbbbbbbb...',
  '..bb.bbbbbb.bb..',
  '.bbb.bb..bb.bbb.',
  '.....bb..bb.....',
  '................',
  '................',
];

const OCTOPUS: Frame[] = [OCTOPUS_REST, OCTOPUS_BREATH, OCTOPUS_REST, OCTOPUS_CURL];

// ─── crab ────────────────────────────────────────────────────────────────────────────
// Pincers held up on arms, with a slit between each arm and the shell, and legs that splay down
// and out. Round 5's crab put the claws straight on the shell's corners and hung the legs off
// the bottom corners, which is the Space Invaders crab. The shell swells, then both claws snip.

const CRAB_REST: Frame = [
  '................',
  '................',
  '..b.b......b.b..',
  '..bbb......bbb..',
  '..bb.bbbbbb.bb..',
  '..bb.bbbbbb.bb..',
  '..bbb..bb..bbb..',
  '..bbb..bb..bbb..',
  '..bbbbbbbbbbbb..',
  '...bbbbbbbbbb...',
  '..bbbbbbbbbbbb..',
  '..b..bb..bb..b..',
  '....bb....bb....',
  '...bb......bb...',
  '................',
  '................',
];

/** The breath: the shell's lower edge widens a cell each side. */
const CRAB_BREATH: Frame = [
  '................',
  '................',
  '..b.b......b.b..',
  '..bbb......bbb..',
  '..bb.bbbbbb.bb..',
  '..bb.bbbbbb.bb..',
  '..bbb..bb..bbb..',
  '..bbb..bb..bbb..',
  '..bbbbbbbbbbbb..',
  '..bbbbbbbbbbbb..',
  '..bbbbbbbbbbbb..',
  '..b..bb..bb..b..',
  '....bb....bb....',
  '...bb......bb...',
  '................',
  '................',
];

/** Both pincers close. */
const CRAB_SNIP: Frame = [
  '................',
  '................',
  '..bbb......bbb..',
  '..bbb......bbb..',
  '..bb.bbbbbb.bb..',
  '..bb.bbbbbb.bb..',
  '..bbb..bb..bbb..',
  '..bbb..bb..bbb..',
  '..bbbbbbbbbbbb..',
  '...bbbbbbbbbb...',
  '..bbbbbbbbbbbb..',
  '..b..bb..bb..b..',
  '....bb....bb....',
  '...bb......bb...',
  '................',
  '................',
];

const CRAB: Frame[] = [CRAB_REST, CRAB_BREATH, CRAB_REST, CRAB_SNIP];

export const ANIMAL_FRAMES: Record<Animal, Frame[]> = {
  cat: CAT,
  dog: DOG,
  fox: FOX,
  owl: OWL,
  bee: BEE,
  whale: WHALE,
  octopus: OCTOPUS,
  crab: CRAB,
};

export function framesForAnimal(animal: Animal): Frame[] {
  return ANIMAL_FRAMES[animal];
}

export function isAnimal(value: unknown): value is Animal {
  return typeof value === 'string' && (ANIMALS as readonly string[]).includes(value);
}

// ─── archetype → animal ──────────────────────────────────────────────────────────────

/**
 * One animal per builder archetype, so the profile screen can show a creature rather than
 * a word. These six keys are the six archetypes in `generated/analysis.ts` — the ones a
 * MODEL assigns to a single session. That file is generated from the spec, so a seventh
 * archetype breaks this table's type rather than silently falling through to the default.
 *
 * The obvious pairs first: an architect gets the owl, a velocity machine the bee, a
 * quality guardian the crab (it walks sideways and checks everything twice).
 *
 * NIGHT OWL DOES NOT GET THE OWL. The architect has it, and two archetypes sharing a
 * creature would make the picture ambiguous exactly where it is supposed to be the
 * shorthand — so the night owl gets the CAT, which is the other thing that is awake at
 * 3 a.m. The remaining two follow the same logic: an explorer gets the octopus (eight
 * arms in eight places) and a firefighter the fox (fast, and never where it was).
 */
export const ARCHETYPE_ANIMALS = {
  architect: 'owl',
  velocity_machine: 'bee',
  quality_guardian: 'crab',
  night_owl: 'cat',
  explorer: 'octopus',
  firefighter: 'fox',
} as const satisfies Record<string, Animal>;

/**
 * The two archetypes the CORPUS profile can reach that a single session cannot.
 *
 * `analysis/profile.py:ARCHETYPE_RULES` scores a whole corpus deterministically, and its
 * six names are not the same six the model picks from per session: it can return
 * `director` (a high autonomy score: you brief and leave) and `skeptic` (test runs per
 * active hour), neither of which is in the spec's per-session enum. Without these two
 * entries a director's profile would show the fallback creature and read as a bug.
 *
 * They are written out here rather than generated because the corpus rules are not in
 * `spec/analysis.v1.json` — they are computation, not a wire enum. The union of the two
 * tables is eight archetypes over the pack's eight animals, and the test asserts that
 * mapping stays one-to-one, so a new archetype on either side cannot quietly share a
 * creature with an existing one.
 */
export const CORPUS_ARCHETYPE_ANIMALS = {
  director: 'dog',
  skeptic: 'whale',
} as const satisfies Record<string, Animal>;

export type ArchetypeKey = keyof typeof ARCHETYPE_ANIMALS;

/**
 * The animal shown when nobody has chosen one and there is no archetype yet: the first in the
 * pack. Not the crab: an amber crab as the first thing a person sees is Clawd, Claude Code's
 * own mascot, and the owner read the old default as "the Claude icon". Not the dog either,
 * because the dog is the `director`'s creature and a director's profile must not look like the
 * fallback (`__tests__/profile.test.ts`). The night owl shares the cat, as the quality guardian
 * shared the crab before.
 */
export const DEFAULT_ANIMAL: Animal = ANIMALS[0];

/**
 * The animal for an archetype. Anything unknown — no analysis yet, a null modal, an
 * archetype from a newer server — falls back to `DEFAULT_ANIMAL` rather than throwing:
 * a profile screen is not the place to discover a spec change.
 */
export function animalForArchetype(archetype: string | null | undefined): Animal {
  if (typeof archetype !== 'string') return DEFAULT_ANIMAL;
  const hit =
    (ARCHETYPE_ANIMALS as Record<string, Animal>)[archetype] ??
    (CORPUS_ARCHETYPE_ANIMALS as Record<string, Animal>)[archetype];
  return hit ?? DEFAULT_ANIMAL;
}

// ─── the picker ──────────────────────────────────────────────────────────────────────

export interface AnimalChoice {
  id: Animal;
  label: string;
}

/** Every animal, in pack order, ready for a Settings list. */
export function animalChoices(): AnimalChoice[] {
  return ANIMALS.map((id) => ({ id, label: ANIMAL_LABELS[id] }));
}

/**
 * What a person's saved choice resolves to: their own pick if it is still a real animal,
 * otherwise their archetype's. A stored id that no longer exists reads as "unset" rather
 * than rendering nothing.
 */
export function resolveAnimal(chosen: string | null | undefined, archetype?: string | null): Animal {
  return isAnimal(chosen) ? chosen : animalForArchetype(archetype);
}
