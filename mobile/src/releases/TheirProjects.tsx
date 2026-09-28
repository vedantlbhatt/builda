/**
 * A builder's public projects on their page, each with its stars and its latest release, and a
 * star to follow it by (`GET /v1/users/{handle}/projects`). Your own page shows the counts and no
 * star: a star is somebody else's.
 */
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { api } from '../data/client';
import { SPECTRUM } from '../insights/palette';
import { preferredHue } from '../projects/model';
import { T } from '../ui';
import { sayReleaseError, starsLine, whenLine, type TheirProject } from './model';
import { PixelStar } from './PixelStar';

export function TheirProjects({ handle, isYou }: { handle: string; isYou: boolean }) {
  const router = useRouter();
  const [projects, setProjects] = useState<TheirProject[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void api
      .theirProjects(handle)
      .then((r) => alive && setProjects(r.projects))
      .catch(() => alive && setProjects([]));
    return () => {
      alive = false;
    };
  }, [handle]);

  const toggle = useCallback(
    async (p: TheirProject) => {
      const flip = (on: boolean, stars: number | null) => setProjects((ps) => (ps ?? []).map((x) => (x.key === p.key ? { ...x, starred: on, stars } : x)));
      flip(!p.starred, p.stars === null ? null : p.stars + (p.starred ? -1 : 1));
      try {
        const r = p.starred ? await api.unstar(handle, p.key) : await api.star(handle, p.key);
        flip(r.starred, r.stars);
        setError(null);
      } catch (e) {
        flip(p.starred, p.stars);
        setError(sayReleaseError(e, 'The star did not save.'));
      }
    },
    [handle],
  );

  if (!projects || !projects.length) return null;
  return (
    <View style={styles.wrap}>
      <T role="meta" tone="dim" weight={600}>
        Projects
      </T>
      {projects.map((p) => {
        const ink = SPECTRUM[preferredHue(p.key)].ink;
        const meta = [starsLine(p.stars), p.latest_release ? `released ${whenLine(p.latest_release.published_at, Date.now()) ?? ''}`.trim() : null].filter(Boolean).join(' · ');
        return (
          <View key={p.key} style={styles.row}>
            <View style={[styles.rule, { backgroundColor: ink }]} />
            <View style={styles.words}>
              <T role="row" weight={600}>
                {p.name ?? 'A project'}
              </T>
              {p.latest_release ? (
                <Pressable accessibilityRole="link" onPress={() => router.push({ pathname: '/release/[id]', params: { id: p.latest_release!.id } })} hitSlop={6}>
                  {({ pressed }) => (
                    <T role="meta" tone={pressed ? 'text' : 'dim'}>
                      {p.latest_release!.title}
                    </T>
                  )}
                </Pressable>
              ) : null}
              {meta ? (
                <T role="mono" tone="faint">
                  {meta}
                </T>
              ) : null}
            </View>
            {isYou ? null : <PixelStar on={p.starred} ink={ink} cell={3} onPress={() => void toggle(p)} label={p.starred ? `Starred ${p.name ?? 'this project'}. Take the star back` : `Star ${p.name ?? 'this project'}`} />}
          </View>
        );
      })}
      {error ? (
        <T role="meta" tone="del">
          {error}
        </T>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 18, gap: 14 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  rule: { width: 3, alignSelf: 'stretch' },
  words: { flex: 1, gap: 2 },
});
