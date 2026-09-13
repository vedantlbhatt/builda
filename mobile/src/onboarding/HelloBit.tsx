import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { GRID } from '../pixel/frames';
import { closeEyes } from '../pixel/motion';
import { spritePalette } from '../pixel/palette';
import { FrameSvg } from '../pixel/PixelSprite';
import { SPRITES } from '../pixel/sprites';
import { useReduceMotion } from '../ui/motion';
import { HELLO_BLINK } from './flow';

/**
 * Bit on the hello screen: the resting pose, still, there from the first frame, and two
 * blinks (duolingo's welcome: once on arrival and once more while the person reads). Not
 * Bit's idle loop: a splash that breathes on a timer is a screensaver, and this screen is a
 * door.
 *
 * A blink is the family's (`src/pixel/motion.ts`): the eyes shut on one frame, stay shut for
 * 120ms and open on one frame. The pixels never fade: a lid half faded in is a brown that is
 * neither amber nor canvas. Reduce Motion: no blink.
 */
export function HelloBit({ size }: { size: number }) {
  const reduced = useReduceMotion();
  const open = SPRITES.idle[0]!;
  const shut = useMemo(() => closeEyes(open), [open]);
  const palette = useMemo(() => spritePalette('dark', 'rest'), []);
  const drawn = Math.max(1, Math.floor(size / GRID)) * GRID;
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    if (reduced) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const at of HELLO_BLINK.atMs) {
      timers.push(setTimeout(() => setClosed(true), at));
      timers.push(setTimeout(() => setClosed(false), at + HELLO_BLINK.closedMs));
    }
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [reduced]);

  return (
    <View
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={{ width: drawn, height: drawn }}>
        <FrameSvg frame={open} drawn={drawn} palette={palette} />
        {/* Both frames are drawn once; a blink only switches which one shows. */}
        <View style={{ position: 'absolute', left: 0, top: 0, opacity: closed ? 1 : 0 }}>
          <FrameSvg frame={shut} drawn={drawn} palette={palette} />
        </View>
      </View>
    </View>
  );
}
