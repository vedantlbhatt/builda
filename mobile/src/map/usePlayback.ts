/**
 * The time lapse's clock: a playhead in session seconds that runs from where it is to the end
 * in its share of REPLAY_MS, linearly, on the UI thread (a replay of time runs at one speed;
 * an eased clock would make the start look busier than it was).
 *
 * The run ignores the system's Reduce Motion: the replay is what the person pressed Play to
 * see, not decoration, and a Reduce Motion timing would jump straight to the end. What does
 * honour it lives in the canvas (no pulse, no pop) and in the screen (no autoplay).
 *
 * A scrub pauses the run and, when it was playing, resumes it from wherever the finger let go.
 */
import { useCallback, useRef, useState } from 'react';
import { cancelAnimation, Easing, ReduceMotion, runOnJS, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

import { REPLAY_MS } from './view';

/** VoiceOver steps the replay a twentieth of the session at a time. */
export const STEPS = 20;

export interface Playback {
  playhead: SharedValue<number>;
  playing: boolean;
  /** The playhead is at the end: the last frame is on screen. */
  ended: boolean;
  /** The playhead as React last saw it (paused, ended, stepped): VoiceOver's value. */
  position: number;
  play: () => void;
  pause: () => void;
  replay: () => void;
  scrubStart: () => void;
  scrubEnd: () => void;
  step: (direction: 1 | -1) => void;
}

export function usePlayback(span: number, startAtEnd: boolean, onEnd?: () => void): Playback {
  const playhead = useSharedValue(startAtEnd ? span : 0);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(startAtEnd);
  const [position, setPosition] = useState(startAtEnd ? span : 0);
  const resume = useRef(false);
  const playingRef = useRef(false);
  playingRef.current = playing;
  const endRef = useRef(onEnd);
  endRef.current = onEnd;

  const finish = useCallback(() => {
    setPlaying(false);
    setEnded(true);
    setPosition(span);
    endRef.current?.();
  }, [span]);

  const run = useCallback(
    (from: number) => {
      const start = Math.min(span, Math.max(0, from));
      const duration = span > 0 ? ((span - start) / span) * REPLAY_MS : 0;
      cancelAnimation(playhead);
      playhead.value = start;
      playhead.value = withTiming(span, { duration, easing: Easing.linear, reduceMotion: ReduceMotion.Never }, (done) => {
        if (done) runOnJS(finish)();
      });
      setPlaying(true);
      setEnded(false);
    },
    [span, playhead, finish],
  );

  const pause = useCallback(() => {
    cancelAnimation(playhead);
    setPlaying(false);
    setPosition(playhead.value);
  }, [playhead]);

  const play = useCallback(() => run(playhead.value >= span ? 0 : playhead.value), [run, playhead, span]);
  const replay = useCallback(() => run(0), [run]);

  const scrubStart = useCallback(() => {
    resume.current = playingRef.current;
    cancelAnimation(playhead);
    setPlaying(false);
  }, [playhead]);

  const scrubEnd = useCallback(() => {
    const at = playhead.value;
    setPosition(at);
    setEnded(at >= span);
    if (resume.current && at < span) run(at);
    resume.current = false;
  }, [playhead, span, run]);

  const step = useCallback(
    (direction: 1 | -1) => {
      cancelAnimation(playhead);
      setPlaying(false);
      const t = Math.min(span, Math.max(0, playhead.value + (direction * span) / STEPS));
      playhead.value = t;
      setPosition(t);
      setEnded(t >= span);
    },
    [playhead, span],
  );

  return { playhead, playing, ended, position, play, pause, replay, scrubStart, scrubEnd, step };
}
