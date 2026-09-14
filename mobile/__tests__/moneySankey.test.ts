/**
 * The money Sankey (`src/money/flow.ts`), held without a renderer on a report shaped like the
 * live one of 2026-09-13: two projects, the second under the report's floor for splitting by
 * commit, three models, four token buckets and a burn floor.
 *
 * What it may never do: draw a stream the report does not carry (a bucket into a model, a dollar
 * for a stretch that changed nothing, the ending of a project the report would not split), lose
 * or invent a point of width between two columns, say "you spent", or put a dash in front of a
 * person.
 */
import { describe, expect, test } from 'bun:test';

import { dollars } from '../src/copy/money';
import { hasDash } from '../src/copy/plain';
import type { BuilderProfileResponse } from '../src/data/api';
import type { PricedModel, ReportBurn, ReportMoney, ReportProjects } from '../src/generated/report';
import fixture from '../src/insights/fixtures/report-2026-09-13.json';
import { isRefused, NO_REPORT } from '../src/insights/model';
import { GROUND, HUE_NAMES, SPECTRUM, type HueName } from '../src/insights/palette';
import {
  edgeY,
  endingOf,
  GEOMETRY,
  GREY_CLEAR,
  hitTest,
  labelNameLines,
  layoutSankey,
  litBy,
  MAX_PROJECTS,
  moneyFlow,
  onRibbon,
  projectHuesApart,
  relax,
  ribbonT,
  sentenceOf,
  withFlowFigures,
  type FlowPaint,
  type MoneyFlow,
  type Ribbon,
} from '../src/money/flow';
import { bucketHues, flowPaint, modelHueNames, NO_COMMIT_HUE, reservedForProjects } from '../src/money/hues';
import { apportion, columnUnits, dollarsOf, dollarUnit, roundFlow, roundRows, roundTable, shownUnits } from '../src/money/round';
import { PROJECT_HUES } from '../src/projects/model';
import { moneyPage } from '../src/you/chapters';

const NOW = Date.parse('2026-09-13T20:00:00Z');
const BASE = fixture.builder as unknown as BuilderProfileResponse;

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);

const MONEY: ReportMoney = {
  usd: 2549.26,
  basis: 'anthropic_api_list_price',
  reason: null,
  prices_read_on: '2026-09-06T00:00:00Z',
  priced_sessions: 141,
  unpriced_sessions: 0,
  usd_per_active_hour: 34.36,
  usd_without_a_commit: 167.14,
  share_without_a_commit: 0.066,
  tokens: { input: 73_980, output: 7_516_761, cache_read: 3_692_601_657, cache_w5m: 0, cache_w1h: 39_182_095 },
  token_sessions: 141,
  lines_added: 47_765,
  lines_removed: 1_682,
  lines_basis: 'project_edit_tools_and_credited_shell_writes',
  by_model: [
    { model: 'claude-opus-5', usd: 2296.88, output_tokens: 7_087_423, sessions: 134, sessions_dominated: 132, commits: 323, usd_per_commit: 7.06 },
    { model: 'claude-fable-5', usd: 241.41, output_tokens: 367_579, sessions: 7, sessions_dominated: 6, commits: 15, usd_per_commit: 14.02 },
    { model: 'claude-fable-5-1', usd: 10.98, output_tokens: 61_759, sessions: 2, sessions_dominated: 1, commits: 1, usd_per_commit: 2.94 },
  ],
};

const BURN: ReportBurn = {
  share: 0.028,
  barren_tokens: 105_262_948,
  tokens: 3_739_371_802,
  unreadable_tokens: 1_076_395_263,
  sessions: 141,
  needed: null,
  reason: null,
  causes: [{ cause: 'context_replay', tokens: 98_844_683, share: 0.939, segments: 201 }],
};

function projectMoney(over: Partial<ReportMoney>): ReportMoney {
  return { ...MONEY, tokens: null, by_model: [], ...over };
}

function projectsBlock(over: Partial<ReportProjects> = {}, projects?: unknown[]): ReportProjects {
  const list = projects ?? [
    {
      key: KEY_A,
      rank: 1,
      history: { first_at: '2026-08-12T00:44:30Z' },
      window: {
        sessions: 137,
        harnesses: [{ harness: 'claude_code', sessions: 137, active_seconds: 252_282 }],
        money: projectMoney({
          usd: 2387.73,
          priced_sessions: 136,
          usd_without_a_commit: 149.03,
          share_without_a_commit: 0.062,
          by_model: [
            { model: 'claude-opus-5', usd: 2135.35, output_tokens: 1, sessions: 1, sessions_dominated: 1, commits: 1, usd_per_commit: null },
            { model: 'claude-fable-5', usd: 241.41, output_tokens: 1, sessions: 1, sessions_dominated: 1, commits: 1, usd_per_commit: null },
            { model: 'claude-fable-5-1', usd: 10.98, output_tokens: 1, sessions: 1, sessions_dominated: 1, commits: 1, usd_per_commit: null },
          ],
        }),
      },
    },
    {
      key: KEY_B,
      rank: 2,
      history: { first_at: '2026-08-16T01:07:09Z' },
      window: {
        sessions: 5,
        harnesses: [{ harness: 'claude_code', sessions: 5, active_seconds: 15_198 }],
        money: projectMoney({
          usd: 161.53,
          priced_sessions: 5,
          usd_without_a_commit: null,
          share_without_a_commit: null,
          by_model: [{ model: 'claude-opus-5', usd: 161.53, output_tokens: 1, sessions: 1, sessions_dominated: 1, commits: 1, usd_per_commit: null }],
        }),
      },
    },
  ];
  return {
    window_days: 30,
    history_sessions: 160,
    history_first_at: '2026-08-12T00:44:30Z',
    projects_total: list.length,
    projects: list,
    unresolved: { sessions: 0, active_seconds: 0, attended_seconds: 0, history_sessions: 0 },
    comparisons: [],
    ...over,
  } as unknown as ReportProjects;
}

function builder(over: { money?: ReportMoney | null; burn?: ReportBurn | null; projects?: ReportProjects | null; names?: Record<string, string> } = {}): BuilderProfileResponse {
  return {
    ...BASE,
    report: {
      ...BASE.report!,
      money: over.money === undefined ? MONEY : over.money,
      burn: over.burn === undefined ? BURN : over.burn,
      projects: over.projects === undefined ? projectsBlock() : over.projects,
    },
    project_names: over.names ?? {},
  };
}

