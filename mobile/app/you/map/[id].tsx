import React from 'react';

import { RouteSkeleton } from '../../../src/nav/Skeleton';

/**
 * The codebase map (brief D7) for one session: which files the work touched and how they hang
 * together. `id` is the session id, the same one `session/[id]` takes. Skeleton.
 */
export default function MapScreen() {
  return <RouteSkeleton title="Codebase map" note="The files this session touched, and how they connect." />;
}
