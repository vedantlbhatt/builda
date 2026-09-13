import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, useWindowDimensions, View } from 'react-native';

import { AnalysisView } from '../../src/analysis/AnalysisView';
import { clock } from '../../src/copy/numbers';
import { describeEnd } from '../../src/analysis/format';
import { heading, renderable } from '../../src/session/feedback';
import { headline, RecapCard, toCardModel } from '../../src/card/RecapCard';
import { shareCard } from '../../src/card/export';
import { ApiError, OFFLINE_MESSAGE, type FeedItem, type SessionDetail } from '../../src/data/api';
import * as cache from '../../src/data/cache';
import { api, SAMPLE_SESSION } from '../../src/data/client';
import { LiveBar } from '../../src/live/LiveBar';
import { LIVE_REFRESH_MS } from '../../src/live/LiveSessions';
import { etaDetail } from '../../src/live/mission';
import { RecapSheet } from '../../src/recap/RecapSheet';
import { BurnSection } from '../../src/session/BurnSection';
import { burnCoversTokens, burnView } from '../../src/session/burnView';
import { DecisionList } from '../../src/session/DecisionList';
import { decisionRows } from '../../src/session/decisions';
import { sessionLinks } from '../../src/session/links';
import { resolveSessionLoad, type LoadFailure } from '../../src/session/load';
import { parseSampleVariant, sampleOutcome, type SampleVariant } from '../../src/session/samples';
import { SessionLinks } from '../../src/session/SessionLinks';
import { SessionError, SessionMissing, SessionSignedOut, SessionSkeleton, StaleLine } from '../../src/session/SessionStates';
import { summaryParagraph, titleBesideCard } from '../../src/session/summary';
import { TitleLine } from '../../src/session/TitleLine';
import { detailAfterPost } from '../../src/social/composeFlow';
import { visibilityLabel } from '../../src/social/format';
import { PixelBadge } from '../../src/pixel/PixelBadge';
import { classShare, decodeColumns } from '../../src/strip/decode';
import { StripClass } from '../../src/generated/strip';
import { colors, compactNumber, layout, space } from '../../src/theme';
import { Button, SHAPE, Section, StatGrid, Surface, T, type StatItem } from '../../src/ui';

const c = colors('dark');

/**
 * The viewer's own post for this session, from the id the detail carries. `post_id` is the
 * server's answer for ANY visibility — a private post too, which `is_shared` deliberately
 * leaves down — and null when there is none. The row itself (visibility, Delete) comes
 * from GET /v1/posts/{id}. A server older than the field omits it; then `is_shared` alone
 * decides, and the row reads "posted" without a Delete.
 */
function sharedFromDetail(s: SessionDetail): boolean {
  if (s.post_id === undefined) return s.is_shared;
  return s.post_id !== null;
}

/** The short code printed on the card: the sample's own, else the id's first six. */
function shortCode(id: string): string {
  return id === 'sample' ? 'builder.dev/s/sample' : `builder.dev/s/${id.slice(0, 6)}`;
}

/** What a thrown load says, as `load.ts` reads it. Status -1 is neither the phone nor the server. */
function failureOf(e: unknown): LoadFailure {
  if (e instanceof ApiError) return { status: e.status, message: e.message };
  return { status: -1, message: e instanceof Error ? e.message : 'Something went wrong on the way.' };
}

