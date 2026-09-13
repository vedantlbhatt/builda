import React from 'react';
import { Image, View, type StyleProp, type ViewStyle } from 'react-native';

import type { PostMedia } from '../data/api';
import { space } from '../theme';
import { SHAPE, T, useColors } from '../ui';

const GAP = 4;
const COLUMNS = 3;

/**
 * A post's photos. `grid`: square thumbnails, three across, for the feed row. `full`:
 * each photo at full width with its own aspect, for the post screen.
 *
 * `url` is null when the server has no `OBJECT_STORE_PUBLIC_BASE` to build one from; the
 * photo exists but cannot be fetched, so a neutral tile carries the count rather than an
 * `Image` that fails silently.
 */
export function PhotoGrid({
  photos,
  width,
  layout = 'grid',
  style,
}: {
  photos: readonly PostMedia[];
  /** The width the grid may use. */
  width: number;
  layout?: 'grid' | 'full';
  style?: StyleProp<ViewStyle>;
}) {
  if (photos.length === 0) return null;
  const count = photos.length;
  const countLabel = `${count} photo${count === 1 ? '' : 's'}`;

  if (layout === 'full') {
    return (
      <View style={[{ gap: space.sm }, style]}>
        {photos.map((p) => {
          const ratio = p.width && p.height ? p.width / p.height : 4 / 3;
          const h = Math.round(width / ratio);
          return p.url ? (
            <Photo key={p.id} uri={p.url} width={width} height={h} />
          ) : (
            <Placeholder key={p.id} width={width} height={Math.min(h, width)} label={countLabel} />
          );
        })}
      </View>
    );
  }

  const tile = Math.floor((width - GAP * (COLUMNS - 1)) / COLUMNS);
  let labeled = false;
  return (
    <View style={[{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }, style]}>
      {photos.map((p) => {
        if (p.url) return <Photo key={p.id} uri={p.url} width={tile} height={tile} />;
        const label = labeled ? null : countLabel;
        labeled = true;
        return <Placeholder key={p.id} width={tile} height={tile} label={label} />;
      })}
    </View>
  );
}

/** One photo, clipped to the inner radius: an Image takes no borderCurve of its own. */
function Photo({ uri, width, height }: { uri: string; width: number; height: number }) {
  const c = useColors();
  return (
    <View style={{ width, height, borderRadius: SHAPE.inner, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: c.raised }}>
      <Image source={{ uri }} resizeMode="cover" accessibilityIgnoresInvertColors style={{ width, height }} />
    </View>
  );
}

function Placeholder({ width, height, label }: { width: number; height: number; label: string | null }) {
  const c = useColors();
  return (
    <View
      style={{
        width,
        height,
        borderRadius: SHAPE.inner,
        borderCurve: 'continuous',
        backgroundColor: c.raised,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {label ? (
        <T role="meta" weight={600} tone="dim">
          {label}
        </T>
      ) : null}
    </View>
  );
}
