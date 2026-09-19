/**
 * Web stand-in for `expo-symbols`, resolved ONLY when Metro bundles for `platform === 'web'`
 * (see `metro.config.js`). iOS draws the real SF Symbols; nothing here reaches a native build.
 *
 * `expo-symbols` has no web renderer: its `SymbolView` draws the `fallback` prop or nothing.
 * Eleven files import it directly (the tab bar, the gear, every door's arrow), so on web the tab
 * bar had four blank glyphs and You lost its Settings gear. Rather than touch each screen, this
 * module keeps the same export and draws the symbols the app actually names as 24 point
 * outline paths, in the stroke weight the symbol asked for; a `.fill` name fills where the
 * shape is closed. A name not in the table draws the caller's `fallback` if it gave one, and
 * otherwise holds its box empty rather than guessing a shape.
 */
import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { colors } from '../theme';

/** The canvas, cut out of a filled glyph's inner lines; and the ink when a caller names none. */
const KNOCKOUT = colors('dark').bg;
const DEFAULT_INK = colors('dark').text;

export type SFSymbol = string;
export type SymbolWeight =
  | 'unspecified'
  | 'ultraLight'
  | 'thin'
  | 'light'
  | 'regular'
  | 'medium'
  | 'semibold'
  | 'bold'
  | 'heavy'
  | 'black';
export type SymbolType = 'monochrome' | 'hierarchical' | 'palette' | 'multicolor';
export type SymbolScale = 'default' | 'unspecified' | 'small' | 'medium' | 'large';
export type AnimationSpec = { effect?: { type: string; wholeSymbol?: boolean; direction?: string }; repeating?: boolean; repeatCount?: number; speed?: number; variableAnimationSpec?: unknown };
export type ContentMode = string;

export interface SymbolViewProps {
  name: SFSymbol;
  type?: SymbolType;
  size?: number;
  weight?: SymbolWeight;
  scale?: SymbolScale;
  tintColor?: string | null;
  colors?: string | string[] | null;
  resizeMode?: ContentMode;
  animationSpec?: AnimationSpec;
  fallback?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  accessible?: boolean;
  accessibilityLabel?: string;
}

const STROKE: Record<SymbolWeight, number> = {
  unspecified: 1.8,
  ultraLight: 1,
  thin: 1.2,
  light: 1.5,
  regular: 1.8,
  medium: 2,
  semibold: 2.2,
  bold: 2.6,
  heavy: 2.9,
  black: 3.2,
};

type Shape = (ink: string, w: number, fill: boolean) => React.ReactNode;

const line = (d: string): Shape => (ink, w) => (
  <Path d={d} stroke={ink} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" fill="none" />
);
const solid = (d: string): Shape => (ink, w, fill) => (
  <Path d={d} stroke={ink} strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" fill={fill ? ink : 'none'} />
);

