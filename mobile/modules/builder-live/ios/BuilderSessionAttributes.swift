import ActivityKit
import Foundation

/// ONE definition, byte-identical in two places:
///   targets/widget/_shared/BuilderSessionAttributes.swift   (widget extension + main app, via _shared)
///   modules/builder-live/ios/BuilderSessionAttributes.swift (the Expo module pod)
/// `__tests__/liveActivityAttributes.test.ts` fails the build of either copy that drifts, and
/// checks the JS `SessionState` keys and the module's Record fields against this struct.
///
/// ActivityKit matches app <-> extension by the struct NAME and its Codable shape, not by module,
/// so the pod's copy and the extension's copy are "the same type" to the system as long as they match.
/// Every number is a plain Int or Double (Unix seconds for dates) so the JS bridge and the APNs
/// `content-state` JSON never have to agree on a Date encoding. An APNs push must carry exactly
/// these keys.
///
/// Absent is not zero. The counts that can be unknown are optionals (nil draws nothing, where a 0
/// would read as "nothing was committed"); the two kit fields keep their sentinels: a negative
/// `progress` is "no honest number yet" and a negative `filesTouched` is "not counted".
///
/// The main app on SDK 53 deploys to iOS 15.1, and this file is compiled into it via _shared,
/// so the availability annotation is required (ActivityKit is 16.1+).
@available(iOS 16.1, *)
public struct BuilderSessionAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    /// "working" | "needsYou" | "done" | "stalled"
    public var phase: String
    /// One sentence, always current, under 90 characters (two lines on the Lock Screen). Rendered
    /// on the phone from the engine's ids and numbers (src/live/sentence.ts) or src/live/format.ts.
    public var sentence: String
    /// Elapsed over typical. 0...1 fills the ring, above 1 is running longer than usual (a full
    /// ring), negative is no honest number yet (a dotted track, never a guessed arc).
    public var progress: Double
    /// Files the agent touched in this session. Negative when nothing counted them.
    public var filesTouched: Int
    /// Unix seconds at which a typical run like this one ends. nil refuses an ETA.
    public var etaEpoch: Double?
    /// "converging" | "circling" | "lost" | "none" (no verdict yet, so the caption drops it).
    public var trajectory: String
    /// The builder's creature: crab, octopus, dog, cat, owl, fox, whale, bee, or bit.
    public var creature: String
    /// Lines the agent added and removed, and the commits that landed. nil is unknown.
    public var linesAdded: Int?
    public var linesRemoved: Int?
    public var commits: Int?
    /// Other sessions running right now, beside this one.
    public var runningCount: Int
    /// Unix seconds of the data this state was built from.
    public var updatedEpoch: Double

    public init(phase: String, sentence: String, progress: Double, filesTouched: Int,
                etaEpoch: Double?, trajectory: String, creature: String,
                linesAdded: Int?, linesRemoved: Int?, commits: Int?,
                runningCount: Int, updatedEpoch: Double) {
      self.phase = phase
      self.sentence = sentence
      self.progress = progress
      self.filesTouched = filesTouched
      self.etaEpoch = etaEpoch
      self.trajectory = trajectory
      self.creature = creature
      self.linesAdded = linesAdded
      self.linesRemoved = linesRemoved
      self.commits = commits
      self.runningCount = runningCount
      self.updatedEpoch = updatedEpoch
    }
  }

  public var sessionId: String
  public var repo: String
  /// The harness id as the server names it: "claude_code", "codex", "cursor_ide", "gemini_cli", ...
  public var agent: String
  /// Unix seconds.
  public var startedEpoch: Double

  public init(sessionId: String, repo: String, agent: String, startedEpoch: Double) {
    self.sessionId = sessionId
    self.repo = repo
    self.agent = agent
    self.startedEpoch = startedEpoch
  }
}
