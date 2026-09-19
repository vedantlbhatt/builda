/**
 * `builder://ship/<key>`: a project's ship kit, and one Share (docs/ship-kit.md).
 *
 * Plain on purpose: the motion system is being rebuilt beside this (docs/motion.md), so the screen
 * is built from `src/ui` and its own few styles, and every rule it follows is in `model.ts`, where
 * `bun test` holds it. From the top: the format tabs over the video at that format's own shape,
 * the stills to pick (a tap toggles one), the platform and its caption (editable, counted against
 * the platform's limit, X's thread under it), ONE Share for everything picked, then what changed
 * and what the Mac could not make, and at the bottom the request that asks the Mac for a new demo.
 * With no kit yet the request is all there is, with the words for where it stands.
 */
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useReducer, useState } from 'react';
import { Platform as RNPlatform, Pressable, ScrollView, StyleSheet, Switch, useWindowDimensions, View } from 'react-native';

import type { MediaSourceRef } from '../data/api';
import { api } from '../data/client';
import { expoVideo } from '../demos/video';
import type { Platform } from '../generated/shipkit';
import { preferredHue } from '../projects/model';
import { GROUND, SPECTRUM, type HueName } from '../insights/palette';
import { Button, SymbolIcon, T, TextField, useColors } from '../ui';
import { useReduceMotion } from '../ui/motion';
import {
  captionCount,
  captionFor,
  initialSelection,
  kitView,
  PLATFORM_NAMES,
  PLATFORMS,
  requestView,
  selectionReducer,
  shareHeldBack,
  sharePayload,
  threadFor,
  type KitView,
} from './model';
import { shareSelection } from './share';
import type { KitFileRow } from './types';
import { useShipKit } from './useKit';

const GUTTER = 20;
const COLUMNS = 3;
const TILE_GAP = 8;
/**
 * MEASURED on the iOS 26.5 simulator: the switch draws 63 points wide inside the 51 point box
 * React Native lays it out in, anchored at its left, so at the end of a row it crossed the page's
 * gutter by 12. On an earlier iOS this is 12 points of air.
 */
const SWITCH_OVERHANG = 12;

export function ShipKitScreen() {
  const params = useLocalSearchParams<{ key?: string; hue?: string; name?: string }>();
  const name = typeof params.name === 'string' && params.name ? params.name : 'your project';
  const key = typeof params.key === 'string' ? params.key.toLowerCase() : '';
  const hue = typeof params.hue === 'string' && params.hue ? params.hue : key.length === 64 ? preferredHue(key) : null;
  const { kit, requests, error, asking, request, cancel } = useShipKit(key.length === 64 ? key : null);
  const view = useMemo(() => (kit.kind === 'ready' ? kitView(kit.kit) : null), [kit]);
  const c = useColors();

  return (
    <>
      <Stack.Screen options={{ title: 'Share what you built' }} />
      <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.page}>
        {kit.kind === 'unknown' ? <T tone="dim">Reading the kit.</T> : null}
        {kit.kind === 'missing' ? <T tone="dim">This project is not one of yours, or it is excluded.</T> : null}
        {view ? <KitBody view={view} ink={inkFor(kit.kind === 'ready' ? kit.kit.document.hue : null, hue)} /> : null}
        {kit.kind === 'none' ? (
          <View style={styles.block}>
            <T role="title">No kit yet</T>
            <T tone="dim" style={styles.gap}>
              A kit is the demo of this project in every shape the platforms take, its screens, and a post for each platform, made on your Mac. It appears here once your Mac publishes it.
            </T>
          </View>
        ) : null}
        {kit.kind === 'none' || view ? (
          <RequestPanel
            state={requestView(requests, kit.kind === 'ready' ? kit.kit.published_at : null)}
            busy={asking}
            onRequest={() => void request(hue, name)}
            onCancel={() => requests?.[0] && void cancel(requests[0].id)}
          />
        ) : null}
        {error ? (
          <T tone="del" role="meta" style={styles.gap}>
            {error}
          </T>
        ) : null}
      </ScrollView>
    </>
  );
}

