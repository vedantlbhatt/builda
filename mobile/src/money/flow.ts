/**
 * The money Sankey, as data and geometry. The owner picked it from a list of ideas: "a money
 * Sankey: tokens flowing into models into projects into commits, with wasted stretches splitting
 * off as a grey stream". Pure: no React Native and no Skia, so `__tests__/moneySankey.test.ts`
 * holds every flow, every sentence, the layout's arithmetic and what a tap lands on.
 *
 * EVERY FLOW IS A NUMBER THE REPORT CARRIES, and nothing is priced here (`analysis/pricing.py`
 * is the only place a price lives):
 *
 *   tokens      `report.money.tokens`, the buckets summed over every session. In TOKENS: dollars
 *               per bucket are not in the report, so this column is labelled as tokens.
 *   models      `report.money.by_model`, dollars at API list prices per price table row.
 *   projects    `report.projects.projects[].window.money.by_model`: each project's own money
 *               block (`analysis/projects.py _window`, `report_blocks.money_block` over the
 *               project's own profile), so the model into project streams are the report's own
 *               join, priced by the same functions. MEASURED on the live report (2026-09-13):
 *               the two projects' Opus 5 rows sum to the corpus row to the cent.
 *   how it      per project, `usd_without_a_commit` ("ended with no commit") and the rest of its
 *   ended       priced dollars ("ended with a commit"). The rest is exactly that because every
 *               sitting in a project has a resolved repository, so git counted its commits
 *               (`analysis/corpus.py` hands each to `profile.attribute_commits`); the share the
 *               report sends is checked against it (`counted.ts`), and a project where it does not
 *               hold keeps the rest as "not known".
 *
 * EVERY FIGURE IS ROUNDED WITH THE REST (`round.ts roundFlow`): every stream a floor or a ceiling,
 * every node passing on what it takes in, the total the page's total, so the parts a person reads
 * add up to the whole they read, in every column and every sentence.
 *
 * WHERE THE REPORT HAS NO JOIN, NOTHING IS SPLIT. Three joins are missing and each is a sentence
 * saying what it would need, never an invented split:
 *
 *   - which model used which kind of token: the report adds each kind up across every model, so
 *     the tokens reach the models as one stream, through a line marked "priced" where the widths
 *     stop being tokens and start being dollars (Wise's fee breakdown: the conversion is a step
 *     you can see, with its rate and the day it was read);
 *   - what a stretch that changed nothing would cost: `burn` counts a stretch in TOKENS, and a
 *     token share is not a dollar share (CLAUDE.md: 23% of the output tokens were 1% of the
 *     money). So the grey stream is drawn where tokens are the unit: it leaves the token stream
 *     well after the buckets have merged, and REJOINS it before it is priced, because those tokens
 *     are priced with the rest. A grey stream that left and never came back would say they cost
 *     nothing;
 *   - how a project under the report's floor ended: its `usd_without_a_commit` is null, so its
 *     stream ends dashed at "too few to tell", and the corpus figure is never set beside it:
 *     subtracting one from the other would name what the report withheld.
 *
 * THE HOUSE RULES (CLAUDE.md): absent is not zero (a project with no priced session is left out,
 * never drawn at $0), a refusal is a sentence, no dash in anything a person reads, and the dollar
 * is what the tokens would cost at API list prices, never "you spent".
 */
import { corpusBurnLine } from '../copy/burn';
import { readOn } from '../copy/money';
import { capital, count, human, n, pyFixed, shareWords } from '../copy/numbers';
import type { BuilderProfileResponse } from '../data/api';
import type { ReportBurn, ReportMoney, ReportProject } from '../generated/report';
import { numSpec, type NumSpec } from '../insights/format';
import { NO_REPORT, type Refused } from '../insights/model';
import { GROUND, type Hue } from '../insights/palette';
import { projectLabels, type ProjectRegistry } from '../projects/model';
import { listOf } from '../stack/model';
import { everyPricedSessionCounted } from './counted';
import { apportion, dollarsOf, dollarUnit, roundFlow, shownUnits, type FlowEdge } from './round';

// ------------------------------------------------------------------ what the flow is made of

export type NodeKind = 'bucket' | 'model' | 'project' | 'outcome';
export type OutcomeKey = 'commit' | 'none' | 'unsplit';

/** The columns, left to right. The token column is absent when no session reported buckets. */
export type Column = 0 | 1 | 2 | 3;

export interface FlowNode {
  id: string;
  kind: NodeKind;
  column: Column;
  /** "cache reads", "Opus 5", "Private project 2", "with a commit". */
  label: string;
  /** Tokens for a bucket, dollars at list prices for everything else. */
  value: number;
  /** What the label counts up to: `human` for tokens, `dollars` for dollars. */
  figure: NumSpec;
  /** A dollar figure, masked with the page. */
  dollars: boolean;
  hue: Hue;
  /** Drawn as an outline: dollars whose ending the report does not split. */
  hollow: boolean;
  /** What a tap on it says. */
  sentence: string;
  /** The buckets too small to label alone share one label; the others point at it. */
  labelOf?: string;
}

export interface FlowLink {
  id: string;
  source: string;
  target: string;
  usd: number;
  /** A stream the report does not split: drawn as a dashed outline. */
  hollow: boolean;
  /** The source's hue: the ribbon is its partner, its ink when lit. */
  hue: Hue;
  sentence: string;
}

export interface MoneyFlow {
  band: {
    /** The top project's share of every dollar, when it is a plain figure ("94%"). */
    figure: NumSpec | null;
    /** The same, as words ("over 99%") when it is not. */
    figureText: string;
    caption: string;
    note: string;
  };
  nodes: FlowNode[];
  links: FlowLink[];
  /** The merged token stream and the rule where it is priced. Null with no token column. */
  tokens: { total: number; usd: number; sentence: string } | null;
  /** The stretches that changed nothing, in tokens: the grey stream. Null with no burn floor. */
  grey: { share: number; label: string; figure: string; sentence: string } | null;
  /** What the report cannot join, and what each would need: plain sentences under the flow. */
  notes: string[];
  /** Said under the flow before anything is tapped. */
  summary: string;
  /** The day the prices were read ("Sep 6"), or null for an undated table. */
  readOn: string | null;
}

/** The hues the flow wears, handed in by the screen: the page's bucket colours, the model families' and each project's own. */
export interface FlowPaint {
  bucket(key: string): Hue;
  models(families: readonly string[]): Hue[];
  project(key: string): Hue;
}

/** What the money page already decided about the buckets and the models (`chapters.moneyPage`). */
export interface FlowPageIn {
  buckets: readonly { key: string; label: string; tokens: number }[];
  models: readonly { key: string; name: string; family: string; usd: number }[];
}

/** How many projects get a node of their own; past it the rest share one. */
export const MAX_PROJECTS = 5;
/** A bucket under this share of every token shares one label with the others as small. */
export const LABEL_ALONE_SHARE = 0.03;

