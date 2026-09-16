/**
 * The board's shape, on the phone. A line for line port of `drops/cluster.py`.
 *
 * WHY IT IS HERE AND NOT ON A SERVER. The board has to re cluster the moment a drop lands, and
 * the Mac that resolved it may be asleep by then. Clustering fifteen words of title, summary and
 * tags is microseconds, so the map redraws as you share.
 *
 * WHY IT IS A PORT AND NOT A SECOND DESIGN. `drops/tests/test_cluster_parity.py` runs both over
 * the real corpus and fails unless they agree on every cluster, every label and every order. A
 * board that groups one way on the phone and another in `python -m drops cluster` would make
 * both untrustworthy, and the failure would look like a bug in the data.
 *
 * Every tie break in the Python is here for the same reason it is there: two pairs at the same
 * similarity, two terms at the same weight, two clusters of the same size. Without them the two
 * would agree on most boards and differ on somebody's.
 */

/** Below this, two drops are not about the same thing. Fitted on the real corpus; see the
 * Python, which carries the measurement. */
export const MERGE_FLOOR = 0.18;
/** A cluster past this is a pile, and the board splits the hub into two rings anyway. */
export const MAX_CLUSTER = 9;
export const TAG_WEIGHT = 3;
export const KIND_WEIGHT = 2;
export const LABEL_MIN_SHARE = 0.5;

const TOKEN = /[a-z0-9]+/g;

export const STOPWORDS = new Set(
  `a an the and or but if then than that this these those with without within from into onto
for of to in on at by as is are was were be been being do does did doing done have has had
how what when where which who whom why you your yours it its they them their there here
i me my we us our he she his her not no nor so such can could should would will shall may
might must just only very more most much many few other some any all each every one two
new get gets got make makes made use uses used using way ways thing things stuff lot lots
like about over under after before while during between out up down off again once
video reel short shorts post posts clip watch watching see seen look looking show shows
tip tips trick tricks hack hacks guide tutorial explained explains`.split(/\s+/),
);

/** True of nearly every drop on a builder's board, so they separate none of them. Damped
 * rather than dropped: they should not decide a cluster and should still break a tie. */
export const WEAK = new Set(
  'code coding dev developer development software app apps build building'.split(' '),
);

export interface Clusterable {
  kind?: string | null;
  title?: string | null;
  summary?: string | null;
  tags?: string[] | null;
}

export interface Cluster {
  label: string;
  members: number[];
  size: number;
}

/** Plural folding, and nothing more: an aggressive stemmer folds `pasta` and `paste`. */
export function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.length > 4 && /(ses|xes|zes|ches|shes)$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

export function termsOf(drop: Clusterable): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (text: string, weight: number) => {
    for (const raw of (text || '').toLowerCase().match(TOKEN) ?? []) {
      const t = stem(raw);
      if (t.length < 2 || STOPWORDS.has(t) || /^\d+$/.test(t)) continue;
      counts.set(t, (counts.get(t) ?? 0) + weight);
    }
  };
  add(drop.title ?? '', 1);
  add(drop.summary ?? '', 1);
  for (const tag of drop.tags ?? []) add(String(tag), TAG_WEIGHT);
  const kind = drop.kind ?? '';
  if (kind && kind !== 'unknown') add(kind, KIND_WEIGHT);
  return counts;
}

