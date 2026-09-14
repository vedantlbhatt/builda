/**
 * expo-video is a native module, and THE JAVASCRIPT SHIPS AHEAD OF THE BINARY: the owner's phone
 * and two simulators run builds from before it was added, against the same Metro. `expo-video`'s
 * own entry calls `requireNativeModule('ExpoVideo')` when it is first evaluated, which throws on
 * a build without it, and a throw there would take the whole project page down with it.
 *
 * So nothing imports expo-video at the top of a file. `guardedLoad` asks first whether the native
 * module is there (`requireOptionalNativeModule`, which answers null rather than throwing), and
 * only then evaluates the package; any throw on the way is "no video", and the page shows the
 * poster, the still frame every published video carries. Pure, with both steps passed in, so
 * `bun test` holds the rule without either module.
 */

/** Evaluates `load` only when `probe` finds the native module; null when it does not, or when either throws. */
export function guardedLoad<T>(probe: () => unknown, load: () => T): T | null {
  try {
    if (!probe()) return null;
    return load() ?? null;
  } catch {
    return null;
  }
}

/** The same, remembered: the answer cannot change while the app runs (a binary does not grow a module). */
export function onceGuarded<T>(probe: () => unknown, load: () => T): () => T | null {
  let done = false;
  let value: T | null = null;
  return () => {
    if (!done) {
      value = guardedLoad(probe, load);
      done = true;
    }
    return value;
  };
}
