import { ANIMAL_LABELS, type Animal } from '../pixel/animals';

/**
 * Every word onboarding shows, in one place, so `__tests__/onboardingCopy.test.ts` can hold
 * the house rules on all of it at once: no dashes (the brief), captions and labels in lower
 * case, and one label per intent ("Continue" on every step that moves forward, never also
 * "Next" or "Get started").
 */

/** The one forward label. */
export const CONTINUE = 'Continue';
/**
 * The one skip label, on connect and on the notification step alike: a text button of the
 * same prominence as the action beside it. ("Later" on one step and "Not now" on the next
 * were two labels for one intent.)
 */
export const NOT_NOW = 'Not now';
/** The commitment at the end, with a typographic apostrophe. */
export const THATS_ME = 'That\u2019s me';
export const BACK = 'Back';

export const HELLO = {
  headline: 'Your build sessions, read back to you.',
  body: 'Builda reads what your coding agents write and tells you how every session went.',
} as const;

export const NAME = {
  label: 'what should we call you',
  placeholder: 'Your name',
  note: 'It goes on your profile and on anything you share.',
} as const;

export const CREATURE = {
  label: 'pick your creature',
  suggested: 'picked for how you build',
  previous: 'Previous creature',
  next: 'Next creature',
} as const;

/**
 * The same picker outside onboarding (`app/icon.tsx`, "Your creature"). The action keeps one
 * label while the stage moves under it: a label that renamed itself on every tick of a drag
 * was the only thing on the screen that jumped.
 */
export const ICON = {
  body: 'It goes on your profile and on anything you share. You can change it whenever.',
  choose: 'Use this creature',
} as const;

/** "Vedant, the fox", or "The fox" when there is no name to put in front of it. */
export function creatureCaption(name: string | null | undefined, animal: Animal): string {
  const label = ANIMAL_LABELS[animal];
  const n = typeof name === 'string' ? name.trim() : '';
  return n ? `${n}, the ${label}` : `The ${label}`;
}

/** "6 of 8". */
export function positionLine(position: number, total: number): string {
  return `${position} of ${total}`;
}

export const TOOLS = {
  label: 'what you build with',
  headline: 'Pick your tools.',
  // Two sentences on two lines: wrapped as one paragraph, "Pick" hung alone off the end of
  // the first line.
  unknown: 'Builda reads the sessions these tools write.\nPick the ones you use.',
} as const;

/**
 * The line under the tools headline once the account's sessions are counted, naming the
 * tools they came from: the tile's own status line has room for a word, the sentence has room
 * for the facts. `tools` are display names in picker order; with none it says what it can.
 */
export function toolsFound(total: number, partial: boolean, tools: readonly string[] = []): string {
  const n = partial ? `more than ${grouped(total)}` : grouped(total);
  const sessions = total === 1 && !partial ? '1 session' : `${n} sessions`;
  if (tools.length === 1) return `Builda found ${sessions} from ${tools[0]} on your account and picked it.`;
  if (tools.length > 1) return `Builda found ${sessions} on your account, from ${listOf(tools)}, and picked them.`;
  return `Builda found ${sessions} on your account and picked the tools ${total === 1 && !partial ? 'it came' : 'they came'} from.`;
}

/**
 * The connect step says what its action is in each state: signed out the only action is
 * signing in, so that is the headline; signed in with sessions already arriving there is
 * nothing to connect; signed in with none, pair a Mac or copy the hook setup.
 */
export const CONNECT = {
  label: 'your sessions',
  signedOutHeadline: 'Sign in to connect.',
  signedOut: 'Your sessions reach this phone through your account. Once you are in, pair your Mac or send sessions from Claude Code.',
  headline: 'Connect your Mac.',
  signedInBefore: 'Run ',
  command: 'builder pair',
  signedInAfter: ' on your Mac, then type the code it shows or scan its QR code with the Camera app.',
  arrivingHeadline: 'Sessions are arriving.',
  pairAnother: 'Pair another Mac',
  codeLabel: 'pairing code',
  codePlaceholder: 'XXXX-XXXX',
  pair: 'Pair',
  pairing: 'Pairing',
  badCode: 'That is not a Builda pairing code. It is eight letters and digits, the way builder pair shows it.',
  rejected: 'That code was not recognised, or it expired. Run builder pair again.',
  hookTitle: 'Or send sessions from Claude Code',
  hookBody: 'One paste in a terminal on the machine that runs it, and its sessions come here with nothing installed.',
  hookCopy: 'Copy the setup',
  hookCopying: 'Making a key',
  hookCopied: 'Copied. Paste it into a terminal on that machine.',
  signInFailed: 'Sign in did not finish. Try again, or do it later from Settings.',
  clipboardFailed: 'The clipboard would not take it. Try again.',
  keyFailed: 'Could not make a key for the setup. Try again.',
} as const;

/** "77 sessions have reached your account.", the body of the connected state. */
export function sessionsArrived(total: number, partial: boolean): string {
  if (total === 1 && !partial) return '1 session has reached your account. Everything you build from here on arrives the same way.';
  const n = partial ? `More than ${grouped(total)}` : grouped(total);
  return `${n} sessions have reached your account. Everything you build from here on arrives the same way.`;
}

export function pairedWith(label: string): string {
  const l = label.trim();
  return l ? `Paired with ${l}.` : 'Paired.';
}

export const NOTIFY = {
  label: 'stay in the loop',
  headline: 'Know when to look.',
  rows: [
    { title: 'A session finishes', body: 'The recap is ready the moment you stop.' },
    { title: 'An agent needs you', body: 'A tap when a run stops to ask you.' },
    { title: 'Live on your lock screen', body: 'A running session, without unlocking.' },
  ],
} as const;

/**
 * The finale: "this is you" over "Vedant, the fox", answered by "That's me". Said the same
 * way whether or not an account is connected yet, because it is true either way ("all set"
 * was not, for someone who had just said Not now to signing in).
 */
export const DONE = {
  label: 'this is you',
} as const;

/** Under the caption on the last screen: the tools, as a sentence. Empty with no tools. */
export function doneCaption(tools: readonly string[]): string {
  if (tools.length === 0) return '';
  return `Building with ${listOf(tools)}.`;
}

/** "A", "A and B", "A, B and C", "A, B, C and 2 more". */
export function listOf(items: readonly string[]): string {
  const xs = items.filter((s) => s.trim().length > 0);
  if (xs.length === 0) return '';
  if (xs.length === 1) return xs[0]!;
  if (xs.length <= 3) return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
  return `${xs.slice(0, 3).join(', ')} and ${xs.length - 3} more`;
}

/** 1234 as "1,234", the same on every device (no locale). */
function grouped(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Every static string above, for the copy test. */
export const ALL_STATIC: readonly string[] = [
  CONTINUE,
  NOT_NOW,
  THATS_ME,
  BACK,
  ...Object.values(HELLO),
  ...Object.values(NAME),
  ...Object.values(CREATURE),
  ...Object.values(ICON),
  ...Object.values(TOOLS),
  ...Object.values(CONNECT),
  NOTIFY.label,
  NOTIFY.headline,
  ...NOTIFY.rows.flatMap((r) => [r.title, r.body]),
  ...Object.values(DONE),
];
