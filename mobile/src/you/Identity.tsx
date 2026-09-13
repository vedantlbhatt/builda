import { useRouter } from 'expo-router';
import React from 'react';
import { View } from 'react-native';

import { ANIMAL_LABELS, type Animal } from '../pixel/animals';
import { PixelAnimal } from '../pixel/PixelAnimal';
import { space } from '../theme';
import { PressableScale, T } from '../ui';

/**
 * The builder's own creature and name, small, at the top of the You tab: identity in the
 * chrome (SYNTHESIS 5, technique 9), the way a profile opens on its avatar and name. The
 * creature is the one thing on the tab that animates, and pressing it opens the picker.
 *
 * 32pt: pixel art renders at 16, 32, 48 or 64 only, whole device pixels per cell.
 */
export function Identity({ animal, name }: { animal: Animal; name: string | null }) {
  const router = useRouter();
  const creature = `the ${ANIMAL_LABELS[animal]}`;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.tile }}>
      <PressableScale
        onPress={() => router.push('/icon')}
        accessibilityLabel={`Your creature, ${creature}. Change it`}
        hitSlop={space.sm}
      >
        <PixelAnimal animal={animal} size={32} />
      </PressableScale>
      <View style={{ flex: 1 }}>
        {name ? (
          <>
            <T role="headline" numberOfLines={1}>
              {name}
            </T>
            <T role="meta" tone="dim" numberOfLines={1}>
              {creature}
            </T>
          </>
        ) : (
          <T role="headline" numberOfLines={1}>
            {creature.charAt(0).toUpperCase() + creature.slice(1)}
          </T>
        )}
      </View>
    </View>
  );
}