export function vectors(drops: Clusterable[]): {
  vecs: Map<string, number>[];
  df: Map<string, number>;
} {
  const docs = drops.map(termsOf);
  const n = docs.length;
  const df = new Map<string, number>();
  for (const doc of docs) for (const t of doc.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const vecs = docs.map((doc) => {
    const vec = new Map<string, number>();
    for (const [t, c] of doc) {
      const damp = WEAK.has(t) ? 0.25 : 1.0;
      vec.set(t, (1 + Math.log(c)) * (Math.log((n + 1) / ((df.get(t) ?? 0) + 1)) + 1) * damp);
    }
    let sum = 0;
    for (const v of vec.values()) sum += v * v;
    const norm = Math.sqrt(sum) || 1;
    for (const [t, v] of vec) vec.set(t, v / norm);
    return vec;
  });
  return { vecs, df };
}

export function cosine(a: Map<string, number>, b: Map<string, number>): number {
  if (b.size < a.size) [a, b] = [b, a];
  let total = 0;
  for (const [t, v] of a) {
    const w = b.get(t);
    if (w !== undefined) total += v * w;
  }
  return total;
}

/**
 * Nine decimal places. The two languages agree on IEEE doubles; the ORDER of the additions in a
 * sparse dot product does not have to, and one ulp decides which of two equal pairs merges
 * first. `Math.floor(x * 1e9 + 0.5)` is Python's `math.floor` on the same expression, not
 * `Math.round`, whose half-away-from-zero on negatives differs.
 */
export function round9(x: number): number {
  return Math.floor(x * 1e9 + 0.5) / 1e9;
}

/** Indices grouped. Largest cluster first, then by its first member's index. */
export function cluster(drops: Clusterable[], floor: number = MERGE_FLOOR): number[][] {
  const { vecs } = vectors(drops);
  const n = drops.length;
  if (n === 0) return [];
  let groups: number[][] = Array.from({ length: n }, (_, i) => [i]);

  while (groups.length > 1) {
    let bestSim = -1;
    let bestI = -1;
    let bestJ = -1;
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const gi = groups[i] as number[];
        const gj = groups[j] as number[];
        if (gi.length + gj.length > MAX_CLUSTER) continue;
        let total = 0;
        for (const a of gi) {
          for (const b of gj) total += cosine(vecs[a] as Map<string, number>, vecs[b] as Map<string, number>);
        }
        const sim = round9(total / (gi.length * gj.length));
        // Strictly greater, walking in index order: the FIRST pair at a given similarity wins
        // in both languages.
        if (sim > bestSim) {
          bestSim = sim;
          bestI = i;
          bestJ = j;
        }
      }
    }
    if (bestSim < floor) break;
    groups[bestI] = [...(groups[bestI] as number[]), ...(groups[bestJ] as number[])].sort((a, b) => a - b);
    groups.splice(bestJ, 1);
  }

  groups = groups.sort((a, b) => b.length - a.length || (a[0] as number) - (b[0] as number));
  return groups;
}

/**
 * stem -> {the word as it was written: how many drops wrote it that way}.
 *
 * A LABEL IS A WORD SOMEBODY WROTE, NOT A STEM. MEASURED on the real corpus: the cluster for
 * "Indie Hacker? Startup or SAAS?" was labelled `saa`, because `stem` takes a trailing `s` off
 * anything longer than three letters that does not end in `ss`. The stem is the right thing to
 * cluster on and the wrong thing to print.
 */
export function surfaces(drops: Clusterable[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const d of drops) {
    const seen = new Set<string>();
    for (const text of [d.title ?? '', d.summary ?? '', ...(d.tags ?? [])]) {
      for (const raw of String(text).toLowerCase().match(TOKEN) ?? []) {
        const t = stem(raw);
        if (t.length < 2 || STOPWORDS.has(t) || /^\d+$/.test(t) || seen.has(`${t}.${raw}`)) continue;
        seen.add(`${t}.${raw}`);
        const forms = out.get(t) ?? new Map<string, number>();
        forms.set(raw, (forms.get(raw) ?? 0) + 1);
        out.set(t, forms);
      }
    }
  }
  return out;
}

/** The stem as a word somebody wrote. Most common, then longest, then alphabetical. */
export function wordFor(term: string, surf: Map<string, Map<string, number>>): string {
  const forms = surf.get(term);
  if (!forms || forms.size === 0) return term;
  return [...forms.keys()].sort(
    (a, b) =>
      (forms.get(b) ?? 0) - (forms.get(a) ?? 0) ||
      b.length - a.length ||
      (a < b ? -1 : a > b ? 1 : 0),
  )[0] as string;
}

