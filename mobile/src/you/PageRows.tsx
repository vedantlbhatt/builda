import { useRouter } from 'expo-router';
import React from 'react';

import { Row, Surface } from '../ui';
import type { PageRow } from './pages';

/**
 * The rows into the four You pages. Kit rows in one surface, hairlines between, each with the
 * one line that states a real number from that page (or says plainly why there is none yet),
 * so the list is worth reading before anything is opened.
 */
export function PageRows({ rows }: { rows: readonly PageRow[] }) {
  const router = useRouter();
  return (
    <Surface padding={0}>
      {rows.map((r, i) => (
        <Row
          key={r.key}
          title={r.title}
          meta={r.line}
          metaLines={2}
          chevron
          hairline={i < rows.length - 1}
          onPress={() => router.push(r.href)}
        />
      ))}
    </Surface>
  );
}
