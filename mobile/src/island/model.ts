/**
 * What the island says, and how big it is while it says it. PURE, so
 * `__tests__/island.test.ts` holds every rule here.
 *
 * THE RULE (docs/motion.md, "The island is one object, everywhere"): the island carries what is
 * happening SOMEWHERE ELSE, ON YOUR BEHALF, that you may need to act on before you would
 * otherwise look. Builda's work happens on the Mac; you are on the phone. So: a run that needs
 * you, the crew running now, a reel being read, a demo being cut, and the one beat when something
 * shipped. Never a streak, a total or anything true all day: an island that shows a number that
 * has not moved since breakfast is one you learn to ignore, and then you ignore the one that
 * needs you too.
 */
import type { Animal } from '../pixel/animals';
import type { FaceState } from '../motion/states';

export interface CrewMember {
  sessionId: string;
  repo: string;
  animal: Animal;
  ink: string;
  state: FaceState;
  /** What it is doing now, in the live engine's words. */
  sentence: string;
  /** When it started, for "12m". Null when the row carries no start. */
  startedMs: number | null;
}

export type DropPhase = 'sent' | 'reading' | 'planned' | 'refused';

export type Activity =
  | {
      kind: 'needsYou';
      id: string;
      sessionId: string;
      repo: string;
      animal: Animal;
      ink: string;
      sentence: string;
      /** When the wait began. */
      sinceMs: number;
    }
  | { kind: 'crew'; id: 'crew'; members: CrewMember[] }
  | {
      kind: 'drop';
      id: string;
      dropId: string;
      host: string;
      title: string | null;
      thumbnail: string | null;
      phase: DropPhase;
      /** Moves offered, once planned. */
      moves: number;
      /** The first move's title, once planned: what Start would start. */
      firstMove: string | null;
      /** A drop kind's hue once planned, else null. */
      hue: string | null;
    }
  | {
      kind: 'shipped';
      id: string;
      sessionId: string;
      repo: string;
      animal: Animal;
      ink: string;
      summary: string;
    }
  | {
      kind: 'demo';
      id: string;
      projectKey: string;
      title: string;
      /** 0 to 1 while cutting, null when the Mac has not said. */
      progress: number | null;
      ready: boolean;
    }
  | {
      kind: 'notice';
      id: string;
      text: string;
      state: FaceState;
      animal: Animal;
      ink: string;
    };

export type ActivityKind = Activity['kind'];

/**
 * Who wins the island when several things are true at once. A run blocked on you beats
 * everything, because every second it waits is lost work. Then the transient beats (shipped,
 * a notice) so they are seen at all, then the reel you just shared (you are waiting on it), then
 * a demo, then the crew, which is the island's resting state while anything runs.
 */
export const PRIORITY: Record<ActivityKind, number> = {
  needsYou: 100,
  shipped: 80,
  notice: 70,
  drop: 60,
  demo: 50,
  crew: 40,
};

/** How long a transient beat holds before the island goes back to what it was showing. */
export const HOLD_MS: Partial<Record<ActivityKind, number>> = {
  shipped: 5200,
  notice: 2600,
};

/** A planned drop stays up this long after the answer landed, then steps aside. */
export const DROP_DONE_HOLD_MS = 9000;

export function lead(activities: readonly Activity[]): Activity | null {
  let best: Activity | null = null;
  for (const a of activities) {
    if (!best || PRIORITY[a.kind] > PRIORITY[best.kind]) best = a;
  }
  return best;
}

export type Mode = 'hidden' | 'compact' | 'toast' | 'expanded';

/**
 * The size an activity takes when nobody has touched it. A transient beat is a toast: it has a
 * sentence to say and then goes. A standing one sits compact beside the hardware island with its
 * two ears. Expanded is only ever a finger's decision.
 */
export function restingMode(a: Activity | null): Mode {
  if (!a) return 'hidden';
  switch (a.kind) {
    case 'shipped':
    case 'notice':
      return 'toast';
    case 'drop':
      return 'toast';
    default:
      return 'compact';
  }
}

