import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { space } from '../theme';
import { toneColor, useColors, type Tone } from './scheme';
import { T } from './Text';

import { VERDICT_PATHS, VERDICT_VIEWBOX, verdictDash, verdictStroke, type Verdict } from './verdicts';

export { VERDICTS, type Verdict } from './verdicts';

export interface VerdictGlyphProps {
  verdict: Verdict;
  /** Points. 12 on a tile. Default 12. */
  size?: number;
  tone?: Extract<Tone, 'dim' | 'text' | 'faint'>;
  style?: StyleProp<ViewStyle>;
}

export function VerdictGlyph({ verdict, size = 12, tone = 'dim', style }: VerdictGlyphProps) {
  const c = useColors();
  const spec = VERDICT_PATHS[verdict];
  // 2pt on screen whatever the size: the stroke is in viewBox units.
  const stroke = verdictStroke(size);
  return (
    <Svg width={size} height={size} viewBox={`-1 -1 ${VERDICT_VIEWBOX} ${VERDICT_VIEWBOX}`} style={style} accessibilityElementsHidden>
      <Path
        d={spec.d}
        stroke={toneColor(c, tone)}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={spec.dashed ? verdictDash(stroke) : undefined}
        fill="none"
      />
    </Svg>
  );
}

export interface VerdictProps {
  verdict: Verdict;
  style?: StyleProp<ViewStyle>;
}

/** The glyph and the word, 13/500 `textDim`: "circling". The word is the information. */
export function VerdictLabel({ verdict, style }: VerdictProps) {
  return (
    <View
      accessible
      accessibilityLabel={verdict}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: space.xs }, style]}
    >
      <VerdictGlyph verdict={verdict} />
      <T role="meta" tone="dim" weight={500}>
        {verdict}
      </T>
    </View>
  );
}
