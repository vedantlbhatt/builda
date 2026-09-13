/**
 * The Live Activity's push tokens (docs/overnight-integration.md 3.6, section 7 `liveTokens`):
 * what the phone tells the server it may push to, and when it takes that back. Every rule fails
 * as a card that is wrong without an error: a server pushing the repository and the sentence to
 * a Lock Screen whose owner turned details off, or to a card that is gone.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { LiveActivityRegistration } from '../src/data/api';
import { LiveTokens, type TokenSettings } from '../src/live/tokens';

const ROOT = join(import.meta.dir, '..');

function sink(fail = new Set<string>()) {
  const calls: (['register', LiveActivityRegistration] | ['forget', string])[] = [];
  return {
    calls,
    register: async (b: LiveActivityRegistration) => {
      calls.push(['register', b]);
      if (fail.has(`register:${b.kind === 'activity' ? b.activity_id : b.token}`)) throw new Error('offline');
    },
    forget: async (id: string) => {
      calls.push(['forget', id]);
      if (fail.has(`forget:${id}`)) throw new Error('offline');
    },
  };
}

const ON: TokenSettings = { enabled: true, environment: 'sandbox', creature: 'owl' };
const EV = { activityId: 'ACT-1', sessionId: '3f0e5c9a-1111-4222-8333-444455556666', token: 'ABCDEF0123' };

describe('onPushToken registers the token with its session, activity, environment and creature', () => {
  test('the body is the route\'s, the token lowercased as the server stores it', async () => {
    const s = sink();
    const t = new LiveTokens(s, ON);
    expect(await t.onToken(EV)).toBe('registered');
    expect(s.calls).toEqual([
      [
        'register',
        {
          kind: 'activity',
          session_id: EV.sessionId,
          activity_id: 'ACT-1',
          token: 'abcdef0123',
          environment: 'sandbox',
          creature: 'owl',
        },
      ],
    ]);
    expect(t.registered()).toEqual(['ACT-1']);
  });

  test('the same token again posts nothing; a rotated token posts again', async () => {
    const s = sink();
    const t = new LiveTokens(s, ON);
    await t.onToken(EV);
    expect(await t.onToken({ ...EV, token: 'abcdef0123' })).toBe('known');
    expect(await t.onToken({ ...EV, token: 'beef' })).toBe('registered');
    expect(s.calls.filter((c) => c[0] === 'register')).toHaveLength(2);
  });

  test('the same token handed over twice while the first post is out is posted once', async () => {
    const s = sink();
    const t = new LiveTokens(s, ON);
    const [a, b] = await Promise.all([t.onToken(EV), t.onToken(EV)]);
    expect([a, b].sort()).toEqual(['known', 'registered']);
    expect(s.calls.filter((c) => c[0] === 'register')).toHaveLength(1);
  });

  test('a post that failed is retried on the next tick, and only then', async () => {
    const fail = new Set(['register:ACT-1']);
    const s = sink(fail);
    const t = new LiveTokens(s, ON);
    expect(await t.onToken(EV)).toBe('failed');
    expect(t.registered()).toEqual([]);
    fail.clear();
    await t.update(ON);
    expect(t.registered()).toEqual(['ACT-1']);
    await t.update(ON);
    expect(s.calls.filter((c) => c[0] === 'register')).toHaveLength(2);
  });

  test('a new creature re-registers, because the creature rides on the token', async () => {
    const s = sink();
    const t = new LiveTokens(s, ON);
    await t.onToken(EV);
    await t.update({ ...ON, creature: 'fox' });
    const last = s.calls.at(-1)!;
    expect(last[0]).toBe('register');
    expect((last[1] as LiveActivityRegistration).creature).toBe('fox');
  });
});

describe('ending forgets', () => {
  test('an ended or dismissed activity\'s token is deleted on the server', async () => {
    const s = sink();
    const t = new LiveTokens(s, ON);
    await t.onToken(EV);
    expect(await t.onEnded('ACT-1')).toBe(true);
    expect(s.calls.at(-1)).toEqual(['forget', 'ACT-1']);
    expect(t.registered()).toEqual([]);
    // a second end, or one for a token the server never had, sends nothing
    expect(await t.onEnded('ACT-1')).toBe(false);
    expect(await t.onEnded('ACT-9')).toBe(false);
    expect(s.calls.filter((c) => c[0] === 'forget')).toHaveLength(1);
  });

  test('sign out forgets every registered token and remembers none', async () => {
    const s = sink();
    const t = new LiveTokens(s, ON);
    await t.onToken(EV);
    await t.onToken({ ...EV, activityId: 'ACT-2', token: 'cafe' });
    await t.forgetAll();
    expect(s.calls.filter((c) => c[0] === 'forget').map((c) => c[1]).sort()).toEqual(['ACT-1', 'ACT-2']);
    await t.update(ON);
    expect(s.calls.filter((c) => c[0] === 'register')).toHaveLength(2);
  });
});

describe('Show details on Lock Screen off: the server never pushes', () => {
  test('off, a token is held and never posted', async () => {
    const s = sink();
    const t = new LiveTokens(s, { ...ON, enabled: false });
    expect(await t.onToken(EV)).toBe('held');
    expect(s.calls).toEqual([]);
    // back on: posted then, without a new start
    await t.update(ON);
    expect(t.registered()).toEqual(['ACT-1']);
  });

  test('turning it off forgets every token the server holds', async () => {
    const s = sink();
    const t = new LiveTokens(s, ON);
    await t.onToken(EV);
    await t.update({ ...ON, enabled: false });
    expect(s.calls.at(-1)).toEqual(['forget', 'ACT-1']);
    expect(t.registered()).toEqual([]);
    // and staying off sends nothing more
    await t.update({ ...ON, enabled: false });
    expect(s.calls).toHaveLength(2);
  });
});

describe('activity.ts wires it', () => {
  const src = readFileSync(join(ROOT, 'src/live/activity.ts'), 'utf8');

  test('the module\'s token and state events reach the tokens, and every end forgets', () => {
    expect(src).toContain("mod.addListener('onPushToken'");
    expect(src).toContain("mod.addListener('onActivityState'");
    expect(src).toContain('void tokens.onEnded(action.activityId)');
    expect(src).toContain('await tokens.forgetAll()');
  });

  test('a card starts with push: true only when the server may push to it, and without when that fails', () => {
    expect(src).toContain('startActivity(mod!, action.attrs, action.state, action.opts, tokens.enabled)');
    expect(src).toContain('{ ...opts, push: true }');
    expect(src).toMatch(/enabled: Boolean\(opts\.pushTokens\) && details/);
  });
});
