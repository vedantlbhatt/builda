/**
 * The trailer a release went out with, playing where the release is read (server 0040
 * `release_trailer`: its readers may see that one film while the owner's kit still carries it).
 * Loops muted while on screen (`LoopVideo`'s rules); until its first frame draws, the project's
 * band stands in the frame, the frame a trailer opens on anyway. Nothing when there is no film.
 */
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';

import type { MediaSourceRef } from '../data/api';
import { api } from '../data/client';
import { LoopVideo } from '../demos/LoopVideo';
import type { GalleryEntry } from '../demos/model';
import { BandPixels } from '../insights/Band';
import { GROUND } from '../insights/palette';
import { motionFor } from '../motion/pixelMotion';

export function ReleaseFilm({ releaseId, width, ink, label }: { releaseId: string; width: number; ink: string; label: string }) {
  const [film, setFilm] = useState<{ url: string; width: number; height: number } | null>(null);
  const [src, setSrc] = useState<MediaSourceRef | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await api.releaseTrailer(releaseId);
        if (!alive || !r.trailer?.url) return;
        const t = { url: r.trailer.url, width: r.trailer.width, height: r.trailer.height };
        setFilm(t);
        const s = await api.mediaSource(t.url);
        if (alive) setSrc(s);
      } catch {
        // A film that did not come down is no film: the release reads on without it.
      }
    })();
    return () => {
      alive = false;
    };
  }, [releaseId]);
  if (!film) return null;
  const height = Math.round((width * film.height) / film.width);
  const entry: GalleryEntry = { id: `release:${releaseId}`, kind: 'video', label, source: null, mark: null, count: '', aspect: film.width / film.height, url: film.url, posterUrl: null, duration: null, a11y: label };
  return (
    <View style={{ width, height, backgroundColor: GROUND.bg }}>
      <LoopVideo
        entry={entry}
        src={src}
        poster={undefined}
        width={width}
        height={height}
        held={false}
        onOpen={() => undefined}
        a11yLabel={`${label}, its trailer`}
        placeholder={<BandPixels width={width} solid={Math.round(height * 0.58)} ink={ink} motion={motionFor(`release:${releaseId}`)} />}
      />
    </View>
  );
}
