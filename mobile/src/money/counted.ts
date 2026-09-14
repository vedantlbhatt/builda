/**
 * Whether every priced session behind a money block had a git commit count: the one test both
 * the money Sankey (`flow.ts endingOf`, which then reads a project's dollars less its no commit
 * dollars as "ended with a commit") and the Money page's third chapter (which then says "of every
 * dollar" rather than "of the dollars on sessions with a commit count") rely on. Pure, no imports.
 *
 * `share_without_a_commit` is the no commit dollars over the dollars on sessions with a git
 * commit count (`analysis/profile.py`, `spend_without_a_commit_usd`), rounded to three places. When
 * it agrees with the no commit dollars over ALL the priced dollars, within that rounding and a cent
 * either side, the two denominators are the same dollars. It holds for every project today because
 * a project's sittings all have a resolved repository, and `analysis/corpus.py` hands every
 * resolved sitting to `profile.attribute_commits`, which stamps each with a git commit count.
 */
export function everyPricedSessionCounted(m: { usd?: number | null; usd_without_a_commit?: number | null; share_without_a_commit?: number | null }): boolean {
  const usd = m.usd;
  const quiet = m.usd_without_a_commit;
  const share = m.share_without_a_commit;
  if (typeof usd !== 'number' || !(usd > 0) || typeof quiet !== 'number') return false;
  if (typeof share !== 'number') return false;
  return Math.abs(Math.min(usd, Math.max(0, quiet)) / usd - share) <= 0.0005 + 0.01 / usd;
}
