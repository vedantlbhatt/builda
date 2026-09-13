/**
 * The Wrapped headers (`src/wrapped/art.ts`): real data where the phone holds it, a seeded
 * field where it does not, and never a picture that changes between two renders.
 */
import { describe, expect, test } from 'bun:test';

import { REPORT_ENUMS, type ReportWrappedCard, type WrappedCard } from '../src/generated/report';
import { tokens } from '../src/generated/tokens';
import { archetypeHue, cardHue, colors, graphLevel, hue, HUE_NAMES } from '../src/theme';
import { bayer8, quantize } from '../src/ui/dithering';
import {
  BAND_INK,
  BAR_BODY,
  FADED_INK,
  LANE_PEAK,
  NO_SOURCES,
  SCATTER_INK,
  WORD_LIT,
  WORD_UNLIT,
  paragraphBlocks,
  tallyBlocks,
  activityGrid,
  artFor,
  artHue,
  artTones,
  deckArchetype,
  toneLayers,
  toneLevel,
  toneMask,
  attendedBars,
  commitRow,
  cumulativeLines,
  dayNumber,
  fieldOf,
  kindShares,
  peakLanes,
  promptBars,
  seedOf,
  stripHeights,
  weeksFor,
  type ArtBasis,
  type ArtSession,
  type ArtSpec,
} from '../src/wrapped/art';
import { SAMPLE_SOURCES, SAMPLE_WRAPPED, refusalSamples } from '../src/wrapped/sample';

const COLS = 96;
const ROWS = 60;

function card(id: WrappedCard): ReportWrappedCard {
  return SAMPLE_WRAPPED.cards.find((c) => c.id === id)!;
}

function bytes(spec: ArtSpec, faded = false): number[] {
  return Array.from(fieldOf(spec, COLS, ROWS, { faded }).data);
}

describe('never random: the same card draws the same header, every render', () => {
  test('every card, with nothing to draw from, gets its seeded field, twice identical', () => {
    for (const id of REPORT_ENUMS.wrapped_card) {
      const a = artFor(card(id), NO_SOURCES);
      const b = artFor(card(id), NO_SOURCES);
      expect(a).toEqual(b);
      expect(bytes(a)).toEqual(bytes(b));
    }
  });

  test('with no sources the data cards fall back to a seeded field, and say so', () => {
    const procedural = REPORT_ENUMS.wrapped_card.filter((id) => artFor(card(id), NO_SOURCES).basis === 'procedural');
    // Five cards carry their own data on the wire: the share, the split, the sends, the
    // average prompt with its median, and the helper agents with their peak.
    const onTheWire = new Set(['change_course', 'kind_of_work', 'go_to_prompt', 'prompt_length', 'agents_at_once']);
    expect(procedural.sort()).toEqual([...REPORT_ENUMS.wrapped_card].filter((id) => !onTheWire.has(id)).sort());
  });

  test('different cards seed different fields', () => {
    const fields = new Set(REPORT_ENUMS.wrapped_card.map((id) => bytes(artFor(card(id), NO_SOURCES)).join(',')));
    expect(fields.size).toBe(REPORT_ENUMS.wrapped_card.length);
  });

  test('the seed is the card id, FNV-1a, stable across builds', () => {
    expect(seedOf('builder_type')).toBe(seedOf('builder_type'));
    expect(seedOf('')).toBe(0x811c9dc5);
    expect(seedOf('builder_type')).not.toBe(seedOf('shipped'));
  });

  test('every field is exactly cols by rows, every cell in 0 to 1, and some of it ink', () => {
    for (const id of REPORT_ENUMS.wrapped_card) {
      for (const sources of [NO_SOURCES, SAMPLE_SOURCES]) {
        const f = fieldOf(artFor(card(id), sources), COLS, ROWS);
        expect(f.width).toBe(COLS);
        expect(f.height).toBe(ROWS);
        expect(f.data.length).toBe(COLS * ROWS);
        let ink = 0;
        for (const v of f.data) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
          ink += v;
        }
        expect(ink).toBeGreaterThan(0);
      }
    }
  });
});

