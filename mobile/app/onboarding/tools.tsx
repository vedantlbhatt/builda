import { useRouter, type Href } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';

import * as cache from '../../src/data/cache';
import { BandWords } from '../../src/insights/Band';
import { numSpec } from '../../src/insights/format';
import { BandFigure } from '../../src/insights/kit';
import { ON_HUE } from '../../src/insights/palette';
import { HarnessLogo } from '../../src/pixel/HarnessLogo';
import { HARNESS_MARKS, toggleMark, type Harness, type HarnessMark } from '../../src/pixel/harness';
import { CONTINUE, grouped, readsList, sessionsCaption, TOOLS, toolsFound } from '../../src/onboarding/copy';
import { useFacts } from '../../src/onboarding/facts';
import { GUTTER, pathFor } from '../../src/onboarding/flow';
import { HueButton } from '../../src/onboarding/HueButton';
import { useLanded } from '../../src/onboarding/landing';
import { foundFor, initialTools, loadTools, marksInOrder, preselect, saveTools } from '../../src/onboarding/selection';
import { StepBand } from '../../src/onboarding/StepBand';
import { STEP_MOTION } from '../../src/onboarding/bandShader';
import { StepFrame, useBandInset } from '../../src/onboarding/StepFrame';
import { ToolTiles } from '../../src/onboarding/ToolTiles';
import { BAND_CAPTION, BAND_FIGURE, BAND_TITLE, HEADLINE, TOOLS_FIGURE_MAX } from '../../src/onboarding/type';
import { useAccent } from '../../src/theme/accent';
import { space } from '../../src/theme';
import { LogoLoop, type LoopItem } from '../../src/ui/bits/effects/LogoLoop';
import { T } from '../../src/ui';
import { useReduceMotion } from '../../src/ui/motion';

/** The marks in the drifting row (32pt, a whole-cell size for Aider's pixel glyph), and the room between them. */
const LOOP_MARK = 32;
const LOOP_GAP = 28;
/** The big count starts once the push has landed (the band prints under it first). */
const COUNT_AT_MS = 420;
/** How long to wait for the push to land before the tiles drop anyway (a deep link). */
const LAND_FALLBACK_MS = 450;

/**
 * Step 3: your tools, as a chapter. The band, in the builder's colour: when the account has
 * sessions, the number Builda found on it, huge, counting up from 0 (the analysis page's
 * `BandFigure`), with the sentence that names the tools they came from; signed out, or with
 * nothing counted, the ask. Along the band's foot every tool Builda reads drifts past with the
 * owner's own marks for them (react-bits LogoLoop, the kit's port: 36pt a second, a finger on it
 * stops it, still under Reduce Motion), the one thing on this step that moves on its own.
 *
 * On the ground, the tiles (`ToolTiles`): each tool's real mark, its name, and its own count
 * counting up; they drop into place one after another as yazio's welcome assets do, and a tile
 * chosen fills with the tool's hue in pixels (react-bits PixelCard) and throws sparks in that hue
 * (react-bits ClickSpark). The tools the sessions came from come first and start chosen. Every
 * tap is saved (`profile.tools.v1`), so walking back and forth keeps the selection.
 */
