/**
 * The Stack page, as data: what the hero band counts, which marks drift across it, which things
 * are the bubbles of what you build with most, and each category as a chapter with its hue, its
 * count, its tiles and the one sentence for what only a manifest names. Pure, so
 * `__tests__/stackPage.test.ts` holds every rule below without a renderer.
 *
 * NOTHING HERE IS COUNTED A SECOND WAY. The groups, their order, the names and the cut note are
 * `you/stack.ts stackView`'s, which the You tab's door reads too; the evidence and the first day
 * come from the same report items it read. The category hues are the ones `chapters.stackPage`
 * gives the You tab's door, so a category wears one colour on both screens.
 *
 * THE HOUSE RULES (CLAUDE.md): absent is not zero. A thing no session used gets no count and no
 * tile; it is named quietly, once per category, in a sentence that says what put it there. The
 * report carries no sessions over time and no projects per thing, so the page draws neither.
 */
import { capital, count, n } from '../copy/numbers';
import type { BuilderProfileResponse } from '../data/api';
import type { BuilderReport, ReportStack, ReportStackItem, StackCategory, StackEvidence, StackItem } from '../generated/report';
import { numSpec, type NumSpec } from '../insights/format';
import { NO_REPORT, type Refused } from '../insights/model';
import type { HueName } from '../insights/palette';
import { toolsMix, type ToolsMix } from '../you/chapters';
import { dayOf } from '../you/numbers';
import { EVIDENCE_ONLY, STACK_CATEGORY_LABEL, stackView } from '../you/stack';
import { creditsFor, markOf, type StackMark } from './marks';

export type { Refused } from '../insights/model';

/** A figure that counts up to a copy helper's string. */
function spec(final: string): NumSpec {
  return numSpec(Number.NaN, final);
}