export interface HardwareIsland {
  /** Centre x and y, in points. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface IslandBox {
  w: number;
  h: number;
  r: number;
}

/** How far each ear reaches past the hardware island in compact. */
export const EAR = 38;

/**
 * The box for a mode on this screen. `hidden` is the hardware island exactly (black on black, so
 * a morph out of it starts from the real thing); the rest grow from it, top edge fixed.
 * Expanded is the system island's own expanded proportions (full width less 8 a side, 44 radius).
 */
export function boxFor(mode: Mode, screenW: number, hw: HardwareIsland, expandedH = 172): IslandBox {
  switch (mode) {
    case 'hidden':
      return { w: hw.width, h: hw.height, r: hw.height / 2 };
    case 'compact':
      return { w: hw.width + EAR * 2, h: hw.height, r: hw.height / 2 };
    case 'toast':
      // Tall enough that the words sit BELOW the camera: the top 37 points of any island
      // shape are the hardware, and text under it is text nobody can read.
      return { w: Math.min(screenW - 20, 382), h: hw.height + 58, r: 36 };
    case 'expanded':
      return { w: screenW - 16, h: expandedH, r: 44 };
  }
}

/** Whole minutes as the island says them: "now", "4m", "1h 12m". */
export function minutesLabel(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h}h` : `${h}h ${r}m`;
}

/**
 * The same time for an ear of the compact island, which has 34 points: "12m" under the hour and
 * "1:02" after it, the system timer's own shape. "1h 2m" wrapped onto two lines there (seen on the
 * simulator an hour into this very session).
 */
export function earLabel(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h >= 10) return `${h}h`;
  return `${h}:${String(m % 60).padStart(2, '0')}`;
}

/** The wheel for a drop being read: where it is, and what comes next. */
export function dropSteps(a: Extract<Activity, { kind: 'drop' }>): { rows: { key: string; text: string }[]; index: number } {
  const done =
    a.phase === 'refused'
      ? 'Nothing to do with this one'
      : a.moves === 1
        ? '1 move ready'
        : `${a.moves} moves ready`;
  const rows = [
    { key: 'sent', text: `Sent to your Mac` },
    { key: 'reading', text: `Reading ${a.host}` },
    { key: 'done', text: done },
  ];
  const index = a.phase === 'sent' ? 0 : a.phase === 'reading' ? 1 : 2;
  return { rows, index };
}

/** The four dots in the right ear: one per agent running, in its creature's hue, at most four. */
export function crewDots(members: readonly CrewMember[]): string[] {
  return members.slice(0, 4).map((m) => m.ink);
}

/** The crew's face: the one that needs you if any does, else the one that started first. */
export function crewLead(members: readonly CrewMember[]): CrewMember | null {
  if (members.length === 0) return null;
  const waiting = members.find((m) => m.state === 'waiting');
  if (waiting) return waiting;
  return [...members].sort((a, b) => (a.startedMs ?? Infinity) - (b.startedMs ?? Infinity))[0] ?? null;
}

/**
 * What VoiceOver reads for the island. It is one element: the island is one object, and a reader
 * that walks its ears as two items describes the drawing, not the news.
 */
export function spoken(a: Activity | null, nowMs: number): string {
  if (!a) return '';
  switch (a.kind) {
    case 'needsYou':
      return `${a.repo} is waiting on you, ${minutesLabel(nowMs - a.sinceMs)}. ${a.sentence}`;
    case 'crew':
      return a.members.length === 1
        ? `${a.members[0]!.repo} is running. ${a.members[0]!.sentence}`
        : `${a.members.length} sessions running`;
    case 'drop': {
      const s = dropSteps(a);
      return s.rows[s.index]!.text;
    }
    case 'shipped':
      return a.summary;
    case 'demo':
      return a.ready ? `The demo of ${a.title} is ready` : `Cutting a demo of ${a.title}`;
    case 'notice':
      return a.text;
  }
}
