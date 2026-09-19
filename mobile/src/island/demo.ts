/**
 * Fixture activities for the island, for the debug screen and for recording it.
 *
 * `EXPO_PUBLIC_ISLAND_DEMO=1` (read by Metro when it bundles) makes the island cycle through every
 * state on its own, so a screenshot or a screen recording of each one needs no live Mac, no shared
 * reel and no finished session. Never on in a store build: the variable is only set by hand.
 */
import { tokens } from '../generated/tokens';
import { creatureHue } from '../theme';
import type { Activity, CrewMember } from './model';
import { island } from './store';

const now = () => Date.now();

function member(sessionId: string, repo: string, animal: CrewMember['animal'], state: CrewMember['state'], sentence: string, minsAgo: number): CrewMember {
  return { sessionId, repo, animal, ink: creatureHue(animal).ink, state, sentence, startedMs: now() - minsAgo * 60000 };
}

export function demoCrew(n = 3): Activity {
  const all = [
    member('demo-1', 'builda', 'octopus', 'working', 'Wiring the island into the root layout', 42),
    member('demo-2', 'ridegt', 'dog', 'working', 'Running the route planner tests', 18),
    member('demo-3', 'clicky', 'cat', 'thinking', 'Reading the Firebase rules', 7),
    member('demo-4', 'tokensmith', 'whale', 'working', 'Profiling the tokenizer', 3),
  ];
  return { kind: 'crew', id: 'crew', members: all.slice(0, n) };
}

export const DEMO_STEPS: { label: string; run: () => void; ms: number }[] = [
  { label: 'crew', ms: 2600, run: () => island.post(demoCrew(3), 0) },
  { label: 'crew expanded', ms: 6000, run: () => island.expand() },
  {
    label: 'needs you',
    ms: 4200,
    run: () =>
      island.post(
        {
          kind: 'needsYou',
          id: 'wait:demo-2',
          sessionId: 'demo-2',
          repo: 'ridegt',
          animal: 'dog',
          ink: creatureHue('dog').ink,
          sentence: 'Asking to run the migration against the staging database',
          sinceMs: now() - 2 * 60000,
        },
        0,
      ),
  },
  { label: 'needs you expanded', ms: 4200, run: () => island.expand() },
  {
    label: 'drop sent',
    ms: 2200,
    run: () => {
      island.clear('wait:demo-2');
      island.post({ kind: 'drop', id: 'drop:demo', dropId: 'demo', host: 'tiktok.com', title: null, thumbnail: null, phase: 'sent', moves: 0, firstMove: null, hue: null }, 0);
    },
  },
  {
    label: 'drop reading',
    ms: 2400,
    run: () => island.post({ kind: 'drop', id: 'drop:demo', dropId: 'demo', host: 'tiktok.com', title: 'Menu bar app that matches errors to past fixes', thumbnail: null, phase: 'reading', moves: 0, firstMove: null, hue: null }, 0),
  },
  {
    label: 'drop planned',
    ms: 3200,
    run: () =>
      island.post(
        { kind: 'drop', id: 'drop:demo', dropId: 'demo', host: 'tiktok.com', title: 'Menu bar app that matches errors to past fixes', thumbnail: null, phase: 'planned', moves: 3, firstMove: 'Scaffold the menu bar app', hue: tokens.spectrum.hues.orchid.dark },
        0,
      ),
  },
  {
    label: 'shipped',
    ms: 4400,
    run: () => {
      island.clear('drop:demo');
      island.post({ kind: 'shipped', id: `shipped:demo-${now()}`, sessionId: 'demo-1', repo: 'builda', animal: 'octopus', ink: creatureHue('octopus').ink, summary: 'builda · 42m · 6 commits' });
    },
  },
  {
    label: 'demo',
    ms: 3600,
    run: () => island.post({ kind: 'demo', id: 'demo:builda', projectKey: 'builda', title: 'builda', progress: 0.64, ready: false }, 0),
  },
  {
    label: 'rest',
    ms: 2600,
    run: () => {
      island.clear('demo:builda');
      island.post(demoCrew(1), 0);
    },
  },
];

let running: ReturnType<typeof setTimeout> | null = null;

/** Cycle the island through every state, forever, until `stopIslandDemo`. */
export function startIslandDemo(): void {
  if (running) return;
  let i = 0;
  const step = () => {
    const s = DEMO_STEPS[i % DEMO_STEPS.length]!;
    s.run();
    i += 1;
    running = setTimeout(step, s.ms);
  };
  step();
}

/**
 * Every state once, then the island goes back to exactly what it was showing (Settings, "Play
 * every state once"). The real activities are set aside for the tour and put back after it, so a
 * run that was waiting on you before the tour is still waiting on you after it.
 */
export function playIslandTour(): void {
  if (running) return;
  const saved = island.snapshot();
  island.reset();
  island.setTouring(true);
  let i = 0;
  const step = () => {
    if (i >= DEMO_STEPS.length) {
      running = null;
      island.reset();
      for (const a of saved) island.post(a, 0);
      // Anything the live feeds said during the tour lands now, over what was saved.
      island.setTouring(false);
      return;
    }
    const s = DEMO_STEPS[i]!;
    s.run();
    i += 1;
    running = setTimeout(step, s.ms);
  };
  step();
}

export function stopIslandDemo(): void {
  if (running) clearTimeout(running);
  running = null;
  island.reset();
}
