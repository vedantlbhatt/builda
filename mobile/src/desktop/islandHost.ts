/**
 * Where the in-app island (`island/Island.tsx`) lives in this window. On a phone it is fused to
 * the hardware island and this is null, a constant: the phone's island is exactly what it was.
 * `islandHost.web.ts` answers for the desktop layout and the desktop shell's island window.
 */
export type IslandHost =
  /** Draw nothing: this window IS an island (the desktop shell's `/island` page). */
  | { kind: 'off' }
  /**
   * A desktop window: no camera to fuse to, and the desktop island (its own window at the top of
   * the screen) already carries what is running. Only the app's own passing news shows here, as a
   * toast from the top edge, centred over the page area right of the sidebar.
   */
  | { kind: 'pane'; centerX: number };

export function useIslandHost(): IslandHost | null {
  return null;
}
