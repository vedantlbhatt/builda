/**
 * The web twin of `localNotify.ts` (Metro picks this file for `platform === 'web'`; iOS keeps the
 * other). The same two banners with the same words (`notifyCopy.ts`), posted as the desktop
 * shell's native notification (`bridge.notify`), whose click opens the drop in the app window
 * through the same `builder://drops?open=` link the pushed banner carries. In a plain browser tab
 * there is no one to post to, and nothing is posted: the board already shows the change.
 */
import { desktopBridge } from '../desktop/bridge';
import { composeFinished, composeRead, dropUrl } from './notifyCopy';
import type { DropRow, MoveRow } from './types';

function post(dropId: string, title: string, body: string): Promise<void> {
  desktopBridge()?.notify({ title, body, url: dropUrl(dropId) });
  return Promise.resolve();
}

export function tellThemItWasRead(drop: DropRow, moves: number): Promise<void> {
  const { title, body } = composeRead({ title: drop.title, kind: drop.kind, refusal: drop.refusal, moves });
  return post(drop.id, title, body);
}

export function tellThemItFinished(move: MoveRow): Promise<void> {
  const { title, body } = composeFinished({ title: move.title, outcome: move.outcome, ok: move.status === 'done' });
  return post(move.drop_id, title, body);
}
