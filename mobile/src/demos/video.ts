/**
 * The one door to expo-video (`videoGuard.ts` says why it is a door): the package, or null on a
 * build that does not have it. Every video on the phone asks here, and nothing else in the app
 * names the package.
 */
import { onceGuarded } from './videoGuard';

export type ExpoVideo = typeof import('expo-video');

export const expoVideo: () => ExpoVideo | null = onceGuarded<ExpoVideo>(
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  () => (require('expo-modules-core') as typeof import('expo-modules-core')).requireOptionalNativeModule('ExpoVideo'),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  () => require('expo-video') as ExpoVideo,
);
