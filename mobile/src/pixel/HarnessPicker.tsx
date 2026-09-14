import React, { useCallback, useMemo, useState } from 'react';
import { PixelRatio, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import { harnessHue, typeRoles, type HueName, type Scheme } from '../theme';
import { PixelCard } from '../ui/bits/components/PixelCard';
import { PIXEL } from '../ui/bits/components/spec';
import { select } from '../ui/haptics';
import { SchemeProvider, useScheme } from '../ui/scheme';
import { HarnessGlyph } from './HarnessGlyph';
import {
  HARNESS_MARKS,
  PICKER,
  isMarkSelected,
  sessionsFor,
  statusLine,
  tileWidthInside,
  toggleMark,
  type Harness,
  type HarnessMark,
} from './harness';
import { harnessTileInks, type TileInks } from './palette';

export interface HarnessPickerProps {
  /** The wire values chosen. Cursor's tile stands for both `cursor_ide` and `cursor_agent`. */
  selected: readonly Harness[];
  onChange: (next: Harness[]) => void;
  /**
   * Sessions the paired Mac found, per wire value. Omit it before pairing and the tiles carry
   * no status line at all; a count of 0 reads "not found" and dims the glyph (still tappable).
   */
  found?: Partial<Record<Harness, number>>;
  /** Default: the kit's `SchemeProvider` (dark unless a surface says otherwise). */
  scheme?: Scheme;
  /** Which marks to offer, in order. Default: all seven (`HARNESS_MARKS`). */
  marks?: readonly HarnessMark[];
  /** Put it inside the screen's 16 pt gutter; the picker fills the width it is given. */
  style?: StyleProp<ViewStyle>;
}

/** A tile is a fixed 88 pt tall, so its two lines of text scale only this far. */
const TEXT_SCALE_MAX = 1.15;

/**
 * The one harness picker (DESIGN-DIRECTION 5, recoloured by DESIGN-V2 2.4): onboarding step 3,
 * filters and settings all use it. Three columns of 88 pt tiles on `raised`, radius 18 with a
 * continuous curve; the 32 pt glyph 12 pt from the top, the name (13/600) and the status line
 * (12/400) under it, all left aligned.
 *
 * Every tile is its harness's hue (the owner's 2026-09-13 override: "why are all of them the same
 * color?"). Idle: the glyph in its hue on `raised`. Selected: the tile FILLS with that hue and the
 * glyph, name and status turn `#1C1917` (5.2:1 on iris, the lowest; `palette.tileInks`), with a
 * `select` haptic on the same frame. A solid fill with dark ink, never the tinted chip. Amber is
 * not on any tile: it is Builda's action colour, and the Continue under the picker is amber.
 *
 * Each tile is the kit's react-bits PixelCard (`ui/bits/components/PixelCard.tsx`), the one
 * selected state creature and harness tiles share: 3 pt cells of the hue grow out of the finger,
 * nearest first with a ragged front, into the solid fill over 240 ms, and retract into it at
 * 0.7x when the tile is let go. Colour enters by cells, never as a hue at half opacity over the
 * ground (the brown frame DESIGN-V2 1.3 bans). The glyph and the words flip to `#1C1917` on the
 * frame the fill passes half way (`PIXEL.flipAt`), so a glyph never sits in its hue over half a
 * fill. Under Reduce Motion the fill cross fades in 120 ms (`PICKER.fadeMs`) and nothing moves.
 */
export function HarnessPicker({ selected, onChange, found, scheme, marks = HARNESS_MARKS, style }: HarnessPickerProps) {
  const contextScheme = useScheme();
  const resolved = scheme ?? contextScheme;
  const { width: screen } = useWindowDimensions();
  const [inner, setInner] = useState<number | null>(null);
  const onLayout = useCallback((e: LayoutChangeEvent) => setInner(e.nativeEvent.layout.width), []);
  // Floor to whole device pixels: three tiles rounded UP by a pixel each no longer fit in a
  // row, and flexWrap would quietly push the third one down.
  const scale = PixelRatio.get();
  const tileW = Math.floor(tileWidthInside(inner ?? screen - 2 * PICKER.gutter) * scale) / scale;

  // Controlled: the next selection is computed from the one the parent passed in. The haptic
  // fires on the same frame as the change (3.6), once per tap, never on a re-render.
  const toggle = useCallback(
    (mark: HarnessMark) => {
      select();
      onChange(toggleMark(selected, mark));
    },
    [onChange, selected],
  );

  return (
    <View onLayout={onLayout} style={[{ flexDirection: 'row', flexWrap: 'wrap', gap: PICKER.gap }, style]}>
      {marks.map((m) => (
        <HarnessTile
          key={m.id}
          mark={m}
          width={tileW}
          selected={isMarkSelected(selected, m)}
          sessions={sessionsFor(m, found)}
          scheme={resolved}
          onPress={toggle}
        />
      ))}
    </View>
  );
}

/** The fill's arrival with motion on: PixelCard's 240 ms (DESIGN-V2 3.2, the tools step). */
export const FILL_MS = PIXEL.ms;

/**
 * The hue a mark's tile wears. Every mark id is a key of `spectrum.harness`
 * (`__tests__/spectrum.test.ts`), so the fallback is unreachable; it is a hue rather than a
 * throw so a table edit can never take the onboarding step down.
 */
function tileHue(mark: HarnessMark, scheme: Scheme): HueName {
  return harnessHue(mark.id, scheme)?.name ?? 'cobalt';
}

function HarnessTile({
  mark,
  width,
  selected,
  sessions,
  scheme,
  onPress,
}: {
  mark: HarnessMark;
  width: number;
  selected: boolean;
  sessions: number | undefined;
  scheme: Scheme;
  onPress: (mark: HarnessMark) => void;
}) {
  const status = statusLine(sessions);
  const missing = sessions === 0;
  // The tile's words come from `tileInks`, not PixelCard's defaults: a missing tool's glyph is
  // `textFaint`, and on light the idle glyph is the hue's text tone (the mark tone is 2.9:1 on
  // the light `raised`). On the fill both agree: `#1C1917`.
  const rest = useMemo(() => harnessTileInks(mark.id, missing ? 'missing' : 'idle', scheme), [mark.id, missing, scheme]);
  const lit = useMemo(() => harnessTileInks(mark.id, 'selected', scheme), [mark.id, scheme]);
  const press = useCallback(() => onPress(mark), [onPress, mark]);

  return (
    // PixelCard reads the scheme from the kit's context; a picker given `scheme` passes it on.
    <SchemeProvider scheme={scheme}>
      <PixelCard
        hue={tileHue(mark, scheme)}
        selected={selected}
        onPress={press}
        haptic={null}
        width={width}
        height={PICKER.tileHeight}
        padding={0}
        accessibilityLabel={status ? `${mark.name}, ${status}` : mark.name}
      >
        {(face) => <TileFace mark={mark} inks={face.filled ? lit : rest} status={status} />}
      </PixelCard>
    </SchemeProvider>
  );
}

/** What a tile shows in one state. PixelCard swaps the two as its fill passes half way. */
function TileFace({ mark, inks, status }: { mark: HarnessMark; inks: TileInks; status: string | null }) {
  const meta = typeRoles.meta;
  const small = typeRoles.label;
  return (
    <View style={styles.face}>
      {/* The glyph's 16x16 box has a 2-cell (4 pt) margin around its live area: pull it
          4 pt left so the drawing, not the box, lines up with the name under it. */}
      <HarnessGlyph harness={mark.harnesses[0]!} size={PICKER.glyph} color={inks.mark} style={styles.glyph} />
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={TEXT_SCALE_MAX}
        style={{ marginTop: 6, fontSize: meta.size, lineHeight: Math.round(meta.size * meta.line), fontWeight: '600', color: inks.name }}
      >
        {mark.name}
      </Text>
      {status ? (
        <Text
          numberOfLines={1}
          maxFontSizeMultiplier={TEXT_SCALE_MAX}
          style={{
            fontSize: small.size,
            lineHeight: Math.round(small.size * 1.3),
            fontWeight: '400',
            color: inks.status,
            fontVariant: ['tabular-nums'],
          }}
        >
          {status}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // No flex: PixelCard lays its face out at its content's height, and a flex basis of 0 there
  // collapsed the two lines of text to nothing (seen in the simulator).
  face: {
    paddingHorizontal: 14,
    paddingTop: PICKER.glyphTop,
  },
  glyph: {
    marginLeft: -4,
  },
});
