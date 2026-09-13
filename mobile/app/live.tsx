import React from 'react';

import { RouteSkeleton } from '../src/nav/Skeleton';

/**
 * Mission control, full screen, pushed from Now. Skeleton; the design is DESIGN-DIRECTION 7.1:
 * two tiles per row, one tile per running session, sorted by who needs you most, the
 * creature bottom right and only the top "needs you" tile's creature moving.
 */
export default function LiveScreen() {
  return (
    <RouteSkeleton
      title="Mission control"
      note="Every running session as a tile, the one that needs you first."
    />
  );
}