const PAINT: FlowPaint = {
  bucket: (key) => (key === 'cache_read' ? SPECTRUM.ember : SPECTRUM.brass),
  models: (families) => families.map((f) => (f === 'opus' ? SPECTRUM.iris : SPECTRUM.tide)),
  project: (key) => (key === KEY_A ? SPECTRUM.brass : SPECTRUM.coral),
};

function flowOf(b: BuilderProfileResponse = builder(), nicknames: Record<string, string> = {}): MoneyFlow {
  const page = moneyPage(b, NOW);
  if (!page) throw new Error('the report is priced');
  const f = moneyFlow(b, page, PAINT, nicknames);
  if (!f || isRefused(f)) throw new Error(`expected a flow, got ${JSON.stringify(f)}`);
  return f;
}

/** Every string anywhere in a value. */
function strings(x: unknown, out: string[] = []): string[] {
  if (typeof x === 'string') out.push(x);
  else if (Array.isArray(x)) for (const y of x) strings(y, out);
  else if (x && typeof x === 'object') for (const y of Object.values(x)) strings(y, out);
  return out;
}

const close = (a: number, b: number, eps = 0.5) => Math.abs(a - b) <= eps;

// ------------------------------------------------------------------ every flow is the report's

describe('every stream is a number the report carries', () => {
  const f = flowOf();
  const link = (s: string, t: string) => f.links.find((l) => l.source === s && l.target === t) ?? null;

  test('the token column is the buckets, in tokens; the models are by_model, in dollars', () => {
    const buckets = f.nodes.filter((x) => x.kind === 'bucket');
    expect(buckets.map((x) => [x.id, x.value])).toEqual([
      ['bucket:cache_read', 3_692_601_657],
      ['bucket:cache_write', 39_182_095],
      ['bucket:output', 7_516_761],
      ['bucket:input', 73_980],
    ]);
    expect(buckets.every((x) => !x.dollars)).toBe(true);
    const models = f.nodes.filter((x) => x.kind === 'model');
    expect(models.map((x) => [x.label, x.value, x.figure.final])).toEqual([
      ['Opus 5', 2296.88, '$2,297'],
      ['Fable 5', 241.41, '$241'],
      ['Fable 5.1', 10.98, '$11'],
    ]);
  });

  test('no bucket sends a stream to a model: that join is not in the report, so it is one stream and a sentence', () => {
    expect(f.links.some((l) => l.source.startsWith('bucket:'))).toBe(false);
    expect(f.tokens?.sentence).toBe('Every token, 3,739.4M, priced at API list prices read Sep 6: $2,549. On a subscription you pay your plan, not this.');
    expect(f.notes[0]).toContain('The report adds up each kind of token across every model, so it cannot show which model used which: the tokens reach the models as one stream.');
  });

  test('model into project: each project\'s own money block, to the cent', () => {
    expect(link('model:claude-opus-5', `project:${KEY_A}`)?.usd).toBe(2135.35);
    expect(link('model:claude-opus-5', `project:${KEY_B}`)?.usd).toBe(161.53);
    expect(link('model:claude-fable-5', `project:${KEY_A}`)?.usd).toBe(241.41);
    expect(link('model:claude-fable-5-1', `project:${KEY_A}`)?.usd).toBe(10.98);
    expect(link('model:claude-fable-5', `project:${KEY_B}`)).toBeNull();
    // What no project holds is only rounding here, so there is no "elsewhere" stream.
    expect(f.nodes.some((x) => x.id === 'project:elsewhere')).toBe(false);
  });

  test('how it ended: a split project by its own no commit figure; the one under the floor ends unsplit', () => {
    expect(link(`project:${KEY_A}`, 'outcome:none')?.usd).toBe(149.03);
    // Each project passes on exactly what its model streams bring in: its rows sum a cent over its
    // own total here, and the cent goes to the part the report derives as the rest.
    expect(link(`project:${KEY_A}`, 'outcome:commit')?.usd).toBeCloseTo(2135.35 + 241.41 + 10.98 - 149.03, 6);
    expect(link(`project:${KEY_B}`, 'outcome:commit')).toBeNull();
    expect(link(`project:${KEY_B}`, 'outcome:none')).toBeNull();
    const unsplit = link(`project:${KEY_B}`, 'outcome:unsplit');
    expect(unsplit?.usd).toBe(161.53);
    expect(unsplit?.hollow).toBe(true);
    expect(f.nodes.find((x) => x.id === 'outcome:unsplit')?.hollow).toBe(true);
    // The corpus figure is never subtracted to name what the report withheld for that project.
    expect(strings(f).some((s) => s.includes('$18'))).toBe(false);
    expect(f.notes.join(' ')).toContain('Private project\u00a02 has 5 priced sessions, too few for the report to say how many ended with a commit.');
    // Its scope is said without the corpus figure beside it: no $167 to subtract $149 from.
    // A chapter's name after a semicolon read as a capital in the middle of a sentence (22-money-05).
    expect(f.notes.join(' ')).toContain('This chart splits only the projects with enough sessions to split. The Where it went chapter, further down, counts every priced session together.');
    expect(f.notes.join(' ')).not.toContain('$167');
    expect(f.nodes.find((x) => x.id === 'outcome:unsplit')?.label).toBe('too few to tell');
  });

  test('the grey stream is tokens and says so: no dollar is ever put on a stretch that changed nothing', () => {
    expect(f.grey?.figure).toBe('at least 3%');
    expect(f.grey?.sentence).toBe(
      'At least 3% of your tokens went into stretches where nothing was written, tested or committed: 105.3M of them. They split off in grey and rejoin the stream before it is priced, because the report counts a stretch in tokens and prices those tokens with everything else.',
    );
    expect(f.grey?.sentence).not.toContain('$');
    expect(f.links.some((l) => l.id.includes('grey'))).toBe(false);
  });

  test('the band: where most of the dollars went, as the report counts it', () => {
    expect(f.band.figureText).toBe('94%');
    expect(f.band.figure?.final).toBe('94%');
    expect(f.band.caption).toBe('of what it would cost at API list prices went into Private project\u00a01');
    expect(f.band.note).toBe('From 3,739.4M tokens, through 3 models, into 2 projects.');
  });

  test('no dash, no "you spent", and the dollar is always at list prices', () => {
    for (const s of strings(f)) {
      expect({ s, dash: hasDash(s) }).toEqual({ s, dash: false });
      expect(s.toLowerCase()).not.toContain('you spent');
    }
    for (const x of f.nodes.filter((y) => y.kind === 'model' || y.kind === 'project')) expect(x.sentence).toContain('at list prices');
  });
});

