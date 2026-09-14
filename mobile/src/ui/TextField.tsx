import React, { forwardRef } from 'react';
import { TextInput, type TextInputProps } from 'react-native';

import { space, TAP_TARGET } from '../theme';
import { useColors, useScheme } from './scheme';
import { SHAPE } from './shape';
import { roleScaling, roleStyle } from './typeStyle';

export interface TextFieldProps extends TextInputProps {
  /** SF Mono, for machine data: a pairing code, a key name. */
  mono?: boolean;
}

/**
 * A text field: the `raised` fill (level 2 is the input fill), inner corners, the 44pt
 * floor, body text and an amber caret. No border and no focus glow; the caret says where
 * the typing goes. Uncontrolled use is fine: every prop passes through.
 *
 * The role's line height is left off on purpose: on iOS a single line `TextInput` with a
 * line height sits its text low in the box.
 */
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField({ mono = false, style, multiline, ...rest }, ref) {
  const c = useColors();
  const scheme = useScheme();
  const role = roleStyle(mono ? 'mono' : 'body');
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={c.textFaint}
      selectionColor={c.accent}
      cursorColor={c.accent}
      keyboardAppearance={scheme}
      {...roleScaling(mono ? 'mono' : 'body')}
      {...rest}
      multiline={multiline}
      style={[
        {
          fontSize: role.fontSize,
          fontWeight: role.fontWeight,
          letterSpacing: role.letterSpacing,
          fontFamily: role.fontFamily,
          fontVariant: role.fontVariant,
          color: c.text,
          backgroundColor: c.raised,
          borderRadius: SHAPE.inner,
          borderCurve: 'continuous',
          minHeight: TAP_TARGET,
          paddingHorizontal: space.tile,
          paddingVertical: multiline ? space.tile : space.sm,
          textAlignVertical: multiline ? 'top' : 'center',
        },
        style,
      ]}
    />
  );
});