/** Base names; `<name>.fill` resolves to the same shape, filled. */
const SHAPES: Record<string, Shape> = {
  'arrow.right': line('M4 12h15M13 6l6 6-6 6'),
  'arrow.left': line('M20 12H5M11 6l-6 6 6 6'),
  'arrow.up': line('M12 20V5M6 11l6-6 6 6'),
  'arrow.down': line('M12 4v15M6 13l6 6 6-6'),
  'arrow.up.right': line('M7 17L17 7M9 7h8v8'),
  'arrow.clockwise': line('M19 12a7 7 0 1 1-2.05-4.95M19 4v4.5h-4.5'),
  'arrow.counterclockwise': line('M5 12a7 7 0 1 0 2.05-4.95M5 4v4.5h4.5'),
  'chevron.right': line('M9 5l7 7-7 7'),
  'chevron.left': line('M15 5l-7 7 7 7'),
  'chevron.down': line('M5 9l7 7 7-7'),
  'chevron.up': line('M5 15l7-7 7 7'),
  xmark: line('M6 6l12 12M18 6L6 18'),
  checkmark: line('M5 12.5l4.5 4.5L19 7'),
  plus: line('M12 5v14M5 12h14'),
  minus: line('M5 12h14'),
  bolt: solid('M13.5 2.5L5 13.5h6l-1.5 8 8.5-11h-6z'),
  'list.bullet.rectangle': (ink, w, fill) => (
    <>
      <Rect x={3} y={4.5} width={18} height={15} rx={3} stroke={ink} strokeWidth={w} fill={fill ? ink : 'none'} />
      <Path d="M7.5 9h.01M7.5 12h.01M7.5 15h.01M10.5 9h6M10.5 12h6M10.5 15h6" stroke={fill ? KNOCKOUT : ink} strokeWidth={w} strokeLinecap="round" />
    </>
  ),
  folder: solid('M3 7.5a2 2 0 0 1 2-2h4l2 2.2h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'),
  tray: (ink, w, fill) => (
    <>
      <Path d="M3 13l2.5-7.5h13L21 13v5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z" stroke={ink} strokeWidth={w} strokeLinejoin="round" fill={fill ? ink : 'none'} />
      <Path d="M3 13h5l1.5 2.5h5L16 13h5" stroke={fill ? KNOCKOUT : ink} strokeWidth={w} strokeLinejoin="round" fill="none" />
    </>
  ),
  gearshape: (ink, w) => (
    <>
      <Path
        d="M12 2.8l1.6 2.3 2.8-.5.6 2.8 2.5 1.3-1.1 2.6 1.1 2.6-2.5 1.3-.6 2.8-2.8-.5L12 21.2l-1.6-2.3-2.8.5-.6-2.8-2.5-1.3 1.1-2.6-1.1-2.6L7 8.7l.6-2.8 2.8.5z"
        stroke={ink}
        strokeWidth={w}
        strokeLinejoin="round"
        fill="none"
      />
      <Circle cx={12} cy={12} r={3.2} stroke={ink} strokeWidth={w} fill="none" />
    </>
  ),
  pencil: line('M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5zM13.5 7l3 3'),
  'hand.raised': solid('M8 13V6.5a1.5 1.5 0 0 1 3 0V11V4.5a1.5 1.5 0 0 1 3 0V11V6a1.5 1.5 0 0 1 3 0v8a7 7 0 0 1-12.4 4.5L3 15.5a1.6 1.6 0 0 1 2.5-2L8 15.5'),
  'square.and.arrow.up': line('M12 3v12M7.5 7.5L12 3l4.5 4.5M8 10.5H6a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 6 20.5h12a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5h-2'),
  'doc.on.doc': line('M9 7V5.5A1.5 1.5 0 0 1 10.5 4h8A1.5 1.5 0 0 1 20 5.5v10a1.5 1.5 0 0 1-1.5 1.5H17M5.5 7h8A1.5 1.5 0 0 1 15 8.5v10a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 4 18.5v-10A1.5 1.5 0 0 1 5.5 7z'),
  play: solid('M7 4.5v15l12-7.5z'),
  pause: solid('M7 5h3v14H7zM14 5h3v14h-3z'),
  waveform: line('M3 12h1M6 9v6M9 6v12M12 9v6M15 4v16M18 8v8M21 12h0'),
  clock: (ink, w) => (
    <>
      <Circle cx={12} cy={12} r={8.5} stroke={ink} strokeWidth={w} fill="none" />
      <Path d="M12 7.5V12l3 2" stroke={ink} strokeWidth={w} strokeLinecap="round" fill="none" />
    </>
  ),
  bell: solid('M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15zM10 20.5a2 2 0 0 0 4 0'),
  lock: (ink, w, fill) => (
    <>
      <Rect x={5} y={10.5} width={14} height={10} rx={2.5} stroke={ink} strokeWidth={w} fill={fill ? ink : 'none'} />
      <Path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" stroke={ink} strokeWidth={w} fill="none" />
    </>
  ),
  'lock.iphone': (ink, w) => (
    <>
      <Rect x={6} y={2.5} width={12} height={19} rx={3} stroke={ink} strokeWidth={w} fill="none" />
      <Rect x={9.5} y={11} width={5} height={4} rx={1} stroke={ink} strokeWidth={w * 0.8} fill="none" />
      <Path d="M10.5 11V9.8a1.5 1.5 0 0 1 3 0V11" stroke={ink} strokeWidth={w * 0.8} fill="none" />
    </>
  ),
  mic: line('M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM6 11a6 6 0 0 0 12 0M12 17v4'),
  magnifyingglass: line('M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM15.5 15.5L20 20'),
  'square.grid.2x2': solid('M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z'),
  'person.crop.circle': (ink, w) => (
    <>
      <Circle cx={12} cy={12} r={9} stroke={ink} strokeWidth={w} fill="none" />
      <Circle cx={12} cy={10} r={3} stroke={ink} strokeWidth={w} fill="none" />
      <Path d="M6.5 18.5a6.5 6.5 0 0 1 11 0" stroke={ink} strokeWidth={w} fill="none" />
    </>
  ),
  'rectangle.stack': line('M6 5h12M4.5 8h15M5 11h14a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 19 20H5a1.5 1.5 0 0 1-1.5-1.5v-6A1.5 1.5 0 0 1 5 11z'),
  'flag.checkered': line('M5 21V4M5 4h13l-2.5 4.5L18 13H5'),
  'xmark.circle': (ink, w, fill) => (
    <>
      <Circle cx={12} cy={12} r={9} stroke={ink} strokeWidth={w} fill={fill ? ink : 'none'} />
      <Path d="M9 9l6 6M15 9l-6 6" stroke={fill ? KNOCKOUT : ink} strokeWidth={w} strokeLinecap="round" />
    </>
  ),
  link: line('M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1'),
  'sidebar.left': (ink, w) => (
    <>
      <Rect x={3} y={4.5} width={18} height={15} rx={3} stroke={ink} strokeWidth={w} fill="none" />
      <Path d="M9 4.5v15" stroke={ink} strokeWidth={w} />
    </>
  ),
  laptopcomputer: line('M5 6.5A1.5 1.5 0 0 1 6.5 5h11A1.5 1.5 0 0 1 19 6.5V15H5zM2.5 18.5h19'),
  desktopcomputer: line('M3.5 5.5A1.5 1.5 0 0 1 5 4h14a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 16H5a1.5 1.5 0 0 1-1.5-1.5zM9 20h6M12 16v4'),
  qrcode: solid('M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2v2h-2zM18 14h2v2h-2z'),
  command: line('M9 9V6.5A2.5 2.5 0 1 0 6.5 9H9zm0 0h6M9 9v6m6-6V6.5A2.5 2.5 0 1 1 17.5 9H15zm0 0v6m0 0v2.5a2.5 2.5 0 1 0 2.5-2.5H15zm0 0H9m0 0v2.5A2.5 2.5 0 1 1 6.5 15H9z'),
};