describe('what a project is called', () => {
  test('a public name wins, then the owner\'s own name on this phone, then the number this phone gave it', () => {
    const labels = (b: BuilderProfileResponse, nick: Record<string, string>) => flowOf(b, nick).nodes.filter((x) => x.kind === 'project').map((x) => x.label);
    expect(labels(builder(), {})).toEqual(['Private project\u00a01', 'Private project\u00a02']);
    expect(labels(builder(), { [KEY_A]: 'Builda' })).toEqual(['Builda', 'Private project\u00a02']);
    expect(labels(builder({ names: { [KEY_A]: 'RideGT' } }), { [KEY_A]: 'Builda' })).toEqual(['RideGT', 'Private project\u00a02']);
  });
});

describe('refusals are sentences, and absent is not zero', () => {
  test('no report with a server profile: the report\'s own sentence', () => {
    const b = { ...builder(), report: null };
    expect(moneyFlow(b, { buckets: [], models: [] }, PAINT, {})).toEqual({ refusal: NO_REPORT });
  });

  test('a report without projects says so, and a refused price draws nothing (the first chapter says why)', () => {
    const b = builder({ projects: null });
    const r = moneyFlow(b, moneyPage(b, NOW)!, PAINT, {});
    expect(r && isRefused(r) ? r.refusal : null).toBe('Your Mac sent a report without its projects, so the dollars cannot be followed into one. A newer Mac sends them.');
    const refused = builder({ money: { ...MONEY, usd: null, basis: null, reason: 'tokens_not_reported' } });
    expect(moneyFlow(refused, { buckets: [], models: [{ key: 'claude-opus-5', name: 'Opus 5', family: 'opus', usd: 1 }] }, PAINT, {})).toBeNull();
  });

  test('a project with no priced session is left out, never drawn at $0', () => {
    const b = builder({
      projects: projectsBlock({}, [
        ...projectsBlock().projects,
        { key: `ffffff${'c'.repeat(58)}`, rank: 3, history: { first_at: '2026-09-01T00:00:00Z' }, window: { sessions: 2, harnesses: [], money: projectMoney({ usd: null, basis: null, reason: 'tokens_not_reported', priced_sessions: 0 }) } },
      ]),
    });
    expect(flowOf(b).nodes.some((x) => x.label.includes('ffffff'))).toBe(false);
  });
});

describe('more projects than fit, and dollars in no project', () => {
  test(`past ${MAX_PROJECTS} projects the smallest share one node, their sums intact`, () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      key: `${String(i).repeat(6)}${'d'.repeat(58)}`,
      rank: i + 1,
      history: { first_at: `2026-08-${String(10 + i).padStart(2, '0')}T00:00:00Z` },
      window: {
        sessions: 20,
        harnesses: [],
        money: projectMoney({
          usd: 100 * (7 - i),
          priced_sessions: 20,
          usd_without_a_commit: 10,
          share_without_a_commit: Math.round((10 / (100 * (7 - i))) * 1000) / 1000,
          by_model: [{ model: 'claude-opus-5', usd: 100 * (7 - i), output_tokens: 1, sessions: 1, sessions_dominated: 1, commits: 1, usd_per_commit: null }],
        }),
      },
    }));
    const money = { ...MONEY, usd: 2800, by_model: [{ ...MONEY.by_model[0]!, usd: 2800 }] };
    const f = flowOf(builder({ money, projects: projectsBlock({}, many) }));
    const projects = f.nodes.filter((x) => x.kind === 'project');
    expect(projects.length).toBe(MAX_PROJECTS);
    const more = projects.find((x) => x.id === 'project:more')!;
    expect(more.label).toBe('3 more projects');
    expect(more.value).toBe(300 + 200 + 100);
    expect(f.links.find((l) => l.id === 'project:more>outcome:none')?.usd).toBe(30);
  });

  test('dollars in sittings that belong to no project reach the flow as their own unsplit stream', () => {
    const money = { ...MONEY, usd: 2649.26, by_model: [{ ...MONEY.by_model[0]!, usd: 2396.88 }, MONEY.by_model[1]!, MONEY.by_model[2]!] };
    const f = flowOf(builder({ money, projects: projectsBlock({ unresolved: { sessions: 4, active_seconds: 1, attended_seconds: 1, history_sessions: 4 } }) }));
    const where = f.nodes.find((x) => x.id === 'project:elsewhere');
    expect(where?.label).toBe('in no project');
    expect(where?.value).toBeCloseTo(100, 6);
    expect(f.links.find((l) => l.id === 'project:elsewhere>outcome:unsplit')?.hollow).toBe(true);
    expect(f.notes.join(' ')).toContain('$100 is in sessions whose folder was no git repository, so they belong to no project.');
  });
});

describe('endingOf: the rest is "with a commit" only when every priced session had a commit count', () => {
  test('the share agrees: the rest ended with a commit', () => {
    expect(endingOf({ usd: 2387.73, usd_without_a_commit: 149.03, share_without_a_commit: 0.062 })).toEqual({ commit: 2387.73 - 149.03, none: 149.03, unsplit: 0 });
  });
  test('the share is over fewer dollars than the project: the rest is not split', () => {
    // 100 of 1,000 would be 10%; a share of 20% says only 500 of the dollars had a commit count.
    expect(endingOf({ usd: 1000, usd_without_a_commit: 100, share_without_a_commit: 0.2 })).toEqual({ commit: 0, none: 100, unsplit: 900 });
  });
  test('under the floor: all of it unsplit', () => {
    expect(endingOf({ usd: 161.53, usd_without_a_commit: null, share_without_a_commit: null })).toEqual({ commit: 0, none: 0, unsplit: 161.53 });
  });
});

