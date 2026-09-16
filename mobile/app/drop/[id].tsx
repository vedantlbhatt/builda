/**
 * A drop, opened: the post fills the screen and the sheet comes up over it.
 *
 * A ROUTE, not a panel inside the tab. It is pushed from the root stack, so it covers the tab bar
 * the way every other detail screen in this app does: a full bleed frame with a tab bar sitting
 * on top of it is a frame that is not full bleed, and the sheet's own bar would fight the one
 * underneath it for the same 49 points.
 *
 * It reads the board rather than being handed a drop, so a deep link into it works from a cold
 * start (`builder://drops?open=<id>` routes here through `+native-intent.ts`) and so the sheet
 * updates itself while a move it started is running.
 */
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useMemo } from 'react';
import { View } from 'react-native';

import { DropSheet } from '../../src/drops/DropSheet';
import { useBoard } from '../../src/drops/useBoard';
import { T } from '../../src/ui/Text';
import { useColors } from '../../src/ui/scheme';

export default function DropScreen() {
  const c = useColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { drops, moves, start, archive } = useBoard();

  const drop = useMemo(() => drops.find((d) => d.id === id) ?? null, [drops, id]);

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/drops');
  }, [router]);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen options={{ headerShown: false, animation: 'fade' }} />
      {drop ? (
        <DropSheet
          drop={drop}
          moves={moves}
          onStart={(ids, adjustment, repoKeys) => void start(drop.id, ids, adjustment, repoKeys)}
          onArchive={() => {
            void archive(drop.id);
            close();
          }}
          onClose={close}
        />
      ) : (
        // A drop that is not on this board any more: deleted on another device, or a link to one
        // that never was. It says so rather than showing an empty frame.
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <T role="title" style={{ color: c.text, textAlign: 'center' }}>
            That drop is not here
          </T>
          <T role="meta" style={{ color: c.textDim, marginTop: 10, textAlign: 'center' }}>
            It may have been archived or deleted on another device.
          </T>
        </View>
      )}
    </View>
  );
}
