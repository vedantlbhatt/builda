/**
 * The frames of a sequential decrypt, computed ahead of time from a random source so a
 * seeded run is exactly repeatable (tests, screenshots) and a live run is not.
 *
 * Ported from react-bits `TextAnimations/DecryptedText/DecryptedText.tsx` by David Haz
 * (MIT + Commons Clause; the notice is in `digits.ts`). What the port keeps: sequential
 * reveal from the start, spaces never scrambled. What it changes: the charset is Builder's
 * `01{}[]<>/=+*`, the tick is 40ms, a tick reveals the next VISIBLE character (a space never
 * costs a tick), and a long quote reveals several characters per tick so the whole thing
 * finishes inside `DECRYPT_MAX_TICKS` ticks (1.6s) instead of running for seconds.
 */

export const DECRYPT_CHARSET = '01{}[]<>/=+*';
export const DECRYPT_MAX_TICKS = 40;

/** Mulberry32: a tiny seeded PRNG in [0, 1). Deterministic across runs and engines. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isBlank(ch: string): boolean {
  return ch === ' ' || ch === '\n' || ch === '\t';
}

/** Visible characters: everything a tick can reveal. */
export function visibleCount(text: string): number {
  let n = 0;
  for (const ch of text) if (!isBlank(ch)) n += 1;
  return n;
}

/** Characters revealed per tick so the reveal ends within `DECRYPT_MAX_TICKS`. */
export function revealPerTick(text: string, maxTicks: number = DECRYPT_MAX_TICKS): number {
  return Math.max(1, Math.ceil(visibleCount(text) / Math.max(1, maxTicks)));
}

/**
 * One frame: the first `revealed` visible characters are the real ones, the rest are drawn
 * from `charset`, and blanks stay blank so the words keep their shape.
 */
export function decryptFrame(
  text: string,
  revealed: number,
  rng: () => number,
  charset: string = DECRYPT_CHARSET,
): string {
  const chars = Array.from(charset);
  let seen = 0;
  let out = '';
  for (const ch of text) {
    if (isBlank(ch)) {
      out += ch;
      continue;
    }
    out += seen < revealed ? ch : chars[Math.floor(rng() * chars.length)] ?? ch;
    seen += 1;
  }
  return out;
}

/**
 * Every frame of the reveal, first to last. Frame 0 is fully scrambled, the last frame is
 * `text` itself, and each frame between reveals `revealPerTick(text)` more characters.
 */
export function decryptFrames(
  text: string,
  rng: () => number,
  charset: string = DECRYPT_CHARSET,
  maxTicks: number = DECRYPT_MAX_TICKS,
): string[] {
  const total = visibleCount(text);
  const step = revealPerTick(text, maxTicks);
  const frames: string[] = [];
  for (let revealed = 0; revealed < total; revealed += step) {
    frames.push(decryptFrame(text, revealed, rng, charset));
  }
  frames.push(text);
  return frames;
}
