import React, { createContext, useContext, type ReactNode } from 'react';

import { colors, type Scheme } from '../theme';

/**
 * Which palette the kit draws with. Dark unless a `SchemeProvider` says otherwise: the app
 * is dark-first and ships dark-only for v1 (`app/_layout.tsx`), but the light column in
 * tokens.json is real (widgets and the Lock Screen render light), so the gallery wraps a
 * section in `<SchemeProvider scheme="light">` to verify it.
 */
const SchemeContext = createContext<Scheme>('dark');

const PALETTES: Record<Scheme, ReturnType<typeof colors>> = {
  dark: colors('dark'),
  light: colors('light'),
};

export type Palette = ReturnType<typeof colors>;

export function SchemeProvider({ scheme, children }: { scheme: Scheme; children: ReactNode }) {
  return <SchemeContext.Provider value={scheme}>{children}</SchemeContext.Provider>;
}

export function useScheme(): Scheme {
  return useContext(SchemeContext);
}

/** The resolved palette for the current scheme. Stable object per scheme: safe in deps. */
export function useColors(): Palette {
  return PALETTES[useContext(SchemeContext)];
}

/**
 * What a piece of text or a glyph is coloured by. Data hues (`add`, `del`, `human`) colour
 * numbers and marks only; `accent` text is 13pt semibold or larger and dark only.
 */
export type Tone = 'text' | 'dim' | 'faint' | 'accent' | 'onAccent' | 'add' | 'del' | 'human';

export function toneColor(c: Palette, tone: Tone): string {
  switch (tone) {
    case 'text':
      return c.text;
    case 'dim':
      return c.textDim;
    case 'faint':
      return c.textFaint;
    case 'accent':
      return c.accent;
    case 'onAccent':
      return c.onAccent;
    case 'add':
      return c.data.add;
    case 'del':
      return c.data.del;
    case 'human':
      return c.data.human;
  }
}
