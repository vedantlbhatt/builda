/**
 * A project's demo on its page, in the hero chapter, under the hero band.
 *
 *   the video     playing muted and looping in a frame of its own under the band, at its own
 *                 shape (a phone recording on the left half, a wide one across the page), SUNK
 *                 UNDER THE BAND'S OWN PIXEL EDGE: the frame starts under the band's solid ink
 *                 (a phone recording's status bar tucked under it), so the band's dissolve prints
 *                 over the top of the moving picture exactly as it prints over the ground beside
 *                 it, and the foot of the frame breaks up into
 *                 the ground through the same 8 by 8 dither (react-bits AnimatedList's edge, the
 *                 port in `src/ui/bits/components/layers.tsx`). No gradient, and never a word over
 *                 the picture: the words sit beside it and under it (`LoopVideo.tsx` for when it
 *                 plays)
 *   the stills    beside it as a pile (react-bits Stack, through its port in
 *                 `src/ui/bits/components/Stack.tsx`): throw the top one to see the next, tap one
 *                 to open the gallery on it; the top print develops in through the project's cells
 *   no video      the pile and its words, under the band
 *   no demo       one empty print and the two commands that make one (`EmptyPrint.tsx`)
 *
 * The ports keep David Haz's notice (react-bits, MIT + Commons Clause, used as part of this
 * application only).
 */
