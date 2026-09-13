/**
 * Everything the Wrapped screen draws, loaded cache first (DESIGN-DIRECTION 9: stale beats a
 * spinner), then from the server, and the state it is in.
 *
 * WHERE EACH PIECE COMES FROM
 *   the cards      `GET /v1/profile/builder` `report.wrapped`, computed on the machine by
 *                  `analysis.report.from_corpus` and sent by `capture report`. Cached under
 *                  the one key the You tab already writes the same response to.
 *   the quotes     the same response's `quotes`, owner only, off by default, held in memory
 *                  for this visit only (never cached); and whether the switch is on, from
 *                  `GET /v1/privacy/prefs`.
 *   the art        the profile graph (`GET /v1/profile`, cached by the You tab), the report's
 *                  commit days, the sessions this phone has cached, and the longest
 *                  session's strip (its cached detail, else one `GET /v1/sessions/{id}`).
 *
 * THE STATES, one screen each: `loading` (nothing cached yet), `signed_out`, `no_report`
 * (signed in, the machine has sent no report), `no_cards` (a report from a machine that does
 * not compute the cards yet), `error` (nothing cached and the server did not answer), and
 * `ready`, which carries `stale` when the server did not answer and a saved copy is shown.
 *
 * The first reveal set lives here too (`reveal.ts`), keyed by the report's `generated_at`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { OFFLINE_MESSAGE, type BuilderProfileResponse, type Profile, type SessionDetail } from '../data/api';
import * as cache from '../data/cache';
import { api } from '../data/client';
import type { QuotesUpload } from '../generated/quotes';
import type { ReportCoverage, ReportWrapped, WrappedCard } from '../generated/report';
import { BUILDER_PROFILE_KEY } from '../onboarding/keys';
import { NO_SOURCES, type ArtSession, type ArtSources } from './art';
import { quotesStateOf, type QuotesState } from './face';
import { parseRevealed, REVEALED_KEY, serializeRevealed } from './reveal';
import type { DeckStatus } from './story';
import {
  refusedDeck,
  SAMPLE_COVERAGE,
  SAMPLE_GENERATED_AT,
  SAMPLE_QUOTES,
  SAMPLE_SOURCES,
  SAMPLE_WRAPPED,
  SAMPLE_WRAPPED_WITH_QUOTES,
} from './sample';

export type { DeckStatus } from './story';
export { FORCEABLE, forcedState } from './story';

export interface DeckOptions {
  sample: boolean;
  sampleQuotes: boolean;
  /** DEV: every card refused. */
  sampleRefused?: boolean;
  /** DEV: one of `FORCEABLE`, so every state can be looked at without an account in it. */
  sampleState?: DeckStatus | null;
  /** DEV: labelled as a saved copy, as when the server does not answer. */
  sampleStale?: boolean;
}

export interface DeckMeta {
  generatedAt: string;
  coverage: ReportCoverage | null;
}

export interface WrappedDeckState {
  status: DeckStatus;
  wrapped: ReportWrapped | null;
  meta: DeckMeta | null;
  quotes: QuotesUpload | null;
  quotesState: QuotesState;
  sources: ArtSources;
  /** A saved copy is on screen because the server did not answer. */
  stale: boolean;
  /** Why, in the words the api layer uses, when the load failed. */
  error: string | null;
  /** The dev sample deck, labelled wherever it shows. */
  sample: boolean;
  refreshing: boolean;
  refresh: () => Promise<void>;
  revealed: ReadonlySet<WrappedCard>;
  /**
   * The reveal set for this report has been read. Nothing counts up before it has: a card
   * that started counting and then learned it had been revealed already would count twice.
   */
  revealReady: boolean;
  markRevealed: (id: WrappedCard) => void;
}

/** Sessions the art reads from the cache: the Sessions tab keeps up to 50 synced. */
const ART_SESSIONS = 200;
/** Two clocks a second apart are one session start written two ways (Z against +00:00). */
const SAME_START_MS = 1000;