function SessionScreenInner({ id, recap, variant }: { id: string; recap?: string; variant: SampleVariant }) {
  const { width } = useWindowDimensions();
  const router = useRouter();
  const [session, setSession] = useState<SessionDetail | null>(null);
  // The last load's failure, null when it worked or has not finished. With a session on
  // screen it makes the page STALE (one line at the top); without one it is the page.
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [sharing, setSharing] = useState(false);
  const [recapOpen, setRecapOpen] = useState(false);
  const [post, setPost] = useState<FeedItem | null>(null);
  // Whether a post exists for this session, as far as the phone knows: seeded from the
  // server's `is_shared` (true for a followers/public post; a private post leaves it
  // down), raised by a 409 "already shared", lowered by Delete. `post` is the row itself
  // when this mount composed it or the lookup below found it.
  const [shared, setShared] = useState(false);
  const [looking, setLooking] = useState(false);
  const [lookupFailed, setLookupFailed] = useState(false);
  const cardRef = useRef(null);

  // The last detail load could not reach the server. The screen renders from the cache
  // and the recap says why Post is off, rather than failing at the tap. Only a transport
  // failure means "offline": a 404 or a 500 is the server answering.
  const offline = failure?.status === 0;
  const model = useMemo(() => (session ? toCardModel(session, shortCode(id)) : null), [session, id]);

  const load = useCallback(async () => {
    const show = (s: SessionDetail) => {
      setSession(s);
      setShared(sharedFromDetail(s));
    };
    if (id === 'sample') {
      const out = sampleOutcome(SAMPLE_SESSION, variant, Date.now(), OFFLINE_MESSAGE);
      if (out.session) show(out.session);
      setFailure(out.failure);
      return;
    }
    const cached = await cache.getDetail(id);
    if (cached) show(cached);
    try {
      const fresh = await api.session(id);
      // The cache is a convenience: failing to write it is not failing to load.
      await cache.putDetail(fresh).catch(() => undefined);
      show(fresh);
      setFailure(null);
    } catch (e) {
      setFailure(failureOf(e));
    }
  }, [id, variant]);

  useEffect(() => {
    void load();
  }, [load]);

  // A running session re-reads itself on the live list's own beat (`LIVE_REFRESH_MS`, one
  // constant for every live screen) while its screen is open, so the live bar and the
  // decisions never trail the list this was opened from.
  const running = (session?.state ?? 'final') === 'live';
  useEffect(() => {
    if (!running || id === 'sample') return;
    const timer = setInterval(() => void load(), LIVE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [running, id, load]);

  // A session posted on a previous visit, after a restart, or from another device: the
  // detail names the post and this mount does not hold it. Load the row, so it can carry
  // its visibility and Delete rather than "Post to the feed" and a 409.
  const postId = session?.post_id ?? null;
  useEffect(() => {
    if (!postId || post?.id === postId || !id || id === 'sample') return;
    let cancelled = false;
    setLooking(true);
    setLookupFailed(false);
    api
      .post(postId)
      .then((found) => {
        if (!cancelled) setPost(found);
      })
      .catch(() => {
        // The row still says "posted"; only the Delete is missing, and the feed has it.
        if (!cancelled) setLookupFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLooking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [postId, post, id]);

  // `?recap=1` — a tapped completion push, the Mac's link, the list's chip — raises the
  // recap once the session is here and, when it has a post, once that post is here too,
  // so the sheet opens as an editor rather than posting twice. Once per mount: closing
  // it must not reopen it on the next render.
  const autoOpened = useRef(false);
  const postPending = Boolean(postId) && post?.id !== postId && !lookupFailed;
  useEffect(() => {
    if (recap !== '1' || autoOpened.current || !session || id === 'sample') return;
    if ((session.state ?? 'final') !== 'final') return;
    if (postPending) return;
    autoOpened.current = true;
    setRecapOpen(true);
  }, [recap, session, id, postPending]);

  const contentWidth = width - layout.gutter * 2;
  const loadState = resolveSessionLoad(session, failure);

  const scrollStyle = { flex: 1, backgroundColor: c.bg } as const;
  const contentStyle = {
    paddingHorizontal: layout.gutter,
    paddingTop: space.md,
    paddingBottom: space.xxl,
    gap: layout.sectionGap,
  } as const;

  if (loadState.kind !== 'ready' || !model) {
    const retry = () => {
      setFailure(null);
      void load();
    };
    return (
      <ScrollView style={scrollStyle} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={contentStyle}>
        {loadState.kind === 'missing' ? (
          <SessionMissing onBack={() => (router.canGoBack() ? router.back() : router.replace('/sessions'))} />
        ) : loadState.kind === 'signedOut' ? (
          <SessionSignedOut onSignIn={() => router.push('/settings')} />
        ) : loadState.kind === 'error' ? (
          <SessionError message={loadState.message} onRetry={retry} />
        ) : (
          <SessionSkeleton width={contentWidth} />
        )}
      </ScrollView>
    );
  }

  const s = loadState.session;
  const share = model.strip ? classShare(decodeColumns(model.strip)) : null;

  // Boundary fields are optional on read: an older server omits them, and the row is
  // skipped rather than shown as "0s / 0s".
  const state = s.state ?? 'final';
  const hasSplit = s.attended_seconds !== undefined || s.autonomous_seconds !== undefined;
  const endNote = describeEnd(s);
  // Only the notes THIS build can render. An id it does not know renders nothing rather
  // than "went_nowhere: 3", which reads as a bug and says less than silence.
  const notes = renderable(s.feedback);
  const noteHeading = heading(notes);

  // The words under the card. A harness title the card already shows as its headline is
  // not said twice.
  const shownTitle = titleBesideCard(s, headline(model));
  const paragraph = summaryParagraph(s);
  const burn = burnView(s);
  const decisions = decisionRows(s.live_state?.decisions, s.started_at);
  const etaNote = state === 'live' ? etaDetail(s.live_state?.eta) : null;
  const links = sessionLinks(s, id === 'sample' && variant !== 'final' ? variant : undefined);

  /** A post landed, from either sheet: remember it, then show it. */
  const landed = (p: FeedItem, thenOpen: boolean) => {
    setPost(p);
    setShared(true);
    setRecapOpen(false);
    const next = detailAfterPost(s, p);
    setSession(next);
    void cache.putDetail(next).catch(() => undefined);
    if (thenOpen) router.push(`/post/${p.id}`);
  };

  /**
   * A private post, or one made between the detail load and now: the server says it
   * exists. Switch to the posted state and re-read the detail for its id, which the
   * lookup above turns into the row.
   */
  const alreadyPosted = () => {
    setShared(true);
    setRecapOpen(false);
    if (id && id !== 'sample') {
      void api
        .session(id)
        .then(async (fresh) => {
          setSession(fresh);
          await cache.putDetail(fresh);
        })
        .catch(() => undefined);
    }
  };

  // Every number the session has, as one 3-up grid. Absent, not zero: a token count the
  // editor never wrote is a refusal sentence, and commits are dropped when there were none.
  // A running session's status is the live bar's to say, at the top, not a cell here.
  // Durations here are exact (`copy.clock`, the CLI's numbers block rule): the paragraph
  // rounds to the minute and the card floors, and a cell must read true beside both.
  const numbers: StatItem[] = [];
  numbers.push({ value: clock(model.activeSeconds), label: 'active' });
  if (hasSplit) {
    numbers.push({ value: clock(s.attended_seconds ?? 0), label: 'attended' });
    numbers.push({ value: clock(s.autonomous_seconds ?? 0), label: 'autonomous' });
  }
  numbers.push({ value: clock(model.wallSeconds), label: 'elapsed' });
  numbers.push({ value: `${model.prompts}`, label: 'prompts' });
  numbers.push({ value: `${model.filesTouched}`, label: 'files touched' });
  numbers.push({ value: model.agentLines.toLocaleString(), label: 'agent lines' });
  if (model.commits > 0) numbers.push({ value: `${model.commits}`, label: 'commits' });
  // Cursor accounts usage server-side and writes {0,0} locally, so a "0" here would be a
  // claim about the session rather than about Cursor. When the burn section above already
  // says this session's tokens (the same figure, or the only one there is), it is not said a
  // third time here; when the two counts differ, both stay and the note there says why.
  if (!burnCoversTokens(burn)) {
    numbers.push(
      model.tokensReported
        ? { value: compactNumber(model.totalTokens), label: 'tokens' }
        : { value: null, label: 'tokens', refusal: 'not recorded by this editor' }
    );
  }

  return (
    <ScrollView style={scrollStyle} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={contentStyle}>
      {loadState.stale ? <StaleLine text={loadState.stale} /> : null}

      {/* A running session opens on the bar that mirrors its Lock Screen card
          (DESIGN-DIRECTION 7.1, Flighty's cross-surface rule). The bar's ring is a dotted
          track when there is no ETA; the reason is said under it, a sentence from the data. */}
      {state === 'live' ? (
        <View style={{ gap: space.sm }}>
          <LiveBar session={s} />
          {etaNote ? (
            <T role="meta" tone="dim">
              {etaNote}
            </T>
          ) : null}
        </View>
      ) : null}

      <View style={{ gap: space.md }}>
        {/* The card, rendered at the width it will be captured at. Live preview rather than
            a separate "export" path: what you see is literally the view that gets captured.
            Share cards take the 28pt corner (DESIGN-DIRECTION 3.4). */}
        <View
          ref={cardRef}
          collapsable={false}
          style={{ borderRadius: SHAPE.wrapped, borderCurve: 'continuous', overflow: 'hidden' }}
        >
          <RecapCard model={model} width={contentWidth} />
        </View>

        {/* The key to the card's strip, directly under it and outside the captured view: a
            route map does not explain its own encoding, the page around it does. There used
            to be a second, larger strip in a Timeline section below; it drew the same session
            at a different column width, so the two shapes disagreed on one screen. */}
        {model.strip ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: space.md, rowGap: space.sm }}>
            <LegendItem klass={StripClass.prompting} label="you prompting" share={share} />
            <LegendItem klass={StripClass.agent} label="agent working" share={share} />
            <LegendItem klass={StripClass.human_edit} label="your edits" share={share} />
            <LegendItem klass={StripClass.idle} label="idle" share={share} />
          </View>
        ) : (
          <T role="meta" tone="dim">
            This session predates the detail your editor keeps. Its hours still count.
          </T>
        )}

        {/* What happened, in words, before the actions and before any grid: the engineer
            voice title and the plain English paragraph (roadmap 1.4 and 1.5). */}
        <TitleLine title={shownTitle} paragraph={paragraph} />

        {/* Sharing to the feed is an act, never automatic, and only for a finished session:
            a live card's numbers keep moving and a recap that moves is not a recap. */}
        {state === 'final' && id !== 'sample' && (
          post ? (
            <Surface style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg, paddingVertical: 0 }}>
              <T role="row" style={{ flex: 1, paddingVertical: space.tile }}>
                Posted · {visibilityLabel(post.visibility)}
              </T>
              <Button kind="secondary" size="compact" block={false} label="Edit" onPress={() => setRecapOpen(true)} />
              <Button
                kind="secondary"
                destructive
                size="compact"
                block={false}
                label="Delete"
                onPress={() =>
                  Alert.alert('Delete post?', 'It disappears from every feed immediately.', [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete',
                      style: 'destructive',
                      onPress: async () => {
                        try {
                          await api.deletePost(post.id);
                          setPost(null);
                          setShared(false);
                          // Forget the id too, or the loader above would fetch a deleted post.
                          setSession((cur) => (cur ? { ...cur, post_id: null, is_shared: false } : cur));
                          // The cached detail is what the next visit shows first.
                          void cache.putDetail({ ...s, post_id: null, is_shared: false }).catch(() => undefined);
                        } catch (e) {
                          Alert.alert('Could not delete', e instanceof Error ? e.message : 'try again');
                        }
                      },
                    },
                  ])
                }
              />
            </Surface>
          ) : shared ? (
            // The post exists but this mount does not hold it (an older server sent no id, or
            // the row failed to load). Never offer to post again: the server would answer
            // 409. The feed is where the post, and its Delete, live.
            <Surface style={{ flexDirection: 'row', alignItems: 'center', gap: space.lg, paddingVertical: 0 }}>
              <T role="row" style={{ flex: 1, paddingVertical: space.tile }}>
                Posted to the feed
              </T>
              {looking ? (
                <ActivityIndicator color={c.accent} />
              ) : (
                <Button kind="secondary" size="compact" block={false} label="Open feed" onPress={() => router.push('/feed')} />
              )}
            </Surface>
          ) : (
            // The recap: title, tiles, analysis, photos, then Post. What a tapped completion
            // push opens, reachable here for everyone else.
            <View style={{ gap: space.sm }}>
              <Button
                label="Post to the feed"
                accessibilityHint="Photos, a caption, and who sees it"
                onPress={() => setRecapOpen(true)}
              />
              <T role="meta" tone="dim">
                Photos, a caption, and who sees it.
              </T>
            </View>
          )
        )}

        {/* Exporting the card as an image and posting it to the feed are different acts, and
            calling both of them "share" made the screen read as three buttons for one thing.
            The image export is the quiet one: it names the file it produces. Exporting a
            share card is a commitment, so it lands with the medium tap. */}
        <Button
          kind="secondary"
          size="compact"
          label="Save this card as an image"
          busy={sharing}
          busyLabel="Preparing the image…"
          haptic="commit"
          onPress={async () => {
            setSharing(true);
            try {
              await shareCard(cardRef, model);
            } finally {
              setSharing(false);
            }
          }}
        />
      </View>

      <RecapSheet
        visible={recapOpen}
        session={s}
        post={post}
        offline={offline}
        onClose={() => setRecapOpen(false)}
        onPosted={(p) => landed(p, true)}
        onAlreadyPosted={alreadyPosted}
        onRetryConnection={() => void load()}
      />

      {/* Where the tokens went: the burn block's numbers, then its costliest stretches, or
          its refusal as a sentence. The sentences about the whole session are the
          paragraph's, above; this is the evidence under them. */}
      <BurnSection view={burn} />

      {/* The hard to undo things the agent did, from the live engine while it runs. */}
      <DecisionList rows={decisions} />

      {/* The map and the time lapse, each only when its data is on this session. */}
      <SessionLinks links={links} />

      <Section label="Numbers">
        <Surface>
          <StatGrid items={numbers} />
        </Surface>
        {endNote && (
          <T role="meta" tone="dim">
            {endNote}
          </T>
        )}
      </Section>

      {/* WHERE THE TIME WENT THAT YOU WOULD NOT HAVE CHOSEN. Above the analysis on
          purpose: the analysis is a reading of the session, and this is a measurement of
          it. Silent when the sitting had nothing worth saying, which is most of them
          (MEASURED on this container, 5 of 17). A card that flags something every session
          is a card people stop reading. */}
      {notes.length > 0 && (
        <Section label={noteHeading ?? 'Worth a look'}>
          <Surface style={{ gap: space.tile }}>
            {notes.map((n) => (
              <T key={n.id} role="body">
                {n.text}
              </T>
            ))}
          </Surface>
          <T role="meta" tone="dim">
            Measured on your machine. The command that kept failing and the file that was
            rewritten stay there; only the counts travel.
          </T>
        </Section>
      )}

      {s.analysis ? (
        // A running session's checkpoint analysis keeps its sprite still: the live bar's
        // creature is the one that may move on this screen.
        <AnalysisView analysis={s.analysis} still={state === 'live'} />
      ) : (
        <Section label="Analysis">
          <Surface>
            {state === 'final' ? (
              // Quiet, and no mascot: nothing is coming. A final session without an analysis
              // will not grow one by waiting, and a thinking Bit would promise otherwise.
              <T role="meta" tone="dim">
                Analysis not available for this session
              </T>
            ) : (
              // Still, not thinking: the live bar at the top carries this screen's one
              // animating creature (DESIGN-DIRECTION 3.5).
              <PixelBadge state="thinking" text="Analysis runs when the session ends" paused style={{ padding: 0 }} />
            )}
          </Surface>
        </Section>
      )}
    </ScrollView>
  );
}

