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

import { startLine } from '../../src/drops/boardRules';
import { DropSheet } from '../../src/drops/DropSheet';
import { useBoard } from '../../src/drops/useBoard';
import { notice } from '../../src/island/feeds';
import { useAccent } from '../../src/theme/accent';
import { Button } from '../../src/ui/Button';
import { T } from '../../src/ui/Text';
import { useColors } from '../../src/ui/scheme';

export default function DropScreen() {
  const c = useColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { drops, moves, start, archive, loading, error, refresh } = useBoard();
  const accent = useAccent();

  const drop = useMemo(() => drops.find((d) => d.id === id) ?? null, [drops, id]);

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/drops');
  }, [router]);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen options={{ headerShown: false, animation: 'fade' }} />
      {/* Nothing until the board has answered: a drop is not "not here" because its board has not
          loaded yet. FOUND on the desktop, where a poster opens this route instead of the phone's
          Opening, which is handed the drop: the page said "That drop is not here" under the growing
          poster until the board came back. */}
      {!drop && loading ? null : drop ? (
        <DropSheet
          drop={drop}
          moves={moves}
          onStart={(ids, adjustment, repoKeys) =>
            void start(drop.id, ids, adjustment, repoKeys).then((went) => {
              const said = startLine(went, null);
              if (said) notice(said.text, said.state, accent.animal, accent.ink);
            })
          }
          onArchive={() => {
            void archive(drop.id);
            close();
          }}
          onClose={close}
        />
      ) : (
        // A board that did not load is not a drop that is gone (FOUND IN REVIEW, 2026-09-19: a
        // banner tapped on a cold start with no signal said "archived or deleted"). The board is
        // read again on its own; the page says which it is, and always has a way out, because a
        // full screen modal cannot be swiped away.
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 }}>
          <T role="body" style={{ color: c.text, textAlign: 'center' }}>
            {error ? 'Builda could not load this drop.' : 'That drop is not here any more.'}
          </T>
          {error ? <Button kind="secondary" size="compact" block={false} label="Try again" onPress={() => void refresh()} /> : null}
          <Button kind="secondary" size="compact" block={false} label="Close" onPress={close} />
        </View>
      )}
    </View>
  );
}
