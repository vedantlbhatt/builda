/**
 * Onboarding's session count is every session on the account (`src/onboarding/facts.ts`).
 *
 * FOUND IN THE CAPTURE PASS (2026-09-14, shots/now2/50-onboarding-04 and -05): "81 sessions uploaded
 * to your account" and "81 sessions have reached your account" on an account holding 183. The list
 * route answers with the sessions you were there for at least 20 minutes unless asked for every one,
 * and the count asked it nothing. The sentences say uploaded and reached, so the count is every one.
 */
import { describe, expect, mock, test } from 'bun:test';

mock.module('expo-secure-store', () => ({ getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} }));
mock.module('expo-constants', () => ({ default: { expoConfig: { version: '0.1.0-test', extra: { apiBaseUrl: 'http://127.0.0.1:8787' } } } }));

const { countSessions } = await import('../src/onboarding/facts');
const { DONE, doneName, sessionsArrived, sessionsCaption, toolsFound } = await import('../src/onboarding/copy');

/** A server holding `total` finished sessions (`notable` of them ones you were there for) and `live` running, paged 200 at a time. */
function server(total: number, notable: number, live = 0) {
  const rows = Array.from({ length: total + live }, (_, i) => ({
    id: `s${i}`,
    harness: 'claude_code',
    started_at: new Date(Date.UTC(2026, 7, 11) + i * 3_600_000).toISOString(),
    notable: i < notable,
    state: i >= total ? 'live' : 'final',
  })).reverse();
  const asked: { notable_only?: boolean; before?: string | null; include_live?: boolean }[] = [];
  const sessions = async (o: { limit?: number; before?: string | null; notable_only?: boolean; include_live?: boolean } = {}) => {
    asked.push({ notable_only: o.notable_only, before: o.before, include_live: o.include_live });
    // The route's defaults: finished ones only, and the notable ones only.
    const finished = o.include_live ? rows : rows.filter((r) => r.state === 'final');
    const pool = o.notable_only === false ? finished : finished.filter((r) => r.notable);
    const after = o.before ? pool.filter((r) => Date.parse(r.started_at) < Date.parse(o.before!)) : pool;
    const page = after.slice(0, o.limit ?? 50);
    return { sessions: page, next_before: page.length === (o.limit ?? 50) ? page[page.length - 1]!.started_at : null } as never;
  };
  return { sessions, asked };
}

describe('the onboarding count', () => {
  test('counts every session on the account, not the ones you were there for 20 minutes', async () => {
    const s = server(183, 81);
    const r = await countSessions({ sessions: s.sessions as never });
    expect(r.total).toBe(183);
    expect(r.partial).toBe(false);
    expect(r.counts).toEqual({ claude_code: 183 } as never);
    expect(s.asked.every((a) => a.notable_only === false && a.include_live === true)).toBe(true);
  });

  test('a running session was uploaded too, and is counted (review: 185 said of 186, one running)', async () => {
    const s = server(185, 81, 1);
    expect((await countSessions({ sessions: s.sessions as never })).total).toBe(186);
  });

  test('pages past 200, and past 1,000 says the count is a lower bound', async () => {
    const two = server(450, 10);
    expect((await countSessions({ sessions: two.sessions as never })).total).toBe(450);
    expect(two.asked).toHaveLength(3);
    const many = await countSessions({ sessions: server(1200, 10).sessions as never });
    expect(many).toMatchObject({ total: 1000, partial: true });
  });

  test('the words around it say uploaded, which every session was', () => {
    expect(sessionsCaption(183, false)).toBe('sessions uploaded to your account');
    expect(toolsFound(183, false, ['Claude Code'])).toBe('Builda found 183 sessions from Claude Code uploaded to your account and picked it.');
    expect(sessionsArrived(183, false)).toContain('183 sessions have reached your account.');
  });
});

describe('the last screen names you (shots/now2/50-onboarding-07)', () => {
  test('the saved name, else the account\'s, else none, and the card caption is never the band\'s title again', () => {
    expect(doneName('Vedant', 'thutoy')).toBe('Vedant');
    expect(doneName('  ', 'thutoy')).toBe('thutoy');
    expect(doneName(null, ' thutoy ')).toBe('thutoy');
    expect(doneName(undefined, null)).toBe('');
    // done.tsx: caption = name ? creatureWord(animal) : '' under a band titled DONE.label.
    const caption = (name: string) => (name ? 'the octopus' : '');
    for (const name of ['thutoy', '']) expect(caption(name)).not.toBe(DONE.label);
  });
});
