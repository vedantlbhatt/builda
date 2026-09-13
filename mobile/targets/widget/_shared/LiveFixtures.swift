import Foundation

/// Sample sessions for the Xcode previews and the debug ImageRenderer pass, one per state the
/// surfaces draw. Every sentence is one the live engine renders (`analysis/live.py`
/// `sentence()`, ported in `src/live/sentence.ts`) with the duration taken out, as the phone
/// puts it on a surface (`surface.ts` `surfaceSentenceOf`), with numbers of the size this
/// repository and RideGT actually produce; `__tests__/liveSurface.test.ts` fails if one of them
/// is not a sentence the phone's renderer can produce. builder has five finished sessions, so
/// its ETA is refused (the engine needs ten); RideGT has 148, typical 21 minutes. Each session
/// wears a different crew creature, so the renders show the hues side by side (DESIGN-V2 2.2).
///
/// Computed, not stored: nothing here is global state (and Swift 6 would refuse stored statics
/// of these types).
@available(iOS 16.1, *)
enum LiveFixtures {
  typealias State = BuilderSessionAttributes.ContentState

  /// Fixed, so renders are reproducible.
  static var now: Date { Date(timeIntervalSince1970: 1_757_750_400) }
  static var t: Double { now.timeIntervalSince1970 }

  static var builder: BuilderSessionAttributes {
    BuilderSessionAttributes(sessionId: "fixture-builder", repo: "builder", agent: "claude_code", startedEpoch: t - 47 * 60)
  }

  static var rideGT: BuilderSessionAttributes {
    BuilderSessionAttributes(sessionId: "fixture-ridegt", repo: "RideGT", agent: "claude_code", startedEpoch: t - 12 * 60)
  }

  /// Nearly three hours in: the timer reads h:mm:ss, the widest it gets inside ActivityKit's 8h.
  static var longRun: BuilderSessionAttributes {
    BuilderSessionAttributes(sessionId: "fixture-long", repo: "builder", agent: "claude_code", startedEpoch: t - (2 * 3600 + 57 * 60 + 7))
  }

  /// An anonymous upload: no repo name reaches the phone.
  static var privateRepo: BuilderSessionAttributes {
    BuilderSessionAttributes(sessionId: "fixture-private", repo: "private repo", agent: "claude_code", startedEpoch: t - 60)
  }

  static func state(_ phase: String, _ sentence: String, progress: Double = -1, files: Int = -1,
                    eta: Double? = nil, since: Double? = nil, ended: Double? = nil,
                    trajectory: String = "none", creature: String = "whale",
                    added: Int? = nil, removed: Int? = nil, commits: Int? = nil,
                    running: Int = 0) -> State {
    State(phase: phase, sentence: sentence, progress: progress, filesChanged: files,
          etaEpoch: eta, sinceEpoch: since, endedEpoch: ended, trajectory: trajectory, creature: creature,
          linesAdded: added, linesRemoved: removed, commits: commits,
          runningCount: running, updatedEpoch: t)
  }

  /// RideGT, 12 minutes into a run that typically takes 21 (so done around 9 minutes from
  /// now), converging, three files changed so far.
  static var working: State {
    state("working", "Rewriting a source file, third attempt",
          progress: 12.0 / 21.0, files: 3, eta: t + 9 * 60, trajectory: "converging")
  }

  /// builder: no ETA yet (five finished sessions, ten needed), so a dotted ring.
  static var workingNoEta: State { state("working", "Running your test suite", files: 5, creature: "octopus", running: 1) }

  /// Its turn ended with a background job still out: the agent's wait, not yours. Working.
  static var background: State { state("working", "Waiting on one background task it started", files: 2, creature: "octopus") }

  static var needsYou: State { state("needsYou", "Waiting on you", files: 5, since: t - 4 * 60, creature: "octopus", running: 1) }

  static var circling: State {
    state("working", "Stuck on the same failing command",
          progress: 0.9, files: 4, eta: t + 2 * 60, since: t - 6 * 60, trajectory: "circling", creature: "dog")
  }

  static var overTypical: State {
    state("working", "Editing two source files",
          progress: 1.35, files: 7, eta: t - 7 * 60, trajectory: "converging", creature: "fox")
  }

  static var lost: State {
    state("working", "Editing three files it has not read yet",
          progress: 0.4, files: 6, eta: t + 13 * 60, trajectory: "lost", creature: "cat")
  }

  static var stalled: State {
    state("stalled", "No new output", progress: 0.7, files: 3,
          eta: t + 6 * 60, since: t - 6 * 60, trajectory: "converging", creature: "bee")
  }

  static var done: State {
    state("done", "Finished, with twelve files changed", files: 12, ended: t, creature: "octopus",
          added: 420, removed: 88, commits: 3)
  }

  /// A turn the engine called done while the session is still live: finished, not looked at
  /// yet. No end on the row, so the card counts "ran" to when the turn finished (`since`).
  static var doneUnreviewed: State {
    state("done", "Finished, with twelve files changed", files: 12, since: t - 3 * 60, creature: "crab",
          added: 420, removed: 88, commits: 3)
  }

