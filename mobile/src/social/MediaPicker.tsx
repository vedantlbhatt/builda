import { Audio } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Image, Pressable, View } from 'react-native';

import { hitSlopToReach, space } from '../theme';
import { Button, Row, SHAPE, Section, Surface, SymbolIcon, T, useColors } from '../ui';
import { AudioChip } from './AudioChip';
import {
  addPhotos,
  audioMime,
  formatClock,
  MAX_AUDIO_MS,
  MAX_PHOTOS,
  photoRoom,
  type PickedPhoto,
  type RecordedAudio,
} from './media';

const THUMB = 72;
/** The remove button's circle; its hit area grows to the 44pt floor. */
const REMOVE = 22;

/**
 * Photos and a voice note for the compose sheet. Owns nothing but the recorder in
 * flight; the chosen photos and the finished recording live in the sheet's state so
 * that Post can turn them into an upload plan after the post row exists.
 *
 * Downscaling happens at upload time, not here: `upload.ts::downscalePhoto` shrinks any
 * photo the plan marks `oversized` to a 2048 long edge at JPEG q=0.85 (docs/social.md).
 * The picker's `quality: 0.85` only recompresses; the thumbnails below show the original.
 */
export function MediaPicker({
  photos,
  onPhotos,
  audio,
  onAudio,
  disabled = false,
  maxPhotos = MAX_PHOTOS,
  allowAudio = true,
}: {
  photos: PickedPhoto[];
  onPhotos: (next: PickedPhoto[]) => void;
  audio: RecordedAudio | null;
  onAudio: (next: RecordedAudio | null) => void;
  disabled?: boolean;
  /**
   * How many photos this picker may hold — `MAX_PHOTOS` less whatever the post already
   * carries, when adding to an existing post. Never above the server's cap.
   */
  maxPhotos?: number;
  /** False when the post already has its one voice note: the recorder is not offered. */
  allowAudio?: boolean;
}) {
  const cap = Math.max(0, Math.min(maxPhotos, MAX_PHOTOS));
  const room = photoRoom(photos.length, cap);

  const pick = useCallback(async () => {
    if (room === 0) return;
    let result: ImagePicker.ImagePickerResult;
    try {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: room,
        quality: 0.85,
      });
    } catch (e) {
      Alert.alert('Could not open photos', e instanceof Error ? e.message : 'try again');
      return;
    }
    if (result.canceled) return;
    const picked: PickedPhoto[] = result.assets.map((a) => ({
      uri: a.uri,
      width: a.width,
      height: a.height,
      mime: a.mimeType ?? null,
      bytes: a.fileSize ?? null,
    }));
    onPhotos(addPhotos(photos, picked, cap));
  }, [photos, onPhotos, room, cap]);

  const remove = useCallback(
    (uri: string) => onPhotos(photos.filter((p) => p.uri !== uri)),
    [photos, onPhotos]
  );

  return (
    <View style={{ gap: space.lg }}>
      <Section label="Photos">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {photos.map((p) => (
            <Thumb key={p.uri} uri={p.uri} onRemove={disabled ? undefined : () => remove(p.uri)} />
          ))}
          {room > 0 && !disabled && (
            <AddTile
              label={photos.length === 0 ? 'Add photos' : `Add ${room} more`}
              caption={photos.length === 0 ? null : `${room} more`}
              onPress={() => void pick()}
            />
          )}
        </View>
        <T role="meta" tone="dim">
          {cap < MAX_PHOTOS
            ? `Room for ${cap} more. A post carries up to ${MAX_PHOTOS}.`
            : `Up to ${MAX_PHOTOS}. Screenshots of the thing you built are the point.`}
        </T>
      </Section>

      {allowAudio && (
        <Section label="Voice note">
          <Recorder audio={audio} onAudio={onAudio} disabled={disabled} />
        </Section>
      )}
    </View>
  );
}

/** A picked photo, inner corners, with a small remove button over its top right corner. */
function Thumb({ uri, onRemove }: { uri: string; onRemove?: () => void }) {
  const c = useColors();
  return (
    <View style={{ width: THUMB, height: THUMB }}>
      {/* The clip carries the corners: an Image takes no borderCurve of its own. */}
      <View style={{ borderRadius: SHAPE.inner, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: c.raised }}>
        <Image source={{ uri }} resizeMode="cover" accessibilityIgnoresInvertColors style={{ width: THUMB, height: THUMB }} />
      </View>
      {onRemove && (
        <Pressable
          onPress={onRemove}
          hitSlop={hitSlopToReach(REMOVE)}
          accessibilityRole="button"
          accessibilityLabel="Remove photo"
          style={({ pressed }) => ({
            position: 'absolute',
            top: -space.sm,
            right: -space.sm,
            width: REMOVE,
            height: REMOVE,
            borderRadius: SHAPE.action,
            borderCurve: 'continuous',
            backgroundColor: pressed ? c.raised : c.bg,
            borderWidth: 1,
            borderColor: c.border,
            alignItems: 'center',
            justifyContent: 'center',
          })}
        >
          <SymbolIcon name="xmark" size={10} weight="bold" tone="text" />
        </Pressable>
      )}
    </View>
  );
}

