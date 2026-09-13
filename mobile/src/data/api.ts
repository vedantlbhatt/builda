import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

import type { BuilderNarrative } from '../generated/narrative';
import type { BuilderReport } from '../generated/report';
import type { ShippedPost } from '../generated/shipped';
import type { FeedbackNoteWire, SessionBurn, SessionTitleIds } from '../generated/contract';
import type { Archetype, Dimension, SessionAnalysis } from '../generated/analysis';
import type { Creature, LiveNames, LiveState } from '../generated/live';
import type { QuotesUpload } from '../generated/quotes';

/**
 * The phone's view of the server.
 *
 * These are READ shapes — what `server/builder/routes/sessions.py` serves — not the upload
 * wire type in `generated/contract.ts`. The two are deliberately unrelated: the phone never
 * uploads a session, and a `SessionDetail` that extended `SessionWire` would suggest the
 * phone can see fields (machine_id, repo_hash, tool_calls) that the server never returns
 * to it.
 */

/** Row from `session_stats`, as `GET /v1/sessions/{id}` serialises it. */
export interface SessionStats {
  tokens_reported: boolean;
  /** Null, never zero, when the harness does not report tokens. Cursor never does. */
  tok_in: number | null;
  tok_out: number | null;
  tok_cache_read: number | null;
  tok_cache_w5m: number | null;
  tok_cache_w1h: number | null;
  models: { model_id: string; output_token_share: number }[] | null;
  model_state: string;
  human_prompt_count: number;
  prompt_count_basis: string;
  files_touched: number;
  lines_added_agent: number;
  /**
   * Lines the agent removed (docs/overnight-integration.md 5.4). Optional on READ, and read
   * as absent, never as 0: a server older than 5.4 omits it, and so does every detail this
   * phone cached before it (the cache never re-reads a final session it holds a strip for).
   * The Live Activity's `linesRemoved` and the money view print nothing rather than "0".
   */
  lines_removed_agent?: number;
  commit_count: number;
  agent_line_bucket: string;
  attrib_confidence: string;
  // Forward-compatible: a newer server may add a stat this build does not name yet, and
  // the card reads stats through a loose Record anyway.
  [key: string]: unknown;
}

export interface SessionStrip {
  /** base64 of the 1024-byte column array; decode with `strip/decode.ts`. */
  cols: string;
  /** [[ms, kind], ...] */
  marks: number[][];
  t0_ms: number;
  t1_ms: number;
}

/**
 * `live` is an open or idle session the Mac is still uploading snapshots of; `final` is
 * one that has ended. The server keeps ONE row per session and flips its state, so the id
 * is stable across the transition — the cache upserts by id and never sees two rows.
 */
export type SessionState = 'live' | 'final';

/** See docs/session-boundaries.md. `still_running` is the end reason of a live snapshot. */
export type EndReason =
  | 'idle_gap'
  | 'human_returned'
  | 'day_boundary'
  | 'still_running'
  // v3 (docs/session-boundaries.md): a `/clear`, and a human opening a session in another repo.
  | 'cleared'
  | 'switched_repo';

export interface SessionDetail {
  id: string;
  client_session_id: string;
  harness: string;
  repo_name: string | null;
  started_at: string;
  ended_at: string;
  active_seconds: number;
  idle_seconds: number;
  local_date: string;
  title: string | null;
  title_source: string | null;
  notable: boolean;
  unattended: boolean;
  timeline_fidelity: string;
  is_shared: boolean;
  /**
   * The VIEWER'S OWN post for this session (any visibility), null when there is none. The
   * server sends it on every session shape (list, live, profile live, detail); it is
   * optional here only because a server older than the field omits it, and the screen
   * must read "unknown" rather than "no post" from that absence.
   */
  post_id?: string | null;
  /** Only on the detail endpoint; absent from the list. Null when no strip was stored. */
  strip?: SessionStrip | null;
  stats?: SessionStats | null;

  // ---- Session boundaries v2. Every field is optional on READ: a server older than the
  // ---- split omits them all, and the screens read `?? 0` / `?? 'final'` rather than
  // ---- inventing a number the server never sent.
  state?: SessionState;
  end_reason?: EndReason;
  /** Active seconds while a human was evidently present. */
  attended_seconds?: number;
  /** Active seconds after the human went quiet for longer than tauAutonomousSec. */
  autonomous_seconds?: number;
  /** Count of presence signals (typed prompts, interrupts, human edits). */
  presence_count?: number;
  /**
   * The model-written reading of the session (spec/analysis.v1.json). Undefined when the
   * endpoint did not include it; null when the server has none. A live session may carry
   * a checkpoint analysis.
   */
  analysis?: SessionAnalysis | null;
  /**
   * What this sitting cost that you would not have chosen: at most three notes, each an
   * id and two integers (contract v3). The SENTENCE is written here, on the client, from
   * the id — see `src/session/feedback.ts` — so nothing about the wording is on the wire,
   * and neither is the failing command or the file name the local note carries.
   *
   * Null means the sitting had nothing worth saying, or the client that uploaded it does
   * not compute feedback; both render as no notes. Undefined means a server older than
   * 0019 that does not know the key.
   */
  feedback?: FeedbackNoteWire[] | null;
  updated_at?: string;

  // ---- Contract v4 (docs/overnight-integration.md sections 2 and 3, and its addendum).
  // ---- Every one is optional on READ: undefined is a server older than the field; null is
  // ---- a server that knows the field and has nothing for this session.

