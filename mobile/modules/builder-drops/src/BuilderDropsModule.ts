import { NativeModule, requireOptionalNativeModule } from 'expo';

import type { CredentialStatus, DirectShareResult, PendingDrop } from './BuilderDrops.types';

declare class BuilderDropsModule extends NativeModule {
  /**
   * Everything the share extension has queued since the last call, and CLEARS the queue.
   *
   * Take and clear in one call, under the suite's own lock, because the alternative is a read
   * followed by a clear with an app launch in between: share a reel while the app is coming to
   * the foreground and the queue is emptied after it was read, which loses the drop with no
   * error anywhere. The caller owns what it is handed.
   */
  takePending(): PendingDrop[];
  /** How many are waiting, without taking them. For Settings and the tests. */
  pendingCount(): number;
  /**
   * Copy the app's ACCESS token (never the refresh token) into the App Group's keychain, for the
   * share extension's one route and the island's Start button (docs/drop-island.md).
   * `expiresEpoch` is the JWT's `exp`, Unix seconds. Returns the keychain status, 0 on success.
   */
  mirrorCredential?(token: string, expiresEpoch: number, baseURL: string): number;
  /** Signed out: nothing outside the app may act any more. */
  clearCredential?(): void;
  /** DEBUG: what the extension would find, without the token itself. */
  credentialStatus?(): CredentialStatus;
  /** DEBUG: the share extension's own send, run from the app. No queue fallback. */
  debugShareDirect?(url: string, text: string): Promise<DirectShareResult>;
}

/**
 * Null where the native module is not in the binary: Android, web, Expo Go, and any iOS build
 * made before `expo prebuild` added it. Every caller checks, so the board still works by hand
 * (paste a link) on a surface that has no share extension.
 */
export default requireOptionalNativeModule<BuilderDropsModule>('BuilderDrops');