describe('a project never wears a model\'s hue inside the picture', () => {
  test('the oldest project keeps its own hue unless a model wears it, then steps round to the first free one', () => {
    const order = ['tide', 'ember', 'iris', 'brass', 'orchid'] as const;
    expect(projectHuesApart({ a: 'tide', b: 'ember' }, order, ['iris', 'tide'])).toEqual({ a: 'brass', b: 'ember' });
    expect(projectHuesApart({ a: 'orchid' }, order, ['iris'])).toEqual({ a: 'orchid' });
  });
});

// ------------------------------------------------------------------ the geometry

describe('the layout loses and invents no width', () => {
  const f = flowOf();
  const L = layoutSankey(f, 362);
  const node = (id: string) => L.nodes.find((x) => x.id === id)!;
  const thick = (r: Ribbon) => r.y0b - r.y0a;

  test('every ribbon keeps its width end to end, and in and out of a node add up', () => {
    for (const l of L.links) expect(close(l.ribbon.y0b - l.ribbon.y0a, l.ribbon.y1b - l.ribbon.y1a, 1e-9)).toBe(true);
    for (const nd of L.nodes.filter((x) => x.column === 2)) {
      const inW = L.links.filter((l) => f.links.find((y) => y.id === l.id)!.target === nd.id).reduce((s, l) => s + thick(l.ribbon), 0);
      const outW = L.links.filter((l) => f.links.find((y) => y.id === l.id)!.source === nd.id).reduce((s, l) => s + thick(l.ribbon), 0);
      expect(close(inW, outW, 0.05)).toBe(true);
      expect(close(nd.h, Math.max(inW, outW), 1e-9)).toBe(true);
    }
  });

  test('the priced streams out of the rule fill the token stream exactly, and so do the buckets', () => {
    const tr = L.trunk!;
    expect(close(L.fans.reduce((s, x) => s + thick(x.ribbon), 0), tr.bottom - tr.top, 1e-6)).toBe(true);
    const buckets = L.nodes.filter((x) => x.column === 0);
    expect(close(buckets.reduce((s, x) => s + x.h, 0), tr.bottom - tr.top, 1e-6)).toBe(true);
    // Every bucket, however small, keeps a mark.
    expect(buckets.every((x) => x.h >= GEOMETRY.minNode - 1e-9)).toBe(true);
  });

  test('the grey stream leaves the token stream\'s foot and comes back before the rule, as thick as its share', () => {
    const g = L.grey!;
    const tr = L.trunk!;
    const [down, , up] = g.parts as [Ribbon, Ribbon, Ribbon];
    expect(down.x0).toBeGreaterThan(tr.x0);
    expect(up.x1).toBeLessThan(tr.x1);
    expect([down.y0a, down.y0b]).toEqual([tr.bottom - g.thick, tr.bottom]);
    expect([up.y1a, up.y1b]).toEqual([tr.bottom - g.thick, tr.bottom]);
    expect(close(g.thick, Math.max(GEOMETRY.minGrey, f.grey!.share * (tr.bottom - tr.top)), 1e-9)).toBe(true);
    expect(down.y1b).toBeGreaterThan(tr.bottom);
  });

  test('a label is drawn with every line the layout made room for, never a fixed three', () => {
    // FOUND IN THE now3 PASS (2026-09-14): the grouped token name read "cache writes, output, an..."
    expect(labelNameLines({ h: 4 * GEOMETRY.nameLine + GEOMETRY.figureLine })).toBe(4);
    expect(labelNameLines({ h: GEOMETRY.nameLine + GEOMETRY.figureLine })).toBe(1);
    for (const l of L.labels) expect(labelNameLines(l)).toBeGreaterThanOrEqual(1);
  });

  test('columns left to right, the rule between the tokens and the models, no label over another in a lane', () => {
    expect(L.columns.map((c) => c.title)).toEqual(['tokens', 'models', 'projects', 'ended']);
    expect(L.trunk!.x1).toBeLessThan(node('model:claude-opus-5').x);
    const lanes = [L.labels.filter((l) => l.x < L.trunk!.x1), L.labels.filter((l) => l.x > node('model:claude-opus-5').x && l.x < node(`project:${KEY_A}`).x), L.labels.filter((l) => l.x > node(`project:${KEY_A}`).x)];
    for (const lane of lanes) {
      const ys = [...lane].sort((a, b) => a.y - b.y);
      for (let i = 1; i < ys.length; i++) expect(ys[i]!.y).toBeGreaterThanOrEqual(ys[i - 1]!.y + ys[i - 1]!.h);
    }
    // The token column's words stop short of the rule.
    for (const l of L.labels.filter((x) => x.id.startsWith('bucket:'))) expect(l.x + l.w).toBeLessThanOrEqual(L.trunk!.x1);
  });

  test('a label on a stream is flagged, so its figure is set in white rather than its own ink (unless the ground is cut back under it)', () => {
    expect(L.labels.find((l) => l.id === 'model:claude-opus-5')?.onStream).toBe(true);
    expect(L.labels.find((l) => l.id === 'bucket:cache_read')?.onStream).toBe(true);
  });
});

