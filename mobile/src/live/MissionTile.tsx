import React from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import type { Animal } from '../pixel/animals';
import { HarnessGlyph } from '../pixel/HarnessGlyph';
import { PixelAnimal, PixelAnimalIcon } from '../pixel/PixelAnimal';
import type { InkTone } from '../pixel/palette';
import { space } from '../theme';
import { Counter, PressableScale, Surface, T, VerdictLabel } from '../ui';
import { Bone } from '../you/States';
import {
  landedCommits,
  landedParts,
  TILE_CREATURE,
  TILE_CREATURE_CLEAR,
  TILE_CREATURE_INSET,
  TILE_MAX_SCALE,
  type TileModel,
} from './mission';

/**
 * One running session in mission control (DESIGN-DIRECTION 7.1). Everything it says comes from
 * `mission.tileModel`; this only lays it out:
 *
 *   [glyph16] builder            22m      harness glyph textDim, repo mono 13/500, elapsed 13 tabular
 *   Stuck on the same failing              the one sentence, 15/600, up to four lines
 *   command for six minutes
 *   (o) circling                          drawn verdict glyph + word, 13/500 textDim
 *   11 files              [creature 48]    rolling count 13/600 ; the ETA 12/400 textDim
 *   no ETA yet                             beside the creature, 4pt into the padding
 *
 * Needs you changes three things and no others: the amber "needs you" in the elapsed time's
 * place, the sentence saying what it waits for, and the creature (amber, and moving on the
 * first such tile only). No border, glow or fill changes: that restraint is what makes it
 * findable. A quiet or stale tile dims its sentence; a finished one sits still with what it
 * landed.
 */
export interface MissionTileProps {
  model: TileModel;
  creature: Animal;
  /** The top "needs you" tile: the one creature on the screen that moves. */
  animate: boolean;
  width: number;
  height: number;
  /** Stable across renders (the grid's one callback), so a tick redraws no tile that did not change. */
  onOpen?: (id: string) => void;
}

/**
 * Which ink the creature wears. Amber means needs you here, as it does in the corner; every other
 * creature is `faint`, a mark that recedes behind the sentence, so a glance across the grid finds
 * the amber one first (SYNTHESIS 5, technique 3: state reads before any label). In `text` ink
 * every tile would carry a bright shape competing with its own sentence. UNVERIFIED on the
 * simulator (busy in this phase): the screenshot pass should confirm the faint ink still reads
 * as a creature at 48pt on `card`.
 */
function creatureTone(m: TileModel): InkTone {
  return m.kind === 'needsYou' && !m.stale ? 'rest' : 'faint';
}

function MissionTileImpl({ model: m, creature, animate, width, height, onOpen }: MissionTileProps) {
  const { fontScale } = useWindowDimensions();
  // The kit's Counter sizes each digit column to the role's UNSCALED line, so above the default
  // text size a rolled digit is clipped. Past 1x the count is plain text, which scales.
  const roll = fontScale <= 1;
  const tone = creatureTone(m);
  const commits = m.landed ? landedCommits(m.landed) : null;

  return (
    <PressableScale
      onPress={onOpen ? () => onOpen(m.id) : undefined}
      accessibilityLabel={m.label}
      accessibilityHint="Opens the session"
      style={{ width, height }}
      testID={`mission-tile-${m.id}`}
    >
      <Surface style={styles.fill}>
        <View style={styles.header}>
          <HarnessGlyph harness={m.harness} size={16} ink="dim" />
          <T role="mono" numberOfLines={1} ellipsizeMode="middle" maxFontSizeMultiplier={TILE_MAX_SCALE} style={styles.repo}>
            {m.repo}
          </T>
          <T role="meta" tone={m.corner.tone} weight={m.corner.weight} numberOfLines={1} maxFontSizeMultiplier={TILE_MAX_SCALE}>
            {m.corner.text}
          </T>
        </View>

        <T role="row" tone={m.dim ? 'dim' : 'text'} numberOfLines={4} maxFontSizeMultiplier={TILE_MAX_SCALE} style={styles.sentence}>
          {m.sentence}
        </T>

        <View style={styles.spacer} />

        <View style={styles.footer}>
          {m.verdict ? (
            <VerdictLabel verdict={m.verdict} />
          ) : m.stateWord ? (
            <T role="meta" tone="dim" weight={500} numberOfLines={1} maxFontSizeMultiplier={TILE_MAX_SCALE}>
              {m.stateWord}
            </T>
          ) : null}
          <View style={styles.besideCreature}>
            {m.landed ? (
              <>
                <Landed landed={m.landed} />
                {commits ? (
                  <T role="label" weight={400} tone="dim" numberOfLines={1}>
                    {commits}
                  </T>
                ) : null}
              </>
            ) : (
              <>
                {m.files !== null ? (
                  roll ? (
                    <Counter value={m.files} role="meta" weight={600} tone={m.dim ? 'dim' : 'text'} suffix={m.files === 1 ? ' file' : ' files'} />
                  ) : (
                    <T role="meta" weight={600} tone={m.dim ? 'dim' : 'text'} numberOfLines={1} maxFontSizeMultiplier={TILE_MAX_SCALE}>
                      {m.files} {m.files === 1 ? 'file' : 'files'}
                    </T>
                  )
                ) : null}
                {m.eta ? (
                  <T role="label" weight={400} tone="dim" numberOfLines={1}>
                    {m.eta}
                  </T>
                ) : null}
              </>
            )}
          </View>
        </View>

        <View style={styles.creature} pointerEvents="none">
          {animate ? (
            <PixelAnimal animal={creature} size={TILE_CREATURE} tone="rest" />
          ) : (
            <PixelAnimalIcon animal={creature} size={TILE_CREATURE} tone={tone} />
          )}
        </View>
      </Surface>
    </PressableScale>
  );
}

