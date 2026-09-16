/**
 * One known dev warning, kept out of LogBox, BEFORE anything can print it.
 *
 * `expo-av` prints its SDK 54 deprecation as soon as it is imported, and ES imports are evaluated
 * before any statement in the importing file. The same `ignoreLogs` call sitting in the body of
 * `app/_layout.tsx` therefore ran a beat too late: the modules above it had already reached
 * expo-av and LogBox had already taken the message. So this lives in its own module, with one
 * import of its own, and `_layout` imports it first.
 *
 * WHAT THIS DOES NOT FIX, measured rather than assumed. On this version (RN 0.79, bridgeless)
 * the toast that appears is not LogBox's own warning card but the "Open debugger to view
 * warnings." notification, and that one is raised before the ignore patterns are consulted:
 * `ignoreAllLogs(true)` removes it and `ignoreLogs([/\[expo-av\]/])` does not. Turning off every
 * warning in development to hide one known deprecation is a bad trade — the next real warning
 * would go with it — so the notification stays until the social voice note moves to `expo-audio`,
 * which is the actual fix and belongs with that feature rather than here.
 *
 * Only that one message, and only from LogBox: Metro still prints it.
 */
import { LogBox } from 'react-native';

if (__DEV__) LogBox.ignoreLogs([/\[expo-av\]/]);
