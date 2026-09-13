/**
 * Every Wrapped state that is not a deck, as a card of the deck: a full band in the builder's
 * own hue (the theme), what is missing said plainly in its dark ink, the one thing that helps as
 * words with an arrow (the house style: navigation is words), and the builder's creature printed
 * large under them, the way Duolingo lets Duo carry an empty state (~200pt, above the action).
 * The words rise and the creature prints once, off the analysis page's reveal clock; Reduce
 * Motion: all of it simply there.
 */
import { SymbolView } from 'expo-symbols';
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BandWords } from '../insights/Band';
import { Block, RevealPage, Section, usePageReveal } from '../insights/reveal';
import type { Animal } from '../pixel/animals';
import { TAP_TARGET, type Hue } from '../theme';
import { useReduceMotion } from '../ui/motion';
import { SHAPE } from '../ui/shape';
import { PrintedCreature } from './Creature';
import { ON_BAND, OPEN_HOLD_MS } from './story';

export interface EmptyBandProps {
  width: number;
  height: number;
  hue: Hue;
  animal: Animal;
  title: string;
  text: string;
  action: string;
  onAction: () => void;
  busy?: boolean;
  busyLabel?: string;
}

export function EmptyBand({ width, height, hue, animal, title, text, action, onAction, busy = false, busyLabel }: EmptyBandProps) {
  const reduce = useReduceMotion();
  const page = usePageReveal(reduce);
  useEffect(() => {
    page.viewport.value = 1_000_000;
    const t = setTimeout(() => {
      page.armed.value = 1;
    }, OPEN_HOLD_MS);
    return () => clearTimeout(t);
  }, [page]);
  const creature = Math.max(96, Math.min(208, Math.floor((height * 0.36) / 16) * 16, Math.floor((width * 0.6) / 16) * 16));
  return (
    <RevealPage page={page}>
      <Section style={{ width, height }}>
        <Block enter={false} style={styles.fill}>
          <View style={[styles.band, { width, height, backgroundColor: hue.ink }]}>
            <View style={styles.words}>
              <BandWords delay={160}>
                <Text accessibilityRole="header" maxFontSizeMultiplier={1.3} style={styles.title}>
                  {title}
                </Text>
              </BandWords>
              <BandWords delay={280}>
                <Text maxFontSizeMultiplier={1.4} style={styles.text}>
                  {text}
                </Text>
              </BandWords>
              <BandWords delay={400}>
                <Pressable
                  onPress={onAction}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={busy ? (busyLabel ?? action) : action}
                  accessibilityState={{ busy }}
                  style={({ pressed }) => [styles.link, { opacity: pressed || busy ? 0.6 : 1 }]}
                >
                  <Text maxFontSizeMultiplier={1.3} style={styles.linkText}>
                    {busy ? (busyLabel ?? action) : action}
                  </Text>
                  <SymbolView name="arrow.right" tintColor={ON_BAND} weight="bold" size={18} />
                </Pressable>
              </BandWords>
            </View>
            <View style={styles.stage}>
              <PrintedCreature animal={animal} size={creature} color={ON_BAND} at={120} />
            </View>
          </View>
        </Block>
      </Section>
    </RevealPage>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  band: { borderRadius: SHAPE.wrapped, borderCurve: 'continuous', overflow: 'hidden' },
  words: { paddingHorizontal: 22, paddingTop: 24, gap: 12 },
  title: { fontSize: 30, lineHeight: 34, fontWeight: '800', letterSpacing: -0.6, color: ON_BAND },
  text: { fontSize: 17, lineHeight: 23, fontWeight: '500', color: ON_BAND, opacity: 0.85 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: TAP_TARGET, alignSelf: 'flex-start' },
  linkText: { fontSize: 20, lineHeight: 25, fontWeight: '700', color: ON_BAND },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 28 },
});