describe('the curve a tap is tested against is the curve that is drawn', () => {
  test('ribbonT inverts the edge\'s x, and edgeY is the S between the two heights', () => {
    const r = { x0: 10, x1: 110 };
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const x = 10 + 100 * (1.5 * t * (1 - t) + t * t * t);
      expect(ribbonT(r, x)).toBeCloseTo(t, 5);
    }
    expect(edgeY(0, 100, 0.5)).toBe(50);
    expect(edgeY(20, 80, 0)).toBe(20);
    expect(edgeY(20, 80, 1)).toBe(80);
  });

  test('a tap on a stream, a node, a label, the grey stream and the ground', () => {
    const f = flowOf();
    const L = layoutSankey(f, 362);
    const opus = L.links.find((l) => l.id === `model:claude-opus-5>project:${KEY_A}`)!;
    const t = 0.5;
    const x = opus.ribbon.x0 + (opus.ribbon.x1 - opus.ribbon.x0) * (1.5 * t * (1 - t) + t * t * t);
    const y = (edgeY(opus.ribbon.y0a, opus.ribbon.y1a, t) + edgeY(opus.ribbon.y0b, opus.ribbon.y1b, t)) / 2;
    // A label over the stream takes the tap for its node (names are tap targets too).
    const hitLabel = L.labels.find((l) => l.x <= x && x <= l.x + l.w && l.y <= y && y <= l.y + l.h);
    expect(hitTest(L, x, y)).toBe(hitLabel ? hitLabel.id : opus.id);
    const low = { x: opus.ribbon.x0 + 20, y: (opus.ribbon.y0a + opus.ribbon.y0b) / 2 + 60 };
    expect(L.labels.some((l) => l.x <= low.x && low.x <= l.x + l.w && l.y <= low.y && low.y <= l.y + l.h)).toBe(false);
    expect(hitTest(L, low.x, low.y)).toBe(opus.id);
    const n = L.nodes.find((q) => q.id === 'outcome:none')!;
    expect(hitTest(L, n.x + n.w / 2, n.y + n.h / 2)).toBe('outcome:none');
    const g = L.grey!.parts[1]!;
    expect(hitTest(L, (g.x0 + g.x1) / 2, (g.y0a + g.y0b) / 2)).toBe('grey');
    expect(hitTest(L, L.width - 2, L.height - 1)).toBeNull();
    expect(onRibbon(opus.ribbon, opus.ribbon.x0 - 5, y)).toBeNull();
  });

  test('a tap lights a node with every stream through it, or a stream with its two ends, and says what it carries', () => {
    const f = flowOf();
    const lit = litBy(f, `project:${KEY_B}`)!;
    expect([...lit].sort()).toEqual([`model:claude-opus-5`, `model:claude-opus-5>project:${KEY_B}`, 'outcome:unsplit', `project:${KEY_B}`, `project:${KEY_B}>outcome:unsplit`].sort());
    expect(sentenceOf(f, null)).toBe(f.summary);
    expect(sentenceOf(f, 'grey')).toBe(f.grey!.sentence);
    expect(sentenceOf(f, 'fan:model:claude-fable-5')).toBe(f.nodes.find((x) => x.id === 'model:claude-fable-5')!.sentence);
    // The streams are fitted to the nodes (`round.roundTable`, else row by row): Opus 5's two add up
    // to Opus 5, and this one keeps its own nearest dollar.
    expect(sentenceOf(f, `model:claude-opus-5>project:${KEY_A}`)).toBe("Opus 5 into Private project\u00a01: $2,135 at list prices, 93% of Opus 5's dollars and 89% of the project's.");
  });
});

describe('relax', () => {
  test('pushes overlapping labels apart in order and keeps them inside their bounds', () => {
    const ys = relax([
      { y: 0, h: 30, lo: 0, hi: 1000 },
      { y: 10, h: 30, lo: 0, hi: 1000 },
      { y: 100, h: 30, lo: 100, hi: 100 },
    ]);
    expect(ys[0]).toBe(0);
    expect(ys[1]).toBeGreaterThanOrEqual(34);
    expect(ys[2]).toBe(100);
  });
});

// ------------------------------------------------------------------ the parts add up to the whole

describe('the parts a person reads add up to the whole they read (review, 2026-09-13)', () => {
  // The live report of 2026-09-13, 17:30: rounded alone, the models read $2,263 + $241 + $10.98 =
  // $2,514.98 under a $2,516 total, and Opus 5's sentence said $2,263, then $2,102 + $162 = $2,264.
  const LIVE_MONEY: ReportMoney = {
    ...MONEY,
    usd: 2515.61,
    by_model: [
      { ...MONEY.by_model[0]!, usd: 2263.23 },
      { ...MONEY.by_model[1]!, usd: 241.41 },
      { ...MONEY.by_model[2]!, usd: 10.98 },
    ],
  };
  const row = (model: PricedModel, usd: number) => ({ model, usd, output_tokens: 1, sessions: 1, sessions_dominated: 1, commits: 1, usd_per_commit: null });
  const LIVE_PROJECTS = projectsBlock({}, [
    {
      key: KEY_A,
      rank: 1,
      history: { first_at: '2026-08-12T00:44:30Z' },
      window: {
        sessions: 136,
        harnesses: [],
        money: projectMoney({
          usd: 2354.08,
          priced_sessions: 135,
          usd_without_a_commit: 149.03,
          share_without_a_commit: 0.063,
          by_model: [row('claude-opus-5', 2101.7), row('claude-fable-5', 241.41), row('claude-fable-5-1', 10.98)],
        }),
      },
    },
    {
      key: KEY_B,
      rank: 2,
      history: { first_at: '2026-08-16T01:07:09Z' },
      window: { sessions: 5, harnesses: [], money: projectMoney({ usd: 161.53, priced_sessions: 5, usd_without_a_commit: null, share_without_a_commit: null, by_model: [row('claude-opus-5', 161.53)] }) },
    },
  ]);
  const b = builder({ money: LIVE_MONEY, projects: LIVE_PROJECTS });
  const f = flowOf(b);
  const shown = (x: { figure: { final: string } }) => Number(x.figure.final.replace(/[$,]/g, ''));
  const column = (kind: string) => f.nodes.filter((x) => x.kind === kind);
  const amounts = (s: string) => [...s.matchAll(/\$([\d,]+)/g)].map((m) => Number(m[1]!.replace(/,/g, '')));

  test('rounded alone, the live numbers do not add up: this is the case the rule is for', () => {
    expect(LIVE_MONEY.by_model.map((m) => dollars(m.usd))).toEqual(['$2,263', '$241', '$10.98']);
    expect(dollars(LIVE_MONEY.usd!)).toBe('$2,516');
  });

  test('every column adds up to the page\'s $2,516', () => {
    expect(f.summary.startsWith('$2,516 at list prices')).toBe(true);
    for (const kind of ['model', 'project', 'outcome']) expect({ kind, sum: column(kind).reduce((s, x) => s + shown(x), 0) }).toEqual({ kind, sum: 2516 });
    // The models by the largest remainder method, the column set beside the total and the ring.
    expect(column('model').map((x) => x.figure.final)).toEqual(['$2,263', '$242', '$11']);
  });

  test('every sentence\'s parts add up to the figure it opens with', () => {
    const opus = f.nodes.find((x) => x.id === 'model:claude-opus-5')!;
    expect(opus.sentence).toBe('Opus 5: $2,263 at list prices, 90% of every dollar. $2,101 into Private project\u00a01 and $162 into Private project\u00a02.');
    for (const x of [...column('model'), ...column('project').filter((p) => p.id === `project:${KEY_A}`)]) {
      const [whole, ...parts] = amounts(x.sentence);
      expect({ id: x.id, sum: parts.reduce((s, v) => s + v, 0) }).toEqual({ id: x.id, sum: whole! });
    }
  });

  test('a stream reads the same in every place it is said: a project\'s only stream is the project', () => {
    const intoB = f.links.find((l) => l.id === `model:claude-opus-5>project:${KEY_B}`)!;
    const b03 = f.nodes.find((x) => x.id === `project:${KEY_B}`)!;
    expect(amounts(intoB.sentence)[0]).toBe(shown(b03));
    expect(f.nodes.find((x) => x.id === 'model:claude-opus-5')!.sentence).toContain(`$${shown(b03)} into Private project\u00a02`);
  });

  test('every shown figure is the floor or the ceiling of its true value', () => {
    for (const x of f.nodes.filter((y) => y.dollars)) expect({ id: x.id, off: Math.abs(shown(x) - x.value) < 1 }).toEqual({ id: x.id, off: true });
  });

  test('the ring on the same page reads each model as the chart does', () => {
    const page = moneyPage(b, NOW)!;
    expect(page.models.reduce((s, m) => s + m.num.value, 0)).toBe(2516);
    // The page apportions on its own, and the screen hands the ring the flow's figures when drawn.
    expect(page.models.map((m) => m.num.final)).toEqual(['$2,263', '$242', '$11']);
    expect(withFlowFigures(page.models, f).map((m) => m.num.final)).toEqual(column('model').map((x) => x.figure.final));
  });
});

