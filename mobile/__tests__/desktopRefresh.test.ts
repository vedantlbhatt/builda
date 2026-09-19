/**
 * The token refresh across WINDOWS (`src/data/api.ts`, `acrossWindows`). The desktop shell runs
 * the app and the island as two pages over one token store; refresh tokens rotate and redeeming a
 * spent one revokes the device, so a page that held the old pair in memory while the other page
 * rotated it must adopt the stored pair and redeem nothing.
 */
import { describe, expect, mock, test } from 'bun:test';

// Neither native module exists in bun (see api.test.ts): stubbed at the module boundary.
mock.module('expo-secure-store', () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => {},
  deleteItemAsync: async () => {},
}));
mock.module('expo-constants', () => ({
  default: { expoConfig: { version: '0.1.0-test' } },
}));

const { Api } = await import('../src/data/api');
type TokenStorage = import('../src/data/api').TokenStorage;

function storage(init: Record<string, string>) {
  const m = new Map(Object.entries(init));
  const s: TokenStorage = {
    get: async (k) => m.get(k) ?? null,
    set: async (k, v) => void m.set(k, v),
    remove: async (k) => void m.delete(k),
  };
  return { s, m };
}

describe('the token refresh across windows', () => {
  test('a page holding a spent refresh token adopts the pair another page rotated, and redeems nothing', async () => {
    const { s, m } = storage({ 'builder.access': 'A1', 'builder.refresh': 'R1' });
    const calls: string[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: { headers?: Record<string, string> }) => {
      const bearer = init?.headers?.Authorization ?? '';
      calls.push(`${String(url).replace('http://x', '')} ${bearer}`);
      if (String(url).endsWith('/v1/auth/refresh')) return new Response('{"detail":"reuse"}', { status: 401 });
      return bearer === 'Bearer A2' ? new Response('{"handle":"me"}', { status: 200 }) : new Response('{}', { status: 401 });
    }) as unknown as typeof fetch;
    try {
      const island = new Api('http://x', s);
      expect(await island.isSignedIn()).toBe(true); // A1 and R1, held in memory from here on
      // The app window refreshed meanwhile: the store has the rotated pair.
      m.set('builder.access', 'A2');
      m.set('builder.refresh', 'R2');
      expect(await island.getMe()).toEqual({ handle: 'me' } as never);
      expect(calls.some((c) => c.includes('/v1/auth/refresh'))).toBe(false);
      expect(calls).toEqual(['/v1/users/me Bearer A1', '/v1/users/me Bearer A2']);
      expect(m.get('builder.refresh')).toBe('R2');
    } finally {
      globalThis.fetch = real;
    }
  });

  test('with nothing rotated it refreshes as before, once', async () => {
    const { s, m } = storage({ 'builder.access': 'A1', 'builder.refresh': 'R1' });
    const calls: string[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: { headers?: Record<string, string>; body?: string }) => {
      const bearer = init?.headers?.Authorization ?? '';
      calls.push(String(url).replace('http://x', ''));
      if (String(url).endsWith('/v1/auth/refresh')) {
        expect(JSON.parse(init?.body ?? '{}')).toEqual({ refresh_token: 'R1' });
        return new Response('{"access_token":"A2","refresh_token":"R2"}', { status: 200 });
      }
      return bearer === 'Bearer A2' ? new Response('{"handle":"me"}', { status: 200 }) : new Response('{}', { status: 401 });
    }) as unknown as typeof fetch;
    try {
      const api = new Api('http://x', s);
      expect(await api.getMe()).toEqual({ handle: 'me' } as never);
      expect(calls).toEqual(['/v1/users/me', '/v1/auth/refresh', '/v1/users/me']);
      expect(m.get('builder.refresh')).toBe('R2');
    } finally {
      globalThis.fetch = real;
    }
  });
});
