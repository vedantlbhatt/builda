/**
 * The money Sankey, drawn: `flow.ts` decides every flow, width and label; this draws them with
 * Skia on the warm dark ground and lets a tap follow one stream.
 *
 * HOW IT ARRIVES. The whole picture prints itself left to right the first time its block plays:
 * a sweep crosses the width and every cell behind its edge switches on through the kit's 8x8
 * Bayer dither, so the leading edge is a band of scattered cells rather than a hard line. It is
 * the band's own print (`insights/Band.tsx`: react-bits PixelTransition's arrival order through
 * react-bits Dither's Bayer matrix, David Haz, MIT + Commons Clause; the notice is in
 * `src/ui/digits.ts`; used as part of this application, not redistributed), turned on its side
 * so the money pours from the tokens to the commits. Each label rises in as the sweep reaches its
 * column (react-bits AnimatedContent, by way of `BandWords`) and its figure counts up then
 * (react-bits CountUp, by way of `Num`). After that nothing moves. Reduce Motion: the block's
 * clock lands at once, so the picture is simply there.
 *
 * WHAT IT IS MADE OF. Dollars are solid colour: a node in its hue's ink, the stream it sends in
 * the hue's partner (a hue at partial opacity over this ground reads brown; the partner is the
 * hue's own receding tone). The tokens, before the rule where they are priced, are GRAIN: the
 * raised ground with its faint grey dithered over a third of the cells, because a token is not
 * yet a dollar and should not look like one. The grey stream is the ground's light grey, solid,
 * so it reads as grey and nothing else. A stream the report does not split is an outline, dashed.
 *
 * A TAP lights one node with every stream in and out of it, or one stream with its two ends,
 * and dims the rest; the sentence under the picture says what it carries. A second tap on it,
 * or on the ground, puts everything back.
 */
