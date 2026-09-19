/**
 * On a desktop with its window hidden, an offer goes to the system's notifications instead of a
 * toast nobody sees (`share/desktopNotice.ts`). The window and document are stubbed per case and
 * taken away after, because globals are shared by every test file in the process.
 */
import { afterEach, describe, expect, test } from 'bun:test';

import { desktopNoticeInstead } from '../src/share/desktopNotice';

const g = globalThis as unknown as { window?: unknown; document?: unknown };
let sent: { title: string; body?: string; url?: string }[] = [];

function desktop(kind: 'main' | 'island', visible: boolean, focused: boolean) {
  sent = [];
  g.window = { builda: { version: 1, window: kind, notify: (n: { title: string }) => sent.push(n) } };
  g.document = { visibilityState: visible ? 'visible' : 'hidden', hasFocus: () => focused };
}

afterEach(() => {
  delete g.window;
  delete g.document;
});

describe('a desktop offer, said where someone will see it', () => {
  test('the window hidden or behind another: the system says it, with the link', () => {
    desktop('main', false, false);
    expect(desktopNoticeInstead('T', 'B', 'builder://sessions?card=last-week')).toBe(true);
    expect(sent).toEqual([{ title: 'T', body: 'B', url: 'builder://sessions?card=last-week' }]);
    desktop('main', true, false);
    expect(desktopNoticeInstead('T', 'B', 'u')).toBe(true);
  });

  test('the window in front: the page says it, and the system says nothing', () => {
    desktop('main', true, true);
    expect(desktopNoticeInstead('T', 'B', 'u')).toBe(false);
    expect(sent).toHaveLength(0);
  });

  test('the island window and a phone never send one', () => {
    desktop('island', false, false);
    expect(desktopNoticeInstead('T', 'B', 'u')).toBe(false);
    delete g.window;
    delete g.document;
    expect(desktopNoticeInstead('T', 'B', 'u')).toBe(false);
  });
});
