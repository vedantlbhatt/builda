/**
 * The system-URL rewrite. `builder://session/<id>?recap=1` is what a push carries, what
 * the Mac opens and what a share sheet pastes; every spelling of it must land on the
 * detail with the recap raised, and nothing else may be touched.
 */

import { describe, expect, test } from 'bun:test';

import { aliasPath, recapPath, redirectSystemPath } from '../app/+native-intent';
import { setGateSnapshot } from '../src/nav/gateSnapshot';

const SID = '0b6d7a1e-2f44-4a4a-9d2e-5d2a5d7c0a11';

describe('recapPath', () => {
  test('the canonical link, as expo-router hands it over', () => {
    expect(recapPath(`/session/${SID}?recap=1`)).toBe(`/session/${SID}?recap=1`);
  });
  test('the full URL, two or three slashes', () => {
    expect(recapPath(`builder://session/${SID}?recap=1`)).toBe(`/session/${SID}?recap=1`);
    expect(recapPath(`builder:///session/${SID}?recap=1`)).toBe(`/session/${SID}?recap=1`);
  });
  test('the /recap suffix spelling and a missing leading slash', () => {
    expect(recapPath(`session/${SID}/recap`)).toBe(`/session/${SID}?recap=1`);
    expect(recapPath(`/session/${SID}/recap/`)).toBe(`/session/${SID}?recap=1`);
  });
  test('a plain session link stays a plain session link', () => {
    expect(recapPath(`/session/${SID}`)).toBe(`/session/${SID}`);
    expect(recapPath(`/session/${SID}?recap=0`)).toBe(`/session/${SID}`);
  });
  test('other query parameters survive, recap normalised to 1', () => {
    expect(recapPath(`/session/${SID}?from=mac&recap=1`)).toBe(`/session/${SID}?from=mac&recap=1`);
  });
  test('not a session link → null', () => {
    expect(recapPath('/feed')).toBeNull();
    expect(recapPath('/session/')).toBeNull();
    expect(recapPath('/sessions/abc')).toBeNull();
    expect(recapPath(`/post/${SID}`)).toBeNull();
  });
});

describe('redirectSystemPath', () => {
  test('google auth still goes to settings', () => {
    expect(redirectSystemPath({ path: '/auth/google#id_token=x', initial: true })).toBe('/settings');
  });
  test('a session link is normalised; anything else passes through unchanged', () => {
    expect(redirectSystemPath({ path: `builder://session/${SID}?recap=1`, initial: false })).toBe(
      `/session/${SID}?recap=1`
    );
    expect(redirectSystemPath({ path: '/feed', initial: false })).toBe('/feed');
    expect(redirectSystemPath({ path: `/post/${SID}`, initial: true })).toBe(`/post/${SID}`);
  });
});

describe('aliasPath', () => {
  test('the root lands on the first tab: there is no index route', () => {
    // A plain launch on iOS arrives as expo-router's root URL, `builder:///`.
    for (const p of ['', '/', 'builder://', 'builder:///', 'builder:///?', '//', '/index']) {
      expect(aliasPath(p)).toBe('/now');
    }
  });
  test('the renamed routes keep working, query kept', () => {
    expect(aliasPath('/profile')).toBe('/you');
    expect(aliasPath('builder://profile')).toBe('/you');
    expect(aliasPath('/onboarding')).toBe('/onboarding/hello');
    expect(aliasPath('/onboarding/?from=test')).toBe('/onboarding/hello?from=test');
  });
  test('everything else is not an alias', () => {
    for (const p of ['/now', '/sessions', '/you', '/onboarding/name', '/wrapped?card=7', '/feed', `/session/${SID}`, 'builder://constructor', '/__proto__']) {
      expect(aliasPath(p)).toBeNull();
    }
  });
});

describe('redirectSystemPath, the new routes', () => {
  test('a cold start with no link lands on Now', () => {
    expect(redirectSystemPath({ path: 'builder:///', initial: true })).toBe('/now');
  });
  test('the old profile link opens You; the new routes pass through', () => {
    expect(redirectSystemPath({ path: 'builder://profile', initial: false })).toBe('/you');
    expect(redirectSystemPath({ path: 'builder://now', initial: false })).toBe('builder://now');
    expect(redirectSystemPath({ path: 'builder://dev-auth?reset=1', initial: true })).toBe('builder://dev-auth?reset=1');
  });
  test('a session link still wins over everything', () => {
    expect(redirectSystemPath({ path: `builder://session/${SID}/recap`, initial: true })).toBe(`/session/${SID}?recap=1`);
  });
});

describe('redirectSystemPath while onboarding is open', () => {
  // The gate is module state; every test here restores "not read yet".
  const withGate = (v: boolean | null, fn: () => void) => {
    setGateSnapshot(v);
    try {
      fn();
    } finally {
      setGateSnapshot(null);
    }
  };

  test('a warm link into the app half is dropped, not handed to a route that does not exist', () => {
    withGate(false, () => {
      expect(redirectSystemPath({ path: 'builder://sessions', initial: false })).toBe('');
      expect(redirectSystemPath({ path: `builder://session/${SID}?recap=1`, initial: false })).toBe('');
      expect(redirectSystemPath({ path: 'builder://', initial: false })).toBe('');
      expect(redirectSystemPath({ path: '/auth/google#id_token=x', initial: false })).toBe('');
    });
  });
  test('the Mac pairing link becomes the connect step, code kept', () => {
    withGate(false, () => {
      expect(redirectSystemPath({ path: 'builder://pair?code=BCDF-GHJK', initial: false })).toBe(
        '/onboarding/connect?code=BCDF-GHJK'
      );
    });
  });
  test('onboarding and the dev routes still pass', () => {
    withGate(false, () => {
      expect(redirectSystemPath({ path: 'builder://onboarding/name', initial: false })).toBe('builder://onboarding/name');
      expect(redirectSystemPath({ path: 'builder://onboarding', initial: false })).toBe('/onboarding/hello');
      expect(redirectSystemPath({ path: 'builder://dev-auth?onboarded=1', initial: false })).toBe('builder://dev-auth?onboarded=1');
    });
  });
  test('a launch link is passed through: the gate has not been read yet and the guard filters it', () => {
    withGate(false, () => {
      expect(redirectSystemPath({ path: 'builder://sessions', initial: true })).toBe('builder://sessions');
    });
  });
  test('an open gate, or one not read yet, changes nothing', () => {
    withGate(true, () => {
      expect(redirectSystemPath({ path: 'builder://sessions', initial: false })).toBe('builder://sessions');
      expect(redirectSystemPath({ path: 'builder://pair?code=BCDF-GHJK', initial: false })).toBe('builder://pair?code=BCDF-GHJK');
    });
    expect(redirectSystemPath({ path: 'builder://sessions', initial: false })).toBe('builder://sessions');
  });
});
