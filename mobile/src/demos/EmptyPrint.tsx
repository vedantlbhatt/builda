/**
 * A project with no demo yet: one empty print that says how to make one, in plain words, never a
 * spinner and never a stock picture (docs/demos.md). On a door it is a blank dark print lying on
 * the band, saying where to ask for one. On the page it is a blank print beside the ask and the
 * two commands, each one copyable.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { type, Words } from '../insights/kit';
import { GROUND, SPECTRUM, type HueName } from '../insights/palette';
import { MONO_FAMILY } from '../theme';
import { SHAPE } from '../ui/shape';
import { Button } from '../ui/Button';
import { useIslandActivities } from '../island/store';
import { withAlpha } from '../motion/states';
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
      <Text allowFontScaling={false} style={styles.doorWords}>
        {EMPTY_DEMO.doorThen}
      </Text>
    </View>
  );
}

/**
 * The page's empty print, what it is beside it, the ask, and the two commands under it for the
 * terminal. The ask comes first because it is the one step a phone can take: it opens the ship
 * kit, whose button asks the Mac to film it (`docs/ship-kit.md`), and the island carries the
 * request from there. The print is a blank phone print in the project's hue, held at the same
 * tilt as a real one would lie; it was a frozen dither field, and a field of pixel noise read as
 * a broken image rather than an empty one.
 */
export function PageEmptyDemo({ hue, width, onAsk, projectKey }: { hue: HueName; width: number; onAsk?: () => void; projectKey?: string }) {
  const printW = Math.min(84, Math.round(width * 0.24));
  const printH = Math.round(printW * 2.17);
  const h = SPECTRUM[hue];
  // Asked already: the island is carrying it (`trackDemo`), and the page says the same thing
  // rather than offering to ask twice. Pressing still opens the kit, where it can be taken back.
  const pending = useIslandActivities().find((a) => a.kind === 'demo' && a.projectKey === projectKey && !a.ready);
  const askLabel = pending?.kind === 'demo' ? (pending.filming ? EMPTY_DEMO.filming : EMPTY_DEMO.asked) : EMPTY_DEMO.ask;
  return (
    <View style={{ gap: 14 }}>
      <View style={styles.page}>
        <View style={[styles.pagePrint, { width: printW, height: printH, backgroundColor: GROUND.card }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={[styles.printScreen, { backgroundColor: withAlpha(h.ink, 0.2), borderColor: withAlpha(h.ink, 0.45) }]} />
        </View>
        <View style={styles.pageWords}>
          <Text maxFontSizeMultiplier={1.4} style={type.lead}>
            {EMPTY_DEMO.title}
          </Text>
          <Words style={type.dim}>{EMPTY_DEMO.lead}</Words>
        </View>
      </View>
      {onAsk ? <Button label={askLabel} kind={pending ? 'secondary' : 'primary'} onPress={onAsk} size="compact" /> : null}
      <Words style={type.dim}>{EMPTY_DEMO.or}</Words>
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
  doorWords: { fontSize: 12, lineHeight: 15, fontWeight: '500', color: GROUND.dim },
  doorCode: { fontFamily: MONO_FAMILY, fontSize: 10.5, lineHeight: 14, fontWeight: '600', color: GROUND.text },
  page: { flexDirection: 'row', gap: 16, alignItems: 'center' },
  pagePrint: { borderRadius: SHAPE.mark, borderCurve: 'continuous', overflow: 'hidden', transform: [{ rotate: '-3deg' }], padding: 5 },
  printScreen: { flex: 1, borderRadius: SHAPE.mark - 3, borderCurve: 'continuous', borderWidth: 1 },
  pageWords: { flex: 1, gap: 6 },
});
