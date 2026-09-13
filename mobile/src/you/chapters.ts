/**
 * The You tab and its four pages as chapters: what each band says, the one number it counts up
 * to, what the ground under it draws, and every refusal as a sentence. Pure, so
 * `__tests__/youChapters.test.ts` holds every rule below without a renderer.
 *
 * NOTHING HERE IS COMPUTED A SECOND WAY. Each page is composed from the loaders that already
 * decide what it says: `money.ts` (the dollar, its label and its lines, from the Mac or the
 * server), `glossary.ts`, `stack.ts`, `dimensions.ts`, `archetype.ts`, and the analysis page's
 * `model.ts` (the hero, the money body, the burn), so the You tab, its pages and the analysis
 * page cannot say one number two ways. Every animated number is a `NumSpec` whose last frame is
 * the copy helper's string (`insights/format.ts`).
 *
 * THE HOUSE RULES (CLAUDE.md, design-refs/HOUSE-STYLE.md): absent is not zero, a refusal is a
 * sentence, no dashes in anything a person reads, and the dollar is what the tokens would cost
 * at API list prices, never "you spent".
 */
import { dollars, unpricedNote, withoutACommit } from '../copy/money';
import { capital, count, n, shareWords } from '../copy/numbers';
import { renderCard } from '../copy/wrapped';
import type { BuilderProfileResponse, Profile } from '../data/api';
import type { ReportMoney } from '../generated/report';
import { numSpec, type NumSpec } from '../insights/format';
import {
  burnOf,
  heroOf,
  isRefused,
  moneyOf,
  NO_REPORT,
  sentence,
  shippingOf,
  type HeroModel,
  type MoneyModel,
  type Refused,
} from '../insights/model';
import { DIMENSION_HUE, type HueName } from '../insights/palette';
import { HARNESS_MARKS, isHarness, type HarnessMark } from '../pixel/harness';
import { archetypeView, sourceLine, type ArchetypeView } from './archetype';
import { dimensionsBasis, dimensionsPending, dimensionViews, modalArchetypeLine, topDimension } from './dimensions';
import { glossaryView, type GlossaryMonth } from './glossary';
import { corpusBurn, corpusMoney, moneyView } from './money';
import { stackView } from './stack';

export type { Refused } from '../insights/model';
export { isRefused } from '../insights/model';

/** The command that sends the report most of these pages rest on. */
export const REPORT_COMMAND = 'python -m capture report';
/** The command that analyses sessions, the input the five dimensions are averaged from. */
export const ANALYSE_COMMAND = 'python -m capture sync --analyze';

/** A figure that counts up to a copy helper's string: the number that string writes, in its shape. */
function spec(final: string): NumSpec {
  return numSpec(Number.NaN, final);
}

/** "$2,952" as its digits, "2,952", so the dollar sign can be set smaller beside them (Cash App). */
export function dollarDigits(usd: number): NumSpec {
  return spec(dollars(usd).replace(/^\$/, ''));
}

/** The report's money block, or the server's spend mapped into its shape. */
function moneyBlock(b: BuilderProfileResponse): ReportMoney | null {
  return b.report?.money ?? (b.corpus ? corpusMoney(b.corpus) : null);
}

// ------------------------------------------------------------------ money

export interface MoneyLedgerRow {
  key: string;
  num: NumSpec;
  label: string;
  note?: string | null;
  /** Which ink the figure wears: the chapter's, or the add green and the del red. */
  tone: 'hue' | 'add' | 'del';
  /** A dollar figure: masked with the rest of the page. */
  dollars: boolean;
}

export interface MoneyModelRow {
  key: string;
  name: string;
  family: string;
  usd: number;
  num: NumSpec;
  share: number;
  shareText: string;
  /** The share as a figure to count, or null when it is said in words ("under 1%"). */
  shareNum: NumSpec | null;
  meta: string;
}

export interface MoneyPage {
  /** "The last 30 days, as your Mac priced them: 157 sessions." */
  scope: string | null;
  hero:
    | {
        usd: NumSpec;
        digits: NumSpec;
        /** "Prices read Sep 6." */
        read: string;
      }
    | Refused;
  /** Tokens and the dollars an active hour. */
  bought: MoneyLedgerRow[];
  buckets: NonNullable<Extract<MoneyModel['body'], { usd: NumSpec }>['tokens']>['buckets'];
  lines: { rows: MoneyLedgerRow[]; addedShare: number | null; caption: string | null } | Refused;
  models: MoneyModelRow[];
  modelsNote: string | null;
  without: { usd: NumSpec; digits: NumSpec; rest: string; share: number | null } | Refused | null;
  burn: MoneyModel['burn'];
  unpriced: string | null;
}

