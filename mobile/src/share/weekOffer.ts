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

/** The Monday checked this launch, so a quiet last week is not fetched for every minute. */
let checked: string | null = null;

/** True when it put the card up, so the milestone card waits for the next pass. */
export async function offerLastWeek(animal: Animal, nowMs: number): Promise<boolean> {
  const monday = lastWeekOf([], nowMs).days[0]!.date;
  if (checked === monday) return false;
  const offered = await cache.getKv(WEEK_OFFERED_KEY).catch(() => null);
  if (offered === monday || !lastWeekIsNews(nowMs)) {
    // Already offered, or past Wednesday: nothing to fetch.
    checked = monday;
    return false;
  }
  checked = monday;
  let graph: readonly { date: string; active_seconds: number }[];
  try {
    const fresh = await api.profile();
    await cache.putProfile(fresh);
    graph = fresh.graph;
  } catch {
    // No answer: try again on the next launch rather than offer a week read from an old profile.
    checked = null;
    return false;
  }
  const week = weekToOffer(graph, nowMs, offered);
  if (!week) return false;
  await cache.setKv(WEEK_OFFERED_KEY, monday);
  // Never both: Monday's notification already said it (`push/weekly`).
  if (await weekCardDelivered()) return false;
  // A desktop with its window hidden hears it from the system instead (`desktopNotice`).
  if (desktopNoticeInstead(WEEK_CARD_NOTIFICATION.title, weekOfferLine(week), 'builder://sessions?card=last-week')) return true;
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
