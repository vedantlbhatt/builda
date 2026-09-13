/**
 * A session's engineer voice title, written on the phone from ids.
 *
 * `analysis/vocab.py session_title` picks the first of eleven rules a sitting satisfies and
 * writes a line like "Shipped changes to three source files". The wire carries only the
 * rule's verb, its object and the numbers the line says (contract v4 `title_ids`), so no
 * file or directory name travels; this writes the line back, word for word, from those.
 *
 * Each (verb, object) pair can only be one the rules produce: a pair they never emit, or a
 * count a title needs and did not get, renders nothing rather than a line the engine would
 * not have written. The exact lines are pinned in `__tests__/sessionCopy.test.ts` against
 * the engine's own tests (`analysis/tests/test_vocab.py`).
 */

import type { SessionTitleIds, TitleObject, TitleVerb } from '../generated/contract';
import { isRole, ROLE_NOUN, type Role, spoken } from './plain';

/** `vocab._noun`: `plain.ROLE_NOUN` with the count spoken, "a test file", "three test files". */
function noun(role: Role, k: number): string {
  const [one, many] = ROLE_NOUN[role];
  return k === 1 ? one : many.replace('{n}', spoken(k));
}

function whole(x: number | null | undefined): x is number {
  return typeof x === 'number' && Number.isInteger(x) && x >= 1;
}

/**
 * The title, or null when these ids are not a title the engine writes. A refusal (`reason`
 * set, no verb: `vocab.TITLE_REFUSALS`) and `null` input (a producer that does not compute
 * titles) are null too, and the caller falls back to the harness's own title.
 */
export function renderTitle(ids: SessionTitleIds | null | undefined): string | null {
  if (!ids) return null;
  const { verb, object, n: k } = ids;
  const role = isRole(object) ? object : null;
  switch (verb as TitleVerb) {
    case 'debugged':
      return object === 'test_suite' ? 'Debugged a failing test suite' : null;
    case 'wired':
      return object === 'migration' && whole(k) ? `Wired ${noun('migration', k)}` : null;
    case 'refactored': {
      const modules = ids.modules;
      if (!role || !whole(k) || !whole(modules)) return null;
      const where = modules !== 1 ? `across ${spoken(modules)} modules` : 'in one module';
      return `Refactored ${spoken(k)} files ${where}`;
    }
    case 'shipped':
      if (!role || !whole(k)) return null;
      return `${k === 1 ? 'Shipped a change to' : 'Shipped changes to'} ${noun(role, k)}`;
    case 'committed':
      if (object !== 'commit' || !whole(k)) return null;
      return k === 1 ? 'Landed a commit' : `Landed ${spoken(k)} commits`;
    case 'tested':
      return object === 'test' && whole(k) ? `Built out ${noun('test', k)}` : null;
    case 'built':
      return role && whole(k) ? `Built out ${noun(role, k)}` : null;
    case 'explored':
      return role && whole(k) ? `Read through ${noun(role, k)}` : null;
    case 'worked_through':
      return object === 'failure' ? 'Worked through a stubborn failure' : null;
    case 'edited':
      return role && whole(k) ? `Edited ${noun(role, k)}` : null;
    case 'looked_around':
      return object === 'codebase' ? 'Looked around the codebase' : null;
    default:
      return null;
  }
}

/** Every object a title can be about, so a test can hold the pairs to the contract. */
export type { TitleObject, TitleVerb };