const PER_COMMIT_NOTE =
  "Dollars a commit are counted over the sessions a model wrote most of: a session's commits belong to the session, not to a model.";

export function moneyPage(b: BuilderProfileResponse, now: number = Date.now()): MoneyPage | null {
  const view = moneyView(b.corpus, b.report, now);
  if (!view) return null;
  const m = moneyBlock(b);
  const model = moneyOf(b, now);
  const body = isRefused(model.body) ? null : model.body;

  const hero: MoneyPage['hero'] =
    view.usd === null
      ? { refusal: view.refusal ?? 'There is no price to show yet.' }
      : {
          usd: numSpec(view.usd, dollars(view.usd)),
          digits: dollarDigits(view.usd),
          read: view.read
            ? view.stale
              ? `Prices read ${view.read}, and they may have moved since.`
              : `Prices read ${view.read}.`
            : 'At the list prices this build carries.',
        };

  const priced = m && view.usd !== null ? m.priced_sessions : 0;
  const scope =
    priced > 0
      ? b.report?.money
        ? `The last ${count(b.report.window_days, 'day')}, as your Mac priced them: ${count(priced, 'session')}.`
        : `The last ${count(b.window_days, 'day')} on the server: ${count(priced, 'session')} priced.`
      : null;

  const bought: MoneyLedgerRow[] = [];
  if (body?.tokens) bought.push({ key: 'tokens', num: body.tokens.total, label: body.tokens.label, tone: 'hue', dollars: false });
  else if (view.tokens) bought.push({ key: 'tokens', num: spec(view.tokens.value), label: view.tokens.label, tone: 'hue', dollars: false });
  if (body?.perHour) bought.push({ key: 'hour', num: body.perHour, label: 'an active hour, at the same prices', tone: 'hue', dollars: true });

  let lines: MoneyPage['lines'];
  if (view.linesRefusal) lines = { refusal: view.linesRefusal };
  else {
    const rows: MoneyLedgerRow[] = [];
    const added = view.added ? spec(view.added) : null;
    const removed = view.removed ? spec(view.removed) : null;
    if (added) rows.push({ key: 'added', num: added, label: 'lines added', tone: 'add', dollars: false });
    if (removed) rows.push({ key: 'removed', num: removed, label: 'lines removed', tone: 'del', dollars: false });
    const a = added?.value ?? 0;
    const r = removed?.value ?? 0;
    const diff = shippingOf(b).diff;
    const caption = view.linesNote ?? (isRefused(diff) ? null : [diff.basis, diff.note].filter(Boolean).join(' '));
    lines = { rows, addedShare: added && a + r > 0 ? a / (a + r) : null, caption: caption || null };
  }

  const priceTotal = (body?.models ?? []).reduce((s, x) => s + Math.max(0, x.usd), 0);
  const models: MoneyModelRow[] = (body?.models ?? []).map((x) => {
    const share = priceTotal > 0 ? x.usd / priceTotal : 0;
    const shareText = shareWords(share);
    return {
      key: x.key,
      name: x.name,
      family: x.family,
      usd: x.usd,
      num: numSpec(x.usd, x.text),
      share,
      shareText,
      shareNum: /^\d/.test(shareText) ? spec(shareText) : null,
      meta: x.meta,
    };
  });
  models.sort((x, y) => y.usd - x.usd);

  let without: MoneyPage['without'] = null;
  if (view.usd !== null && m) {
    const said = withoutACommit(m);
    const usd = m.usd_without_a_commit;
    if (said && typeof usd === 'number') {
      const figure = dollars(usd);
      without = { usd: numSpec(usd, figure), digits: dollarDigits(usd), rest: said.slice(figure.length).trim(), share: m.share_without_a_commit ?? null };
    } else {
      without = { refusal: view.sentences[0] ?? 'Too few priced sessions have a commit count yet to say what went to sessions without one.' };
    }
  }

  let burn: MoneyModel['burn'] = model.burn;
  if (!b.report && b.corpus) {
    const metric = b.corpus.metrics?.barren_token_share;
    burn = burnOf(corpusBurn(metric));
    if (!burn && typeof metric?.reason === 'string' && metric.reason.trim()) burn = { refusal: sentence(metric.reason) };
  }

  return {
    scope,
    hero,
    bought,
    buckets: body?.tokens?.buckets ?? [],
    lines,
    models,
    modelsNote: view.models.some((x) => x.perCommit !== null) ? PER_COMMIT_NOTE : null,
    without,
    burn,
    unpriced: m ? unpricedNote(m) : null,
  };
}

