/**
 * Reels as context: which of the posts you saved are about what a session did. PURE, so
 * `__tests__/dropsContext.test.ts` holds it.
 *
 * WHY THIS AND NOT "FEED A REEL TO CLAUDE". The owner's own doubt (brief-motion.md): using reels
 * as context for builds is interesting and too niche on its own. It stops being niche in the one
 * place it explains YOUR work: a session's page can say "you saved a reel about this", and when
 * the session's own analysis says what to try next, the reel you already kept about exactly that
 * is the most useful thing on the page. Nothing is sent anywhere and nothing is generated: it is
 * the board's own TF-IDF (`cluster.ts`) run over the drops and one more document, the session's
 * analysis.
 *
 * THE EVIDENCE RULE, as everywhere in drops: a match carries the words the two share, and a
 * match with none is not a match. A reel "about productivity" beside a session "about
 * productivity" says so in those words; the phone never claims a link it cannot show.
 */
import type { SessionAnalysis } from '../generated/analysis';
import { cosine, round9, surfaces, vectors, wordFor, type Clusterable } from './cluster';
import type { DropRow } from './types';

/**
 * Below this a drop is not about the session. MEASURED on this machine's real board (11 drops,
 * 2026-09-19). Four real session analyses (`python -m analysis run`, sessions on this repository,
 * none about anything in the drops) scored at most 0.039 against any drop, and every word they
 * shared was a coincidence ("minutes", "work", "code"). Three sessions written to be about what
 * three drops are about scored 0.225 to 0.357, sharing "shortcuts, productivity" and "skills,
 * claude". 0.12 is three times the highest coincidence and about half the weakest real match.
 * `mobile/scripts/drops_context.ts` reruns it against a board and a history.
 */
export const CONTEXT_FLOOR = 0.12;
/** At most this many reels on a session's page: a shelf, not a feed. */
export const CONTEXT_MAX = 3;
/** Kinds that can be about a session. A recipe never is, and an unread drop has no words yet. */
const BUILDER_KINDS = new Set(['skill', 'technique', 'project', 'tool']);

export interface Related {
  drop: DropRow;
  score: number;
  /** The words the reel and the session share, most telling first, as people wrote them. */
  shared: string[];
}

/** The session as one more document on the board: what it was, what happened, what to try. */
export function sessionDoc(a: Pick<SessionAnalysis, 'headline' | 'summary' | 'highlights' | 'growth_edge' | 'tags'>): Clusterable {
  return {
    title: a.headline,
    summary: [a.summary, ...a.highlights, ...a.growth_edge].join(' '),
    tags: a.tags.map((t) => t.replace(/-/g, ' ')),
  };
}

export function relatedDrops(analysis: Pick<SessionAnalysis, 'headline' | 'summary' | 'highlights' | 'growth_edge' | 'tags'> | null | undefined, drops: readonly DropRow[], floor = CONTEXT_FLOOR): Related[] {
  if (!analysis) return [];
  const pool = drops.filter((d) => d.status === 'planned' && d.kind && BUILDER_KINDS.has(d.kind) && !d.archived_at);
  if (pool.length === 0) return [];
  const docs: Clusterable[] = [
    ...pool.map((d) => ({ kind: d.kind, title: d.title, summary: d.summary, tags: d.resolution?.plan?.tags ?? [] })),
    sessionDoc(analysis),
  ];
  const { vecs } = vectors(docs);
  const surf = surfaces(docs);
  const me = vecs[vecs.length - 1]!;
  const out: Related[] = [];
  pool.forEach((d, i) => {
    const v = vecs[i]!;
    const score = round9(cosine(me, v));
    if (score < floor) return;
    const shared = [...v.keys()]
      .filter((t) => me.has(t))
      .sort((a, b) => me.get(b)! * v.get(b)! - me.get(a)! * v.get(a)! || a.localeCompare(b))
      .slice(0, 3)
      .map((t) => wordFor(t, surf));
    if (shared.length === 0) return;
    out.push({ drop: d, score, shared });
  });
  return out.sort((a, b) => b.score - a.score || a.drop.id.localeCompare(b.drop.id)).slice(0, CONTEXT_MAX);
}

/** The line under a related reel: "you both talk about vs code, shortcuts". */
export function sharedLine(r: Related): string {
  return `you both talk about ${r.shared.join(', ')}`;
}