/**
 * The next photo's slot: a `raised` tile with a plus, the size of the thumbnails beside it.
 * Empty, the plus is enough (the section says "photos"); once there are some, it says how
 * many more fit.
 */
function AddTile({ label, caption, onPress }: { label: string; caption: string | null; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        width: THUMB,
        height: THUMB,
        borderRadius: SHAPE.inner,
        borderCurve: 'continuous',
        backgroundColor: pressed ? c.border : c.raised,
        alignItems: 'center',
        justifyContent: 'center',
        gap: space.xs,
      })}
    >
      <SymbolIcon name="plus" size={17} tone="text" />
      {caption ? (
        <T role="label" tone="dim" numberOfLines={1}>
          {caption}
        </T>
      ) : null}
    </Pressable>
  );
}

/**
 * Record → preview → keep, delete or re-record. One note, at most 90 s: the status
 * callback watches the clock and stops the recorder itself at the cap, so a person who
 * keeps talking loses the tail rather than the whole note to a 422.
 */
function Recorder({
  audio,
  onAudio,
  disabled,
}: {
  audio: RecordedAudio | null;
  onAudio: (next: RecordedAudio | null) => void;
  disabled: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const recRef = useRef<Audio.Recording | null>(null);
  const stoppingRef = useRef(false);

  const stop = useCallback(async () => {
    const rec = recRef.current;
    if (!rec || stoppingRef.current) return;
    stoppingRef.current = true;
    try {
      try {
        await rec.stopAndUnloadAsync();
      } catch {
        // Already stopped (the cap and a tap can race); the status below still reads.
      }
      const status = await rec.getStatusAsync();
      const uri = rec.getURI();
      // A note that ran to the cap can read a few ms over it by the time the stop lands;
      // the server rejects 90 001, so the number the person kept is the cap itself.
      const durationMs = Math.min(status.durationMillis, MAX_AUDIO_MS);
      if (uri && durationMs > 0) {
        onAudio({ uri, durationMs, mime: audioMime(uri) });
      }
    } finally {
      recRef.current = null;
      stoppingRef.current = false;
      setRecording(false);
      setElapsedMs(0);
      // Back to playback routing, or the preview plays through the earpiece on iOS.
      void Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true }).catch(
        () => undefined
      );
    }
  }, [onAudio]);

  const start = useCallback(async () => {
    if (recRef.current) return;
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Microphone', 'Allow microphone access in Settings to record a voice note.');
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const preset = Audio.RecordingOptionsPresets.HIGH_QUALITY;
      if (!preset) throw new Error('recording preset unavailable');
      onAudio(null);
      const onStatus = (st: Audio.RecordingStatus) => {
        setElapsedMs(st.durationMillis);
        if (st.isRecording && st.durationMillis >= MAX_AUDIO_MS) void stop();
      };
      const { recording: rec } = await Audio.Recording.createAsync(preset, onStatus, 250);
      recRef.current = rec;
      setRecording(true);
    } catch (e) {
      Alert.alert('Could not record', e instanceof Error ? e.message : 'try again');
      recRef.current = null;
      setRecording(false);
    }
  }, [onAudio, stop]);

  // Unmount mid-recording: release the recorder; nothing is kept.
  useEffect(
    () => () => {
      const rec = recRef.current;
      recRef.current = null;
      if (rec) void rec.stopAndUnloadAsync().catch(() => undefined);
    },
    []
  );

  if (recording) {
    const remaining = Math.max(0, MAX_AUDIO_MS - elapsedMs);
    return (
      <Surface style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs }}>
        <RecordingDot />
        <T role="row">{formatClock(elapsedMs)}</T>
        <T role="meta" tone="dim" style={{ flex: 1 }}>
          {formatClock(remaining)} left
        </T>
        <Button label="Stop" size="compact" block={false} onPress={() => void stop()} />
      </Surface>
    );
  }

  if (audio) {
    return (
      <Surface style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs }}>
        <AudioChip uri={audio.uri} durationMs={audio.durationMs} />
        <View style={{ flex: 1 }} />
        {!disabled && (
          <>
            <Button kind="secondary" size="compact" block={false} label="Re-record" onPress={() => void start()} />
            <Button kind="secondary" destructive size="compact" block={false} label="Delete" onPress={() => onAudio(null)} />
          </>
        )}
      </Surface>
    );
  }

  return (
    <Surface padding={0}>
      <Row
        title="Record a voice note"
        meta={`Up to ${formatClock(MAX_AUDIO_MS)}. Saying what you built beats a caption.`}
        metaLines={2}
        leading={<SymbolIcon name="mic" />}
        onPress={() => void start()}
        disabled={disabled}
      />
    </Surface>
  );
}

/** The one red on this sheet: the recording light. */
function RecordingDot() {
  const c = useColors();
  return (
    <View style={{ width: 10, height: 10, borderRadius: SHAPE.action, borderCurve: 'continuous', backgroundColor: c.danger }} />
  );
}
