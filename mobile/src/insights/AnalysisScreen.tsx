/**
 * Your analysis: every piece of analysis the app has, on one scrolling page, composed like a
 * printed report. Each chapter is a colour world from the spectrum (a band in its hue that
 * prints itself in 1-bit pixels), its one big number counts up from zero the first time it
 * scrolls into view, and every chart draws on as it arrives: lines trace, bars grow with a
 * spring's give, rings and the donut sweep from 12 o'clock, grids fill in a wave. Then it is
 * still. Reduce Motion puts everything at rest behind a 150 ms fade.
 *
 * Every number is the one the rest of the app says (`model.ts`), every refusal is a sentence,
 * and the last chapter lists everything the page could not see and why.
 */
import { Stack } from 'expo-router';
import React, { memo, useMemo } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { resolveAnimal } from '../pixel/animals';
import { useReduceMotion } from '../ui/motion';
import { doorHues } from '../you/chapters';
import { useMoneyMask } from '../you/hooks';
import { timeOfDay } from '../copy/time';
import { dayOf } from '../you/numbers';
import { GUTTER, Refusal, type, Words } from './kit';
import { analysisModel, REPORT_COMMAND } from './model';
import { CREATURE_HUE, creatureHue, GROUND } from './palette';
import { Block, RevealPage, Section, usePageReveal } from './reveal';
import { useChapterStages, useRevealScroll } from './RevealScroll';
import * as Agent from './sections/Agent';
import * as Hero from './sections/Hero';
import * as Money from './sections/Money';
import * as Reading from './sections/Reading';
import * as Shipping from './sections/Shipping';
import * as Time from './sections/Time';
import * as Trends from './sections/Trends';
import { useAnalysis } from './useAnalysis';

// Each chapter re-renders only when its own part of the model does: a chapter mounting below it,
// the mask flipping or a refresh that changed nothing never touches a number mid count.
const HeroSection = memo(Hero.HeroSection);
const TimeSection = memo(Time.TimeSection);
const ShippingSection = memo(Shipping.ShippingSection);
const AgentWorkSection = memo(Agent.AgentWorkSection);
const AgentsSection = memo(Agent.AgentsSection);
const MoneySection = memo(Money.MoneySection);
const TrendsSection = memo(Trends.TrendsSection);
const QualitySection = memo(Trends.QualitySection);
const StandsOutSection = memo(Reading.StandsOutSection);
const WordsSection = memo(Reading.WordsSection);
const CannotSeeSection = memo(Reading.CannotSeeSection);

