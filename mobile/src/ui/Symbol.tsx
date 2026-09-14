import { SymbolView, type SFSymbol, type SymbolWeight } from 'expo-symbols';
import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { toneColor, useColors, type Tone } from './scheme';

export interface SymbolIconProps {
  name: SFSymbol;
  /** Points. 17 in rows (regular), the tab bar's own size there. Default 17. */
  size?: number;
  /** Regular in rows, semibold in the tab bar. Default regular. */
  weight?: SymbolWeight;
  /** Default `dim`. Chrome is never a data hue. */
  tone?: Exclude<Tone, 'add' | 'del' | 'human'>;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * An SF Symbol, the family for all chrome and actions (DESIGN-DIRECTION 5). Named
 * `SymbolIcon` so importing it never shadows the global `Symbol`. Pixel glyphs (harnesses,
 * creatures) are the other family and never share an element with this one.
 *
 * SF Symbols exist only on Apple platforms; elsewhere the few chrome shapes the app uses
 * are drawn as paths, and anything else holds its space empty rather than guessing.
 */
export function SymbolIcon({ name, size = 17, weight = 'regular', tone = 'dim', accessibilityLabel, style }: SymbolIconProps) {
  const c = useColors();
  const color = toneColor(c, tone);
  const decorative = accessibilityLabel === undefined;
  return (
    <SymbolView
      name={name}
      size={size}
      weight={weight}
      tintColor={color}
      type="monochrome"
      resizeMode="scaleAspectFit"
      accessible={!decorative}
      accessibilityLabel={accessibilityLabel}
      style={[{ width: size, height: size }, style]}
      fallback={<FallbackSymbol name={name} size={size} color={color} style={style} />}
    />
  );
}

const FALLBACK_PATHS: Partial<Record<string, string>> = {
  'chevron.right': 'M9 5l7 7-7 7',
  'chevron.left': 'M15 5l-7 7 7 7',
  'chevron.down': 'M5 9l7 7 7-7',
  'xmark': 'M6 6l12 12M18 6L6 18',
  'checkmark': 'M5 12.5l4.5 4.5L19 7',
  'plus': 'M12 5v14M5 12h14',
};

function FallbackSymbol({ name, size, color, style }: { name: string; size: number; color: string; style?: StyleProp<ViewStyle> }) {
  const d = FALLBACK_PATHS[name];
  if (!d) return <View style={[{ width: size, height: size }, style]} />;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" style={style}>
      <Path d={d} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}
