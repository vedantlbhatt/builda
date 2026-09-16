/**
 * What a drop's banner says. PURE, and the SAME WORDS the server sends.
 *
 * Two senders, one set of words. The server pushes when your Mac reads a link while the phone is
 * in a pocket (`server/builder/drops_notify.py`); the phone posts a local one when it is open and
 * watching the board, which is the only one that works at all before an APNs key exists. Two
 * copies of a sentence is a sentence that will drift, so `__tests__/dropsNotify.test.ts` runs both
 * over the same table and fails on any difference, the way the strip and the clustering are held.
 *
 * `src/push/localCopy.ts` is the same arrangement for sessions, in the same direction: the phone
 * owns the words and `notify.py` matches them.
 */
import { DROPS_ENUMS, type DropKind, type DropRefusal } from '../generated/drops';

export const KIND_DROP_READ = 'drop_read';
export const KIND_DROP_DONE = 'drop_done';

/** One banner per drop, whichever of the two fired last. */
export function collapseId(dropId: string): string {
  return `drop:${dropId}`.slice(0, 63);
}

export function dropUrl(dropId: string): string {
  return `builder://drops?open=${dropId}`;
}

/** What a drop turned out to be, in the second person. */
export const WAS: Record<DropKind, string> = {
  skill: 'a skill',
  technique: 'a technique',
  project: 'something to build',
  tool: 'a tool',
  recipe: 'a recipe',
  unknown: 'nothing to act on',
};

export const REFUSED: Record<DropRefusal, string> = {
  url_unsupported: 'That link is not one Builda can read.',
  no_text: 'The platform published no words about it, so there was nothing to read.',
  private_or_gone: 'That post is private or has been taken down.',
  not_about_building: 'Readable, and there is nothing in it to build or cook.',
  planner_unavailable: 'Your Mac could not reach Claude Code.',
  planner_refused: 'What came back did not hold up, so none of it is being shown.',
};

/** (title, body) for a drop that has just been read. */
export function composeRead(d: {
  title?: string | null;
  kind?: string | null;
  refusal?: string | null;
  moves: number;
}): { title: string; body: string } {
  if (d.refusal) {
    return {
      title: 'Builda could not read that',
      body: REFUSED[d.refusal as DropRefusal] ?? 'Nothing came back.',
    };
  }
  const was = WAS[(d.kind ?? 'unknown') as DropKind] ?? 'nothing to act on';
  const head = d.title && d.title.trim() ? d.title.trim() : 'One drop';
  const capitalised = was.charAt(0).toUpperCase() + was.slice(1);
  if (d.moves <= 0) return { title: head, body: `${capitalised}. Nothing to do about it yet.` };
  const thing = d.moves === 1 ? 'thing you could do' : 'things you could do';
  return { title: head, body: `${capitalised}, and ${d.moves} ${thing}.` };
}

/** (title, body) for a move that has just finished. The body is the runner's own sentence. */
export function composeFinished(m: {
  title: string;
  outcome?: string | null;
  ok: boolean;
}): { title: string; body: string } {
  const head = m.title.trim() || (m.ok ? 'Done' : 'That did not finish');
  const said = (m.outcome ?? '').trim();
  const body = said || (m.ok ? 'Done.' : 'It did not finish. Open it to see how far it got.');
  return { title: head, body: trim(body, 150) };
}

/** Trim on a word, with an ellipsis. The same rule the server uses. */
export function trim(s: string, n: number): string {
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1).replace(/\s+$/, '');
  const space = cut.lastIndexOf(' ');
  const kept = space > Math.floor(n / 2) ? cut.slice(0, space) : cut;
  return kept.replace(/[\s,.;:]+$/, '') + '…';
}

/** Every code the wire can carry, so a test can walk them without importing twice. */
export const CATALOG = {
  kinds: DROPS_ENUMS.drop_kind,
  refusals: DROPS_ENUMS.drop_refusal,
} as const;
