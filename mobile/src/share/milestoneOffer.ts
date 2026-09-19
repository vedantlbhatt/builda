/**
 * An hours milestone's card, offered on the island once (`milestones.ts` holds the rules). Read
 * from the profile the root poll already has; nothing is fetched for it.
 */
import type { Profile } from '../data/api';
import * as cache from '../data/cache';
import { island } from '../island/store';
import type { Animal } from '../pixel/animals';
import { creatureHue } from '../theme';
import { milestoneLine, milestoneStep, MILESTONE_KEY } from './milestones';
import { showMilestoneShare } from './MilestoneShare';
import { WEEK_OFFER_HOLD_MS } from './weekOffer';

export async function offerMilestone(profile: Profile | null, animal: Animal): Promise<boolean> {
  if (!profile?.totals) return false;
  const saved = await cache.getKv(MILESTONE_KEY).catch(() => null);
  const remembered = saved === null ? null : Number(saved);
  const step = milestoneStep(profile.totals.active_seconds, remembered !== null && Number.isFinite(remembered) ? remembered : null);
  if (step.kind === 'none') return false;
  await cache.setKv(MILESTONE_KEY, String(step.hours));
  if (step.kind === 'remember') return false;
  const ink = creatureHue(animal).ink;
  const first = profile.projects.reduce<string | null>((a, p) => (a === null || p.first_at < a ? p.first_at : a), null);
  const id = `milestone:${step.hours}`;
  island.post(
    {
      kind: 'notice',
      id,
      text: milestoneLine(step.hours),
      state: 'done',
      animal,
      ink,
      action: () => {
        island.clear(id);
        showMilestoneShare(step.hours, profile.totals.sessions, first, { animal, ink });
      },
    },
    WEEK_OFFER_HOLD_MS,
  );
  return true;
}