const OUTCOME_HUE: Record<OutcomeKey, Hue> = {
  commit: { ink: GROUND.text, partner: GROUND.dim, light: GROUND.text },
  none: { ink: GROUND.dim, partner: GROUND.faint, light: GROUND.dim },
  unsplit: { ink: GROUND.dim, partner: GROUND.faint, light: GROUND.dim },
};

/**
 * Each project's hue inside this one picture. A project keeps the hue it wears on the Projects
 * tab, unless a model in the picture already wears it: then it steps round `order` (the Projects
 * tab's own ring) to the first hue no model and no other project wears. FOUND ON THE SIMULATOR
 * (2026-09-13): the oldest project is tide and so is Fable 5, and Fable's stream into it read as
 * running on into the commit block. The models keep theirs because the ring above them on the
 * same page names them by colour.
 */
export function projectHuesApart<K extends string, H extends string>(own: Readonly<Record<K, H>>, order: readonly H[], models: readonly H[]): Record<K, H> {
  const out = { ...own } as Record<K, H>;
  const worn = (h: H, except: K) => models.includes(h) || (Object.keys(out) as K[]).some((k) => k !== except && out[k] === h);
  for (const key of Object.keys(out) as K[]) {
    const want = out[key];
    if (!models.includes(want)) continue;
    const at = Math.max(0, order.indexOf(want));
    for (let i = 1; i <= order.length; i++) {
      const h = order[(at + i) % order.length]!;
      if (!worn(h, key)) {
        out[key] = h;
        break;
      }
    }
  }
  return out;
}

/**
 * Under the column's word "ended": "with a commit", "no commit", and for dollars whose ending the
 * report does not give, "too few to tell" (a project under its floor) or "not known" (anything
 * else); those two are chosen where the node is built.
 */
const OUTCOME_LABEL: Record<Exclude<OutcomeKey, 'unsplit'>, string> = {
  commit: 'with a commit',
  none: 'no commit',
};

const OUTCOMES: readonly OutcomeKey[] = ['commit', 'none', 'unsplit'];

const NO_COMMIT_KIND = 'A session that ends without a commit can still be the one that found the bug.';

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** A project's priced dollars, by how its sessions ended, or null when the report does not split them. */
interface Ending {
  commit: number;
  none: number;
  unsplit: number;
}

/**
 * How one project's dollars ended, from its own money block. `usd_without_a_commit` is null
 * under the report's floor: the whole of it is not split. The rest is "with a commit" only when
 * every priced session had a git commit count (`counted.everyPricedSessionCounted`): the rest is
 * then exactly the sessions that ended with one. That holds today because every sitting in a
 * project has a resolved repository and `analysis/corpus.py` hands each to
 * `profile.attribute_commits`, which stamps it with a git commit count.
 */
export function endingOf(m: Pick<ReportMoney, 'usd' | 'usd_without_a_commit' | 'share_without_a_commit'>): Ending {
  const usd = isNum(m.usd) ? Math.max(0, m.usd) : 0;
  const none = m.usd_without_a_commit;
  if (!isNum(none)) return { commit: 0, none: 0, unsplit: usd };
  const quiet = Math.min(usd, Math.max(0, none));
  return everyPricedSessionCounted(m) ? { commit: Math.max(0, usd - quiet), none: quiet, unsplit: 0 } : { commit: 0, none: quiet, unsplit: Math.max(0, usd - quiet) };
}

interface ProjectIn {
  id: string;
  label: string;
  hue: Hue;
  usd: number;
  priced: number;
  byModel: Map<string, number>;
  ending: Ending;
  /** Several projects folded into one node. */
  members: number;
}

function projectIn(p: ReportProject, label: string, hue: Hue): ProjectIn | null {
  const m = p.window?.money;
  if (!m || !isNum(m.usd) || m.usd <= 0) return null;
  const byModel = new Map<string, number>();
  for (const r of m.by_model ?? []) if (isNum(r.usd) && r.usd > 0) byModel.set(r.model, (byModel.get(r.model) ?? 0) + r.usd);
  return { id: `project:${p.key}`, label, hue, usd: m.usd, priced: m.priced_sessions, byModel, ending: endingOf(m), members: 1 };
}

function fold(rest: readonly ProjectIn[], hue: Hue): ProjectIn {
  const byModel = new Map<string, number>();
  for (const p of rest) for (const [k, v] of p.byModel) byModel.set(k, (byModel.get(k) ?? 0) + v);
  return {
    id: 'project:more',
    label: `${n(rest.length)} more projects`,
    hue,
    usd: rest.reduce((s, p) => s + p.usd, 0),
    priced: rest.reduce((s, p) => s + p.priced, 0),
    byModel,
    ending: {
      commit: rest.reduce((s, p) => s + p.ending.commit, 0),
      none: rest.reduce((s, p) => s + p.ending.none, 0),
      unsplit: rest.reduce((s, p) => s + p.ending.unsplit, 0),
    },
    members: rest.length,
  };
}

/**
 * The flow, or a refusal as a sentence, or null when there is no priced money to follow (the
 * page's first chapter already says why).
 */
