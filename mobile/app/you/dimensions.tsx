import React from 'react';

import { RouteSkeleton } from '../../src/nav/Skeleton';

/** The five dimensions and the archetype (brief B3). Skeleton. */
export default function DimensionsScreen() {
  return (
    <RouteSkeleton
      title="Dimensions"
      note="The five axes your sessions are measured on, and the archetype they add up to."
    />
  );
}