describe('real data where the phone holds it', () => {
  const expected: Partial<Record<WrappedCard, ArtBasis>> = {
    time_put_in: 'activity_grid',
    longest_session: 'session_strip',
    agents_at_once: 'peak_overlap',
    streak: 'commit_days',
    shipped: 'cumulative_lines',
    change_course: 'card_share',
    kind_of_work: 'role_split',
    deep_sessions: 'attended_per_session',
    prompts_per_session: 'prompts_per_session',
    go_to_prompt: 'send_count',
    prompt_length: 'prompt_words',
  };

  test('each data card draws its own data; the rest are seeded', () => {
    for (const id of REPORT_ENUMS.wrapped_card) {
      expect({ id, basis: artFor(card(id), SAMPLE_SOURCES).basis }).toEqual({ id, basis: expected[id] ?? 'procedural' });
    }
  });

  test('a refused card never draws data: it has no answer to draw', () => {
    for (const c of refusalSamples()) expect(artFor(c, SAMPLE_SOURCES).basis).toBe('procedural');
  });

  test('a refused card is drawn thinner, at most FADED_INK of its ink', () => {
    const spec = artFor(card('builder_type'), NO_SOURCES);
    const full = bytes(spec);
    const faded = bytes(spec, true);
    faded.forEach((v, i) => expect(v).toBeCloseTo(full[i]! * FADED_INK, 6));
  });
});

