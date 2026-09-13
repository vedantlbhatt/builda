import React, { useCallback, useEffect, useRef } from 'react';
import { PixelRatio, useWindowDimensions, View } from 'react-native';

import { numSpec } from '../insights/format';
import { Num } from '../insights/Num';
import { Block } from '../insights/reveal';
import { HarnessLogo } from '../pixel/HarnessLogo';
import { HARNESS_LOGOS } from '../pixel/harnessLogos';
import { isMarkSelected, PICKER, sessionsFor, tileWidthInside, type Harness, type HarnessMark } from '../pixel/harness';
import { harnessHue, type HueName } from '../theme';
import { ClickSpark, type ClickSparkHandle } from '../ui/bits/effects/ClickSpark';
import { PixelCard, type PixelCardFace } from '../ui/bits/components/PixelCard';
import { useColors } from '../ui/scheme';
import { T } from '../ui/Text';
import { grouped, sessionWord } from './copy';
import { GUTTER } from './flow';
import { Pop } from './Pop';
import { TILE_COUNT, TILE_NAME, TILE_UNIT } from './type';

/** A tile: room for the mark, the name and a count line. */
const TILE_HEIGHT = 100;
const LOGO = 32;
/** How long after the step is armed a tile's count starts, so it counts after the push has landed. */
const COUNT_AFTER_MS = 420;
/**
 * The spark's rays fly past the tile's own edges, so they are seen on the ground and not lost on
 * the tile's fill of the same hue: the kit's 24pt flight times this (90pt, past the corner of a
 * tile about 110 by 100), each ray 24pt long at launch so it is still a stroke when it leaves.
 */
const SPARK_REACH = 3.75;
const SPARK_LENGTH = 24;

/**
 * The tools step's picker: one tile per tool, three to a row, each with the tool's REAL mark (the
 * owner's logos, `HarnessLogo`; Aider has none and keeps its pixel glyph), its name, and, when the
 * account has sessions from it, how many, counting up from 0 on the analysis page's clock.
 *
 * Selecting is react-bits PixelCard (the kit's port): the tile fills with the tool's own hue in
 * pixels growing out of the finger, the words flip to the band's ink as the fill passes half way,
 * and a burst of react-bits ClickSpark sparks in the same hue leaves the tile. The monochrome
 * marks (Cursor, Cline, opencode) take the words' colour; Claude, Codex and Gemini keep their own.
 * The tiles arrive the way yazio's welcome assets do (`Pop`), one after another, once the step
 * has landed.
 *
 * Controlled: `selected` comes from the step, a tap asks `onToggle`.
 */
export function ToolTiles({
  marks,
  selected,
  found,
  onToggle,
  play,
}: {
  marks: readonly HarnessMark[];
  selected: readonly Harness[];
  found: Partial<Record<Harness, number>> | undefined;
  onToggle: (mark: HarnessMark) => void;
  play: boolean;
}) {
  const { width } = useWindowDimensions();
  const scale = PixelRatio.get();
  // Floor to whole device pixels: three tiles rounded UP by a pixel each no longer fit in a row.
  const tileW = Math.floor(tileWidthInside(width - 2 * GUTTER) * scale) / scale;
  // A block only for its clock: the counts read it. The tiles' arrival is their own (`Pop`).
  return (
    <Block enter={false} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: PICKER.gap }}>
      {marks.map((m, i) => (
        <ToolTile
          key={m.id}
          index={i}
          mark={m}
          width={tileW}
          selected={isMarkSelected(selected, m)}
          sessions={sessionsFor(m, found)}
          onToggle={onToggle}
          play={play}
        />
      ))}
    </Block>
  );
}

function ToolTile({
  index,
  mark,
  width,
  selected,
  sessions,
  onToggle,
  play,
}: {
  index: number;
  mark: HarnessMark;
  width: number;
  selected: boolean;
  sessions: number | undefined;
  onToggle: (mark: HarnessMark) => void;
  play: boolean;
}) {
  const hue: HueName = harnessHue(mark.id)?.name ?? 'cobalt';
  const spark = useRef<ClickSparkHandle>(null);
  const was = useRef(selected);
  // A spark when the tile is chosen, not when it is let go of, and not for the tiles the step
  // opens with already chosen.
  useEffect(() => {
    if (selected && !was.current) spark.current?.spark();
    was.current = selected;
  }, [selected]);
  const press = useCallback(() => onToggle(mark), [onToggle, mark]);
  const count = sessions !== undefined && sessions > 0 ? sessions : null;
  const label = count !== null ? `${mark.name}, ${grouped(count)} ${sessionWord(count)}` : mark.name;

  return (
    <Pop index={index} play={play}>
      <ClickSpark ref={spark} hue={hue} sparkOnPress={false} length={SPARK_LENGTH} extraScale={SPARK_REACH}>
        <PixelCard hue={hue} selected={selected} onPress={press} width={width} height={TILE_HEIGHT} padding={0} accessibilityLabel={label}>
          {(face) => <Face mark={mark} face={face} count={count} />}
        </PixelCard>
      </ClickSpark>
    </Pop>
  );
}

/** What a tile shows in one state. PixelCard swaps the two as its fill passes half way. */
function Face({ mark, face, count }: { mark: HarnessMark; face: PixelCardFace; count: number | null }) {
  const c = useColors();
  // The mark keeps its own colours where the owner's logo has them; a monochrome one takes the
  // words' colour, and Aider's pixel glyph its hue's ink on the idle tile.
  const harness = mark.harnesses[0]!;
  const mono = HARNESS_LOGOS[harness]?.mono ?? true;
  const logoColor = face.filled ? face.text : mono && HARNESS_LOGOS[harness] ? c.text : face.ink;
  return (
    <View style={{ paddingHorizontal: 14, paddingTop: 14, gap: 6 }}>
      <HarnessLogo harness={harness} size={LOGO} color={logoColor} />
      <View>
        <T role="meta" numberOfLines={1} style={[TILE_NAME, { color: face.text }]}>
          {mark.name}
        </T>
        {count !== null ? (
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
            <Num spec={numSpec(count, grouped(count))} textStyle={[TILE_COUNT, { color: face.text }]} delay={COUNT_AFTER_MS} />
            <T role="label" style={[TILE_UNIT, { color: face.dim }]}>
              {sessionWord(count)}
            </T>
          </View>
        ) : null}
      </View>
    </View>
  );
}
