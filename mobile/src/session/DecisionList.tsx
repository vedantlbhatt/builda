import React from 'react';

import { Row, Section, Surface } from '../ui';
import type { DecisionRow } from './decisions';

/**
 * The decision feed on one session (roadmap 2.5): the hard to undo things the agent did, a
 * short list in the engine's order, one row each. The row says what happened and when;
 * which package, file or command never left the machine. Nothing renders without a row:
 * an absent live state is not "no decisions".
 */
export function DecisionList({ rows }: { rows: readonly DecisionRow[] }) {
  if (!rows.length) return null;
  return (
    <Section label="decisions">
      <Surface padding={0}>
        {rows.map((r, i) => (
          <Row key={r.key} title={r.title} titleLines={2} meta={r.meta ?? undefined} hairline={i < rows.length - 1} />
        ))}
      </Surface>
    </Section>
  );
}