function LegendItem({
  klass,
  label,
  share,
}: {
  klass: StripClass;
  label: string;
  share: Record<StripClass, number> | null;
}) {
  // A percentage that rounds to zero reads as "this never happened". Ten typed prompts
  // inside 72 minutes really are under half a percent of the strip, so the legend says
  // "under 1%" rather than claiming none.
  const raw = share ? share[klass] * 100 : null;
  const pct = raw === null ? null : raw > 0 && raw < 1 ? '<1' : String(Math.round(raw));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
      {/* A strip segment in small: a capsule of the class colour. */}
      <View
        style={{
          width: space.md,
          height: space.sm,
          borderRadius: SHAPE.action,
          borderCurve: 'continuous',
          backgroundColor: c.strip[klass],
        }}
      />
      <T role="meta" tone="dim">
        {label}
        {pct !== null ? ` ${pct}%` : ''}
      </T>
    </View>
  );
}

/**
 * One mount per session id. A deep link to ANOTHER session while this screen is focused
 * makes expo-router replace the params in place (StackRouter resolves NAVIGATE to the
 * focused route of the same name), which carried session A's post, drafts and recap
 * latch onto session B — Delete on A's post from B's screen. Keying on the id makes it a
 * fresh mount. Found by review; every in-app path already pushes a new screen.
 *
 * `variant` opens the built in sample in one of its states (`src/session/samples.ts`), in
 * dev builds only: a release build always shows the finished sample.
 */
export default function SessionScreen() {
  const { id, recap, variant } = useLocalSearchParams<{ id: string; recap?: string; variant?: string }>();
  const which = id === 'sample' && __DEV__ ? parseSampleVariant(variant) : 'final';
  return <SessionScreenInner key={`${id ?? 'none'}:${which}`} id={id ?? ''} recap={recap} variant={which} />;
}