import { Canvas, DashPathEffect, Group, Line, Mask, Path, Rect, Shader, Skia, vec, type SkPath, type SkRect, type SkRuntimeEffect } from '@shopify/react-native-skia';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View, type StyleProp, type TextStyle } from 'react-native';
import Animated, {
  Easing,
  measure,
  runOnJS,
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedStyle,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { countLanded, formatWith, restingText, type NumSpec } from '../insights/format';
import { figure, type } from '../insights/kit';
import { COUNT_MS, ease, phase, SECTION_CLOCK_MS } from '../insights/motion';
import { GROUND } from '../insights/palette';
import { useClock, useReducedSV } from '../insights/reveal';
import { MASKED_DOLLARS } from '../you/numbers';
import { hitTest, LABEL_KNOCKOUT_PAD, litBy, type FlowNode, type LaidLabel, type MoneyFlow, type Ribbon, type SankeyLayout } from './flow';

// ------------------------------------------------------------------ timing (above the worklets: a worklet's closure is read where it is declared)

/** When the sweep starts on the flow's own clock, how long it takes to cross, and how wide its dithered edge is. */
export const SWEEP_AT = 60;
export const SWEEP_MS = 1400;
/** The sweep has landed: from here the picture is drawn with no mask at all. */
export const SWEEP_END = SWEEP_AT + SWEEP_MS;
const FRINGE = 30;
/** One dither cell, in points: the band's, whole device pixels at @2x and @3x. */
const CELL = 3;
/** How much of the canvas has to be above the bottom of the screen before the flow starts to draw. */
const SHOWN = 0.6;
/** The flow's own clock: long enough for the last label's count to land. */
const FLOW_CLOCK_MS = SECTION_CLOCK_MS;

// ------------------------------------------------------------------ worklet helpers (before any worklet that calls them)

/**
 * The sweep's pace: under way at once and landing softly, so the flow pours rather than lurches.
 * FOUND IN THE CAPTURE (2026-09-13): an ease in and out left the block standing empty for most
 * of a second after it arrived, because its first quarter moves the edge 6% of the way.
 */
function pour(x: number): number {
  'worklet';
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return 1 - Math.pow(1 - x, 1.7);
}

/** Where the sweep's edge is, in points, at block clock `t`. */
function sweepEdge(t: number, width: number): number {
  'worklet';
  return -FRINGE + (width + FRINGE * 2) * pour(phase(t, SWEEP_AT, SWEEP_MS));
}

// ------------------------------------------------------------------ shaders
/** How much of the token stream's grain is lit, at rest and when tapped: a texture under words, never a pattern over them. */
const GRAIN = 0.14;
const GRAIN_LIT = 0.3;
/** How far everything not lit by a tap falls back. */
const DIMMED = 0.24;
/** A label's rise, once the sweep has reached it. */
const LABEL_MS = 320;

const BAYER = `
float b2(float2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
float b8(float2 a) { return b2(a * 0.25) * 0.0625 + b2(a * 0.5) * 0.25 + b2(a); }
`;

/** The sweep: every cell left of the edge on, a dithered fringe, nothing past it. Alpha only. */
const SWEEP_SKSL = `
uniform float edge;
uniform float fringe;
uniform float cell;
${BAYER}
half4 main(float2 p) {
  float2 c = floor(p / cell);
  float x = (c.x + 0.5) * cell;
  float d = clamp((edge - x) / fringe, 0.0, 1.0);
  float on = b8(p / cell) < d * 0.999 ? 1.0 : 0.0;
  return half4(on);
}
`;

/** The token stream's grain: a share of the cells lit in one ink. */
const GRAIN_SKSL = `
uniform float cell;
uniform float density;
uniform half4 ink;
${BAYER}
half4 main(float2 p) {
  float on = b8(p / cell) < density ? 1.0 : 0.0;
  return ink * half(on);
}
`;

const effects: { sweep?: SkRuntimeEffect | null; grain?: SkRuntimeEffect | null } = {};
function effect(name: 'sweep' | 'grain'): SkRuntimeEffect | null {
  if (effects[name] === undefined) {
    effects[name] = Skia.RuntimeEffect.Make(name === 'sweep' ? SWEEP_SKSL : GRAIN_SKSL);
    if (!effects[name] && __DEV__) console.warn(`[money/Sankey] the ${name} shader did not compile; it draws plain`);
  }
  return effects[name] ?? null;
}

function rgba(hex: string): [number, number, number, number] {
  const v = parseInt(hex.slice(1, 7), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255, 1];
}

// ------------------------------------------------------------------ paths

/** A ribbon's two S edges, with both handles at the middle of the span (`flow.edgeY` and `ribbonT` read the same curve). */
function ribbonPath(r: Ribbon): SkPath {
  const p = Skia.Path.Make();
  const xm = (r.x0 + r.x1) / 2;
  p.moveTo(r.x0, r.y0a);
  p.cubicTo(xm, r.y0a, xm, r.y1a, r.x1, r.y1a);
  p.lineTo(r.x1, r.y1b);
  p.cubicTo(xm, r.y1b, xm, r.y0b, r.x0, r.y0b);
  p.close();
  return p;
}

/** The token stream, with the grey stream's lane taken out of its foot while the grey is away. */
function trunkPath(t: NonNullable<SankeyLayout['trunk']>, grey: SankeyLayout['grey']): SkPath {
  const p = Skia.Path.Make();
  p.moveTo(t.x0, t.top);
  p.lineTo(t.x1, t.top);
  p.lineTo(t.x1, t.bottom);
  if (grey) {
    p.lineTo(grey.rejoin, t.bottom);
    p.lineTo(grey.rejoin, t.bottom - grey.thick);
    p.lineTo(grey.split, t.bottom - grey.thick);
    p.lineTo(grey.split, t.bottom);
  }
  p.lineTo(t.x0, t.bottom);
  p.close();
  return p;
}

/** The grey stream as one shape: down, along and back up. */
function greyPath(g: NonNullable<SankeyLayout['grey']>): SkPath {
  const [down, along, up] = g.parts as [Ribbon, Ribbon, Ribbon];
  const p = Skia.Path.Make();
  const m1 = (down.x0 + down.x1) / 2;
  const m2 = (up.x0 + up.x1) / 2;
  p.moveTo(down.x0, down.y0a);
  p.cubicTo(m1, down.y0a, m1, down.y1a, down.x1, down.y1a);
  p.lineTo(along.x1, along.y1a);
  p.cubicTo(m2, up.y0a, m2, up.y1a, up.x1, up.y1a);
  p.lineTo(up.x1, up.y1b);
  p.cubicTo(m2, up.y1b, m2, up.y0b, up.x0, up.y0b);
  p.lineTo(along.x0, along.y0b);
  p.cubicTo(m1, down.y1b, m1, down.y0b, down.x0, down.y0b);
  p.close();
  return p;
}

// ------------------------------------------------------------------ the picture

export interface SankeyProps {
  flow: MoneyFlow;
  layout: SankeyLayout;
  masked: boolean;
  selected: string | null;
  onSelect: (id: string | null) => void;
}

/** When the sweep reaches `at` (a fraction of the width), in block clock ms. */
function arrival(at: number, width: number): number {
  const want = (at * width + FRINGE * 1.2) / (width + FRINGE * 2);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (pour(mid) < want) lo = mid;
    else hi = mid;
  }
  return Math.round(SWEEP_AT + hi * SWEEP_MS);
}

