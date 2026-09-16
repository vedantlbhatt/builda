/**
 * Every sentence the board says, rendered from a code.
 *
 * The wire carries enums (`spec/drops.v1.json`), never prose, for the reason the live wire does:
 * rewording a refusal is a client change and never a re upload, and a build that meets a code it
 * does not know renders nothing rather than a debug string. `__tests__/dropsCopy.test.ts` checks
 * that every value of every enum has a sentence here, so a code added to the spec fails a test
 * rather than appearing on somebody's phone as `not_about_building`.
 *
 * No dashes, like everywhere else (`src/copy/plain.ts` holds the one rule and the test scans).
 */
import { DROPS_ENUMS, type DropKind, type DropRefusal, type Effort, type MoveKind, type MoveRefusal, type MoveStatus, type MoveTarget, type Platform } from '../generated/drops';

/** Why there is nothing to do with this one. Said in the second person, without apology. */
export const REFUSAL: Record<DropRefusal, string> = {
  url_unsupported: 'That link is not one Builda can read.',
  no_text: 'The platform published no words about this post, so there was nothing to read.',
  private_or_gone: 'This post is private or has been taken down.',
  not_about_building: 'Readable, and there is nothing in it to build or cook.',
  planner_unavailable: 'Your Mac could not reach Claude Code, so nothing has read this yet.',
  planner_refused: 'What came back did not hold up, so none of it is being shown.',
};

/** What the card says while it waits. */
export const STATUS_LINE: Record<string, string> = {
  waiting: 'waiting for your Mac',
  resolving: 'reading it now',
  planned: '',
  refused: '',
  archived: 'archived',
};

export const KIND_WORD: Record<DropKind, string> = {
  skill: 'a skill',
  technique: 'a technique',
  project: 'something to build',
  tool: 'a tool',
  recipe: 'a recipe',
  unknown: 'unread',
};

/** The verb on a move's button. Imperative, and the same length wherever it can be. */
export const MOVE_VERB: Record<MoveKind, string> = {
  install: 'Install',
  apply: 'Apply it',
  scaffold: 'Start building',
  evaluate: 'Try it',
  card: 'Fill it in',
  keep: 'Keep it',
};

/** What a move is doing, in the present tense, for the row under its title. */
export const MOVE_STATUS_LINE: Record<MoveStatus, string> = {
  offered: '',
  queued: 'queued for your Mac',
  running: 'running now',
  done: 'done',
  failed: 'did not finish',
  declined: 'passed on',
};

export const MOVE_REFUSAL: Record<MoveRefusal, string> = {
  source_unverified: 'that link did not answer, so this opens it instead of installing it',
  evidence_not_found: 'nothing in the post backed this up',
  no_repo_match: 'no repository on your Mac matched the one you picked',
};

export const EFFORT_WORD: Record<Effort, string> = {
  minutes: 'minutes',
  an_hour: 'about an hour',
  a_session: 'a session',
};

/**
 * Where a move lands, in the second person.
 *
 * Said over the Start button, so it is the last thing read before work begins on somebody's
 * machine: `this_machine` is "on your Mac" and not "local", because the person is holding a
 * phone and the distinction they care about is whose computer this is.
 */
export const MOVE_TARGET_WORD: Record<MoveTarget, string> = {
  new_project: 'as a new project',
  existing_repo: 'in one of your repos',
  this_machine: 'on your Mac',
  none: 'onto this card',
};

export const PLATFORM_WORD: Record<Platform, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  youtube: 'YouTube',
  x: 'X',
  reddit: 'Reddit',
  threads: 'Threads',
  web: 'the web',
};

/**
 * How much there was to read, said as a fact and never as a judgement.
 *
 * A card that refuses has to say what it had, or the person cannot tell a closed platform from a
 * broken app. "24 characters of caption, no subtitles" is the whole difference.
 */
export function readLine(captionChars: number, transcriptChars: number): string {
  const caption =
    captionChars > 0 ? `${captionChars} characters of caption` : 'no caption';
  const subs =
    transcriptChars > 0 ? `${transcriptChars} of subtitles` : 'no published subtitles';
  return `${caption}, ${subs}`;
}

/** The catalog, so a test can walk every code without importing the generated module twice. */
export const CATALOG = {
  refusals: DROPS_ENUMS.drop_refusal,
  kinds: DROPS_ENUMS.drop_kind,
  moveKinds: DROPS_ENUMS.move_kind,
  moveStatuses: DROPS_ENUMS.move_status,
  moveRefusals: DROPS_ENUMS.move_refusal,
  efforts: DROPS_ENUMS.effort,
  platforms: DROPS_ENUMS.platform,
  dropStatuses: DROPS_ENUMS.drop_status,
  moveTargets: DROPS_ENUMS.move_target,
} as const;
