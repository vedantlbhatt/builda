/**
 * Rounding so the parts a person reads add up to the whole they read. Pure, so
 * `__tests__/moneySankey.test.ts` holds it.
 *
 * FOUND IN REVIEW (2026-09-13, the live report): the models column read $2,263 + $241 + $10.98
 * under a $2,516 total, $2,514.98, and Opus 5's own sentence said $2,263 and then $2,102 + $162,
 * which is $2,264. Each figure was rounded alone (`copy/money.dollars`), which is right for a figure
 * standing alone and wrong for parts of a whole shown beside it.
 *
 * TWO RULES, ONE IDEA. Every part is the floor or the ceiling of its true value, so no figure is off
 * by a dollar or more, and the parts sum to the whole as it is shown:
 *
 *   `apportion`  one sum: the largest remainder method (Hamilton's). The whole's shortfall from the
 *                parts' floors goes a unit at a time to the parts with the largest remainders.
 *   `roundFlow`  a whole flow at once: every stream, and so every node, a floor or a ceiling, every
 *                node passing on exactly what it takes in, and the total the page's total. Rounding
 *                each column alone cannot promise that: a stream that is a project's only one could
 *                read $162 in its model's sentence and $161 as the project. A flow can always be
 *                rounded this way (the integrality of network flows); among the roundings, the one
 *                with the least total error is found as a min cost flow in which rounding a stream up
 *                costs 1 - 2r for its remainder r, which is exactly the largest remainder method when
 *                there is one sum.
 *
 * THE UNIT is the shown whole's: whole dollars from $100, cents below (`copy/money.dollars`), so a
 * $10.98 part of a $2,516 whole reads $11. A part that is a positive amount and rounds to nothing
 * reads "under $1", never "$0": absent is not zero, and present is not absent either.
 */
import { commas, pyFixed } from '../copy/numbers';

const EPS = 1e-9;

/** The unit a total is shown in: a dollar from $100 up, a cent below it (`dollars`). */
export function dollarUnit(total: number): number {
  return Math.abs(total) >= 100 ? 1 : 0.01;
}

/** A total as the whole number of units `dollars` shows it in (half even, as the copy helpers round). */
export function shownUnits(total: number, unit: number): number {
  return Number(pyFixed(total, unit === 1 ? 0 : 2).replace(/,/g, '')) / unit;
}

/** A whole number of units as dollars: "$2,263", "$11", "$0.43"; a positive part that rounded to none, "under $1". */
export function dollarsOf(units: number, unit: number, real: number): string {
  if (units <= 0 && real > 0) return unit === 1 ? 'under $1' : 'under $0.01';
  return unit === 1 ? `$${commas(Math.round(units))}` : `$${pyFixed(units / 100, 2, true)}`;
}

/**
 * The largest remainder method: whole numbers, each the floor or the ceiling of its part, summing
 * to `whole`. Ties go to the earlier part. `whole` is expected within a unit per part of the sum
 * of the parts; past that the parts with the smallest remainders give way first.
 */
export function apportion(parts: readonly number[], whole: number): number[] {
  const floors = parts.map((p) => Math.floor(p + EPS));
  const rem = parts.map((p, i) => Math.max(0, p - floors[i]!));
  const out = [...floors];
  let left = Math.round(whole) - floors.reduce((s, f) => s + f, 0);
  const byLargest = rem.map((r, i) => ({ r, i })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; left > 0 && byLargest.length; k = (k + 1) % byLargest.length) {
    out[byLargest[k]!.i]! += 1;
    left -= 1;
  }
  const bySmallest = [...byLargest].reverse();
  for (let k = 0; left < 0 && bySmallest.some(({ i }) => out[i]! > 0); k = (k + 1) % bySmallest.length) {
    const i = bySmallest[k]!.i;
    if (out[i]! > 0) {
      out[i]! -= 1;
      left += 1;
    }
  }
  return out;
}

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  /** In units, not rounded. */
  value: number;
}

interface Arc {
  to: number;
  cap: number;
  cost: number;
  rev: number;
  edge: string | null;
}

/**
 * Every edge of a flow from `source` to `sink` rounded to whole units, each the floor or the
 * ceiling of its value, every other node passing on exactly what it takes in, `target` leaving
 * the source and reaching the sink; of all such roundings, the one with the least total error.
 * The flow must conserve at every node other than the two ends. `fixed` pins some edges to a
 * value already chosen (the floor or the ceiling of theirs): the money flow pins its first column
 * to the largest remainder method, the column a person sets beside the total. Null when no such
 * rounding exists: `target` is not the floor or the ceiling of the flow's total, or the pins leave
 * the rest no way to balance.
 */
