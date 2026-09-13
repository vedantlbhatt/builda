/**
 * The JS half of `BuilderSessionAttributes` (ios/BuilderSessionAttributes.swift, byte-identical
 * with targets/widget/_shared/). `__tests__/liveActivityAttributes.test.ts` holds the keys of
 * `SessionState` equal to the Swift `ContentState` and to the module's `SessionStateRecord`, so
 * a field added on one side and not the other fails a test instead of vanishing in the bridge.
 *
 * Every date is Unix SECONDS (a Double), never milliseconds and never a Date: JS, Swift and the
 * APNs `content-state` JSON then agree without an encoder.
 */

export type Phase = 'working' | 'needsYou' | 'done' | 'stalled';

/** The engine's verdict, or `none` when it has none yet (the caption then drops it). */
export type Trajectory = 'converging' | 'circling' | 'lost' | 'none';

/** `src/pixel/animals.ts` ANIMALS, plus the mascot. The widget draws Bit for anything else. */
export type CreatureId = 'crab' | 'octopus' | 'dog' | 'cat' | 'owl' | 'fox' | 'whale' | 'bee' | 'bit';

/** Static for the life of the activity. Mirrors BuilderSessionAttributes. */
export type SessionAttrs = {
  sessionId: string;
  repo: string;
  /** The harness id as the server names it: claude_code, codex, cursor_ide, gemini_cli, ... */
  agent: string;
  startedEpoch: number;
};

/**
 * Dynamic. Mirrors BuilderSessionAttributes.ContentState. Attributes plus this, as JSON, must
 * stay under ActivityKit's 4 KB; `payloadBytes` in src/live/surface.ts measures it.
 */
export type SessionState = {
  phase: Phase;
  /** One sentence, under 90 characters, from the engine's renderer or src/live/format.ts. */
  sentence: string;
  /** Elapsed over typical: 0..1 fills the ring, above 1 is running long, -1 is no honest number. */
  progress: number;
  /** -1 when nothing counted them. */
  filesTouched: number;
  /** Unix seconds a typical run like this one ends, or null to refuse an ETA. */
  etaEpoch: number | null;
  trajectory: Trajectory;
  creature: CreatureId;
  /** Null is unknown, never zero. */
  linesAdded: number | null;
  linesRemoved: number | null;
  commits: number | null;
  /** Other sessions running beside this one. */
  runningCount: number;
  updatedEpoch: number;
};

export type ContentOptions = {
  /** Seconds until `context.isStale` flips and the surfaces say "Not updating". */
  staleInSeconds?: number;
  /** Higher wins the Dynamic Island: 100 for needs you. */
  relevance?: number;
  /** Ask ActivityKit for a per-activity APNs token (the server does not send updates yet). */
  push?: boolean;
  /** update() only: lights the screen and expands the island. Only on the move into needs you. */
  alertTitle?: string;
  alertBody?: string;
  /** end() only: seconds the finished card stays on the Lock Screen (0 removes it now). */
  dismissAfterSeconds?: number;
};

export type ActivityInfo = { id: string; sessionId: string; state: 'active' | 'stale' | 'ended' | 'dismissed' | string };

export type BuilderLiveEvents = {
  onPushToken: (e: { activityId: string; sessionId: string; token: string }) => void;
  onPushToStartToken: (e: { token: string }) => void;
  onActivityState: (e: { activityId: string; sessionId: string; state: string }) => void;
};
