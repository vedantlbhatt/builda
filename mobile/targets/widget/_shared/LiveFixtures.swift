import Foundation

/// Sample sessions for the Xcode previews and the debug ImageRenderer pass, one per state the
/// surfaces draw. Every sentence is one the live engine renders (`analysis/live.py`
/// `sentence()`, ported in `src/live/sentence.ts`) with the duration taken out, as the phone
/// puts it on a surface (`surface.ts` `surfaceSentenceOf`), with numbers of the size this
/// repository and RideGT actually produce; `__tests__/liveSurface.test.ts` fails if one of them
/// is not a sentence the phone's renderer can produce. builder has five finished sessions, so
/// its ETA is refused (the engine needs ten); RideGT has 148, typical 21 minutes.
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
                    trajectory: String = "none", creature: String = "crab",
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
  static var workingNoEta: State { state("working", "Running your test suite", files: 5, running: 1) }

  /// Its turn ended with a background job still out: the agent's wait, not yours. Working.
  static var background: State { state("working", "Waiting on one background task it started", files: 2) }

  static var needsYou: State { state("needsYou", "Waiting on you", files: 5, since: t - 4 * 60, running: 1) }

  static var circling: State {
    state("working", "Stuck on the same failing command",
          progress: 0.9, files: 4, eta: t + 2 * 60, since: t - 6 * 60, trajectory: "circling")
  }

  static var overTypical: State {
    state("working", "Editing two source files",
          progress: 1.35, files: 7, eta: t - 7 * 60, trajectory: "converging")
  }

  static var lost: State {
    state("working", "Editing three files it has not read yet",
          progress: 0.4, files: 6, eta: t + 13 * 60, trajectory: "lost")
  }

  static var stalled: State {
    state("stalled", "No new output", progress: 0.7, files: 3,
          eta: t + 6 * 60, since: t - 6 * 60, trajectory: "converging")
  }

  static var done: State {
    state("done", "Finished, with twelve files changed", files: 12, ended: t,
          added: 420, removed: 88, commits: 3)
  }

  /// A quiet sitting that only read two files (live-self-2): nothing written, nothing committed.
  static var doneNothing: State {
    state("done", "Finished", files: 0, ended: t - 20 * 60, added: 0, removed: 0, commits: 0)
  }

  static var nothingYet: State { state("working", "Nothing has happened yet", files: 0) }

  static func display(_ a: BuilderSessionAttributes, _ s: State) -> LiveDisplay {
    LiveDisplay(attributes: a, state: s, now: now)
  }

  // MARK: widget

  static func row(_ id: String, _ repo: String, _ agent: String, _ phase: String, _ sentence: String,
                  _ trajectory: String, minutes: Double, progress: Double = -1, files: Int = -1,
                  eta: Double? = nil, since: Double? = nil) -> WidgetSnapshot.Session {
    WidgetSnapshot.Session(id: id, repo: repo, agent: agent, phase: phase, sentence: sentence,
                           trajectory: trajectory, startedEpoch: t - minutes * 60,
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

  /// Four listed, five running: the needs you session first, as mission control orders them.
  static var widgetFour: WidgetSnapshot {
    snapshot([
      row("fixture-builder", "builder", "claude_code", "needsYou", "Waiting on you", "none",
          minutes: 47, files: 5, since: t - 4 * 60),
      row("fixture-ridegt", "RideGT", "claude_code", "working", "Rewriting a source file, third attempt", "converging",
          minutes: 12, progress: 12.0 / 21.0, files: 3, eta: t + 9 * 60),
      row("fixture-ridegt-2", "RideGT", "codex", "working", "Stuck on the same failing command", "circling",
          minutes: 31, progress: 0.9, files: 4, eta: t + 2 * 60, since: t - 6 * 60),
      row("fixture-builder-2", "builder", "gemini_cli", "working", "Reading the docs", "none", minutes: 3, files: 0),
    ], running: 5)
  }

  /// The longest sentence the engine writes for a running session, on top: what the small
  /// widget's three lines have to hold.
  static var widgetCircling: WidgetSnapshot {
    snapshot([
      row("fixture-ridegt-2", "gt-transit", "codex", "working", "Going back and forth on a source file, fourth pass", "circling",
          minutes: 31, progress: 0.9, files: 4, eta: t + 2 * 60),
      row("fixture-ridegt", "RideGT", "claude_code", "working", "Rewriting a source file, third attempt", "converging",
          minutes: 12, progress: 12.0 / 21.0, files: 3, eta: t + 9 * 60),
    ])
  }

  static var widgetWorking: WidgetSnapshot {
    snapshot([
      row("fixture-ridegt", "RideGT", "claude_code", "working", "Rewriting a source file, third attempt", "converging",
          minutes: 12, progress: 12.0 / 21.0, files: 3, eta: t + 9 * 60),
    ])
  }

  static var widgetIdle: WidgetSnapshot { snapshot([], running: 0) }
}
