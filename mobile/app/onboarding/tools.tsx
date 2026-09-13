import { useRouter, type Href } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import * as cache from '../../src/data/cache';
import { HarnessPicker } from '../../src/pixel/HarnessPicker';
import { HARNESS_MARKS, type Harness } from '../../src/pixel/harness';
import { CONTINUE, TOOLS, toolsFound } from '../../src/onboarding/copy';
import { useFacts } from '../../src/onboarding/facts';
import { pathFor } from '../../src/onboarding/flow';
import { Headline } from '../../src/onboarding/Headline';
import { foundFor, initialTools, loadTools, marksInOrder, preselect, saveTools } from '../../src/onboarding/selection';
import { StepFrame } from '../../src/onboarding/StepFrame';
import { space } from '../../src/theme';
import { Button, T } from '../../src/ui';

/**
 * Step 3: your tools (DESIGN-DIRECTION 5's `HarnessPicker`, multi select). Signed in, the
 * account's sessions are counted per tool (`GET /v1/sessions`, the list the Sessions tab
 * already reads): the tools they came from come first and start picked, and the sentence over
 * them names them with the count ("Builder found 77 sessions from Claude Code on your account
 * and picked it"). Every tile stays tappable. Signed out, or with nothing counted yet, the
 * sentence asks and nothing is picked.
 *
 * It arrives with the push and nothing else. Every tap is saved (`profile.tools.v1`), so
 * walking back and forth keeps the selection.
 */
export default function ToolsStep() {
  const router = useRouter();
  const facts = useFacts();
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

  const onChange = useCallback((next: Harness[]) => {
    touched.current = true;
    setSelected(next);
    void saveTools(cache, next);
  }, []);

  const next = useCallback(async () => {
    if (selected) await saveTools(cache, selected);
    router.push(pathFor('connect') as Href);
  }, [router, selected]);

  const foundNames = useMemo(() => marks.filter((m) => m.harnesses.some((h) => (found?.[h] ?? 0) > 0)).map((m) => m.name), [marks, found]);
  const line = facts.total !== null && facts.total > 0 && found ? toolsFound(facts.total, facts.partial, foundNames) : TOOLS.unknown;

  return (
    <StepFrame step="tools" actions={<Button label={CONTINUE} onPress={() => void next()} disabled={selected === null} />}>
      <T role="label" tone="dim">
        {TOOLS.label}
      </T>
      <Headline>{TOOLS.headline}</Headline>
      <T role="body" tone="dim" accessibilityLiveRegion="polite">
        {line}
      </T>
      {/* No `found` on the tiles: their status line has room for about ten characters, and
          "found 78 ses..." was the one fact on the step, cut short. The sentence above says it
          whole; the tiles it names come first and start picked. */}
      <HarnessPicker selected={selected ?? []} onChange={onChange} marks={marks} style={{ marginTop: space.md }} />
    </StepFrame>
  );
}
