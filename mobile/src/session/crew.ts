/**
 * WHICH CREATURE A SESSION WEARS on the session screens, and so its hue: every session is its own
 * builder (design/tokens.json `spectrum.crew`, DESIGN-V2 2.2). The rule is mission control's and
 * lives once, in `live/crew.ts` (`crewCreatures`: the ring creature FNV-1a over the client
 * session id lands on, stepped forward past any creature a session running at its start already
 * wears, never Bit). A rule copied into a second module is a definition that will drift, so this
 * file only asks it, and says which hues a session's chapters wear.
 *
 * The screens ask through `live/crew.crewFor` (re-exported by `LiveSessions`), which remembers
 * every creature this process has drawn, so a session keeps its colour on the Now grid, in the
 * Sessions list, on its live bar, on its page, on the Lock Screen and on the widget alike.
 * `crewOf` is the same answer without the memory, for the tests and for a page opened before any
 * list was drawn.
 *
 * Pure: no React Native, so `bun test` holds it.
 */

import type { SessionDetail } from '../data/api';
import { crewCreatures, crewHashed, fnv1a32 } from '../live/crew';
import type { Animal } from '../pixel/animals';
import { creatureHue, type CreatureId, type HueName } from '../theme';

export { fnv1a32 };

export type CrewCreature = Animal;

/** The creature a session's id hashes onto, before any step (the sample, a session alone). */
export function crewBase(clientSessionId: string): CrewCreature {
  return crewHashed(clientSessionId);
}

/** One session's creature among the sessions around it (the saved list), itself included. */
export function crewOf(session: SessionDetail, around: readonly SessionDetail[]): CrewCreature {
  const all = around.some((s) => s.id === session.id) ? around : [...around, session];
  return crewCreatures(all).get(session.id) ?? crewBase(session.client_session_id || session.id);
}

/**
 * The hues a session's page wears: the hero in the session's own; burn forensics in ember (the
 * burn, as on the analysis page) unless the session is ember itself, then coral; tokens call by
 * call in tide (the re-read's own colour, the bars' biggest part) unless the session is tide, then
 * cobalt; the model's reading in iris unless the session is iris, then heather. Neighbouring
 * chapters never share a family, so the page reads as a sequence of colour worlds.
 */
export interface SessionHues {
  session: HueName;
  burn: HueName;
  calls: HueName;
  reading: HueName;
}

export function sessionHues(creature: CrewCreature): SessionHues {
  const session = creatureHue(creature as CreatureId).name;
  return {
    session,
    burn: session === 'ember' ? 'coral' : 'ember',
    calls: session === 'tide' ? 'cobalt' : 'tide',
    reading: session === 'iris' ? 'heather' : 'iris',
  };
}
