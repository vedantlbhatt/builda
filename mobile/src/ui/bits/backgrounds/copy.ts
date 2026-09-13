/**
 * The only words the backgrounds carry: the kit gallery's captions. Pure, so the test holds them
 * to the one dash rule (`src/copy/plain.ts`) like every other string on the phone.
 *
 * Ported from react-bits `Backgrounds/*` by David Haz.
 * react-bits is MIT + Commons Clause (Copyright (c) 2026 David Haz): the notice is kept here
 * as the licence asks, and the ports are used as part of this application only; they are not
 * to be redistributed as components.
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy of this
 *   software and associated documentation files (the "Software"), to deal in the Software
 *   without restriction, including without limitation the rights to use, copy, modify,
 *   merge, publish, and distribute the Software as part of an application, website, or
 *   product, subject to the following conditions: The above copyright notice and this
 *   permission notice shall be included in all copies or substantial portions of the
 *   Software. Commons Clause Restriction: You may use this Software, including for any
 *   commercial purpose, so long as you do not sell, sublicense, or redistribute the
 *   components themselves, whether alone, in a bundle, or as a ported version.
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
 *
 * What changed in the port: nothing is ported here; these name the ports.
 */
import type { BackgroundName } from './shaders';

/** Where each field comes from and where Builda wears it. */
export const GALLERY_NOTES: Readonly<Record<BackgroundName, { source: string; use: string }>> = {
  FieldDither: { source: 'react-bits Dither', use: 'the You hero, the creature step, the ProfileCard ground' },
  PixelBlast: { source: 'react-bits PixelBlast', use: 'onboarding hello and the Now empty state; tap it' },
  Silk: { source: 'react-bits Silk', use: 'a quiet band behind a card' },
  Grainient: { source: 'react-bits Grainient', use: 'a Wrapped header printed in one hue' },
  Radar: { source: 'react-bits Radar', use: 'pairing, and anything waiting' },
  Topography: { source: 'react-bits Topography', use: 'the time lapse; press to raise a hill' },
  DotGrid: { source: 'react-bits DotGrid', use: 'the codebase map; tap or drag across it' },
};

export const GALLERY_ORDER: readonly BackgroundName[] = ['FieldDither', 'PixelBlast', 'Silk', 'Grainient', 'Radar', 'Topography', 'DotGrid'];

/** A block's two lines: its name and source (a lower case caption), and where it is worn. */
export function galleryCaption(name: BackgroundName, running: boolean = true): { title: string; line: string } {
  const note = GALLERY_NOTES[name];
  return {
    title: `${name.toLocaleLowerCase()} · ${note.source}`,
    line: running ? note.use : `${note.use}. Tap to run.`,
  };
}