function shapeOf(name: string): { shape: Shape | undefined; fill: boolean } {
  if (SHAPES[name]) return { shape: SHAPES[name], fill: false };
  if (name.endsWith('.fill')) {
    const base = name.slice(0, -'.fill'.length);
    if (SHAPES[base]) return { shape: SHAPES[base], fill: true };
  }
  return { shape: undefined, fill: false };
}

/** True when this build draws `name` on web (a test and the kit gallery read it). */
export function hasWebSymbol(name: string): boolean {
  return shapeOf(name).shape !== undefined;
}

export function SymbolView({ name, size = 24, weight = 'regular', tintColor, colors, fallback, style, accessible, accessibilityLabel }: SymbolViewProps) {
  const { shape, fill } = shapeOf(name);
  const ink = tintColor ?? (Array.isArray(colors) ? colors[0] : colors) ?? DEFAULT_INK;
  if (!shape) {
    if (fallback) return <>{fallback}</>;
    return <View style={[{ width: size, height: size }, style]} />;
  }
  return (
    <View
      style={[{ width: size, height: size }, style]}
      accessible={accessible}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityLabel ? 'image' : undefined}
    >
      <Svg width={size} height={size} viewBox="0 0 24 24">
        {shape(ink, STROKE[weight] ?? 1.8, fill)}
      </Svg>
    </View>
  );
}

export default { SymbolView };
