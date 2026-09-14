/**
 * Where the You pages keep things in the cache kv (`src/data/cache.ts`). Pure, so the tests can
 * hold the one shared key to the file that reads it too.
 *
 * `profile.` keys belong to the account and go with a sign out (`cache.clear()`); `device.` keys
 * belong to this phone and stay.
 */

/**
 * The builder profile, saved between launches so a cold start is not blank. The key the You tab
 * has always used, and the one onboarding reads the archetype from (`src/onboarding/keys.ts`
 * BUILDER_PROFILE_KEY); `__tests__/you.test.ts` holds the two equal.
 */
export const BUILDER_KEY = 'profile.builder.v1';

/** When it was saved, epoch milliseconds, for the stale line. */
export const BUILDER_SAVED_AT_KEY = 'profile.builder.savedAt.v1';

/**
 * The dollar mask. `device.`, not `profile.`: it is about who can see this phone's screen, so a
 * sign out and back in must not quietly show the figure again.
 */
export const MONEY_MASK_KEY = 'device.you.moneyMask.v1';

/** The archetype id whose reveal has played on this account, so a new account plays its own. */
export const REVEALED_KEY = 'profile.you.archetypeRevealed.v1';
