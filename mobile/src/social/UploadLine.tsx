import React from 'react';
import { ActivityIndicator, Image, View } from 'react-native';

import { space } from '../theme';
import { Button, Hairline, SHAPE, Surface, SymbolIcon, T, useColors } from '../ui';
import { uploadStatus, uploadWhat, type UploadRow } from './composeFlow';

const THUMB = 40;

/** One upload's line: a thumbnail or the note's glyph, what it is, and where it is. */
export function UploadLine({ row }: { row: UploadRow }) {
  const c = useColors();
  const { job, state } = row;
  const failed = state.phase === 'failed';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.tile, padding: space.tile }}>
      <View
        style={{
          width: THUMB,
          height: THUMB,
          borderRadius: SHAPE.mark,
          borderCurve: 'continuous',
          overflow: 'hidden',
          backgroundColor: c.raised,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {job.kind === 'photo' ? (
          <Image source={{ uri: job.uri }} resizeMode="cover" accessibilityIgnoresInvertColors style={{ width: THUMB, height: THUMB }} />
        ) : (
          <SymbolIcon name="waveform" tone="text" />
        )}
      </View>
      <T role="row" style={{ flex: 1 }}>
        {uploadWhat(job)}
      </T>
      {state.phase === 'uploading' ? (
        <ActivityIndicator color={c.accent} />
      ) : (
        <T
          role="meta"
          weight={600}
          tone={failed ? 'del' : state.phase === 'done' ? 'text' : 'dim'}
          style={{ maxWidth: 160 }}
          numberOfLines={2}
        >
          {uploadStatus(state)}
        </T>
      )}
    </View>
  );
}

/** The upload phase's body: a sentence, the lines, and Retry when it would do anything. */
export function UploadList({
  rows,
  busy,
  retryable,
  onRetry,
  intro = 'Your post is up. Its photos and voice note are on their way.',
}: {
  rows: readonly UploadRow[];
  busy: boolean;
  retryable: boolean;
  onRetry: () => void;
  intro?: string;
}) {
  return (
    <View style={{ gap: space.md }}>
      <T role="meta" tone="dim">
        {intro}
      </T>
      {rows.length > 0 && (
        <Surface padding={0}>
          {rows.map((r, i) => (
            <View key={i}>
              {i > 0 ? <Hairline inset={space.tile * 2 + THUMB} /> : null}
              <UploadLine row={r} />
            </View>
          ))}
        </Surface>
      )}
      {!busy && retryable && <Button label="Retry failed uploads" onPress={onRetry} />}
    </View>
  );
}
