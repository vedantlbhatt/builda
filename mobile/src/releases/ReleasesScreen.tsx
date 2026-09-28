/**
 * `builder://releases/<key>`: a project's releases (docs/social.md). From the top: the draft your
 * Mac wrote, if there is one, every word of it yours to change, and who it goes to; then what went
 * out, newest first; then whether and when your Mac drafts at all.
 *
 * Every rule and every word is in `model.ts`, where `bun test` holds it. The one motion here is the
 * release itself: when a draft goes out, it joins the list with its rule built cell by cell from the
 * bottom (`ShipRule`), the strip's own mark in the project's hue, on the POP spring.
 */
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSpring } from 'react-native-reanimated';

import { api, API_BASE_URL } from '../data/client';
import { GROUND, SPECTRUM, type HueName } from '../insights/palette';
import { SPRING } from '../motion/springs';
import { PLATFORM_LIMITS } from '../generated/shipkit';
import { copyText } from '../onboarding/clipboard';
import { preferredHue } from '../projects/model';
import { composeUrl, PLATFORM_NAMES } from '../shipkit/model';
import { Button, SymbolIcon, T, TextField, useColors } from '../ui';
import { useReduceMotion } from '../ui/motion';
import {
  badgeMarkdown,
  badgeUrl,
  CADENCE_WORDS,
  draftLine,
  draftOf,
  draftPatch,
  draftProblem,
  HIGHLIGHT_MAX,
  HIGHLIGHTS_MAX,
  NOTES_MAX,
  POST_TO,
  releasePost,
  sayReleaseError,
  settingsLine,
  starsLine,
  stepCommits,
  TITLE_MAX,
  whenLine,
  type Cadence,
  type Draft,
  type MyRelease,
  type ReleaseSettings,
  type Visibility,
} from './model';

const GUTTER = 20;

export function ReleasesScreen() {
  const params = useLocalSearchParams<{ key?: string; hue?: string; name?: string }>();
  const key = typeof params.key === 'string' ? params.key.toLowerCase() : '';
  const hue: HueName = typeof params.hue === 'string' && params.hue in SPECTRUM ? (params.hue as HueName) : key.length === 64 ? preferredHue(key) : 'tide';
  const ink = SPECTRUM[hue].ink;
  const c = useColors();
  const [releases, setReleases] = useState<MyRelease[] | null>(null);
  const [settings, setSettings] = useState<ReleaseSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);

  const read = useCallback(async () => {
    if (key.length !== 64) return;
    try {
      const [r, s] = await Promise.all([api.myReleases(key), api.releaseSettings(key)]);
      setReleases(r.releases);
      setSettings(s.settings);
      setError(null);
    } catch (e) {
      setError(sayReleaseError(e, 'The releases could not be read.'));
    }
  }, [key]);
  useEffect(() => {
    void read();
  }, [read]);

  const draft = releases?.find((r) => r.status === 'draft') ?? null;
  const out = useMemo(() => (releases ?? []).filter((r) => r.status === 'published'), [releases]);
  const name = typeof params.name === 'string' && params.name ? params.name : (releases?.[0]?.name ?? 'this project');

  return (
    <>
      <Stack.Screen options={{ title: 'Releases' }} />
      <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        {releases === null && !error ? <T tone="dim">Reading the releases.</T> : null}
        {draft ? (
          <DraftEditor
            key={draft.id + draft.updated_at}
            release={draft}
            ink={ink}
            onGone={(r) => {
              setReleases((rs) => (rs ?? []).map((x) => (x.id === r.id ? r : x)));
              if (r.status === 'published') setFresh(r.id);
            }}
            onSaved={(r) => setReleases((rs) => (rs ?? []).map((x) => (x.id === r.id ? r : x)))}
          />
        ) : releases !== null ? (
          <View>
            <T role="headline">No draft waiting</T>
            <T tone="dim" style={styles.gap}>
              {settings?.drafts_to_phone ? 'Your Mac writes the next one when it is due, and it waits here for you.' : `Turn on drafts below and your Mac writes a release of ${name} when it is due. Nothing goes out until you publish it.`}
            </T>
          </View>
        ) : null}

        {out.length ? (
          <View style={styles.block}>
            <T role="headline">Out</T>
            {out.map((r) => (
              <Released key={r.id} release={r} ink={ink} arriving={r.id === fresh} />
            ))}
          </View>
        ) : null}

        <BadgeBlock projectKey={key} />
        {settings ? <SettingsBlock settings={settings} ink={ink} projectKey={key} onChange={setSettings} onError={setError} /> : null}
        {error ? (
          <T role="meta" tone="del" style={styles.gap}>
            {error}
          </T>
        ) : null}
      </ScrollView>
    </>
  );
}

