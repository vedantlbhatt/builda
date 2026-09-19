/**
 * 09, what stands out: the server's ranked facts, the loudest one set large on the band, and the
 * how you work page, a paragraph at a time as each arrives.
 *
 * 10, words and stack: the glossary as a collection that fills in (one cell a term, found or
 * still to find), the stack in a few lines, and the ways into the full pages.
 *
 * What this cannot see: every refusal on the page and behind it, as a plain sentence. Last,
 * because it is the part that makes the rest checkable.
 */
import { useRouter, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Band, BandWords } from '../Band';
import { BandFigure, figure, GUTTER, Kicker, Refusal, type, Words } from '../kit';
import { isRefused, type Gap, type StandsOutModel, type WordsModel } from '../model';
import { Num } from '../Num';
import { GROUND, ON_HUE, SPECTRUM, type Hue, type HueName } from '../palette';
import { DOOR_HUE, type DoorKey } from '../../you/chapters';
import { PixelField, type PixelCell } from '../Pixels';
import { arrivalMs } from '../../motion/pixelMotion';
import { Block, Section, useFieldMotion } from '../reveal';

const STANDS = SPECTRUM.iris;
const WORDS = SPECTRUM.orchid;

// ------------------------------------------------------------------ 09

export function StandsOutSection({ standsOut }: { standsOut: StandsOutModel }) {
  const [first, ...rest] = standsOut.facts;
  const n = standsOut.narrative;
  return (
    <Section style={styles.section}>
      <Band hue={STANDS} index="09" title="What stands out">
        {first ? (
          <BandWords delay={260}>
            <Text maxFontSizeMultiplier={1.3} style={styles.loudest}>
              {first.text}
            </Text>
          </BandWords>
        ) : (
          <BandWords delay={300}>
            <Refusal onHue>Nothing stands out yet. A few more sessions and this fills in.</Refusal>
          </BandWords>
        )}
      </Band>

      {rest.length > 0 ? (
        <Block style={styles.block}>
          {rest.map((f, i) => (
            <View key={f.key} style={[styles.fact, i > 0 ? styles.hairTop : null]}>
              <Text allowFontScaling={false} style={[type.mono, styles.factIndex]}>
                {String(i + 2).padStart(2, '0')}
              </Text>
              <Words style={[type.lead, { flex: 1, fontWeight: i < 2 ? '600' : '400' }]}>{f.text}</Words>
            </View>
          ))}
          {standsOut.factsSource ? <Words style={[type.meta, styles.caption]}>{standsOut.factsSource}</Words> : null}
        </Block>
      ) : null}

      <Block style={styles.block}>
        <Kicker>how you work, in words</Kicker>
        {isRefused(n) ? <Refusal>{n.refusal}</Refusal> : null}
      </Block>
      {!isRefused(n) ? (
        <>
          {n.paragraphs.map((p) => (
            <Block key={p} style={[styles.block, styles.tight]}>
              <Words style={type.body}>{p}</Words>
            </Block>
          ))}
          {n.strengths.length ? <Claims title="what you are good at" claims={n.strengths} /> : null}
          {n.watchOuts.length ? <Claims title="what it may be costing you" claims={n.watchOuts} /> : null}
          {n.experiment ? (
            <Block style={styles.block}>
              <Kicker color={STANDS.ink}>one thing to try next session</Kicker>
              <Words style={type.lead}>{n.experiment}</Words>
            </Block>
          ) : null}
          <Block style={[styles.block, styles.tight]}>
            <Words style={type.meta}>{n.provenance}</Words>
          </Block>
        </>
      ) : null}
    </Section>
  );
}

function Claims({ title, claims }: { title: string; claims: { text: string; evidence: string }[] }) {
  return (
    <Block style={styles.block}>
      <Kicker>{title}</Kicker>
      {claims.map((c, i) => (
        <View key={c.text} style={[styles.claim, i > 0 ? styles.hairTop : null]}>
          <Words style={type.lead}>{c.text}</Words>
          {c.evidence ? <Words style={type.meta}>{c.evidence}</Words> : null}
        </View>
      ))}
    </Block>
  );
}

// ------------------------------------------------------------------ 10