/**
 * The flow's own clock, which starts only once the canvas itself is on screen.
 *
 * FOUND IN REVIEW (2026-09-13): the block's clock starts when the block's top comes in at the
 * bottom of the screen, when this canvas, the block's tallest part, is still mostly below it, so
 * on a slow scroll the sweep ran where nobody could see it. From the moment the block arrives a
 * frame callback measures the canvas, one frame at a time, until `SHOWN` of it is above the
 * bottom edge; then this clock runs 0 to `FLOW_CLOCK_MS`, once, and the callback stops. Under
 * Reduce Motion it lands at once. The resting state never waits on an animation: a timer puts it
 * at rest whatever happened to the timing (reveal.tsx's rule).
 */
function useFlowClock(): { clock: SharedValue<number>; box: ReturnType<typeof useAnimatedRef<View>>; landed: boolean } {
  const block = useClock();
  const reduced = useReducedSV();
  const { height: screen } = useWindowDimensions();
  const clock = useSharedValue(0);
  const started = useSharedValue(0);
  const box = useAnimatedRef<View>();
  const [landed, setLanded] = useState(false);
  const safety = useRef<ReturnType<typeof setTimeout> | null>(null);

  const watch = useFrameCallback(() => {
    if (started.value) return;
    const m = measure(box);
    if (!m || m.height <= 0) return;
    if (!reduced.value && m.pageY + m.height * SHOWN > screen) return;
    started.value = 1;
    clock.value = reduced.value ? FLOW_CLOCK_MS : withTiming(FLOW_CLOCK_MS, { duration: FLOW_CLOCK_MS, easing: Easing.linear });
    runOnJS(afterStart)();
  }, false);

  function afterStart() {
    watch.setActive(false);
    if (safety.current) return;
    safety.current = setTimeout(() => {
      if (clock.value < FLOW_CLOCK_MS) clock.value = FLOW_CLOCK_MS;
    }, FLOW_CLOCK_MS + 400);
  }
  useEffect(
    () => () => {
      if (safety.current) clearTimeout(safety.current);
    },
    [],
  );

  const activate = useCallback(() => watch.setActive(true), [watch]);
  useAnimatedReaction(
    () => block.value > 0,
    (arrived, was) => {
      if (arrived && !was) runOnJS(activate)();
    },
  );
  // Once, when the sweep has landed: the picture drops its mask for good.
  useAnimatedReaction(
    () => clock.value >= SWEEP_END,
    (done, was) => {
      if (done && !was) runOnJS(setLanded)(true);
    },
  );
  return { clock, box, landed };
}