  /**
   * What a RUNNING session is doing now (`spec/live.v1.json`), computed by the engine on the
   * machine or by the hook channel. Null on a final session: the row is deleted when the
   * session finalises, and the cache drops it on that transition too.
   *
   * TWO BODIES, ONE TYPE. On `GET /v1/sessions/live` and `/v1/profile`'s `live` rows it is
   * the SLIM body: `timelapse` null and `map.files` cut to the rows `activity.file_id` and
   * `verdict.file_id` name (`map.files_total` still counts every file). On
   * `GET /v1/sessions/{id}` it is the full body. Mission control, the widget and the Live
   * Activity read only activity, verdict, eta, needs_you and decisions, which both carry.
   *
   * `computed_at` is when the state was true: `activity.since_s` and the ETA are aged from
   * it, never from the moment the phone happened to fetch it.
   */
  live_state?: LiveState | null;
  /**
   * OPT IN, OFF BY DEFAULT: the basename of each file in `live_state.map`, keyed by its id.
   * Only on the detail endpoint, only while Settings > File names is on, and only ever shown
   * on the session screen: never on the Lock Screen, the widget, a push or a share. The
   * live list never carries it, so nothing that feeds ActivityKit can see one.
   */
  live_names?: LiveNames | null;
  /**
   * Where this sitting's tokens went and whether anything came of it (`analysis/burn.py`
   * over the session window): counts, unrounded shares, enums and at most three costly
   * stretches. The sentences are written on the phone (`src/copy/burn.ts`). Null when the
   * producer does not compute it; a refusal is `burn.reason`, never a zero.
   */
  burn?: SessionBurn | null;
  /**
   * The engineer voice title as ids (`analysis/vocab.py` session_title): a verb and an
   * object from fixed tables and the numbers the title says. Rendered on the phone
   * (`src/copy/title.ts`); no file or directory name travels. Null when no title rule
   * fired, or the producer does not compute it.
   */
  title_ids?: SessionTitleIds | null;
}

export interface Profile {
  graph: { date: string; active_seconds: number }[];
  totals: { sessions: number; active_seconds: number };
  /** Ranked by ATTENDED time on a v2 server — a robot cannot hold the record. */
  longest_session: {
    id: string;
    active_seconds: number;
    started_at: string;
    attended_seconds?: number;
  } | null;
  projects: {
    key: string;
    name: string | null;
    sessions: number;
    active_seconds: number;
    first_at: string;
    last_at: string;
  }[];
  attribution: {
    agent_lines: number;
    human_edit_events: number;
    prompts: number;
    attended_seconds?: number;
    autonomous_seconds?: number;
  };
  /**
   * Sessions the Mac is still uploading. Absent on a server older than the split. Each row
   * carries the SLIM `live_state` (see `SessionDetail.live_state`) and never `live_names`.
   */
  live?: SessionDetail[];
  /**
   * The aggregate of the session analyses (server/builder/builder_profile.py). Undefined
   * on a server that predates it; null until three analysed sessions exist in the window,
   * because docs/analysis.md forbids reading an archetype off one run.
   */
  builder_profile?: BuilderProfile | null;
}

/** One dimension's aggregate: mean 0-100 over `sessions`, and recent-half minus older-half. */
export interface BuilderDimension {
  mean: number;
  sessions: number;
  /** Points, rounded to 0.1. Null with too few sessions to split into halves. */
  trend: number | null;
}

/** The modal archetype and the whole distribution. `share` is out of `with_archetype`. */
export interface BuilderArchetype {
  modal: Archetype | null;
  share: number | null;
  /** How many analysed sessions had an archetype at all; short sessions get none. */
  with_archetype: number;
  distribution: Record<string, number>;
}

/** The modal value of one build-style key, its share of the sessions that set it, and the counts. */
export interface BuilderMode {
  mode: string | null;
  share: number | null;
  distribution: Record<string, number>;
}

/**
 * `GET /v1/profile` → `builder_profile`, field for field as the server serialises it.
 * `dimensions` is keyed by dimension name, not a list; a session's archetype share is out
 * of the sessions that HAD one (`with_archetype`), not all of them.
 */
export interface BuilderProfile {
  window_days: number;
  sessions_analysed: number;
  confidence_mean: number | null;
  dimensions: Partial<Record<Dimension, BuilderDimension>>;
  archetype: BuilderArchetype;
  build_style: Record<string, BuilderMode>;
  prompting: {
    specificity_mean: number | null;
    correction_share_mean: number | null;
    question_share_mean: number | null;
    tone_distribution: Record<string, number>;
  };
  /** Ranked most-sessions first, ties by name; at most 8. */
  tags: { tag: string; sessions: number }[];
  /** Ranked like tags; at most 5. `example` is the most recent verbatim excerpt. */
  decision_patterns: { pattern: string; sessions: number; example: string }[];
}

// ---------------------------------------------------------- the corpus profile
// `GET /v1/profile/builder` → `corpus`, field for field as `analysis/profile.py`
// serialises it. Nothing here is model-written: it is arithmetic over every final,
// visible session in the window, so the same corpus always produces the same profile.

/**
 * One computed metric.
 *
 * `value: null` is NOT zero and must never render as one. It means the metric was
 * REFUSED, and `reason` says why in a sentence meant for a person: the sample was too
 * small, or the input is structurally absent on this server (prompt wording never leaves
 * the machine, so anything derived from prompt text is null through the API by design).
 * `basis` names the data it was computed from, because the same metric means a different
 * thing read from transcripts than read from uploaded counts.
 */