// ------------------------------------------------------------------ the You tab

export type DoorKey = 'analysis' | 'wrapped' | 'money' | 'dimensions' | 'glossary' | 'stack';

export interface Door {
  key: DoorKey;
  title: string;
  href: '/analysis' | '/wrapped' | '/you/money' | '/you/dimensions' | '/you/glossary' | '/you/stack';
  /** The one real number on the door, or null when the page has none yet. */
  num: NumSpec | null;
  /** A dollar figure: its digits, drawn beside a smaller dollar sign, and masked with the page. */
  digits: NumSpec | null;
  /** What the number counts, said right after it. */
  caption: string | null;
  note: string | null;
  /** Why there is no number, as a sentence. */
  refusal: string | null;
}

/**
 * Each door's hue. Neighbours are never one family, and no door wears the hero's hue: the hero
 * band is the builder's creature, and a door in the same colour would read as part of it.
 * Amber is left out: it is Bit's hue, not the app's.
 */
export const DOOR_HUE: Record<DoorKey, HueName> = {
  analysis: 'cobalt',
  wrapped: 'brass',
  money: 'ember',
  dimensions: 'heather',
  glossary: 'orchid',
  stack: 'tide',
};

export const DOOR_ORDER: readonly DoorKey[] = ['analysis', 'wrapped', 'money', 'dimensions', 'glossary', 'stack'];

const SPARE_HUES: readonly HueName[] = ['iris', 'coral', 'tide', 'heather', 'orchid', 'cobalt', 'brass', 'ember'];

export function doorHues(hero: HueName): Record<DoorKey, HueName> {
  const out = { ...DOOR_HUE };
  const used = new Set<HueName>([hero, ...Object.values(out)]);
  for (const k of DOOR_ORDER) {
    if (out[k] !== hero) continue;
    const spare = SPARE_HUES.find((h) => !used.has(h));
    if (spare) {
      out[k] = spare;
      used.add(spare);
    }
  }
  return out;
}

export interface DimensionPreview {
  key: string;
  value: number;
  hue: HueName;
}

export interface YouTab {
  hero: HeroModel;
  /** Where the type was scored, and what the hours rest on. */
  source: string | null;
  doors: Door[];
  /** The five bars under the Dimensions door, when there are five to draw. */
  dimensions: DimensionPreview[];
  /** The collection under the Glossary door. */
  collection: { found: number; catalog: number } | null;
  /** The stack's categories under its door, each in the hue its chapter wears on the page. */
  categories: { key: string; label: string; hue: HueName }[];
  /** Whether there is anything at all to show: no sessions is an empty page, not a page of zeros. */
  empty: boolean;
}

function door(key: DoorKey, title: string, href: Door['href'], parts: Partial<Omit<Door, 'key' | 'title' | 'href'>>): Door {
  return { key, title, href, num: null, digits: null, caption: null, note: null, refusal: null, ...parts };
}

/** What the analysis page is made of, in the order it tells it. */
const ANALYSIS_CONTENTS = 'Time, shipping, you and your agent, helper agents, money, you against you, quality, what stands out, and the words.';

