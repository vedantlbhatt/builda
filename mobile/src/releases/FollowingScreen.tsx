/**
 * `builder://following`: releases from the projects you starred and the builders you follow,
 * newest first (`GET /v1/releases/following`). Each is who shipped what, its title, its first two
 * highlights against the rule in its project's hue, and when; a tap opens the release, where the
 * star is.
 */
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { api } from '../data/client';
import { SPECTRUM } from '../insights/palette';
import { preferredHue } from '../projects/model';
import { T, useColors } from '../ui';
import { sayReleaseError, starsLine, whenLine, type TheirRelease } from './model';
import { ReleaseFilm } from './ReleaseFilm';

const GUTTER = 20;

export function FollowingScreen() {
  const router = useRouter();
  const c = useColors();
  const [items, setItems] = useState<TheirRelease[] | null>(null);
  const [next, setNext] = useState<{ before: string; before_id: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const read = useCallback(async (cursor?: { before: string; before_id: string }) => {
    try {
      const r = await api.followingReleases(cursor);
      setItems((xs) => (cursor ? [...(xs ?? []), ...r.releases] : r.releases));
      setNext(r.next_before && r.next_before_id ? { before: r.next_before, before_id: r.next_before_id } : null);
      setError(null);
    } catch (e) {
      setError(sayReleaseError(e, 'The releases could not be read.'));
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      void read();
    }, [read]),
  );

  return (
    <>
      <Stack.Screen options={{ title: 'Following' }} />
      <FlatList
        style={{ backgroundColor: c.bg }}
        contentContainerStyle={styles.page}
        data={items ?? []}
        keyExtractor={(r) => r.id}
        onEndReached={() => next && void read(next)}
        ListHeaderComponent={
          items === null && !error ? (
            <T tone="dim">Reading the releases.</T>
          ) : error ? (
            <T role="meta" tone="del">
              {error}
            </T>
          ) : null
        }
        ListEmptyComponent={
          items !== null ? (
            <T tone="dim">Nothing released yet. Star a project on a builder's page, or follow the builder, and what they ship lands here.</T>
          ) : null
        }
        renderItem={({ item }) => <Row r={item} onPress={() => router.push({ pathname: '/release/[id]', params: { id: item.id } })} />}
      />
    </>
  );
}

function Row({ r, onPress }: { r: TheirRelease; onPress: () => void }) {
  const { width } = useWindowDimensions();
  // The words' column: the page less its gutters, the rule and the gap beside it.
  const filmWidth = Math.min(width - GUTTER * 2 - 15, 480);
  const ink = SPECTRUM[r.project_key && r.project_key.length === 64 ? preferredHue(r.project_key) : 'tide'].ink;
  const who = r.owner_display_name ?? (r.owner_handle ? `@${r.owner_handle}` : 'A builder');
  const meta = [whenLine(r.published_at, Date.now()), starsLine(r.stars)].filter(Boolean).join(' · ');
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${who}: ${r.title}`} style={styles.row}>
      {({ pressed }) => (
        <View style={[styles.rowInner, { opacity: pressed ? 0.7 : 1 }]}>
          <View style={[styles.rule, { backgroundColor: ink }]} />
          <View style={styles.words}>
            <T role="meta" tone="dim">
              {r.name ? `${who} · ${r.name}` : who}
            </T>
            <T role="row" weight={600}>
              {r.title}
            </T>
            {r.has_trailer ? (
              <View style={styles.film}>
                <ReleaseFilm releaseId={r.id} width={filmWidth} ink={ink} label={r.title} />
              </View>
            ) : null}
            {r.highlights.slice(0, 2).map((h) => (
              <T key={h} role="meta">
                {h}
              </T>
            ))}
            {meta ? (
              <T role="mono" tone="faint">
                {meta}
              </T>
            ) : null}
          </View>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { padding: GUTTER, paddingBottom: 80 },
  row: { marginBottom: 22 },
  rowInner: { flexDirection: 'row', gap: 12 },
  rule: { width: 3 },
  words: { flex: 1, gap: 3 },
  film: { marginVertical: 6 },
});
