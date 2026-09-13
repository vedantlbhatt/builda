import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';

import { CELEBRATION_MS } from '../analysis/AnalysisView';
import { labelize } from '../analysis/format';
import { ApiError, type FeedItem, type SessionDetail, type Visibility } from '../data/api';
import { api } from '../data/client';
import { PixelBadge } from '../pixel/PixelBadge';
import {
  CAPTION_MAX,
  planMedia,
  primaryAction,
  publishCaption,
} from '../social/composeFlow';
import { isAlreadySharedConflict, VISIBILITIES, visibilityLabel } from '../social/format';
import { MAX_PHOTOS, type PickedPhoto, type RecordedAudio } from '../social/media';
import { MediaPicker } from '../social/MediaPicker';
import { PhotoGrid } from '../social/PhotoGrid';
import { UploadList } from '../social/UploadLine';
import { useUploadFlow } from '../social/useUploadFlow';
import { decodeMarks } from '../strip/decode';
import { TimelineStrip } from '../strip/TimelineStrip';
import { dayLabel, layout, space, TAP_TARGET } from '../theme';
import { Button, haptics, Row, SHAPE, Section, Stat, StatGrid, Surface, SymbolIcon, T, TextField, useColors } from '../ui';
import { analysisEmptyCopy, defaultTitle, postBlocker, recapHeadline, statTiles } from './format';


/**
 * Strava's post-activity page, for a build session.
 *
 * Opens over the detail on `?recap=1` (a tapped completion push, the Mac's link, a share
 * sheet) and from "Finish & share". Top to bottom: the strip hero, an editable title, the
 * stat tiles, the analysis headline with Bit cheering for three seconds, photos and a
 * voice note, who can see it, a caption, then Post and Save privately.
 *
 * With an existing post (`post`) the sheet is an editor: caption and visibility PATCH to
 * the post, and photos or a voice note can still be added while the post has room —
 * the media routes attach to any post you own. Photos already on the post cannot be
 * removed here; the post screen owns that. The title field is hidden in this mode: the
 * server has no title on a post, so on creation it became the caption's first line.
 *
 * Two phases, like the compose sheet: the form, then the upload list, shared through
 * `useUploadFlow`. Post creates the row first — the post exists the moment the server
 * answers, media or not.
 */