export function youTab(b: BuilderProfileResponse, profile: Profile | null, now: number = Date.now()): YouTab {
  const report = b.report ?? null;
  const hero = heroOf(b, profile);
  const view: ArchetypeView | null = archetypeView(b.corpus, report);
  const doors: Door[] = [];

  // Your analysis: the days it reads.
  const cov = report?.coverage ?? null;
  if (cov) {
    doors.push(
      door('analysis', 'Your analysis', '/analysis', {
        num: spec(n(cov.active_days)),
        caption: `${cov.active_days === 1 ? 'day' : 'days'} with a session, of the last ${n(cov.window_days)}`,
        note: ANALYSIS_CONTENTS,
      }),
    );
  } else if (b.corpus && b.corpus.sample.sessions > 0) {
    doors.push(
      door('analysis', 'Your analysis', '/analysis', {
        num: spec(n(b.corpus.sample.days)),
        caption: `${b.corpus.sample.days === 1 ? 'day' : 'days'} on the server, of the last ${n(b.window_days)}`,
        note: 'Most of it arrives with the report from your Mac.',
      }),
    );
  } else {
    doors.push(door('analysis', 'Your analysis', '/analysis', { refusal: 'Nothing has been uploaded to read yet.' }));
  }

  // Wrapped: the questions answered, and the first one asked.
  const cards = report?.wrapped?.cards ?? [];
  if (cards.length) {
    const answered = cards.filter((c) => !c.reason).length;
    const first = cards.find((c) => c.id === 'builder_type');
    const r = first ? renderCard(first) : null;
    doors.push(
      door('wrapped', 'Wrapped', '/wrapped', {
        num: spec(n(answered)),
        caption: `of ${count(cards.length, 'question')} answered`,
        note: r && r.display ? `${r.question} ${r.display}.` : null,
      }),
    );
  } else {
    doors.push(door('wrapped', 'Wrapped', '/wrapped', { refusal: 'The fifteen questions arrive with the report from your Mac.' }));
  }

  // Money: the dollar, with what it is.
  const mv = moneyView(b.corpus, report, now);
  if (mv && mv.usd !== null) {
    doors.push(
      door('money', 'Money', '/you/money', {
        num: numSpec(mv.usd, dollars(mv.usd)),
        digits: dollarDigits(mv.usd),
        caption: 'what the tokens would cost at API list prices',
        note: 'On a subscription you pay your plan, not this.',
      }),
    );
  } else {
    doors.push(door('money', 'Money', '/you/money', { refusal: mv?.refusal ?? 'Your Mac prices the work and sends it with its report.' }));
  }

  // Dimensions: the highest of the five, or how many analysed sessions there are against the floor.
  const bp = b.builder_profile ?? null;
  const dims = dimensionViews(bp);
  const top = topDimension(dims);
  if (bp && top) {
    doors.push(
      door('dimensions', 'Dimensions', '/you/dimensions', {
        num: spec(String(top.mean)),
        caption: `${top.label}, the highest of ${n(dims.length)}, out of 100`,
        note: dimensionsBasis(bp),
      }),
    );
  } else {
    doors.push(
      door('dimensions', 'Dimensions', '/you/dimensions', {
        refusal: `Each session is scored on five axes once your Mac analyses it. ${dimensionsPending(b.sessions_analysed, b.min_sessions)}`,
      }),
    );
  }

  // Glossary: terms found, of the catalog.
  const gv = report ? glossaryView(report.vocab, now) : null;
  let collection: YouTab['collection'] = null;
  if (gv && !gv.refusal) {
    const catalog = report?.vocab?.catalog_size ?? gv.found;
    collection = { found: gv.found, catalog };
    doors.push(door('glossary', 'Glossary', '/you/glossary', { num: spec(n(gv.found)), caption: `of ${n(catalog)} terms found`, note: gv.locked }));
  } else {
    doors.push(door('glossary', 'Glossary', '/you/glossary', { refusal: gv?.refusal ?? 'Terms arrive with the report from your Mac.' }));
  }

  // Stack: the things the work is made of, and the most used of them by name.
  const sv = report ? stackView(report.stack, now) : null;
  if (sv && !sv.refusal && sv.total > 0) {
    const names = sv.groups
      .flatMap((g) => g.items)
      .filter((i) => i.sessions > 0)
      .sort((x, y) => y.sessions - x.sessions)
      .map((i) => i.name);
    const shown = names.slice(0, 4);
    const rest = sv.total - shown.length;
    doors.push(
      door('stack', 'Your stack', '/you/stack', {
        num: spec(n(sv.total)),
        caption: `things across ${count(sv.groups.length, 'category', 'categories')}`,
        note: shown.length ? `${shown.join(', ')}${rest > 0 ? `, and ${n(rest)} more` : ''}.` : null,
      }),
    );
  } else {
    doors.push(door('stack', 'Your stack', '/you/stack', { refusal: sv?.refusal ?? 'The stack arrives with the report from your Mac.' }));
  }

  const sessions = b.corpus?.sample.sessions ?? 0;
  const empty = sessions === 0 && (profile?.totals.sessions ?? 0) === 0 && !report;
  const source = view ? [view.state === 'refused' ? null : sourceLine(view), hero.ledgerNote].filter(Boolean).join(' ') || null : null;

  const stack = report ? stackPage(b, now).body : null;
  return {
    hero,
    source,
    doors,
    dimensions: dims.map((d) => ({ key: d.dimension, value: d.mean, hue: DIMENSION_HUE[d.dimension] })),
    collection,
    categories: stack && !isRefused(stack) ? stack.groups.map((g) => ({ key: g.key, label: g.label, hue: g.hue })) : [],
    empty,
  };
}