describe('apportion and roundFlow', () => {
  test('the largest remainder method for one sum', () => {
    expect(apportion([1.4, 1.4, 1.2], 4)).toEqual([2, 1, 1]);
    expect(apportion([2263.23, 241.41, 10.98], 2516)).toEqual([2263, 242, 11]);
    expect(apportion([0.5, 0.5], 1)).toEqual([1, 0]);
  });

  test('a flow rounded at once: each edge a floor or a ceiling, every node balanced, the total held', () => {
    const edges = [
      { id: 'in>a', from: 'in', to: 'a', value: 1.5 },
      { id: 'in>b', from: 'in', to: 'b', value: 1.5 },
      { id: 'a>x', from: 'a', to: 'x', value: 1.5 },
      { id: 'b>x', from: 'b', to: 'x', value: 0.75 },
      { id: 'b>y', from: 'b', to: 'y', value: 0.75 },
      { id: 'x>out', from: 'x', to: 'out', value: 2.25 },
      { id: 'y>out', from: 'y', to: 'out', value: 0.75 },
    ];
    const r = roundFlow(edges, 'in', 'out', 3)!;
    for (const e of edges) expect([Math.floor(e.value), Math.ceil(e.value)]).toContain(r.get(e.id)!);
    const bal = (v: string) => edges.filter((e) => e.to === v).reduce((s, e) => s + r.get(e.id)!, 0) - edges.filter((e) => e.from === v).reduce((s, e) => s + r.get(e.id)!, 0);
    for (const v of ['a', 'b', 'x', 'y']) expect(bal(v)).toBe(0);
    expect(r.get('in>a')! + r.get('in>b')!).toBe(3);
    // A total that is not the floor or the ceiling of the flow cannot be reached.
    expect(roundFlow(edges, 'in', 'out', 5)).toBeNull();
  });

  test('a positive part that rounds to nothing reads "under $1", never "$0"', () => {
    expect(dollarsOf(0, 1, 0.43)).toBe('under $1');
    expect(dollarsOf(2516, 1, 2515.61)).toBe('$2,516');
    expect(dollarsOf(4217, 0.01, 42.17)).toBe('$42.17');
    // 42.165 as written rounds half up to $42.17: the one rounding rule (`copy/numbers.ts`, 2026-09-14).
    expect([dollarUnit(2515.61), dollarUnit(42.17), shownUnits(2515.61, 1), shownUnits(42.165, 0.01)]).toEqual([1, 0.01, 2516, 4217]);
  });
});

describe('leftover dollars are said by the report\'s own reason, or not at all', () => {
  const withLeft = (over: Partial<ReportProjects>) => {
    const money = { ...MONEY, usd: 2649.26, by_model: [{ ...MONEY.by_model[0]!, usd: 2396.88 }, MONEY.by_model[1]!, MONEY.by_model[2]!] };
    return flowOf(builder({ money, projects: projectsBlock(over) }));
  };
  test('projects past the list are "unlisted", never "no project"', () => {
    const f = withLeft({ projects_total: 22 });
    expect(f.nodes.find((x) => x.id === 'project:elsewhere')?.label).toBe('20 unlisted projects');
    expect(f.notes.join(' ')).toContain('$100 is in 20 projects past the 2 the report lists.');
    expect(f.notes.join(' ')).not.toContain('git repository');
  });
  test('neither reason in the report: it says so and names no cause of its own', () => {
    const f = withLeft({});
    expect(f.nodes.find((x) => x.id === 'project:elsewhere')?.label).toBe('not in a project');
    expect(f.notes.join(' ')).toContain('$100 is in no project the report lists, and the report does not say where.');
  });
  test('no leftover: nothing said about one', () => {
    expect(flowOf().notes.join(' ')).not.toMatch(/project the report lists|git repository|unlisted/);
  });
});

describe('the grey stream leaves the whole stream, not the small buckets (review, 2026-09-13)', () => {
  test('it splits well after the bucket column, and past the small buckets\' reach', () => {
    const L = layoutSankey(flowOf(), 362);
    const bucketRight = Math.max(...L.nodes.filter((x) => x.column === 0).map((x) => x.x + x.w));
    expect(L.grey!.split).toBeGreaterThanOrEqual(L.trunk!.x0 + GREY_CLEAR);
    expect(L.grey!.split - bucketRight).toBeGreaterThanOrEqual(GREY_CLEAR);
    expect(L.grey!.rejoin).toBeLessThan(L.trunk!.x1);
  });
});