/** What to call a cluster: the strongest term at least half of it shares, as a word. */
export function label(
  group: number[],
  vecs: Map<string, number>[],
  surf: Map<string, Map<string, number>>,
): string {
  const need = Math.max(1, Math.ceil(group.length * LABEL_MIN_SHARE));
  const totals = new Map<string, number>();
  const shared = new Map<string, number>();
  for (const i of group) {
    for (const [t, v] of vecs[i] as Map<string, number>) {
      totals.set(t, (totals.get(t) ?? 0) + v);
      shared.set(t, (shared.get(t) ?? 0) + 1);
    }
  }
  let eligible = [...shared.keys()].filter((t) => (shared.get(t) ?? 0) >= need && !WEAK.has(t));
  if (eligible.length === 0) {
    eligible = [...shared.keys()].filter((t) => (shared.get(t) ?? 0) >= need);
  }
  if (eligible.length === 0) eligible = [...totals.keys()];
  if (eligible.length === 0) return '';
  eligible.sort(
    (a, b) =>
      round9(totals.get(b) ?? 0) - round9(totals.get(a) ?? 0) ||
      (shared.get(b) ?? 0) - (shared.get(a) ?? 0) ||
      (a < b ? -1 : a > b ? 1 : 0),
  );
  return wordFor(eligible[0] ?? '', surf);
}

/** The clustered board: largest first. */
export function board(drops: Clusterable[], floor: number = MERGE_FLOOR): Cluster[] {
  const { vecs } = vectors(drops);
  const surf = surfaces(drops);
  return cluster(drops, floor).map((g) => ({ label: label(g, vecs, surf), members: g, size: g.length }));
}

/** Every pairwise similarity, for the parity test and for the map's edge weights. */
export function similarityMatrix(drops: Clusterable[]): number[][] {
  const { vecs } = vectors(drops);
  return vecs.map((a) => vecs.map((b) => round9(cosine(a, b))));
}

// ─────────────────────────────────────────────────────────────────── search

/**
 * What you meant, against what the drops say. Same vectors the board is grouped by, so the search
 * and the shape of the board agree about what a drop is about.
 *
 * It is not a substring match: "pasta" finds a drop whose title says "spaghetti" if the two sat
 * in the same cluster's vocabulary, and a drop whose only tie is a word every drop uses is ranked
 * down by the same IDF that keeps `code` from naming a cluster. It is also not an embedding, for
 * the reason the clustering is not: no key, no download, works on a plane, and every hit can say
 * which word matched.
 *
 * Returns the indices that matched, best first. An empty or unmatched query returns null, which
 * the board reads as "show everything" rather than as "show nothing".
 */
export function search(query: string, drops: Clusterable[]): number[] | null {
  const q = (query ?? '').trim().toLowerCase();
  if (!q) return null;
  const { vecs, df } = vectors(drops);
  const n = drops.length;

  const terms = new Map<string, number>();
  for (const raw of q.match(TOKEN) ?? []) {
    const t = stem(raw);
    if (t.length < 2) continue;
    terms.set(t, (terms.get(t) ?? 0) + 1);
  }
  if (terms.size === 0) return null;

  const qv = new Map<string, number>();
  for (const [t, count] of terms) {
    const damp = WEAK.has(t) ? 0.25 : 1;
    qv.set(t, (1 + Math.log(count)) * (Math.log((n + 1) / ((df.get(t) ?? 0) + 1)) + 1) * damp);
  }
  let sum = 0;
  for (const v of qv.values()) sum += v * v;
  const norm = Math.sqrt(sum) || 1;
  for (const [t, v] of qv) qv.set(t, v / norm);

  const scored = drops
    .map((_, i) => ({ i, score: round9(cosine(qv, vecs[i] as Map<string, number>)) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i);

  // A query that matched nothing shows everything: a board that empties itself on a typo reads
  // as broken, and the words are right there to fix.
  return scored.length ? scored.map((s) => s.i) : null;
}