export function Sankey({ flow, layout, masked, selected, onSelect }: SankeyProps) {
  const { clock, box, landed } = useFlowClock();
  const reduced = useReducedSV();
  const { width, height } = layout;
  const sweep = effect('sweep');
  const grain = effect('grain');
  const sweeping = !!sweep;

  const nodeOf = useMemo(() => new Map(flow.nodes.map((x) => [x.id, x])), [flow]);
  const linkOf = useMemo(() => new Map(flow.links.map((x) => [x.id, x])), [flow]);
  const paths = useMemo(
    () => ({
      links: layout.links.map((l) => ({ id: l.id, path: ribbonPath(l.ribbon) })),
      fans: layout.fans.map((f) => ({ id: f.id, path: ribbonPath(f.ribbon) })),
      trunk: layout.trunk ? trunkPath(layout.trunk, layout.grey) : null,
      grey: layout.grey ? greyPath(layout.grey) : null,
    }),
    [layout],
  );

  const lit = useMemo(() => litBy(flow, selected), [flow, selected]);
  const on = (id: string) => !lit || lit.has(id);

  // Everything not lit falls back together, over a fifth of a second (at once under Reduce Motion).
  const focus = useSharedValue(0);
  useEffect(() => {
    focus.value = reduced.value ? (selected ? 1 : 0) : withTiming(selected ? 1 : 0, { duration: 200 });
  }, [selected, focus, reduced]);
  const dim = useDerivedValue(() => 1 - (1 - DIMMED) * focus.value);

  // Only while the sweep is under way: once it has landed neither is read (the mask is gone), and
  // the clip is only ever built when the sweep's shader failed to compile.
  const sweepU = useDerivedValue(() => ({ edge: sweepEdge(clock.value, width), fringe: FRINGE, cell: CELL }));
  const clip = useDerivedValue(() => (sweeping ? null : Skia.XYWHRect(0, 0, Math.max(0, sweepEdge(clock.value, width) + FRINGE / 2), height)));
  const trunkLit = selected === 'trunk' || !!selected?.startsWith('bucket:');
  const grainU = useMemo(() => ({ cell: CELL, density: trunkLit ? GRAIN_LIT : GRAIN, ink: rgba(trunkLit ? GROUND.dim : GROUND.faint) }), [trunkLit]);

  const picture = (
    <Group>
      {paths.trunk ? (
        <Group opacity={on('trunk') ? 1 : dim}>
          <Path path={paths.trunk} color={GROUND.raised} />
          {grain ? (
            <Path path={paths.trunk}>
              <Shader source={grain} uniforms={grainU} />
            </Path>
          ) : null}
        </Group>
      ) : null}
      {paths.grey ? <Path path={paths.grey} color={selected === 'grey' ? GROUND.text : GROUND.dim} opacity={on('grey') ? 1 : dim} /> : null}
      {paths.fans.map(({ id, path }) => {
        const model = nodeOf.get(id.slice(4));
        if (!model) return null;
        return <Path key={id} path={path} color={selected === id ? model.hue.ink : model.hue.partner} opacity={on(id) || on(model.id) ? 1 : dim} />;
      })}
      {paths.links.map(({ id, path }) => {
        const l = linkOf.get(id);
        if (!l) return null;
        if (l.hollow) {
          return (
            <Path key={id} path={path} style="stroke" strokeWidth={1.25} color={selected === id ? l.hue.ink : l.hue.partner} opacity={on(id) ? 1 : dim}>
              <DashPathEffect intervals={[4, 3]} />
            </Path>
          );
        }
        return <Path key={id} path={path} color={selected === id ? l.hue.ink : l.hue.partner} opacity={on(id) ? 1 : dim} />;
      })}
      {layout.trunk ? (
        <Line p1={vec(layout.trunk.x1, layout.trunk.top - 10)} p2={vec(layout.trunk.x1, layout.trunk.bottom + 10)} color={GROUND.dim} strokeWidth={1} />
      ) : null}
      {layout.nodes.map((nd) => {
        const f = nodeOf.get(nd.id);
        if (!f) return null;
        if (f.hollow) {
          // An end the report does not show: a dashed rule where the node would be, the dashes
          // of the stream that runs into it. (An outlined box read as a missing glyph.)
          return (
            <Line key={nd.id} p1={vec(nd.x + nd.w / 2, nd.y)} p2={vec(nd.x + nd.w / 2, nd.y + nd.h)} strokeWidth={2} color={f.hue.ink} opacity={on(nd.id) ? 1 : dim}>
              <DashPathEffect intervals={[3, 3]} />
            </Line>
          );
        }
        return <Rect key={nd.id} x={nd.x} y={nd.y} width={nd.w} height={nd.h} color={f.hue.ink} opacity={on(nd.id) || (f.labelOf ? on(f.labelOf) : false) ? 1 : dim} />;
      })}
      {layout.leaders.map((l, i) => (
        <Line key={`leader${i}`} p1={vec(l.x0, l.y0)} p2={vec(l.x1, l.y1)} color={GROUND.faint} strokeWidth={1} />
      ))}
    </Group>
  );

  return (
    <Animated.View ref={box} collapsable={false} style={{ width, height }}>
      <Pressable
        accessible={false}
        style={StyleSheet.absoluteFill}
        onPress={(e) => {
          const id = hitTest(layout, e.nativeEvent.locationX, e.nativeEvent.locationY);
          onSelect(id && id === selected ? null : id);
        }}
      >
        <Canvas style={{ width, height }}>
          {landed ? (
            // At rest the mask would let every cell through: drawn without it, the same picture
            // costs no offscreen layers and no shader, and a tap's dim redraws only the streams.
            picture
          ) : sweep ? (
            <Mask
              mode="alpha"
              mask={
                <Rect x={0} y={0} width={width} height={height}>
                  <Shader source={sweep} uniforms={sweepU} />
                </Rect>
              }
            >
              {picture}
            </Mask>
          ) : (
            <Group clip={clip as SharedValue<SkRect>}>{picture}</Group>
          )}
        </Canvas>
      </Pressable>
      {layout.labels.map((l) => (
        <FlowLabel
          key={l.id}
          clock={clock}
          label={l}
          node={l.id === 'grey' ? null : nodeOf.get(l.id) ?? null}
          grey={l.id === 'grey' ? flow.grey : null}
          delay={arrival(l.at, width)}
          masked={masked}
          lit={on(l.id) || (l.id === 'grey' && on('grey'))}
          onSelect={() => onSelect(l.id === selected ? null : l.id)}
        />
      ))}
    </Animated.View>
  );
}

