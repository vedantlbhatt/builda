/**
 * The director: under the trailer, a conversation with your Mac about it (docs/trailers.md).
 *
 * You write what you want in your own words ("make it shorter and orange", "open on the app",
 * `call it "RideGT"`); your Mac changes the cut, renders it again and answers with what it did. The
 * answer is the spec's sentences for the changes it made (`model.answerOf`), never a model's prose,
 * so what the screen says is what the new version is. Every answer names its version, and "go back
 * to version 2" is a note like any other. A project with no trailer yet can be sent a note too: the
 * Mac cuts the first version from the demo, then reads the note against it.
 *
 * The house rules: your words are the lead line, the Mac's answer sits under them against a column
 * of cells in the project's hue (the strip's own mark, not a bubble), and while the Mac is cutting,
 * three cells in the hue rise in turn, the `rise` order as a loop that stops the moment the answer
 * lands. The starters under the field are words you can tap, not buttons: each fills the field
 * with a note the Mac reads without a model. The parent pads it; it lays out to the width it gets.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { GROUND, SPECTRUM } from '../insights/palette';
import { InkField } from '../motion/InkField';
import { Button, T, TextField } from '../ui';
import { useReduceMotion } from '../ui/motion';
import { answerOf, canSend, conversation, doneMark, NOTE_MAX, onMacOnly, STARTERS, type TrailerNote } from './model';
import { useTrailerNotes } from './useNotes';

/** A cell, in points: the band's (tokens.dither.cell) doubled, so three read at a glance. */
const CELL = 6;
/** The cutting strip's height: a few rows of cells, a band, not a panel. */
const CUT_H = 22;

/** A hue's partner (the deep ink) from its ink, for the strip; the ink itself when unknown. */
function partnerOf(ink: string): string {
  const h = Object.values(SPECTRUM).find((x) => x.ink === ink);
  return h ? h.partner : ink;
}
/** The conversation shows its latest few; the rest are a tap away, as the changelog's are. */
const SHOWN = 4;

export function Director({
  projectKey,
  ink,
  kitVersion,
  onAnswer,
}: {
  projectKey: string;
  ink: string;
  /** The trailer version the kit on screen carries; null when it carries none. */
  kitVersion: number | null;
  /** An answer landed: the kit may carry the new version now. Resolves once it is read again. */
  onAnswer?: () => Promise<unknown> | void;
}) {
  const hasTrailer = kitVersion !== null;
  const { notes, error, sending, send, cancel, waiting } = useTrailerNotes(projectKey);
  // When a note turns done, the kit is read again before anything says the version is elsewhere.
  const mark = doneMark(notes);
  const seen = useRef<string | null>(null);
  const [settling, setSettling] = useState(false);
  useEffect(() => {
    if (notes === null) return;
    const first = seen.current === null;
    const changed = seen.current !== mark;
    seen.current = mark;
    if (first || !changed || !onAnswer) return;
    setSettling(true);
    void Promise.resolve(onAnswer()).finally(() => setSettling(false));
  }, [mark, notes, onAnswer]);
  const elsewhere = notes && !settling ? onMacOnly(notes, kitVersion) : null;
  const [text, setText] = useState('');
  const [all, setAll] = useState(false);
  const ok = canSend(text, waiting);
  const talk = notes ? conversation(notes) : [];
  const shown = all ? talk : talk.slice(-SHOWN);
  const earlier = talk.length - shown.length;
  const starters = hasTrailer ? STARTERS : ['make a trailer', ...STARTERS.slice(0, 2)];

  return (
    <View style={styles.wrap}>
      <T role="headline">{hasTrailer ? 'Direct it' : 'A trailer'}</T>
      {!hasTrailer && !talk.length ? (
        <T tone="dim">Your Mac cuts one from this demo, in the app's own pixels, and renders it in every shape.</T>
      ) : null}
      {earlier > 0 ? (
        <Pressable accessibilityRole="button" onPress={() => setAll(true)} hitSlop={8}>
          <T role="meta" tone="dim">{`${earlier} earlier`}</T>
        </Pressable>
      ) : null}
      {shown.length ? (
        <View style={styles.list}>
          {shown.map((n) => (
            <NoteRow key={n.id} note={n} ink={ink} onCancel={() => void cancel(n.id)} />
          ))}
        </View>
      ) : null}
      {elsewhere !== null ? (
        <T role="meta" tone="dim">{`Version ${elsewhere} is on your Mac. It shows here once its kit is published there.`}</T>
      ) : null}
      <View style={styles.field}>
        <TextField
          value={text}
          onChangeText={(t) => setText(t.slice(0, NOTE_MAX))}
          placeholder={hasTrailer ? 'What should change?' : 'What should it show?'}
          multiline
          maxLength={NOTE_MAX}
          accessibilityLabel={hasTrailer ? 'What should change in the trailer' : 'What the trailer should show'}
          style={styles.input}
        />
        <Button
          label="Send"
          kind="secondary"
          size="compact"
          block={false}
          disabled={!ok}
          busy={sending}
          busyLabel="Sending"
          onPress={() => {
            void send(text).then((sent) => {
              if (sent) setText('');
            });
          }}
        />
      </View>
      <View style={styles.starters}>
        {starters.map((s, i) => (
          <Pressable key={s} onPress={() => setText(s)} accessibilityRole="button" accessibilityLabel={`Write: ${s}`} hitSlop={8}>
            {({ pressed }) => <T role="meta" tone={pressed ? 'text' : 'dim'}>{i ? ` · ${s}` : s}</T>}
          </Pressable>
        ))}
      </View>
      {error ? (
        <T role="meta" tone="del">
          {error}
        </T>
      ) : null}
    </View>
  );
}