export function moneyFlow(
  b: BuilderProfileResponse,
  page: FlowPageIn,
  paint: FlowPaint,
  nicknames?: Readonly<Record<string, string>> | null,
  registry?: ProjectRegistry | null,
): MoneyFlow | Refused | null {
  const report = b.report ?? null;
  if (!report) return b.corpus ? { refusal: NO_REPORT } : null;
  const money = report.money ?? null;
  if (!money || money.reason != null || !isNum(money.usd)) return null;
  const block = report.projects ?? null;
  if (!block) return { refusal: 'Your Mac sent a report without its projects, so the dollars cannot be followed into one. A newer Mac sends them.' };

  const models = page.models.filter((x) => x.usd > 0);
  if (!models.length) return { refusal: 'The report has no dollars by model, so there is nothing to follow.' };
  const modelHues = paint.models(models.map((x) => x.family));
  const modelHue = new Map(models.map((x, i) => [x.key, modelHues[i]!]));
  const modelName = new Map(models.map((x) => [x.key, x.name]));

  // Every project's name as the Projects tab says it: its public name, the owner's own, or
  // "Private project" and the number this phone gave it, never a character of its key.
  const labels = projectLabels(block, b.project_names, nicknames, registry);
  const priced = block.projects
    .map((p) => projectIn(p, labels[p.key]!.text, paint.project(p.key)))
    .filter((p): p is ProjectIn => p !== null)
    .sort((x, y) => y.usd - x.usd);
  if (!priced.length) return { refusal: 'No project had a priced session in the window, so there is no project to follow the dollars into.' };

  const shown = priced.length > MAX_PROJECTS ? [...priced.slice(0, MAX_PROJECTS - 1), fold(priced.slice(MAX_PROJECTS - 1), { ink: GROUND.dim, partner: GROUND.faint, light: GROUND.dim })] : priced;

  // What no listed project holds, model by model: the sessions in no project, and any project
  // past the report's list. A difference of the report's own rounded numbers, so a few cents of
  // rounding are not a stream.
  const tolerance = 0.01 * (priced.length + 1);
  const elsewhere = new Map<string, number>();
  for (const mo of models) {
    const inProjects = priced.reduce((s, p) => s + (p.byModel.get(mo.key) ?? 0), 0);
    const left = mo.usd - inProjects;
    if (left > tolerance) elsewhere.set(mo.key, left);
  }
  const elsewhereUsd = [...elsewhere.values()].reduce((s, v) => s + v, 0);
  // Why dollars are in no listed project, from what the report says: sessions whose folder was no
  // git repository (`unresolved`), projects past the list it caps (`projects_total`), both, or
  // neither, when the report does not say.
  const unresolved = block.unresolved?.sessions ?? 0;
  const cut = Math.max(0, block.projects_total - block.projects.length);
  const projects: ProjectIn[] = [...shown];
  if (elsewhereUsd > tolerance) {
    const label = unresolved > 0 && cut > 0 ? 'no project, or unlisted' : unresolved > 0 ? 'in no project' : cut > 0 ? `${n(cut)} unlisted ${cut === 1 ? 'project' : 'projects'}` : 'not in a project';
    projects.push({
      id: 'project:elsewhere',
      label,
      hue: { ink: GROUND.dim, partner: GROUND.faint, light: GROUND.dim },
      usd: elsewhereUsd,
      priced: 0,
      byModel: elsewhere,
      ending: { commit: 0, none: 0, unsplit: elsewhereUsd },
      members: 0,
    });
  }

  const total = money.usd;
  const day = readOn(money.prices_read_on);
  const nodes: FlowNode[] = [];
  const links: FlowLink[] = [];

  // ---- the flow in dollars, before a word of it is written
  //
  // Each project passes on exactly what its model streams bring in. Its own rows add up to its own
  // total to within a cent or two of rounding, and that cent goes to the part the report derives
  // as the rest (the commits, or what it does not split), never to the no commit dollars it sends.
  const inflowOf = (p: ProjectIn) => [...p.byModel.values()].reduce((s, v) => s + v, 0);
  for (const p of projects) {
    const e = p.ending;
    const drift = inflowOf(p) - (e.commit + e.none + e.unsplit);
    if (e.commit > 0) e.commit = Math.max(0, e.commit + drift);
    else if (e.unsplit > 0) e.unsplit = Math.max(0, e.unsplit + drift);
    else e.none = Math.max(0, e.none + drift);
  }
  const modelFlow = new Map(models.map((mo) => [mo.key, projects.reduce((s, p) => s + (p.byModel.get(mo.key) ?? 0), 0)]));
  const flowing = models.filter((mo) => (modelFlow.get(mo.key) ?? 0) > 0);
  const ended: Record<OutcomeKey, number> = { commit: 0, none: 0, unsplit: 0 };
  for (const p of projects) for (const k of OUTCOMES) ended[k] += p.ending[k];

  // ---- every figure rounded at once, so the parts a person reads add up to the whole they read
  const unit = dollarUnit(total);
  const edges: FlowEdge[] = [];
  for (const mo of flowing) edges.push({ id: `in>model:${mo.key}`, from: 'in', to: `model:${mo.key}`, value: modelFlow.get(mo.key)! / unit });
  for (const p of projects) {
    for (const mo of flowing) {
      const usd = p.byModel.get(mo.key) ?? 0;
      if (usd > 0) edges.push({ id: `model:${mo.key}>${p.id}`, from: `model:${mo.key}`, to: p.id, value: usd / unit });
    }
    for (const k of OUTCOMES) if (p.ending[k] > 0) edges.push({ id: `${p.id}>outcome:${k}`, from: p.id, to: `outcome:${k}`, value: p.ending[k] / unit });
  }
  for (const k of OUTCOMES) if (ended[k] > 0) edges.push({ id: `outcome:${k}>out`, from: `outcome:${k}`, to: 'out', value: ended[k] / unit });
  const flowTotal = [...modelFlow.values()].reduce((s, v) => s + v, 0);
  let target = shownUnits(total, unit);
  if (Math.abs(target - flowTotal / unit) >= 1) target = Math.round(flowTotal / unit);
  // The models, the column a person sets beside the total and the ring above, by the largest
  // remainder method; everything after them rounded around that. Should the pins leave the rest no
  // way to balance, the whole flow is rounded freely (still every sum exact), then naively.
  const pins = new Map(apportion(flowing.map((mo) => modelFlow.get(mo.key)! / unit), target).map((u, i) => [`in>model:${flowing[i]!.key}`, u]));
  const rounded = roundFlow(edges, 'in', 'out', target, pins) ?? roundFlow(edges, 'in', 'out', target) ?? new Map(edges.map((e) => [e.id, Math.round(e.value)]));
  const unitsOf = (id: string) => rounded.get(id) ?? 0;
  const shownOf = (id: string, real: number) => dollarsOf(unitsOf(id), unit, real);
  const figureOf = (units: number, real: number) => {
    const text = dollarsOf(units, unit, real);
    return numSpec(units * unit, text);
  };
  const totalText = dollarsOf(target, unit, total);
  const projectUnits = (p: ProjectIn) => flowing.reduce((s, mo) => s + unitsOf(`model:${mo.key}>${p.id}`), 0);

  // ---- 0: the token buckets, in tokens
  const buckets = page.buckets.filter((x) => x.tokens > 0);
  const tokenTotal = buckets.reduce((s, x) => s + x.tokens, 0);
  let tokens: MoneyFlow['tokens'] = null;
  if (buckets.length && tokenTotal > 0) {
    // The buckets too small to carry a label alone share one, on the first of them.
    const small = buckets.filter((x) => x.tokens / tokenTotal < LABEL_ALONE_SHARE);
    const group = small.length >= 2 ? `bucket:${small[0]!.key}` : null;
    const smallSum = small.reduce((s, y) => s + y.tokens, 0);
    const grouped = (x: (typeof buckets)[number]) => group !== null && small.includes(x);
    // The labelled figures, rounded together to the whole's tenth of a million when every one of
    // them is said in millions, so they add up to the token count the band says.
    const labelled = buckets.filter((x) => !grouped(x) || `bucket:${x.key}` === group);
    const labelTokens = labelled.map((x) => (grouped(x) ? smallSum : x.tokens));
    const inMillions = tokenTotal >= 1_000_000 && labelTokens.every((t) => t >= 1_000_000);
    const tenths = inMillions ? apportion(labelTokens.map((t) => t / 100_000), Math.round(Number(pyFixed(tokenTotal / 1_000_000, 1)) * 10)) : null;
    const tokenText = new Map(labelled.map((x, i) => [x.key, tenths ? `${pyFixed(tenths[i]! / 10, 1, true)}M` : human(labelTokens[i]!)]));
    // A count lands where it rests: on the rounded tenths when they were rounded together.
    const tokenValue = new Map(labelled.map((x, i) => [x.key, tenths ? tenths[i]! * 100_000 : labelTokens[i]!]));
    const sumsNote = 'The report adds up each kind of token across every model, so it cannot say which model used them.';
    for (const x of buckets) {
      const id = `bucket:${x.key}`;
      const inGroup = grouped(x);
      const text = tokenText.get(x.key) ?? human(x.tokens);
      nodes.push({
        id,
        kind: 'bucket',
        column: 0,
        label: inGroup ? listOf(small.map((s) => s.label)) : x.label,
        value: x.tokens,
        figure: numSpec(tokenValue.get(x.key) ?? x.tokens, text, { kind: 'tokens' }),
        dollars: false,
        hue: paint.bucket(x.key),
        hollow: false,
        sentence:
          inGroup && id === group
            ? `${capital(listOf(small.map((s) => `${s.label} ${human(s.tokens)}`)))} tokens: ${shareWords(smallSum / tokenTotal)} of every token together. ${sumsNote}`
            : `${capital(x.label)}: ${inGroup ? human(x.tokens) : text} tokens, ${shareWords(x.tokens / tokenTotal)} of every token. ${sumsNote}`,
        labelOf: inGroup && group !== null && id !== group ? group : undefined,
      });
    }
    tokens = {
      total: tokenTotal,
      usd: total,
      sentence: `Every token, ${human(tokenTotal)}, priced at API list prices${day ? ` read ${day}` : ''}: ${totalText}. On a subscription you pay your plan, not this.`,
    };
  }

  // ---- 1: the models, in dollars
  for (const mo of flowing) {
    const hue = modelHue.get(mo.key)!;
    const own = unitsOf(`in>model:${mo.key}`);
    const into = projects
      .filter((p) => (p.byModel.get(mo.key) ?? 0) > 0)
      .map((p) => `${shownOf(`model:${mo.key}>${p.id}`, p.byModel.get(mo.key)!)} into ${p.label}`);
    nodes.push({
      id: `model:${mo.key}`,
      kind: 'model',
      column: 1,
      label: mo.name,
      value: modelFlow.get(mo.key)!,
      figure: figureOf(own, modelFlow.get(mo.key)!),
      dollars: true,
      hue,
      hollow: false,
      sentence: `${mo.name}: ${dollarsOf(own, unit, modelFlow.get(mo.key)!)} at list prices, ${shareWords(modelFlow.get(mo.key)! / total)} of every dollar.${into.length ? ` ${capital(listOf(into))}.` : ''}`,
    });
  }

  // ---- 2: the projects, and the model into project streams
  for (const p of projects) {
    const inflow = inflowOf(p);
    const own = projectUnits(p);
    const e = p.ending;
    const parts: string[] = [];
    if (e.commit > 0) parts.push(`${shownOf(`${p.id}>outcome:commit`, e.commit)} went to sessions that ended with a commit`);
    if (e.none > 0) parts.push(`${shownOf(`${p.id}>outcome:none`, e.none)} to sessions that ended with no commit`);
    const endedWords = parts.length ? ` ${capital(listOf(parts))}.` : '';
    const unknown = e.unsplit > 0 ? ` ${unsplitWords(p, parts.length ? 'rest' : 'node')}` : '';
    const over = p.members === 1 ? ` over ${count(p.priced, 'priced session')}` : '';
    nodes.push({
      id: p.id,
      kind: 'project',
      column: 2,
      label: p.label,
      value: inflow,
      figure: figureOf(own, inflow),
      dollars: true,
      hue: p.hue,
      hollow: false,
      sentence: `${capital(p.label)}: ${dollarsOf(own, unit, inflow)} at list prices${over}, ${shareWords(inflow / total)} of every dollar.${endedWords}${unknown}`,
    });
    for (const mo of flowing) {
      const usd = p.byModel.get(mo.key) ?? 0;
      if (usd <= 0) continue;
      const name = modelName.get(mo.key)!;
      links.push({
        id: `model:${mo.key}>${p.id}`,
        source: `model:${mo.key}`,
        target: p.id,
        usd,
        hollow: false,
        hue: modelHue.get(mo.key)!,
        sentence: `${name} into ${p.label}: ${shownOf(`model:${mo.key}>${p.id}`, usd)} at list prices, ${shareWords(usd / modelFlow.get(mo.key)!)} of ${name}'s dollars and ${shareWords(usd / inflow)} of the project's.`,
      });
    }
  }

  // ---- 3: how each ended
  const unknownFrom: ProjectIn[] = [];
  const endedFrom: Record<OutcomeKey, string[]> = { commit: [], none: [], unsplit: [] };
  for (const p of projects) {
    for (const k of OUTCOMES) {
      const usd = p.ending[k];
      if (usd <= 0) continue;
      endedFrom[k].push(p.label);
      if (k === 'unsplit') unknownFrom.push(p);
      const said = shownOf(`${p.id}>outcome:${k}`, usd);
      links.push({
        id: `${p.id}>outcome:${k}`,
        source: p.id,
        target: `outcome:${k}`,
        usd,
        hollow: k === 'unsplit',
        hue: p.hue,
        sentence:
          k === 'unsplit'
            ? `${capital(p.label)}: ${said}. ${unsplitWords(p, 'stream')}`
            : `${capital(p.label)}, sessions that ended with ${k === 'commit' ? 'a commit' : 'no commit'}: ${said}, ${shareWords(usd / inflowOf(p))} of its dollars.${k === 'none' ? ` ${NO_COMMIT_KIND}` : ''}`,
      });
    }
  }
  // "too few to tell" only when every stream into it is a project under the report's floor.
  const tooFew = unknownFrom.length > 0 && unknownFrom.every((p) => p.members === 1 && p.ending.none === 0 && p.id !== 'project:elsewhere');
  const inWhich = (from: string[]) => (from.length === 1 ? `in ${from[0]}` : `across ${listOf(from)}`);
  for (const k of OUTCOMES) {
    if (ended[k] <= 0) continue;
    const own = unitsOf(`outcome:${k}>out`);
    const said = dollarsOf(own, unit, ended[k]);
    nodes.push({
      id: `outcome:${k}`,
      kind: 'outcome',
      column: 3,
      label: k === 'unsplit' ? (tooFew ? 'too few to tell' : 'not known') : OUTCOME_LABEL[k as Exclude<OutcomeKey, 'unsplit'>],
      value: ended[k],
      figure: figureOf(own, ended[k]),
      dollars: true,
      hue: OUTCOME_HUE[k],
      hollow: k === 'unsplit',
      sentence:
        k === 'commit'
          ? `${said} went to sessions that ended with a commit, ${inWhich(endedFrom.commit)}.`
          : k === 'none'
            ? `${said} went to sessions that ended with no commit, ${inWhich(endedFrom.none)}. ${NO_COMMIT_KIND}`
            : tooFew
              ? `${said} is ${inWhich(endedFrom.unsplit)}, whose sessions are too few for the report to say how they ended.`
              : `${said} is ${inWhich(endedFrom.unsplit)}, where the report does not say how the sessions ended.`,
    });
  }

  // ---- the grey stream: tokens in stretches that changed nothing
  const grey = tokens ? greyOf(report.burn ?? null) : null;

  // ---- the band: where most of the dollars went, at list prices
  const top = shown[0]!;
  const topShare = inflowOf(top) / total;
  const figureText = shareWords(topShare);
  const only = priced.length === 1 && elsewhereUsd <= tolerance;
  const note = tokens
    ? `From ${human(tokenTotal)} tokens, through ${count(flowing.length, 'model')}, into ${count(priced.length, 'project')}.`
    : `Through ${count(flowing.length, 'model')} into ${count(priced.length, 'project')}.`;

  // ---- what the report cannot join, in words a person would use
  const notes: string[] = [];
  const read = day ? `, read ${day}` : '';
  notes.push(
    tokens
      ? `Before the line marked priced, the streams are tokens; after it, dollars at API list prices${read}. The report adds up each kind of token across every model, so it cannot show which model used which: the tokens reach the models as one stream.`
      : `The streams are dollars at API list prices${read}.`,
  );
  if (grey) notes.push('The grey stream is tokens, not dollars. It rejoins the rest before the line marked priced, because those tokens are priced with everything else; what those stretches would cost alone would need each one split by model and by kind of token.');
  const floorProjects = projects.filter((p) => p.ending.unsplit > 0 && p.members === 1 && p.ending.none === 0 && p.id !== 'project:elsewhere');
  if (floorProjects.length) {
    notes.push(`${floorProjects.map((p) => unsplitWords(p, 'long')).join(' ')} This chart splits only the projects with enough sessions to split; Where it went, further down, counts every priced session together.`);
  }
  if (elsewhereUsd > tolerance) {
    const said = dollarsOf(projectUnits(projects.find((p) => p.id === 'project:elsewhere')!), unit, elsewhereUsd);
    const listed = n(block.projects.length);
    notes.push(
      unresolved > 0 && cut > 0
        ? `${said} is in sessions whose folder was no git repository, and in ${count(cut, 'project')} past the ${listed} the report lists.`
        : unresolved > 0
          ? `${said} is in sessions whose folder was no git repository, so they belong to no project.`
          : cut > 0
            ? `${said} is in ${count(cut, 'project')} past the ${listed} the report lists.`
            : `${said} is in no project the report lists, and the report does not say where.`,
    );
  }

  return {
    band: {
      figure: /^\d/.test(figureText) ? numSpec(Math.round(topShare * 100), figureText) : null,
      figureText,
      caption: only
        ? `of what it would cost at API list prices went into ${top.label}, the only project in the window`
        : `of what it would cost at API list prices went into ${top.label}`,
      note,
    },
    nodes,
    links,
    tokens,
    grey,
    notes,
    summary: `${totalText} at list prices, followed from ${tokens ? 'token' : 'model'} to commit. Tap a stream or a name to read what it carries.`,
    readOn: day,
  };
}