  /// A quiet sitting that only read two files (live-self-2): nothing written, nothing committed.
  static var doneNothing: State {
    state("done", "Finished", files: 0, ended: t - 20 * 60, creature: "owl", added: 0, removed: 0, commits: 0)
  }

  static var nothingYet: State { state("working", "Nothing has happened yet", files: 0, creature: "owl") }

  static func display(_ a: BuilderSessionAttributes, _ s: State) -> LiveDisplay {
    LiveDisplay(attributes: a, state: s, now: now)
  }

  // MARK: widget

  static func row(_ id: String, _ repo: String, _ agent: String, _ phase: String, _ sentence: String,
                  _ trajectory: String, _ creature: String, minutes: Double, progress: Double = -1, files: Int = -1,
                  eta: Double? = nil, since: Double? = nil) -> WidgetSnapshot.Session {
    WidgetSnapshot.Session(id: id, repo: repo, agent: agent, phase: phase, sentence: sentence,
                           trajectory: trajectory, creature: creature, startedEpoch: t - minutes * 60,
                           progress: progress, filesChanged: files, etaEpoch: eta, sinceEpoch: since)
  }

  static var today: WidgetSnapshot.Today {
    WidgetSnapshot.Today(attendedSeconds: 2 * 3600 + 14 * 60, week: [2, 0, 3, 4, 1, 5, 3])
  }

  static func snapshot(_ sessions: [WidgetSnapshot.Session], running: Int? = nil,
                       today: WidgetSnapshot.Today? = LiveFixtures.today) -> WidgetSnapshot {
    WidgetSnapshot(v: 1, updatedEpoch: t, staleEpoch: t + 15 * 60, creature: "crab",
                   runningCount: running ?? sessions.count, sessions: sessions, today: today)
  }

  /// Four listed, five running: the needs you session first, as mission control orders them,
  /// each in its own creature.
  static var widgetFour: WidgetSnapshot {
    snapshot([
      row("fixture-builder", "builder", "claude_code", "needsYou", "Waiting on you", "none", "octopus",
          minutes: 47, files: 5, since: t - 4 * 60),
      row("fixture-ridegt", "RideGT", "claude_code", "working", "Rewriting a source file, third attempt", "converging", "whale",
          minutes: 12, progress: 12.0 / 21.0, files: 3, eta: t + 9 * 60),
      row("fixture-ridegt-2", "RideGT", "codex", "working", "Stuck on the same failing command", "circling", "dog",
          minutes: 31, progress: 0.9, files: 4, eta: t + 2 * 60, since: t - 6 * 60),
      row("fixture-builder-2", "builder", "gemini_cli", "working", "Reading the docs", "none", "fox", minutes: 3, files: 0),
    ], running: 5)
  }

  /// The longest sentence the engine writes for a running session, on top: what the small
  /// widget's three lines have to hold.
  static var widgetCircling: WidgetSnapshot {
    snapshot([
      row("fixture-ridegt-2", "gt-transit", "codex", "working", "Going back and forth on a source file, fourth pass", "circling", "dog",
          minutes: 31, progress: 0.9, files: 4, eta: t + 2 * 60),
      row("fixture-ridegt", "RideGT", "claude_code", "working", "Rewriting a source file, third attempt", "converging", "whale",
          minutes: 12, progress: 12.0 / 21.0, files: 3, eta: t + 9 * 60),
    ])
  }

  /// The longest sentence a surface can show: 58 characters, the longest over every branch of
  /// `analysis.live.sentence` with names off, and the phone only ever renders names off
  /// (`src/live/sentence.ts`). The small widget holds it whole: an ellipsis there cut the one
  /// line that says what is wrong.
  static var widgetLongest: WidgetSnapshot {
    snapshot([
      row("fixture-longest", "gt-transit", "codex", "working", "Going back and forth on a database migration, seventh pass",
          "circling", "dog", minutes: 31, progress: 0.9, files: 4, eta: t + 2 * 60),
    ])
  }

  static var widgetWorking: WidgetSnapshot {
    snapshot([
      row("fixture-ridegt", "RideGT", "claude_code", "working", "Rewriting a source file, third attempt", "converging", "whale",
          minutes: 12, progress: 12.0 / 21.0, files: 3, eta: t + 9 * 60),
    ])
  }

  /// A turn finished three minutes ago that nobody has looked at, first in mission control's
  /// order (the engine's 30 over a converging run's 5), beside two sessions still running.
  static var widgetFinished: WidgetSnapshot {
    snapshot([
      row("fixture-builder", "builder", "claude_code", "done", "Finished, with twelve files changed", "none", "crab",
          minutes: 47, files: 12, since: t - 3 * 60),
      row("fixture-ridegt", "RideGT", "claude_code", "working", "Rewriting a source file, third attempt", "converging", "whale",
          minutes: 12, progress: 12.0 / 21.0, files: 3, eta: t + 9 * 60),
      row("fixture-cline", "gt-transit", "cline", "needsYou", "Waiting on you", "none", "cat",
          minutes: 20, files: 2, since: t - 2 * 60),
    ], running: 2)
  }

  static var widgetIdle: WidgetSnapshot { snapshot([], running: 0) }
}
