import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, useWindowDimensions, View } from 'react-native';

import { toCardModel } from '../../src/card/RecapCard';
import { shareCard } from '../../src/card/export';
import { ApiError, OFFLINE_MESSAGE, type FeedItem, type SessionDetail } from '../../src/data/api';
import * as cache from '../../src/data/cache';
import { api, SAMPLE_SESSION } from '../../src/data/client';
import { crewFor, LIVE_REFRESH_MS } from '../../src/live/LiveSessions';
import { etaDetail } from '../../src/live/mission';
import { RecapSheet } from '../../src/recap/RecapSheet';
import { crewBase } from '../../src/session/crew';
import { resolveSessionLoad, type LoadFailure } from '../../src/session/load';
import { parseSampleVariant, sampleOutcome, type SampleVariant } from '../../src/session/samples';
import { SessionFrame, SessionPage } from '../../src/session/SessionPage';
import { SessionError, SessionMissing, SessionSignedOut, SessionSkeleton } from '../../src/session/SessionStates';
import type { PostState } from '../../src/session/Share';
import { useCrewAround } from '../../src/session/useCrew';
import { detailAfterPost } from '../../src/social/composeFlow';
import { visibilityLabel } from '../../src/social/format';

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

/**
 * The session page's data: the detail (saved copy first, then the server), its live re-read, the
 * post it may have and the recap a push asks for. The page itself, chapter by chapter, is
 * `src/session/SessionPage.tsx`.
 */
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
  const cardRef = useRef<View | null>(null);
  // The sessions this one's creature is stepped against: the saved list, read once.
  const around = useCrewAround();

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

  // `?recap=1` — a tapped completion push, the Mac's link, the list's word — raises the
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

  const loadState = resolveSessionLoad(session, failure);

  // The hero is painted in the session's creature's hue, so it waits for the one read that
  // decides which creature that is (the sample wears its own; it is never in the saved list).
  if (loadState.kind !== 'ready' || !model || (id !== 'sample' && around === null)) {
    const retry = () => {
      setFailure(null);
      void load();
    };
    if (loadState.kind === 'loading' || loadState.kind === 'ready') {
      return (
        <SessionFrame padded={false}>
          <SessionSkeleton width={width} />
        </SessionFrame>
      );
    }
    return (
      <SessionFrame>
        {loadState.kind === 'missing' ? (
          <SessionMissing onBack={() => (router.canGoBack() ? router.back() : router.replace('/sessions'))} />
        ) : loadState.kind === 'signedOut' ? (
          <SessionSignedOut onSignIn={() => router.push('/settings')} />
        ) : (
          <SessionError message={loadState.message} onRetry={retry} />
        )}
      </SessionFrame>
    );
  }

  const s = loadState.session;
  const state = s.state ?? 'final';
  // Mission control's rule over the saved list, through its memory: the creature this session
  // was first drawn in, on the Now grid, in the list or here, and the same one after.
  const creature =
    id === 'sample'
      ? crewBase(s.client_session_id)
      : (crewFor([...(around ?? []).filter((r) => r.id !== s.id), s]).get(s.id) ?? crewBase(s.client_session_id || s.id));
  const postState: PostState =
    state !== 'final' || id === 'sample'
      ? { kind: 'none' }
      : post
        ? { kind: 'posted', visibility: visibilityLabel(post.visibility) }
        : shared
          ? { kind: 'shared', looking }
          : { kind: 'unposted' };

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

  const deletePost = () => {
    if (!post) return;
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
    ]);
  };

  const saveImage = async () => {
    setSharing(true);
    try {
      await shareCard(cardRef, model);
    } finally {
      setSharing(false);
    }
  };

  return (
    <>
      <SessionPage
        session={s}
        creature={creature}
        stale={loadState.stale}
        sampleVariant={id === 'sample' && variant !== 'final' ? variant : undefined}
        etaNote={state === 'live' ? etaDetail(s.live_state?.eta) : null}
        card={model}
        cardRef={cardRef}
        post={postState}
        saving={sharing}
        onPost={() => setRecapOpen(true)}
        onEdit={() => setRecapOpen(true)}
        onDelete={deletePost}
        onOpenFeed={() => router.push('/feed')}
        onSave={() => void saveImage()}
      />
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
    </>
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
