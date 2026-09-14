/**
 * Which creature a session wears on the session screens (`src/session/crew.ts`), which asks
 * mission control's rule (`live/mission.crewCreatures`, the one definition) rather than keeping a
 * second: the tokens' crew ring, FNV-1a over the client session id, stepped past the creatures of
 * sessions still running when it began, never Bit; and the hues its page's chapters wear, which
 * never repeat a neighbour's.
 */
import { describe, expect, test } from 'bun:test';

import type { SessionDetail } from '../src/data/api';
import { crewCreatures } from '../src/live/mission';
import { crewBase, crewOf, fnv1a32, sessionHues } from '../src/session/crew';
import { CREW_RING, creatureHue } from '../src/theme';

const at = (h: number, m = 0) => new Date(Date.UTC(2026, 8, 12, h, m)).toISOString();

function row(id: string, start: string, end: string, csid = id, state: 'final' | 'live' = 'final'): SessionDetail {
  return {
    id,
    client_session_id: csid,
    harness: 'claude_code',
    repo_name: null,
    started_at: start,
    ended_at: end,
    active_seconds: 600,
    idle_seconds: 0,
    local_date: '2026-09-12',
    title: null,
    title_source: null,
    notable: true,
    unattended: false,
    timeline_fidelity: 'full',
    is_shared: false,
    state,
  };
}

/** A second id that hashes onto the same creature as `id`: found by search, not by luck. */
function twinOf(id: string): string {
  const base = crewBase(id);
  for (let i = 0; ; i++) if (crewBase(`t${i}`) === base && `t${i}` !== id) return `t${i}`;
}

describe('the hash', () => {
  test('is 32 bit FNV-1a, on its published vectors', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
    expect(fnv1a32('foobar')).toBe(0xbf9cf968);
  });
});

describe('the creature', () => {
  test('is the ring at the hash, never Bit, and the same on every call', () => {
    for (const id of ['sample', 'a1b2c3', '992d3438cdc7c44f23d949dd4c879e75debc6988dbacc30ef241b537e505059e']) {
      const c = crewBase(id);
      expect(c).toBe(CREW_RING[fnv1a32(id) % CREW_RING.length]!);
      expect(c).not.toBe('bit' as never);
    }
  });

  test('a session that starts while another runs steps past its creature, along the ring', () => {
    const first = row('first', at(9), at(11), 's0');
    const second = row('second', at(10), at(12), twinOf('s0'));
    const base = crewBase('s0');
    const next = CREW_RING[(CREW_RING.indexOf(base) + 1) % CREW_RING.length]!;
    expect(crewOf(first, [first, second])).toBe(base);
    expect(crewOf(second, [first, second])).toBe(next);
  });

  test('one that starts after the other ended keeps its own; a running one is running whatever its last event says', () => {
    const first = row('first', at(9), at(10), 's0');
    const later = row('later', at(10, 30), at(11), twinOf('s0'));
    expect(crewOf(later, [first, later])).toBe(crewBase('s0'));
    const running = row('first', at(9), at(10), 's0', 'live');
    expect(crewOf(later, [running, later])).not.toBe(crewBase('s0'));
  });

  test('the page asks with the saved list and gets what the list got; alone, a session wears its own', () => {
    const list = [row('a', at(9), at(11)), row('b', at(10), at(12)), row('c', at(13), at(14))];
    const crew = crewCreatures(list);
    for (const s of list) expect(crewOf(s, list)).toBe(crew.get(s.id)!);
    const alone = row('z', at(22), at(23), 'zzz');
    expect(crewOf(alone, list)).toBe(crewBase('zzz'));
  });
});

describe('the hues a session page wears', () => {
  test('the hero is the creature\'s; the burn is ember, the reading iris, unless the session already is', () => {
    for (const c of CREW_RING) {
      const h = sessionHues(c);
      expect(h.session).toBe(creatureHue(c).name);
      expect(new Set([h.session, h.burn, h.reading]).size).toBe(3);
      expect(h.burn === 'ember' || (h.session === 'ember' && h.burn === 'coral')).toBe(true);
      expect(h.reading === 'iris' || (h.session === 'iris' && h.reading === 'heather')).toBe(true);
    }
  });
});
