import { NAME_MAX, nameProblem, normalizeName } from '../nav/rules';
import { displayNameProblem } from '../social/account';

/**
 * The name step's rules. Pure, so the tests hold them.
 *
 * Onboarding asks for 1 to 24 characters (`NAME_MAX` in `src/nav/rules.ts`); the server
 * allows 40 (`MAX_DISPLAY_NAME` in `src/social/account.ts`), and a name is only usable when
 * it passes both, so a name this step accepts can never be refused by `PATCH /v1/users/me`.
 */

export { NAME_MAX, normalizeName } from '../nav/rules';

/** Continue is enabled exactly when this is true. Cheap enough for every keystroke. */
export function nameUsable(raw: string): boolean {
  return nameProblem(raw) === null && displayNameProblem(normalizeName(raw)) === null;
}

export type NameVerdict =
  | { ok: true; name: string }
  | { ok: false; problem: 'empty' | 'too_long'; message: string };

export const NAME_MESSAGES = {
  empty: 'Type the name you go by first.',
  too_long: `That is over ${NAME_MAX} characters. A shorter one fits the headline.`,
} as const;

/**
 * What happens when the person submits (Return or Continue). Validation lives here and only
 * here: nothing complains while they are still typing.
 */
export function submitName(raw: string): NameVerdict {
  const problem = nameProblem(raw);
  if (problem) return { ok: false, problem, message: NAME_MESSAGES[problem] };
  const name = normalizeName(raw);
  if (displayNameProblem(name)) return { ok: false, problem: 'too_long', message: NAME_MESSAGES.too_long };
  return { ok: true, name };
}

/**
 * The name to open the field with, so one tap on Continue can keep it.
 *
 * What they typed here before comes first (they are walking back through the flow), then the
 * account's display name, then the name Sign in with Apple handed over. A candidate that would
 * not pass is skipped rather than prefilled into a disabled button.
 */
export function prefillName(src: { local?: string | null; server?: string | null; apple?: string | null }): string {
  for (const candidate of [src.local, src.server, src.apple]) {
    if (typeof candidate !== 'string') continue;
    if (nameUsable(candidate)) return normalizeName(candidate);
  }
  return '';
}

/** The parts of `AppleAuthenticationFullName` this reads. */
export interface AppleName {
  givenName?: string | null;
  familyName?: string | null;
  nickname?: string | null;
}

/**
 * What to call someone from the name Apple handed over: the nickname if they set one, else
 * the given name (the step asks what to CALL them, not for their legal name), else the
 * family name. Null when Apple sent nothing, which is every authorisation after the first.
 */
export function appleCallName(name: AppleName | null | undefined): string | null {
  if (!name) return null;
  for (const part of [name.nickname, name.givenName, name.familyName]) {
    const n = typeof part === 'string' ? normalizeName(part) : '';
    if (n.length > 0) return n;
  }
  return null;
}