export function AnalysisScreen() {
  const { width } = useWindowDimensions();
  const reduced = useReduceMotion();
  const page = usePageReveal(reduced);
  const { load, chosenAnimal, refresh, refreshing } = useAnalysis();
  const mask = useMoneyMask();

  const builder = load.kind === 'ready' ? load.builder : null;
  const profile = load.kind === 'ready' ? load.profile : null;
  const model = useMemo(() => (builder ? analysisModel(builder, profile) : null), [builder, profile]);

  // The chapters mount one at a time, the first alone, and nothing plays until the page is on
  // screen and still (`RevealScroll.tsx`, where both rules live for every chaptered page).
  const { stage, hurry } = useChapterStages(CHAPTERS, model !== null);
  const { scrollRef, onScroll, onLayout } = useRevealScroll(page, hurry);

  const animal = resolveAnimal(chosenAnimal, model?.hero.archetypeId ?? null);
  const hue = creatureHue(animal);
  // The ways on at the foot of the page wear the hues their doors wear on the You tab.
  const doors = useMemo(() => doorHues(CREATURE_HUE[animal] ?? 'amber'), [animal]);
  const generated = builder?.report?.generated_at ?? null;
  const footer = useMemo(() => {
    if (!generated) return null;
    const t = Date.parse(generated);
    const day = dayOf(generated);
    return Number.isFinite(t) && day ? `Your Mac computed this report on ${day} at ${timeOfDay(t)}.` : null;
  }, [generated]);

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Your analysis',
          headerLargeTitle: true,
          headerLargeTitleShadowVisible: false,
          headerShadowVisible: false,
          headerTransparent: false,
          headerBackground: undefined,
          headerStyle: { backgroundColor: GROUND.bg },
          headerLargeStyle: { backgroundColor: GROUND.bg },
          headerTintColor: GROUND.text,
          headerTitleStyle: { color: GROUND.text },
          headerLargeTitleStyle: { color: GROUND.text },
        }}
      />
      <Animated.ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onLayout={onLayout}
        refreshControl={
          load.kind === 'signedOut' ? undefined : <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={GROUND.dim} />
        }
      >
        <RevealPage page={page}>
          <Section style={styles.lead}>
            <Block>
              {load.kind === 'ready' && model ? (
                <>
                  <Words style={type.dim}>{model.coverage.line}</Words>
                  {model.coverage.caveat ? <Words style={[type.dim, { color: GROUND.text, marginTop: 6 }]}>{model.coverage.caveat}</Words> : null}
                  {load.stale ? <Words style={[type.meta, { marginTop: 6 }]}>{`${load.stale.replace(/\.?$/, '.')} Showing what was saved.`}</Words> : null}
                  {!model.hasReport ? (
                    <View style={{ marginTop: 12, gap: 6 }}>
                      <Refusal>Most of this page arrives with the report from your Mac. Run this there:</Refusal>
                      <Text selectable style={type.mono}>
                        {REPORT_COMMAND}
                      </Text>
                    </View>
                  ) : null}
                </>
              ) : load.kind === 'signedOut' ? (
                <View style={{ gap: 12 }}>
                  <Words style={type.body}>Sign in to see your analysis. Your sessions live on your account, and this page reads them there.</Words>
                  <Reading.GoLink title="Sign in" href="/settings" color={GROUND.text} />
                </View>
              ) : load.kind === 'error' ? (
                <View style={{ gap: 12 }}>
                  <Refusal>{load.message}</Refusal>
                  <Pressable accessibilityRole="button" onPress={() => void refresh()} style={({ pressed }) => [styles.retry, { opacity: pressed ? 0.6 : 1 }]}>
                    <Text style={type.lead}>Try again</Text>
                  </Pressable>
                </View>
              ) : (
                <Words style={type.dim}>Reading your sessions.</Words>
              )}
            </Block>
          </Section>

          {load.kind === 'loading' ? <Skeleton /> : null}

          {model ? (
            <>
              <HeroSection hero={model.hero} animal={animal} hue={hue} width={width} />
              {stage >= 1 ? <TimeSection time={model.time} width={width} /> : null}
              {stage >= 2 ? <ShippingSection shipping={model.shipping} width={width} /> : null}
              {stage >= 3 ? <AgentWorkSection work={model.agentWork} width={width} /> : null}
              {stage >= 4 ? <AgentsSection agents={model.agents} width={width} /> : null}
              {stage >= 5 ? <MoneySection money={model.money} width={width} masked={mask.masked} onToggleMask={mask.toggle} /> : null}
              {stage >= 6 ? <TrendsSection trends={model.trends} width={width} /> : null}
              {stage >= 7 ? <QualitySection quality={model.quality} width={width} /> : null}
              {stage >= 8 ? <StandsOutSection standsOut={model.standsOut} /> : null}
              {stage >= 9 ? <WordsSection words={model.words} width={width} doors={doors} /> : null}
              {stage >= 10 ? <CannotSeeSection gaps={model.gaps} footer={footer} /> : null}
            </>
          ) : null}
        </RevealPage>
      </Animated.ScrollView>
    </>
  );
}

/** Chapters after the first; they mount one per `NEXT_CHAPTER_MS` (`RevealScroll.tsx`). */
const CHAPTERS = 10;

/** The page's shape while the first answer is on its way: the first band and its lines, flat. */
function Skeleton() {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ marginTop: 20, gap: 14 }}>
      <View style={styles.skeletonBand} />
      {[0.7, 0.9, 0.5].map((w) => (
        <View key={w} style={[styles.skeletonLine, { width: `${w * 100}%` }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: GROUND.bg },
  content: { paddingBottom: 120 },
  lead: { paddingHorizontal: GUTTER, paddingTop: 4, paddingBottom: 20 },
  retry: { alignSelf: 'flex-start', paddingVertical: 10 },
  skeletonBand: { height: 220, backgroundColor: GROUND.raised },
  skeletonLine: { height: 14, marginLeft: GUTTER, backgroundColor: GROUND.card },
});
