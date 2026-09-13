/**
 * The money view: what the work would cost at API list prices, beside its tokens and its
 * lines. Pure, so `__tests__/you.test.ts` holds it.
 *
 * WHAT THE DOLLAR IS (analysis/pricing.py, CLAUDE.md "A cost in tokens and the same cost in
 * dollars can point opposite ways"): what the tokens would cost on the Anthropic API at list
 * prices, read on a stated day. Most people are on a subscription and pay nothing per token, so
 * it is never "you spent", and it never travels without its label and its date.
 *
 * EVERY WORD IS `src/copy/`'s. The dollars, the refusals, the spend without a commit, the
 * barren share: each is the port of the Python that says it on the Mac, pinned there. This
 * file only decides what goes on the page and in what order.
 *
 * TWO SOURCES, ONE SET OF RENDERERS. The Mac's report (`report.money`, `report.burn`, v2) when
 * the machine sent one; the server's corpus profile otherwise (docs/overnight-integration.md
 * 1.3: "with report null the phone shows corpus.metrics.spend_usd"), mapped field for field
 * into the report's shapes so the same functions say both. No price is computed on the phone:
 * `corpus_profile` priced every dollar, on one side or the other.
 *
 * NEVER A SCOLDING. The spend without a commit and the barren share are said as shares, with
 * no verdict: a session that ended without a commit can be the one that found the bug.
 */
import { corpusBurnLine, corpusBurnRefusal } from '../copy/burn';
import { REFUSALS } from '../copy/catalog';
import {
  dollars,
  linesAdded,
  linesRemoved,
  modelName,
  moneyRefusal,
  perActiveHour,
  pricesAreStale,
  readOn,
  totalTokens,
  unpricedNote,
  withoutACommit,
} from '../copy/money';
import { capital, count, human, shareWords } from '../copy/numbers';
import type { CorpusMetric, CorpusProfile } from '../data/api';
import { REPORT_ENUMS, type BuilderReport, type PricedModel, type ReportBurn, type ReportMoney } from '../generated/report';

export interface TokenStat {
  /** "4112.2M", as `burn._human` says a token count. */
  value: string;
  /** "tokens, 95% cache reads", or "output tokens" when that is all the server holds. */
  label: string;
}

export interface ModelRow {
  key: string;
  /** "Opus 4.8". */
  name: string;
  usd: number;
  /** "97 sessions · 9.1M output tokens · $6.83 a commit". Mask it with the page. */
  meta: string;
  /** Dollars a commit over the sessions it wrote most of, when it has commits there. */
  perCommit: number | null;
}