function NoteRow({ note, ink, onCancel }: { note: TrailerNote; ink: string; onCancel: () => void }) {
  const a = answerOf(note);
  return (
    <View style={styles.note}>
      <T role="row" weight={600}>
        {note.body}
      </T>
      <View style={styles.answer}>
        <View style={[styles.rule, { backgroundColor: a.kind === 'done' ? ink : GROUND.raised }]} />
        <View style={styles.answerWords}>
          {a.kind === 'cutting' ? <Cutting ink={ink} seed={note.id.charCodeAt(0) + note.id.length} /> : null}
          {a.kind === 'waiting' || a.kind === 'cutting' ? (
            <View style={styles.working}>
              {a.kind === 'waiting' ? <Working ink={ink} running={false} /> : null}
              <T role="meta" tone="dim">
                {a.line}
              </T>
              {note.status === 'queued' ? (
                <Pressable onPress={onCancel} accessibilityRole="button" accessibilityLabel="Take the note back" hitSlop={8}>
                  <T role="meta" tone="dim" weight={600}>
                    take back
                  </T>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {a.kind === 'done' ? (
            <>
              {a.lines.length ? (
                a.lines.map((l) => (
                  <T key={l} role="meta">
                    {l}
                  </T>
                ))
              ) : (
                <T role="meta">rendered again</T>
              )}
              {a.version !== null ? (
                <T role="mono" tone="dim">
                  {`version ${a.version}`}
                </T>
              ) : null}
            </>
          ) : null}
          {a.kind === 'refused' ? (
            <T role="meta" tone="dim">
              {a.line ?? 'Your Mac could not do that one.'}
            </T>
          ) : null}
          {a.kind === 'cancelled' ? (
            <T role="meta" tone="faint">
              {a.line}
            </T>
          ) : null}
        </View>
      </View>
    </View>
  );
}

/**
 * While the Mac cuts: a strip of the trailer's own ink, the fluid the wipe is made of, in the
 * project's hue, stirred by a swirl that crosses it like a render's playhead. It moves exactly as
 * long as the Mac works, and the answer replaces it. Under Reduce Motion it is the settled pool.
 */
function Cutting({ ink, seed }: { ink: string; seed: number }) {
  const [w, setW] = useState(0);
  const deep = partnerOf(ink);
  return (
    <View onLayout={(e) => setW(Math.round(e.nativeEvent.layout.width))} style={styles.cutting} accessible={false}>
      {w > 0 ? <InkField width={w} height={CUT_H} ink={ink} deep={deep} ground={GROUND.bg} playing restless seed={seed} /> : null}
    </View>
  );
}

/** Three cells, the first lit: the note is on the server and no Mac has it yet. */
function Working({ ink, running }: { ink: string; running: boolean }) {
  return (
    <View style={styles.cells} accessible={false}>
      {[0, 1, 2].map((i) => (
        <Cell key={i} i={i} ink={ink} running={running} />
      ))}
    </View>
  );
}

function Cell({ i, ink, running }: { i: number; ink: string; running: boolean }) {
  const reduce = useReduceMotion();
  const lit = useSharedValue(i === 0 ? 1 : 0.25);
  useEffect(() => {
    if (!running || reduce) {
      lit.value = i === 0 ? 1 : 0.25;
      return;
    }
    lit.value = withDelay(i * 160, withRepeat(withSequence(withTiming(1, { duration: 160 }), withTiming(0.25, { duration: 320 })), -1));
  }, [running, reduce, i, lit]);
  const style = useAnimatedStyle(() => ({ opacity: lit.value }));
  return <Animated.View style={[{ width: CELL, height: CELL, backgroundColor: ink, marginBottom: i * 2 }, style]} />;
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  list: { gap: 18, marginTop: 4 },
  note: { gap: 6 },
  answer: { flexDirection: 'row', gap: 12 },
  rule: { width: 3 },
  answerWords: { flex: 1, gap: 3 },
  working: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cutting: { height: CUT_H, marginBottom: 6, overflow: 'hidden' },
  cells: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: CELL + 4 },
  field: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginTop: 4 },
  input: { flex: 1, minHeight: 44 },
  starters: { flexDirection: 'row', flexWrap: 'wrap' },
});