describe('the data into shapes', () => {
  test('the contribution grid: weekday rows, the latest week on the right, the You tab\'s buckets', () => {
    // 2026-09-13 is a Sunday: the last row of the last column.
    const graph = [
      { date: '2026-09-07', active_seconds: 3 * 3600 }, // Monday
      { date: '2026-09-13', active_seconds: 9 * 3600 }, // Sunday
      { date: '2026-08-31', active_seconds: 1800 }, // the Monday before
    ];
    const grid = activityGrid(graph, 6)!;
    expect(grid.length).toBe(7);
    expect(grid[0]!.length).toBe(6);
    expect(grid[6]![5]).toBe(graphLevel(9 * 3600) / 5);
    expect(grid[0]![5]).toBe(graphLevel(3 * 3600) / 5);
    expect(grid[0]![4]).toBe(graphLevel(1800) / 5);
    expect(grid.flat().filter((v) => v > 0).length).toBe(3);
  });

  test('a grid with no time in it is no grid (the seeded field draws instead)', () => {
    expect(activityGrid([{ date: '2026-09-13', active_seconds: 0 }], 8)).toBeNull();
    expect(activityGrid([], 8)).toBeNull();
  });

  test('square days: the grid shows as many weeks as the header is wide, 6 to 17', () => {
    expect(weeksFor(1)).toBe(7);
    expect(weeksFor(1.6)).toBe(11);
    expect(weeksFor(0.2)).toBe(6);
    expect(weeksFor(9)).toBe(17);
  });

  test('the commit row: one value a day from the first commit, empty days paper, a single commit still ink', () => {
    const row = commitRow(
      [
        { day: '2026-09-01', commits: 1 },
        { day: '2026-09-03', commits: 10 },
      ],
      '2026-09-04T08:00:00Z',
    )!;
    expect(row.length).toBe(4);
    expect(row[1]).toBe(0);
    expect(row[3]).toBe(0);
    expect(row[0]).toBeGreaterThanOrEqual(0.4);
    expect(row[2]).toBe(1);
    expect(commitRow([{ day: '2026-09-01', commits: 0 }], null)).toBeNull();
    expect(dayNumber('2026-09-02') - dayNumber('2026-09-01')).toBe(1);
  });

  test('the strip: idle is nothing, activity its density, and a strip that will not decode is no strip', () => {
    const h = stripHeights(SAMPLE_SOURCES.longestStrip!)!;
    expect(h.length).toBe(1024);
    expect(h.every((v) => [0, 0.25, 0.5, 0.75, 1].includes(v))).toBe(true);
    expect(h.some((v) => v === 0)).toBe(true);
    expect(stripHeights('not base64 of anything')).toBeNull();
  });

  test('the busiest moment: three sessions at once are the three solid lanes', () => {
    const at = (h: number) => new Date(Date.UTC(2026, 8, 1, 10) + h * 3_600_000).toISOString();
    const sessions: ArtSession[] = [
      { started_at: at(0), ended_at: at(2) },
      { started_at: at(0.5), ended_at: at(1.5) },
      { started_at: at(1), ended_at: at(3) },
      { started_at: at(5), ended_at: at(6) },
    ];
    const lanes = peakLanes(sessions)!;
    expect(lanes.length).toBe(3);
    expect(lanes.flat().filter((l) => l.peak).length).toBe(3);
    for (const lane of lanes) for (const l of lane) expect(l.from).toBeLessThan(l.to);
  });

  test('the lanes never show a different count from the number printed on the card', () => {
    // FOUND IN REVIEW (2026-09-13): the card counts first to last EVENT; the phone's windows run
    // to `ended_at`, which carries the trailing idle credit. A's last event 10:05, its window to
    // 10:20; B from 10:10. MEASURED before the fix: 2 lanes, both solid, under a card of 1 at
    // once. After: no lanes; the header is the card's own helper agent count instead.
    const two: ArtSession[] = [
      { started_at: '2026-09-13T10:00:00Z', ended_at: '2026-09-13T10:20:00Z', attended_seconds: 300 },
      { started_at: '2026-09-13T10:10:00Z', ended_at: '2026-09-13T11:00:00Z', attended_seconds: 300 },
    ];
    expect(peakLanes(two, 1)).toBeNull();
    expect(peakLanes(two, 2)!.flat().filter((l) => l.peak).length).toBe(2);
    const one = { ...card('agents_at_once'), value: 1 };
    const spec = artFor(one, { ...SAMPLE_SOURCES, sessions: two });
    expect(spec.basis).toBe('agent_count');
    // When they do agree, the lanes are drawn.
    expect(artFor({ ...one, value: 2 }, { ...SAMPLE_SOURCES, sessions: two }).basis).toBe('peak_overlap');
  });

  test('a handoff at the same instant is not two at once (agents.py\'s rule)', () => {
    const at = (h: number) => new Date(Date.UTC(2026, 8, 1, 10) + h * 3_600_000).toISOString();
    const lanes = peakLanes([
      { started_at: at(0), ended_at: at(1) },
      { started_at: at(1), ended_at: at(2) },
    ])!;
    expect(lanes.flat().filter((l) => l.peak).length).toBe(1);
    expect(lanes.length).toBe(1);
  });

  test('lines summed session by session end at the whole, and never fall', () => {
    const series = cumulativeLines(SAMPLE_SOURCES.sessions!)!;
    expect(series[series.length - 1]).toBeCloseTo(1, 9);
    for (let i = 1; i < series.length; i++) expect(series[i]!).toBeGreaterThanOrEqual(series[i - 1]!);
    expect(cumulativeLines([{ started_at: '2026-09-01T00:00:00Z', ended_at: '2026-09-01T01:00:00Z', lines: 5 }])).toBeNull();
  });

  test('an attended hour is a solid bar; shorter sittings are lighter', () => {
    const mk = (a: number): ArtSession => ({ started_at: `2026-09-0${a}T00:00:00Z`, ended_at: `2026-09-0${a}T05:00:00Z`, attended_seconds: a * 1200 });
    const bars = attendedBars([mk(1), mk(2), mk(3), mk(4)])!;
    expect(bars.map((b) => b.d)).toEqual([0.34, 0.34, 1, 1]);
    expect(promptBars([mk(1)])).toBeNull();
  });

  test('the kind of work split, from the basis that answered, largest first, summing to 1', () => {
    const split = kindShares(card('kind_of_work'))!;
    expect(split.basis).toBe('role_split');
    expect(split.shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    for (let i = 1; i < split.shares.length; i++) expect(split.shares[i]!).toBeLessThanOrEqual(split.shares[i - 1]!);
    const labelled = kindShares({ ...card('kind_of_work'), basis: 'commit_subject_labels' })!;
    expect(labelled.basis).toBe('kind_split');
    expect(labelled.shares[0]).toBeCloseTo(12 / 25, 9);
  });

  test('the change of course scatter inks exactly the card\'s share of its blocks', () => {
    for (const share of [0, 0.25, 0.435, 1]) {
      const spec = artFor({ ...card('change_course'), value: share }, NO_SOURCES);
      expect(spec.kind === 'motif' && spec.amount).toBe(share);
      // Count the blocks drawn solid through a coarse probe at each block's centre.
      const f = fieldOf(spec, 100, 100);
      let solid = 0;
      let blocks = 0;
      const nx = 10;
      for (let by = 0; by < 10; by++)
        for (let bx = 0; bx < nx; bx++) {
          blocks += 1;
          if (Math.abs(f.data[(by * 10 + 3) * 100 + (bx * 10 + 3)]! - SCATTER_INK) < 1e-6) solid += 1;
        }
      expect(solid).toBe(Math.round(share * blocks));
    }
  });

  test('the go to prompt card draws one ring for every send', () => {
    const at = (sends: number) => {
      const spec = artFor({ ...card('go_to_prompt'), value: sends }, NO_SOURCES);
      expect(spec.basis).toBe('send_count');
      const W = 240;
      const H = 120;
      const f = fieldOf(spec, W, H);
      // A ray from the centre dot rightwards crosses each ring once: count the ink runs after
      // the dot. The centre is where the field is densest near the left third.
      let cx = 0;
      let cy = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W / 2; x++) if (f.data[y * W + x] === 1) ((cx = x), (cy = y));
      let runs = 0;
      let inRun = true; // standing on the dot
      for (let x = cx; x < W; x++) {
        const on = f.data[cy * W + x]! > 0;
        if (on && !inRun) runs += 1;
        inRun = on;
      }
      return runs;
    };
    expect(at(4)).toBe(4);
    expect(at(2)).toBe(2);
    expect(at(7)).toBe(7);
    // One send is no repetition: the seeded ripples, labelled as procedural.
    expect(artFor({ ...card('go_to_prompt'), value: 1 }, NO_SOURCES).basis).toBe('procedural');
  });

  test('the average prompt, drawn to scale: a block a word, the median in ink, the last word cut to the decimal', () => {
    const c = card('prompt_length'); // 29.9 words on average, a median of 16
    const spec = artFor(c, NO_SOURCES);
    expect(spec.kind).toBe('words');
    const blocks = paragraphBlocks(29.9, 16, seedOf('prompt_length'), 120, 80);
    expect(blocks.length).toBe(30);
    expect(blocks.filter((b) => b.lit).length).toBe(16);
    expect(blocks.slice(0, 16).every((b) => b.lit)).toBe(true);
    for (const b of blocks) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(120);
      expect(b.y + b.h).toBeLessThanOrEqual(80);
    }
    const f = fieldOf(spec, 120, 80);
    const round = (v: number) => Math.round(v * 1e4) / 1e4;
    expect(new Set(Array.from(f.data).filter((v) => v > 0).map(round))).toEqual(new Set([WORD_LIT, WORD_UNLIT].map(round)));
    // A whole average is whole blocks; nothing is drawn for no words.
    expect(paragraphBlocks(12, 3, 1, 120, 80).length).toBe(12);
    expect(paragraphBlocks(0, 0, 1, 120, 80)).toEqual([]);
  });
});

