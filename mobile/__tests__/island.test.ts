import { afterEach, describe, expect, test } from 'bun:test';

import {
  boxFor,
  crewDots,
  crewLead,
  dropSteps,
  EAR,
  earLabel,
  lead,
  minutesLabel,
  PRIORITY,
  restingMode,
  spoken,
  type Activity,
  type CrewMember,
} from '../src/island/model';
import { island } from '../src/island/store';

const hw = { x: 201, y: 29.5, width: 125, height: 37 };

function member(id: string, state: CrewMember['state'], startedMs: number | null): CrewMember {
  return { sessionId: id, repo: id, animal: 'cat', ink: '#F54BB8', state, sentence: 'doing a thing', startedMs };
}

const crew: Activity = { kind: 'crew', id: 'crew', members: [member('a', 'working', 10), member('b', 'working', 5)] };
const waiting: Activity = { kind: 'needsYou', id: 'wait:a', sessionId: 'a', repo: 'a', animal: 'cat', ink: '#F54BB8', sentence: 'asks', sinceMs: 0 };
const drop = (phase: 'sent' | 'reading' | 'planned' | 'refused', moves = 0): Extract<Activity, { kind: 'drop' }> => ({
  kind: 'drop',
  id: 'drop:1',
  dropId: '1',
  host: 'tiktok.com',
  title: null,
  thumbnail: null,
  phase,
  moves,
  firstMove: null,
  hue: null,
});

describe('what the island says', () => {
  test('a run blocked on you beats everything', () => {
    expect(lead([crew, drop('reading'), waiting])!.kind).toBe('needsYou');
    expect(Math.max(...Object.values(PRIORITY))).toBe(PRIORITY.needsYou);
  });

  test('the crew is the resting state: anything else that is true outranks it', () => {
    for (const k of Object.keys(PRIORITY) as (keyof typeof PRIORITY)[]) {
      if (k !== 'crew') expect(PRIORITY[k]).toBeGreaterThan(PRIORITY.crew);
    }
    expect(lead([])).toBeNull();
  });

  test('news is a toast, a standing thing is compact, and expanded is never a resting mode', () => {
    expect(restingMode(null)).toBe('hidden');
    expect(restingMode(crew)).toBe('compact');
    expect(restingMode(waiting)).toBe('compact');
    expect(restingMode(drop('reading'))).toBe('toast');
    for (const a of [crew, waiting, drop('sent')]) expect(restingMode(a)).not.toBe('expanded');
  });

  test('hidden is the hardware island exactly, and everything grows from it', () => {
    expect(boxFor('hidden', 402, hw)).toEqual({ w: 125, h: 37, r: 18.5 });
    const c = boxFor('compact', 402, hw);
    expect(c.w).toBe(125 + 2 * EAR);
    expect(c.h).toBe(37);
    const t = boxFor('toast', 402, hw);
    // The words sit below the camera: the toast is taller than the hardware by a line and more.
    expect(t.h - hw.height).toBeGreaterThanOrEqual(52);
    expect(t.w).toBeLessThanOrEqual(402 - 20);
    const e = boxFor('expanded', 402, hw, 150);
    expect(e.w).toBe(402 - 16);
    expect(e.h).toBe(150);
  });

  test('compact never reaches the clock or the battery on a 402 point screen', () => {
    const c = boxFor('compact', 402, hw);
    // The status bar's time ends near 90 pt and the signal starts near 290 pt (measured on the
    // iPhone 16 Pro simulator at 1206 x 2622).
    expect(201 - c.w / 2).toBeGreaterThan(90);
    expect(201 + c.w / 2).toBeLessThan(306);
  });

  test('a drop walks the wheel from sent to its answer', () => {
    expect(dropSteps(drop('sent')).index).toBe(0);
    expect(dropSteps(drop('reading')).index).toBe(1);
    expect(dropSteps(drop('planned', 3)).rows[2]!.text).toBe('3 moves ready');
    expect(dropSteps(drop('planned', 1)).rows[2]!.text).toBe('1 move ready');
    expect(dropSteps(drop('refused')).index).toBe(2);
    expect(dropSteps(drop('reading')).rows[1]!.text).toContain('tiktok.com');
  });

  test('the crew wears the waiting face first, else the oldest run', () => {
    expect(crewLead([member('a', 'working', 10), member('b', 'working', 5)])!.sessionId).toBe('b');
    expect(crewLead([member('a', 'working', 1), member('b', 'waiting', 5)])!.sessionId).toBe('b');
    expect(crewLead([])).toBeNull();
    expect(crewDots(Array.from({ length: 7 }, (_, i) => member(String(i), 'working', i)))).toHaveLength(4);
  });

  test('an ear says the time in its own short shape, never on two lines', () => {
    expect(earLabel(30_000)).toBe('now');
    expect(earLabel(12 * 60_000)).toBe('12m');
    expect(earLabel(62 * 60_000)).toBe('1:02');
    expect(earLabel(125 * 60_000)).toBe('2:05');
    expect(earLabel(11 * 3600_000)).toBe('11h');
    for (const m of [0, 5, 59, 60, 61, 599, 600, 5000]) expect(earLabel(m * 60_000).length).toBeLessThanOrEqual(4);
  });

  test('minutes as the island says them', () => {
    expect(minutesLabel(-5000)).toBe('now');
    expect(minutesLabel(59_000)).toBe('now');
    expect(minutesLabel(2 * 60_000)).toBe('2m');
    expect(minutesLabel(60 * 60_000)).toBe('1h');
    expect(minutesLabel(72 * 60_000)).toBe('1h 12m');
  });

  test('VoiceOver reads one sentence, the news, not the drawing', () => {
    expect(spoken(waiting, 3 * 60_000)).toContain('waiting on you, 3m');
    expect(spoken(crew, 0)).toBe('2 sessions running');
    expect(spoken(null, 0)).toBe('');
  });

  test('a demo you asked for says where it is: waiting, filming, up', () => {
    const d = { kind: 'demo' as const, id: 'demo:k', projectKey: 'k', title: 'tramline', progress: null, sinceMs: 0 };
    expect(spoken({ ...d, filming: false, ready: false }, 0)).toBe('Waiting for your Mac to film tramline');
    expect(spoken({ ...d, filming: true, ready: false }, 0)).toBe('Your Mac is filming tramline');
    expect(spoken({ ...d, filming: false, ready: true }, 0)).toBe('The demo of tramline is ready');
    // A demo is standing news while it is made, and it outranks the crew it is not part of.
    expect(restingMode({ ...d, filming: true, ready: false })).toBe('compact');
    expect(PRIORITY.demo).toBeGreaterThan(PRIORITY.crew);
  });
});