/** "A", "A and B", "A, B, and C": the house list, with the comma before the last (ANALYSIS_CONTENTS). */
export function listOf(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

/** What kind of evidence was seen for a thing a session used, in a sentence. */
const SEEN_BY: Record<StackEvidence, string> = {
  manifest: 'A manifest names it too.',
  language: 'Read from the files the agent wrote.',
  command: 'Seen in the commands your sessions ran.',
  path: 'Seen in the files your sessions touched.',
  tool: 'Seen in a tool your sessions called.',
};

/** A category's things, counted: "6 languages", "1 testing tool". */
const NOUN: Record<StackCategory, [string, string]> = {
  language: ['language', 'languages'],
  framework: ['framework', 'frameworks'],
  database: ['database', 'databases'],
  infra: ['piece of infrastructure', 'pieces of infrastructure'],
  testing: ['testing tool', 'testing tools'],
  tooling: ['tool', 'tools'],
  service: ['service', 'services'],
};

/**
 * The categories' hues, in the order `chapters.stackPage` hands them to the You tab's door (far
 * apart first). `stackPage.test.ts` holds the two together.
 */
export const CATEGORY_HUES: readonly HueName[] = ['ember', 'iris', 'brass', 'orchid', 'cobalt', 'coral', 'heather'];
/** A chapter whose hue is the hero's takes one of these instead, the first no chapter wears. */
const SPARE_HUES: readonly HueName[] = ['tide', 'cobalt', 'heather', 'orchid', 'brass', 'coral', 'iris', 'ember'];

/**
 * Each present category's hue: the door's, except that no chapter wears the hero band's hue (the
 * builder's creature), which would read as part of the hero.
 */
export function chapterHues(present: number, hero: HueName | null): HueName[] {
  const out = Array.from({ length: present }, (_, i) => CATEGORY_HUES[i % CATEGORY_HUES.length]!);
  for (let i = 0; i < out.length; i++) {
    if (out[i] !== hero) continue;
    const spare = SPARE_HUES.find((h) => h !== hero && !out.includes(h));
    if (spare) out[i] = spare;
  }
  return out;
}

export interface StackThing {
  id: StackItem;
  name: string;
  category: StackCategory;
  sessions: number;
  /** Of the sessions the stack was read from, 0 to 1. */
  share: number;
  /** "Aug 14": the day of its first event evidence. Null when only a manifest names it. */
  since: string | null;
  evidence: StackEvidence;
  /** The sessions as a figure that counts up. */
  count: NumSpec;
  /** "115 of 143 sessions". */
  ofAll: string;
  /** What a tap on it says. */
  story: string;
  /** The same, in the room a small tile has: "18 of 143 sessions, since Aug 14." */
  short: string;
  /** Beside the count a small tile already shows: "of 143 sessions". */
  ofTotal: string;
  /** "first on Aug 14". Null when only a manifest names it. */
  firstOn: string | null;
  /** What was seen of it, in a sentence: "Seen in the commands your sessions ran." */
  seen: string;
  mark: StackMark | null;
}

export interface StackChapter {
  key: StackCategory;
  /** "02". */
  index: string;
  /** "Languages". */
  title: string;
  hue: HueName;
  /** How many things the category holds, used or only named. */
  count: NumSpec;
  /** "languages": what the count counts. */
  caption: string;
  /** How many a session used, against how many are only named. */
  note: string;
  /** Things a session used, most first: the tiles. */
  used: StackThing[];
  /** Things only a manifest names: quiet marks and one sentence. */
  named: StackThing[];
  namedLine: string | null;
}

export interface StackBody {
  total: NumSpec;
  totalCount: number;
  /** "things your work is made of". */
  caption: string;
  /** How many turned up in a session, and how many are only named. */
  note: string;
  /** What it was read from. */
  basis: string;
  /** The marks that drift across the hero band: the most used, most first. */
  loop: StackThing[];
  /** The bubbles of what you build with most. */
  top: StackThing[];
  /** What the bubbles say before one is tapped. */
  topLine: string | null;
  chapters: StackChapter[];
  cutNote: string | null;
  /** The logos' licence, and the credit every attribution licenced mark on the page asks for. */
  credits: string;
  /** Sessions the stack was read from. */
  sessions: number;
}

export interface StackPage {
  body: StackBody | Refused;
  /** True when the Mac has not sent the block at all (the page offers the command). */
  notSent: boolean;
}

/** How many marks drift across the hero band. */
export const LOOP_MAX = 12;
/** How many bubbles the cloud holds. */
export const TOP_MAX = 10;

export interface ProjectReach {
  /** Projects with a session in the report's window. */
  total: number;
  /** Catalog id to how many of them a session used it in. */
  using: Map<string, number>;
}

/**
 * How many of your projects each thing turned up in, when the report carries them (report v3's
 * `projects`, each project's window with its own stack block over its own sittings). Read loosely,
 * field by field: the block is new, and a shape this build does not expect is no answer rather
 * than a wrong one. Null with fewer than two projects in the window, where "1 of 1" says nothing.
 */
export function projectReach(report: unknown): ProjectReach | null {
  const list = (report as { projects?: { projects?: unknown } } | null | undefined)?.projects?.projects;
  if (!Array.isArray(list)) return null;
  let total = 0;
  const using = new Map<string, number>();
  for (const p of list) {
    const items = (p as { window?: { stack?: { items?: unknown } } | null } | null)?.window?.stack?.items;
    if (!Array.isArray(items)) continue;
    total += 1;
    for (const it of items as { id?: unknown; sessions?: unknown }[]) {
      if (typeof it?.id === 'string' && typeof it.sessions === 'number' && it.sessions > 0) using.set(it.id, (using.get(it.id) ?? 0) + 1);
    }
  }
  return total >= 2 ? { total, using } : null;
}

function thingOf(item: ReportStackItem, name: string, base: number, now: number, reach: ProjectReach | null): StackThing {
  const since = item.first_seen ? dayOf(item.first_seen, now) : null;
  const used = item.sessions > 0;
  const ofAll = `${n(item.sessions)} of ${count(base, 'session')}`;
  const projects = used && reach ? reach.using.get(item.id) ?? 0 : 0;
  const story = used
    ? `In ${ofAll}${since ? `, first on ${since}` : ''}. ${SEEN_BY[item.evidence]}${projects > 0 && reach ? ` Used in ${n(projects)} of the ${n(reach.total)} projects this report read.` : ''}`
    : `${capital(EVIDENCE_ONLY[item.evidence])}.`;
  return {
    id: item.id,
    name,
    category: item.category,
    sessions: item.sessions,
    share: base > 0 ? Math.min(1, item.sessions / base) : 0,
    since,
    evidence: item.evidence,
    count: spec(n(item.sessions)),
    ofAll,
    story,
    short: used ? `${ofAll}${since ? `, since ${since}` : ''}.` : story,
    ofTotal: `of ${count(base, 'session')}`,
    firstOn: used && since ? `first on ${since}` : null,
    seen: used ? SEEN_BY[item.evidence] : `${capital(EVIDENCE_ONLY[item.evidence])}.`,
    mark: markOf(item.id),
  };
}

function chapterNote(used: number, named: number, allManifest: boolean): string {
  const total = used + named;
  const only = allManifest ? 'only named in a manifest' : 'never seen in a session';
  if (named === 0) return total === 1 ? 'It turned up in your sessions.' : `All ${n(total)} turned up in your sessions.`;
  if (used === 0) return total === 1 ? `It is ${only}.` : `${total === 2 ? 'Both' : `All ${n(total)}`} are ${only}.`;
  return `${n(used)} turned up in your sessions, and ${n(named)} ${named === 1 ? 'is' : 'are'} ${only}.`;
}

/** The one honest sentence per reason for the things no session used: "Named in a manifest, ...: A, B, and C." */
function namedLine(things: readonly StackThing[]): string | null {
  if (!things.length) return null;
  const by = new Map<StackEvidence, string[]>();
  for (const t of things) by.set(t.evidence, [...(by.get(t.evidence) ?? []), t.name]);
  return [...by.entries()].map(([why, names]) => `${capital(EVIDENCE_ONLY[why])}: ${listOf(names)}.`).join(' ');
}

// ------------------------------------------------------------------ the coding tools

/**
 * Where the tools chapter's count comes from. FOUND IN THE CAPTURE (2026-09-13): the chapter
 * said "Counted over the 52 finished sessions saved on this phone" a scroll below "Git, 115 of
 * 143 sessions", two sources on one page and nothing to say which was which. The report's
 * projects now carry each project's tools (`window.harnesses`), over the very sittings the
 * stack block is read from, so the chapter counts those whenever the report sends them
 * (`toolsFromReport`); only a report without them falls back to the phone's own sessions, and
 * then it says so beside the report's count (`phoneTools`).
 */
export type ToolsSource = 'report' | 'phone';

/** What `chapters.toolsMix` hands the page: the tools the sessions came from, and what they were counted over. */
export interface ToolsIn {
  tools: readonly { key: string; name: string; count: number }[];
  basis: string;
}

/**
 * The tools the report's sittings came from: every project's `harnesses` summed, how many of the
 * sessions the stack was read from that covers, and why any are not covered, from what the report
 * itself says: sittings in no project (`unresolved`) carry no tool, and projects past the list it
 * caps (`projects_total` over the listed ones) are not in it at all. Neither is guessed at. Null
 * when the report has no projects block or no project names a tool.
 */
export function reportTools(
  report: BuilderReport | null | undefined,
): { byHarness: [string, number][]; covered: number; read: number; unresolved: number; cut: number; listed: number } | null {
  const block = report?.projects ?? null;
  if (!block) return null;
  const by = new Map<string, number>();
  let covered = 0;
  for (const p of block.projects) {
    for (const h of p.window?.harnesses ?? []) {
      if (!(h.sessions > 0)) continue;
      by.set(h.harness, (by.get(h.harness) ?? 0) + h.sessions);
      covered += h.sessions;
    }
  }
  if (covered <= 0) return null;
  const read = Math.max(covered, report?.stack?.sessions ?? report?.coverage?.sessions ?? covered);
  return {
    byHarness: [...by.entries()],
    covered,
    read,
    unresolved: Math.max(0, block.unresolved?.sessions ?? 0),
    cut: Math.max(0, block.projects_total - block.projects.length),
    listed: block.projects.length,
  };
}

/**
 * The tools chapter from the report, in the shape `chapters.toolsMix` gives the phone's sessions
 * (the same marks, Cursor's two tools as one), with what it counted said in words, and the real
 * reason for any session it could not count: in no project, in a project past the report's list,
 * or, when the report says neither, only that it does not say.
 */
export function toolsFromReport(report: BuilderReport | null | undefined): ToolsMix | null {
  const t = reportTools(report);
  if (!t) return null;
  // One row a sitting, so `toolsMix` decides every mark exactly as it does for the phone's.
  const mix = toolsMix(t.byHarness.flatMap(([harness, k]) => Array.from({ length: k }, () => ({ harness }))));
  if (!mix) return null;
  const known = mix.tools.reduce((s, x) => s + x.count, 0);
  const other = t.read - t.covered;
  const byProject = 'and the report counts tools project by project';
  const why =
    t.unresolved > 0 && t.cut > 0
      ? `the other ${n(other)} are in no project or in projects past the ${n(t.listed)} the report lists, ${byProject}.`
      : t.unresolved > 0
        ? `the other ${n(other)} belong to no project, ${byProject}.`
        : t.cut > 0
          ? `the other ${n(other)} are in projects past the ${n(t.listed)} the report lists, ${byProject}.`
          : `the report does not say which tool wrote the other ${n(other)}.`;
  const over =
    other <= 0
      ? `Counted over the ${count(t.read, 'session')} your Mac read, the same sessions as every count above.`
      : `Counted over ${n(t.covered)} of the ${count(t.read, 'session')} your Mac read: ${why}`;
  const unknown = t.covered - known;
  const left = unknown > 0 ? ` ${count(unknown, 'session')} from a tool this build does not know ${unknown === 1 ? 'is' : 'are'} left out.` : '';
  return { tools: mix.tools, basis: `${over}${left}` };
}

/**
 * The phone's own count, for a report that carries no tools: what it counted, said beside what
 * every other count on the page is out of, so the two numbers are never read as one.
 */
export function phoneTools(mix: ToolsMix | null, read: number | null): ToolsMix | null {
  if (!mix) return null;
  if (read === null) return mix;
  return { ...mix, basis: `${mix.basis} Every other count on this page is out of the ${count(read, 'session')} your Mac read.` };
}

export interface ToolsBand {
  total: NumSpec;
  caption: string;
  note: string;
  hue: HueName;
}

const TOOL_HUES: readonly HueName[] = ['tide', 'cobalt', 'heather', 'brass', 'coral', 'iris', 'orchid', 'ember'];

/**
 * The band over the coding tools: how many sessions it counts and where they were counted
 * (`source`), which tool wrote how many, and a hue, the leading tool's own (Claude Code is heather
 * everywhere) unless a neighbour already wears it. Null with no tool: no sessions is not a
 * chapter of zeros.
 */
export function toolsBand(mix: ToolsIn | null, avoid: readonly HueName[], own: (key: string) => HueName | null, source: ToolsSource = 'phone'): ToolsBand | null {
  if (!mix || !mix.tools.length) return null;
  const total = mix.tools.reduce((s, t) => s + t.count, 0);
  const lead = own(mix.tools[0]!.key);
  const hue = lead && !avoid.includes(lead) ? lead : TOOL_HUES.find((h) => !avoid.includes(h)) ?? 'tide';
  const note =
    mix.tools.length === 1
      ? `${total === 1 ? 'It ran' : 'Every one ran'} in ${mix.tools[0]!.name}.`
      : `${capital(listOf(mix.tools.map((t) => `${t.name} ${n(t.count)}`)))}.`;
  const where = source === 'report' ? 'your Mac read' : 'on this phone';
  return { total: spec(n(total)), caption: `${total === 1 ? 'session' : 'sessions'} ${where}`, note, hue };
}

// ------------------------------------------------------------------ the page

export function stackPage(b: BuilderProfileResponse, hero: HueName | null, now: number = Date.now()): StackPage {
  const report = b.report ?? null;
  if (!report) return { body: { refusal: NO_REPORT }, notSent: true };
  const s: ReportStack | null = report.stack ?? null;
  const sv = stackView(s, now);
  if (!sv || !s) return { body: { refusal: 'Your Mac sent a report without the stack. A newer Mac sends it.' }, notSent: true };
  if (sv.refusal) return { body: { refusal: sv.refusal }, notSent: false };

  const raw = new Map(s.items.map((it) => [it.id, it]));
  const base = Math.max(0, s.sessions);
  const hues = chapterHues(sv.groups.length, hero);
  const reach = projectReach(report);
  const chapters: StackChapter[] = sv.groups.map((g, i) => {
    const things = g.items.map((row) => thingOf(raw.get(row.id)!, row.name, base, now, reach));
    const used = things.filter((t) => t.sessions > 0);
    const named = things.filter((t) => t.sessions <= 0);
    const [one, many] = NOUN[g.category];
    return {
      key: g.category,
      index: String(i + 2).padStart(2, '0'),
      title: capital(STACK_CATEGORY_LABEL[g.category]),
      hue: hues[i]!,
      count: spec(n(things.length)),
      caption: things.length === 1 ? one : many,
      note: chapterNote(used.length, named.length, named.every((t) => t.evidence === 'manifest')),
      used,
      named,
      namedLine: namedLine(named),
    };
  });

  const all = chapters.flatMap((c) => [...c.used, ...c.named]);
  const used = all.filter((t) => t.sessions > 0).sort((x, y) => y.sessions - x.sessions);
  const namedCount = all.length - used.length;
  const allManifest = all.filter((t) => t.sessions <= 0).every((t) => t.evidence === 'manifest');
  const total = sv.total;

  let note: string;
  if (namedCount === 0) note = total === 1 ? 'It turned up in your sessions.' : `All ${n(total)} turned up in your sessions.`;
  else if (used.length === 0) note = `None turned up in a session yet: ${total === 1 ? 'it is' : 'they are'} ${allManifest ? 'only named in a manifest' : 'never seen in a session'}.`;
  else note = `${n(used.length)} turned up in your sessions, and ${n(namedCount)} more ${namedCount === 1 ? 'is' : 'are'} ${allManifest ? 'only named in a manifest' : 'never seen in a session'}.`;

  const from = [count(s.sessions, 'session')];
  if (s.manifests > 0) from.push(count(s.manifests, 'dependency name', 'dependency names'));
  const basis = `Across ${count(chapters.length, 'category', 'categories')}, read by your Mac from ${from.join(' and ')}.`;

  const top = used.slice(0, TOP_MAX);
  let topLine: string | null = null;
  if (top.length) {
    const most = top[0]!.sessions;
    const leaders = top.filter((t) => t.sessions === most).map((t) => t.name);
    topLine =
      leaders.length === 1
        ? `${leaders[0]} turned up in the most sessions: ${n(most)} of the ${n(base)} read.`
        : `${listOf(leaders)} turned up in the most sessions: ${n(most)} each, of the ${n(base)} read.`;
  }

  const credits = creditsFor(all.map((t) => t.id));
  const logoLine = "The logos are each brand's own, drawn by Simple Icons (CC0) to name what you used, never to say a brand endorses Builda.";

  return {
    body: {
      total: spec(n(total)),
      totalCount: total,
      caption: total === 1 ? 'thing your work is made of' : 'things your work is made of',
      note,
      basis,
      loop: used.slice(0, LOOP_MAX),
      top,
      topLine,
      chapters,
      cutNote: sv.cutNote,
      credits: credits.length ? `${logoLine} ${credits.join('. ')}.` : logoLine,
      sessions: base,
    },
    notSent: false,
  };
}