// ------------------------------------------------------------------ the words on it

function FlowLabel({
  clock,
  label,
  node,
  grey,
  delay,
  masked,
  lit,
  onSelect,
}: {
  clock: SharedValue<number>;
  label: LaidLabel;
  node: FlowNode | null;
  grey: MoneyFlow['grey'];
  delay: number;
  masked: boolean;
  lit: boolean;
  onSelect: () => void;
}) {
  const reduced = useReducedSV();
  const fade = lit ? 1 : DIMMED + 0.1;
  const style = useAnimatedStyle(() => {
    const p = ease(phase(clock.value, delay, LABEL_MS));
    return { opacity: p * fade, transform: [{ translateY: reduced.value ? 0 : (1 - p) * 6 }] };
  }, [delay, fade]);
  const right = label.align === 'right';
  // A ribbon under the words: the ground is cut back under them (`LaidLabel.knockout`) and the
  // figure is its node's ink on that ground. On the token stream's grain the figure takes the
  // ground's white; on the ground, its node's ink.
  const ink = node ? (label.knockout ? node.hue.ink : label.onStream ? GROUND.text : node.hue.ink) : GROUND.dim;
  const cut = label.knockout ? [styles.cut, right ? styles.cutRight : styles.cutLeft] : null;
  const name = node ? node.label : grey?.label ?? '';
  const said = node ? `${node.label}, ${masked && node.dollars ? 'hidden' : node.figure.final}` : `${grey?.figure ?? ''} of the tokens ${grey?.label ?? ''}`;
  return (
    <Animated.View
      pointerEvents="none"
      accessible
      accessibilityRole="button"
      accessibilityLabel={said}
      onAccessibilityTap={onSelect}
      style={[styles.label, { left: label.x, top: label.y, width: label.w, alignItems: right ? 'flex-end' : 'flex-start' }, style]}
    >
      <Text allowFontScaling={false} numberOfLines={3} style={[type.label, styles.name, right ? styles.right : null, node ? null : styles.greyName, cut]}>
        {name}
      </Text>
      <View style={cut}>
        {node ? (
          masked && node.dollars ? (
            <Text allowFontScaling={false} style={figure(16, ink)}>
              {MASKED_DOLLARS}
            </Text>
          ) : (
            <FlowNum spec={node.figure} clock={clock} textStyle={figure(16, ink)} delay={delay + 40} />
          )
        ) : (
          <Text allowFontScaling={false} style={figure(15, GROUND.dim)}>
            {grey?.figure}
          </Text>
        )}
      </View>
    </Animated.View>
  );
}