describe('the store', () => {
  afterEach(() => island.reset());

  test('post replaces by id, clear takes down', () => {
    island.post(crew, 0);
    island.post({ ...crew, members: [member('z', 'working', 1)] } as Activity, 0);
    expect(island.snapshot()).toHaveLength(1);
    island.clear('crew');
    expect(island.snapshot()).toHaveLength(0);
  });

  test('once says a thing once for the life of the app', () => {
    const shipped: Activity = { kind: 'shipped', id: 'shipped:1', sessionId: '1', repo: 'r', animal: 'cat', ink: '#F54BB8', summary: 's' };
    island.once(shipped, 0);
    island.clear('shipped:1');
    island.once(shipped, 0);
    expect(island.snapshot()).toHaveLength(0);
  });

  test('replaceKind swaps one kind and leaves the rest, and says nothing when nothing changed', () => {
    island.post(drop('reading'), 0);
    let emits = 0;
    const off = island.subscribe(() => emits++);
    island.replaceKind('crew', [crew]);
    island.replaceKind('crew', [crew]);
    expect(emits).toBe(1);
    expect(island.snapshot().map((a) => a.kind).sort()).toEqual(['crew', 'drop']);
    island.replaceKind('crew', []);
    expect(island.snapshot().map((a) => a.kind)).toEqual(['drop']);
    off();
  });

  test('while the tour plays, the live feeds wait and land when it ends', () => {
    island.setTouring(true);
    island.replaceKind('crew', [crew]);
    expect(island.snapshot()).toHaveLength(0);
    island.setTouring(false);
    expect(island.snapshot().map((a) => a.kind)).toEqual(['crew']);
  });

  test('a transient beat takes itself down', async () => {
    island.post({ kind: 'notice', id: 'n', text: 'hi', state: 'done', animal: 'cat', ink: '#F54BB8' }, 20);
    expect(island.snapshot()).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 40));
    expect(island.snapshot()).toHaveLength(0);
  });
});

describe("a desktop window's tour", () => {
  afterEach(() => island.reset());

  test('plays only the states a desktop window draws, each one passing', async () => {
    const { DEMO_STEPS, PASSING_STEPS } = await import('../src/island/demo');
    const labels = DEMO_STEPS.map((s) => s.label);
    for (const label of PASSING_STEPS) expect(labels).toContain(label);
    for (const s of DEMO_STEPS.filter((x) => PASSING_STEPS.includes(x.label))) {
      island.reset();
      s.run();
      const shown = island.snapshot();
      expect(shown.length).toBeGreaterThan(0);
      // Each step leaves only passing activities up: a toast, never the crew or a wait.
      for (const a of shown) expect(restingMode(a)).toBe('toast');
    }
  });
});