/**
 * Why the report does not say how a project's sessions ended. `node`: after its own sentence has
 * said its sessions; `rest`: after its sentence has said how some of them ended; `stream`: after a
 * sentence that has said its name; `long`: on its own, under the flow.
 */
function unsplitWords(p: ProjectIn, form: 'node' | 'rest' | 'stream' | 'long' = 'long'): string {
  if (p.id === 'project:elsewhere') return 'The report does not say how these sessions ended.';
  if (p.members > 1) return `Some of these ${n(p.members)} projects have too few priced sessions for the report to say how they ended.`;
  if (p.ending.none > 0) return `Not every priced session in ${p.label} had a commit count, so the report does not say how the rest ended.`;
  if (form === 'node' || form === 'rest') return 'Its sessions are too few for the report to say how many ended with a commit.';
  if (form === 'stream') return `Its ${count(p.priced, 'priced session')} are too few for the report to say how many ended with a commit.`;
  return `${capital(p.label)} has ${count(p.priced, 'priced session')}, too few for the report to say how many ended with a commit.`;
}

/**
 * The grey stream, or null when there is no floor to draw. Its words are the burn block's own
 * (`copy/burn.corpusBurnLine`, the port of the Mac's), so "at least" is said by the one rule
 * that decides a share is a floor.
 */