// ------------------------------------------------------------------ dimensions

export interface DimensionBar {
  key: string;
  label: string;
  mean: NumSpec;
  value: number;
  hue: HueName;
  trend: string;
  sessions: number;
}

export interface DimensionsPage {
  body:
    | { top: DimensionBar; rows: DimensionBar[]; basis: string; archetypeLine: string | null }
    | (Refused & { analysed: number; needed: number });
  hero: HeroModel;
  /** Rules the server could not score, with the reason when it sent one. */
  unscored: { key: string; name: string; reason: string }[];
}

export function dimensionsPage(b: BuilderProfileResponse): DimensionsPage {
  const bp = b.builder_profile ?? null;
  const views = dimensionViews(bp);
  const rows: DimensionBar[] = views.map((d) => ({
    key: d.dimension,
    label: d.label,
    mean: spec(String(d.mean)),
    value: d.mean,
    hue: DIMENSION_HUE[d.dimension],
    trend: d.trend.words,
    sessions: d.sessions,
  }));
  const top = topDimension(views);
  const topRow = top ? rows.find((r) => r.key === top.dimension) ?? null : null;
  const body: DimensionsPage['body'] =
    bp && topRow
      ? {
          top: topRow,
          rows,
          basis: `${dimensionsBasis(bp)} Each session is scored out of 100 by the model that read it, and a trend is the newer half of those sessions against the older half.`,
          archetypeLine: modalArchetypeLine(bp),
        }
      : {
          refusal: `The five dimensions are read one analysed session at a time. ${dimensionsPending(b.sessions_analysed, b.min_sessions)}`,
          analysed: Math.max(0, b.sessions_analysed),
          needed: Math.max(1, b.min_sessions),
        };
  const view = archetypeView(b.corpus, b.report);
  return {
    body,
    hero: heroOf(b, null),
    unscored: (view?.unscored ?? []).map((u) => ({
      key: u.rule.name,
      name: u.rule.display,
      reason: u.reason ? sentence(u.reason) : `${capital(u.rule.rule ?? u.rule.metric.replace(/_/g, ' '))}, not scored here.`,
    })),
  };
}

// ------------------------------------------------------------------ glossary

export interface GlossaryPage {
  body:
    | {
        found: NumSpec;
        foundCount: number;
        catalog: number;
        locked: string | null;
        summary: string;
        months: GlossaryMonth[];
        cutNote: string | null;
      }
    | Refused;
  /** True when the Mac has not sent the block at all (the page offers the command). */
  notSent: boolean;
}

export function glossaryPage(b: BuilderProfileResponse, now: number = Date.now()): GlossaryPage {
  const report = b.report ?? null;
  if (!report) return { body: { refusal: NO_REPORT }, notSent: true };
  const gv = glossaryView(report.vocab, now);
  if (!gv) return { body: { refusal: 'Your Mac sent a report without the glossary. A newer Mac sends it.' }, notSent: true };
  if (gv.refusal) return { body: { refusal: gv.refusal }, notSent: false };
  return {
    body: {
      found: spec(n(gv.found)),
      foundCount: gv.found,
      catalog: report.vocab?.catalog_size ?? gv.found,
      locked: gv.locked,
      summary: gv.summary,
      months: gv.months,
      cutNote: gv.cutNote,
    },
    notSent: false,
  };
}

// ------------------------------------------------------------------ stack

export interface StackItemLine {
  id: string;
  name: string;
  sessions: number;
  /** Of the sessions the stack was read from: the inline bar (Strava's splits). */
  share: number;
  value: string | null;
  meta: string;
}