export interface CorpusMetric {
  /**
   * A number for every metric except `busiest_day`, which is a local date string. Typed
   * as the union rather than special-cased: a screen that assumed number would render
   * `NaN` for that one key, and the whole point of this block is that it never states a
   * number it did not measure.
   */
  value: number | string | null;
  unit: string;
  n: number;
  basis: string;
  reason: string | null;
  /**
   * Per-metric extras the server attaches: `planning_ratio` carries its two prompt
   * counts, `steer_rate` its interrupts and corrective prompts, `code_velocity` its
   * `write_events` (null where the writes cannot be counted at all, which is not zero),
   * `night_share` and `short_prompt_share` a `note`, `busiest_day` its active seconds.
   */
  [extra: string]: unknown;
}

/** What a fact was ranked against, so the screen can say where the number sits. */
export interface FactBaseline {
  value: number;
  scale: number;
  source: string;
}

/** One ranked sentence in the second person. `unusualness` sorts them, most first. */
export interface CorpusFact {
  id: string;
  text: string;
  value: number | null;
  unit: string;
  unusualness: number;
  /** Null on a fact that was not ranked against one: the peak hour, the streak, the
   *  totals, the model mix, the top tool. */
  baseline: FactBaseline | null;
}

/** One archetype rule and how this corpus scored against it. */
export interface ArchetypeScore {
  name: string;
  metric: string;
  value: number | null;
  threshold: number;
  /** `value / threshold`, halved, so meeting the threshold exactly is 0.5. Null: the
   *  metric it reads was refused, so the rule did not score and cannot win. */
  score: number | null;
  rule: string;
}

/**
 * The archetype the deterministic rules chose.
 *
 * `name` is null when no rule met its threshold or the corpus is too small, and `reason`
 * says which. The rules can return `director` and `skeptic`, which are NOT in the
 * per-session `Archetype` enum, so this is a plain string.
 */
export interface CorpusArchetype {
  name: string | null;
  confidence: number | null;
  reason: string | null;
  /** The winning rule, all four null together when nothing won. `scores` still carries
   *  every rule, so a corpus with no type can still say which one it came closest to. */
  metric: string | null;
  value: number | null;
  threshold: number | null;
  rule: string | null;
  scores: ArchetypeScore[];
  runners_up: { name: string; score: number | null; metric: string; value: number | null }[];
}

export interface CorpusProfile {
  profile_version: number;
  generated_at: string;
  sample: {
    sessions: number;
    sessions_with_prompt_text: number;
    prompts: number;
    prompts_with_text: number;
    tool_calls: number;
    active_hours: number;
    days: number;
    min_sessions: number;
    enough_sessions: boolean;
    /** Metric name → why it is null. Shown verbatim; these are the honesty of the screen. */
    missing: Record<string, string>;
  };
  totals: {
    total_sessions: number;
    total_hours: number;
    total_prompts: number;
    total_lines_added: number;
    /**
     * Null when the corpus holds two sessions that overlapped in one repository. Each
     * session's own count is right; the SUM is not, because both asked git what landed in
     * their window and both got the same commits. `commit_basis` says
     * `overlapping_session_windows` when that is why.
     */
    total_commits: number | null;
    commit_basis: string;
    total_tool_calls: number;
  };
  metrics: Record<string, CorpusMetric>;
  top_tools: { tool: string; calls: number; share: number }[];
  model_mix: { model: string; output_tokens: number; share: number }[];
  /**
   * The top five sessions by ATTENDED time, best first, and how many were eligible at
   * all. Ranked on attended and never on active, and `unattended` runs are excluded
   * outright: an eight-hour autonomous run is not a personal record.
   */
  session_rank: {
    rank: number;
    session_id: string;
    attended_seconds: number;
    active_seconds: number;
    started_at: string;
  }[];
  ranked_sessions: number;
  archetype: CorpusArchetype;
  facts: CorpusFact[];
}

/**
 * `GET /v1/profile/builder`. Two different kinds of profile under one route:
 * `builder_profile` aggregates what a MODEL wrote about each session and is null until
 * `min_sessions` of them are analysed; `corpus` is computed and needs no analysis at all.
 * `corpus` null means only one thing: the metrics module is not deployed on that server.
 */
export interface BuilderProfileResponse {
  builder_profile: BuilderProfile | null;
  sessions_analysed: number;
  min_sessions: number;
  window_days: number;
  corpus: CorpusProfile | null;
  /**
   * The "how you work" page: the only prose on this screen, and the only part of the
   * profile a model wrote. Null means nobody has run `python -m capture narrative` for
   * this account, which is the normal state until they do; the shape is generated from
   * the same spec the server validates against (`generated/narrative.ts`).
   *
   * Optional on READ: a server older than 0016 omits the key entirely, and the screen
   * then shows what it always showed rather than an empty section.
   */
  narrative?: BuilderNarrative | null;
  /**
   * The MEASURED half of the profile: trends against the window before, subagent
   * fan-out, commits split by whether an agent was in the room, time to green, and how
   * often a prompt lands clean. The server computes none of it — it rests on sidecar
   * transcripts, shell command text, prompt text and commit times, none of which the
   * upload contract puts on the wire — so it arrives from `python -m capture report`.
   *
   * Null until that has run; optional on READ because a server older than 0018 omits the
   * key. Both are the same thing on screen: the sections are absent, not empty.
   */
  report?: BuilderReport | null;
  /**
   * THE SECOND OPT IN EXCEPTION (contract v4 `quotes`): up to three of the owner's prompts,
   * verbatim, for the Wrapped cards that quote them (go to prompt, crash out, cryptic
   * prompt). Owner only, and only while BOTH Settings > Quotes and `--quotes` on the
   * machine said yes. Null when there are none; undefined from a server older than 0021.
   * Never put one in a post, a share, a push or an activity.
   */
  quotes?: QuotesUpload | null;
}

