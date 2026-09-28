import { Redirect } from 'expo-router';
import React, { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

import type { GalleryEntry } from '../src/demos/model';
import { ProjectRow, type ProjectRowModel } from '../src/projects/ProjectRow';
import { ChapterPage } from '../src/you/ChapterPage';

/**
 * `builder://dev-projects`: the Projects list's rows with local pictures, one of each stage (a
 * trailer, a demo's stills, no demo yet), for the screenshot harness and for eyeballing the rows
 * without a server. The pictures are read from `public/dev-fixtures/` (never committed; copy a
 * rendered trailer there as `ridegt-trailer.webm` (VP9: Playwright's Chromium has no H.264) and a demo's stills as `still-0N.png`). A missing
 * file shows the stage's plain ground, which is what a row does before its pictures arrive.
 *
 * Dev only: the root layout registers dev routes only in `__DEV__`, and a release build that
 * somehow rendered it redirects instead.
 */
export default function DevProjectsRoute() {
  if (!__DEV__) return <Redirect href="/now" />;
  return <DevProjects />;
}

const KEYS = ['5e7a'.repeat(16), '8a1c'.repeat(16), 'f03b'.repeat(16)];

function still(i: number): GalleryEntry {
  return {
    id: `dev-still-${i}`,
    kind: 'image',
    label: 'a screen of the demo',
    source: null,
    mark: null,
    count: `${i} of 4`,
    aspect: 590 / 1282,
    url: `/dev-fixtures/still-0${i}.png`,
    posterUrl: null,
    duration: null,
    a11y: 'a screen of the demo',
  };
}

function DevProjects() {
  const { width } = useWindowDimensions();
  const rows: ProjectRowModel[] = useMemo(
    () => [
      {
        key: KEYS[0]!,
        name: 'RideGT',
        hue: 'tide',
        hours: '38.2',
        meta: 'Active · 2 hours ago',
        weeks: [0, 1, 1, 2, 3, 2, 4, 6, 5, 3, 6, 4],
        visual: { kind: 'video', from: 'trailer', id: 'dev-trailer', url: '/dev-fixtures/ridegt-trailer.webm', posterId: null, width: 1920, height: 1080 },
        a11y: 'RideGT. Active. 38.2 hours with you there.',
      },
      {
        key: KEYS[1]!,
        name: 'Builda',
        hue: 'ember',
        hours: '61.5',
        meta: 'Active · today',
        weeks: [2, 3, 5, 6, 4, 6, 5, 6, 6, 4, 5, 6],
        visual: { kind: 'prints', prints: [1, 2, 3, 4].map(still) },
        a11y: 'Builda. Active. 61.5 hours with you there.',
      },
      {
        key: KEYS[2]!,
        name: 'Private project 3',
        hue: 'iris',
        hours: '4.1',
        meta: 'Starting · yesterday',
        weeks: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 3, 6],
        visual: { kind: 'none' },
        a11y: 'Private project 3. Starting. 4.1 hours with you there.',
      },
    ],
    [],
  );
  const sources = { 'dev-trailer': { uri: '/dev-fixtures/ridegt-trailer.webm' } };
  const printSources = { file: Object.fromEntries([1, 2, 3, 4].map((i) => [`dev-still-${i}`, { uri: `/dev-fixtures/still-0${i}.png` }])), poster: {} };
  return (
    <ChapterPage chapters={rows.length} ready refreshing={false} onRefresh={null}>
      {(stage) => (
        <>
          {rows.map((r, i) =>
            stage >= i ? <ProjectRow key={r.key} row={r} width={Math.min(width, 760)} first={i === 0} playing sources={sources} printSources={printSources} /> : null,
          )}
        </>
      )}
    </ChapterPage>
  );
}
