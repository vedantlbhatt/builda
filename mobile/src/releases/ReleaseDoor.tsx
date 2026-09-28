/**
 * The way into a project's releases (`builder://releases/<key>`), one row on the project page. A
 * draft your Mac wrote is the door's whole line, because that is the thing waiting on you; else
 * how many went out; else what drafting is.
 */
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { api } from '../data/client';
import { Door } from '../session/parts';
import { doorWords, type MyRelease } from './model';

export function ReleaseDoor({ projectKey, color, hue, name }: { projectKey: string; color: string; hue?: string | null; name?: string }) {
  const router = useRouter();
  const [releases, setReleases] = useState<MyRelease[] | null>(null);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      if (projectKey.length === 64) {
        void api
          .myReleases(projectKey)
          .then((r) => alive && setReleases(r.releases))
          .catch(() => alive && setReleases(null));
      }
      return () => {
        alive = false;
      };
    }, [projectKey]),
  );
  if (projectKey.length !== 64) return null;
  const words = doorWords(releases);
  return (
    <View style={styles.row}>
      <Door title={words.title} line={words.line} color={color} onPress={() => router.push({ pathname: '/releases/[key]', params: { key: projectKey, ...(hue ? { hue } : {}), ...(name ? { name } : {}) } })} />
    </View>
  );
}

const styles = StyleSheet.create({ row: { paddingHorizontal: 20 } });
