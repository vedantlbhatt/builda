/**
 * Measure `CONTEXT_FLOOR` (src/drops/context.ts) on a real board and a real session history.
 *
 *   TOKEN=$(scripts/overnight_stack.sh token) API=http://127.0.0.1:8788 bun scripts/drops_context.ts
 *
 * Prints every session x drop pair above 0.05 with its score and the words it shares, so a person
 * can see where real matches end and coincidences begin. Read-only.
 */
import { relatedDrops } from '../src/drops/context';

const API = process.env.API ?? 'http://127.0.0.1:8788';
const TOKEN = process.env.TOKEN ?? '';
const get = async (path: string) => {
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
};

const board = await get('/v1/drops');
const list = await get('/v1/sessions?limit=200');
const rows = (list.sessions ?? list.items ?? list) as { id: string }[];
let withAnalysis = 0;
const pairs: { score: number; session: string; drop: string; shared: string[] }[] = [];
for (const s of rows) {
  const d = await get(`/v1/sessions/${s.id}`);
  const a = d.analysis ?? d.session?.analysis;
  if (!a) continue;
  withAnalysis++;
  for (const r of relatedDrops(a, board.drops, 0.05)) pairs.push({ score: r.score, session: a.headline, drop: r.drop.title ?? r.drop.id, shared: r.shared });
}
pairs.sort((x, y) => y.score - x.score);
console.log(`${board.drops.length} drops, ${rows.length} sessions, ${withAnalysis} with an analysis, ${pairs.length} pairs above 0.05`);
for (const p of pairs.slice(0, 40)) console.log(p.score.toFixed(3), '|', p.session, '|', p.drop, '|', p.shared.join(', '));