// ------------------------------------------------------------------ the draft

function DraftEditor({ release, ink, onGone, onSaved }: { release: MyRelease; ink: string; onGone: (r: MyRelease) => void; onSaved: (r: MyRelease) => void }) {
  const before = useMemo(() => draftOf(release), [release]);
  const [d, setD] = useState<Draft>(() => ({ ...before, highlights: before.highlights.length ? before.highlights : [''] }));
  const [to, setTo] = useState<Visibility>(release.visibility);
  const [busy, setBusy] = useState<'publish' | 'dismiss' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const problem = draftProblem(d);

  const save = async (): Promise<boolean> => {
    const patch = draftPatch(before, d);
    const body = { ...(patch ?? {}), ...(to !== release.visibility ? { visibility: to } : {}) };
    if (!Object.keys(body).length) return true;
    const r = await api.editRelease(release.id, body);
    onSaved(r.release);
    return true;
  };

  const publish = async () => {
    if (problem) return;
    setBusy('publish');
    setError(null);
    try {
      await save();
      const r = await api.publishRelease(release.id);
      onGone(r.release);
    } catch (e) {
      setError(sayReleaseError(e, 'It did not go out. Try again.'));
    } finally {
      setBusy(null);
    }
  };

  const dismiss = async () => {
    setBusy('dismiss');
    setError(null);
    try {
      const r = await api.dismissRelease(release.id);
      onGone(r.release);
    } catch (e) {
      setError(sayReleaseError(e, 'It could not be put away.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View>
      <T role="headline">A draft from your Mac</T>
      <T role="meta" tone="dim" style={styles.gap}>
        {draftLine(release)}
      </T>
      <View style={[styles.draft, { borderLeftColor: ink }]}>
        <TextField value={d.title} onChangeText={(title) => setD({ ...d, title })} placeholder="A title" maxLength={TITLE_MAX + 20} accessibilityLabel="The release title" style={styles.title} />
        <TextField value={d.notes} onChangeText={(notes) => setD({ ...d, notes })} placeholder="What it is, in a few lines" multiline maxLength={NOTES_MAX + 50} accessibilityLabel="The release notes" style={styles.notes} />
        {d.highlights.map((h, i) => (
          <View key={i} style={styles.highlightRow}>
            <View style={[styles.cell, { backgroundColor: ink }]} />
            <TextField
              value={h}
              onChangeText={(t) => setD({ ...d, highlights: d.highlights.map((x, j) => (j === i ? t : x)) })}
              placeholder="One thing that changed"
              maxLength={HIGHLIGHT_MAX + 20}
              accessibilityLabel={`Highlight ${i + 1}`}
              style={styles.highlight}
            />
          </View>
        ))}
        {d.highlights.length < HIGHLIGHTS_MAX ? (
          <Pressable accessibilityRole="button" onPress={() => setD({ ...d, highlights: [...d.highlights, ''] })} hitSlop={8} style={styles.gap}>
            {({ pressed }) => (
              <T role="meta" tone={pressed ? 'text' : 'dim'} weight={600}>
                add a highlight
              </T>
            )}
          </Pressable>
        ) : null}
      </View>
      <View style={[styles.choice, styles.gapLg]} accessibilityRole="radiogroup">
        {(['followers', 'public'] as const).map((v) => (
          <Pressable key={v} onPress={() => setTo(v)} accessibilityRole="radio" accessibilityState={{ checked: to === v }} hitSlop={8}>
            <T role="row" weight={to === v ? 600 : undefined} tone={to === v ? 'text' : 'faint'}>
              {v === 'followers' ? 'To your followers' : 'To everyone'}
            </T>
            <View style={[styles.choiceRule, { backgroundColor: to === v ? ink : 'transparent' }]} />
          </Pressable>
        ))}
      </View>
      {problem ? (
        <T role="meta" tone="del" style={styles.gap}>
          {problem}
        </T>
      ) : null}
      <Button label="Publish" busy={busy === 'publish'} busyLabel="Sending it out" disabled={Boolean(problem) || busy !== null} onPress={() => void publish()} style={styles.gapLg} />
      <Button label="Not this one" kind="secondary" disabled={busy !== null} busy={busy === 'dismiss'} busyLabel="Putting it away" onPress={() => void dismiss()} style={styles.gap} />
      {error ? (
        <T role="meta" tone="del" style={styles.gap}>
          {error}
        </T>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ what went out

function Released({ release, ink, arriving }: { release: MyRelease; ink: string; arriving: boolean }) {
  const meta = [whenLine(release.published_at, Date.now()), release.visibility === 'public' ? 'to everyone' : 'to followers', release.stars ? starsLine(release.stars) : null].filter(Boolean).join(' · ');
  return (
    <View style={styles.released}>
      <ShipRule ink={ink} arriving={arriving} />
      <View style={styles.releasedWords}>
        <T role="row" weight={600}>
          {release.title}
        </T>
        {release.highlights.slice(0, 3).map((h) => (
          <T key={h} role="meta" tone="dim">
            {h}
          </T>
        ))}
        <T role="mono" tone="faint">
          {meta}
        </T>
        <PostLine release={release} />
      </View>
    </View>
  );
}

/** "post it on X · Bluesky · Threads · LinkedIn · Reddit": each opens that platform's compose page with the release in it. */
function PostLine({ release }: { release: MyRelease }) {
  return (
    <View style={styles.postLine}>
      <T role="meta" tone="faint">
        post it on{' '}
      </T>
      {POST_TO.map((p, i) => {
        const url = composeUrl(p, releasePost(release, PLATFORM_LIMITS[p], p === 'reddit'));
        if (!url) return null;
        return (
          <Pressable key={p} accessibilityRole="link" accessibilityLabel={`Post it on ${PLATFORM_NAMES[p]}`} onPress={() => void Linking.openURL(url)} hitSlop={6}>
            {({ pressed }) => (
              <T role="meta" weight={600} tone={pressed ? 'text' : 'dim'}>
                {`${i ? ' · ' : ''}${PLATFORM_NAMES[p]}`}
              </T>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const RULE_CELLS = 7;

/**
 * The release's rule, as cells: at rest a column of the hue; on the release that just went out,
 * the cells arrive from the bottom one after another on the POP spring, so the thing you shipped
 * is built in front of you. Under Reduce Motion it is simply there.
 */
function ShipRule({ ink, arriving }: { ink: string; arriving: boolean }) {
  return (
    <View style={styles.rule} accessible={false}>
      {Array.from({ length: RULE_CELLS }, (_, i) => (
        <RuleCell key={i} i={i} ink={ink} arriving={arriving} />
      ))}
    </View>
  );
}

function RuleCell({ i, ink, arriving }: { i: number; ink: string; arriving: boolean }) {
  const reduce = useReduceMotion();
  const from = RULE_CELLS - 1 - i;
  const p = useSharedValue(arriving && !reduce ? 0 : 1);
  useEffect(() => {
    if (!arriving || reduce) return;
    p.value = withDelay(from * 55, withSpring(1, SPRING.pop));
  }, [arriving, reduce, from, p]);
  const style = useAnimatedStyle(() => ({ opacity: Math.min(1, p.value * 1.4), transform: [{ translateY: (1 - p.value) * 14 }] }));
  return <Animated.View style={[styles.ruleCell, { backgroundColor: ink }, style]} />;
}

// ------------------------------------------------------------------ the README badge

/**
 * For a public project only (a private one's badge is the plain mark, so it is not offered): the
 * badge as it draws now, and its Markdown to paste into the README, copied with one tap.
 */
function BadgeBlock({ projectKey }: { projectKey: string }) {
  const [handle, setHandle] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const me = await api.getMe();
        if (!me.handle) return;
        const r = await api.theirProjects(me.handle);
        if (alive && r.projects.some((p) => p.key === projectKey)) setHandle(me.handle);
      } catch {
        // No badge is offered on a read that failed: a private project's badge says nothing.
      }
    })();
    return () => {
      alive = false;
    };
  }, [projectKey]);
  if (!handle) return null;
  const md = badgeMarkdown(API_BASE_URL, handle, projectKey);
  return (
    <View style={styles.block}>
      <T role="headline">A badge for your README</T>
      <T role="meta" tone="dim" style={styles.gap}>
        Its stars and when it last went out to everyone, in the app's pixels.
      </T>
      <Image source={{ uri: badgeUrl(API_BASE_URL, handle, projectKey) }} style={styles.badge} contentFit="contain" contentPosition="left" accessibilityLabel="The badge as it draws now" />
      <T role="mono" tone="dim" selectable style={styles.gap}>
        {md}
      </T>
      <Pressable accessibilityRole="button" onPress={() => setCopied(copyText(md))} hitSlop={8} style={styles.gap}>
        {({ pressed }) => (
          <T role="meta" weight={600} tone={pressed ? 'text' : 'dim'}>
            {copied ? 'copied' : 'copy it'}
          </T>
        )}
      </Pressable>
    </View>
  );
}

// ------------------------------------------------------------------ settings

function SettingsBlock({
  settings,
  ink,
  projectKey,
  onChange,
  onError,
}: {
  settings: ReleaseSettings;
  ink: string;
  projectKey: string;
  onChange: (s: ReleaseSettings) => void;
  onError: (e: string | null) => void;
}) {
  const set = async (patch: Partial<Omit<ReleaseSettings, 'project_key' | 'updated_at'>>) => {
    const was = settings;
    onChange({ ...settings, ...patch });
    try {
      const r = await api.setReleaseSettings(projectKey, patch);
      onChange(r.settings);
      onError(null);
    } catch (e) {
      onChange(was);
      onError(sayReleaseError(e, 'The setting did not save.'));
    }
  };
  const on = settings.drafts_to_phone;
  return (
    <View style={styles.block}>
      <T role="headline">Drafts</T>
      <View style={styles.switchRow}>
        <T>Your Mac drafts releases</T>
        <Switch value={on} onValueChange={(v) => void set({ drafts_to_phone: v })} trackColor={{ true: ink, false: GROUND.raised }} ios_backgroundColor={GROUND.raised} accessibilityLabel="Your Mac drafts releases" />
      </View>
      {on ? (
        <>
          <View style={styles.switchRow}>
            <T>{`After every ${settings.every_commits} commits`}</T>
            <View style={styles.stepper}>
              {([-1, 1] as const).map((dir) => (
                <Pressable
                  key={dir}
                  onPress={() => void set({ every_commits: stepCommits(settings.every_commits, dir) })}
                  accessibilityRole="button"
                  accessibilityLabel={dir > 0 ? 'More commits' : 'Fewer commits'}
                  hitSlop={10}
                  style={styles.step}
                >
                  {({ pressed }) => <SymbolIcon name={dir > 0 ? 'plus' : 'minus'} size={18} weight="semibold" tone={pressed ? 'text' : 'dim'} />}
                </Pressable>
              ))}
            </View>
          </View>
          <View style={styles.switchRow}>
            <T>After a session that ships</T>
            <Switch value={settings.on_shipped} onValueChange={(v) => void set({ on_shipped: v })} trackColor={{ true: ink, false: GROUND.raised }} ios_backgroundColor={GROUND.raised} accessibilityLabel="After a session that ships" />
          </View>
          <View style={[styles.choice, styles.gapLg]} accessibilityRole="radiogroup">
            {(['none', 'weekly', 'biweekly'] as Cadence[]).map((k) => (
              <Pressable key={k} onPress={() => void set({ cadence: k })} accessibilityRole="radio" accessibilityState={{ checked: settings.cadence === k }} hitSlop={8}>
                <T role="meta" weight={settings.cadence === k ? 600 : undefined} tone={settings.cadence === k ? 'text' : 'faint'}>
                  {CADENCE_WORDS[k]}
                </T>
                <View style={[styles.choiceRule, { backgroundColor: settings.cadence === k ? ink : 'transparent' }]} />
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
      <T role="meta" tone="dim" style={styles.gapLg}>
        {settingsLine(settings)}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: GUTTER, paddingBottom: 80 },
  block: { marginTop: 36 },
  gap: { marginTop: 8 },
  gapLg: { marginTop: 16 },
  draft: { marginTop: 14, paddingLeft: 14, borderLeftWidth: 3, gap: 10 },
  title: { fontWeight: '600' },
  notes: { minHeight: 96, textAlignVertical: 'top' },
  highlightRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  highlight: { flex: 1 },
  cell: { width: 6, height: 6 },
  choice: { flexDirection: 'row', gap: 22, alignItems: 'flex-end' },
  choiceRule: { height: 2, marginTop: 4 },
  released: { flexDirection: 'row', gap: 12, marginTop: 18 },
  releasedWords: { flex: 1, gap: 3 },
  rule: { width: 3, justifyContent: 'flex-end', gap: 2 },
  ruleCell: { width: 3, flex: 1 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 },
  stepper: { flexDirection: 'row', gap: 18 },
  postLine: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
  badge: { width: 240, height: 20, marginTop: 12 },
  step: { minWidth: 24, alignItems: 'center' },
});
