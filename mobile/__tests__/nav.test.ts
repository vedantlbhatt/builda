/**
 * The navigation rules: who sees onboarding, what a dev-auth link may ask for, the onboarding
 * order, the Wrapped card param, and the name that waits for a sign-in. A wrong answer in the
 * first one sends every existing user through onboarding on upgrade, or skips it for every
 * new one, with no error anywhere.
 */
import { describe, expect, test } from 'bun:test';

import { syncPendingName, saveLocalName, getLocalName, type NameApi, type NameKv } from '../src/nav/name';
import {
  clampCard,
  decideOnboarded,
  devAuthLanding,
  isInAppPath,
  LOCAL_NAME_KEY,
  NAME_MAX,
  NAME_PENDING_KEY,
  nameProblem,
  nextOnboardingStep,
  normalizeName,
  ONBOARDED_KEY,
  ONBOARDING_STEPS,
  onboardingPosition,
  parseDevAuth,
  pathWhileOnboarding,
  TABS,
  tabTitle,
} from '../src/nav/rules';

describe('decideOnboarded', () => {
  test('a written flag is the answer, whatever the sign-in state', () => {
    expect(decideOnboarded('1', false)).toBe(true);
    expect(decideOnboarded('1', true)).toBe(true);
    expect(decideOnboarded('0', true)).toBe(false);
    expect(decideOnboarded('0', false)).toBe(false);
  });
  test('no flag: an install that predates onboarding and signed in is not sent through it', () => {
    expect(decideOnboarded(null, true)).toBe(true);
  });
  test('no flag and signed out is a fresh install', () => {
    expect(decideOnboarded(null, false)).toBe(false);
  });
  test('a value nobody writes is not read as yes', () => {
    expect(decideOnboarded('yes', false)).toBe(false);
    expect(decideOnboarded('', false)).toBe(false);
  });
  test('the flag survives sign-out because it is a device key', () => {
    expect(ONBOARDED_KEY.startsWith('device.')).toBe(true);
    // The name is the person's, so it must NOT survive a sign-out.
    expect(LOCAL_NAME_KEY.startsWith('device.')).toBe(false);
    expect(NAME_PENDING_KEY.startsWith('device.')).toBe(false);
  });
});

describe('the name', () => {
  test('normalised: trimmed, inner whitespace collapsed', () => {
    expect(normalizeName('  Ada   Lovelace \n')).toBe('Ada Lovelace');
  });
  test('empty is "nothing yet", not an error sentence', () => {
    expect(nameProblem('')).toBe('empty');
    expect(nameProblem('    ')).toBe('empty');
  });
  test('1 to 24 characters, counted as characters not UTF-16 units', () => {
    expect(nameProblem('A')).toBeNull();
    expect(nameProblem('x'.repeat(NAME_MAX))).toBeNull();
    expect(nameProblem('x'.repeat(NAME_MAX + 1))).toBe('too_long');
    // 24 astral characters are 48 UTF-16 units; still 24 characters.
    expect(nameProblem('\u{1D49C}'.repeat(NAME_MAX))).toBeNull();
  });
  test('never longer than the server allows', () => {
    // server/builder/routes/users.py MAX_DISPLAY_NAME via src/social/account.ts
    expect(NAME_MAX).toBeLessThanOrEqual(40);
  });
});

describe('tabs', () => {
  test('bar order is Now, Sessions, You', () => {
    expect(TABS.map((t) => t.name)).toEqual(['now', 'sessions', 'you']);
  });
  test('the back label over the tabs is the tab you came from, never "(tabs)"', () => {
    expect(tabTitle('sessions')).toBe('Sessions');
    expect(tabTitle('you')).toBe('You');
    expect(tabTitle(undefined)).toBe('Now');
    expect(tabTitle('(tabs)')).toBe('Now');
  });
});

