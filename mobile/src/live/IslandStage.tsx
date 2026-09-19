/**
 * The top of Now: the island, opened all the way.
 *
 * WHAT THIS REPLACED. A hue band printed itself in, a creature drew itself on it pixel by pixel,
 * the words rose and a big number counted up from zero: the same entrance as eight other screens
 * (docs/motion.md, "Why the app looked the same everywhere"). Now has something none of the
 * others have, which is the island itself: it is the screen for what is happening elsewhere on
 * your behalf, and so is the island. So Now opens ON the island. The black shape comes out of
 * the hardware island at the top of the phone and grows to the width of the screen on the island
 * spring, and what it says is what the island would say, larger: the crew's face and state, a
 * wheel of what each run is doing, the rail of faces. Leave the app and the same object keeps
 * going in the system island.
 *
 * Three states, each its own face: running (the crew's lead, working), needs you (amber washes
 * down from the top, lids down), and quiet (your creature asleep, the glow gone grey, and the one
 * line that opens the session that finished last).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { tokens } from '../generated/tokens';
import { Face, RippleItem, Wash, Wheel, useMorph, RAIL_STAGGER_MS, ISLAND_BLACK } from '../motion';
import type { CrewMember } from '../island/model';
import type { Animal } from '../pixel/animals';
import { T } from '../ui/Text';
import { select } from '../ui/haptics';
import type { SummaryHead } from './mission';

const S = tokens.surface;
const INK = S.text.dark;
const DIM = 'rgba(245,241,234,0.56)';
const AMBER = tokens.spectrum.hues.amber.dark;

/** The hardware island's size: where the stage starts its first morph from. */
const PILL = { w: 125, h: 37, r: 18.5 };
/** How often the wheel steps to the next run while several are going. */
const STEP_MS = 2600;

export function IslandStage({
  width,
  head,
  crew,
  you,
  quiet,
  lastLine,
  onOpenLast,
  onPress,
}: {
  width: number;
  head: SummaryHead | null;
  crew: readonly CrewMember[];
  /** Your own creature, for the quiet stage. */
  you: { animal: Animal; ink: string };
  quiet: boolean;
  lastLine: string | null;
  onOpenLast?: () => void;
  onPress?: () => void;
}) {
  const waiting = crew.find((m) => m.state === 'waiting') ?? null;
  const lead = waiting ?? crew[0] ?? null;
  const h = quiet ? 250 : crew.length > 1 ? 214 : 112;
  // First the pill, then the stage: the screen opens by growing out of the island.
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setGrown(true), 60);
    return () => clearTimeout(t);
  }, []);
  const target = grown ? { w: width, h, r: 44 } : PILL;
  const { box, contentIn } = useMorph(target, grown ? 'open' : 'pill');

  const [i, setI] = useState(0);
  useEffect(() => {
    if (crew.length < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % crew.length), STEP_MS);
    return () => clearInterval(t);
  }, [crew.length]);
  const rows = useMemo(() => crew.map((m) => ({ key: m.sessionId, text: `${m.repo} · ${m.sentence}` })), [crew]);
  const index = Math.min(i, Math.max(0, rows.length - 1));
  const cur = crew[index] ?? lead;

  return (
    <View style={styles.anchor}>
      <Pressable disabled={!onPress} onPress={() => { select(); onPress?.(); }} accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={head?.label ?? 'All quiet. Nothing needs you.'}>
        <Animated.View style={[styles.stage, box]}>
          <Wash color={waiting ? AMBER : null} from="top" strength={0.3} />
          <Animated.View style={[{ width, height: h }, contentIn]}>
            {quiet || !lead ? (
              <View style={styles.quiet}>
                <Face animal={you.animal} state="sleep" ink={you.ink} size={64} />
                <T role="title" style={{ color: INK, marginTop: 14 }} accessibilityRole="header">
                  All quiet.
                </T>
                <Text style={styles.subQuiet}>Nothing needs you. Go do something else.</Text>
                {lastLine ? (
                  <Pressable accessibilityRole="button" hitSlop={10} onPress={() => { select(); onOpenLast?.(); }} style={{ marginTop: 18 }}>
                    <Text style={styles.last}>{`${lastLine} →`}</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : (
              <View style={styles.row}>
                {/* Tiles on the black only when there are two things to set side by side: one tile
                    filling the whole stage read as a second black frame around the card. */}
                <View style={[crew.length > 1 ? styles.card : styles.bare, { flex: 1 }]}>
                  <View style={styles.top}>
                    <Face animal={cur!.animal} state={cur!.state} ink={cur!.ink} size={48} />
                    <View style={{ marginLeft: 14, flex: 1 }}>
                      {head ? (
                        <T role="title" style={{ color: waiting ? AMBER : INK }}>{`${head.figure} ${head.word}`}</T>
                      ) : null}
                      {head?.lines[0] ? <Text style={styles.sub}>{head.lines.join(', ')}</Text> : null}
                    </View>
                  </View>
                  {/* One run: its tile right below already says what it is doing, so the stage does
                      not say it twice. The wheel earns its place when it steps between runs. */}
                  {crew.length > 1 ? (
                    <View style={{ marginTop: 16 }}>
                      <Wheel rows={rows} index={index} width={width - 118} rowHeight={22} visible={crew.length > 2 ? 3 : 2} textStyle={styles.wheel} dim={DIM} bright={INK} />
                    </View>
                  ) : null}
                </View>
                {crew.length > 1 ? (
                  <View style={styles.rail}>
                    {crew.slice(0, 5).map((m, k) => (
                      <RippleItem key={m.sessionId} i={k} per={RAIL_STAGGER_MS}>
                        <Face animal={m.animal} state={m.state} ink={m.ink} size={16} glow={false} alive={false} style={{ opacity: k === index ? 1 : 0.55 }} />
                      </RippleItem>
                    ))}
                  </View>
                ) : null}
              </View>
            )}
          </Animated.View>
        </Animated.View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: { alignItems: 'center' },
  stage: { backgroundColor: ISLAND_BLACK, borderCurve: 'continuous', overflow: 'hidden' },
  quiet: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  row: { flex: 1, flexDirection: 'row', padding: 12, gap: 10 },
  card: { borderRadius: 32, borderCurve: 'continuous', backgroundColor: 'rgba(255,255,255,0.05)', padding: 16, justifyContent: 'center' },
  bare: { padding: 16, justifyContent: 'center' },
  top: { flexDirection: 'row', alignItems: 'center' },
  rail: { width: 44, borderRadius: 22, borderCurve: 'continuous', backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center', gap: 10 },
  sub: { color: DIM, fontSize: 15, marginTop: 4 },
  subQuiet: { color: DIM, fontSize: 15, marginTop: 4, textAlign: 'center' },
  last: { color: INK, fontSize: 15, fontWeight: '600' },
  wheel: { fontSize: 15, fontWeight: '500' },
});