import React, { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';

import { n } from '../copy/numbers';
import { api } from '../data/client';
import { FRINGE } from '../insights/Band';
import { numSpec } from '../insights/format';
import { figure, GUTTER, type, Words } from '../insights/kit';
import { Num } from '../insights/Num';
import { GROUND, SPECTRUM, type HueName } from '../insights/palette';
import { Block } from '../insights/reveal';
import { EdgeDither, Stack } from '../ui/bits/components';
import { useClockReached } from '../you/parts';
import { PageEmptyDemo } from './EmptyPrint';
import { LoopVideo } from './LoopVideo';
import { DELETE_DEMO, deleteAsk, deletedSentence, demoWords, PHONE_ASPECT, stripLayout, type GalleryEntry, type StripLayout } from './model';
import { Print } from './Print';
import type { DemoLoad, DemoSources } from './useDemo';

/** How far the foot of the video breaks up into the ground. */
const FOOT = 30;
/** Room round the pile for its turn (4 degrees a card) and the drag's lean. */
const PILE_ROOM = 14;
/** Beside a video: where the pile starts (under the band's pixel edge), and the room its count and caption take under it. */
const SIDE_TOP = FRINGE + 4;
const SIDE_WORDS = 104;

export interface HeroDemoProps {
  /** The hero band, as the page draws it. */
  band: ReactNode;
  demo: DemoLoad;
  hue: HueName;
  width: number;
  /** A gallery is open over the page: the video holds still. */
  held: boolean;
  /** Open the gallery on this file. */
  onOpen: (id: string) => void;
  onError: () => void;
  /** The project's full key: what a delete names. */
  projectKey: string;
  /** The server deleted it: the page shows nothing of it from now on. */
  onDeleted: () => void;
}

/**
 * The hero band with its demo under it. The band is measured so the video can stand exactly
 * where its solid ink ends; until then, and with no video, the band stands alone and the demo
 * (the pile, or the empty print) follows it as a block of its own.
 */
export function HeroDemo({ band, demo, hue, width, held, onOpen, onError, projectKey, onDeleted }: HeroDemoProps) {
  const [bandH, setBandH] = useState(0);
  const [said, setSaid] = useState<string | null>(null);
  const entries = demo.kind === 'ready' ? demo.entries : [];
  const video = entries.find((e) => e.kind === 'video') ?? null;
  const stills = useMemo(() => entries.filter((e) => e.kind === 'image'), [entries]);
  const layout = video ? stripLayout(width, video.aspect, GUTTER) : null;
  const words = demoWords(entries);
  const sources: DemoSources = demo.kind === 'ready' ? demo.sources : { file: {}, poster: {} };

  return (
    <>
      <View>
        {video && layout && bandH > 0 ? (
          <Block enter={false} style={{ position: 'absolute', left: 0, top: bandH - FRINGE - layout.tuck, width, height: layout.videoH }}>
            <VideoStrip video={video} stills={stills} sources={sources} layout={layout} width={width} hue={hue} held={held} onOpen={onOpen} onError={onError} words={words} />
          </Block>
        ) : null}
        <View onLayout={(e) => setBandH(Math.round(e.nativeEvent.layout.height))}>{band}</View>
        {video && layout && bandH > 0 ? <View style={{ height: layout.videoH - FRINGE - layout.tuck }} /> : null}
      </View>
      {video && layout && words?.videoCaption ? (
        <Block style={styles.caption}>
          {/* Under the picture, never on it: its length, where it came from, and what a tap does. */}
          <Words style={type.meta}>{`${words.videoCaption} ${words.tap}`}</Words>
        </Block>
      ) : null}
      {video && layout?.mode === 'wide' && stills.length ? (
        <Block style={styles.below}>
          <StillsWithWords stills={stills} sources={sources} width={width - GUTTER * 2} hue={hue} onOpen={onOpen} onError={onError} words={words} />
        </Block>
      ) : null}
      {!video && stills.length ? (
        <Block style={styles.below}>
          <StillsWithWords stills={stills} sources={sources} width={width - GUTTER * 2} hue={hue} onOpen={onOpen} onError={onError} words={words} />
        </Block>
      ) : null}
      {demo.kind === 'ready' ? (
        <Block style={styles.remove}>
          <DeleteDemo projectKey={projectKey} entries={entries} onDeleted={onDeleted} onSaid={setSaid} />
        </Block>
      ) : null}
      {demo.kind === 'none' ? (
        <Block style={styles.below}>
          {said ? <Words style={[type.dim, styles.said]}>{said}</Words> : null}
          <PageEmptyDemo hue={hue} width={width - GUTTER * 2} />
        </Block>
      ) : null}
    </>
  );
}

/**
 * Deleting a demo from the page (docs/demos.md, "What leaves the Mac"): one quiet line, a question
 * that says exactly what leaves, then `DELETE /v1/projects/{key}/media`, which removes every row
 * and every file in one request, and a sentence with the server's own count. Nothing is taken off
 * the page until the server has answered; a failure says so and leaves the demo where it was.
 */
function DeleteDemo({ projectKey, entries, onDeleted, onSaid }: { projectKey: string; entries: readonly GalleryEntry[]; onDeleted: () => void; onSaid: (s: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const remove = useCallback(async () => {
    setBusy(true);
    setFailed(null);
    try {
      const { deleted } = await api.deleteProjectMedia(projectKey);
      onSaid(deletedSentence(deleted, entries));
      onDeleted();
    } catch (e) {
      setFailed(`The demo was not deleted: ${e instanceof Error && e.message ? e.message.replace(/\.?$/, '.') : 'the server did not answer.'}`);
    } finally {
      setBusy(false);
    }
  }, [projectKey, entries, onDeleted, onSaid]);
  const ask = useCallback(() => {
    Alert.alert(DELETE_DEMO.title, deleteAsk(entries), [
      { text: DELETE_DEMO.keep, style: 'cancel' },
      { text: DELETE_DEMO.confirm, style: 'destructive', onPress: () => void remove() },
    ]);
  }, [entries, remove]);
  return (
    <View style={{ gap: 6 }}>
      <Pressable onPress={ask} disabled={busy} hitSlop={10} accessibilityRole="button" accessibilityHint={deleteAsk(entries)} style={({ pressed }) => ({ opacity: pressed || busy ? 0.5 : 1, alignSelf: 'flex-start' })}>
        <Text maxFontSizeMultiplier={1.4} style={[type.meta, styles.deleteWord]}>
          {DELETE_DEMO.link}
        </Text>
      </Pressable>
      {failed ? <Words style={type.meta}>{failed}</Words> : null}
    </View>
  );
}

function VideoStrip({
  video,
  stills,
  sources,
  layout,
  width,
  hue,
  held,
  onOpen,
  onError,
  words,
}: {
  video: GalleryEntry;
  stills: readonly GalleryEntry[];
  sources: DemoSources;
  layout: StripLayout;
  width: number;
  hue: HueName;
  held: boolean;
  onOpen: (id: string) => void;
  onError: () => void;
  words: ReturnType<typeof demoWords>;
}) {
  const full = useSharedValue(1);
  const open = useCallback(() => onOpen(video.id), [onOpen, video.id]);
  return (
    <View style={[styles.strip, { width, height: layout.videoH }]}>
      <View style={{ width: layout.videoW, height: layout.videoH }}>
        <LoopVideo entry={video} src={sources.file[video.id]} poster={sources.poster[video.id]} width={layout.videoW} height={layout.videoH} held={held} onOpen={open} onError={onError} />
        {/* The foot of the picture breaks up into the ground, cell by cell. */}
        <EdgeDither width={layout.videoW} height={FOOT} color={GROUND.bg} strength={full} fromBottom style={{ top: layout.videoH - FOOT }} />
      </View>
      {layout.mode === 'side' && stills.length ? (
        <View style={[styles.side, { width: layout.sideW, height: layout.videoH, marginLeft: 16, paddingTop: SIDE_TOP + layout.tuck }]}>
          <StillsWithWords stills={stills} sources={sources} width={layout.sideW} maxH={layout.videoH - layout.tuck - SIDE_TOP - SIDE_WORDS} hue={hue} onOpen={onOpen} onError={onError} words={words} stacked />
        </View>
      ) : null}
    </View>
  );
}

/**
 * The pile of stills and what it is, the count in its own large figure. `stacked` puts the words
 * under the pile (beside a video); otherwise they stand to its left.
 */
function StillsWithWords({
  stills,
  sources,
  width,
  hue,
  onOpen,
  onError,
  words,
  stacked = false,
  maxH,
}: {
  stills: readonly GalleryEntry[];
  sources: DemoSources;
  width: number;
  /** The tallest the pile may stand, room for its turn included (beside a video: the video's height less its words). */
  maxH?: number;
  hue: HueName;
  onOpen: (id: string) => void;
  onError: () => void;
  words: ReturnType<typeof demoWords>;
  stacked?: boolean;
}) {
  const aspect = stills[0]?.aspect ?? PHONE_ASPECT;
  let cardW = Math.round(Math.min(stacked ? width - PILE_ROOM * 2 : width * 0.42, aspect < 1 ? 128 : 190));
  if (maxH !== undefined && cardW / aspect > maxH - PILE_ROOM * 2) cardW = Math.max(40, Math.round((maxH - PILE_ROOM * 2) * aspect));
  const cardH = Math.round(cardW / aspect);
  const ink = SPECTRUM[hue].ink;
  const text = (
    <View style={stacked ? styles.wordsUnder : styles.wordsBeside}>
      <View style={styles.countLine}>
        <Num spec={numSpec(stills.length, n(stills.length))} textStyle={figure(40, ink)} delay={220} />
        <Text maxFontSizeMultiplier={1.4} style={[type.lead, { flexShrink: 1 }]}>
          {words?.stillsCaption ?? ''}
        </Text>
      </View>
      {words && !stacked ? <Words style={type.meta}>{words.tap}</Words> : null}
    </View>
  );
  return (
    <View style={stacked ? null : styles.row}>
      {stacked ? null : text}
      <Pile stills={stills} sources={sources} cardW={cardW} cardH={cardH} hue={hue} onOpen={onOpen} onError={onError} />
      {stacked ? text : null}
    </View>
  );
}

function Pile({
  stills,
  sources,
  cardW,
  cardH,
  hue,
  onOpen,
  onError,
}: {
  stills: readonly GalleryEntry[];
  sources: DemoSources;
  cardW: number;
  cardH: number;
  hue: HueName;
  onOpen: (id: string) => void;
  onError: () => void;
}) {
  // The top print develops once the block has arrived, a beat after the band's words.
  const develop = useClockReached(420);
  const room = PILE_ROOM;
  return (
    <View style={{ width: cardW + room * 2, height: cardH + room * 2, alignItems: 'center', justifyContent: 'center' }}>
      <Stack
        count={stills.length}
        width={cardW}
        height={cardH}
        sendToBackOnTap={false}
        randomRotation
        labelFor={(i) => `${stills[i]?.a11y ?? ''}. Throw it to see the next, or open the gallery.`}
        renderCard={(i, state) => {
          const s = stills[i]!;
          return (
            <Pressable onPress={() => onOpen(s.id)} accessibilityRole="button" accessibilityLabel={`Open the gallery on ${s.label}`} disabled={!state.top}>
              <Print id={s.id} src={sources.file[s.id]} width={cardW} height={cardH} arrive={i === 0 ? develop : undefined} hue={hue} wait={GROUND.card} mark={s.mark} onError={onError} />
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row' },
  side: { alignItems: 'flex-start' },
  caption: { paddingHorizontal: GUTTER, marginTop: 10 },
  below: { paddingHorizontal: GUTTER, marginTop: 22 },
  remove: { paddingHorizontal: GUTTER, marginTop: 10 },
  deleteWord: { color: GROUND.dim, textDecorationLine: 'underline' },
  said: { marginBottom: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  wordsBeside: { flex: 1, gap: 6 },
  wordsUnder: { gap: 6, marginTop: 6, paddingRight: 4 },
  countLine: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 8 },
});