describe('onboarding order', () => {
  test('six steps, hello first and notify last', () => {
    expect([...ONBOARDING_STEPS]).toEqual(['hello', 'name', 'creature', 'tools', 'connect', 'notify']);
  });
  test('each step pushes the next; the last one finishes instead', () => {
    expect(nextOnboardingStep('hello')).toBe('/onboarding/name');
    expect(nextOnboardingStep('connect')).toBe('/onboarding/notify');
    expect(nextOnboardingStep('notify')).toBeNull();
  });
  test('position is 1-based', () => {
    expect(onboardingPosition('hello')).toEqual({ n: 1, of: 6 });
    expect(onboardingPosition('notify')).toEqual({ n: 6, of: 6 });
  });
});

describe('pathWhileOnboarding', () => {
  test('onboarding steps and dev routes pass unchanged', () => {
    for (const p of ['/onboarding/name', 'builder://onboarding/notify', '/onboarding/hello', 'builder://dev-auth?reset=1', '/dev-gallery?section=type']) {
      expect(pathWhileOnboarding(p)).toBe(p);
    }
  });
  test('a pairing link keeps its code on the connect step, encoded', () => {
    expect(pathWhileOnboarding('builder://pair?code=BCDF-GHJK')).toBe('/onboarding/connect?code=BCDF-GHJK');
    expect(pathWhileOnboarding('/pair?code=a%20b')).toBe('/onboarding/connect?code=a%20b');
    expect(pathWhileOnboarding('/pair')).toBe('/onboarding/connect');
  });
  test('everything else is dropped', () => {
    for (const p of ['/now', '/sessions', '/session/abc', '/settings', '/wrapped?card=7', '/onboardingx', '/pairing', '']) {
      expect(pathWhileOnboarding(p)).toBeNull();
    }
  });
});

describe('wrapped ?card=', () => {
  test('1 to 15 open that card', () => {
    expect(clampCard('1')).toBe(1);
    expect(clampCard('7')).toBe(7);
    expect(clampCard('15')).toBe(15);
  });
  test('anything else opens the first', () => {
    for (const raw of [undefined, '', '0', '16', '-3', '7.5', 'seven', '7abc', ' ']) {
      expect(clampCard(raw)).toBe(1);
    }
  });
});

describe('parseDevAuth', () => {
  test('tokens, onboarded and a destination', () => {
    const r = parseDevAuth({ access: 'a.b.c', refresh: 'r1', onboarded: '1', to: '/wrapped?card=7' });
    expect(r.problem).toBeNull();
    expect(r.tokens).toEqual({ access: 'a.b.c', refresh: 'r1' });
    expect(r.onboarded).toBe(true);
    expect(r.to).toBe('/wrapped?card=7');
    expect(r.signOut).toBe(false);
  });
  test('reset alone resets; nothing at all leaves everything alone', () => {
    expect(parseDevAuth({ reset: '1' }).onboarded).toBe(false);
    const none = parseDevAuth({});
    expect(none).toEqual({ tokens: null, onboarded: null, signOut: false, to: null, problem: null });
  });
  test('one token without the other is refused, and nothing is applied', () => {
    const r = parseDevAuth({ access: 'a', onboarded: '1' });
    expect(r.problem).not.toBeNull();
    expect(r.tokens).toBeNull();
    expect(r.onboarded).toBeNull();
    expect(parseDevAuth({ refresh: 'r' }).problem).not.toBeNull();
    expect(parseDevAuth({ access: '  ', refresh: 'r' }).problem).not.toBeNull();
  });
  test('reset and onboarded together are refused rather than guessed', () => {
    expect(parseDevAuth({ reset: '1', onboarded: '1' }).problem).not.toBeNull();
  });
  test('to must stay inside the app', () => {
    expect(parseDevAuth({ to: 'https://example.com' }).problem).not.toBeNull();
    expect(parseDevAuth({ to: '//example.com' }).problem).not.toBeNull();
    expect(parseDevAuth({ to: 'wrapped' }).problem).not.toBeNull();
    expect(isInAppPath('/session/abc?recap=1')).toBe(true);
    expect(isInAppPath('/onboarding/name')).toBe(true);
    expect(isInAppPath('/x y')).toBe(false);
  });
  test('array params (a repeated key) take the first', () => {
    expect(parseDevAuth({ access: ['a1', 'a2'], refresh: ['r1'] }).tokens).toEqual({ access: 'a1', refresh: 'r1' });
  });
  test('signout accepts 1 or true and nothing else', () => {
    expect(parseDevAuth({ signout: '1' }).signOut).toBe(true);
    expect(parseDevAuth({ signout: 'true' }).signOut).toBe(true);
    expect(parseDevAuth({ signout: '0' }).signOut).toBe(false);
  });
  test('landing: the link wins, then the first tab, then the first step', () => {
    expect(devAuthLanding(true, '/you/money')).toBe('/you/money');
    expect(devAuthLanding(true, null)).toBe('/now');
    expect(devAuthLanding(false, null)).toBe('/onboarding/hello');
  });
});