// ------------------------------------------------------------------ a count on the flow's clock

// `text` rides the native prop path, as in `insights/Num.tsx`.
Animated.addWhitelistedNativeProps({ text: true });
const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

/**
 * `insights/Num`'s count, on the flow's own clock instead of its block's (`useFlowClock`): the
 * same technique (every frame written into a TextInput's `text` on the UI thread, no React render
 * a frame, a hidden copy of the resting string holding the width) and the same formatting rule
 * (`format.formatWith`, `countLanded`, `restingText`), so a figure here counts exactly as one on the
 * analysis page does. A figure that is words ("under $1") is set still.
 */
function FlowNum({ spec, clock, textStyle, delay }: { spec: NumSpec; clock: SharedValue<number>; textStyle: StyleProp<TextStyle>; delay: number }) {
  const { value, final, fmt } = spec;
  const words = /^[a-z]/i.test(final);
  const animatedProps = useAnimatedProps(() => {
    const text = countLanded(clock.value, delay, COUNT_MS) ? final : formatWith(fmt, value * ease(phase(clock.value, delay, COUNT_MS)));
    return { text } as unknown as Partial<React.ComponentProps<typeof TextInput>>;
  });
  const [landed, setLanded] = useState(false);
  useLayoutEffect(() => {
    if (countLanded(clock.value, delay, COUNT_MS)) setLanded(true);
  }, [clock, delay]);
  useAnimatedReaction(
    () => countLanded(clock.value, delay, COUNT_MS),
    (now, before) => {
      if (now !== before) runOnJS(setLanded)(now);
    },
    [delay],
  );
  const flat = StyleSheet.flatten(textStyle) ?? {};
  if (words) {
    return (
      <Text allowFontScaling={false} style={flat}>
        {final}
      </Text>
    );
  }
  return (
    <View accessible accessibilityRole="text" accessibilityLabel={final}>
      <Text allowFontScaling={false} importantForAccessibility="no" accessibilityElementsHidden style={[flat, styles.sizer, { fontVariant: ['tabular-nums'] }]}>
        {final}
      </Text>
      <AnimatedTextInput
        editable={false}
        pointerEvents="none"
        allowFontScaling={false}
        scrollEnabled={false}
        importantForAccessibility="no"
        accessibilityElementsHidden
        underlineColorAndroid="transparent"
        defaultValue={restingText(spec, landed)}
        animatedProps={animatedProps}
        style={[StyleSheet.absoluteFill, flat, styles.input, { fontVariant: ['tabular-nums'] }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  label: { position: 'absolute' },
  name: { color: GROUND.text, letterSpacing: 0 },
  right: { textAlign: 'right' },
  greyName: { color: GROUND.dim },
  // The ground cut back under words a ribbon runs under, reaching LABEL_KNOCKOUT_PAD past them and
  // pulled back by the same, so the words stay exactly where they were laid out.
  cut: {
    backgroundColor: GROUND.bg,
    borderRadius: 2,
    borderCurve: 'continuous',
    paddingHorizontal: LABEL_KNOCKOUT_PAD[0],
    paddingVertical: LABEL_KNOCKOUT_PAD[1],
    marginVertical: -LABEL_KNOCKOUT_PAD[1],
  },
  cutLeft: { marginLeft: -LABEL_KNOCKOUT_PAD[0] },
  cutRight: { marginRight: -LABEL_KNOCKOUT_PAD[0] },
  sizer: { opacity: 0 },
  input: { padding: 0, margin: 0, paddingTop: 0, paddingBottom: 0, backgroundColor: 'transparent' },
});
