/**
 * Settings > Privacy: the two opt in switches and this phone's Lock Screen switch
 * (`src/data/privacy.ts`, docs/overnight-integration.md 2.3 and 2.4).
 *
 * Both account switches start OFF. Turning one off sends only that key, and deletes what it
 * let through: the server says how many quotes went, and the phone clears its own cached
 * file names. A switch moves when the server agrees, never before.
 */
import { describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

mock.module('expo-secure-store', () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => {},
  deleteItemAsync: async () => {},
}));
mock.module('expo-constants', () => ({ default: { expoConfig: { version: '0.1.0-test' } } }));

const privacy = await import('../src/data/privacy');
const { ApiError } = await import('../src/data/api');
const { hasDash } = await import('../src/copy/plain');
type PrivacyPrefs = import('../src/data/api').PrivacyPrefs;
type PrivacyPrefsUpdate = import('../src/data/api').PrivacyPrefsUpdate;
type PrivacyPrefsResult = import('../src/data/api').PrivacyPrefsResult;

function fakeApi(answer: (body: PrivacyPrefsUpdate) => PrivacyPrefsResult | Error) {
  const sent: PrivacyPrefsUpdate[] = [];
  return {
    sent,
    api: {
      setPrivacyPrefs: async (body: PrivacyPrefsUpdate) => {
        sent.push(body);
        const r = answer(body);
        if (r instanceof Error) throw r;
        return r;
      },
    },
  };
}

const OFF: PrivacyPrefs = { quotes: false, live_names: false };