function artSession(s: SessionDetail): ArtSession {
  return {
    started_at: s.started_at,
    ended_at: s.ended_at,
    attended_seconds: s.attended_seconds ?? null,
    lines: typeof s.stats?.lines_added_agent === 'number' ? s.stats.lines_added_agent : null,
    prompts: typeof s.stats?.human_prompt_count === 'number' ? s.stats.human_prompt_count : null,
  };
}

function parseBuilder(raw: string | null): BuilderProfileResponse | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as BuilderProfileResponse;
  } catch {
    // A stored blob from an older shape is dropped, not repaired (the You tab's rule).
    return null;
  }
}

function statusOf(builder: BuilderProfileResponse | null): DeckStatus | null {
  if (!builder) return null;
  const report = builder.report ?? null;
  if (!report) return 'no_report';
  const cards = report.wrapped?.cards ?? [];
  return cards.length > 0 ? 'ready' : 'no_cards';
}

/**
 * The longest session's strip: the card names the session by when it started, so find that
 * start among the sessions this phone knows (the cache first, the server's own ranking
 * second), then its detail (cached, else fetched once).
 */
async function longestStrip(
  builder: BuilderProfileResponse,
  sessions: readonly SessionDetail[],
  signedIn: boolean,
): Promise<string | null> {
  const card = builder.report?.wrapped?.cards.find((c) => c.id === 'longest_session');
  const at = card?.reason == null ? Date.parse(card?.extras.started_at ?? '') : NaN;
  if (!Number.isFinite(at)) return null;
  const near = (iso: string) => Math.abs(Date.parse(iso) - at) <= SAME_START_MS;
  const id =
    sessions.find((s) => near(s.started_at))?.id ??
    builder.corpus?.session_rank.find((r) => near(r.started_at))?.session_id ??
    null;
  if (!id) return null;
  const cached = await cache.getDetail(id);
  if (cached?.strip?.cols) return cached.strip.cols;
  if (!signedIn) return null;
  try {
    const detail = await api.session(id);
    await cache.putDetail(detail);
    return detail.strip?.cols ?? null;
  } catch {
    // The art falls back to its seeded field; the card's number does not depend on it.
    return null;
  }
}

