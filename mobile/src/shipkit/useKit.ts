/**
 * A project's ship kit and its requests for a demo, read on focus (docs/ship-kit.md).
 *
 * An answer the server did not give is not "no kit": a read that failed keeps what was shown, and
 * a project the phone has not heard about shows nothing, so the "Request a demo" state only ever
 * says what the server said. While a request is waiting on the Mac the requests are read again
 * every `POLL_MS`, and the kit too once one finishes, so the screen turns into the kit by itself
 * when the Mac publishes it.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '../data/api';
import { api } from '../data/client';
import type { DemoRequestRow, ShipKitResponse } from './types';

/** How often a waiting request is read again. The Mac films in minutes; this is a glance. */
export const POLL_MS = 20_000;

export type KitLoad = { kind: 'unknown' } | { kind: 'none' } | { kind: 'ready'; kit: ShipKitResponse } | { kind: 'missing' };

export function useShipKit(key: string | null) {
  const [kit, setKit] = useState<KitLoad>({ kind: 'unknown' });
  const [requests, setRequests] = useState<DemoRequestRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const live = useRef(true);
  const lastStatus = useRef<string | null>(null);

  const read = useCallback(async () => {
    if (!key || key.length !== 64 || !(await api.isSignedIn())) return;
    try {
      const [k, r] = await Promise.all([api.shipKit(key), api.demoRequests(key)]);
      if (!live.current) return;
      setKit(k.kit ? { kind: 'ready', kit: k.kit } : { kind: 'none' });
      setRequests(r.requests);
      setError(null);
    } catch (e) {
      if (!live.current) return;
      if (e instanceof ApiError && e.status === 404) setKit({ kind: 'missing' });
      else setError(e instanceof Error ? e.message : 'The kit could not be read.');
    }
  }, [key]);

  useFocusEffect(
    useCallback(() => {
      live.current = true;
      void read();
      return () => {
        live.current = false;
      };
    }, [read]),
  );

  const waiting = requests?.[0]?.status === 'queued' || requests?.[0]?.status === 'claimed';
  useEffect(() => {
    const status = requests?.[0]?.status ?? null;
    // A request that just finished: the kit may be new.
    if (lastStatus.current && lastStatus.current !== status && status === 'done') void read();
    lastStatus.current = status;
    if (!waiting) return;
    const t = setInterval(() => void read(), POLL_MS);
    return () => clearInterval(t);
  }, [requests, waiting, read]);

  const request = useCallback(
    async (hue: string | null) => {
      if (!key) return;
      setAsking(true);
      try {
        const r = await api.requestDemo(key, hue);
        setRequests((rs) => [r.request, ...(rs ?? []).filter((x) => x.id !== r.request.id)]);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'The request did not reach the server.');
      } finally {
        setAsking(false);
      }
    },
    [key],
  );

  const cancel = useCallback(async (id: string) => {
    try {
      const r = await api.cancelDemoRequest(id);
      setRequests((rs) => (rs ?? []).map((x) => (x.id === id ? r.request : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'It could not be taken back.');
    }
  }, []);

  return { kit, requests, error, asking, reload: read, request, cancel };
}