// ------------------------------------------------------------------ privacy
// `server/builder/routes/privacy.py` (docs/overnight-integration.md 2.3 and 2.4). Two
// switches, both OFF by default, each one the only thing that lets its data reach the
// server, and each one DELETES that data when it is turned off.

/**
 * `GET /v1/privacy/prefs`. The account's map salt lives beside these on the server and is
 * never returned: a salt the phone held could be used to test a guessed path against a
 * file id.
 */
export interface PrivacyPrefs {
  /** Quote my prompts on my cards: the contract v4 `quotes` document. */
  quotes: boolean;
  /** File names: the contract v4 `live_names` basenames beside a running session's map. */
  live_names: boolean;
}

/** The body of `PUT /v1/privacy/prefs`: either key, or both. */
export type PrivacyPrefsUpdate = Partial<PrivacyPrefs>;

/**
 * The answer to `PUT /v1/privacy/prefs`: the prefs as they now stand, plus how many quotes
 * the same transaction deleted when `quotes` went off. Absent when nothing was deleted.
 */
export interface PrivacyPrefsResult extends PrivacyPrefs {
  quotes_deleted?: number;
}

// -------------------------------------------------------------- live activities
// `POST /v1/push/live-activity` (docs/overnight-integration.md 3.6). The server pushes
// `liveactivity` updates to these tokens on a phase or trajectory change only.

/** The APNs host a token was issued for. Debug builds get sandbox tokens. */
export type PushEnvironment = 'sandbox' | 'production';

/**
 * One ActivityKit token. `kind: 'activity'` is an update token for one running activity,
 * which names its server session and ActivityKit's own id; `push_to_start` (iOS 17.2+)
 * names neither. The migration's CHECK holds the two together, so the type does too.
 *
 * The creature rides on the token because the server stores no creature and the Live
 * Activity's ContentState requires one.
 */
export type LiveActivityRegistration =
  | {
      kind: 'activity';
      /** The server's session uuid (`SessionDetail.id`), not the client session id. */
      session_id: string;
      /** ActivityKit's `Activity.id`, the key `forgetLiveActivity` deletes by. */
      activity_id: string;
      /** The push token, hex. */
      token: string;
      environment: PushEnvironment;
      creature: Creature;
    }
  | {
      kind: 'push_to_start';
      token: string;
      environment: PushEnvironment;
      creature: Creature;
    };

// ------------------------------------------------------------------ social
// Read shapes mirror `server/builder/routes/social.py` field for field. A feed item is
// self-contained (one request renders the screen); the cursor pair `next_before` /
// `next_before_id` is null on the last page.

export type Visibility = 'private' | 'followers' | 'public';

export interface Author {
  handle: string | null;
  display_name: string | null;
  /**
   * Compared server-side against the viewer. Optional on READ: a server older than
   * `routes/users.py` omits it, and the screens then simply lack the owner-only controls
   * rather than guessing ownership from a remembered handle.
   */
  is_you?: boolean;
}

export interface PostMedia {
  id: string;
  kind: 'photo' | 'audio';
  object_key: string;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  position: number;
  url: string | null;
}

/**
 * Headline + summary only, unless the author set `share_analysis`, in which case the
 * whole `SessionAnalysis` document is present. Read the two named fields; treat the rest
 * as optional.
 */
export interface FeedAnalysis extends Partial<Omit<SessionAnalysis, 'headline' | 'summary'>> {
  headline?: string | null;
  summary?: string | null;
}

export interface FeedItem {
  id: string;
  author: Author;
  caption: string | null;
  visibility: Visibility;
  share_analysis: boolean;
  created_at: string;
  updated_at: string;
  /**
   * NULL ON A BUILD POST. A session post is about one sitting and has one; a build post
   * (0017) is about a PROJECT across as many sittings as it took, so there is no single
   * session to show. Every reader of this field has to branch, which is the point of
   * making it nullable rather than inventing an empty session to keep the type simple.
   */
  session: SessionDetail | null;
  /**
   * The build post itself, or null on a session post. Written on the author's machine by
   * `python -m analysis shipped` under spec/shipped.v1.json; the server validated it and
   * stored it whole. Optional on READ because a server older than 0017 omits the key.
   */
  shipped?: ShippedPost | null;
  /** The repository's public name, when it has one. Present on both kinds of post. */
  project?: string | null;
  strip: SessionStrip | null;
  analysis: FeedAnalysis | null;
  photos: PostMedia[];
  audio: PostMedia | null;
  kudos_count: number;
  comment_count: number;
  you_kudosed: boolean;
}

export interface FeedPage {
  items: FeedItem[];
  next_before: string | null;
  next_before_id: string | null;
}

export interface PostCreate {
  session_id: string;
  caption?: string | null;
  visibility: Visibility;
  share_analysis?: boolean;
}

export interface PostPatch {
  caption?: string | null;
  visibility?: Visibility;
  share_analysis?: boolean;
}

export interface KudosState {
  kudos_count: number;
  you_kudosed: boolean;
}

export interface Comment {
  id: string;
  post_id: string;
  author: Author;
  body: string;
  created_at: string;
}

