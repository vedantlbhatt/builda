import { EMPTY, GRID } from './frames';
import { SPRITES, type SpriteState } from './sprites';

/**
 * How far in from its box Bit is actually drawn, on the left, in points: the empty columns
 * of the 16x16 frame (the leftmost drawn cell over every frame of the state, so a waving arm
 * never pokes past it) plus the box's centring slack.
 *
 * Without it the 64pt empty states drew Bit's body 16pt inside the gutter, under a title and
 * over a card that both start on it, so the mascot read as indented by accident.
 */
export function spriteLeftInset(state: SpriteState, size: number): number {
  const px = Math.max(1, Math.floor(size / GRID));
  let first = GRID;
  for (const frame of SPRITES[state]) {
    for (const row of frame) {
      for (let i = 0; i < Math.min(first, row.length); i++) {
        if (row[i] !== EMPTY) {
          first = i;
          break;
        }
      }
    }
  }
  if (first === GRID) return 0;
  return (size - px * GRID) / 2 + first * px;
}
