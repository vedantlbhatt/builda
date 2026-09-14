import React from 'react';
import { StyleSheet, Text, type TextProps } from 'react-native';

import { keepDots } from '../copy/plain';
import type { TypeRole } from '../theme';
import { toneColor, useColors, useScheme, type Tone } from './scheme';
import { amberTextProblem, roleScaling, roleStyle, type RoleWeight } from './typeStyle';

/**
 * `role` here is the TYPE role. React Native's ARIA `role` prop is left out on purpose; use
 * `accessibilityRole` for that.
 */
export interface TProps extends Omit<TextProps, 'role'> {
  /** One of the nine roles. `hero` and `display`: one per screen. Default `body`. */
  role?: TypeRole;
  /** Default `text`. Data hues colour numbers only; `accent` is dark, 13pt semibold and up. */
  tone?: Tone;
  /**
   * A weight inside the role's size, for the three places the doc asks for one: a stat value
   * (headline at 700), "needs you" (meta at 600), the verdict word (meta at 500).
   */
  weight?: RoleWeight;
  /** Left unless the design doc says otherwise (the Wrapped answer, the onboarding creature). */
  align?: 'left' | 'center' | 'right';
}

/**
 * Text in one of the nine type roles (DESIGN-DIRECTION 3.3). SF Pro for words, SF Mono for
 * `mono`; tabular figures on every role; Dynamic Type per role (`hero`, `display` and
 * `label` fixed, the rest capped, see `typeStyle.ts`).
 */
export function T({ role = 'body', tone = 'text', weight, align, style, children, ...rest }: TProps) {
  const c = useColors();
  const scheme = useScheme();
  const base = roleStyle(role, weight);
  if (__DEV__ && tone === 'accent') {
    const flat = StyleSheet.flatten(style);
    const effective = Number(flat?.fontWeight ?? base.fontWeight);
    const problem = amberTextProblem(role, Number.isFinite(effective) ? effective : 400, scheme);
    if (problem) console.warn(`[ui/T] ${problem}`);
  }
  return (
    <Text
      {...roleScaling(role)}
      {...rest}
      style={[base, { color: toneColor(c, tone) }, align ? { textAlign: align } : null, style]}
    >
      {/* A wrapped line never starts with the dot between two facts (`copy/plain.keepDots`). */}
      {keepDots(children)}
    </Text>
  );
}