describe('the privacy switches', () => {
  test('both default off', () => {
    expect(privacy.DEFAULT_PRIVACY_PREFS).toEqual({ quotes: false, live_names: false });
  });

  test('loading them: the account answer, and null (hidden, not "off") from a server with no such route', async () => {
    const on = { privacyPrefs: async () => ({ quotes: true, live_names: false }) };
    expect(await privacy.loadPrivacyPrefs(on)).toEqual({ quotes: true, live_names: false });
    const old = { privacyPrefs: async () => Promise.reject(new ApiError(404, 'Not Found')) };
    expect(await privacy.loadPrivacyPrefs(old)).toBeNull();
    const down = { privacyPrefs: async () => Promise.reject(new ApiError(503, 'Service Unavailable')) };
    await expect(privacy.loadPrivacyPrefs(down)).rejects.toBeInstanceOf(ApiError);
  });

  test('quotes off calls setPrivacyPrefs({quotes: false}) and shows the deleted count', async () => {
    const { api, sent } = fakeApi(() => ({ quotes: false, live_names: true, quotes_deleted: 2 }));
    let forgot = 0;
    let quotesForgot = 0;
    const out = await privacy.setPrivacySwitch(
      api,
      { quotes: true, live_names: true },
      'quotes',
      false,
      async () => {
        forgot += 1;
      },
      async () => {
        quotesForgot += 1;
      },
    );
    expect(sent).toEqual([{ quotes: false }]);
    expect(out).toEqual({ prefs: { quotes: false, live_names: true }, message: 'Quotes off. 2 quotes deleted.', ok: true });
    // The phone's cached file names are untouched...
    expect(forgot).toBe(0);
    // ...and its saved copy of the builder profile is rewritten without them (FOUND IN THE
    // ADVERSARIAL REVIEW, 2026-09-13: an older build saved them there, and off never cleared it).
    expect(quotesForgot).toBe(1);
  });

  test('the deleted count is said as the server said it: one, none, or not at all', () => {
    expect(privacy.toggledLine('quotes', false, { quotes_deleted: 1 })).toBe('Quotes off. 1 quote deleted.');
    expect(privacy.toggledLine('quotes', false, { quotes_deleted: 0 })).toBe('Quotes off. None were stored, so there was nothing to delete.');
    // An older server that omits the count did not delete zero.
    expect(privacy.toggledLine('quotes', false, {})).toBe('Quotes off. The server deletes any it held.');
    expect(privacy.toggledLine('quotes', false, null)).toBe('Quotes off. The server deletes any it held.');
  });

  test('quotes on says the machine half of the double opt in', async () => {
    const { api, sent } = fakeApi(() => ({ quotes: true, live_names: false }));
    let quotesForgot = 0;
    const out = await privacy.setPrivacySwitch(api, OFF, 'quotes', true, async () => 0, async () => {
      quotesForgot += 1;
    });
    expect(quotesForgot).toBe(0);
    expect(sent).toEqual([{ quotes: true }]);
    expect(out.prefs).toEqual({ quotes: true, live_names: false });
    expect(out.message).toContain(privacy.QUOTES_MACHINE_COMMAND);
  });

  test('file names off sends only live_names and clears the names this phone cached', async () => {
    const { api, sent } = fakeApi(() => ({ quotes: true, live_names: false }));
    let forgot = 0;
    const out = await privacy.setPrivacySwitch(
      api,
      { quotes: true, live_names: true },
      'live_names',
      false,
      async () => {
        forgot += 1;
        return 3;
      },
      async () => {
        throw new Error('file names off must not touch the saved quotes');
      },
    );
    expect(sent).toEqual([{ live_names: false }]);
    expect(forgot).toBe(1);
    expect(out.prefs).toEqual({ quotes: true, live_names: false });
    expect(out.message).toBe('File names off, and deleted from the server and from this phone.');
  });

  test('a switch the server refused does not move, and the line says why', async () => {
    const { api } = fakeApi(() => new ApiError(503, 'Builda is not reachable right now.'));
    let forgot = 0;
    const out = await privacy.setPrivacySwitch(
      api,
      { quotes: true, live_names: true },
      'live_names',
      false,
      async () => {
        forgot += 1;
      },
      async () => {
        forgot += 1;
      },
    );
    expect(out.ok).toBe(false);
    expect(out.prefs).toEqual({ quotes: true, live_names: true });
    expect(out.message).toBe('Nothing changed: Builda is not reachable right now.');
    // Nothing was deleted on the server, so nothing is cleared here either.
    expect(forgot).toBe(0);
  });

  test('the rows say what each switch sends, and that turning it off deletes it', () => {
    for (const detail of [privacy.QUOTES_DETAIL, privacy.FILE_NAMES_DETAIL]) {
      expect(detail).toContain('Only you can see them.');
      expect(detail).toContain('Turning this off deletes them.');
    }
    expect(privacy.QUOTES_TITLE).toBe('Quote my prompts on my cards');
    expect(privacy.FILE_NAMES_TITLE).toBe('File names');
    expect(privacy.LOCK_SCREEN_TITLE).toBe('Show details on Lock Screen');
    // what the card with details off actually draws (surface.withoutDetails), and no less
    expect(privacy.lockScreenDetail(false)).toContain('only Builda, how many sessions are running');
    expect(privacy.lockScreenDetail(false)).toContain('no repository and nothing about what it is doing');
  });

  test('no dash in anything the section says', () => {
    const said = [
      privacy.QUOTES_TITLE, privacy.QUOTES_DETAIL, privacy.QUOTES_MACHINE_HINT, privacy.FILE_NAMES_TITLE, privacy.FILE_NAMES_DETAIL,
      privacy.LOCK_SCREEN_TITLE, privacy.lockScreenDetail(true), privacy.lockScreenDetail(false),
      privacy.toggledLine('quotes', true), privacy.toggledLine('quotes', false, { quotes_deleted: 3 }),
      privacy.toggledLine('live_names', true), privacy.toggledLine('live_names', false),
    ];
    for (const s of said) expect({ s, dash: hasDash(s) }).toEqual({ s, dash: false });
  });

  test('Settings drives all three switches from this module and the cache', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'app', 'settings.tsx'), 'utf8');
    for (const name of ['setPrivacySwitch', 'loadPrivacyPrefs', 'forgetLiveNames', 'forgetCachedQuotes', 'setLockScreenDetails', 'getLockScreenDetails']) {
      expect({ name, used: src.includes(name) }).toEqual({ name, used: true });
    }
    // The old sentence said file names never leave the machine; with the opt in that is false.
    expect(src).not.toContain('file names never leave your machine');
  });
});
