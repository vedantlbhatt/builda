/**
 * A drop, opened: the post fills the screen and the sheet comes up over it.
 *
 * WHAT THIS REPLACED. The first version was a panel of text with the post shrunk to a 44 point
 * thumbnail in the middle of it, and for a recipe drop it showed the MOVES and never the recipe,
 * so the one thing the whole feature had gone and fetched was a line of grey text pointing
 * somewhere else. That is the opposite of the ask.
 *
 * SO THE POST IS THE SCREEN. The frame you recognise fills it, edge to edge, and the sheet is
 * translucent over the bottom of it: you can still see what you are looking at while you read
 * about it. Drag the sheet up and it takes the screen when you want the detail.
 *
 * WHAT IT IS, DECIDES WHAT IT OPENS ON. A recipe opens on the recipe, because that is what you
 * came for; everything else opens on what you could do. The other half is one word away, and the
 * word is a word, not a chip.
 *
 * Nothing here is a gradient, a pale fill of a hue with a border of the same hue, or a box that
 * exists to have a border.
 */
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import React, { useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  FadeIn,
  FadeOut,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { dropHue } from '../theme';
import { Button } from '../ui/Button';
import { T } from '../ui/Text';
import { TextField } from '../ui/TextField';
import { commit, select } from '../ui/haptics';
import { useColors } from '../ui/scheme';
import { hostOf } from './CardView';
import { EFFORT_WORD, KIND_WORD, MOVE_TARGET_WORD, PLATFORM_WORD, REFUSAL, readLine, STATUS_LINE } from './copy';
import { MoveRowView } from './MoveRow';
import { RecipeSteps } from './RecipeSteps';
import { StepBar, StepPager } from './StepPager';
import { movesOf, type DropRow, type MoveRow } from './types';
import { WordToggle } from './WordToggle';

/** Where the sheet rests, as a share of the screen. Two detents and no more: a sheet with five
 * is a sheet nobody knows the shape of. */
const REST = 0.56;
const TALL = 0.94;

export interface DropSheetProps {
  drop: DropRow;
  moves: MoveRow[];
  onStart: (moveIds: string[], adjustment: string | null, repoKeys: Record<string, string>) => void;
  onArchive: () => void;
  onClose: () => void;
}

export function DropSheet({ drop, moves, onStart, onArchive, onClose }: DropSheetProps) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const hue = drop.kind ? dropHue(drop.kind) : null;
  const ink = hue?.ink ?? c.textDim;

  const mine = useMemo(() => movesOf(moves, drop.id), [moves, drop.id]);
  const recipe = drop.resolution?.plan?.recipe ?? null;
  const source = drop.resolution?.source ?? null;
  const busy = drop.status === 'waiting' || drop.status === 'resolving';

  const [tab, setTab] = useState<'recipe' | 'do'>(recipe ? 'recipe' : 'do');
  const [armed, setArmed] = useState<string[]>([]);
  const [repos, setRepos] = useState<Record<string, string>>({});
  const [saying, setSaying] = useState(false);
  const [adjustment, setAdjustment] = useState('');
  /** Which step of the method is showing. Here and not in `RecipeSteps`, because the control that
   *  changes it is pinned to the foot of this sheet rather than set in the scroll under it. */
  const [step, setStep] = useState(0);
  const stageY = React.useRef(0);
  const steps = recipe?.steps ?? [];

  const scroller = React.useRef<ScrollView>(null);
  const restTop = height * (1 - REST);
  const tallTop = height * (1 - TALL);
  const top = useSharedValue(restTop);
  const start = useSharedValue(restTop);

  const drag = Gesture.Pan()
    .onBegin(() => {
      start.value = top.value;
    })
    .onUpdate((e) => {
      top.value = Math.min(restTop + 90, Math.max(tallTop, start.value + e.translationY));
    })
    .onEnd((e) => {
      const goingUp = e.velocityY < -300 || top.value < (restTop + tallTop) / 2;
      if (top.value > restTop + 60) {
        runOnJS(onClose)();
        return;
      }
      top.value = withSpring(goingUp ? tallTop : restTop, { damping: 20, stiffness: 180 });
    });

  const sheetStyle = useAnimatedStyle(() => ({ top: top.value }));
  /** 1 while the frame is showing, 0 once the sheet has covered it. */
  const posterChromeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(top.value, [tallTop, tallTop + 90], [0, 1], Extrapolation.CLAMP),
  }));
  const sheetChromeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(top.value, [tallTop, tallTop + 90], [1, 0], Extrapolation.CLAMP),
  }));
  const posterStyle = useAnimatedStyle(() => ({
    // The frame lifts a little as the sheet comes up, so the two move as one thing.
    transform: [{ scale: 1 + (restTop - top.value) / (restTop * 26) }],
  }));

  const toggle = (id: string) =>
    setArmed((was) => (was.includes(id) ? was.filter((x) => x !== id) : [...was, id]));

  /**
   * The sentence over the Start button: what is armed, where it lands, and how long it is.
   *
   * Longest effort of the armed set, not the sum: they run one after another and the honest
   * number is nobody's to give, so it says the biggest piece rather than pretending to add.
   */
  const whereLine = useMemo(() => {
    const picked = moves.filter((m) => armed.includes(m.id));
    if (!picked.length) return '';
    const targets = [...new Set(picked.map((m) => MOVE_TARGET_WORD[m.target]))];
    const rank = { minutes: 0, an_hour: 1, a_session: 2 } as Record<string, number>;
    const effort = picked
      .map((m) => m.effort)
      .sort((a, b) => (rank[b] ?? 0) - (rank[a] ?? 0))[0];
    const parts = [
      armed.length === 1 ? '1 armed' : `${armed.length} armed`,
      targets.length === 1 ? targets[0] : 'in a few places',
      effort ? EFFORT_WORD[effort] : null,
    ];
    return parts.filter(Boolean).join('  ·  ');
  }, [armed, moves]);

  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(140)}
      style={[StyleSheet.absoluteFill, { backgroundColor: c.bg }]}
    >
      {/* THE POST, full bleed. */}
      <Animated.View style={[StyleSheet.absoluteFill, posterStyle]}>
        {drop.thumbnail_url ? (
          <Image
            source={{ uri: drop.thumbnail_url }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={240}
            cachePolicy="memory-disk"
            accessibilityIgnoresInvertColors
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.blank]}>
            <T role="display" style={{ color: c.raised }}>
              {PLATFORM_WORD[drop.platform]}
            </T>
            <T role="mono" style={{ color: c.textFaint, marginTop: 8 }}>
              {hostOf(drop.url)}
            </T>
          </View>
        )}
      </Animated.View>

      {/* THE SHEET. Translucent, so the frame stays visible behind what you are reading. */}
      <GestureDetector gesture={drag}>
        <Animated.View style={[styles.sheet, sheetStyle]}>
          <BlurView intensity={64} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(16,14,12,0.62)' }]} />

          {/* THE WAY OUT, WHERE THE POSTER IS NOT.
              CLOSE sits on the frame, which at full height is a 40 point sliver behind this
              sheet's own title — so it was drawn over the word "A RECIPE". Both live on the same
              curve now: the chrome on the frame fades out as the sheet covers it, and the grab
              bar turns into the word, in the one place a thumb is already going. */}
          <View style={styles.grab}>
            <Animated.View
              style={[styles.grabBar, { backgroundColor: c.textFaint }, posterChromeStyle]}
            />
            <Animated.View style={[styles.grabClose, sheetChromeStyle]}>
              <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={20}>
                <T role="label" style={{ color: c.textDim, letterSpacing: 1.6 }}>
                  CLOSE
                </T>
              </Pressable>
            </Animated.View>
          </View>

          <View style={styles.head}>
            <T role="label" style={{ color: ink, letterSpacing: 1.4 }}>
              {(drop.kind ? KIND_WORD[drop.kind] : 'unread').toUpperCase()}
            </T>
            <T role="mono" numberOfLines={1} style={{ color: 'rgba(245,241,234,0.45)' }}>
              {source?.author ? `@${source.author}` : hostOf(drop.url)}
            </T>
          </View>

          <T role="title" numberOfLines={2} style={styles.title}>
            {drop.title ?? hostOf(drop.url)}
          </T>

          {recipe ? (
            <View style={styles.tabs}>
              <WordToggle word="RECIPE" on={tab === 'recipe'} ink={ink} onPress={() => setTab('recipe')} />
              <WordToggle
                word={`TO DO  ${mine.length}`}
                on={tab === 'do'}
                ink={ink}
                onPress={() => setTab('do')}
              />
            </View>
          ) : null}

          <ScrollView
            ref={scroller}
            style={styles.body}
            contentContainerStyle={{
              paddingBottom:
                insets.bottom +
                (armed.length && (!recipe || tab === 'do')
                  ? 142
                  : recipe && tab === 'recipe' && steps.length > 1
                    ? 78
                    : 28),
            }}
            showsVerticalScrollIndicator={false}
          >
            {drop.summary && (!recipe || tab === 'do') ? (
              <T role="body" style={styles.summary}>
                {drop.summary}
              </T>
            ) : null}

            {busy ? (
              <T role="meta" style={styles.faint}>
                {STATUS_LINE[drop.status]}
              </T>
            ) : null}

            {drop.refusal ? (
              <View style={{ marginTop: 6 }}>
                <T role="body" style={{ color: '#F5F1EA' }}>
                  {REFUSAL[drop.refusal]}
                </T>
                {source ? (
                  <T role="mono" style={[styles.faint, { marginTop: 8 }]}>
                    {readLine(source.caption_chars, source.transcript_chars)}
                  </T>
                ) : null}
              </View>
            ) : null}

            {recipe && tab === 'recipe' ? (
              <View style={styles.recipe}>
                <RecipeSteps recipe={recipe} step={step} onStageY={(y) => (stageY.current = y)} />
              </View>
            ) : null}

            {(!recipe || tab === 'do') && mine.length ? (
              <View style={styles.moves}>
                {mine.map((m) => (
                  <MoveRowView
                    key={m.id}
                    move={m}
                    kind={drop.kind}
                    armed={armed.includes(m.id)}
                    onToggle={toggle}
                    repoKey={repos[m.id] ?? m.repo_key}
                    onChooseRepo={(id, key) => {
                      setRepos((was) => ({ ...was, [id]: key }));
                      setArmed((was) => (was.includes(id) ? was : [...was, id]));
                    }}
                  />
                ))}
              </View>
            ) : null}

            {/* The method's control, pinned. `paddingBottom` on the scroller above leaves it room. */}
          {recipe && tab === 'recipe' && steps.length > 1 ? (
            <StepBar bottom={insets.bottom}>
              <StepPager
                count={steps.length}
                step={step}
                ink={ink}
                onStep={(next) => {
                  setStep(next);
                  // Full height, and that step at the top of the scroller. You asked for the next
                  // instruction; the next instruction is what should be on the screen.
                  top.value = withSpring(tallTop, { damping: 20, stiffness: 180 });
                  scroller.current?.scrollTo({ y: Math.max(0, stageY.current - 12), animated: true });
                }}
              />
            </StepBar>
          ) : null}

          {armed.length && (!recipe || tab === 'do') ? (
              <Animated.View entering={FadeIn.duration(150)} style={styles.say}>
                {saying ? (
                  <TextField
                    accessibilityLabel="In your words"
                    value={adjustment}
                    onChangeText={setAdjustment}
                    placeholder="Anything to add before it starts"
                    multiline
                  />
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      select();
                      setSaying(true);
                    }}
                  >
                    <T role="row" style={{ color: ink }}>
                      Say more first
                    </T>
                  </Pressable>
                )}
              </Animated.View>
            ) : null}

            <Pressable accessibilityRole="button" onPress={onArchive} style={styles.archive}>
              <T role="meta" style={styles.faint}>
                Archive this drop
              </T>
            </Pressable>
          </ScrollView>

          {/* The method's control, pinned. `paddingBottom` on the scroller above leaves it room. */}
          {recipe && tab === 'recipe' && steps.length > 1 ? (
            <StepBar bottom={insets.bottom}>
              <StepPager
                count={steps.length}
                step={step}
                ink={ink}
                onStep={(next) => {
                  setStep(next);
                  // Full height, and that step at the top of the scroller. You asked for the next
                  // instruction; the next instruction is what should be on the screen.
                  top.value = withSpring(tallTop, { damping: 20, stiffness: 180 });
                  scroller.current?.scrollTo({ y: Math.max(0, stageY.current - 12), animated: true });
                }}
              />
            </StepBar>
          ) : null}

          {armed.length && (!recipe || tab === 'do') ? (
            <Animated.View
              entering={FadeIn.duration(160)}
              style={[styles.bar, { paddingBottom: 14 + insets.bottom }]}
            >
              {/* The bar has to stop the list at its own edge. It sat at 92% over a translucent
                  sheet and the next move's heading read straight through the amber. */}
              <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
              <View style={[StyleSheet.absoluteFill, styles.barGround]} />
              {/* WHERE IT RUNS, before the button that runs it. A primary button on its own says
                  only "something happens"; this is somebody's machine about to do work, and the
                  one line above the button is the difference between a tap and a decision. */}
              <T role="mono" style={[styles.where, { color: c.textDim }]}>
                {whereLine}
              </T>
              <Button
                kind="primary"
                label={armed.length === 1 ? 'Start it' : `Start ${armed.length}`}
                onPress={() => {
                  commit();
                  onStart(armed, adjustment.trim() || null, repos);
                  setArmed([]);
                  setRepos({});
                  setSaying(false);
                  setAdjustment('');
                }}
              />
            </Animated.View>
          ) : null}
        </Animated.View>
      </GestureDetector>

      {/* The chrome on the frame, drawn ABOVE the sheet and fading as the sheet covers the frame.
          Under it, dragging up to read a long list buried CLOSE and left a guessed gesture as the
          only way back to the board. Over it and always visible, it printed itself across the
          sheet's own title. It belongs to the frame, so it lives exactly as long as the frame
          does, and the grab bar carries the word the rest of the time. */}
      <Animated.View
        pointerEvents="box-none"
        style={[styles.top, { paddingTop: insets.top + 8 }, posterChromeStyle]}
      >
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={16}>
          <View style={styles.chip}>
            <T role="label" style={styles.chipText}>
              CLOSE
            </T>
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Open the original post"
          onPress={() => Linking.openURL(drop.url)}
          hitSlop={16}
        >
          <View style={styles.chip}>
            <T role="label" style={styles.chipText}>
              {`OPEN ON ${PLATFORM_WORD[drop.platform].toUpperCase()}`}
            </T>
          </View>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  blank: { alignItems: 'center', justifyContent: 'center' },
  top: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
  },
  // A solid ink pill on a photograph, so the words read over any frame. Not a tinted chip: one
  // fill, one colour, no border.
  chip: {
    backgroundColor: 'rgba(12,11,10,0.62)',
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    borderCurve: 'continuous',
  },
  chipText: { color: '#F5F1EA', letterSpacing: 1.3 },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  grab: { alignItems: 'center', justifyContent: 'center', height: 26, paddingTop: 6 },
  grabClose: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  grabBar: { width: 38, height: 4, borderRadius: 2, borderCurve: 'continuous', opacity: 0.7 },
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingHorizontal: 18,
    paddingTop: 6,
  },
  title: { color: '#F5F1EA', paddingHorizontal: 18, paddingTop: 6 },
  tabs: { flexDirection: 'row', gap: 22, paddingHorizontal: 18, marginTop: 16 },
  body: { flex: 1, marginTop: 10 },
  summary: { color: 'rgba(245,241,234,0.72)', paddingHorizontal: 18, marginBottom: 6 },
  faint: { color: 'rgba(245,241,234,0.45)', paddingHorizontal: 18 },
  recipe: { paddingHorizontal: 18, marginTop: 2 },
  moves: { marginTop: 12 },
  say: { marginTop: 16, paddingHorizontal: 18 },
  archive: { marginTop: 26, alignItems: 'center' },
  where: { textAlign: 'center', marginBottom: 10 },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 18,
    paddingTop: 14,
    overflow: 'hidden',
  },
  barGround: { backgroundColor: 'rgba(12,10,9,0.94)' },
});
