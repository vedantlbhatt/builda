import React from 'react';

import { RouteSkeleton } from '../../src/nav/Skeleton';

/** The stack page (brief B5): the languages, tools and models your sessions actually used. Skeleton. */
export default function StackScreen() {
  return <RouteSkeleton title="Your stack" note="Languages, tools and models, measured from your sessions." />;
}