export default function ToolsStep() {
  const router = useRouter();
  const facts = useFacts();
  const accent = useAccent();
  const inset = useBandInset();
  const { width } = useWindowDimensions();
  const landed = useLanded(true, LAND_FALLBACK_MS);
  const reduced = useReduceMotion();
  const found = useMemo(() => foundFor(facts.counts), [facts.counts]);
  const marks = useMemo(() => marksInOrder(HARNESS_MARKS, found), [found]);
  const [selected, setSelected] = useState<Harness[] | null>(null);
  const stored = useRef<Harness[] | null | undefined>(undefined);
  const touched = useRef(false);

  useEffect(() => {
    let live = true;
    void loadTools(cache).then((s) => {
      if (!live) return;
      stored.current = s;
      setSelected(initialTools(s, found));
    });
    return () => {
      live = false;
    };
    // Read once; counts that land later are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The counts arrived after the step opened: pick for them, unless they already chose.
  useEffect(() => {
    if (stored.current === undefined || stored.current !== null || touched.current || !found) return;
    setSelected(preselect(found));
  }, [found]);

  // The tile ticks itself (PixelCard's `select`, on the frame of the tap); this saves the change.
  const current = useRef<Harness[]>([]);
  current.current = selected ?? [];
  const onToggle = useCallback((mark: HarnessMark) => {
    touched.current = true;
    const next = toggleMark(current.current, mark);
    current.current = next;
    setSelected(next);
    void saveTools(cache, next);
  }, []);

  const next = useCallback(async () => {
    if (selected) await saveTools(cache, selected);
    router.push(pathFor('connect') as Href);
  }, [router, selected]);

  const foundNames = useMemo(() => marks.filter((m) => m.harnesses.some((h) => (found?.[h] ?? 0) > 0)).map((m) => m.name), [marks, found]);
  const total = facts.total;
  const counted = total !== null && total > 0 && found !== undefined;

  const loop: LoopItem[] = useMemo(
    () =>
      HARNESS_MARKS.map((m) => ({
        key: m.id,
        label: m.name,
        node: (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            <HarnessLogo harness={m.harnesses[0]!} size={LOOP_MARK} color={ON_HUE} />
            <T role="row" weight={700} numberOfLines={1} style={{ color: ON_HUE }}>
              {m.name}
            </T>
          </View>
        ),
      })),
    [],
  );

  const band = (
    <StepBand motion={STEP_MOTION.tools} hue={accent} inset={inset}>
      <T role="label" style={[BAND_TITLE, { color: ON_HUE }]}>
        {TOOLS.label}
      </T>
      {counted && total !== null ? (
        <View style={{ marginTop: space.xs }}>
          {facts.partial ? (
            <BandWords delay={320}>
              <T role="meta" weight={600} style={{ color: ON_HUE }}>
                {TOOLS.atLeast}
              </T>
            </BandWords>
          ) : null}
          <BandFigure
            spec={numSpec(total, grouped(total))}
            width={width - 2 * GUTTER}
            max={TOOLS_FIGURE_MAX}
            min={BAND_FIGURE.min}
            delay={COUNT_AT_MS}
            label={`${grouped(total)} ${sessionsCaption(total, facts.partial)}`}
          />
          <BandWords delay={480}>
            <T role="headline" style={[BAND_CAPTION, { color: ON_HUE }]}>
              {sessionsCaption(total, facts.partial)}
            </T>
          </BandWords>
          <BandWords delay={560}>
            <T role="row" weight={500} style={{ color: ON_HUE, marginTop: space.sm }} accessibilityLiveRegion="polite">
              {toolsFound(total, facts.partial, foundNames)}
            </T>
          </BandWords>
        </View>
      ) : (
        <View style={{ marginTop: space.sm, gap: space.sm }}>
          <BandWords delay={260}>
            <T role="display" accessibilityRole="header" style={[HEADLINE, { color: ON_HUE }]}>
              {TOOLS.headline}
            </T>
          </BandWords>
          <BandWords delay={340}>
            <T role="body" weight={500} style={{ color: ON_HUE }}>
              {TOOLS.unknown}
            </T>
          </BandWords>
        </View>
      )}
      {/* Edge to edge, so the marks drift in from one side of the screen and off the other. Still
          (Reduce Motion), the row wraps and stands inside the gutter: edge to edge it began at the
          screen's own edge and cut the first mark in half (shots/now2/50-onboarding-04). */}
      <View style={{ marginHorizontal: reduced ? 0 : -GUTTER, marginTop: space.md }}>
        <LogoLoop items={loop} gap={LOOP_GAP} height={LOOP_MARK} accessibilityLabel={readsList(HARNESS_MARKS.map((m) => m.name))} />
      </View>
    </StepBand>
  );

  return (
    <StepFrame step="tools" band={band} actions={<HueButton label={CONTINUE} hue={accent} onPress={() => void next()} disabled={selected === null} />}>
      <ToolTiles marks={marks} selected={selected ?? []} found={found} onToggle={onToggle} play={landed} />
    </StepFrame>
  );
}
