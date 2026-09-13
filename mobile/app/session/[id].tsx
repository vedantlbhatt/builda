import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, useWindowDimensions, View } from 'react-native';

import { AnalysisView } from '../../src/analysis/AnalysisView';
import { describeEnd } from '../../src/analysis/format';
import { heading, renderable } from '../../src/session/feedback';
import { RecapCard, toCardModel, type CardModel } from '../../src/card/RecapCard';
import { shareCard } from '../../src/card/export';
import { ApiError, type FeedItem, type SessionDetail } from '../../src/data/api';
import * as cache from '../../src/data/cache';
import { api, SAMPLE_SESSION } from '../../src/data/client';
import { RecapSheet } from '../../src/recap/RecapSheet';
import { detailAfterPost } from '../../src/social/composeFlow';
import { visibilityLabel } from '../../src/social/format';
import { PixelBadge } from '../../src/pixel/PixelBadge';
import { classShare, decodeColumns } from '../../src/strip/decode';
import { StripClass } from '../../src/generated/strip';
import { colors, compactNumber, duration, layout, space } from '../../src/theme';
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

function SessionScreenInner({ id, recap }: { id: string; recap?: string }) {
  const { width } = useWindowDimensions();
  const router = useRouter();
  const [model, setModel] = useState<CardModel | null>(null);
  const [session, setSession] = useState<SessionDetail | null>(null);
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
  // The last detail load could not reach the server. The screen renders from the cache
  // and the recap says why Post is off, rather than failing at the tap.
  const [offline, setOffline] = useState(false);
  const cardRef = useRef(null);

  const load = useCallback(async () => {
    const show = (s: SessionDetail, code: string) => {
      setSession(s);
      setModel(toCardModel(s, code));
      setShared(sharedFromDetail(s));
    };
    if (id === 'sample') {
      show(SAMPLE_SESSION, 'builder.dev/s/sample');
      return;
    }
    const cached = await cache.getDetail(id!);
    if (cached) show(cached, `builder.dev/s/${id!.slice(0, 6)}`);
    try {
      const fresh = await api.session(id!);
      await cache.putDetail(fresh);
      show(fresh, `builder.dev/s/${id!.slice(0, 6)}`);
      setOffline(false);
    } catch (e) {
      // Offline with a cached copy is fine; offline without one shows the spinner. Only
      // a transport failure means "offline" — a 404 or a 500 is the server answering.
      setOffline(e instanceof ApiError && e.status === 0);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

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

  if (!model || !session) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: c.bg, paddingHorizontal: layout.gutter }}>
        <PixelBadge state="thinking" text="Reading your session…" style={{ paddingHorizontal: 0 }} />
      </View>
    );
  }

  const contentWidth = width - layout.gutter * 2;
  const share = model.strip ? classShare(decodeColumns(model.strip)) : null;

  // Boundary fields are optional on read: an older server omits them, and the row is
  // skipped rather than shown as "0s / 0s".
  const state = session.state ?? 'final';
  const hasSplit = session.attended_seconds !== undefined || session.autonomous_seconds !== undefined;
  const endNote = describeEnd(session);
  // Only the notes THIS build can render. An id it does not know renders nothing rather
  // than "went_nowhere: 3", which reads as a bug and says less than silence.
  const notes = renderable(session.feedback);
  const noteHeading = heading(notes);

  /** A post landed, from either sheet: remember it, then show it. */
  const landed = (p: FeedItem, thenOpen: boolean) => {
    setPost(p);
    setShared(true);
    setRecapOpen(false);
    const next = detailAfterPost(session, p);
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
  const numbers: StatItem[] = [];
  if (state === 'live') numbers.push({ value: 'Live', label: 'status' });
  numbers.push({ value: duration(model.activeSeconds), label: 'active' });
  if (hasSplit) {
    numbers.push({ value: duration(session.attended_seconds ?? 0), label: 'attended' });
    numbers.push({ value: duration(session.autonomous_seconds ?? 0), label: 'autonomous' });
  }
  numbers.push({ value: duration(model.wallSeconds), label: 'elapsed' });
  numbers.push({ value: `${model.prompts}`, label: 'prompts' });
  numbers.push({ value: `${model.filesTouched}`, label: 'files touched' });
  numbers.push({ value: model.agentLines.toLocaleString(), label: 'agent lines' });
  if (model.commits > 0) numbers.push({ value: `${model.commits}`, label: 'commits' });
  // Cursor accounts usage server-side and writes {0,0} locally, so a "0" here would be a
  // claim about the session rather than about Cursor.
  numbers.push(
    model.tokensReported
      ? { value: compactNumber(model.totalTokens), label: 'tokens' }
      : { value: null, label: 'tokens', refusal: 'not recorded by this editor' }
  );

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.bg }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        paddingHorizontal: layout.gutter,
        paddingTop: space.md,
        paddingBottom: space.xxl,
        gap: layout.sectionGap,
      }}
    >
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
                          void cache.putDetail({ ...session, post_id: null, is_shared: false }).catch(() => undefined);
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
        session={session}
        post={post}
        offline={offline}
        onClose={() => setRecapOpen(false)}
        onPosted={(p) => landed(p, true)}
        onAlreadyPosted={alreadyPosted}
        onRetryConnection={() => void load()}
      />

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

      {session.analysis ? (
        <AnalysisView analysis={session.analysis} />
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
              <PixelBadge state="thinking" text="Analysis runs when the session ends" style={{ padding: 0 }} />
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
 */
export default function SessionScreen() {
  const { id, recap } = useLocalSearchParams<{ id: string; recap?: string }>();
  return <SessionScreenInner key={id ?? 'none'} id={id ?? ''} recap={recap} />;
}
