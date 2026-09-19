/**
 * The way into a project's ship kit (`builder://ship/<key>`), one row, for the project page and the
 * session page. On the project page it is always there: it opens the kit, or the button that asks
 * the Mac for a demo. On a session page it shows only when the session's project HAS a kit, read
 * from the server, because a door to "nothing yet" under every session is a door nobody opens.
 */
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { api } from '../data/client';
import { Door } from '../session/parts';

export function ShipKitDoor({ projectKey, color, always = false, hue, name }: { projectKey: string; color: string; always?: boolean; hue?: string | null; name?: string }) {
  const router = useRouter();
  const [has, setHas] = useState<boolean | null>(null);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      if (projectKey.length === 64) {
        void api
          .shipKit(projectKey)
          .then((r) => alive && setHas(r.kit !== null))
          .catch(() => alive && setHas(null));
      }
      return () => {
        alive = false;
      };
    }, [projectKey]),
  );
  if (projectKey.length !== 64 || (!always && has !== true)) return null;
  const title = has ? 'Share what you built' : 'Make a demo to share';
  const line = has ? 'The demo in every shape, its screens, and a post for each platform.' : 'Ask your Mac to film it and make the kit.';
  return (
    <View style={styles.row}>
      <Door title={title} line={line} color={color} onPress={() => router.push({ pathname: '/ship/[key]', params: { key: projectKey, ...(hue ? { hue } : {}), ...(name ? { name } : {}) } })} />
    </View>
  );
}

const styles = StyleSheet.create({ row: { paddingHorizontal: 20 } });