describe('words a person would say', () => {
  test('no "the rule", no "unsplit", no "not split", no buckets meeting models, no "spend", no dash', () => {
    const all = strings(flowOf()).filter((s) => !/^(model|project|bucket|outcome|fan|in>|trunk|grey)[:>]/.test(s) && !/^#/.test(s));
    for (const s of all) {
      expect({ s, bad: /\bthe rule\b|\bunsplit\b|not split|buckets meet|Mac's report|of the spend|\bspent\b/i.test(s) || hasDash(s) }).toEqual({ s, bad: false });
    }
  });

  test('chapter 03 says its share in the chart\'s terms, and what it is really over when not every session was counted', () => {
    const counted = moneyPage(builder(), NOW)!.without;
    expect(counted && !isRefused(counted) ? counted.rest : null).toBe('on sessions that ended with no commit, 7% of every dollar at API list prices');
    const partly = moneyPage(builder({ money: { ...MONEY, share_without_a_commit: 0.2 } }), NOW)!.without;
    expect(partly && !isRefused(partly) ? partly.rest : null).toBe('on sessions that ended with no commit, 20% of the dollars on sessions with a commit count');
  });
});

// ------------------------------------------------------------------ one project, one figure, on every page

describe('a project reads the same dollars here as on its own page (review, 2026-09-13)', () => {
  const r = (model: PricedModel, usd: number) => ({ model, usd, output_tokens: 1, sessions: 1, sessions_dominated: 1, commits: 1, usd_per_commit: null });
  /** The live shape: a big project on three models and a small one under the floor, on Opus 5 alone. */
  function live(total: number, opus: number, a: number, aOpus: number) {
    const money: ReportMoney = { ...MONEY, usd: total, by_model: [{ ...MONEY.by_model[0]!, usd: opus }, { ...MONEY.by_model[1]!, usd: 241.41 }, { ...MONEY.by_model[2]!, usd: 10.98 }] };
    const projects = projectsBlock({}, [
      { key: KEY_A, rank: 1, history: { first_at: '2026-08-12T00:44:30Z' }, window: { sessions: 135, harnesses: [], money: projectMoney({ usd: a, priced_sessions: 134, usd_without_a_commit: 149.03, share_without_a_commit: Math.round((149.03 / a) * 1000) / 1000, by_model: [r('claude-opus-5', aOpus), r('claude-fable-5', 241.41), r('claude-fable-5-1', 10.98)] }) } },
      { key: KEY_B, rank: 2, history: { first_at: '2026-08-16T01:07:09Z' }, window: { sessions: 5, harnesses: [], money: projectMoney({ usd: 161.53, priced_sessions: 5, usd_without_a_commit: null, share_without_a_commit: null, by_model: [r('claude-opus-5', 161.53)] }) } },
    ]);
    return { b: builder({ money, projects }), f: flowOf(builder({ money, projects })) };
  }
  const shown = (x: { figure: { final: string } }) => Number(x.figure.final.replace(/[$,]/g, ''));
  const node = (f: MoneyFlow, id: string) => f.nodes.find((x) => x.id === id)!;
  const amounts = (s: string) => [...s.matchAll(/\$([\d,]+)/g)].map((m) => Number(m[1]!.replace(/,/g, '')));
  const everyProjectAsItsPage = (b: BuilderProfileResponse, f: MoneyFlow) => {
    for (const p of b.report!.projects!.projects) {
      const usd = p.window?.money.usd;
      if (typeof usd !== 'number') continue;
      expect({ key: p.key.slice(0, 6), chart: node(f, `project:${p.key}`).figure.final }).toEqual({ key: p.key.slice(0, 6), chart: dollars(usd) });
    }
  };

  test('the case reported: $161.53 read $161 in the chart and $162 on its page; now $162 in both', () => {
    // 2,324.47 + 161.53: the projects' own dollars, 2,324 + 162, make the $2,486 total.
    const { b, f } = live(2486.0, 2233.61, 2324.47, 2072.08);
    expect(node(f, `project:${KEY_B}`).figure.final).toBe('$162');
    everyProjectAsItsPage(b, f);
    expect(f.notes.join(' ')).not.toContain('own page rounds it');
    expect(f.nodes.filter((x) => x.kind === 'project').reduce((s, x) => s + shown(x), 0)).toBe(2486);
  });

  test('the live report of 17:50: the projects\' own dollars cannot make the total, so each keeps its page\'s and the chart says what they come to', () => {
    // 2,324.90 + 161.53 = 2,486.43, shown $2,486; their own dollars are 2,325 + 162 = 2,487. No
    // rounding of that column agrees with both pages and the total: the pages win, said in words.
    const { b, f } = live(2486.43, 2234.05, 2324.9, 2072.52);
    expect(f.nodes.filter((x) => x.kind === 'project').map((x) => x.figure.final)).toEqual(['$2,325', '$162']);
    everyProjectAsItsPage(b, f);
    expect(f.notes).toContain('Each project here reads as its own page rounds it, so together they come to $2,487, a dollar over the $2,486 total.');
    // The models still make the total; the endings are rounded to the projects' column.
    expect(f.nodes.filter((x) => x.kind === 'model').reduce((s, x) => s + shown(x), 0)).toBe(2486);
    expect(f.nodes.filter((x) => x.kind === 'outcome').map((x) => x.figure.final)).toEqual(['$2,176', '$149', '$162']);
    // Every tap sentence adds up to the node it opens with, and the lone stream reads as its project.
    for (const x of f.nodes.filter((y) => y.kind === 'model' || y.id === `project:${KEY_A}`)) {
      const [whole, ...parts] = amounts(x.sentence);
      expect({ id: x.id, sum: parts.reduce((s, v) => s + v, 0) }).toEqual({ id: x.id, sum: whole! });
    }
    expect(amounts(f.links.find((l) => l.id === `model:claude-opus-5>project:${KEY_B}`)!.sentence)[0]).toBe(162);
  });

  test('every project in every report here reads as its own page', () => {
    everyProjectAsItsPage(builder(), flowOf());
    const { b, f } = live(2515.61, 2263.23, 2354.08, 2101.7);
    everyProjectAsItsPage(b, f);
  });
});

describe('controlled rounding of the streams', () => {
  test('a two way table fitted to whole margins, every row and column exact', () => {
    const cells = [
      { id: 'a1', row: 'a', col: '1', value: 2101.7 },
      { id: 'a2', row: 'a', col: '2', value: 161.53 },
      { id: 'b1', row: 'b', col: '1', value: 241.41 },
      { id: 'c1', row: 'c', col: '1', value: 10.98 },
    ];
    const t = roundTable(cells, new Map([['a', 2263], ['b', 242], ['c', 11]]), new Map([['1', 2354], ['2', 162]]))!;
    expect(Object.fromEntries(t)).toEqual({ a1: 2101, a2: 162, b1: 242, c1: 11 });
    // Margins that add up to different wholes: no table, rows still exact, the lone cell its margin.
    expect(roundTable(cells, new Map([['a', 2263], ['b', 241], ['c', 11]]), new Map([['1', 2354], ['2', 162]]))).toBeNull();
    const rows = roundRows(cells, new Map([['a', 2263], ['b', 241], ['c', 11]]), new Map([['1', 2354], ['2', 162]]));
    expect(rows.get('a1')! + rows.get('a2')!).toBe(2263);
    expect(rows.get('a2')).toBe(162);
  });

  test('a column\'s own nearest dollars when they make the whole, the largest remainder when they cannot', () => {
    expect(columnUnits([2324.47, 161.53], 2486, 1)).toEqual([2324, 162]);
    expect(columnUnits([2263.23, 241.41, 10.98], 2516, 1)).toEqual([2263, 242, 11]);
    expect(columnUnits([2234.05, 241.41, 10.98], 2486, 1)).toEqual([2234, 241, 11]);
  });
});

// ------------------------------------------------------------------ one hue, one meaning (2026-09-14)

describe('one hue means one thing on the Money page: the flow wears the page\'s hues', () => {
  // The account's own report: Opus and Fable, project 1 tide and project 2 ember on the Projects tab.
  const b = builder();
  const page = moneyPage(b, NOW)!;
  const families = page.models.map((m) => m.family);
  const buckets = bucketHues(families);
  const own: Record<string, HueName> = { [KEY_A]: 'tide', [KEY_B]: 'ember' };
  const apart = projectHuesApart(own, PROJECT_HUES, modelHueNames(families), reservedForProjects(families));
  const f = moneyFlow(b, page, flowPaint(buckets, (k) => apart[k]!), {}) as MoneyFlow;

  test('no project wears a model\'s hue or no commit\'s, and no kind of token wears a hue; each keeps its own when it can', () => {
    // FOUND IN THE CAPTURE (22-money-04): project 1 stepped to brass, the yellow of cache writes, and
    // project 2 kept ember, the orange of cache reads. The kinds of token now wear the ground's white.
    for (const x of f.nodes.filter((n) => n.kind === 'bucket')) expect(x.hue.ink).toBe(GROUND.text);
    void buckets;
    const worn = new Set<HueName>([...modelHueNames(families), NO_COMMIT_HUE]);
    for (const k of [KEY_A, KEY_B]) expect({ k, clash: worn.has(apart[k]!) }).toEqual({ k, clash: false });
    expect(apart[KEY_B]).toBe('ember');
    expect(apart[KEY_A]).not.toBe(apart[KEY_B]);
  });

  test('every node that is a key by colour wears a colour no other kind of node wears', () => {
    // Nodes of one family share a hue on purpose (Fable 5 and 5.1: the family's ink and partner);
    // the endings "with a commit" and "too few to tell" are neutrals drawn with their words beside them.
    const byInk = new Map<string, Set<string>>();
    for (const x of f.nodes) {
      if (x.kind === 'outcome' && x.id !== 'outcome:none') continue;
      // Every kind of token is one meaning here, "tokens": they wear one neutral and are named in words.
      const meaning = x.kind === 'model' ? `model:${page.models.find((m) => `model:${m.key}` === x.id)?.family}` : x.kind === 'bucket' ? 'tokens' : x.id;
      const hue = HUE_NAMES.find((h) => SPECTRUM[h].ink === x.hue.ink || SPECTRUM[h].partner === x.hue.ink) ?? x.hue.ink;
      if (!byInk.has(hue)) byInk.set(hue, new Set());
      byInk.get(hue)!.add(meaning);
    }
    for (const [hue, meanings] of byInk) expect({ hue, meanings: [...meanings] }).toEqual({ hue, meanings: [...meanings].slice(0, 1) });
  });

  test('"no commit" wears heather, the Where it went chapter\'s hue for the same dollars', () => {
    expect(f.nodes.find((x) => x.id === 'outcome:none')!.hue.ink).toBe(SPECTRUM[NO_COMMIT_HUE].ink);
    // Without a hue from the page, the ending stays the neutral it was.
    const plain = moneyFlow(b, page, PAINT, {}) as MoneyFlow;
    expect(plain.nodes.find((x) => x.id === 'outcome:none')!.hue.ink).toBe(GROUND.dim);
  });
});

describe('a label a ribbon runs under has the ground cut back under its words', () => {
  const b = builder();
  const page = moneyPage(b, NOW)!;
  const families = page.models.map((m) => m.family);
  const apart = projectHuesApart({ [KEY_A]: 'tide', [KEY_B]: 'ember' } as Record<string, HueName>, PROJECT_HUES, modelHueNames(families), reservedForProjects(families));
  const f = moneyFlow(b, page, flowPaint(bucketHues(families), (k) => apart[k]!), {}) as MoneyFlow;
  const L = layoutSankey(f, 362);
  const label = (id: string) => L.labels.find((l) => l.id === id)!;

  test('the two the capture found crossed are cut back: Fable 5\'s "$241" and "too few to tell"', () => {
    // FOUND IN THE CAPTURE (22-money-08, 09): Opus 5's stream ran through "$241", and the dashed
    // outline of the stream the report does not split ran through "$162".
    expect(label('model:claude-fable-5').knockout).toBe(true);
    expect(label('outcome:unsplit').knockout).toBe(true);
  });

  test('the token stream\'s grain is not a ribbon: its words read on it and are not cut back', () => {
    expect(label('bucket:cache_read').onStream).toBe(true);
    expect(label('bucket:cache_read').knockout).toBe(false);
  });

  test('a label clear of every ribbon is not cut back', () => {
    // The last project's name hangs under its node, on the ground.
    for (const l of L.labels) {
      if (l.knockout) continue;
      const x0 = l.align === 'left' ? l.x : l.x + l.w - 40;
      for (let x = x0; x <= x0 + 40; x += 4) {
        const y = l.y + l.h - GEOMETRY.figureLine / 2;
        const hit = L.links.some((k) => onRibbon(k.ribbon, x, y, 0) !== null) || L.fans.some((k) => onRibbon(k.ribbon, x, y, 0) !== null);
        expect({ id: l.id, x, hit }).toEqual({ id: l.id, x, hit: false });
      }
    }
  });
});