function greyOf(burn: ReportBurn | null): MoneyFlow['grey'] {
  if (!burn || !isNum(burn.barren_tokens) || burn.barren_tokens <= 0) return null;
  const line = corpusBurnLine(burn);
  if (!line || !isNum(burn.share)) return null;
  const share = isNum(burn.tokens) && burn.tokens > 0 ? burn.barren_tokens / burn.tokens : burn.share;
  const floor = /^At least /.test(line);
  return {
    share,
    label: 'changed nothing',
    figure: `${floor ? 'at least ' : ''}${shareWords(share)}`,
    sentence: `${line}, tested or committed: ${human(burn.barren_tokens)} of them. They split off in grey and rejoin the stream before it is priced, because the report counts a stretch in tokens and prices those tokens with everything else.`,
  };
}

// ------------------------------------------------------------------ what is lit when one thing is tapped

/**
 * Everything a tap on `id` lights: a node with every stream in and out of it, a stream with
 * its two ends. The trunk lights the token column and the priced streams out of it.
 */
export function litBy(flow: MoneyFlow, id: string | null): Set<string> | null {
  if (!id) return null;
  const lit = new Set<string>([id]);
  // The grey stream lights alone: lighting the token stream too brightened its grain under the
  // bucket names, which a grey tap dims (found on the simulator, 2026-09-13).
  if (id === 'grey') return lit;
  if (id === 'trunk') {
    for (const nd of flow.nodes) if (nd.column === 0) lit.add(nd.id);
    return lit;
  }
  if (id.startsWith('fan:')) {
    lit.add(id.slice(4));
    lit.add('trunk');
    return lit;
  }
  if (id.startsWith('bucket:')) {
    // A bucket's tokens are in the one stream; the buckets that share its label light with it.
    lit.add('trunk');
    for (const nd of flow.nodes) if (nd.labelOf === id) lit.add(nd.id);
    return lit;
  }
  const link = flow.links.find((l) => l.id === id);
  if (link) {
    lit.add(link.source);
    lit.add(link.target);
    return lit;
  }
  for (const l of flow.links) {
    if (l.source === id || l.target === id) {
      lit.add(l.id);
      lit.add(l.source);
      lit.add(l.target);
    }
  }
  if (id.startsWith('model:')) lit.add(`fan:${id}`);
  return lit;
}

/** What a tap on `id` says. */
/**
 * The Money page's model ring, reading each model exactly as the flow does whenever the flow is
 * drawn: one more view of the same column, so one model never reads two ways on one page.
 */