export function RecapSheet({
  visible,
  session,
  post,
  offline,
  onClose,
  onPosted,
  onAlreadyPosted,
  onRetryConnection,
}: {
  visible: boolean;
  session: SessionDetail;
  /** The viewer's existing post for this session, when there is one: edit mode. */
  post: FeedItem | null;
  /** The detail could not reach the server on its last load; the sheet renders from cache. */
  offline: boolean;
  onClose: () => void;
  /** The post landed, with its media where uploads succeeded. */
  onPosted: (post: FeedItem) => void;
  /** The server answered 409 "already shared": the session has a post this sheet cannot see. */
  onAlreadyPosted: () => void;
  /** Re-read the detail; clears `offline` when the server answers. */
  onRetryConnection: () => void;
}) {
  const { width } = useWindowDimensions();
  const c = useColors();
  // The post this opening started from. Derived live from the prop, `editing` flipped
  // to "Edit post" mid-typing when a fresh detail and its post lookup landed (a post made
  // on another device) — the title field vanished with its text and Save would have
  // PATCHed the other device's caption. Latched at open, until the sheet closes.
  const [shown, setShown] = useState(post);
  const editing = shown !== null;
  const sample = session.id === 'sample';

  const [title, setTitle] = useState('');
  const [caption, setCaption] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('followers');
  const [photos, setPhotos] = useState<PickedPhoto[]>([]);
  const [audio, setAudio] = useState<RecordedAudio | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [cheering, setCheering] = useState(true);

  const flow = useUploadFlow(onPosted);
  const { reset } = flow;

  // The sheet stays mounted between openings. Each opening starts from the session and,
  // in edit mode, the post, not from whatever the last opening left behind.
  useEffect(() => {
    if (!visible) return;
    setTitle(defaultTitle(session));
    setShown(post);
    setCaption(post?.caption ?? '');
    setVisibility(post?.visibility ?? 'followers');
    setPhotos([]);
    setAudio(null);
    setSubmitting(false);
    setProblem(null);
    reset();
    setCheering(true);
    const timer = setTimeout(() => setCheering(false), CELEBRATION_MS);
    return () => clearTimeout(timer);
    // Reads the session and post as they are at opening time; a later re-read of the
    // detail must not wipe what the person has typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const tiles = useMemo(() => statTiles(session), [session]);
  const headline = recapHeadline(session);
  const analysis = session.analysis ?? null;
  const blocker = postBlocker({ offline, busy: submitting, sample });
  const busy = submitting || flow.busy;

  const submit = useCallback(
    async (chosen: Visibility) => {
      if (busy || blocker) return;
      const planned = planMedia(photos, audio);
      if (!planned.ok) {
        Alert.alert('Check the media', planned.message);
        return;
      }
      setSubmitting(true);
      setProblem(null);
      let row: FeedItem;
      try {
        if (shown) {
          row = await api.updatePost(shown.id, {
            caption: caption.trim() || null,
            visibility: chosen,
          });
        } else {
          row = await api.createPost({
            session_id: session.id,
            caption: publishCaption({ title, sessionTitle: session.title, caption }),
            visibility: chosen,
            share_analysis: false,
          });
        }
      } catch (e) {
        setSubmitting(false);
        if (isAlreadySharedConflict(e)) {
          Alert.alert('Already posted', 'This session is on the feed already.');
          onAlreadyPosted();
          return;
        }
        if (e instanceof ApiError && e.status === 0) {
          setProblem("Couldn't reach the server. Your recap is still here. Try again in a moment.");
          return;
        }
        setProblem(e instanceof Error ? e.message : 'Could not post. Try again.');
        return;
      }
      setSubmitting(false);
      flow.start(row, planned.jobs);
    },
    [busy, blocker, photos, audio, shown, caption, title, session, onAlreadyPosted, flow]
  );

  const action = primaryAction(visibility, editing);
  // The strip sits inside a surface: the gutter, the surface's padding and its hairline.
  const contentWidth = width - layout.gutter * 2;
  const stripWidth = contentWidth - layout.tilePad * 2 - 2;
  const existingPhotos = shown?.photos.length ?? 0;
  const roomForPhotos = Math.max(0, MAX_PHOTOS - existingPhotos);
  const inert = busy || Boolean(blocker);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => (flow.uploading ? void flow.finish() : onClose())}
    >
      <ScrollView
        style={{ flex: 1, backgroundColor: c.bg }}
        contentContainerStyle={{
          paddingHorizontal: layout.gutter,
          paddingTop: space.sm,
          paddingBottom: space.xxl,
          gap: space.lg,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {/* The sheet's bar: an action either side and the title between them, the way a
            system sheet lays it out. The two sides share the width so the title stays put
            whichever button is showing. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: TAP_TARGET, gap: space.sm }}>
          <View style={{ flex: 1, alignItems: 'flex-start' }}>
            {flow.uploading ? null : (
              <Button
                kind="secondary"
                size="compact"
                block={false}
                label={editing ? 'Cancel' : 'Not now'}
                onPress={onClose}
                disabled={busy}
              />
            )}
          </View>
          <T role="headline" numberOfLines={1} accessibilityRole="header">
            {flow.uploading ? 'Uploading' : editing ? 'Edit post' : 'Session recap'}
          </T>
          <View style={{ flex: 1, alignItems: 'flex-end' }}>
            {flow.uploading ? (
              <Button
                kind="secondary"
                size="compact"
                block={false}
                label="Done"
                onPress={() => void flow.finish()}
                disabled={busy}
              />
            ) : null}
          </View>
        </View>

        {flow.uploading ? (
          <UploadList
            rows={flow.rows}
            busy={flow.busy}
            retryable={flow.retryable}
            onRetry={flow.retry}
            intro={
              editing
                ? 'Your changes are saved. The new photos and voice note are on their way.'
                : 'Your post is up. Its photos and voice note are on their way.'
            }
          />
        ) : (
          <>
            {/* The hero: the session's own shape, at full width, before any number. */}
            <Surface style={{ gap: space.tile }}>
              {session.strip ? (
                <TimelineStrip
                  cols={session.strip.cols}
                  marks={decodeMarks(session.strip.marks)}
                  spanMs={Math.max(1, session.strip.t1_ms - session.strip.t0_ms)}
                  preset="hero"
                  width={stripWidth}
                />
              ) : (
                <T role="meta" tone="dim">
                  This session predates the detail your editor keeps. Its hours still count.
                </T>
              )}
              <View style={{ gap: space.xs }}>
                <T role="title">{headline}</T>
                <T role="meta" tone="dim">
                  {session.repo_name ?? 'private repo'} · {dayLabel(session.started_at)}
                </T>
              </View>
            </Surface>

            {!editing && (
              <Section label="Title">
                <TextField
                  value={title}
                  onChangeText={(t) => setTitle(t.slice(0, 120))}
                  placeholder={session.unattended ? 'Name this run' : 'Name this session'}
                  editable={!busy}
                  returnKeyType="done"
                  accessibilityLabel="Title"
                />
                <T role="meta" tone="dim">
                  Goes on your post. The session keeps the title your editor gave it.
                </T>
              </Section>
            )}

            <Section label="Numbers">
              <Surface>
                {/* One grid in one surface: nine little cards for nine numbers is the card
                    soup the design rules out. "not recorded" is a refusal, not a value. */}
                <StatGrid
                  items={tiles.map((t) => ({
                    value: t.dim ? null : t.value,
                    label: t.label.toLocaleLowerCase(),
                    refusal: t.dim ? t.value : undefined,
                  }))}
                />
              </Surface>
            </Section>

            <Section label="Analysis">
              <Surface style={{ gap: space.md }}>
                {analysis ? (
                  <>
                    <PixelBadge
                      state={cheering ? 'celebrating' : 'idle'}
                      paused={!cheering}
                      title={analysis.headline}
                      text={analysis.summary}
                      style={{ padding: 0 }}
                    />
                    {/* The archetype is a word under a label, not an amber chip. */}
                    {analysis.archetype ? <Stat value={labelize(analysis.archetype)} label="archetype" /> : null}
                  </>
                ) : (
                  <PixelBadge state="thinking" text={analysisEmptyCopy(session)} style={{ padding: 0 }} />
                )}
              </Surface>
            </Section>

            {editing && shown.photos.length > 0 && (
              <Section label="On the post">
                <PhotoGrid photos={shown.photos} width={contentWidth} />
              </Section>
            )}

            <View style={{ gap: space.sm }}>
              <MediaPicker
                photos={photos}
                onPhotos={setPhotos}
                audio={audio}
                onAudio={setAudio}
                disabled={busy}
                maxPhotos={roomForPhotos}
                allowAudio={!shown?.audio}
              />
              {editing && shown.audio ? (
                <T role="meta" tone="dim">
                  This post already has its voice note.
                </T>
              ) : null}
            </View>

            <Section label="Who can see it">
              <Segmented
                options={VISIBILITIES}
                value={visibility}
                label={visibilityLabel}
                onChange={setVisibility}
                disabled={busy}
              />
            </Section>

            <Section label="Caption">
              <TextField
                value={caption}
                onChangeText={(t) => setCaption(t.slice(0, CAPTION_MAX))}
                placeholder="What did you build?"
                multiline
                editable={!busy}
                accessibilityLabel="Caption"
                style={{ minHeight: 96 }}
              />
              {/* A counter belongs to the end of the field it counts. */}
              <T role="meta" tone="dim" align="right">
                {caption.length}/{CAPTION_MAX}
              </T>
            </Section>

            {(blocker || problem) && (
              <Surface style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 0 }}>
                <T role="meta" tone="dim" style={{ flex: 1, paddingVertical: space.tile }}>
                  {problem ?? blocker}
                </T>
                {(offline || problem) && !sample ? (
                  <Button kind="secondary" size="compact" block={false} label="Try again" onPress={onRetryConnection} />
                ) : null}
              </Surface>
            )}

            <View style={{ gap: space.sm }}>
              <Button
                label={action.label}
                onPress={() => void submit(visibility)}
                disabled={Boolean(blocker)}
                busy={busy}
                busyLabel={editing || visibility === 'private' ? 'Saving\u2026' : 'Posting\u2026'}
              />
              {/* The quieter way out, with what it means said under it: a row, left aligned
                  like every other sentence on the sheet, rather than a centred button with a
                  caption hanging off it. */}
              {action.showSavePrivately && (
                <Surface padding={0}>
                  <Row
                    title="Save privately"
                    meta="Only you. Nothing reaches a feed."
                    leading={<SymbolIcon name="lock" />}
                    onPress={() => void submit('private')}
                    disabled={inert}
                  />
                </Surface>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </Modal>
  );
}

/**
 * Who can see it: three segments in a capsule, the chosen one a solid amber fill with dark
 * ink (a state, not a chip), the others plain text. A value passing a step is a selection
 * tick. Built here rather than native because the choice has to read the same on web.
 */
function Segmented<V extends string>({
  options,
  value,
  label,
  onChange,
  disabled,
}: {
  options: readonly V[];
  value: V;
  label: (v: V) => string;
  onChange: (v: V) => void;
  disabled?: boolean;
}) {
  const c = useColors();
  return (
    <View
      accessibilityRole="radiogroup"
      style={{
        flexDirection: 'row',
        backgroundColor: c.card,
        borderRadius: SHAPE.action,
        borderCurve: 'continuous',
        borderWidth: 1,
        borderColor: c.border,
        padding: space.xs,
      }}
    >
      {options.map((v) => {
        const on = v === value;
        return (
          <Pressable
            key={v}
            onPress={() => {
              if (on) return;
              haptics.select();
              onChange(v);
            }}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, disabled }}
            style={{
              flex: 1,
              minHeight: 36,
              borderRadius: SHAPE.action,
              borderCurve: 'continuous',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: on ? c.accent : 'transparent',
            }}
          >
            <T role="row" tone={on ? 'onAccent' : 'text'}>
              {label(v)}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}
