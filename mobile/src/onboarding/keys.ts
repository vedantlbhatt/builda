/**
 * Where onboarding keeps what a person picked, in the cache kv (`src/data/cache.ts`). All of
 * it is `profile.`, so a sign out clears it with the rest of the account's data; the gate
 * itself is `device.` and survives (`src/nav/rules.ts`).
 */
export { LOCAL_NAME_KEY, NAME_PENDING_KEY, ONBOARDED_KEY } from '../nav/rules';

/** The chosen creature. Local: it is a preference, not a fact about the work. */
export const ANIMAL_KEY = 'profile.animal.v1';

/** The tools picked on the tools step: a JSON array of harness wire values. */
export const TOOLS_KEY = 'profile.tools.v1';

/**
 * The name Sign in with Apple handed over. Apple sends it only on the first authorisation,
 * so it is kept the moment it arrives; the name step prefills from it.
 */
export const APPLE_NAME_KEY = 'profile.appleName.v1';

/** The builder profile the You tab caches (`app/(tabs)/you.tsx`); read for the archetype. */
export const BUILDER_PROFILE_KEY = 'profile.builder.v1';