export function WordsSection({ words, width, doors = DOOR_HUE }: { words: WordsModel; width: number; doors?: Record<DoorKey, HueName> }) {
  const inner = width - GUTTER * 2;
  const g = words.glossary;
  const s = words.stack;
  return (
    <Section style={styles.section}>
      <Band hue={WORDS} index="10" title="Words and stack">
        {isRefused(g) ? (
          <BandWords delay={300}>
            <Refusal onHue>{g.refusal}</Refusal>
          </BandWords>
        ) : (
          <>
            <BandFigure spec={g.found} width={inner * 0.5} max={112} delay={200} />
            <BandWords delay={360}>
              <Text maxFontSizeMultiplier={1.3} style={type.bandCaption}>
                {`of ${g.catalog} glossary terms your sessions ran into`}
              </Text>
            </BandWords>
            {g.locked ? (
              <BandWords delay={440}>
                <Text maxFontSizeMultiplier={1.3} style={type.bandNote}>
                  {g.locked}
                </Text>
              </BandWords>
            ) : null}
          </>
        )}
      </Band>

      {!isRefused(g) ? (
        <Block style={styles.block}>
          <Kicker>the collection, one square a term</Kicker>
          <Collection found={g.foundCount} catalog={g.catalog} width={inner} hue={WORDS} />
          <Words style={[type.meta, styles.caption]}>{g.summary}</Words>
          <GoLink title="Open the glossary" href="/you/glossary" color={WORDS.ink} />
        </Block>
      ) : null}

      <Block style={styles.block}>
        <Kicker>your stack</Kicker>
        {isRefused(s) ? (
          <Refusal>{s.refusal}</Refusal>
        ) : (
          <>
            <View style={styles.bigLine}>
              <Num spec={s.total} textStyle={figure(44, GROUND.text)} delay={40} />
              <Text maxFontSizeMultiplier={1.4} style={type.lead}>
                things the work is made of
              </Text>
            </View>
            {s.groups.map((grp, i) => (
              <View key={grp.label} style={[styles.group, i > 0 ? styles.hairTop : null]}>
                <Text allowFontScaling={false} style={[type.label, styles.groupLabel]}>
                  {`${grp.label}, ${grp.count}`}
                </Text>
                <Words style={[type.dim, { color: GROUND.text, flex: 1 }]}>{grp.names}</Words>
              </View>
            ))}
            <Words style={[type.meta, styles.caption]}>{s.summary}</Words>
            <GoLink title="See your stack" href="/you/stack" color={WORDS.ink} />
          </>
        )}
      </Block>

      <Block style={styles.block}>
        <Kicker>keep going</Kicker>
        {/* Each in its door's hue on the You tab (`doorHues`), so Wrapped is brass in both places. */}
        <GoLink title="Your Wrapped" line="The fifteen questions, one card each" href="/wrapped" color={SPECTRUM[doors.wrapped].ink} big />
        <GoLink title="Money" line="Every dollar at list prices, by model" href="/you/money" color={SPECTRUM[doors.money].ink} big />
        <GoLink title="Dimensions" line="The five, read one session at a time" href="/you/dimensions" color={SPECTRUM[doors.dimensions].ink} big />
      </Block>
    </Section>
  );
}

/** One cell a catalog term: found ones in the section's ink, the rest as outlines still to find. */
function Collection({ found, catalog, width, hue }: { found: number; catalog: number; width: number; hue: Hue }) {
  const cols = catalog <= 80 ? 15 : 20;
  const gap = 4;
  const size = Math.floor((width - gap * (cols - 1)) / cols);
  const rows = Math.ceil(catalog / cols);
  const motion = useFieldMotion('term collection');
  // As long as reading order took, 14 ms a term.
  const span = catalog * 14;
  const cells: PixelCell[] = useMemo(() => {
    const out: PixelCell[] = [];
    for (let i = 0; i < catalog; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const on = i < found;
      out.push({
        x: col * (size + gap),
        y: row * (size + gap),
        w: size,
        h: size,
        color: on ? hue.ink : GROUND.border,
        outline: !on,
        delay: arrivalMs(motion, col, row, cols, rows, 40, span),
      });
    }
    return out;
  }, [found, catalog, cols, rows, size, hue.ink, motion, span]);
  return (
    <PixelField
      cells={cells}
      width={cols * size + (cols - 1) * gap}
      height={rows * size + (rows - 1) * gap}
      duration={320}
      accessibilityLabel={`${found} of ${catalog} terms found`}
    />
  );
}

