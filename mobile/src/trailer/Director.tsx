/**
 * The director: under the trailer, a conversation with your Mac about it (docs/trailers.md).
 *
 * You write what you want in your own words ("make it shorter and orange", "open on the app",
 * `call it "RideGT"`); your Mac changes the cut, renders it again and answers with what it did. The
 * answer is the spec's sentences for the changes it made (`model.answerOf`), never a model's prose,
 * so what the screen says is what the new version is. Every answer names its version, and "go back
 * to version 2" is a note like any other.
 *
 * The house rules: your words are the lead line, the Mac's answer sits under them against a column
 * of cells in the project's hue (the strip's own mark, not a bubble), and while the Mac is cutting,
 * three cells in the hue rise in turn, the `rise` order as a loop that stops the moment the answer
 * lands. The starters under the field are words you can tap, not buttons: each fills the field
 * with a note the Mac reads without a model.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { GUTTER, type } from '../insights/kit';
import { GROUND, SPECTRUM, type HueName } from '../insights/palette';
import { Button, TextField } from '../ui';
import { useReduceMotion } from '../ui/motion';
import { answerOf, canSend, NOTE_MAX, STARTERS, type TrailerNote } from './model';
import { useTrailerNotes } from './useNotes';

/** A cell, in points: the band's (tokens.dither.cell) doubled, so three read at a glance. */
const CELL = 6;

export function Director({ projectKey, hue }: { projectKey: string; hue: HueName }) {
  const { notes, error, sending, send, cancel, waiting } = useTrailerNotes(projectKey);
  const [text, setText] = useState('');
  const ink = SPECTRUM[hue].ink;
  const ok = canSend(text, waiting);

  return (
    <View style={styles.wrap}>
      <Text maxFontSizeMultiplier={1.4} style={type.heading}>
        Direct it
      </Text>
      {notes && notes.length ? (
        <View style={styles.list}>
          {notes.map((n) => (
            <NoteRow key={n.id} note={n} ink={ink} onCancel={() => void cancel(n.id)} />
          ))}
        </View>
      ) : null}
      <View style={styles.field}>
        <TextField
          value={text}
          onChangeText={(t) => setText(t.slice(0, NOTE_MAX))}
          placeholder="What should change?"
          multiline
          maxLength={NOTE_MAX}
          accessibilityLabel="What should change in the trailer"
          style={styles.input}
        />
        <Button
          label="Send"
          kind="primary"
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
        {STARTERS.map((s, i) => (
          <Pressable key={s} onPress={() => setText(s)} accessibilityRole="button" accessibilityLabel={`Write: ${s}`} hitSlop={8}>
            {({ pressed }) => (
              <Text maxFontSizeMultiplier={1.4} style={[type.dim, { color: pressed ? GROUND.text : GROUND.dim }]}>
                {i ? ` · ${s}` : s}
              </Text>
            )}
          </Pressable>
        ))}
      </View>
      {error ? (
        <Text maxFontSizeMultiplier={1.4} style={type.dim}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function NoteRow({ note, ink, onCancel }: { note: TrailerNote; ink: string; onCancel: () => void }) {
  const a = answerOf(note);
  return (
    <View style={styles.note}>
      <Text maxFontSizeMultiplier={1.4} style={type.lead}>
        {note.body}
      </Text>
      <View style={styles.answer}>
        <View style={[styles.rule, { backgroundColor: a.kind === 'done' ? ink : GROUND.raised }]} />
        <View style={styles.answerWords}>
          {a.kind === 'waiting' || a.kind === 'cutting' ? (
            <View style={styles.working}>
              <Working ink={ink} running={a.kind === 'cutting'} />
              <Text maxFontSizeMultiplier={1.4} style={type.body}>
                {a.line}
              </Text>
              {note.status === 'queued' ? (
                <Pressable onPress={onCancel} accessibilityRole="button" accessibilityLabel="Take the note back" hitSlop={8}>
                  <Text maxFontSizeMultiplier={1.4} style={type.dim}>
                    take back
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {a.kind === 'done' ? (
            <>
              {a.lines.map((l) => (
                <Text key={l} maxFontSizeMultiplier={1.4} style={type.body}>
                  {l}
                </Text>
              ))}
              {a.version !== null ? (
                <Text maxFontSizeMultiplier={1.4} style={type.mono}>
                  {`version ${a.version}`}
                </Text>
              ) : null}
            </>
          ) : null}
          {a.kind === 'refused' && a.line ? (
            <Text maxFontSizeMultiplier={1.4} style={type.body}>
              {a.line}
            </Text>
          ) : null}
          {a.kind === 'cancelled' ? (
            <Text maxFontSizeMultiplier={1.4} style={type.dim}>
              {a.line}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

/** Three cells rising in turn while the Mac works; still (the first lit) under Reduce Motion. */
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
  wrap: { paddingHorizontal: GUTTER, gap: 14 },
  list: { gap: 18 },
  note: { gap: 8 },
  answer: { flexDirection: 'row', gap: 12 },
  rule: { width: 3 },
  answerWords: { flex: 1, gap: 4 },
  working: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cells: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: CELL + 4 },
  field: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  input: { flex: 1, minHeight: 44 },
  starters: { flexDirection: 'row', flexWrap: 'wrap' },
});