/** "+420 -88": green added, red removed, the only colour on a tile besides amber. */
function Landed({ landed }: { landed: NonNullable<TileModel['landed']> }) {
  const p = landedParts(landed);
  if (!p.add && !p.del) {
    return p.none ? (
      <T role="meta" weight={600} tone="dim" numberOfLines={1} maxFontSizeMultiplier={TILE_MAX_SCALE}>
        {p.none}
      </T>
    ) : null;
  }
  return (
    <T role="meta" weight={600} numberOfLines={1} maxFontSizeMultiplier={TILE_MAX_SCALE}>
      {p.add ? (
        <T role="meta" weight={600} tone="add" maxFontSizeMultiplier={TILE_MAX_SCALE}>
          {p.add}
        </T>
      ) : null}
      {p.add && p.del ? ' ' : null}
      {p.del ? (
        <T role="meta" weight={600} tone="del" maxFontSizeMultiplier={TILE_MAX_SCALE}>
          {p.del}
        </T>
      ) : null}
    </T>
  );
}

/** Redrawn only when something it shows changes: the grid re-renders on a five second clock. */
export const MissionTile = React.memo(
  MissionTileImpl,
  (a, b) =>
    a.model.key === b.model.key &&
    a.animate === b.animate &&
    a.creature === b.creature &&
    a.width === b.width &&
    a.height === b.height &&
    a.onOpen === b.onOpen
);

/**
 * A tile while the first answer is on its way: the same box, the same slots, the `raised` fill
 * and no shimmer (a shimmering placeholder is on the slop list).
 */
export function MissionTileSkeleton({ width, height }: { width: number; height: number }) {
  return (
    <Surface style={{ width, height }}>
      <View style={styles.header}>
        <Bone width={16} height={16} />
        <Bone width="46%" height={13} />
      </View>
      <View style={[styles.sentence, { gap: space.sm }]}>
        <Bone width="92%" height={15} />
        <Bone width="74%" height={15} />
        <Bone width="40%" height={15} />
      </View>
      <View style={styles.spacer} />
      <View style={[styles.footer, { gap: space.sm }]}>
        <Bone width="44%" height={12} />
        <Bone width="36%" height={12} />
      </View>
      <View style={styles.creature}>
        <Bone width={TILE_CREATURE - 12} height={TILE_CREATURE - 12} />
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  // 4pt from the glyph and 8pt from the corner: at 174.5pt a seven letter repo still fits
  // beside "needs you", the widest corner.
  repo: { flex: 1, marginRight: space.xs },
  sentence: { marginTop: space.sm },
  spacer: { flex: 1 },
  footer: { gap: space.xs },
  // No gap: the two lines' own leading spaces them, and the budget is exact (header 17, gap 8,
  // four sentence lines 80, verdict 17, gap 4, files 17, ETA 14: 157 of the 160 inside).
  besideCreature: { paddingRight: TILE_CREATURE_CLEAR },
  creature: { position: 'absolute', right: TILE_CREATURE_INSET, bottom: TILE_CREATURE_INSET },
});
