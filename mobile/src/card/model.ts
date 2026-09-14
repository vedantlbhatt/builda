/**
 * The share card's words and numbers, decided without React Native so `bun test` holds them
 * (`__tests__/repoLabel.test.ts`, `__tests__/shareCard.test.ts`); `RecapCard.tsx` draws them. The
 * notes on what the card says and leaves out are there.
 */
import { repoLabel, type RepoNames } from '../copy/repoLabel';
import type { SessionDetail } from '../data/api';
import { HELLO } from '../onboarding/copy';
import { duration } from '../theme';

/** The foot's line: the product's own words about itself (onboarding's first page), not a link. */
export const CARD_FOOT = HELLO.headline.replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase());

export interface CardModel {
  /** The repository's PUBLIC name, or null: the only name the share caption may carry. */
  repoName: string | null;
  /** What the card's header says: the public name, "Private project 2", else "private repo". */
  repoLabel: string;
  startedAt: number;
  activeSeconds: number;
  wallSeconds: number;
  title: string | null;
  choreTitle: boolean;
  prompts: number;
  filesTouched: number;
  agentLines: number;
  commits: number;
  tokensReported: boolean;
  totalTokens: number;
  modelName: string | null;
  agentLineBucket: string;
  attribConfidence: string;
  isPersonalRecord: boolean;
  strip: string;
  marks: number[][];
  harness: string;
}

const CHORE_PATTERN =
  /^(Check|Run|Debug the|Disable|Enable|List|Add file|Say|Clarify|Analyze|Toggle)\b/;

/**
 * `mostly_you` has no sentence on purpose. It means the agent's lines were under half of what
 * git counted in the window, and git also counts parallel sessions, generated files and
 * lockfiles, so nothing says who wrote the rest. FOUND IN THE now3 PASS (2026-09-14): a card
 * said "Most of these lines are yours" beside +507 lines its own page counted as the agent's,
 * with the person's edits at 0%. The card falls through to the next true fact instead.
 */
const BUCKET_COPY: Record<string, string> = {
  almost_all_agent: 'Nearly every line came from',
  nine_in_ten: '9 of every 10 lines came from',
  three_in_four: '3 of every 4 lines came from',
  about_half: 'About half the lines came from',
};

/**
 * The most remarkable TRUE fact available, in a fixed order of interest.
 *
 * Neither obvious option works alone. A duration is evaluable but not remarkable, and the
 * harness's own title is usually a chore-log entry — reading all 82 on the reference
 * machine turned up "Check backend service running on port 5001" and "Say hi in three
 * words". Leading with either produces a card that reads like a screenshotted ticket.
 */
export function headline(m: CardModel): string {
  if (m.isPersonalRecord) return `${duration(m.activeSeconds)}, longest session yet`;

  if (
    m.attribConfidence !== 'none' &&
    m.agentLineBucket !== 'unknown' &&
    m.agentLines >= 200 &&
    m.modelName
  ) {
    const copy = BUCKET_COPY[m.agentLineBucket];
    if (copy) {
      // "at least" is not decoration: human edits are counted as events with no line
      // count, so this is a lower bound. The hedge is also the more impressive phrasing.
      return `${copy} ${m.modelName}, at least`;
    }
  }

  if (m.commits >= 5) return `${m.commits} commits`;
  if (m.agentLines >= 1000) return `+${m.agentLines.toLocaleString()} lines`;
  if (m.activeSeconds >= 2700) return `${duration(m.activeSeconds)} in one sitting`;
  if (m.title && !m.choreTitle && m.title.length <= 60) return m.title;
  return duration(m.activeSeconds);
}

/** `names` is `data/repoNames.useRepoNames()`; without it a private project is "private repo". */
export function toCardModel(s: SessionDetail, names?: RepoNames | null): CardModel {
  const stats = (s.stats ?? {}) as Record<string, number | string | boolean | null>;
  const models = (stats.models as { model_id: string }[] | undefined) ?? [];
  const rawModel = models[0]?.model_id ?? null;

  const started = new Date(s.started_at).getTime() / 1000;
  const ended = new Date(s.ended_at).getTime() / 1000;

  return {
    repoName: s.repo_name?.trim() || null,
    repoLabel: repoLabel(s, names, 'outside'),
    startedAt: started,
    activeSeconds: s.active_seconds,
    wallSeconds: Math.max(ended - started, s.active_seconds),
    title: s.title,
    choreTitle: s.title ? CHORE_PATTERN.test(s.title) : false,
    prompts: Number(stats.human_prompt_count ?? 0),
    filesTouched: Number(stats.files_touched ?? 0),
    agentLines: Number(stats.lines_added_agent ?? 0),
    commits: Number(stats.commit_count ?? 0),
    tokensReported: Boolean(stats.tokens_reported),
    totalTokens:
      Number(stats.tok_in ?? 0) +
      Number(stats.tok_out ?? 0) +
      Number(stats.tok_cache_read ?? 0) +
      Number(stats.tok_cache_w5m ?? 0) +
      Number(stats.tok_cache_w1h ?? 0),
    modelName: shortModelName(rawModel),
    agentLineBucket: String(stats.agent_line_bucket ?? 'unknown'),
    attribConfidence: String(stats.attrib_confidence ?? 'none'),
    isPersonalRecord: false,
    strip: s.strip?.cols ?? '',
    marks: s.strip?.marks ?? [],
    harness: s.harness,
  };
}

/** "claude-opus-5[1m]" -> "Opus 5". The suffix is preserved on the wire, not on a card. */
function shortModelName(raw: string | null): string | null {
  if (!raw) return null;
  let s = raw.split('[')[0] ?? raw;
  s = s.replace('claude-', '');
  return s
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}