export function withFlowFigures<T extends { key: string; num: NumSpec }>(models: readonly T[], flow: MoneyFlow | Refused | null): T[] {
  if (!flow || 'refusal' in flow) return [...models];
  const figures = new Map(flow.nodes.filter((x) => x.kind === 'model').map((x) => [x.id, x.figure]));
  return models.map((m) => ({ ...m, num: figures.get(`model:${m.key}`) ?? m.num }));
}

export function sentenceOf(flow: MoneyFlow, id: string | null): string {
  if (!id) return flow.summary;
  if (id === 'trunk') return flow.tokens?.sentence ?? flow.summary;
  if (id === 'grey') return flow.grey?.sentence ?? flow.summary;
  const key = id.startsWith('fan:') ? id.slice(4) : id;
  return flow.nodes.find((x) => x.id === key)?.sentence ?? flow.links.find((l) => l.id === key)?.sentence ?? flow.summary;
}

// ------------------------------------------------------------------ the geometry

/** A ribbon between two vertical edges: from (x0, y0a..y0b) to (x1, y1a..y1b), each edge a smooth S. */
export interface Ribbon {
  x0: number;
  y0a: number;
  y0b: number;
  x1: number;
  y1a: number;
  y1b: number;
}

export interface LaidNode {
  id: string;
  column: Column;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LaidLink {
  id: string;
  ribbon: Ribbon;
}

export interface LaidLabel {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  align: 'left' | 'right';
  /** Where the sweep reaches it, as a fraction of the width (the label arrives then). */
  at: number;
  /**
   * Its figure sits on a stream rather than the ground, so it is set in the ground's white: a
   * hue's ink over its own partner is too faint to read (found on the simulator, 2026-09-13).
   */
  onStream: boolean;
}

export interface SankeyLayout {
  width: number;
  height: number;
  /** Each column's left edge and the word over it. */
  columns: { column: Column; x: number; title: string; align: 'left' | 'right' }[];
  nodes: LaidNode[];
  links: LaidLink[];
  /** The priced streams out of the rule into each model, by model node id. */
  fans: LaidLink[];
  trunk: { x0: number; x1: number; top: number; bottom: number } | null;
  /** The grey stream: three ribbons (down, along, back up) and how thick it is. */
  grey: { parts: Ribbon[]; thick: number; split: number; rejoin: number } | null;
  labels: LaidLabel[];
  /** Hairlines from a label pushed off its node back to it. */
  leaders: { x0: number; y0: number; x1: number; y1: number }[];
}

/** How far past the bucket column the grey stream leaves the token stream, at the least, in points. */
export const GREY_CLEAR = 28;

export const GEOMETRY = {
  /** A node's width, and the token column's. */
  node: 8,
  token: 12,
  /** Between two nodes of one column. */
  gap: 28,
  /** The height the dollars fill, before gaps. */
  flow: 280,
  /** From the rule to the model nodes. */
  fan: 34,
  /** How far below the token stream the grey stream dips. */
  dip: 20,
  /** No mark that carries anything is drawn thinner than this (`Bars.tsx`'s floor). */
  minNode: 2,
  minLink: 1,
  minGrey: 3,
  /** Label type: a name line and the figure under it. */
  nameLine: 15,
  figureLine: 21,
  labelPad: 6,
  labelGap: 4,
} as const;

/** About how wide 12 pt semibold text runs, per character: enough to decide where a name wraps. */
const CHAR_W = 6.6;

function nameLines(text: string, width: number): number {
  const words = text.split(' ');
  let lines = 1;
  let run = 0;
  for (const w of words) {
    const len = w.length * CHAR_W;
    if (run === 0) run = len;
    else if (run + CHAR_W + len <= width) run += CHAR_W + len;
    else {
      lines += 1;
      run = len;
    }
  }
  return lines;
}

/** Where a column sits across the width: the token column, then three dollar columns. */
function columnXs(width: number, hasTokens: boolean): Record<Column, number> {
  const last = width - GEOMETRY.node;
  if (hasTokens) return { 0: 0, 1: Math.round(width * 0.38), 2: Math.round(width * 0.675), 3: last };
  return { 0: 0, 1: 0, 2: Math.round(width * 0.5), 3: last };
}

/** A column's nodes top to bottom with the gap between them, centred on `mid`. */
function stack(heights: readonly number[], mid: number): number[] {
  const total = heights.reduce((s, h) => s + h, 0) + GEOMETRY.gap * Math.max(0, heights.length - 1);
  let y = mid - total / 2;
  return heights.map((h) => {
    const at = y;
    y += h + GEOMETRY.gap;
    return at;
  });
}

/**
 * Push labels in one lane apart so none overlaps another, each as near its wish as it can be,
 * none above `lo` or below `hi`. One dimensional, in reading order.
 */
export function relax(items: { y: number; h: number; lo: number; hi: number }[]): number[] {
  const order = items.map((_, i) => i).sort((a, b) => items[a]!.y - items[b]!.y);
  const ys = items.map((it) => Math.min(Math.max(it.y, it.lo), it.hi));
  const gap = GEOMETRY.labelGap;
  for (let k = 1; k < order.length; k++) {
    const i = order[k]!;
    const p = order[k - 1]!;
    ys[i] = Math.max(ys[i]!, ys[p]! + items[p]!.h + gap);
  }
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k]!;
    const next = order[k + 1];
    let cap = items[i]!.hi;
    if (next !== undefined) cap = Math.min(cap, ys[next]! - items[i]!.h - gap);
    ys[i] = Math.min(ys[i]!, cap);
  }
  for (let k = 0; k < order.length; k++) {
    const i = order[k]!;
    const p = order[k - 1];
    let floor = items[i]!.lo;
    if (p !== undefined) floor = Math.max(floor, ys[p]! + items[p]!.h + gap);
    ys[i] = Math.max(ys[i]!, floor);
  }
  return ys;
}

