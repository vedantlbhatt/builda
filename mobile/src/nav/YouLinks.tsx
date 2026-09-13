import { useRouter } from 'expo-router';
import React from 'react';

import { Row, Surface } from '../ui';

/**
 * The You pages, as one list at the foot of the You tab. Order is the order a person asks:
 * the recap of the year, then how they build, what it cost, what they build with, and the
 * words they have picked up. Map and time lapse are per session and open from a session,
 * not from here.
 *
 * Kit rows in one surface: the same row every other list on the tab uses.
 */
export function YouLinks() {
  const router = useRouter();
  const links = [
    { title: 'Wrapped', detail: 'fifteen questions about how you build', href: '/wrapped' },
    { title: 'Dimensions', detail: 'the five axes and your archetype', href: '/you/dimensions' },
    { title: 'Money', detail: 'dollars beside tokens beside lines', href: '/you/money' },
    { title: 'Your stack', detail: 'languages, tools and models', href: '/you/stack' },
    { title: 'Glossary', detail: 'terms you have run into', href: '/you/glossary' },
  ] as const;
  return (
    <Surface padding={0}>
      {links.map((l, i) => (
        <Row
          key={l.title}
          title={l.title}
          meta={l.detail}
          chevron
          hairline={i < links.length - 1}
          onPress={() => router.push(l.href)}
        />
      ))}
    </Surface>
  );
}