export interface StackCategory {
  key: string;
  label: string;
  hue: HueName;
  count: NumSpec;
  /** Things a session used, most first: each a line with its bar. */
  items: StackItemLine[];
  /**
   * Things no session used, said as sentences by what put them here ("Named in a manifest, not
   * seen in a session: FastAPI, Tailwind CSS."), rather than a line each with no bar under it.
   */
  named: string[];
}

export interface StackPage {
  body: { total: NumSpec; summary: string; groups: StackCategory[]; cutNote: string | null } | Refused;
  notSent: boolean;
}

/** Category hues, far apart first; tide is the band's, so the first category starts past it. */
const CATEGORY_HUES: readonly HueName[] = ['ember', 'iris', 'brass', 'orchid', 'cobalt', 'coral', 'heather'];

export function stackPage(b: BuilderProfileResponse, now: number = Date.now()): StackPage {
  const report = b.report ?? null;
  if (!report) return { body: { refusal: NO_REPORT }, notSent: true };
  const s = report.stack ?? null;
  const sv = stackView(s, now);
  if (!sv || !s) return { body: { refusal: 'Your Mac sent a report without the stack. A newer Mac sends it.' }, notSent: true };
  if (sv.refusal) return { body: { refusal: sv.refusal }, notSent: false };
  const base = Math.max(1, s.sessions);
  return {
    body: {
      total: spec(n(sv.total)),
      summary: sv.summary,
      groups: sv.groups.map((g, i) => {
        const unused = new Map<string, string[]>();
        for (const it of g.items) if (it.sessions <= 0) unused.set(it.meta, [...(unused.get(it.meta) ?? []), it.name]);
        return {
          key: g.category,
          label: capital(g.label),
          hue: CATEGORY_HUES[i % CATEGORY_HUES.length]!,
          count: spec(n(g.items.length)),
          items: g.items
            .filter((it) => it.sessions > 0)
            .map((it) => ({
              id: it.id,
              name: it.name,
              sessions: it.sessions,
              share: Math.min(1, it.sessions / base),
              value: it.value,
              meta: it.meta,
            })),
          named: [...unused.entries()].map(([why, names]) => `${capital(why)}: ${names.join(', ')}.`),
        };
      }),
      cutNote: sv.cutNote,
    },
    notSent: false,
  };
}

// ------------------------------------------------------------------ the tools, from the sessions on this phone

export interface ToolLine {
  key: HarnessMark['id'];
  /** The wire value whose mark `HarnessLogo` draws (Cursor's two values share one). */
  harness: string;
  name: string;
  sessions: NumSpec;
  count: number;
  share: number;
}

export interface ToolsMix {
  tools: ToolLine[];
  /** "Counted over the 53 finished sessions saved on this phone." */
  basis: string;
}

/**
 * Which coding tools the sessions on this phone came from, most first, one line a tool (Cursor's
 * IDE and its CLI are one tool, as the picker has them). A harness this build does not know is
 * left out rather than drawn with somebody else's mark. Null with no sessions: nothing is not a
 * tool mix of zeros.
 */
export function toolsMix(sessions: readonly { harness: string }[]): ToolsMix | null {
  const byMark = new Map<HarnessMark['id'], number>();
  let known = 0;
  for (const s of sessions) {
    if (!isHarness(s.harness)) continue;
    const mark = HARNESS_MARKS.find((m) => (m.harnesses as readonly string[]).includes(s.harness));
    if (!mark) continue;
    byMark.set(mark.id, (byMark.get(mark.id) ?? 0) + 1);
    known += 1;
  }
  if (known === 0) return null;
  const tools = HARNESS_MARKS.filter((m) => byMark.has(m.id))
    .map((m) => {
      const c = byMark.get(m.id)!;
      return { key: m.id, harness: m.harnesses[0]!, name: m.name, sessions: spec(n(c)), count: c, share: c / known };
    })
    .sort((x, y) => y.count - x.count);
  const unknown = sessions.length - known;
  const left = unknown > 0 ? ` ${count(unknown, 'session')} from a tool this build does not know ${unknown === 1 ? 'is' : 'are'} left out.` : '';
  return { tools, basis: `Counted over the ${count(sessions.length, 'finished session')} saved on this phone.${left}` };
}
