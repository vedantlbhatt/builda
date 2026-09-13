/**
 * Every text port on one page, each with a Replay, for the verify step's screenshots and screen
 * recordings. Dev only: a route that mounts it belongs to whoever owns `app/`, and the kit's
 * `KitGallery` can embed it as a block. Seeded, so two recordings of one build match.
 *
 *   <TextBitsGallery />                  the whole page
 *   <TextBitsGallery scroll={false} />    inside a host's own scroll
 *
 * Part of the react-bits text ports (by David Haz; MIT + Commons Clause, Copyright (c) 2026
 * David Haz; used as part of this application, not redistributed as components).
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy of this
 *   software and associated documentation files (the "Software"), to deal in the Software
 *   without restriction, including without limitation the rights to use, copy, modify,
 *   merge, publish, and distribute the Software as part of an application, website, or
 *   product, subject to the following conditions: The above copyright notice and this
 *   permission notice shall be included in all copies or substantial portions of the
 *   Software. Commons Clause Restriction: You may use this Software, including for any
 *   commercial purpose, so long as you do not sell, sublicense, or redistribute the
 *   components themselves, whether alone, in a bundle, or as a ported version.
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
 */
import React, { useMemo, useRef, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { archetypeHue, cardHue, harnessHue, layout, space, type Scheme } from '../../../theme';
import { Button } from '../../Button';
import { SchemeProvider, useColors } from '../../scheme';
import { Section } from '../../Section';
import { SHAPE } from '../../shape';
import { BlurText } from './BlurText';
import { GradientText } from './GradientText';
import { RotatingText, type RotatingTextRef } from './RotatingText';
import { ShinyText } from './ShinyText';
import { Shuffle } from './Shuffle';
import { SplitFlapText } from './SplitFlapText';
import { SplitText } from './SplitText';
import { TextType } from './TextType';

export interface TextBitsGalleryProps {
  scheme?: Scheme;
  /** Wrap in a ScrollView. Default true. */
  scroll?: boolean;
  seed?: number;
}

export function TextBitsGallery({ scheme = 'dark', scroll = true, seed = 7 }: TextBitsGalleryProps) {
  return (
    <SchemeProvider scheme={scheme}>
      <Body scroll={scroll} seed={seed} />
    </SchemeProvider>
  );
}

const ETA = ['no ETA yet', 'about 18m left', 'about 4m left'] as const;
const HARNESSES = [
  { id: 'claude_code', name: 'Claude Code' },
  { id: 'codex', name: 'Codex' },
  { id: 'cursor', name: 'Cursor' },
  { id: 'gemini_cli', name: 'Gemini CLI' },
] as const;

function Body({ scroll, seed }: { scroll: boolean; seed: number }) {
  const c = useColors();
  const [key, setKey] = useState(0);
  const [eta, setEta] = useState(0);
  const rotating = useRef<RotatingTextRef>(null);
  const replay = () => setKey((k) => k + 1);
  const harnessInks = useMemo(() => HARNESSES.map((h) => harnessHue(h.id)?.text), []);

  const blocks: ReactNode = (
    <View style={styles.page}>
      <Button label="Replay all" kind="secondary" block={false} onPress={replay} />

      <Block label="split text, characters">
        <SplitText text="Hi. I'm Bit." role="display" replayKey={key} accessibilityRole="header" />
      </Block>

      <Block label="split text, words">
        <SplitText text="How long are your prompts?" by="words" role="row" hue={cardHue('prompt_length', 'architect').name} replayKey={key} />
        <SplitText text="Mostly conversational. You explain, then you let it work." by="words" role="body" tone="dim" delay={300} replayKey={key} />
      </Block>

      <Block label="blur text">
        <BlurText text="Your 33 days of building" role="title" replayKey={key} />
      </Block>

      <Block label="shuffle">
        <Shuffle text="Generalist" role="hero" seed={seed} replayKey={key} />
        <Shuffle text="A back and forth" role="title" direction="down" seed={seed + 1} replayKey={key} />
      </Block>

      <Block label="text type">
        <View style={[styles.well, { backgroundColor: c.raised }]}>
          <TextType text="npx builda pair 4821" replayKey={key} />
        </View>
      </Block>

      <Block label="rotating text">
        <RotatingText ref={rotating} texts={HARNESSES.map((h) => h.name)} colors={harnessInks} role="title" key={`r${key}`} />
      </Block>

      <Block label="split flap">
        <View style={[styles.well, { backgroundColor: c.card }]}>
          <SplitFlapText text={ETA[eta % ETA.length]} seed={seed} surface={c.card} />
        </View>
        <SplitFlapText text={eta % 2 === 0 ? 'GATE 12' : 'GATE 7'} tiles role="title" seed={seed} />
        <Button label="Change the ETA" kind="secondary" block={false} onPress={() => setEta((e) => e + 1)} />
      </Block>

      <Block label="shiny text">
        <ShinyText text="Vedant's MacBook Pro" role="row" replayKey={key} />
        <ShinyText text="needs you" hue="amber" role="headline" sweeps={3} replayKey={key} />
      </Block>

      <Block label="gradient text">
        <GradientText text="Architect" hue={archetypeHue('architect').name} role="hero" replayKey={key} />
        <GradientText text="Night owl" hue={archetypeHue('night_owl').name} role="display" direction="diagonal" animate="loop" />
      </Block>
    </View>
  );

  return scroll ? (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
      {blocks}
    </ScrollView>
  ) : (
    <View style={[styles.content, { backgroundColor: c.bg }]}>{blocks}</View>
  );
}

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Section label={label} gap={space.tile}>
      {children}
    </Section>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: layout.gutter, paddingVertical: space.lg },
  page: { gap: space.section },
  well: { borderRadius: SHAPE.inner, borderCurve: 'continuous', padding: space.md, alignSelf: 'stretch' },
});
