import { useFocusEffect, useRouter, type Href } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { ReduceMotion, runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ON_HUE } from '../../src/insights/palette';
import { RevealPage, Section } from '../../src/insights/reveal';
import { CONTINUE, HELLO } from '../../src/onboarding/copy';
import { coverWith } from '../../src/onboarding/dissolve';
import { loadFacts } from '../../src/onboarding/facts';
import { GUTTER, HELLO_BIT, HELLO_PRINT_MS, HELLO_SWIPE, pathFor, swipeCommits, swipeProgress } from '../../src/onboarding/flow';
import { HelloBit } from '../../src/onboarding/HelloBit';
import { HueButton } from '../../src/onboarding/HueButton';
import { canCover } from '../../src/onboarding/PixelDissolve';
import { ReadsLine } from '../../src/onboarding/ReadsLine';
import { Rise } from '../../src/onboarding/Rise';
import { StepBand } from '../../src/onboarding/StepBand';
import { STEP_MOTION } from '../../src/onboarding/bandShader';
import { useStepPage } from '../../src/onboarding/stepPage';
import { HEADLINE, HINT } from '../../src/onboarding/type';
import { useAccent } from '../../src/theme/accent';
import { colors, space } from '../../src/theme';
import { PixelBlast } from '../../src/ui/bits/backgrounds/PixelBlast';
import { SplitText } from '../../src/ui/bits/text/SplitText';
import { SymbolIcon, T, useReduceMotion } from '../../src/ui';

const c = colors('dark');

/** A saved creature is read in a frame or two; past this the band prints in the default colour. */
const ACCENT_WAIT_MS = 300;
/** The field develops in once the band has printed under it (the band's print is 560ms). */
const FIELD_AFTER_MS = 600;
/** The headline starts once the band is mostly printed; the line once the headline has landed. */
const HEADLINE_AT_MS = 320;
const LINE_AT_MS = HELLO_PRINT_MS + 900;
/** The field's pace against react-bits' already slowed ambient clock: calm, behind Bit. */
const FIELD_SPEED = 0.6;
/** Past the cover (340ms) and its stale guard (600ms): a press after this can go again. */
const LEAVING_RESET_MS = 1500;

/** Where a view is on screen, in window points: the cover's origin and its grid's anchor. */
function whereIs(view: View | null): Promise<{ x: number; y: number; width: number; height: number } | null> {
  return new Promise((resolve) => {
    if (!view) return resolve(null);
    view.measureInWindow((x, y, width, height) => resolve(width > 0 ? { x, y, width, height } : null));
  });
}

/**
 * Step 0: hello, a full bleed moment in the builder's colour (the owner, 2026-09-13: the theme
 * is the creature's hue; on a first run that is the default creature's, on a later run the one
 * they picked).
 *
 * The band prints itself from the top of the screen (the analysis page's band), a calm field of
 * react-bits PixelBlast clouds develops on it in the colour's partner tone (DESIGN-V2 3.1 put
 * PixelBlast on hello), Bit prints itself in the band's ink in the middle and then blinks twice
 * (duolingo), the headline arrives a character at a time (react-bits SplitText), and under it
 * the tools Builda reads turn over one at a time with the owner's own marks (liquid glass's
 * third line, `ReadsLine`). Under the band, on the warm ground, one line and Continue.
 *
 * The page can be lifted: the swipe up hero from appllama-liquid-glass-screens (the finger moves
 * the page 1:1, 25% past its travel, a release goes on at `p + 0.18 v > 0.5`, liquid glass's
 * landing spring). Going on, by the finger or by Continue, is react-bits PixelTransition across
 * the two routes (`PixelDissolve`): the colour gathers over the screen in 32pt cells laid on
 * Bit's grid, closing on the finger, the name step is pushed under it, and the cells clear out of
 * the finger onto the name step's band of the same colour.
 *
 * Reduce Motion: everything is at rest, the field holds one frame, the page does not follow the
 * finger past a spring, and the name step fades in.
 */
