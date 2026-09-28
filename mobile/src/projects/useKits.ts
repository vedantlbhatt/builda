/**
 * Every row's ship kit, for the Projects list (`rows.stageVisual` plays a kit's trailer or its
 * 16:9 video on the row). Read on focus, four at a time, each answer held under its own key: an
 * answer that failed keeps what the row showed (unknown is not "no kit"), and a project the phone
 * has not heard about stays `unknown`, so no row ever says "no demo yet" before the server has.
 *
 * Each playable file's url is made fetchable once it arrives (`api.mediaSource`: the bearer on the
 * local stack, nothing on a presigned url). A file that fails to load asks for `reload`, at most
 * every 20 seconds, which reads the kits again through `Api.request` and its 401 refresh.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import type { MediaSourceRef } from '../data/api';
import { api } from '../data/client';
import type { KitSeen } from './rows';

const AT_ONCE = 4;
const RELOAD_EVERY_MS = 20_000;

export function useKits(keys: readonly string[]): { kits: Record<string, KitSeen>; sources: Record<string, MediaSourceRef>; reload: () => void } {
  const [kits, setKits] = useState<Record<string, KitSeen>>({});
  const [sources, setSources] = useState<Record<string, MediaSourceRef>>({});
  const joined = keys.filter((k) => k.length === 64).join(',');
  const last = useRef(0);
  const live = useRef(true);

  const read = useCallback(async () => {
    if (!joined || !(await api.isSignedIn())) return;
    const queue = joined.split(',');
    const one = async (k: string) => {
      try {
        const got = await api.shipKit(k);
        if (!live.current) return;
        const seen: KitSeen = got.kit ? { kind: 'ready', kit: got.kit } : { kind: 'none' };
        setKits((s) => ({ ...s, [k]: seen }));
        if (got.kit) {
          // A string comparison: `trailer_landscape` is a slot of kits published since the trailer (docs/trailers.md).
          const playable = got.kit.files.filter((f) => (f.slot as string) === 'trailer_landscape' || f.slot === 'video_landscape');
          const made: Record<string, MediaSourceRef> = {};
          for (const f of playable) made[f.id] = await api.mediaSource(f.url);
          if (live.current) setSources((s) => ({ ...s, ...made }));
        }
      } catch {
        // Unknown, not none: the row keeps what it had.
      }
    };
    const workers = Array.from({ length: Math.min(AT_ONCE, queue.length) }, async () => {
      for (let k = queue.shift(); k; k = queue.shift()) await one(k);
    });
    await Promise.all(workers);
  }, [joined]);

  useFocusEffect(
    useCallback(() => {
      live.current = true;
      void read();
      return () => {
        live.current = false;
      };
    }, [read]),
  );

  const reload = useCallback(() => {
    const now = Date.now();
    if (now - last.current < RELOAD_EVERY_MS) return;
    last.current = now;
    void read();
  }, [read]);

  return { kits, sources, reload };
}