function memoryKv(seed: Record<string, string> = {}): NameKv & { data: Record<string, string> } {
  const data = { ...seed };
  return {
    data,
    getKv: async (k) => (k in data ? data[k]! : null),
    setKv: async (k, v) => {
      data[k] = v;
    },
  };
}

function fakeApi(signedIn: boolean, fail = false): NameApi & { sent: unknown[] } {
  const sent: unknown[] = [];
  return {
    sent,
    isSignedIn: async () => signedIn,
    patchMe: async (body) => {
      if (fail) throw new Error('500');
      sent.push(body);
      return { id: 'u', handle: null, display_name: body.display_name ?? null, profile_public: false, created_at: '', factions: [] };
    },
  };
}

describe('the name waits for a sign-in', () => {
  test('saved signed out: stored, pending, nothing sent', async () => {
    const kv = memoryKv();
    const api = fakeApi(false);
    expect(await saveLocalName('  Ada  ', kv)).toBe('Ada');
    expect(await getLocalName(kv)).toBe('Ada');
    expect(await syncPendingName(api, kv)).toBe('signed_out');
    expect(api.sent).toEqual([]);
    expect(kv.data[NAME_PENDING_KEY]).toBe('1');
  });
  test('then signed in: sent once as display_name, and not again', async () => {
    const kv = memoryKv({ [LOCAL_NAME_KEY]: 'Ada', [NAME_PENDING_KEY]: '1' });
    const api = fakeApi(true);
    expect(await syncPendingName(api, kv)).toBe('sent');
    expect(api.sent).toEqual([{ display_name: 'Ada' }]);
    expect(await syncPendingName(api, kv)).toBe('nothing_pending');
    expect(api.sent.length).toBe(1);
  });
  test('a failed PATCH keeps it pending for the next chance', async () => {
    const kv = memoryKv({ [LOCAL_NAME_KEY]: 'Ada', [NAME_PENDING_KEY]: '1' });
    expect(await syncPendingName(fakeApi(true, true), kv)).toBe('failed');
    expect(kv.data[NAME_PENDING_KEY]).toBe('1');
    expect(await syncPendingName(fakeApi(true), kv)).toBe('sent');
  });
  test('three triggers at once make one PATCH', async () => {
    const kv = memoryKv({ [LOCAL_NAME_KEY]: 'Ada', [NAME_PENDING_KEY]: '1' });
    const api = fakeApi(true);
    const results = await Promise.all([syncPendingName(api, kv), syncPendingName(api, kv), syncPendingName(api, kv)]);
    expect(results).toEqual(['sent', 'sent', 'sent']);
    expect(api.sent.length).toBe(1);
  });
  test('a pending mark with no name (a reset) clears itself instead of sending an empty name', async () => {
    const kv = memoryKv({ [LOCAL_NAME_KEY]: '', [NAME_PENDING_KEY]: '1' });
    const api = fakeApi(true);
    expect(await syncPendingName(api, kv)).toBe('nothing_pending');
    expect(api.sent).toEqual([]);
    expect(kv.data[NAME_PENDING_KEY]).toBe('0');
  });
  test('a name onboarding would refuse is never stored', async () => {
    const kv = memoryKv();
    await expect(saveLocalName('   ', kv)).rejects.toThrow();
    await expect(saveLocalName('x'.repeat(NAME_MAX + 1), kv)).rejects.toThrow();
    expect(kv.data).toEqual({});
  });
});
