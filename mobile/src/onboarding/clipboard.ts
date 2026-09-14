/**
 * Put text on the pasteboard, for the hook setup on the connect step.
 *
 * React Native's own clipboard module, which every iOS build already carries (`RCTClipboard`
 * in React-CoreModules). It is reached by its file rather than through `react-native`'s index,
 * whose getter prints a deprecation warning into the dev toast on every use. No new native
 * dependency: adding `expo-clipboard` would need a rebuild for one call.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Clipboard = require('react-native/Libraries/Components/Clipboard/Clipboard').default as {
  setString(content: string): void;
};

export function copyText(text: string): boolean {
  try {
    Clipboard.setString(text);
    return true;
  } catch {
    return false;
  }
}
