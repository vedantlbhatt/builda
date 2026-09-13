import React from 'react';

import { RouteSkeleton } from '../../../src/nav/Skeleton';

/**
 * Time lapse (brief D8) for one session: the work replayed fast. `id` is the session id.
 * Last to be built and only if it looks right. Skeleton.
 */
export default function TimelapseScreen() {
  return <RouteSkeleton title="Time lapse" note="This session, replayed in a few seconds." />;
}
