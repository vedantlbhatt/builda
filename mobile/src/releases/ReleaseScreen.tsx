/**
 * `builder://release/<id>`: one release (docs/social.md), where a release push opens. Who shipped
 * it and what, its highlights against the rule in the project's hue, and the star: a reader stars
 * a public project from here, and its owner sees how many did. A private project's release names
 * no project and counts no stars (the server withholds both), so nor does this.
 */
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { api } from '../data/client';
import { SPECTRUM } from '../insights/palette';
import { preferredHue } from '../projects/model';
import { T, useColors } from '../ui';
import { isMine, carriesLine, sayReleaseError, starsLine, whenLine, type MyRelease, type TheirRelease } from './model';
import { PixelStar } from './PixelStar';

const GUTTER = 20;

export function ReleaseScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const c = useColors();
  const [release, setRelease] = useState<MyRelease | TheirRelease | null>(null);
  const [star, setStar] = useState<{ on: boolean; stars: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    void api
      .release(id)
      .then(async (r) => {
        if (!alive) return;
        setRelease(r.release);
        const rel = r.release;
        // Whether I starred it is the profile's answer: the release does not carry it.
        if (!isMine(rel) && rel.owner_handle && rel.project_key) {
          const p = await api.theirProjects(rel.owner_handle);
          const mine = p.projects.find((x) => x.key === rel.project_key);
          if (alive && mine) setStar({ on: mine.starred, stars: mine.stars });
        }
      })
      .catch((e) => alive && setError(sayReleaseError(e, 'The release could not be read.')));
    return () => {
      alive = false;
    };
  }, [id]);

  const toggle = useCallback(async () => {
    if (!release || isMine(release) || !release.owner_handle || !release.project_key || !star) return;
    const was = star;
    setStar({ on: !was.on, stars: was.stars === null ? null : was.stars + (was.on ? -1 : 1) });
    try {
      const r = was.on ? await api.unstar(release.owner_handle, release.project_key) : await api.star(release.owner_handle, release.project_key);
      setStar({ on: r.starred, stars: r.stars });
    } catch (e) {
      setStar(was);
      setError(sayReleaseError(e, 'The star did not save.'));
    }
  }, [release, star]);

  const key = release?.project_key ?? null;
  const ink = SPECTRUM[key && key.length === 64 ? preferredHue(key) : 'tide'].ink;
  const who = release && !isMine(release) ? release.owner_display_name ?? (release.owner_handle ? `@${release.owner_handle}` : 'A builder') : 'You';
  const what = release?.name ?? null;
  const meta = release ? [whenLine(release.published_at, Date.now()), carriesLine(release), starsLine(star?.stars ?? release.stars)].filter(Boolean).join(' · ') : '';

  return (
    <>
      <Stack.Screen options={{ title: '' }} />
      <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.page}>
        {!release && !error ? <T tone="dim">Reading the release.</T> : null}
        {release ? (
          <View>
            <T role="meta" tone="dim">
              {what ? `${who} released ${what}` : `${who} posted a release`}
            </T>
            <View style={styles.head}>
              <T role="title" style={styles.title}>
                {release.title}
              </T>
              {star ? <PixelStar on={star.on} ink={ink} cell={3} onPress={() => void toggle()} label={star.on ? 'Starred. Take the star back' : 'Star this project'} /> : null}
            </View>
            {meta ? (
              <T role="mono" tone="faint" style={styles.gap}>
                {meta}
              </T>
            ) : null}
            {release.highlights.length ? (
              <View style={styles.points}>
                <View style={[styles.rule, { backgroundColor: ink }]} />
                <View style={styles.pointWords}>
                  {release.highlights.map((h) => (
                    <T key={h} role="row">
                      {h}
                    </T>
                  ))}
                </View>
              </View>
            ) : null}
            {release.notes ? (
              <T style={styles.notes} tone="text">
                {release.notes}
              </T>
            ) : null}
            {isMine(release) ? (
              <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: '/releases/[key]', params: { key: release.project_key } })} hitSlop={8} style={styles.more}>
                {({ pressed }) => (
                  <T role="meta" weight={600} tone={pressed ? 'text' : 'dim'}>
                    every release of this project
                  </T>
                )}
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {error ? (
          <T role="meta" tone="del" style={styles.gap}>
            {error}
          </T>
        ) : null}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  page: { padding: GUTTER, paddingBottom: 80 },
  head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginTop: 6 },
  title: { flex: 1 },
  gap: { marginTop: 8 },
  points: { flexDirection: 'row', gap: 12, marginTop: 22 },
  rule: { width: 3 },
  pointWords: { flex: 1, gap: 8 },
  notes: { marginTop: 22 },
  more: { marginTop: 28 },
});
