import { MONO_FAMILY, typeRoles, type TypeRole } from '../theme';

/**
 * The nine type roles as React Native text style (DESIGN-DIRECTION 3.3). Pure, so the tests
 * can check it, and so a component that is not a `<T>` (the count up's TextInput, a
 * Counter numeral) can wear the same role.
 *
 * Every role is tabular: a number anywhere in the app lines up with the number above it
 * and does not jitter while it changes, and tabular figures cost prose nothing.
 */
export type RoleWeight = 400 | 500 | 600 | 700 | 800;

export interface RoleTextStyle {
  fontSize: number;
  fontWeight: '400' | '500' | '600' | '700' | '800';
  letterSpacing: number;
  lineHeight: number;
  fontVariant: ['tabular-nums'];
  fontFamily?: string;
}

export interface RoleScaling {
  allowFontScaling: boolean;
  /** Undefined when the role does not scale at all. */
  maxFontSizeMultiplier?: number;
}

export const ROLES = Object.keys(typeRoles) as TypeRole[];

export function roleStyle(role: TypeRole, weight?: RoleWeight): RoleTextStyle {
  const r = typeRoles[role];
  const style: RoleTextStyle = {
    fontSize: r.size,
    fontWeight: String(weight ?? r.weight) as RoleTextStyle['fontWeight'],
    letterSpacing: r.tracking,
    lineHeight: Math.round(r.size * r.line),
    fontVariant: ['tabular-nums'],
  };
  if ('design' in r && r.design === 'monospaced') style.fontFamily = MONO_FAMILY;
  return style;
}

/**
 * Dynamic Type. `hero`, `display` and `label` are fixed (a stat grid breaks otherwise);
 * `body` and `meta` scale with the reader up to 2x; titles, rows and mono scale to 1.5x,
 * which keeps a fixed-height tile legible without letting it overflow.
 */
export function roleScaling(role: TypeRole): RoleScaling {
  const max = typeRoles[role].maxScale;
  return max <= 1 ? { allowFontScaling: false } : { allowFontScaling: true, maxFontSizeMultiplier: max };
}

/**
 * Amber text is legible only at 13pt semibold or larger, and only on dark (~10:1 on the
 * dark canvas, ~1.7:1 on the light one). Returns the reason it is not allowed, or null.
 */
export function amberTextProblem(role: TypeRole, weight: number, scheme: 'light' | 'dark'): string | null {
  if (scheme === 'light') return 'amber text is 1.7:1 on the light canvas; use an amber dot beside text';
  const r = typeRoles[role];
  if (r.size < 13) return `amber text needs 13pt or larger; ${role} is ${r.size}pt`;
  if (weight < 600) return `amber text needs semibold or heavier; this is ${weight}`;
  return null;
}
