/**
 * A project with no demo yet: one empty print that says how to make one, in plain words, never a
 * spinner and never a stock picture (docs/demos.md). On a door it is a blank dark print lying on
 * the band, the two steps written on it. On the page it is an undeveloped print, the project's
 * hue as react-bits Dither's field (through its port, `src/ui/bits/backgrounds/FieldDither.tsx`,
 * which keeps David Haz's notice) held still, beside the two commands, each one copyable.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { type, Words } from '../insights/kit';
import { GROUND, SPECTRUM, type HueName } from '../insights/palette';
import { MONO_FAMILY } from '../theme';
import { SHAPE } from '../ui/shape';
import { FieldDither } from '../ui/bits/backgrounds';
import { CommandLine } from '../you/parts';
import { EMPTY_DEMO } from './model';

/** The blank print on a door: the same size as the prints a demo would fan there. */
export function DoorEmptyPrint({ width, height }: { width: number; height: number }) {
  return (
    <View
      accessible
      accessibilityLabel={EMPTY_DEMO.a11y}
      style={[styles.door, { width, height, transform: [{ rotate: '-3deg' }] }]}
    >
      <Text allowFontScaling={false} style={styles.doorTitle}>
        {EMPTY_DEMO.doorTitle}
      </Text>
      <Text allowFontScaling={false} style={styles.doorWords}>
        {EMPTY_DEMO.doorLead}
      </Text>
      {EMPTY_DEMO.doorMake.map((line) => (
        <Text key={line} allowFontScaling={false} numberOfLines={1} style={styles.doorCode}>
          {line}
        </Text>
      ))}
      <Text allowFontScaling={false} style={[styles.doorWords, { marginTop: 4 }]}>
        {EMPTY_DEMO.doorThen}
      </Text>
      <Text allowFontScaling={false} numberOfLines={1} style={styles.doorCode}>
        {EMPTY_DEMO.doorPublish}
      </Text>
    </View>
  );
}

/** The page's empty print, what it is beside it, and the two commands under both at full width. */
export function PageEmptyDemo({ hue, width }: { hue: HueName; width: number }) {
  const printW = Math.min(84, Math.round(width * 0.24));
  const printH = Math.round(printW * 2.17);
  const h = SPECTRUM[hue];
  return (
    <View style={{ gap: 14 }}>
      <View style={styles.page}>
        <View style={[styles.pagePrint, { width: printW, height: printH }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {/* Held on its first frame: an undeveloped print, not a moving background. */}
          <FieldDither width={printW} height={printH} ink={h.ink} partner={h.partner} paper={GROUND.bg} levels={2} speed={0} paused seed={3.1} />
        </View>
        <View style={styles.pageWords}>
          <Text maxFontSizeMultiplier={1.4} style={type.lead}>
            {EMPTY_DEMO.title}
          </Text>
          <Words style={type.dim}>{EMPTY_DEMO.lead}</Words>
        </View>
      </View>
      <CommandLine command={EMPTY_DEMO.make} color={h.ink} />
      <Words style={type.dim}>{EMPTY_DEMO.then}</Words>
      <CommandLine command={EMPTY_DEMO.publish} color={h.ink} />
    </View>
  );
}

const styles = StyleSheet.create({
  door: {
    backgroundColor: GROUND.bg,
    borderRadius: SHAPE.mark,
    borderCurve: 'continuous',
    paddingHorizontal: 10,
    paddingVertical: 12,
    gap: 2,
    justifyContent: 'flex-end',
  },
  doorTitle: { fontSize: 14, lineHeight: 17, fontWeight: '800', letterSpacing: -0.2, color: GROUND.text, marginBottom: 'auto' },
  doorWords: { fontSize: 11, lineHeight: 14, fontWeight: '500', color: GROUND.dim },
  doorCode: { fontFamily: MONO_FAMILY, fontSize: 10.5, lineHeight: 14, fontWeight: '600', color: GROUND.text },
  page: { flexDirection: 'row', gap: 16, alignItems: 'center' },
  pagePrint: { borderRadius: SHAPE.mark, borderCurve: 'continuous', overflow: 'hidden', transform: [{ rotate: '-3deg' }] },
  pageWords: { flex: 1, gap: 6 },
});