export function layoutSankey(flow: MoneyFlow, width: number): SankeyLayout {
  const G = GEOMETRY;
  const hasTokens = flow.tokens !== null && flow.nodes.some((x) => x.column === 0);
  const xs = columnXs(width, hasTokens);
  const byId = new Map(flow.nodes.map((x) => [x.id, x]));
  const col = (c: Column) => flow.nodes.filter((x) => x.column === c);
  const models = col(1);
  const dollarsIn = models.reduce((s, x) => s + x.value, 0);
  const k = dollarsIn > 0 ? G.flow / dollarsIn : 0;
  const widthOf = (usd: number) => Math.max(G.minLink, usd * k);

  // Every node is as tall as the streams through it, and never under the floor.
  const outW = new Map<string, number>();
  const inW = new Map<string, number>();
  for (const l of flow.links) {
    const w = widthOf(l.usd);
    outW.set(l.source, (outW.get(l.source) ?? 0) + w);
    inW.set(l.target, (inW.get(l.target) ?? 0) + w);
  }
  const heightOf = (id: string, fallback: number) => Math.max(G.minNode, outW.get(id) ?? 0, inW.get(id) ?? 0, fallback);

  const columnsH: Record<number, number[]> = {};
  for (const c of [1, 2, 3] as const) columnsH[c] = col(c).map((x) => heightOf(x.id, x.value * k));
  const tall = Math.max(...[1, 2, 3].map((c) => columnsH[c]!.reduce((s, h) => s + h, 0) + G.gap * Math.max(0, columnsH[c]!.length - 1)));
  const mid = tall / 2;

  const laid: LaidNode[] = [];
  for (const c of [1, 2, 3] as const) {
    const ys = stack(columnsH[c]!, mid);
    col(c).forEach((x, i) => laid.push({ id: x.id, column: c, x: xs[c], y: ys[i]!, w: G.node, h: columnsH[c]![i]! }));
  }

  // The rule, the trunk and the token column: as tall as the priced streams out of the rule.
  const modelNodes = laid.filter((x) => x.column === 1);
  const trunkH = modelNodes.reduce((s, x) => s + x.h, 0);
  const trunkTop = mid - trunkH / 2;
  let trunk: SankeyLayout['trunk'] = null;
  const fans: LaidLink[] = [];
  let grey: SankeyLayout['grey'] = null;
  if (hasTokens) {
    const seam = xs[1] - G.fan;
    trunk = { x0: G.token, x1: seam, top: trunkTop, bottom: trunkTop + trunkH };
    let at = trunkTop;
    for (const m of modelNodes) {
      fans.push({ id: `fan:${m.id}`, ribbon: { x0: seam, y0a: at, y0b: at + m.h, x1: m.x, y1a: m.y, y1b: m.y + m.h } });
      at += m.h;
    }
    // The buckets: shares of the same height, each at least the floor, the whole kept to it.
    const buckets = col(0);
    const tokenSum = buckets.reduce((s, x) => s + x.value, 0);
    // The floor a small bucket is lifted to is taken back from the big ones, in proportion.
    const raw = buckets.map((x) => (tokenSum > 0 ? (x.value / tokenSum) * trunkH : 0));
    const extra = raw.reduce((s, h) => s + Math.max(0, G.minNode - h), 0);
    const big = raw.reduce((s, h) => s + (h > G.minNode ? h : 0), 0);
    let y = trunkTop;
    buckets.forEach((x, i) => {
      const r = raw[i]!;
      const h = r > G.minNode && big > 0 ? r - (extra * r) / big : G.minNode;
      laid.push({ id: x.id, column: 0, x: 0, y, w: G.token, h });
      y += h;
    });
    if (flow.grey) {
      // It leaves the WHOLE stream, well after the buckets have merged into it, and comes back just
      // short of the line marked priced. FOUND IN REVIEW (2026-09-13): leaving 4 points from the
      // bucket column, it left right under the small buckets (drawn at their 2 point floor, twice
      // their real share), so it read as "those buckets changed nothing". A shallow sag, each bend
      // a third of its length.
      const thick = Math.max(G.minGrey, flow.grey.share * trunkH);
      const split = trunk.x0 + Math.max(GREY_CLEAR, (seam - trunk.x0) * 0.38);
      const rejoin = seam - 6;
      const bend = Math.max(4, (rejoin - split) / 3);
      const b = trunk.bottom;
      grey = {
        thick,
        split,
        rejoin,
        parts: [
          { x0: split, y0a: b - thick, y0b: b, x1: split + bend, y1a: b - thick + G.dip, y1b: b + G.dip },
          { x0: split + bend, y0a: b - thick + G.dip, y0b: b + G.dip, x1: rejoin - bend, y1a: b - thick + G.dip, y1b: b + G.dip },
          { x0: rejoin - bend, y0a: b - thick + G.dip, y0b: b + G.dip, x1: rejoin, y1a: b - thick, y1b: b },
        ],
      };
    }
  }

  // The streams: out of each node in the order of what they reach, into each in the order of what sent them.
  const node = new Map(laid.map((x) => [x.id, x]));
  const order = new Map(laid.map((x) => [x.id, x.y]));
  const outAt = new Map<string, number>();
  const inAt = new Map<string, number>();
  const sorted = [...flow.links].sort((a, b) => (order.get(a.source)! - order.get(b.source)!) || (order.get(a.target)! - order.get(b.target)!));
  const links: LaidLink[] = [];
  for (const l of sorted) {
    const s = node.get(l.source);
    const t = node.get(l.target);
    if (!s || !t) continue;
    const w = widthOf(l.usd);
    const y0 = outAt.get(l.source) ?? s.y;
    outAt.set(l.source, y0 + w);
    links.push({ id: l.id, ribbon: { x0: s.x + s.w, y0a: y0, y0b: y0 + w, x1: t.x, y1a: 0, y1b: 0 } });
  }
  const byTarget = [...links].sort((a, b) => {
    const la = flow.links.find((x) => x.id === a.id)!;
    const lb = flow.links.find((x) => x.id === b.id)!;
    return (order.get(la.target)! - order.get(lb.target)!) || (order.get(la.source)! - order.get(lb.source)!);
  });
  for (const ll of byTarget) {
    const l = flow.links.find((x) => x.id === ll.id)!;
    const t = node.get(l.target)!;
    const w = ll.ribbon.y0b - ll.ribbon.y0a;
    const y1 = inAt.get(l.target) ?? t.y;
    inAt.set(l.target, y1 + w);
    ll.ribbon.y1a = y1;
    ll.ribbon.y1b = y1 + w;
  }

  // The labels: right of a node, the last column's left of it; a lane at a time.
  // The token column's labels stop short of the rule, so no word is crossed by it.
  const lanes: Record<Column, { x: number; w: number; align: 'left' | 'right' }> = {
    0: { x: G.token + G.labelPad, w: (trunk ? trunk.x1 : xs[1]) - G.token - G.labelPad * 2, align: 'left' },
    1: { x: xs[1] + G.node + G.labelPad, w: xs[2] - xs[1] - G.node - G.labelPad * 2, align: 'left' },
    2: { x: xs[2] + G.node + G.labelPad, w: xs[3] - xs[2] - G.node - G.labelPad * 2, align: 'left' },
    3: { x: xs[2] + G.node + G.labelPad, w: xs[3] - xs[2] - G.node - G.labelPad * 2, align: 'right' },
  };
  const floorY = Math.max(tall, trunk ? trunk.bottom + (grey ? G.dip + grey.thick : 0) : 0);
  type Want = { id: string; column: Column; y: number; h: number; w: number; lo: number; hi: number; node: LaidNode | null };
  const wants: Want[] = [];
  for (const x of laid) {
    const nd = byId.get(x.id)!;
    if (nd.labelOf) continue;
    const lane = lanes[x.column];
    const lines = nameLines(nd.label, lane.w);
    const h = lines * G.nameLine + G.figureLine;
    // Labels hang from the top of their node; the last column's sit on its bottom, so the two
    // columns that share a lane start from opposite ends of their tall nodes.
    const y = x.column === 3 ? x.y + x.h - h : x.y;
    // The token column's labels sit on the stream they name, never down over the grey dip.
    const hi = x.column === 0 && trunk ? trunk.bottom - h : Number.POSITIVE_INFINITY;
    wants.push({ id: x.id, column: x.column, y: Math.min(y, hi), h, w: lane.w, lo: 0, hi, node: x });
  }
  if (grey && trunk) {
    const h = G.nameLine + G.figureLine;
    const y = trunk.bottom + G.dip + grey.thick + 4;
    wants.push({ id: 'grey', column: 0, y, h, w: lanes[0].w, lo: y, hi: y, node: null });
  }
  const placed = new Map<string, number>();
  for (const lane of [[0], [1], [2, 3]] as Column[][]) {
    const items = wants.filter((x) => lane.includes(x.column));
    const ys = relax(items.map((x) => ({ y: x.y, h: x.h, lo: x.lo, hi: x.hi })));
    items.forEach((x, i) => placed.set(x.id, ys[i]!));
  }
  // Whether a point is on a stream: the token stream, the grey one, or any ribbon, exactly (no finger's width).
  const onStream = (px: number, py: number): boolean =>
    (trunk !== null && px >= trunk.x0 && px <= trunk.x1 && py >= trunk.top && py <= trunk.bottom) ||
    [...links, ...fans].some((l) => onRibbon(l.ribbon, px, py, 0) !== null) ||
    (grey?.parts.some((p) => onRibbon(p, px, py, 0) !== null) ?? false);
  const labels: LaidLabel[] = [];
  const leaders: SankeyLayout['leaders'] = [];
  for (const wnt of wants) {
    const lane = lanes[wnt.column];
    const y = placed.get(wnt.id)!;
    // The grey stream's words sit under it and may run on to just short of the models.
    const x = wnt.id === 'grey' && grey ? Math.max(lane.x, grey.split) : lane.x;
    const w = wnt.id === 'grey' ? xs[1] - x - G.labelPad : lane.w;
    // Sampled where the figure's first digits are, and in the middle of the name's first line.
    const fx = lane.align === 'left' ? x + 14 : x + w - 14;
    const stream = onStream(fx, y + wnt.h - G.figureLine / 2) || onStream(fx, y + G.nameLine / 2);
    labels.push({ id: wnt.id, x, y, w, h: wnt.h, align: lane.align, at: (wnt.column === 3 ? xs[3] : x) / width, onStream: stream });
    const nd = wnt.node;
    if (nd) {
      // A label pushed clear of its node gets a hairline back to it, from its first line.
      const off = y > nd.y + nd.h + 2 || y + wnt.h < nd.y - 2;
      if (off) {
        const ly = y + G.nameLine / 2 + 1;
        const ny = Math.min(Math.max(ly, nd.y), nd.y + nd.h);
        if (lane.align === 'left') leaders.push({ x0: nd.x + nd.w + 1, y0: ny, x1: lane.x - 2, y1: ly });
        else leaders.push({ x0: nd.x - 1, y0: ny, x1: lane.x + lane.w + 2, y1: ly });
      }
    }
  }
  const height = Math.ceil(Math.max(floorY, ...labels.map((l) => l.y + l.h)) + 6);

  const titles: Record<Column, string> = { 0: 'tokens', 1: 'models', 2: 'projects', 3: 'ended' };
  const present = ([0, 1, 2, 3] as Column[]).filter((c) => (c === 0 ? hasTokens : col(c).length > 0));
  return {
    width,
    height,
    columns: present.map((c) => ({ column: c, x: xs[c] + (c === 3 ? G.node : 0), title: titles[c], align: c === 3 ? 'right' : 'left' })),
    nodes: laid,
    links,
    fans,
    trunk,
    grey,
    labels,
    leaders,
  };
}

