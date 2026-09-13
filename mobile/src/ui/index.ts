/**
 * Builda's UI kit (DESIGN-DIRECTION 3, 6, 7 and 8). Every screen builds from these; the
 * tokens they draw with live in design/tokens.json and nowhere else.
 *
 * Pure modules (`motionSpec`, `shape`, `typeStyle`, `digits`, `format`, `decrypt`, `dithering`,
 * `verdicts`, `hapticsGate`) import no React Native, so `bun test` can hold them.
 */

// vocabulary
export * from './motion';
export { haptics, select, snap, commit, success, failure, HAPTIC_KINDS, type HapticKind } from './haptics';
export { SchemeProvider, useScheme, useColors, toneColor, type Palette, type Tone } from './scheme';
export { SHAPE, RADIUS_SCALE, concentric, DASHED_FRAME_RADIUS, type ShapeName } from './shape';
export { roleStyle, roleScaling, ROLES, type RoleWeight } from './typeStyle';

// text and surfaces
export { T, type TProps } from './Text';
export { Surface, type SurfaceLevel, type SurfaceProps } from './Surface';
export { Hairline, type HairlineProps } from './Hairline';
export { Row, type RowProps } from './Row';
export { Section, type SectionProps } from './Section';
export { Stat, StatGrid, type StatItem, type StatProps, type StatGridProps } from './Stat';

// actions and chrome
export { Button, type ButtonKind, type ButtonProps } from './Button';
export { TextField, type TextFieldProps } from './TextField';
export { PressableScale, usePressFeedback, type PressableScaleProps } from './PressableScale';
export { SymbolIcon, type SymbolIconProps } from './Symbol';

// drawn marks
export { Bar, type BarProps } from './Bar';
export { Ring, ringStroke, dottedTrack, type RingProps } from './Ring';
export { VerdictGlyph, VerdictLabel, VERDICTS, type Verdict, type VerdictGlyphProps } from './VerdictGlyph';
export { DashedFrame, type DashedFrameProps } from './DashedFrame';
export { Dots } from './Dots';

// numbers and text effects
export { Counter, type CounterProps } from './Counter';
export { CountUp, type CountUpProps } from './CountUp';
export { DecryptedText, type DecryptedTextProps } from './DecryptedText';
export { formatCount, decimalsOf } from './format';

// texture
export { Dither, DitherField, fieldImage, type DitherProps, type DitherFieldProps } from './Dither';
export {
  DITHER_SKSL,
  bayer8,
  ditherMask,
  fieldFromFunction,
  fieldFromGrid,
  fieldFromSeries,
  fitCells,
  type DitherMode,
  type Field,
} from './dithering';

// The dev gallery is deliberately NOT exported here: Metro does not tree-shake, so a screen
// importing this barrel would ship the gallery. Import it from './KitGallery' directly.