export function roundFlow(
  edges: readonly FlowEdge[],
  source: string,
  sink: string,
  target: number,
  fixed?: ReadonlyMap<string, number>,
): Map<string, number> | null {
  const floorOf = new Map<string, number>();
  const remOf = new Map<string, number>();
  for (const e of edges) {
    const pinned = fixed?.get(e.id);
    if (pinned !== undefined) {
      floorOf.set(e.id, pinned);
      remOf.set(e.id, 0);
      continue;
    }
    let f = Math.floor(e.value + EPS);
    let r = e.value - f;
    if (r < EPS) r = 0;
    if (r > 1 - EPS) {
      f += 1;
      r = 0;
    }
    floorOf.set(e.id, f);
    remOf.set(e.id, r);
  }
  const names = [...new Set([source, sink, ...edges.flatMap((e) => [e.from, e.to])])];
  const S = names.length;
  const T = names.length + 1;
  const index = new Map(names.map((nm, i) => [nm, i]));
  const graph: Arc[][] = Array.from({ length: names.length + 2 }, () => []);
  const arc = (u: number, v: number, cap: number, cost: number, edge: string | null) => {
    graph[u]!.push({ to: v, cap, cost, rev: graph[v]!.length, edge });
    graph[v]!.push({ to: u, cap: 0, cost: -cost, rev: graph[u]!.length - 1, edge: null });
  };

  // Rounding an edge up sends one unit along it; each node's floors say how many units it must
  // gain (taken in) or give (sent on) for it to balance again.
  const outFloor = new Map<string, number>();
  const inFloor = new Map<string, number>();
  for (const e of edges) {
    outFloor.set(e.from, (outFloor.get(e.from) ?? 0) + floorOf.get(e.id)!);
    inFloor.set(e.to, (inFloor.get(e.to) ?? 0) + floorOf.get(e.id)!);
    const r = remOf.get(e.id)!;
    if (r > 0) arc(index.get(e.from)!, index.get(e.to)!, 1, 1 - 2 * r, e.id);
  }
  let need = 0;
  const give = (v: number, amount: number) => {
    if (amount > 0) {
      arc(S, v, amount, 0, null);
      need += amount;
    }
  };
  const take = (v: number, amount: number) => {
    if (amount > 0) arc(v, T, amount, 0, null);
  };
  const fromSource = target - (outFloor.get(source) ?? 0);
  const intoSink = target - (inFloor.get(sink) ?? 0);
  if (fromSource < 0 || intoSink < 0) return null;
  give(index.get(source)!, fromSource);
  take(index.get(sink)!, intoSink);
  for (const nm of names) {
    if (nm === source || nm === sink) continue;
    const d = (outFloor.get(nm) ?? 0) - (inFloor.get(nm) ?? 0);
    if (d > 0) take(index.get(nm)!, d);
    else give(index.get(nm)!, -d);
  }

  // Successive shortest paths (Bellman Ford: rounding up a large remainder is a negative cost).
  let sent = 0;
  const n = graph.length;
  while (sent < need) {
    const dist = new Array<number>(n).fill(Number.POSITIVE_INFINITY);
    const prev = new Array<[number, number] | null>(n).fill(null);
    dist[S] = 0;
    for (let round = 0; round < n; round++) {
      let moved = false;
      for (let u = 0; u < n; u++) {
        if (dist[u] === Number.POSITIVE_INFINITY) continue;
        graph[u]!.forEach((a, k) => {
          if (a.cap > 0 && dist[u]! + a.cost < dist[a.to]! - EPS) {
            dist[a.to] = dist[u]! + a.cost;
            prev[a.to] = [u, k];
            moved = true;
          }
        });
      }
      if (!moved) break;
    }
    if (dist[T] === Number.POSITIVE_INFINITY) return null;
    for (let v = T; v !== S; ) {
      const [u, k] = prev[v]!;
      const a = graph[u]![k]!;
      a.cap -= 1;
      graph[v]![a.rev]!.cap += 1;
      v = u;
    }
    sent += 1;
  }

  const out = new Map<string, number>();
  for (const e of edges) out.set(e.id, floorOf.get(e.id)!);
  for (const arcs of graph) for (const a of arcs) if (a.edge && a.cap === 0) out.set(a.edge, out.get(a.edge)! + 1);
  return out;
}
