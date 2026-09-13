import React, { type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { space } from '../theme';
import { T } from './Text';

export interface SectionProps {
  /** Lower cased on render: captions are lower case. */
  label: string;
  /** Keep the label's case when it is a proper noun that must stay one ("Claude Code"). */
  preserveCase?: boolean;
  /** Right side of the header: a text button, a count. */
  trailing?: ReactNode;
  /** Gap between the header and the content, and between children. Default 8. */
  gap?: number;
  children?: ReactNode;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * A labelled block of a screen. The label is `label` (12/600, +0.2) in `textDim`, lower
 * case, left aligned; sections sit `space.section` (32) apart, set by the screen's
 * container gap, not by margins here.
 */
export function Section({ label, preserveCase = false, trailing, gap = space.sm, children, testID, style }: SectionProps) {
  return (
    <View testID={testID} style={[{ gap }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.tile }}>
        <T role="label" tone="dim" accessibilityRole="header" style={{ flexShrink: 1 }} numberOfLines={1}>
          {preserveCase ? label : label.toLocaleLowerCase()}
        </T>
        {trailing}
      </View>
      {children}
    </View>
  );
}