export default function HelloStep() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const reduced = useReduceMotion();
  const accent = useAccent();
  const bit = useRef<View>(null);
  const action = useRef<View>(null);
  const leaving = useRef(false);

  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), ACCENT_WAIT_MS);
    return () => clearTimeout(t);
  }, []);
  const ready = accent.ready || waited;
  const page = useStepPage(ready);

  const [field, setField] = useState(false);
  const [line, setLine] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const a = setTimeout(() => setField(true), FIELD_AFTER_MS);
    const b = setTimeout(() => setLine(true), LINE_AT_MS);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [ready]);

  // ─── the lift ───
  const travel = Math.round(height * HELLO_SWIPE.travel);
  const lift = useSharedValue(0);

  useFocusEffect(
    useCallback(() => {
      // Every run of the flow starts here: read the account afresh (a sign in or a sign out
      // since the flow last opened changes what the steps can say).
      void loadFacts(true);
      leaving.current = false;
      lift.value = 0;
      return () => {
        // Walking back to hello finds the page where it rests, not lifted off: put it back once
        // the name step is over it.
        setTimeout(() => {
          lift.value = 0;
        }, 700);
      };
    }, [lift]),
  );

  const go = useCallback(
    async (origin: readonly [number, number] | null) => {
      if (leaving.current) return;
      leaving.current = true;
      const face = await whereIs(bit.current);
      const anchor: readonly [number, number] | null = face ? [face.x, face.y] : null;
      const push = () => router.push({ pathname: pathFor('name'), params: { via: 'cells' } } as Href);
      if (reduced || !canCover() || !coverWith(accent.ink, accent.partner, { origin, anchor }, push)) {
        router.push(pathFor('name') as Href);
      }
      // The belt: a push that never happened must not leave Continue dead. Leaving for real, the
      // focus effect above resets it on the way back anyway.
      setTimeout(() => {
        leaving.current = false;
      }, LEAVING_RESET_MS);
    },
    [router, reduced, accent.ink, accent.partner],
  );

  const fromFinger = useCallback((x: number, y: number) => void go([x, y]), [go]);
  const fromButton = useCallback(async () => {
    const b = await whereIs(action.current);
    void go(b ? [b.x + b.width / 2, b.y + b.height / 2] : null);
  }, [go]);

  // Memoised: a re-render mid drag (the field or the line arriving) must not hand the detector a
  // new gesture while a finger is down.
  const pan = useMemo(() => {
    const spring = reduced ? HELLO_SWIPE.reducedSpring : HELLO_SWIPE.spring;
    return Gesture.Pan()
      .activeOffsetY([-12, 12])
      .failOffsetX([-24, 24])
      .onUpdate((e) => {
        lift.value = swipeProgress(e.translationY, travel);
      })
      .onEnd((e) => {
        const v = travel > 0 ? -e.velocityY / travel : 0;
        if (swipeCommits(lift.value, v)) {
          lift.value = withSpring(1, { ...spring, velocity: v, reduceMotion: ReduceMotion.Never });
          runOnJS(fromFinger)(e.absoluteX, e.absoluteY);
        } else {
          lift.value = withSpring(0, { ...spring, velocity: v, reduceMotion: ReduceMotion.Never });
        }
      });
  }, [reduced, travel, lift, fromFinger]);

  const lifted = useAnimatedStyle(() => ({ transform: [{ translateY: -lift.value * travel }] }));
  const hintFrom = HELLO_SWIPE.hintFrom;
  const hintTo = HELLO_SWIPE.hintTo;
  const hint = useAnimatedStyle(() => {
    const k = (lift.value - hintFrom) / (hintTo - hintFrom);
    return { opacity: 1 - Math.min(1, Math.max(0, k)) };
  });

  // The field's box: the room above the words, edge to edge. Bit's box is cleared in it.
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const onStage = useCallback((e: LayoutChangeEvent) => {
    const { width, height: h } = e.nativeEvent.layout;
    setStage((s) => (s.w === width && s.h === h ? s : { w: width, h }));
  }, []);
  const clear = stage.w > 0 ? { x: (stage.w - HELLO_BIT) / 2, y: (stage.h - HELLO_BIT) / 2, width: HELLO_BIT, height: HELLO_BIT } : null;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <RevealPage page={page}>
        <Section style={{ flex: 1 }}>
          <GestureDetector gesture={pan}>
            <View style={{ flex: 1 }}>
              <StepBand motion={STEP_MOTION.hello} hue={accent} inset={insets.top} fill>
                <Animated.View style={[{ flex: 1 }, lifted]}>
                  {/* The one centred thing is Bit: it is what is being looked at. */}
                  <View onLayout={onStage} style={{ flex: 1, marginHorizontal: -GUTTER, alignItems: 'center', justifyContent: 'center' }}>
                    {field && stage.w > 0 ? (
                      <PixelBlast
                        width={stage.w}
                        height={stage.h}
                        hue={accent.name}
                        ink={accent.partner}
                        levels={2}
                        speed={FIELD_SPEED}
                        clear={clear}
                        develop
                        interactive
                        style={{ position: 'absolute', left: 0, top: 0 }}
                      />
                    ) : null}
                    <View ref={bit} collapsable={false}>
                      <HelloBit size={HELLO_BIT} color={ON_HUE} />
                    </View>
                  </View>
                  <View style={{ gap: space.sm, paddingTop: space.md }}>
                    <SplitText text={HELLO.headline} textStyle={HEADLINE} color={ON_HUE} accessibilityRole="header" play={ready} delay={HEADLINE_AT_MS} />
                    <ReadsLine color={ON_HUE} play={line} />
                  </View>
                </Animated.View>
              </StepBand>
              <View style={{ paddingHorizontal: GUTTER, gap: space.md }}>
                <Rise index={0} delay={HEADLINE_AT_MS + 400}>
                  <T role="body" tone="dim">
                    {HELLO.body}
                  </T>
                </Rise>
                <Animated.View style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }, hint]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  <SymbolIcon name="chevron.up" size={13} weight="bold" tone="dim" />
                  <T role="label" tone="dim" style={HINT}>
                    {HELLO.hint}
                  </T>
                </Animated.View>
              </View>
              <View ref={action} collapsable={false} style={{ marginHorizontal: GUTTER, marginTop: space.sm, marginBottom: insets.bottom + space.sm }}>
                <HueButton label={CONTINUE} hue={accent} onPress={() => void fromButton()} />
              </View>
            </View>
          </GestureDetector>
        </Section>
      </RevealPage>
    </View>
  );
}
