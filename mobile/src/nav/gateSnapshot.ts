/**
 * The onboarding gate's last published value, readable with no React and no expo, so
 * `app/+native-intent.ts` (which bun imports in its tests) can ask whether the app half of the
 * route tree exists before handing a link to the router. `onboarding.ts` is the only writer.
 * null until the flag has been read at launch.
 */
let value: boolean | null = null;

export function gateSnapshot(): boolean | null {
  return value;
}

export function setGateSnapshot(v: boolean | null): void {
  value = v;
}
