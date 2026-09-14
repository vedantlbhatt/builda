/**
 * What happened, in words: the plain English paragraph (`summary.ts`, the engine's sentences
 * placed whole and in order) set one sentence to a line, each arriving on the chapter's clock a
 * beat after the one before, then still and selectable, since a person may want to paste it
 * somewhere. Under it, when the sitting had any, the notes worth a second look, with the heading
 * that names what they cost together.
 *
 * The title that used to sit here is on the hero band now; this file keeps its name because the
 * words are still what it holds. House style rule 4: plain sentences between the figures, left
 * aligned, one idea each, never scolding.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { GUTTER, Kicker, type, Words } from '../insights/kit';
import { GROUND } from '../insights/palette';
import { Block } from '../insights/reveal';
import type { WordsModel } from './page';
import { Arrive } from './parts';

/** The gap between one sentence arriving and the next. */
const SENTENCE_STEP_MS = 240;

export function SessionWords({ words }: { words: WordsModel }) {
  if (!words.sentences.length && !words.notes.length) return null;
  return (
    <>
      {words.sentences.length ? (
        <Block style={styles.block}>
          <Kicker>what happened</Kicker>
          <View style={styles.sentences}>
            {words.sentences.map((s, i) => (
              <Arrive key={`${i}${s}`} delay={80 + i * SENTENCE_STEP_MS}>
                <Text selectable maxFontSizeMultiplier={1.6} style={type.body}>
                  {s}
                </Text>
              </Arrive>
            ))}
          </View>
        </Block>
      ) : null}
      {words.notes.length ? (
        <Block style={styles.block}>
          <Kicker>worth a second look</Kicker>
          {words.notesHeading ? <Words style={type.heading}>{words.notesHeading}</Words> : null}
          <View style={styles.notes}>
            {words.notes.map((n, i) => (
              <View key={n.id} style={[styles.note, i > 0 ? styles.hairTop : null]}>
                <Words style={type.body}>{n.text}</Words>
              </View>
            ))}
          </View>
          <Words style={[type.meta, styles.after]}>
            Measured on your machine. The command that kept failing and the file that was rewritten stay there; only the counts travel.
          </Words>
        </Block>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  block: { paddingHorizontal: GUTTER, marginTop: 30 },
  sentences: { gap: 10 },
  notes: { marginTop: 10 },
  note: { paddingVertical: 10 },
  hairTop: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: GROUND.border },
  after: { marginTop: 8 },
});
