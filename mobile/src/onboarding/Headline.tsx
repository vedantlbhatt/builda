import React, { type ReactNode } from 'react';

import { T, type TProps } from '../ui/Text';
import { HEADLINE, HEADLINE_SCALE } from './type';

/**
 * A step's headline: 34/800 in `text`, left aligned, announced as a header, and grown with
 * Dynamic Type to 1.2x like the name field it shares its place with (the kit's `display`
 * role is fixed, so the scaling is set here rather than inherited).
 */
export function Headline({ children, ...rest }: { children: ReactNode } & Omit<TProps, 'role' | 'style' | 'children'>) {
  return (
    <T role="display" accessibilityRole="header" {...rest} allowFontScaling maxFontSizeMultiplier={HEADLINE_SCALE} style={HEADLINE}>
      {children}
    </T>
  );
}
