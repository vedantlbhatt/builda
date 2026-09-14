/**
 * Rounding so the parts a person reads add up to the whole they read. Pure, so
 * `__tests__/moneySankey.test.ts` holds it.
 *
 * FOUND IN REVIEW (2026-09-13, the live report): the models column read $2,263 + $241 + $10.98
 * under a $2,516 total, $2,514.98, and Opus 5's own sentence said $2,263 and then $2,102 + $162,
 * which is $2,264. Each figure was rounded alone (`copy/money.dollars`), which is right for a figure
 * standing alone and wrong for parts of a whole shown beside it.
 *
 * THE RULES, ONE IDEA. Every part is the floor or the ceiling of its true value, so no figure is off
 * by a dollar or more, and the parts sum to the whole as it is shown:
 *
 *   `columnUnits`  a column of a chart: each part its own nearest unit, as every other page rounds
 *                  it, when those add up to the whole; the largest remainder method only when they
 *                  cannot, and then in that column alone. So a project reads the same here and on
 *                  its own page (review, 2026-09-13: "two counters for one number").
 *   `apportion`    one sum: the largest remainder method (Hamilton's). The whole's shortfall from the
 *                  parts' floors goes a unit at a time to the parts with the largest remainders.
 *   `roundTable`   the streams between two columns, fitted to the columns' figures: controlled
 *                  rounding of a two way table to whole number margins, every row and every column
 *                  exact, so each tap's sentence adds up to the node it opens with and a project's
 *                  only stream reads as the project.
 *   `roundFlow`    the engine under `roundTable`: a flow rounded at once, every edge a floor or a
 *                  ceiling, every node passing on exactly what it takes in, some edges pinned; the
 *                  rounding with the least total error is a min cost flow in which rounding an edge
 *                  up costs 1 - 2r for its remainder r (the largest remainder method, for one sum).
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

/**
 * One column of a chart, each part as it is shown everywhere else: its own nearest unit (the
 * rounding `dollars` does, half even), so a project reads here exactly as on its own page. Only
 * when those cannot add up to the column's `whole` does the column fall back to the largest
 * remainder method, and then that column alone. FOUND IN REVIEW (2026-09-13): rounding the whole
 * flow around a pinned first column put a project at $161 in the chart and $162 on its own page,
 * two counters for one number.
 */
export function columnUnits(parts: readonly number[], whole: number, unit: number): number[] {
  const own = parts.map((p) => shownUnits(p, unit));
  if (own.reduce((s, u) => s + u, 0) === whole) return own;
  return apportion(
    parts.map((p) => p / unit),
    whole,
  );
}

export interface TableCell {
  id: string;
  row: string;
  col: string;
  /** In units, not rounded. */
  value: number;
}

/**
 * Controlled rounding of a two way table to whole number margins already chosen for its rows and
 * its columns: every cell the floor or the ceiling of its value, every row and every column adding
 * up to its margin exactly, and of all such tables the one with the least total error (the min cost
 * flow `roundFlow` finds, with the margins pinned). Null when the margins leave no way to do it,
 * which a margin that is the floor or the ceiling of its own row or column never does in practice;
 * `roundRows` is then the fallback, every row still exact.
 */
export function roundTable(cells: readonly TableCell[], rows: ReadonlyMap<string, number>, cols: ReadonlyMap<string, number>): Map<string, number> | null {
  const rowsTotal = [...rows.values()].reduce((s, u) => s + u, 0);
  const colsTotal = [...cols.values()].reduce((s, u) => s + u, 0);
  if (rowsTotal !== colsTotal) return null;
  const rowReal = new Map<string, number>();
  const colReal = new Map<string, number>();
  for (const c of cells) {
    rowReal.set(c.row, (rowReal.get(c.row) ?? 0) + c.value);
    colReal.set(c.col, (colReal.get(c.col) ?? 0) + c.value);
  }
  const S = 'table:rows';
  const T = 'table:cols';
  const edges: FlowEdge[] = [];
  const pins = new Map<string, number>();
  for (const [r, u] of rows) {
    edges.push({ id: `row:${r}`, from: S, to: `row:${r}`, value: rowReal.get(r) ?? 0 });
    pins.set(`row:${r}`, u);
  }
  for (const c of cells) edges.push({ id: `cell:${c.id}`, from: `row:${c.row}`, to: `col:${c.col}`, value: c.value });
  for (const [col, u] of cols) {
    edges.push({ id: `col:${col}`, from: `col:${col}`, to: T, value: colReal.get(col) ?? 0 });
    pins.set(`col:${col}`, u);
  }
  const r = roundFlow(edges, S, T, rowsTotal, pins);
  if (!r) return null;
  return new Map(cells.map((c) => [c.id, r.get(`cell:${c.id}`)!]));
}

/**
 * Each row's cells apportioned to its margin alone (the largest remainder method), for margins no
 * table can meet (the rows and the columns add up to different wholes). Every row stays exact; a
 * column with ONE cell is then made to read as its own margin when its row can trade the unit with
 * a cell that stays within its floor and ceiling, so a project's only stream still reads as the
 * project.
 */
export function roundRows(cells: readonly TableCell[], rows: ReadonlyMap<string, number>, cols?: ReadonlyMap<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [r, u] of rows) {
    const mine = cells.filter((c) => c.row === r);
    apportion(
      mine.map((c) => c.value),
      u,
    ).forEach((v, i) => out.set(mine[i]!.id, v));
  }
  if (!cols) return out;
  const inCol = (col: string) => cells.filter((c) => c.col === col);
  const within = (c: TableCell, v: number) => v >= Math.floor(c.value + EPS) && v <= Math.ceil(c.value - EPS);
  for (const [col, want] of cols) {
    const only = inCol(col);
    if (only.length !== 1) continue;
    const c = only[0]!;
    const d = want - out.get(c.id)!;
    if (d === 0 || Math.abs(d) !== 1 || !within(c, want)) continue;
    const trade = cells.find((o) => o.row === c.row && o.id !== c.id && inCol(o.col).length > 1 && within(o, out.get(o.id)! - d));
    if (trade) {
      out.set(c.id, want);
      out.set(trade.id, out.get(trade.id)! - d);
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
