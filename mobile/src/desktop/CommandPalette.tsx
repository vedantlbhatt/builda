/**
 * Cmd/Ctrl+K: type to go anywhere (`paletteModel.ts` has the rules and the ranking).
 *
 * A panel over the window's top third on a dimmed ground, the one field focused, the best match
 * lit. Up and Down move, Enter opens, Esc closes. The rows are read when it opens, from the
 * cache and the board the app already holds, so it answers on the first keystroke.
 */
import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import * as cache from '../data/cache';
import { api } from '../data/client';
import { loadRepoNames } from '../data/repoNames';
import { repoLabel } from '../copy/repoLabel';
import { nav } from '../nav/Skeleton';
import { rowOf } from '../session/page';
import { space } from '../theme';
import { useAccent } from '../theme/accent';
import { SHAPE } from '../ui/shape';
import { T } from '../ui/Text';
import { roleStyle } from '../ui/typeStyle';
import { rgba } from './css';
import { KIND_LABEL, PLACES, rank, type PaletteItem } from './paletteModel';

const WIDTH = 620;
const ROW = 52;

async function gather(): Promise<PaletteItem[]> {
  const now = Date.now();
  const [sessions, names, board] = await Promise.all([
    cache.listSessions(80).catch(() => []),
    loadRepoNames().catch(() => null),
    api
      .isSignedIn()
      .then((yes) => (yes ? api.dropsBoard() : null))
      .catch(() => null),
  ]);
  const items: PaletteItem[] = [...PLACES];
  const projects = new Map<string, PaletteItem>();
  for (const s of sessions) {
    const row = rowOf(s, now, names);
    items.push({ id: `s:${s.id}`, kind: 'session', title: row.title, meta: row.meta, href: `/session/${s.id}` });
    const key = s.repo_key;
    if (key && !projects.has(key)) {
      const label = repoLabel(s, names);
      projects.set(key, { id: `p:${key}`, kind: 'project', title: label, meta: 'Project', href: `/project/${key}` });
    }
  }
  items.push(...projects.values());
  for (const d of board?.drops ?? []) {
    const title = d.title?.trim() || d.url;
    items.push({ id: `d:${d.id}`, kind: 'drop', title, meta: d.summary?.trim() || d.platform, href: `/drop/${d.id}` });
  }
  return items;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const accent = useAccent();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<PaletteItem[]>(() => [...PLACES]);
  const [cursor, setCursor] = useState(0);
  const input = useRef<TextInput>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setCursor(0);
    let live = true;
    void gather().then((all) => {
      if (live) setItems(all);
    });
    const t = setTimeout(() => input.current?.focus(), 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [open]);

  const shown = useMemo(() => rank(items, query, 12), [items, query]);

  const go = useCallback(
    (item: PaletteItem | undefined) => {
      if (!item) return;
      onClose();
      router.push(item.href as never);
    },
    [onClose, router],
  );

  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, Math.max(0, shown.length - 1)));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        go(shown[cursor]);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, shown, cursor, go, onClose]);

  if (!open) return null;
  return (
    <View style={styles.scrim}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" {...({ dataSet: { buildaNowash: 'true' } } as object)} />
      <View style={styles.panel} accessibilityRole="search" {...({ dataSet: { buildaNowash: 'true' } } as object)}>
        <View style={styles.field}>
          <SymbolView name="magnifyingglass" tintColor={nav.textDim} weight="semibold" size={18} />
          <TextInput
            ref={input}
            value={query}
            onChangeText={(t) => {
              setQuery(t);
              setCursor(0);
            }}
            placeholder="Go to a session, a project, a drop, a page"
            placeholderTextColor={nav.textFaint}
            selectionColor={accent.ink}
            autoCorrect={false}
            autoCapitalize="none"
            style={styles.input}
          />
        </View>
        <View style={styles.rule} />
        {shown.length === 0 ? (
          <T role="meta" style={[styles.none, { color: nav.textFaint }]}>
            Nothing here goes by that name.
          </T>
        ) : (
          shown.map((item, i) => (
            <Pressable
              key={item.id}
              onPress={() => go(item)}
              onHoverIn={() => setCursor(i)}
              accessibilityRole="button"
              accessibilityLabel={`${item.title}, ${KIND_LABEL[item.kind]}`}
              style={[styles.row, i === cursor ? { backgroundColor: nav.raised } : null]}
            >
              <View style={styles.rowText}>
                <T role="row" numberOfLines={1} style={{ color: i === cursor ? nav.text : nav.textDim }}>
                  {item.title}
                </T>
                <T role="meta" numberOfLines={1} style={{ color: nav.textFaint }}>
                  {item.meta}
                </T>
              </View>
              <T role="label" style={{ color: i === cursor ? accent.text : nav.textFaint }}>
                {KIND_LABEL[item.kind]}
              </T>
            </Pressable>
          ))
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: rgba(nav.bg, 0.72),
    alignItems: 'center',
    paddingTop: '14%',
    zIndex: 100,
  },
  panel: {
    width: WIDTH,
    maxWidth: '92%',
    backgroundColor: nav.card,
    borderRadius: SHAPE.container,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: nav.border,
    paddingBottom: space.sm,
    overflow: 'hidden',
  },
  field: { flexDirection: 'row', alignItems: 'center', gap: space.tile, paddingHorizontal: space.md, height: 56 },
  input: { ...roleStyle('body'), flex: 1, color: nav.text, height: 56 },
  rule: { height: StyleSheet.hairlineWidth, backgroundColor: nav.border, marginBottom: space.sm },
  row: {
    height: ROW,
    marginHorizontal: space.sm,
    paddingHorizontal: space.tile,
    borderRadius: SHAPE.inner,
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.tile,
  },
  rowText: { flex: 1, gap: 1 },
  none: { paddingHorizontal: space.md, paddingVertical: space.md },
});
