import React from 'react';

import { RouteSkeleton } from '../../src/nav/Skeleton';

/** The glossary that fills over months (brief B5): terms unlock the first time you meet them. Skeleton. */
export default function GlossaryScreen() {
  return (
    <RouteSkeleton title="Glossary" note="Terms show up here the first time one of your sessions runs into them." />
  );
}
