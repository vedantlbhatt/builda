/**
 * The desktop layout's frame, as iOS and Android see it: nothing. The phone's tree is exactly
 * what it was; `DesktopFrame.web.tsx` is the real one, and Metro only picks it on web.
 */
import type { ReactNode } from 'react';

export function DesktopFrame({ children }: { children: ReactNode }) {
  return children;
}