export type FollowState = 'accepted' | 'pending' | null;

export interface UserPage {
  profile: {
    handle: string;
    display_name: string | null;
    profile_public: boolean;
    created_at: string;
    is_you: boolean;
    /** 'accepted', 'pending', or null. Null for yourself as well. */
    follow_state: FollowState;
  };
  posts: FeedItem[];
  next_before: string | null;
  next_before_id: string | null;
}

export interface Faction {
  slug: string;
  name: string;
  open: boolean;
  tz: string;
  role?: 'admin' | 'member' | null;
  /** Admins only; the server withholds it from members. */
  join_code?: string;
}

/**
 * One row of `GET /v1/factions/mine` and of `GET /v1/users/me`'s `factions` — the viewer's
 * own memberships, oldest first (`server/builder/routes/users.py::_my_factions`).
 */
export interface MyFaction {
  slug: string;
  name: string;
  role: 'admin' | 'member';
  share_hours: boolean;
  open: boolean;
  member_count: number;
  joined_at: string;
}

/** `GET /v1/users/me` and the answer to `PATCH /v1/users/me`: the viewer's own row. */
export interface Me {
  id: string;
  /** Null until the person picks one. */
  handle: string | null;
  display_name: string | null;
  profile_public: boolean;
  created_at: string;
  factions: MyFaction[];
}

/**
 * Body of `PATCH /v1/users/me`. Omit a field to leave it alone; `display_name: null`
 * clears it (the server reads the field SET, not its value, for that one).
 */
export interface MePatch {
  handle?: string;
  display_name?: string | null;
  profile_public?: boolean;
}

// ------------------------------------------------------------ capture keys
// Read shapes mirror `server/builder/routes/capture_keys.py`. A key is the non-rotating
// credential a cloud container uploads with (docs/cloud-capture.md); it can reach the two
// sync routes and nothing else, so nothing here ever needs to read one back.

/** One row of `GET /v1/capture-keys`: no secret, only the prefix the phone shows. */
export interface CaptureKey {
  id: string;
  name: string;
  /** `bck_` plus four characters — enough to tell keys apart, never enough to use one. */
  key_prefix: string;
  created_at: string;
  /** Null until the key's first upload; touched at most once a minute after that. */
  last_used_at: string | null;
}

/**
 * The answer to `POST /v1/capture-keys`. `key` is the plaintext and this response is the
 * ONLY time it exists outside the caller's hands: the server stores a hash. Show it once,
 * offer to copy it, and never keep it in state longer than the screen that shows it.
 */
export interface CaptureKeyCreated extends Omit<CaptureKey, 'last_used_at'> {
  key: string;
}

export interface FactionBoardMember extends Author {
  role: 'admin' | 'member';
  share_hours: boolean;
  you: boolean;
  attended_seconds: number;
  sessions: number;
  longest_attended_seconds: number;
}

export interface FactionBoard {
  faction: Faction;
  /** ISO week, e.g. "2026-W33". */
  week: string;
  week_start: string;
  week_end: string;
  /** Ranked by attended hours, the server's order. Opted-out members carry zeros. */
  members: FactionBoardMember[];
}

export interface PresignRequest {
  kind: 'photo' | 'audio';
  content_type: string;
  bytes: number;
}

export interface Presign {
  upload_url: string;
  object_key: string;
  method: 'PUT';
  headers: Record<string, string>;
  expires_in: number;
}

export interface MediaAttach {
  object_key: string;
  kind?: 'photo' | 'audio';
  width?: number;
  height?: number;
  duration_ms?: number;
}

export const PRESIGN_UNCONFIGURED_MESSAGE = "Photo upload isn't configured on this server yet.";

/** Keyset cursor for the feed and the user page. Both fields come from the previous page. */
export interface Cursor {
  before?: string | null;
  beforeId?: string | null;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
}

export type RepoVisibility = 'public' | 'anonymous' | 'excluded';

/** What a transport failure says on screen (ApiError status 0). */
export const OFFLINE_MESSAGE = 'Builda is not reachable right now.';
/** What a request that ran past the timeout says on screen. */
export const TIMEOUT_MESSAGE = 'Builda took too long to answer.';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** The two secrets the app holds. Injected so the class is testable without a keychain. */
export interface TokenStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const ACCESS_KEY = 'builder.access';
const REFRESH_KEY = 'builder.refresh';
const TIMEOUT_MS = 20_000;

const secureStorage: TokenStorage = {
  get: (k) => SecureStore.getItemAsync(k),
  set: (k, v) => SecureStore.setItemAsync(k, v),
  remove: (k) => SecureStore.deleteItemAsync(k),
};

function appVersion(): string {
  return Constants.expoConfig?.version ?? 'ios';
}

/**
 * ONE refresh in flight at a time, across every concurrent request.
 *
 * Refresh tokens rotate: redeeming one issues a new one and burns the old. If two requests
 * both hit 401 and both call /refresh with the same token, the second redemption is
 * "reuse" and the server revokes every token for the device — the user is signed out by
 * their own app for scrolling too fast. So the second caller waits on the first's promise.
 */
let refreshing: Promise<void> | null = null;

export class Api {
  private readonly baseUrl: string;
  private readonly storage: TokenStorage;
  // undefined = not read from storage yet; null = read, and absent.
  private access: string | null | undefined;
  private refresh: string | null | undefined;

