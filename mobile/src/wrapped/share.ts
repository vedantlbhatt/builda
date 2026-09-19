/**
 * One Wrapped card out as an image, through the system share sheet (the skill: sharing is
 * the system's controller, never a rebuilt one). The same capture the recap card uses
 * (`src/card/export.ts`): `react-native-view-shot` over the card as it stands on screen, so
 * what is shared is exactly what the preview showed, dither and dashed outline included.
 */
import * as Sharing from 'expo-sharing';
import type React from 'react';
import { PixelRatio, Platform, type View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { tokens } from '../generated/tokens';
import { saveCard } from '../share/saveCard';

/** The export in pixels: `tokens.card.portrait`, 1080 by 1350 (4:5, the portrait post). */
export const SHARE_PIXELS = tokens.card.portrait;

/** `{ saved }`: on a desktop, where the image is saved rather than shared, and the line saying where (`share/saveCard.web.ts`). */
export type ShareOutcome = 'shared' | 'unavailable' | 'failed' | { saved: string };

export async function shareCardImage(view: React.RefObject<View | null>, title: string): Promise<ShareOutcome> {
  if (!view.current) return 'failed';
  if (Platform.OS === 'web') {
    const line = await saveCard(view.current, title, SHARE_PIXELS.w);
    return line ? { saved: line } : 'failed';
  }
  let uri: string;
  try {
    // On iOS the capture is `width` by `height` POINTS at the screen's scale, so points are
    // pixels over the scale: 360 by 450 at @3x is the 1080 by 1350 the post wants.
    const scale = PixelRatio.get();
    uri = await captureRef(view, {
      format: 'png',
      quality: 1,
      result: 'tmpfile',
      width: SHARE_PIXELS.w / scale,
      height: SHARE_PIXELS.h / scale,
    });
  } catch {
    return 'failed';
  }
  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  // One image and a title: a share extension given one image takes it whole.
  await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: title });
  return 'shared';
}
