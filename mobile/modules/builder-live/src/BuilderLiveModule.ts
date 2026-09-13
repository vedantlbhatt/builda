import { NativeModule, requireOptionalNativeModule } from 'expo';

import type { ActivityInfo, BuilderLiveEvents, ContentOptions, SessionAttrs, SessionState } from './BuilderLive.types';

declare class BuilderLiveModule extends NativeModule<BuilderLiveEvents> {
  areActivitiesEnabled(): boolean;
  getPushToStartToken(): string | null;
  list(): ActivityInfo[];
  start(attrs: SessionAttrs, state: SessionState, opts?: ContentOptions): Promise<string>;
  update(id: string, state: SessionState, opts?: ContentOptions): Promise<void>;
  end(id: string, finalState?: SessionState | null, opts?: ContentOptions): Promise<void>;
  endAll(): Promise<void>;
  reloadWidgets(kind?: string | null): void;
  /** DEBUG: every Lock Screen, island and widget state as PNGs in Documents/live-previews. */
  renderPreviews(): Promise<string[]>;
}

/**
 * Null where the native module is not in the binary: Android, web, Expo Go, and any iOS build
 * made before `expo prebuild` added it. Every caller checks, so the app never crashes on a
 * surface the platform does not have.
 */
export default requireOptionalNativeModule<BuilderLiveModule>('BuilderLive');