// The owner, on "How many agents": it must be real dithered data, never flat blocks.
describe('never a flat block', () => {
  const at = (h: number) => new Date(Date.UTC(2026, 8, 1, 10) + h * 3_600_000).toISOString();
  const sessions: ArtSession[] = [
    { started_at: at(0), ended_at: at(2) },
    { started_at: at(0.5), ended_at: at(1.5) },
    { started_at: at(1), ended_at: at(3) },
    { started_at: at(2.5), ended_at: at(3.4) },
  ];

  test('an agent lane is densest where the most sessions overlap, and never one flat value', () => {
    const lanes = peakLanes(sessions)!;
    const f = fieldOf({ kind: 'lanes', lanes, basis: 'peak_overlap' }, 120, 60);
    const values = Array.from(f.data).filter((v) => v > 0);
    expect(new Set(values).size).toBeGreaterThanOrEqual(4);
    expect(Math.max(...values)).toBeLessThanOrEqual(LANE_PEAK[0] + LANE_PEAK[1] + 1e-6);
    // The densest column is inside the stretch where all three peak sessions ran (1h to 1.5h).
    let best = -1;
    let bestX = 0;
    for (let x = 0; x < 120; x++) {
      let s = 0;
      for (let y = 0; y < 60; y++) s += f.data[y * 120 + x]!;
      if (s > best) ((best = s), (bestX = x));
    }
    const u = (bestX + 0.5) / 120;
    const peak = lanes.flat().filter((l) => l.peak);
    const from = Math.max(...peak.map((l) => l.from));
    const to = Math.min(...peak.map((l) => l.to));
    expect(u).toBeGreaterThanOrEqual(from - 1 / 120);
    expect(u).toBeLessThanOrEqual(to + 1 / 120);
  });

  test('with no sessions cached, the agents card draws its own count: a square an agent, the peak in ink', () => {
    const spec = artFor(card('agents_at_once'), NO_SOURCES); // 39 helper agents, up to 9 at once
    expect(spec).toEqual({ kind: 'tally', total: 39, lit: 9, basis: 'agent_count', hue: spec.hue });
    const blocks = tallyBlocks(39, 120, 70);
    expect(blocks.length).toBe(39);
    for (const b of blocks) {
      expect(b.x + b.s).toBeLessThanOrEqual(118);
      expect(b.y + b.s).toBeLessThanOrEqual(68);
    }
    const f = fieldOf(spec, 120, 70);
    const round = (v: number) => Math.round(v * 1e4) / 1e4;
    const lit = Array.from(f.data).filter((v) => round(v) === round(WORD_LIT)).length;
    const unlit = Array.from(f.data).filter((v) => round(v) === round(WORD_UNLIT)).length;
    const side = blocks[0]!.s;
    expect(lit).toBe(9 * side * side);
    expect(unlit).toBe(30 * side * side);
    // None ran: nothing to count, the seeded field instead.
    expect(artFor({ ...card('agents_at_once'), extras: {} }, NO_SOURCES).basis).toBe('procedural');
  });

  test('a bar is a lighter body under a cap of its full density', () => {
    const f = fieldOf({ kind: 'bars', bars: [{ h: 1, d: 1 }, { h: 0.5, d: 0.34 }], basis: 'attended_per_session' }, 20, 40);
    const column = (x: number) => Array.from({ length: 40 }, (_, y) => f.data[y * 20 + x]!);
    const deep = column(2);
    expect(deep[0]).toBe(1);
    expect(deep[1]).toBe(1);
    expect(deep[2]).toBeCloseTo(BAR_BODY, 6);
    expect(deep[39]).toBeCloseTo(BAR_BODY, 6);
    const short = column(12);
    expect(short[19]).toBe(0);
    expect(short[20]).toBeCloseTo(0.34, 6);
    expect(short[39]).toBeCloseTo(0.34 * BAR_BODY, 6);
  });

  test('the largest split band stops short of solid', () => {
    expect(BAND_INK[0]).toBeLessThan(1);
    const f = fieldOf(artFor(card('kind_of_work'), NO_SOURCES), 60, 20);
    expect(Math.max(...Array.from(f.data))).toBeCloseTo(BAND_INK[0], 6);
  });
});

