/**
 * Last week's card, made by itself.
 *
 * The brief asks what else Builda should generate without being asked, beside the demos. The
 * week is the obvious one: Strava's weekly summary arrives on its own, and a week of building is
 * the thing people post on a Monday. So on the first time the app is in front in a new week
 * (Monday to Wednesday, while last week is still news), if last week had any finished session,
 * the island says the card is made and a tap opens it in the share preview. Once per week: the
 * Monday it was offered for is kept in the kv table, so it never asks twice.
 *
 * The figure is the profile graph's, never a sum of the list (`session/week.ts`), so the card
 * agrees with the Sessions band; the profile is fetched fresh for this, once, because the saved
 * one may be from before Sunday's sessions finished.
 */
import type { SessionDetail } from '../data/api';
import * as cache from '../data/cache';
import { api } from '../data/client';
import { noticeWouldWait } from '../island/model';
import { island } from '../island/store';
import { WEEK_CARD_NOTIFICATION } from '../push/localCopy';
import { weekCardDelivered } from '../push/weekly';
import type { Animal } from '../pixel/animals';
import { lastWeekIsNews, lastWeekOf, weekOfferLine, weekRows, weekToOffer, WEEK_OFFERED_KEY, type WeekModel } from '../session/week';
import { creatureHue } from '../theme';
import { desktopNoticeInstead } from './desktopNotice';
import { showWeekShare } from './WeekShare';

/** Long enough to read the line and reach for it; a plain notice holds 2.6 s. */
export const WEEK_OFFER_HOLD_MS = 8000;
/** Sessions read for the card's rows, as Sessions' own "Share this week" reads them. */
const WEEK_READ = 200;

/**
 * The Monday handled this launch, claimed BEFORE the first await: the root poll and Now's own poll
 * can run a pass at the same moment, and two passes that both got past the check would say it twice.
 */
let checked: string | null = null;
/** A week found and not yet said, because the island was busy with something that outranks it. */
let pending: WeekModel | null = null;
/** The Monday counted as offered, read at the moment of saying: a check already waiting on the network stops there. */
let offeredFor: string | null = null;

/**
 * The week counts as offered from this moment: a tap on Monday's notification (Sessions opens the
 * card) calls it at once, before any profile loads, so a pass running at the same time says
 * nothing, including one already waiting for the profile when the tap came (FOUND IN REVIEW).
 */
export function markWeekOffered(monday: string): void {
  checked = monday;
  offeredFor = monday;
  pending = null;
  void cache.setKv(WEEK_OFFERED_KEY, monday).catch(() => undefined);
}

/**
 * Forget this launch's state: signing out and deleting the account call it, or a week held for one
 * account would be said to the next with the first one's hours (FOUND IN REVIEW).
 */
export function resetWeekOffer(): void {
  checked = null;
  pending = null;
  offeredFor = null;
}

/** True when it put the card up, so the milestone card waits for the next pass. */
export async function offerLastWeek(animal: Animal, nowMs: number): Promise<boolean> {
  const monday = lastWeekOf([], nowMs).days[0]!.date;
  if (pending) {
    // Held only while it is still news: a week held on Wednesday night is not said on Friday.
    if (pending.days[0]!.date === monday && lastWeekIsNews(nowMs)) return say(pending, monday, animal);
    pending = null;
  }
  if (checked === monday) return false;
  checked = monday;
  const offered = await cache.getKv(WEEK_OFFERED_KEY).catch(() => null);
  // Already offered, or past Wednesday: nothing to fetch.
  if (offered === monday || !lastWeekIsNews(nowMs)) return false;
  let graph: readonly { date: string; active_seconds: number }[];
  try {
    const fresh = await api.profile();
    await cache.putProfile(fresh);
    graph = fresh.graph;
  } catch {
    // No answer: try again on the next pass rather than offer a week read from an old profile.
    checked = null;
    return false;
  }
  const week = weekToOffer(graph, nowMs, offered);
  if (!week) return false;
  // Never both: Monday's notification already said it (`push/weekly`).
  if (await weekCardDelivered()) {
    markWeekOffered(monday);
    return false;
  }
  return say(week, monday, animal);
}

/** Say it where it will be seen, and only then count it as said. */
async function say(week: WeekModel, monday: string, animal: Animal): Promise<boolean> {
  if (offeredFor === monday) return false;
  // A desktop whose window is behind another app hears it from the system (`desktopNotice`).
  if (desktopNoticeInstead(WEEK_CARD_NOTIFICATION.title, weekOfferLine(week), 'builder://sessions?card=last-week')) {
    markWeekOffered(monday);
    return true;
  }
  if (noticeWouldWait(island.visible())) {
    pending = week;
    return false;
  }
  markWeekOffered(monday);
  const ink = creatureHue(animal).ink;
  const id = `week:${monday}`;
  island.post(
    {
      kind: 'notice',
      id,
      text: weekOfferLine(week),
      state: 'done',
      animal,
      ink,
      action: () => {
        island.clear(id);
        void openWeek(week, animal, ink);
      },
    },
    WEEK_OFFER_HOLD_MS,
  );
  return true;
}

async function openWeek(week: WeekModel, animal: Animal, ink: string): Promise<void> {
  const all = await cache.listSessions(WEEK_READ).catch((): SessionDetail[] => []);
  showWeekShare(week, weekRows(all, week), { animal, ink });
}
