import { useRouter } from 'expo-router';
import React from 'react';

import { Row, Section, Surface } from '../ui';
import type { SessionLink } from './links';

/**
 * The codebase map and the time lapse of this session, as two pushed pages (`/you/map/[id]`,
 * `/you/timelapse/[id]`). Kit rows with a chevron, the same rows the You tab lists its pages
 * with; a row exists only when its data is on the session (`links.ts`).
 */
export function SessionLinks({ links }: { links: readonly SessionLink[] }) {
  const router = useRouter();
  if (!links.length) return null;
  return (
    <Section label="map and time lapse">
      <Surface padding={0}>
        {links.map((l, i) => (
          <Row
            key={l.key}
            title={l.title}
            meta={l.meta}
            chevron
            hairline={i < links.length - 1}
            onPress={() => router.push(l.href)}
          />
        ))}
      </Surface>
    </Section>
  );
}
