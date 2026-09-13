import React from 'react';

import { RouteSkeleton } from '../../src/nav/Skeleton';

/**
 * The money view (brief B2): dollars beside tokens beside lines, added in green and removed in
 * red. Every dollar is labelled API list prices (CLAUDE.md, `analysis/pricing.py`). Skeleton.
 */
export default function MoneyScreen() {
  return (
    <RouteSkeleton
      title="Money"
      note="What the work would cost at API list prices, beside the tokens and the lines it bought."
    />
  );
}