// OWNER OVERRIDE, 2026-09-13 09:22 (brief.md): "why are all of them the same color? Looks
// horrible." v1 drew all fifteen headers in one amber over paper. Each card now wears its own
// hue (`tokens.spectrum.card` through `cardHue`) in DESIGN-V2 1.4's three levels: paper, the
// hue's partner, the hue's ink.
describe('every card in its own hue', () => {
  const ARCHETYPES = Object.keys(tokens.spectrum.archetype);

  test('the spec carries the card hue cardHue gives it, for the deck the sample describes', () => {
    const archetype = card('builder_type').value_id!;
    const src = { ...SAMPLE_SOURCES, archetype };
    for (const id of REPORT_ENUMS.wrapped_card) {
      expect({ id, hue: artFor(card(id), src).hue }).toEqual({ id, hue: cardHue(id, archetype).name });
    }
    // The sample builder is a quality guardian: card one is the crab's coral.
    expect(artFor(card('builder_type'), NO_SOURCES).hue).toBe('coral');
  });

  test('fifteen cards are not one colour: at least seven hues in every deck', () => {
    for (const archetype of ARCHETYPES) {
      const src = { ...NO_SOURCES, archetype };
      const hues = new Set(
        REPORT_ENUMS.wrapped_card.map((id) => artHue(id === 'builder_type' ? ({ ...card(id), value_id: archetype } as ReportWrappedCard) : card(id), src)),
      );
      expect({ archetype, n: hues.size >= 7 }).toEqual({ archetype, n: true });
    }
  });

  test('card one reads its own answer; a refused builder type is the generalist, amber', () => {
    const one = card('builder_type');
    expect(deckArchetype(one, NO_SOURCES)).toBe(one.value_id!);
    expect(artHue(one, NO_SOURCES)).toBe(archetypeHue(one.value_id).name);
    const refused = { ...one, reason: 'no_archetype_metric', value_id: null } as unknown as ReportWrappedCard;
    expect(artHue(refused, { ...NO_SOURCES, archetype: 'skeptic' })).toBe('amber');
  });

  test('cards two and three step to coral when card one already wears their hue', () => {
    // A velocity machine's card one is the bee's brass, which is card two's own hue; a
    // skeptic's is the whale's tide, card three's.
    expect(artHue(card('shipped'), { ...NO_SOURCES, archetype: 'velocity_machine' })).toBe('coral');
    expect(artHue(card('shipped'), { ...NO_SOURCES, archetype: 'skeptic' })).toBe('brass');
    expect(artHue(card('work_style'), { ...NO_SOURCES, archetype: 'skeptic' })).toBe('coral');
    expect(artHue(card('work_style'), NO_SOURCES)).toBe('tide');
    expect(artHue(card('builder_type'), NO_SOURCES)).not.toBe(artHue(card('shipped'), NO_SOURCES));
  });

  test('the tones are the hue\'s ink and partner, the mark tones on light', () => {
    for (const name of HUE_NAMES) {
      expect(artTones(name, 'dark')).toEqual({ ink: tokens.spectrum.hues[name].dark, partner: tokens.spectrum.hues[name].partner });
      expect(artTones(name, 'light')).toEqual({ ink: tokens.spectrum.hues[name].light, partner: tokens.spectrum.hues[name].lightPartner });
      // The partner is a step below the ink on the card, never the ink at a lower opacity.
      expect(artTones(name, 'dark').partner).not.toBe(hue(name).ink);
      expect(colors('dark').card).not.toBe(artTones(name, 'dark').partner);
    }
  });
});

