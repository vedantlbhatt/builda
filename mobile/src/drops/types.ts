/**
 * What the drops routes answer with. The wire's own shapes are GENERATED
 * (`src/generated/drops.ts`, from spec/drops.v1.json); these are the ROW shapes the server adds
 * around them, and they are here rather than in `data/api.ts` so the board's types sit beside the
 * board's code.
 */
import type {
  DropKind,
  DropRefusal,
  DropResolution,
  DropStatus,
  Effort,
  MoveKind,
  MoveSource,
  MoveStatus,
  MoveTarget,
  MoveVerification,
  Platform,
} from '../generated/drops';

export interface DropRow {
  id: string;
  url: string;
  platform: Platform;
  status: DropStatus;
  /** Null until the Mac has planned it. */
  kind: DropKind | null;
  title: string | null;
  summary: string | null;
  thumbnail_url: string | null;
  refusal: DropRefusal | null;
  resolution: DropResolution | null;
  created_at: string;
  resolved_at: string | null;
  archived_at: string | null;
}

export interface MoveRow {
  id: string;
  drop_id: string;
  position: number;
  move_kind: MoveKind;
  status: MoveStatus;
  title: string;
  intent: string;
  evidence: string;
  target: MoveTarget;
  effort: Effort;
  source: MoveSource | null;
  verification: MoveVerification | null;
  adjustment: string | null;
  repo_key: string | null;
  /**
   * The Claude Code session the run became. Null until capture has uploaded the transcript, which
   * is where the loop closes; `run_uuid` says it RAN, this says it can be opened.
   */
  session_id: string | null;
  /** The id the `claude` run was launched with, on the person's own machine. Not a session id. */
  run_uuid: string | null;
  outcome: string | null;
  queued_at: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface BoardResponse {
  drops: DropRow[];
  moves: MoveRow[];
}

/** The tags a drop carries, or an empty list. Tags live inside the resolution's plan. */
export function tagsOf(drop: DropRow): string[] {
  return drop.resolution?.plan?.tags ?? [];
}

/** The recipe a drop carries, or null. */
export function recipeOf(drop: DropRow) {
  return drop.resolution?.plan?.recipe ?? null;
}

/** The moves that belong to one drop, in the order the planner ranked them. */
export function movesOf(moves: MoveRow[], dropId: string): MoveRow[] {
  return moves.filter((m) => m.drop_id === dropId).sort((a, b) => a.position - b.position);
}
