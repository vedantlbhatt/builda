/**
 * WHICH CREATURE EACH SESSION WEARS (DESIGN-V2 2.2, "every session is its own builder"), and so
 * its hue on every surface: the mission tile, the live bar, the Sessions list, the session page,
 * the Lock Screen, the Dynamic Island and the Home Screen widget. The rule lives here once.
 * `mission.ts` and `LiveSessions.tsx` re-export it for the screens that always asked them; the
 * live surfaces (`surface.ts`, `activity.ts`) import it from here, because `mission.ts` imports
 * `surface.ts` and a rule reached through it would be an import cycle.
 *
 * The server never computes a creature. The phone registers each Live Activity's push token
 * with the creature of that activity's session (`tokens.ts`), and `live_push.content_state`
 * draws the push with the token's creature, so a card the server moves in the background wears
 * the same creature the phone gave it, with no second copy of the rule to drift.
 *
 * Pure apart from `crewFor`'s memory: no React Native, so `bun test` holds it.
 */

import type { SessionDetail } from '../data/api';
import type { Animal } from '../pixel/animals';
import { CREW_RING } from '../theme';

function parseMs(iso: string | null | undefined): number | null {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

/**
 * FNV-1a, 32 bit, over the UTF-8 bytes of `s`: offset basis 0x811C9DC5, prime 0x01000193
 * (DESIGN-V2 2.2, whose three test vectors `__tests__/mission.test.ts` holds).
 */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    const bytes =
      cp < 0x80
        ? [cp]
        : cp < 0x800
          ? [0xc0 | (cp >> 6), 0x80 | (cp & 63)]
          : cp < 0x10000
            ? [0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)]
            : [0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)];
    for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The creature a session's id hashes onto, before any step: `CREW_RING[fnv1a32(id) % 8]`. */
export function crewHashed(clientSessionId: string): Animal {
  return CREW_RING[fnv1a32(clientSessionId) % CREW_RING.length]!;
}

/**
 * Each session's creature: the ring creature its client session id hashes onto, stepped forward
 * along the ring past any creature a session running at its start already wears. Taken oldest
 * first; with all eight worn the hashed one stands. Never Bit, so no session wears the brand's
 * amber.
 *
 * The phone sees only the rows it holds, so a session that ran alongside this one and has since
 * left the list cannot push it along the ring here. `kept` carries every creature this process
 * has already drawn for a session, and a kept creature never changes: a tile does not change
 * colour under someone because a neighbour finished. UNVERIFIED PARITY: the design names a
 * Python twin (`crew_creature` in analysis/live.py) that does not exist, and the server has no
 * need of one (the creature rides on the push token), so this is the only implementation and the
 * test holds it to the design's vectors and rules, not to a second one.
 */
export function crewCreatures(rows: readonly SessionDetail[], kept: ReadonlyMap<string, Animal> = new Map()): Map<string, Animal> {
  const ring = CREW_RING as readonly Animal[];
  const byStart = [...rows].sort((a, b) => {
    const d = (parseMs(a.started_at) ?? 0) - (parseMs(b.started_at) ?? 0);
    return d !== 0 ? d : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const out = new Map<string, Animal>();
  // The sessions that began earlier and had not ended by now, with when they end (a live one,
  // or a final one with no end, never does). Taken in start order, a session that ended before
  // this one began ended before every later one began too, so it leaves the list for good:
  // a whole saved history costs its concurrency, not its square.
  const running: { end: number; creature: Animal }[] = [];
  for (const s of byStart) {
    if (out.has(s.id)) continue; // one row per session: the same id twice is one sitting
    const start = parseMs(s.started_at);
    if (start !== null) {
      for (let k = running.length - 1; k >= 0; k--) if (running[k]!.end <= start) running.splice(k, 1);
    }
    let pick = kept.get(s.id);
    if (!pick) {
      const worn = new Set(running.map((r) => r.creature));
      const base = fnv1a32(s.client_session_id || s.id) % ring.length;
      pick = ring[base]!;
      for (let k = 0; k < ring.length; k++) {
        const c = ring[(base + k) % ring.length]!;
        if (!worn.has(c)) {
          pick = c;
          break;
        }
      }
    }
    out.set(s.id, pick);
    const end = s.state === 'final' ? parseMs(s.ended_at) : null;
    running.push({ end: end ?? Number.POSITIVE_INFINITY, creature: pick });
  }
  return out;
}

// ------------------------------------------------------------------ this process's memory

/**
 * Every creature this process has drawn for a session (`crewCreatures`' `kept`): once a tile has
 * a colour it keeps it, on the grid, the Sessions doorway, the live bar, the Lock Screen and the
 * widget alike. Never persisted: a relaunch recomputes the same answer from the same rows.
 */
let crewKept: Map<string, Animal> = new Map();
/** Enough for a whole saved Sessions list (it asks too) and every live row; a few kilobytes. */
const CREW_KEPT_MAX = 4096;

/** The crew for these rows, remembered for the rest of the process. */
export function crewFor(rows: readonly SessionDetail[]): Map<string, Animal> {
  const out = crewCreatures(rows, crewKept);
  let changed = false;
  for (const [id, c] of out) {
    if (crewKept.get(id) !== c) changed = true;
  }
  if (changed) {
    const next = new Map([...crewKept, ...out]);
    // Oldest first out: a Map iterates in insertion order.
    while (next.size > CREW_KEPT_MAX) next.delete(next.keys().next().value as string);
    crewKept = next;
  }
  return out;
}

/** One session's creature, for a screen that holds only that session (the live bar). */
export function sessionCreature(s: Pick<SessionDetail, 'id' | 'client_session_id'>): Animal {
  return crewKept.get(s.id) ?? crewHashed(s.client_session_id || s.id);
}