describe('the three levels', () => {
  test('the recipe: nothing is paper, half is solid partner, full is solid ink', () => {
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const b = bayer8(x, y);
        expect(toneLevel(0, b)).toBe(0);
        expect(toneLevel(0.5, b)).toBe(1);
        expect(toneLevel(1, b)).toBe(2);
      }
    }
  });

  test('coverage climbs paper to partner to ink: a quarter is half partner, three quarters half ink', () => {
    const count = (v: number) => {
      const n = [0, 0, 0];
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) n[toneLevel(v, bayer8(x, y))]! += 1;
      return n;
    };
    expect(count(0.25)).toEqual([32, 32, 0]);
    expect(count(0.75)).toEqual([0, 32, 32]);
  });

  test('the two one level layers, ink over partner, are the recipe exactly: every grey against every threshold', () => {
    // The shader reads the field through 8 bit grey, so walk every level it can see.
    const w = 8 * 256;
    const data = new Float32Array(w * 8);
    for (let y = 0; y < 8; y++) for (let x = 0; x < w; x++) data[y * w + x] = 1 - Math.floor(x / 8) / 255;
    const field = { width: w, height: 8, data };
    const layers = toneLayers(field);
    const want = toneMask(field);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const b = bayer8(x, y);
        const ink = quantize(layers.ink.data[i]!) > b;
        const partner = quantize(layers.partner.data[i]!) > b;
        const got = ink ? 2 : partner ? 1 : 0;
        expect(got).toBe(want[i]!);
      }
    }
  });

  test('a refused card draws only its partner: thinned to FADED_INK, the field never reaches the ink level', () => {
    const spec = artFor(card('builder_type'), NO_SOURCES);
    const mask = toneMask(fieldOf(spec, COLS, ROWS, { faded: true }));
    expect(mask.some((v) => v === 1)).toBe(true);
    expect(mask.some((v) => v === 2)).toBe(false);
    const full = toneMask(fieldOf(spec, COLS, ROWS));
    expect(full.some((v) => v === 2)).toBe(true);
  });
});