/** A way into a full page: the page's name set large, one line under it, an arrow in its colour. */
export function GoLink({ title, line, href, color, big = false }: { title: string; line?: string; href: Href; color: string; big?: boolean }) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push(href)}
      accessibilityRole="link"
      accessibilityLabel={line ? `${title}. ${line}` : title}
      style={({ pressed }) => [styles.link, big ? styles.linkBig : null, { opacity: pressed ? 0.55 : 1 }]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text maxFontSizeMultiplier={1.3} style={big ? styles.linkTitleBig : styles.linkTitle}>
          {title}
        </Text>
        {line ? <Words style={type.meta}>{line}</Words> : null}
      </View>
      <SymbolView name="arrow.right" tintColor={color} weight="semibold" size={big ? 22 : 17} />
    </Pressable>
  );
}

// ------------------------------------------------------------------ what this cannot see

export function CannotSeeSection({ gaps, footer }: { gaps: Gap[]; footer: string | null }) {
  const open = gaps.filter((g) => g.group === 'open');
  const mac = gaps.filter((g) => g.group === 'mac');
  return (
    // No rule of its own: the ways on above already end on their hairlines, and a second one after a
    // gap read as an empty row (FOUND IN THE FINAL CAPTURE, 2026-09-13). The heading opens it.
    <Section style={[styles.cannotSee, { paddingHorizontal: GUTTER }]}>
      <Block>
        <Text accessibilityRole="header" maxFontSizeMultiplier={1.4} style={type.heading}>
          What this cannot see
        </Text>
        <Words style={[type.dim, { marginTop: 6 }]}>
          Every number that is missing, and why. A refused number is left out, never shown as a zero.
        </Words>
      </Block>
      {open.length ? (
        <Block style={{ marginTop: 22 }}>
          <Kicker>not shown yet</Kicker>
        </Block>
      ) : null}
      {open.map((g, i) => (
        <GapRow key={g.key} gap={g} index={i + 1} />
      ))}
      {mac.length ? (
        <Block style={{ marginTop: 26 }}>
          <Kicker>not on the server, so this page shows your Mac's</Kicker>
          <Words style={type.meta}>
            The server cannot compute these from what is uploaded. Your Mac reads them from the transcripts, and every
            one of them above is the Mac's number.
          </Words>
        </Block>
      ) : null}
      {mac.map((g, i) => (
        <GapRow key={g.key} gap={g} index={open.length + i + 1} />
      ))}
      {footer ? (
        <Block style={{ marginTop: 32 }}>
          <Words style={[type.meta, { color: GROUND.faint }]}>{footer}</Words>
        </Block>
      ) : null}
    </Section>
  );
}

function GapRow({ gap, index }: { gap: Gap; index: number }) {
  return (
    <Block style={styles.gap}>
      <Text allowFontScaling={false} style={[type.mono, styles.factIndex, { color: GROUND.faint }]}>
        {String(index).padStart(2, '0')}
      </Text>
      <View style={{ flex: 1, gap: 3 }}>
        <Words style={[type.dim, { color: GROUND.text, fontWeight: '600' }]}>{gap.what}</Words>
        <Words style={type.dim}>{gap.why}</Words>
      </View>
    </Block>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 56 },
  cannotSee: { marginTop: 40 },
  block: { paddingHorizontal: GUTTER, marginTop: 28 },
  tight: { marginTop: 14 },
  caption: { marginTop: 12 },
  loudest: { fontSize: 30, lineHeight: 35, fontWeight: '800', letterSpacing: -0.6, color: ON_HUE, marginTop: 2 },
  fact: { flexDirection: 'row', gap: 14, paddingVertical: 13, alignItems: 'baseline' },
  factIndex: { width: 22 },
  hairTop: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: GROUND.border },
  claim: { paddingVertical: 10, gap: 3 },
  bigLine: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 10, marginBottom: 12 },
  group: { flexDirection: 'row', gap: 12, paddingVertical: 10, alignItems: 'baseline' },
  groupLabel: { width: 104 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: GROUND.border, marginTop: 14 },
  linkBig: { marginTop: 0, paddingVertical: 18 },
  linkTitle: { fontSize: 17, lineHeight: 22, fontWeight: '700', color: GROUND.text },
  linkTitleBig: { fontSize: 28, lineHeight: 33, fontWeight: '800', letterSpacing: -0.6, color: GROUND.text },
  gap: { flexDirection: 'row', gap: 14, paddingVertical: 10, alignItems: 'baseline' },
});
