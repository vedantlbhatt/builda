/**
 * One category as a chapter: a band in its own hue that prints itself, the count of things in it
 * huge, what that count splits into, and the category's marks printed along the band's foot. Under
 * it, on the ground, the things a session used as tiles sized by their sessions (`packTiles`: a
 * leader across the row, the middle ones half, the rest a third), each with its mark in its brand's
 * colour, its sessions counting up, the day it started and a hairline bar of its share of every
 * session. Last, quietly, what only a manifest names: grey marks and one sentence.
 *
 * A tap turns a tile over (Apple Fitness's trophy case, design-md/fitness/apple-fitness: "tapping a
 * medallion flips it to show detail"): it fills with the chapter's hue in pixels from the finger
 * (react-bits PixelCard), its words turn to the dark ink on the fill, it says its story, and sparks
 * leave the finger in the brand's colour (react-bits ClickSpark). Both ports are David Haz's, MIT +
 * Commons Clause, with the notice in each port's header. Tapping it again turns it back.
 *
 * The grey for what is only named is react-bits ChromaGrid's rule (every card greyscale until it is
 * lit): colour here means a session used it.
 */
import React, { memo, useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Band, BandWords } from '../insights/Band';
import { GrowBar } from '../insights/Bars';
import { BandFigure, figure, GUTTER, type, Words } from '../insights/kit';
import { Num } from '../insights/Num';
import { GROUND, SPECTRUM, type Hue } from '../insights/palette';
import { Block, Section } from '../insights/reveal';
import { hue as themeHue } from '../theme';
import { ClickSpark } from '../ui/bits/effects';
import { PixelCard, type PixelCardFace } from '../ui/bits/components';
import { Arrive } from '../you/parts';
import { packTiles, type Tile, type TileRow, type TileSize } from './layout';
import { inkFor } from './marks';
import { MarkView } from './Mark';
import type { StackChapter, StackThing } from './model';
import { PrintedMarks } from './Print';

/** Between tiles, across and down. */
const GAP = 8;
/** Inside a tile. */
const PAD = 12;
/** Rows that arrive together, as one block, as the chapter scrolls into view. */
const ROWS_PER_BLOCK = 2;
/** The step between one tile arriving and the next. */
const TILE_STEP = 60;

/** A tile's type, by its size and by how wide it came out (two leads share a row). */
function faceScale(size: TileSize, units: number) {
  if (size === 'lead' && units >= 6) return { mark: 52, count: 50, name: 18, meta: 13 };
  if (size === 'lead' || units >= 4) return { mark: 40, count: 38, name: 16, meta: 13 };
  if (size === 'mid') return { mark: 34, count: 30, name: 15, meta: 13 };
  return { mark: 26, count: 22, name: 13, meta: 12 };
}

export const StackChapterView = memo(function StackChapterView({ chapter, width }: { chapter: StackChapter; width: number }) {
  const h: Hue = SPECTRUM[chapter.hue];
  const inner = width - GUTTER * 2;
  const rows = useMemo(() => packTiles(chapter.used.map((t) => ({ key: t.id, value: t.sessions })), inner, GAP), [chapter.used, inner]);
  const byId = useMemo(() => new Map(chapter.used.map((t) => [t.id as string, t])), [chapter.used]);
  const blocks = useMemo(() => {
    const out: TileRow[][] = [];
    for (let i = 0; i < rows.length; i += ROWS_PER_BLOCK) out.push(rows.slice(i, i + ROWS_PER_BLOCK));
    return out;
  }, [rows]);
  const [picked, setPicked] = useState<string | null>(null);
  const onPick = useCallback((id: string) => setPicked((p) => (p === id ? null : id)), []);
  const everything = useMemo(() => [...chapter.used, ...chapter.named], [chapter.used, chapter.named]);

  return (
    <Section style={styles.chapter}>
      <Band hue={h} index={chapter.index} title={chapter.title}>
        <View style={styles.side}>
          <BandFigure spec={chapter.count} width={inner * 0.42} max={104} min={52} delay={200} label={`${chapter.count.final} ${chapter.caption}`} />
          <View style={styles.sideWords}>
            <BandWords delay={320}>
              <Text maxFontSizeMultiplier={1.3} style={type.bandCaption}>
                {chapter.caption}
              </Text>
            </BandWords>
          </View>
        </View>
        <BandWords delay={400}>
          <Text maxFontSizeMultiplier={1.3} style={[type.bandNote, styles.note]}>
            {chapter.note}
          </Text>
        </BandWords>
        <PrintedMarks things={everything} used={chapter.used.length} hue={h} width={inner} />
      </Band>

      {blocks.map((group, gi) => (
        // Keyed by what it draws, so a refresh that changes it plays it again rather than mounting
        // a count into a clock that has already stopped.
        <Block
          key={group.map((r) => r.tiles.map((t) => `${t.key}.${byId.get(t.key)?.sessions ?? 0}`).join(' ')).join(' / ')}
          style={gi === 0 ? styles.tilesFirst : styles.tiles}
        >
          {group.map((row, ri) => (
            <View key={row.tiles[0]!.key} style={[styles.row, { height: row.h }, ri > 0 ? styles.rowNext : null]}>
              {row.tiles.map((tile, ti) => (
                <ThingTile
                  key={tile.key}
                  thing={byId.get(tile.key)!}
                  tile={tile}
                  height={row.h}
                  chapter={chapter}
                  picked={picked === tile.key}
                  onPick={onPick}
                  delay={40 + (ri * 3 + ti) * TILE_STEP}
                />
              ))}
            </View>
          ))}
        </Block>
      ))}

      {chapter.named.length ? (
        <Block style={styles.named}>
          <View style={styles.namedMarks}>
            {chapter.named.map((t) => (
              <MarkView key={t.id} mark={t.mark} size={22} color={GROUND.faint} />
            ))}
          </View>
          {chapter.namedLine ? <Words style={type.dim}>{chapter.namedLine}</Words> : null}
        </Block>
      ) : null}
    </Section>
  );
});

