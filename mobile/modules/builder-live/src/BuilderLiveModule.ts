import { NativeModule, requireOptionalNativeModule } from 'expo';

import type {
  ActivityInfo,
  BuilderLiveEvents,
  ContentOptions,
  DemoActivityInfo,
  DemoAttrs,
  DemoState,
  DemoTokenStatus,
  DropActivityInfo,
  DropAttrs,
  DropState,
  DropTokenStatus,
  SessionAttrs,
  SessionState,
} from './BuilderLive.types';

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

  // A reel you shared (docs/drop-island.md). Optional: a build from before these existed has
  // none of them, and every caller optional-chains.
  /** Start a drop's card, or move the live one it already has. Resolves to the activity id. */
  startDrop?(attrs: DropAttrs, state: DropState, opts?: ContentOptions): Promise<string>;
  /** False when no live card shows the drop. */
  updateDrop?(dropId: string, state: DropState, opts?: ContentOptions): Promise<boolean>;
  endDrop?(dropId: string, finalState?: DropState | null, opts?: ContentOptions): Promise<boolean>;
  listDrops?(): DropActivityInfo[];
  /** Whether the server may push to this phone's drop cards; off forgets every token there. */
  setDropPush?(enabled: boolean, environment: 'sandbox' | 'production'): Promise<void>;
  /** Retry any token the server has not taken; answers what it holds. */
  flushDropTokens?(): Promise<DropTokenStatus>;

  // A demo you asked your Mac for (docs/demo-island.md). Optional for the drop functions' reason.
  /** Start a request's card (ending any older card of the same project), or move its live one. */
  startDemo?(attrs: DemoAttrs, state: DemoState, opts?: ContentOptions): Promise<string>;
  /** False when no live card shows the request. */
  updateDemo?(requestId: string, state: DemoState, opts?: ContentOptions): Promise<boolean>;
  endDemo?(requestId: string, finalState?: DemoState | null, opts?: ContentOptions): Promise<boolean>;
  listDemos?(): DemoActivityInfo[];
  /** Whether the server may push to this phone's demo cards; off forgets every token there. */
  setDemoPush?(enabled: boolean, environment: 'sandbox' | 'production'): Promise<void>;
  /** Retry any token the server has not taken; answers what it holds. */
  flushDemoTokens?(): Promise<DemoTokenStatus>;
}

/**
 * Null where the native module is not in the binary: Android, web, Expo Go, and any iOS build
 * made before `expo prebuild` added it. Every caller checks, so the app never crashes on a
 * surface the platform does not have.
 */
export default requireOptionalNativeModule<BuilderLiveModule>('BuilderLive');