  constructor(baseUrl: string, storage: TokenStorage = secureStorage) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.storage = storage;
  }

  // ----------------------------------------------------------------- tokens

  private async loadTokens(): Promise<void> {
    if (this.access !== undefined && this.refresh !== undefined) return;
    try {
      const [a, r] = await Promise.all([
        this.storage.get(ACCESS_KEY),
        this.storage.get(REFRESH_KEY),
      ]);
      this.access = a;
      this.refresh = r;
    } catch {
      this.access = null;
      this.refresh = null;
    }
  }

  async isSignedIn(): Promise<boolean> {
    await this.loadTokens();
    return Boolean(this.access && this.refresh);
  }

  async setTokens(access: string, refresh: string): Promise<void> {
    this.access = access;
    this.refresh = refresh;
    await Promise.all([this.storage.set(ACCESS_KEY, access), this.storage.set(REFRESH_KEY, refresh)]);
  }

  async clearTokens(): Promise<void> {
    this.access = null;
    this.refresh = null;
    await Promise.all([this.storage.remove(ACCESS_KEY), this.storage.remove(REFRESH_KEY)]);
  }

  // ------------------------------------------------------------------- auth

  signInWithApple(identityToken: string, machineId: string): Promise<TokenPair> {
    return this.request<TokenPair>('POST', '/v1/auth/apple', {
      body: {
        identity_token: identityToken,
        machine_id: machineId,
        label: 'iPhone',
        platform: 'ios',
        agent_version: appVersion(),
      },
      auth: false,
    });
  }

  signInWithGoogle(
    idToken: string,
    machineId: string,
    platform: 'ios' | 'android'
  ): Promise<TokenPair> {
    return this.request<TokenPair>('POST', '/v1/auth/google', {
      body: {
        id_token: idToken,
        machine_id: machineId,
        label: 'Phone',
        platform,
        agent_version: appVersion(),
      },
      auth: false,
    });
  }

  approvePairing(code: string): Promise<{ status: string; label: string; platform: string }> {
    return this.request('POST', '/v1/auth/device/approve', { body: { user_code: code } });
  }

  deleteAccount(): Promise<{ status: string; row_counts: Record<string, number>; receipt: string }> {
    return this.request('POST', '/v1/account/delete');
  }

  // ------------------------------------------------------------------- data

  /** `/v1/profile` reads `days`, the width of the activity graph. */
  profile(days = 119): Promise<Profile> {
    return this.request('GET', `/v1/profile?days=${encodeURIComponent(days)}`);
  }

  /**
   * The builder profile on its own, so the screen can refresh the part that changes
   * without refetching the graph, the projects and every live session with it.
   *
   * `/v1/profile/builder` reads `window_days` (default 90, at most 365). This used to send
   * `?days=119`, a name the route does not read, so every answer was the 90 day default
   * and nothing said so (docs/overnight-integration.md 5.3). The answer's own
   * `window_days` is the window it actually used; a screen says that one, never the one
   * it asked for.
   */
  builderProfile(windowDays = 90): Promise<BuilderProfileResponse> {
    return this.request('GET', `/v1/profile/builder?window_days=${encodeURIComponent(windowDays)}`);
  }

  sessions(opts: { limit?: number; before?: string | null; notable_only?: boolean } = {}): Promise<{
    sessions: SessionDetail[];
    next_before: string | null;
  }> {
    const q = new URLSearchParams();
    if (opts.limit !== undefined) q.set('limit', String(opts.limit));
    if (opts.before) q.set('before', opts.before);
    if (opts.notable_only !== undefined) q.set('notable_only', String(opts.notable_only));
    const qs = q.toString();
    return this.request('GET', `/v1/sessions${qs ? `?${qs}` : ''}`);
  }

  session(id: string): Promise<SessionDetail> {
    return this.request('GET', `/v1/sessions/${encodeURIComponent(id)}`);
  }

  /** Sessions in state `live`, newest updated first, at most 10. */
  liveSessions(): Promise<{ sessions: SessionDetail[] }> {
    return this.request('GET', '/v1/sessions/live');
  }

  registerPush(
    token: string,
    environment: 'sandbox' | 'production'
  ): Promise<{ status: string; environment: string }> {
    return this.request('POST', '/v1/push/register', { body: { token, environment } });
  }

  setRepoVisibility(
    repoHash: string,
    visibility: RepoVisibility
  ): Promise<{ status: string; visibility: string; sessions_deleted: number }> {
    return this.request('POST', '/v1/repos/visibility', {
      body: { repo_hash: repoHash, visibility },
    });
  }

  // ---------------------------------------------------------------- privacy

  /** The two opt in switches as the account holds them. Both are false until turned on. */
  privacyPrefs(): Promise<PrivacyPrefs> {
    return this.request('GET', '/v1/privacy/prefs');
  }

  /**
   * Flip one switch or both. Only a phone can (the route takes a device token). Turning
   * `quotes` off deletes every stored quote in the same transaction and the answer says how
   * many (`quotes_deleted`); turning `live_names` off clears every stored name. Only the
   * keys given are sent, so flipping one never rewrites the other.
   */
  setPrivacyPrefs(prefs: PrivacyPrefsUpdate): Promise<PrivacyPrefsResult> {
    const body: PrivacyPrefsUpdate = {};
    if (prefs.quotes !== undefined) body.quotes = prefs.quotes;
    if (prefs.live_names !== undefined) body.live_names = prefs.live_names;
    return this.request('PUT', '/v1/privacy/prefs', { body });
  }

  /** Delete every stored quote now, whatever the switch says. 204. */
  async deleteQuotes(): Promise<void> {
    await this.request<unknown>('DELETE', '/v1/profile/quotes');
  }

  // -------------------------------------------------------- live activities

  /**
   * Hand the server an ActivityKit token, from `onPushToken`. Upserted on (account, token),
   * so posting the same token twice is harmless.
   */
  async registerLiveActivity(body: LiveActivityRegistration): Promise<void> {
    await this.request<unknown>('POST', '/v1/push/live-activity', { body });
  }

  /** The activity ended on the phone: forget its token so nothing pushes to it again. 204. */
  async forgetLiveActivity(activityId: string): Promise<void> {
    await this.request<unknown>('DELETE', `/v1/push/live-activity/${encodeURIComponent(activityId)}`);
  }

  // ----------------------------------------------------------------- social

  private cursorQuery(cursor: Cursor | undefined, extra: Record<string, string> = {}): string {
    const q = new URLSearchParams(extra);
    if (cursor?.before) {
      q.set('before', cursor.before);
      // The id is the tiebreaker; sending it without a timestamp is meaningless and the
      // server ignores it, so it rides only alongside `before`.
      if (cursor.beforeId) q.set('before_id', cursor.beforeId);
    }
    const qs = q.toString();
    return qs ? `?${qs}` : '';
  }

  /** People you follow, members of your factions, and you. Newest first, ≤ 30 per page. */
  feed(cursor?: Cursor): Promise<FeedPage> {
    return this.request('GET', `/v1/feed${this.cursorQuery(cursor)}`);
  }

  /** Same shape as `feed`, scoped to one faction. 403 until you join it. */
  factionFeed(slug: string, cursor?: Cursor): Promise<FeedPage> {
    return this.request(
      'GET',
      `/v1/feed/faction/${encodeURIComponent(slug)}${this.cursorQuery(cursor)}`
    );
  }

  post(id: string): Promise<FeedItem> {
    return this.request('GET', `/v1/posts/${encodeURIComponent(id)}`);
  }

  /** Share a session. The session must be the caller's and `final`. Returns the feed item. */
  createPost(body: PostCreate): Promise<FeedItem> {
    return this.request('POST', '/v1/posts', { body });
  }

  updatePost(id: string, body: PostPatch): Promise<FeedItem> {
    return this.request('PATCH', `/v1/posts/${encodeURIComponent(id)}`, { body });
  }

  deletePost(id: string): Promise<void> {
    return this.request('DELETE', `/v1/posts/${encodeURIComponent(id)}`);
  }

  kudos(postId: string): Promise<KudosState> {
    return this.request('POST', `/v1/posts/${encodeURIComponent(postId)}/kudos`);
  }

  unkudos(postId: string): Promise<KudosState> {
    return this.request('DELETE', `/v1/posts/${encodeURIComponent(postId)}/kudos`);
  }

  /** Flat, oldest first, not paginated. */
  comments(postId: string): Promise<{ comments: Comment[] }> {
    return this.request('GET', `/v1/posts/${encodeURIComponent(postId)}/comments`);
  }

  addComment(postId: string, body: string): Promise<Comment & { comment_count: number }> {
    return this.request('POST', `/v1/posts/${encodeURIComponent(postId)}/comments`, {
      body: { body },
    });
  }

  deleteComment(commentId: string): Promise<void> {
    return this.request('DELETE', `/v1/comments/${encodeURIComponent(commentId)}`);
  }

  /** Immediate for a public profile (`accepted`), a request otherwise (`pending`). */
  follow(handle: string): Promise<{ handle: string; state: FollowState }> {
    return this.request('POST', `/v1/follows/${encodeURIComponent(handle)}`);
  }

  unfollow(handle: string): Promise<void> {
    return this.request('DELETE', `/v1/follows/${encodeURIComponent(handle)}`);
  }

  /** The caller is the followee; `handle` is who asked. */
  acceptFollow(handle: string): Promise<{ handle: string; state: 'accepted' }> {
    return this.request('POST', `/v1/follows/${encodeURIComponent(handle)}:accept`);
  }

  /** Profile plus the posts the CALLER may see, keyset paginated like the feed. */
  user(handle: string, cursor?: Cursor): Promise<UserPage> {
    return this.request(
      'GET',
      `/v1/users/${encodeURIComponent(handle)}${this.cursorQuery(cursor)}`
    );
  }

  // ----------------------------------------------------------------- account

  /** The viewer's own row plus their factions, in one request. */
  getMe(): Promise<Me> {
    return this.request('GET', '/v1/users/me');
  }

  /**
   * Handle, display name, profile visibility; answers with the same shape as `getMe`.
   * 422 for a malformed or reserved handle, 409 when it is taken OR when the last change
   * was under 30 days ago — that detail names the instant it opens again, and
   * `social/account.ts::describeHandleConflict` turns it into a sentence.
   */
  patchMe(body: MePatch): Promise<Me> {
    return this.request('PATCH', '/v1/users/me', { body });
  }

  // ------------------------------------------------------------ capture keys

  /** Live keys, oldest first. Revoked keys are gone from this list. */
  captureKeys(): Promise<{ keys: CaptureKey[] }> {
    return this.request('GET', '/v1/capture-keys');
  }

  /**
   * Mint a key. 409 when ten live keys already exist (the server's cap); 422 for a blank
   * or over-long name. The plaintext in the answer is shown once and never requested again.
   */
  createCaptureKey(name: string): Promise<CaptureKeyCreated> {
    return this.request('POST', '/v1/capture-keys', { body: { name } });
  }

  /** Revoke. The container holding it gets a 401 from its next upload on. 404 if not yours. */
  revokeCaptureKey(id: string): Promise<void> {
    return this.request('DELETE', `/v1/capture-keys/${encodeURIComponent(id)}`);
  }

  /** Every faction the viewer belongs to, with their role in each. Oldest membership first. */
  myFactions(): Promise<{ factions: MyFaction[] }> {
    return this.request('GET', '/v1/factions/mine');
  }

  /** The creator is the first admin; the response carries `join_code`. */
  createFaction(body: { name: string; slug?: string; open?: boolean; tz?: string }): Promise<Faction> {
    return this.request('POST', '/v1/factions', { body });
  }

  /** By code (`XXXX-XXXX`), or by slug when the faction is open. */
  joinFaction(code: string): Promise<Faction> {
    return this.request('POST', '/v1/factions:join', { body: { code } });
  }

  joinOpenFaction(slug: string): Promise<Faction> {
    return this.request('POST', '/v1/factions:join', { body: { slug } });
  }

  /** `week` is an ISO week like `2026-W33`; omitted means the current one. */
  factionBoard(slug: string, week?: string): Promise<FactionBoard> {
    const qs = week ? `?week=${encodeURIComponent(week)}` : '';
    return this.request('GET', `/v1/factions/${encodeURIComponent(slug)}/board${qs}`);
  }

  setFactionShareHours(
    slug: string,
    shareHours: boolean
  ): Promise<{ slug: string; share_hours: boolean }> {
    return this.request('PATCH', `/v1/factions/${encodeURIComponent(slug)}/members/me`, {
      body: { share_hours: shareHours },
    });
  }

  /**
   * A presigned PUT the phone uploads to directly. The server answers 503 when object
   * storage is not configured; that is a deployment fact, not a bug, so it surfaces as a
   * plain sentence rather than the server's list of env vars.
   */
  async presignMedia(postId: string, body: PresignRequest): Promise<Presign> {
    try {
      return await this.request('POST', `/v1/posts/${encodeURIComponent(postId)}/media:presign`, {
        body,
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) {
        throw new ApiError(503, PRESIGN_UNCONFIGURED_MESSAGE);
      }
      throw e;
    }
  }

  /** After the PUT succeeded: record the object on the post. */
  attachMedia(postId: string, body: MediaAttach): Promise<PostMedia> {
    return this.request('POST', `/v1/posts/${encodeURIComponent(postId)}/media`, { body });
  }

  // -------------------------------------------------------------- transport

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    opts: { body?: unknown; auth?: boolean } = {}
  ): Promise<T> {
    const auth = opts.auth ?? true;
    if (auth) await this.loadTokens();

    let res = await this.fetchJson(method, path, opts.body, auth ? this.access : null);

    if (res.status === 401 && auth && this.refresh) {
      // Retry exactly once. A second 401 after a fresh token is a real authorisation
      // failure, not a stale one, and looping would hammer /refresh.
      await this.refreshTokens();
      res = await this.fetchJson(method, path, opts.body, this.access);
    }

    const parsed = await parseBody(res);
    if (!res.ok) throw new ApiError(res.status, errorMessage(parsed, res));
    return parsed as T;
  }

  private async fetchJson(
    method: string,
    path: string,
    body: unknown,
    bearer: string | null | undefined
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      // Status 0 is the phone's side of the wire. Screens print `message` as it is, so it is
      // a sentence a person can act on, not fetch's "Network request failed".
      if ((e as { name?: string }).name === 'AbortError') {
        throw new ApiError(0, TIMEOUT_MESSAGE);
      }
      throw new ApiError(0, OFFLINE_MESSAGE);
    } finally {
      clearTimeout(timer);
    }
  }

  private refreshTokens(): Promise<void> {
    if (!refreshing) {
      refreshing = this.doRefresh().finally(() => {
        refreshing = null;
      });
    }
    return refreshing;
  }

  private async doRefresh(): Promise<void> {
    const token = this.refresh;
    if (!token) throw new ApiError(401, 'not signed in');
    let res: Response;
    let parsed: unknown;
    try {
      res = await this.fetchJson('POST', '/v1/auth/refresh', { refresh_token: token }, null);
      parsed = await parseBody(res);
    } catch (e) {
      // A network failure or timeout mid-refresh is not proof the token is dead. Keep the
      // pair; the caller shows the banner and the next sync retries. Clearing here signed
      // people out on every flaky connection.
      throw e;
    }
    if (!res.ok) {
      // Only a definitive auth answer ends the session. A 5xx is the server's problem.
      if (res.status === 401 || res.status === 403) await this.clearTokens();
      throw new ApiError(res.status, errorMessage(parsed, res));
    }
    const pair = parsed as Partial<TokenPair>;
    if (!pair.access_token || !pair.refresh_token) {
      // A 2xx that is not the token pair — a captive portal's page, an intercepting
      // proxy — is not an auth answer either. Keep the pair and report it as transport
      // (status 0), like a timeout; the next sync retries. Clearing here signed people
      // out on hotel wifi. Found by review.
      throw new ApiError(0, 'malformed refresh response');
    }
    await this.setTokens(pair.access_token, pair.refresh_token);
  }
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorMessage(body: unknown, res: Response): string {
  if (body && typeof body === 'object') {
    const b = body as { detail?: unknown; error?: unknown };
    const m = b.detail ?? b.error;
    if (typeof m === 'string') return m;
    if (m !== undefined && m !== null) return JSON.stringify(m);
  }
  return res.statusText || `HTTP ${res.status}`;
}