const ThingTile = memo(function ThingTile({
  thing,
  tile,
  height,
  chapter,
  picked,
  onPick,
  delay,
}: {
  thing: StackThing;
  tile: Tile;
  height: number;
  chapter: StackChapter;
  picked: boolean;
  onPick: (id: string) => void;
  delay: number;
}) {
  const ink = inkFor(thing.mark, SPECTRUM[chapter.hue].ink);
  const spark = useMemo(() => ({ ...themeHue(chapter.hue), ink }), [chapter.hue, ink]);
  const s = faceScale(tile.size, tile.units);
  const lead = tile.size === 'lead' && tile.units >= 6;
  return (
    <Arrive delay={delay}>
      <ClickSpark hue={spark}>
        <PixelCard
          hue={chapter.hue}
          selected={picked}
          onPress={() => onPick(thing.id)}
          idle="card"
          shape="inner"
          padding={PAD}
          width={tile.w}
          height={height}
          accessibilityLabel={`${thing.name}. ${thing.story}`}
          accessibilityHint={picked ? 'Turns the tile back' : 'Says when it started'}
        >
          {(face: PixelCardFace) => (
            <View style={[styles.face, { height: height - PAD * 2 }]}>
              <View style={styles.faceTop}>
                <MarkView mark={thing.mark} size={s.mark} color={face.filled ? face.ink : ink} />
                <Num spec={thing.count} textStyle={figure(s.count, face.filled ? face.text : lead ? ink : GROUND.text)} delay={delay + 120} />
              </View>
              <View style={styles.faceFoot}>
                <Text
                  maxFontSizeMultiplier={1.2}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                  style={[styles.name, { fontSize: s.name, lineHeight: Math.round(s.name * 1.25), color: face.text }]}
                >
                  {thing.name}
                </Text>
                {face.filled ? (
                  // Turned over, a tile reads with its own count: [6] of 143 sessions, first on Aug 15.
                  // The leader has the room to say what was seen of it too; the full story is its label.
                  <>
                    {(lead ? [[thing.ofTotal, thing.firstOn].filter(Boolean).join(', '), thing.seen] : [thing.ofTotal, thing.firstOn]).filter(Boolean).map((line) => (
                      <Text
                        key={line}
                        maxFontSizeMultiplier={1.2}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.8}
                        style={[styles.meta, { fontSize: s.meta, lineHeight: Math.round(s.meta * 1.3), color: face.dim }]}
                      >
                        {line}
                      </Text>
                    ))}
                  </>
                ) : (
                  <>
                    <Text maxFontSizeMultiplier={1.2} numberOfLines={1} style={[styles.meta, { fontSize: s.meta, lineHeight: Math.round(s.meta * 1.3), color: face.dim }]}>
                      {thing.since ? `since ${thing.since}` : thing.ofAll}
                    </Text>
                    <GrowBar frac={thing.share} color={ink} height={3} delay={delay + 200} style={styles.bar} />
                  </>
                )}
              </View>
            </View>
          )}
        </PixelCard>
      </ClickSpark>
    </Arrive>
  );
});

const styles = StyleSheet.create({
  chapter: { marginTop: 36 },
  side: { flexDirection: 'row', alignItems: 'flex-end', gap: 14 },
  sideWords: { flex: 1, paddingBottom: 12 },
  note: { marginTop: 6 },
  // The band's dissolve is 36 pt of broken hue; the tiles start a clear step below it.
  tilesFirst: { paddingHorizontal: GUTTER, marginTop: 14 },
  tiles: { paddingHorizontal: GUTTER, marginTop: GAP },
  row: { flexDirection: 'row', gap: GAP },
  rowNext: { marginTop: GAP },
  face: { justifyContent: 'space-between' },
  faceTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  faceFoot: { gap: 2 },
  name: { fontWeight: '700', letterSpacing: -0.2 },
  meta: { fontWeight: '500' },
  bar: { marginTop: 6 },
  named: { paddingHorizontal: GUTTER, marginTop: 18, gap: 10 },
  namedMarks: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'center' },
});