export interface MoneyView {
  source: 'report' | 'server';
  /** The hero, unformatted: the screen writes it, or the mask. Null on a refusal, never 0. */
  usd: number | null;
  /** Why there is no dollar figure, as a sentence. */
  refusal: string | null;
  /** "at API list prices, read Sep 6". Always said beside the number. */
  label: string;
  stale: boolean;
  tokens: TokenStat | null;
  /** "+64,680", "-9,021": null for a side no session counted, never "+0". */
  added: string | null;
  removed: string | null;
  /** When neither side of the lines was counted, why. */
  linesRefusal: string | null;
  /** A true note about one missing side. */
  linesNote: string | null;
  /** "$22.10 an active hour". */
  perHour: string | null;
  models: ModelRow[];
  /** Plain sentences with their real dollar figures; the screen masks them when asked. */
  sentences: string[];
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function oneOf<T extends string>(v: unknown, values: readonly T[]): T | null {
  return typeof v === 'string' && (values as readonly string[]).includes(v) ? (v as T) : null;
}

/** A clause from `src/copy/` or a server reason, as a sentence: capitalised, one full stop. */
function sentence(clause: string): string {
  const t = clause.trim();
  return capital(t.endsWith('.') ? t : `${t}.`);
}

function priceLabel(readOnIso: string, stale: boolean): string {
  const day = readOn(readOnIso);
  if (!day) return 'at API list prices';
  return stale ? `at API list prices, read ${day}, which may have moved since` : `at API list prices, read ${day}`;
}

function modelMeta(sessions: number, outputTokens: number, perCommit: number | null): string {
  const parts = [count(sessions, 'session'), `${human(outputTokens)} output tokens`];
  if (perCommit !== null) parts.push(`${dollars(perCommit)} a commit`);
  return parts.join(' · ');
}

/** "28.6% more went into stretches the transcripts cannot judge": the floor's other side. */
function unreadableSentence(b: ReportBurn): string | null {
  const u = b.unreadable_tokens ?? null;
  const t = b.tokens ?? null;
  if (u === null || u <= 0 || t === null || t <= 0 || b.share == null) return null;
  return sentence(`${shareWords(u / t)} more went into stretches the transcripts cannot judge either way`);
}

function burnSentences(b: ReportBurn | null | undefined, serverReason?: string | null): string[] {
  if (!b) return [];
  const line = corpusBurnLine(b);
  if (line) {
    const more = unreadableSentence(b);
    return more ? [sentence(line), more] : [sentence(line)];
  }
  const refusal = corpusBurnRefusal(b) ?? serverReason ?? null;
  return refusal ? [sentence(refusal)] : [];
}

const LINES_REFUSAL = sentence(REFUSALS.no_line_counts as string);

/** The shared half: everything a `ReportMoney` says, whichever side it came from. */
function fromMoney(m: ReportMoney, now: number): Omit<MoneyView, 'source' | 'tokens' | 'models' | 'sentences'> & { sentences: string[] } {
  const usd = m.reason == null ? num(m.usd) : null;
  const added = linesAdded(m);
  const removed = linesRemoved(m);
  const sentences: string[] = [];
  if (usd !== null) {
    const w = withoutACommit(m);
    sentences.push(w ? sentence(w) : 'Too few priced sessions have a commit count yet to say what went to sessions without one.');
    const unpriced = unpricedNote(m);
    if (unpriced) sentences.push(unpriced);
  }
  return {
    usd,
    refusal: usd === null ? sentence(moneyRefusal(m) ?? 'there is no price to show yet') : null,
    label: priceLabel(m.prices_read_on, usd !== null && pricesAreStale(m, now)),
    stale: usd !== null && pricesAreStale(m, now),
    added,
    removed,
    linesRefusal: added === null && removed === null ? LINES_REFUSAL : null,
    linesNote: null,
    perHour: perActiveHour(m),
    sentences,
  };
}

function fromReport(m: ReportMoney, burn: ReportBurn | null | undefined, now: number): MoneyView {
  const base = fromMoney(m, now);
  let tokens: TokenStat | null = null;
  const said = totalTokens(m.tokens);
  if (m.tokens && said) {
    const t = m.tokens;
    const total = t.input + t.output + t.cache_read + t.cache_w5m + t.cache_w1h;
    tokens = { value: said, label: total > 0 && t.cache_read > 0 ? `tokens, ${shareWords(t.cache_read / total)} cache reads` : 'tokens' };
  }
  return {
    ...base,
    source: 'report',
    tokens,
    models: m.by_model.map((r) => ({
      key: r.model,
      name: modelName(r.model),
      usd: r.usd,
      meta: modelMeta(r.sessions, r.output_tokens, num(r.usd_per_commit)),
      perCommit: num(r.usd_per_commit),
    })),
    sentences: [...base.sentences, ...burnSentences(burn)],
  };
}

// --------------------------------------------------------------------------- the server's side

interface CorpusModelCost {
  model: string;
  model_id: string | null;
  usd: number;
  output_tokens: number;
  sessions: number;
  usd_per_commit: number | null;
}

/**
 * `corpus.model_costs`, which the phone's `CorpusProfile` type does not name: read field by
 * field, and a row that is not the shape `analysis/profile.py` writes is dropped rather than
 * drawn with a guessed number.
 */
export function corpusModelCosts(corpus: CorpusProfile): CorpusModelCost[] {
  const raw = (corpus as unknown as { model_costs?: unknown }).model_costs;
  if (!Array.isArray(raw)) return [];
  const out: CorpusModelCost[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const usd = num(o.usd);
    const output = num(o.output_tokens);
    const sessions = num(o.sessions);
    if (typeof o.model !== 'string' || usd === null || output === null || sessions === null) continue;
    out.push({
      model: o.model,
      model_id: typeof o.model_id === 'string' ? o.model_id : null,
      usd,
      output_tokens: output,
      sessions,
      usd_per_commit: num(o.usd_per_commit),
    });
  }
  return out;
}

/**
 * The server's spend metrics in the report's money shape (docs/overnight-integration.md 1.3's
 * `money_block`, done on the other side of the wire): a refused spend's basis IS its refusal
 * code. Nothing is computed; a field the server did not send stays null.
 */
export function corpusMoney(corpus: CorpusProfile): ReportMoney | null {
  const m = corpus.metrics ?? {};
  const spend = m.spend_usd;
  if (!spend) return null;
  const usd = num(spend.value);
  const w = m.spend_without_a_commit_usd;
  const totals = corpus.totals as CorpusProfile['totals'] & { total_lines_removed?: unknown };
  return {
    usd,
    basis: usd !== null ? oneOf(spend.basis, REPORT_ENUMS.money_basis) : null,
    reason: usd === null ? oneOf(spend.basis, REPORT_ENUMS.money_refusal) : null,
    prices_read_on: typeof spend.prices_read_on === 'string' ? spend.prices_read_on : '',
    priced_sessions: usd !== null ? spend.n : 0,
    unpriced_sessions: num(spend.unpriced_sessions) ?? 0,
    usd_per_active_hour: num(m.spend_per_hour_usd?.value),
    usd_without_a_commit: num(w?.value),
    share_without_a_commit: num(w?.share_of_spend),
    tokens: null,
    token_sessions: 0,
    lines_added: num(totals.total_lines_added),
    lines_removed: num(totals.total_lines_removed),
    lines_basis: 'uploaded_agent_lines',
    by_model: [],
  };
}

/** The server's barren share in the report's burn shape: its `code` is the refusal code. */
export function corpusBurn(metric: CorpusMetric | undefined): ReportBurn | null {
  if (!metric) return null;
  return {
    share: num(metric.value),
    barren_tokens: num(metric.barren_tokens),
    tokens: num(metric.tokens),
    unreadable_tokens: num(metric.unreadable_tokens),
    sessions: metric.n,
    needed: num(metric.needed),
    reason: num(metric.value) === null ? oneOf(metric.code, REPORT_ENUMS.burn_refusal) : null,
    causes: null,
  };
}

function reasonOf(m: CorpusMetric | undefined): string | null {
  return typeof m?.reason === 'string' ? m.reason : null;
}

function fromCorpus(corpus: CorpusProfile, now: number): MoneyView | null {
  const money = corpusMoney(corpus);
  if (!money) return null;
  const base = fromMoney(money, now);
  const metrics = corpus.metrics ?? {};

  // A refused spend whose basis is not one of the report's codes keeps the server's words.
  const refusal = base.usd === null && money.reason === null ? reasonOf(metrics.spend_usd) : null;
  // Below its floor the report sends null; the server says how far off it is, so it says it.
  const sentences = [...base.sentences];
  const quiet = reasonOf(metrics.spend_without_a_commit_usd);
  if (base.usd !== null && money.usd_without_a_commit === null && quiet) sentences[0] = sentence(quiet);

  const output = (corpus.model_mix ?? []).reduce((a, x) => a + (num(x.output_tokens) ?? 0), 0);
  const priced = new Set<string>(REPORT_ENUMS.priced_model);
  return {
    ...base,
    source: 'server',
    refusal: refusal ? sentence(refusal) : base.refusal,
    // The server holds no summed token buckets; the model mix carries output tokens, and the
    // label says that is all it is.
    tokens: output > 0 ? { value: human(output), label: 'output tokens' } : null,
    linesNote: money.lines_added !== null && money.lines_removed === null ? 'Lines removed are not counted by this server yet.' : null,
    models: corpusModelCosts(corpus).map((r) => ({
      key: r.model_id ?? r.model,
      name: r.model_id && priced.has(r.model_id) ? modelName(r.model_id as PricedModel) : r.model,
      usd: r.usd,
      meta: modelMeta(r.sessions, r.output_tokens, r.usd_per_commit),
      perCommit: r.usd_per_commit,
    })),
    sentences: [...sentences, ...burnSentences(corpusBurn(metrics.barren_token_share), reasonOf(metrics.barren_token_share))],
  };
}

/** The money view, or null when neither the Mac nor the server sent anything to read. */
export function moneyView(
  corpus: CorpusProfile | null | undefined,
  report: BuilderReport | null | undefined,
  now: number = Date.now(),
): MoneyView | null {
  if (report?.money) return fromReport(report.money, report.burn, now);
  if (corpus) return fromCorpus(corpus, now);
  return null;
}

/** The You tab's one line for this page: the dollar figure, or why there is none. */
export function moneyRowLine(v: MoneyView | null): string | null {
  if (!v) return null;
  if (v.usd !== null) return `${dollars(v.usd)} at API list prices`;
  return v.refusal;
}