export function useWrappedDeck(options: DeckOptions): WrappedDeckState {
  const { sample, sampleQuotes, sampleRefused = false, sampleState = null, sampleStale = false } = options;
  const [builder, setBuilder] = useState<BuilderProfileResponse | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [sessions, setSessions] = useState<SessionDetail[]>([]);
  const [strip, setStrip] = useState<string | null>(null);
  const [switchOn, setSwitchOn] = useState<boolean | null>(null);
  // Quotes come from this session's own fetch and nowhere else: never from the cache, so a
  // quote cannot outlive the owner turning quotes off while this phone was offline.
  const [quotesDoc, setQuotesDoc] = useState<QuotesUpload | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [revealed, setRevealed] = useState<ReadonlySet<WrappedCard>>(new Set());
  const [revealFor, setRevealFor] = useState<string | null>(null);
  const revealedRef = useRef<Set<WrappedCard>>(new Set());
  const reportKeyRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (sample) {
      setLoaded(true);
      return;
    }
    const [stored, cachedProfile, cachedSessions] = await Promise.all([
      cache.getKv(BUILDER_PROFILE_KEY).catch(() => null),
      cache.getProfile().catch(() => null),
      cache.listSessions(ART_SESSIONS).catch(() => [] as SessionDetail[]),
    ]);
    let current = parseBuilder(stored);
    if (current) setBuilder(current);
    if (cachedProfile) setProfile(cachedProfile);
    setSessions(cachedSessions);

    const isIn = await api.isSignedIn().catch(() => false);
    setSignedIn(isIn);
    if (!isIn) {
      setLoaded(true);
      return;
    }

    try {
      const fresh = await api.builderProfile();
      current = fresh;
      setBuilder(fresh);
      setQuotesDoc(fresh.quotes ?? null);
      setError(null);
      // Saved without the quotes: the cached copy never holds a word the owner typed.
      await cache.setKv(BUILDER_PROFILE_KEY, JSON.stringify({ ...fresh, quotes: undefined }));
    } catch (e) {
      setError(e instanceof Error ? e.message : OFFLINE_MESSAGE);
    }
    try {
      setSwitchOn((await api.privacyPrefs()).quotes);
    } catch {
      // A server older than the prefs route: the switch is unknown, which reads as off.
      setSwitchOn(null);
    }
    if (!cachedProfile) {
      try {
        const p = await api.profile();
        setProfile(p);
        await cache.putProfile(p);
      } catch {
        // The time card's header falls back to its seeded field.
      }
    }
    setLoaded(true);
    if (current) setStrip(await longestStrip(current, cachedSessions, isIn));
  }, [sample]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const sampleDeck = useMemo(
    () =>
      sampleState === 'no_cards'
        ? { ...SAMPLE_WRAPPED, cards: [] }
        : sampleRefused
          ? refusedDeck()
          : sampleQuotes
            ? SAMPLE_WRAPPED_WITH_QUOTES
            : SAMPLE_WRAPPED,
    [sampleState, sampleRefused, sampleQuotes],
  );
  const wrapped = sample ? sampleDeck : (builder?.report?.wrapped ?? null);
  const sampleHasReport = sampleState === null || sampleState === 'no_cards' || sampleState === 'error';
  const meta: DeckMeta | null = sample
    ? sampleHasReport
      ? { generatedAt: SAMPLE_GENERATED_AT, coverage: SAMPLE_COVERAGE }
      : null
    : builder?.report
      ? { generatedAt: builder.report.generated_at, coverage: builder.report.coverage ?? null }
      : null;
  const quotes = sample ? (sampleQuotes ? SAMPLE_QUOTES : null) : quotesDoc;
  const quotesState: QuotesState = sample ? (sampleQuotes ? 'shown' : 'off') : quotesStateOf(quotes, switchOn);

  const sources = useMemo<ArtSources>(() => {
    if (sample) return SAMPLE_SOURCES;
    if (!builder) return NO_SOURCES;
    const days = builder.report?.contributions?.days ?? null;
    return {
      graph: profile?.graph ?? null,
      commitDays: days ? days.map((d) => ({ day: d.day, commits: d.assisted + d.alone })) : null,
      windowEnd: builder.report?.generated_at ?? null,
      sessions: sessions.length > 0 ? sessions.map(artSession) : null,
      longestStrip: strip,
    };
  }, [sample, builder, profile, sessions, strip]);

  // The first reveal set, per report: loaded when the report is known, saved as it grows.
  const reportKey = sample ? null : (meta?.generatedAt ?? null);
  useEffect(() => {
    reportKeyRef.current = reportKey;
    if (reportKey === null) {
      revealedRef.current = new Set();
      setRevealed(new Set());
      return;
    }
    let live = true;
    cache
      .getKv(REVEALED_KEY)
      .catch(() => null)
      .then((raw) => {
        if (!live) return;
        const set = parseRevealed(raw, reportKey);
        revealedRef.current = set;
        setRevealed(new Set(set));
        setRevealFor(reportKey);
      });
    return () => {
      live = false;
    };
  }, [reportKey]);

  const markRevealed = useCallback((id: WrappedCard) => {
    if (revealedRef.current.has(id)) return;
    revealedRef.current.add(id);
    setRevealed(new Set(revealedRef.current));
    const key = reportKeyRef.current;
    // The sample deck reveals every time it opens: it is for looking at, and remembering it
    // would make the second screenshot differ from the first.
    if (key !== null) void cache.setKv(REVEALED_KEY, serializeRevealed(key, revealedRef.current)).catch(() => {});
  }, []);

  let status: DeckStatus;
  if (sample) status = sampleState ?? 'ready';
  else if (!loaded && !builder) status = 'loading';
  else status = statusOf(builder) ?? (signedIn === false ? 'signed_out' : error !== null ? 'error' : 'loading');

  return {
    status,
    wrapped,
    meta,
    quotes,
    quotesState,
    sources,
    stale: sample ? sampleStale : builder !== null && error !== null,
    error: sample ? (sampleState === 'error' ? OFFLINE_MESSAGE : null) : error,
    sample,
    refreshing,
    refresh,
    revealed,
    revealReady: sample || (reportKey !== null && revealFor === reportKey),
    markRevealed,
  };
}