// ------------------------------------------------------------------ the curves, and what a tap lands on

/** The ribbon's edge at `t`: its S, an ease in and out from one end's height to the other's. */
export function edgeY(ya: number, yb: number, t: number): number {
  return ya + (yb - ya) * (3 * t * t - 2 * t * t * t);
}

/**
 * Where along a ribbon `x` falls, 0 to 1. The edges are cubics with both handles at the middle
 * of the span, so x(t) = x0 + (x1 - x0) * (1.5 t (1 - t) + t^3) rises the whole way; bisected.
 */
export function ribbonT(r: Pick<Ribbon, 'x0' | 'x1'>, x: number): number {
  const span = r.x1 - r.x0;
  if (span <= 0) return 0;
  const want = (x - r.x0) / span;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const t = (lo + hi) / 2;
    const at = 1.5 * t * (1 - t) + t * t * t;
    if (at < want) lo = t;
    else hi = t;
  }
  return (lo + hi) / 2;
}

/** How thick a finger is, in points: a thin stream is found by a tap this near it. */
const TOUCH = 14;

/**
 * Whether (x, y) is on a ribbon, a thin one widened to `finger` points. Returns its thickness
 * there, or null.
 */
export function onRibbon(r: Ribbon, x: number, y: number, finger: number = TOUCH): number | null {
  if (x < r.x0 || x > r.x1) return null;
  const t = ribbonT(r, x);
  const top = edgeY(r.y0a, r.y1a, t);
  const bottom = edgeY(r.y0b, r.y1b, t);
  const thick = bottom - top;
  const pad = Math.max(0, (finger - thick) / 2);
  return y >= top - pad && y <= bottom + pad ? thick : null;
}

/** The node, stream, label or grey stream a tap at (x, y) lands on, or null for empty ground. */
export function hitTest(layout: SankeyLayout, x: number, y: number): string | null {
  for (const l of layout.labels) {
    if (x >= l.x && x <= l.x + l.w && y >= l.y && y <= l.y + l.h) return l.id;
  }
  for (const nd of layout.nodes) {
    const pad = Math.max(0, (TOUCH - nd.h) / 2);
    if (x >= nd.x - 6 && x <= nd.x + nd.w + 6 && y >= nd.y - pad && y <= nd.y + nd.h + pad) return nd.id;
  }
  let best: { id: string; thick: number } | null = null;
  const consider = (id: string, r: Ribbon) => {
    const thick = onRibbon(r, x, y);
    if (thick !== null && (!best || thick < best.thick)) best = { id, thick };
  };
  if (layout.grey) for (const p of layout.grey.parts) consider('grey', p);
  for (const l of layout.links) consider(l.id, l.ribbon);
  for (const f of layout.fans) consider(f.id, f.ribbon);
  if (best) return (best as { id: string }).id;
  const tr = layout.trunk;
  if (tr && x >= tr.x0 && x <= tr.x1 && y >= tr.top && y <= tr.bottom) return 'trunk';
  return null;
}