/** The kit's band colour (the document's hue), else the project's: the switch wears it, as Settings wears the accent. */
function inkFor(docHue: string | null, pageHue: string | null): string | undefined {
  const h = [docHue, pageHue].find((x): x is HueName => typeof x === 'string' && x in SPECTRUM);
  return h ? SPECTRUM[h].ink : undefined;
}

function KitBody({ view, ink }: { view: KitView; ink?: string }) {
  const [s, dispatch] = useReducer(selectionReducer, view, initialSelection);
  const [sharing, setSharing] = useState(false);
  const [after, setAfter] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  const inner = width - GUTTER * 2;
  const c = useColors();
  const tab = view.tabs.find((t) => t.id === s.format) ?? view.tabs[0]!;
  const payload = sharePayload(view, s, RNPlatform.OS === 'web' ? 'Save' : 'Share');
  const heldBack = payload ? shareHeldBack(view, s) : null;
  const caption = captionFor(view, s);
  const count = captionCount(caption, s.platform);
  const thread = threadFor(view, s.platform);
  const edited = s.edits[s.platform] !== undefined;

  const share = async () => {
    if (!payload || heldBack) return;
    setSharing(true);
    setAfter(null);
    try {
      setAfter((await shareSelection(payload)).line);
    } catch (e) {
      setAfter(e instanceof Error ? e.message : 'The files could not be shared.');
    } finally {
      setSharing(false);
    }
  };

  const pictures: { title: string; files: KitFileRow[] }[] = [
    { title: 'Screens', files: view.stills },
    { title: 'Framed for a carousel', files: view.framed },
    { title: 'Before and after', files: view.beforeAfter },
    { title: 'A GIF for a README', files: view.loop ? [view.loop] : [] },
    { title: 'App Store screenshots', files: view.appStore },
  ].filter((g) => g.files.length);

  return (
    <View>
      <View style={styles.tabs} accessibilityRole="tablist">
        {view.tabs.map((t) => {
          const on = t.id === s.format;
          return (
            <Pressable
              key={t.id}
              onPress={() => dispatch({ type: 'format', format: t.id })}
              accessibilityRole="tab"
              accessibilityState={{ selected: on, disabled: !t.video }}
              accessibilityLabel={`${t.label}, ${t.for}${t.video ? '' : ', no video in this shape'}`}
              style={[styles.tab, { borderColor: on ? c.text : c.border, backgroundColor: on ? c.raised : 'transparent', opacity: t.video ? 1 : 0.45 }]}
            >
              <T role="row" weight={on ? 600 : undefined}>
                {t.label}
              </T>
            </Pressable>
          );
        })}
      </View>
      <T role="meta" tone="dim" style={styles.gap}>
        {tab.for}
      </T>
      {tab.video ? <KitVideo file={tab.video} width={Math.min(inner, 420 * tab.aspect)} aspect={tab.aspect} /> : <T tone="dim">No video was made in this shape.</T>}
      {tab.video ? (
        <View style={styles.switchRow}>
          <T>Send the video</T>
          <Switch
            value={s.video}
            onValueChange={(on) => dispatch({ type: 'video', on })}
            trackColor={{ true: ink, false: GROUND.raised }}
            ios_backgroundColor={GROUND.raised}
            accessibilityLabel="Send the video"
            style={{ marginRight: SWITCH_OVERHANG }}
          />
        </View>
      ) : null}

      {pictures.map((g) => (
        <View key={g.title} style={styles.block}>
          <T role="headline">{g.title}</T>
          <View style={styles.grid}>
            {g.files.map((f) => (
              <Tile key={f.id} file={f} size={(inner - TILE_GAP * (COLUMNS - 1)) / COLUMNS} picked={s.picked.includes(f.id)} onPress={() => dispatch({ type: 'toggle', id: f.id })} />
            ))}
          </View>
        </View>
      ))}

      <View style={styles.block}>
        <T role="headline">The words</T>
        <View style={styles.chips}>
          {PLATFORMS.map((p: Platform) => {
            const on = p === s.platform;
            return (
              <Pressable
                key={p}
                onPress={() => dispatch({ type: 'platform', platform: p })}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={[styles.chip, { borderColor: on ? c.text : c.border, backgroundColor: on ? c.raised : 'transparent' }]}
              >
                <T role="meta" weight={on ? 600 : undefined}>
                  {PLATFORM_NAMES[p]}
                </T>
              </Pressable>
            );
          })}
        </View>
        <TextField multiline value={caption} onChangeText={(text) => dispatch({ type: 'edit', platform: s.platform, text })} placeholder="No caption for this platform yet" accessibilityLabel={`The ${PLATFORM_NAMES[s.platform]} caption`} style={styles.caption} />
        <View style={styles.countRow}>
          <T role="meta" tone={count.over ? 'del' : 'dim'}>
            {count.words}
          </T>
          {edited ? (
            <Pressable onPress={() => dispatch({ type: 'revert', platform: s.platform })} accessibilityRole="button">
              <T role="meta" tone="dim">
                Use the kit's words
              </T>
            </Pressable>
          ) : null}
        </View>
        {thread.length ? (
          <View style={styles.gap}>
            <T role="meta" tone="dim">
              As a thread
            </T>
            {thread.map((t, i) => (
              <T key={i} role="meta" style={styles.threadLine}>{`${i + 1}. ${t}`}</T>
            ))}
          </View>
        ) : null}
      </View>

      <Button label={heldBack ?? payload?.label ?? 'Pick the video or a picture to share'} onPress={() => void share()} disabled={!payload || Boolean(heldBack)} busy={sharing} busyLabel="Getting the files ready" style={styles.block} />
      {after ? (
        <T role="meta" tone="dim" style={styles.gap}>
          {after}
        </T>
      ) : null}

      {view.changelog.length ? <Changelog title={view.changelogTitle} lines={view.changelog} /> : null}
      {view.refused.length ? (
        <View style={styles.block}>
          <T role="headline">Not made this time</T>
          {view.refused.map((line, i) => (
            <T key={i} role="meta" tone="dim" style={styles.threadLine}>
              {line.charAt(0).toUpperCase() + line.slice(1)}.
            </T>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * The commits the demo covers, the first few and then the rest on a tap. MEASURED on tonight's
 * Builda kit: thirty lines, which pushed everything under them two screens down for a list most
 * people glance at; eight is what fits under the captions on a 6.1 inch screen.
 */
const CHANGELOG_SHOWN = 8;

function Changelog({ title, lines }: { title: string; lines: string[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? lines : lines.slice(0, CHANGELOG_SHOWN);
  const rest = lines.length - shown.length;
  return (
    <View style={styles.block}>
      <T role="headline">{title}</T>
      {shown.map((line, i) => (
        <T key={i} role="meta" tone="dim" style={styles.threadLine}>
          {line}
        </T>
      ))}
      {rest > 0 ? (
        <Pressable accessibilityRole="button" onPress={() => setAll(true)} hitSlop={8} style={styles.threadLine}>
          <T role="meta" tone="accent" weight={600}>{`and ${rest} more`}</T>
        </Pressable>
      ) : null}
    </View>
  );
}

function useSource(url: string): MediaSourceRef | null {
  const [src, setSrc] = useState<MediaSourceRef | null>(null);
  useEffect(() => {
    let alive = true;
    void api.mediaSource(url).then((s) => alive && setSrc(s));
    return () => {
      alive = false;
    };
  }, [url]);
  return src;
}

function KitVideo({ file, width, aspect }: { file: KitFileRow; width: number; aspect: number }) {
  const mod = expoVideo();
  const src = useSource(file.url);
  const height = Math.round(width / aspect);
  if (!mod || !src) return <View style={{ width, height, backgroundColor: '#000' }} />;
  return <Player key={file.id} mod={mod} src={src} width={width} height={height} />;
}

function Player({ mod, src, width, height }: { mod: NonNullable<ReturnType<typeof expoVideo>>; src: MediaSourceRef; width: number; height: number }) {
  const source = useMemo(() => ({ uri: src.uri, headers: src.headers }), [src.uri]); // eslint-disable-line react-hooks/exhaustive-deps
  const player = mod.useVideoPlayer(source, (p) => {
    p.loop = true;
    p.muted = true;
    p.audioMixingMode = 'mixWithOthers';
  });
  // Under Reduce Motion it does not play by itself: the first frame stands, with the player's own
  // controls to play it on purpose, as `demos/LoopVideo.tsx` keeps its poster (review, 2026-09-19).
  const reduce = useReduceMotion();
  useEffect(() => {
    if (reduce) player.pause();
    else player.play();
  }, [player, reduce]);
  return <mod.VideoView player={player} style={{ width, height, alignSelf: 'center' }} contentFit="contain" nativeControls={reduce} />;
}

function Tile({ file, size, picked, onPress }: { file: KitFileRow; size: number; picked: boolean; onPress: () => void }) {
  const src = useSource(file.url);
  const c = useColors();
  const height = Math.round(size * Math.min(2.2, file.height / Math.max(1, file.width)));
  return (
    <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: picked }} accessibilityLabel={file.label ?? 'a picture'} style={{ width: size }}>
      <View style={[styles.tile, { width: size, height, borderColor: picked ? c.text : 'transparent' }]}>
        {src ? <Image source={{ uri: src.uri, headers: src.headers }} style={{ width: size - 4, height: height - 4 }} contentFit="contain" /> : null}
        {picked ? (
          <View style={[styles.tick, { backgroundColor: c.text }]}>
            <SymbolIcon name="checkmark" size={12} weight="bold" tone="onAccent" />
          </View>
        ) : null}
      </View>
      {file.label ? (
        <T role="label" tone="dim" numberOfLines={2}>
          {file.label}
        </T>
      ) : null}
    </Pressable>
  );
}

function RequestPanel({
  state,
  busy,
  onRequest,
  onCancel,
}: {
  state: ReturnType<typeof requestView>;
  busy: boolean;
  onRequest: () => void;
  onCancel: () => void;
}) {
  return (
    <View style={styles.block}>
      <T tone="dim">{state.line}</T>
      <Button
        kind={state.kind === 'none' || state.kind === 'failed' ? 'primary' : 'secondary'}
        label={state.button}
        onPress={state.kind === 'waiting' ? undefined : onRequest}
        disabled={state.kind === 'waiting'}
        busy={busy}
        busyLabel="Asking your Mac"
        style={styles.gap}
      />
      {state.kind === 'waiting' ? <Button kind="secondary" label={state.cancel} onPress={onCancel} style={styles.gap} /> : null}
    </View>
  );
}

/** The project's hue ink, for a door into this screen: the colour the project page wears. */
export function kitInk(key: string): string {
  return SPECTRUM[preferredHue(key)].ink;
}

const styles = StyleSheet.create({
  page: { padding: GUTTER, paddingBottom: 60 },
  block: { marginTop: 28 },
  gap: { marginTop: 8 },
  tabs: { flexDirection: 'row', gap: 8 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10, borderCurve: 'continuous', borderWidth: 1 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: TILE_GAP, marginTop: 10 },
  tile: { alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderRadius: 10, borderCurve: 'continuous', overflow: 'hidden' },
  tick: { position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10, marginBottom: 10 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderCurve: 'continuous', borderWidth: 1 },
  caption: { minHeight: 120, textAlignVertical: 'top' },
  countRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  threadLine: { marginTop: 6 },
});
