import React, { useCallback, useMemo } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { GUTTER } from '../../src/insights/kit';
import { SPECTRUM } from '../../src/insights/palette';
import { useAccent } from '../../src/theme/accent';
import { ChapterPage } from '../../src/you/ChapterPage';
import { doorHues, youTab, type Door, type DoorKey } from '../../src/you/chapters';
import { DoorBand, DoorWord } from '../../src/you/Doors';
import { YouEmpty, YouHero } from '../../src/you/Hero';
import { useBuilderName, useBuilderProfile, useMoneyMask, useProfile } from '../../src/you/hooks';
import { ChapterSkeleton, ErrorChapter, SignedOutChapter, StaleLine } from '../../src/you/parts';

/**
 * You: the doorway into everything the app knows about how you build, in the house style the
 * owner picked (design-refs/HOUSE-STYLE.md). A column of chapters, not a list of cards:
 *
 *   the hero     a band in YOUR hue (the accent is your creature's colour), your name, your type
 *                arriving a letter at a time, the three headline numbers counting up, and your
 *                creature printed large; press it to pick another
 *   three bands  your analysis, Wrapped, money: each its own hue, the one real number it opens on
 *                counting up, the whole band the tap target
 *   three words  dimensions, glossary, stack: the name large in its hue, its number, and a small
 *                drawing of what is inside
 *
 * Every state is designed: a flat band while the first answer is on its way, a sentence and one
 * word to sign in, the error with Try again, one quiet line when a refresh failed and the page is
 * what was saved, and your creature with one sentence when there are no sessions yet.
 */
export default function YouScreen() {
  const { width } = useWindowDimensions();
  const builder = useBuilderProfile();
  const profile = useProfile();
  const mask = useMoneyMask();
  const accent = useAccent();
  const name = useBuilderName();

  const data = builder.load.kind === 'ready' ? builder.load.data : null;
  const profileData = profile.load.kind === 'ready' ? profile.load.data : null;
  const model = useMemo(() => (data ? youTab(data, profileData) : null), [data, profileData]);
  const hues = useMemo(() => doorHues(accent.name), [accent.name]);

  const { refresh } = builder;
  const { reload } = profile;
  const onRefresh = useCallback(() => {
    void Promise.all([refresh(), reload()]);
  }, [refresh, reload]);

  const load = builder.load;
  // The hero is painted in the accent, so it waits for the one read that says which hue that is.
  const ready = model !== null && accent.ready;
  const doors = new Map<DoorKey, Door>((model?.doors ?? []).map((d) => [d.key, d]));
  const band = (k: DoorKey) => {
    const d = doors.get(k);
    return d ? <DoorBand key={k} door={d} hue={SPECTRUM[hues[k]]} width={width} masked={mask.masked} /> : null;
  };
  const word = (k: DoorKey) => {
    const d = doors.get(k);
    if (!d) return null;
    return (
      <DoorWord
        key={k}
        door={d}
        hue={SPECTRUM[hues[k]]}
        width={width}
        dimensions={k === 'dimensions' ? model?.dimensions : undefined}
        collection={k === 'glossary' ? model?.collection : undefined}
        categories={k === 'stack' ? model?.categories : undefined}
      />
    );
  };

  return (
    <ChapterPage chapters={2} ready={ready} refreshing={builder.refreshing} onRefresh={load.kind === 'signedOut' ? null : onRefresh}>
      {(stage) => (
        <>
          {load.kind === 'signedOut' || load.kind === 'error' || (load.kind === 'ready' && load.stale) ? (
            <View style={styles.lead}>
              {load.kind === 'signedOut' ? <SignedOutChapter what="profile" /> : null}
              {load.kind === 'error' ? <ErrorChapter message={load.message} onRetry={onRefresh} /> : null}
              {load.kind === 'ready' && load.stale ? <StaleLine stale={load.stale} /> : null}
            </View>
          ) : null}

          {load.kind === 'loading' || (model !== null && !accent.ready) ? <ChapterSkeleton /> : null}

          {ready && model && model.empty ? <YouEmpty animal={accent.animal} hue={accent} width={width} /> : null}

          {ready && model && !model.empty ? (
            <>
              <YouHero hero={model.hero} name={name} animal={accent.animal} hue={accent} width={width} source={model.source} />
              {stage >= 1 ? (
                <>
                  {band('analysis')}
                  {band('wrapped')}
                  {band('money')}
                </>
              ) : null}
              {stage >= 2 ? (
                <>
                  {word('dimensions')}
                  {word('glossary')}
                  {word('stack')}
                </>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </ChapterPage>
  );
}

const styles = StyleSheet.create({
  lead: { paddingHorizontal: GUTTER, paddingTop: 4, paddingBottom: 20, gap: 12 },
});
