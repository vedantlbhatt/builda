/**
 * A trailer's notes and your Mac's answers, read on focus and again every `POLL_MS` while any note
 * is still with the Mac (docs/trailers.md). A note sent shows at once as waiting; the Mac's answer
 * replaces it when the next read brings it. A read that failed keeps what was shown: an answer the
 * server did not give is never shown as one.
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../data/client';
import { anyPending, conversation, sayNoteError, type TrailerNote } from './model';

/** A cut takes the Mac a minute or two; a read every eight seconds sees the answer land soon after. */
export const POLL_MS = 8_000;

export function useTrailerNotes(key: string | null) {
  const [notes, setNotes] = useState<TrailerNote[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const live = useRef(true);

  const read = useCallback(async () => {
    if (!key || key.length !== 64 || !(await api.isSignedIn())) return;
    try {
      const r = await api.trailerNotes(key);
      if (live.current) {
        setNotes(conversation(r.notes));
        setError(null);
      }
    } catch (e) {
      if (live.current) setError(sayNoteError(e, 'The notes could not be read.'));
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

  const pending = notes ? anyPending(notes) : false;
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => void read(), POLL_MS);
    return () => clearInterval(t);
  }, [pending, read]);

  const send = useCallback(
    async (body: string): Promise<boolean> => {
      if (!key) return false;
      setSending(true);
      try {
        const r = await api.sendTrailerNote(key, body.trim());
        setNotes((ns) => conversation([...(ns ?? []).filter((n) => n.id !== r.note.id), r.note]));
        setError(null);
        return true;
      } catch (e) {
        setError(sayNoteError(e, 'The note did not reach the server.'));
        return false;
      } finally {
        setSending(false);
      }
    },
    [key],
  );

  const cancel = useCallback(async (id: string) => {
    try {
      const r = await api.cancelTrailerNote(id);
      setNotes((ns) => (ns ?? []).map((n) => (n.id === id ? r.note : n)));
    } catch (e) {
      setError(sayNoteError(e, 'It could not be taken back.'));
    }
  }, []);

  return { notes, error, sending, send, cancel, reload: read, waiting: notes?.filter((n) => n.status === 'queued' || n.status === 'claimed').length ?? 0 };
}
