/**
 * The phone's own drop banners, for when it is the one that noticed.
 *
 * `src/push/local.ts` is the same arrangement for sessions and says the important part: these are
 * LOCAL, so they fire only while the app is running. A drop read while the phone is in a pocket
 * needs the server's push (`server/builder/drops_notify.py`), which sends the same words.
 *
 * NEVER BOTH is handled by the identifier: it is the server's collapse id, so a local banner and
 * a pushed one for the same drop replace each other rather than stacking. The permission is never
 * asked for here (onboarding's notify step asks, once): without it these do nothing.
 */
import * as Notifications from 'expo-notifications';

import { collapseId, composeFinished, composeRead, dropUrl, KIND_DROP_DONE, KIND_DROP_READ } from './notifyCopy';
import type { DropRow, MoveRow } from './types';

async function post(dropId: string, kind: string, title: string, body: string): Promise<void> {
  try {
    const perms = await Notifications.getPermissionsAsync();
    if (!perms.granted) return;
    await Notifications.scheduleNotificationAsync({
      identifier: collapseId(dropId),
      content: {
        title,
        body,
        data: { kind, drop_id: dropId, url: dropUrl(dropId) },
        sound: 'default',
        interruptionLevel: 'active',
      },
      trigger: null,
    });
  } catch {
    // A banner nobody could post is a banner nobody sees; the board already shows the change.
  }
}

export function tellThemItWasRead(drop: DropRow, moves: number): Promise<void> {
  const { title, body } = composeRead({
    title: drop.title,
    kind: drop.kind,
    refusal: drop.refusal,
    moves,
  });
  return post(drop.id, KIND_DROP_READ, title, body);
}

export function tellThemItFinished(move: MoveRow): Promise<void> {
  const { title, body } = composeFinished({
    title: move.title,
    outcome: move.outcome,
    ok: move.status === 'done',
  });
  return post(move.drop_id, KIND_DROP_DONE, title, body);
}
