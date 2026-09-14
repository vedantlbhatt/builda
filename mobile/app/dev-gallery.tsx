import { Redirect, useLocalSearchParams } from 'expo-router';
import React from 'react';

import { GALLERY_SECTIONS, KitGallery, type GallerySection } from '../src/ui/KitGallery';

/**
 * `builder://dev-gallery[?section=type][&scheme=light][&seed=7]`: the UI kit (`src/ui/`) on
 * one screen, for the screenshot harness and for eyeballing the kit on a device. `section`
 * renders one block (`GALLERY_SECTIONS`), `scheme` picks light or dark, `seed` fixes the
 * sample data. Anything unrecognised falls back to the kit's own default.
 *
 * Dev only: the root layout registers the route only when `__DEV__` is true, and a release
 * build that somehow rendered it redirects instead.
 */
export default function DevGalleryRoute() {
  if (!__DEV__) return <Redirect href="/now" />;
  return <DevGallery />;
}

function DevGallery() {
  const p = useLocalSearchParams<{ section?: string; scheme?: string; seed?: string }>();
  const section = (GALLERY_SECTIONS as readonly string[]).includes(p.section ?? '')
    ? (p.section as GallerySection)
    : undefined;
  const scheme = p.scheme === 'light' || p.scheme === 'dark' ? p.scheme : undefined;
  const seed = /^\d+$/.test(p.seed ?? '') ? Number(p.seed) : undefined;
  return <KitGallery section={section} scheme={scheme} seed={seed} />;
}
