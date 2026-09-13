import Foundation

/// Everything the Lock Screen, the Dynamic Island and the Home Screen widget say about one
/// session, derived once from `BuilderSessionAttributes` + `ContentState` (or a widget snapshot
/// row) at a given `now`. The views only lay these out, so the copy lives in one place.
///
/// Copy rules (brief, DESIGN-DIRECTION 9): no dashes anywhere (a minus before a number is
/// U+2212 MINUS SIGN, which is a sign, not punctuation), captions lower case, numbers tabular,
/// and a refused number is a sentence ("no ETA yet"), never a 0 or "--".
@available(iOS 16.1, *)
struct LiveDisplay {
  enum Phase: String {
    case working, needsYou, done, stalled
  }

  enum Verdict: String, CaseIterable {
    case converging, circling, lost
  }

  let sessionId: String
  let phase: Phase
  /// nil when the engine has no verdict yet: the caption drops it rather than guess one.
  let verdict: Verdict?
  let repo: String
  let harness: String
  let creature: String
  let sentence: String
  /// Minutes since the session started, as "22m" or "1h 05m".
  let elapsed: String
  /// The same for the 52pt compact island slot: "22m", "1h 05m", past ten hours "10h".
  let elapsedCompact: String
  /// For the ring: 0...1, or nil for "no honest number yet" (a dotted track).
  let ring: Double?
  let overTypical: Bool
  /// nil when nothing counted the files: the ring's centre stays empty rather than say 0.
  let files: Int?
  /// "about 18m left", "running longer than usual", or "no ETA yet".
  let eta: String
  /// "2 more running", or nil when this is the only one.
  let moreRunning: String?
  let linesAdded: Int?
  let linesRemoved: Int?
  let commits: Int?

  init(attributes a: BuilderSessionAttributes, state s: BuilderSessionAttributes.ContentState, now: Date) {
    let t = max(now.timeIntervalSince1970, s.updatedEpoch)
    self.init(
      sessionId: a.sessionId, repo: a.repo, agent: a.agent, startedEpoch: a.startedEpoch,
      phase: s.phase, sentence: s.sentence, progress: s.progress, filesTouched: s.filesTouched,
      etaEpoch: s.etaEpoch, trajectory: s.trajectory, creature: s.creature,
      linesAdded: s.linesAdded, linesRemoved: s.linesRemoved, commits: s.commits,
      runningCount: s.runningCount, now: t)
  }

  init(sessionId: String, repo: String, agent: String, startedEpoch: Double,
       phase: String, sentence: String, progress: Double, filesTouched: Int,
       etaEpoch: Double?, trajectory: String, creature: String,
       linesAdded: Int?, linesRemoved: Int?, commits: Int?,
       runningCount: Int, now: Double) {
    self.sessionId = sessionId
    self.phase = Phase(rawValue: phase) ?? .working
    self.verdict = Verdict(rawValue: trajectory)
    self.repo = repo.isEmpty ? "private repo" : repo
    self.harness = LiveCopy.harnessName(agent)
    self.creature = creature
    self.sentence = sentence
    let seconds = max(0, now - startedEpoch)
    self.elapsed = LiveCopy.duration(seconds)
    self.elapsedCompact = LiveCopy.durationCompact(seconds)
    // Past the typical run: the ring stays full and the caption says so, never a second lap.
    self.overTypical = progress >= 1 || (etaEpoch.map { $0 <= now } ?? false)
    if self.phase == .done {
      self.ring = 1
    } else if progress < 0 {
      self.ring = nil
    } else {
      self.ring = self.overTypical ? 1 : min(progress, 1)
    }
    self.files = filesTouched >= 0 ? filesTouched : nil
    if let eta = etaEpoch {
      self.eta = self.overTypical ? LiveCopy.overTypical : "about \(LiveCopy.duration(max(60, eta - now), roundUp: true)) left"
    } else {
      self.eta = LiveCopy.noEta
    }
    self.moreRunning = runningCount > 0 ? "\(runningCount) more running" : nil
    self.linesAdded = linesAdded
    self.linesRemoved = linesRemoved
    self.commits = commits
  }

  /// The one word for this session's state, where a surface has room for one.
  var stateWord: String {
    switch phase {
    case .needsYou: return LiveCopy.needsYou
    case .done: return LiveCopy.finished
    case .stalled: return LiveCopy.noNewOutput
    case .working: return verdict?.rawValue ?? LiveCopy.working
    }
  }

  var url: URL? { URL(string: "builder://session/\(sessionId)") }

  /// "+420", "−88", "3 commits": what a finished session made, each part only when counted.
  var added: String? { linesAdded.map { "+" + LiveCopy.count($0) } }
  var removed: String? { linesRemoved.map { LiveCopy.minus + LiveCopy.count($0) } }
  var commitsText: String? { commits.map { $0 == 1 ? "1 commit" : "\(LiveCopy.count($0)) commits" } }
}

enum LiveCopy {
  static let needsYou = "needs you"
  static let finished = "finished"
  static let working = "working"
  static let noNewOutput = "no new output"
  static let notUpdating = "Not updating"
  static let noEta = "no ETA yet"
  static let overTypical = "running longer than usual"
  static let nothingRunning = "Nothing running."
  static let goDoSomethingElse = "Go do something else. We'll tap you when that changes."
  static let today = "today"
  /// U+2212 MINUS SIGN: the sign on "−88", so no punctuation dash ever reaches a surface.
  static let minus = "\u{2212}"
  static let separator = "\u{00B7}"

  /// The server's harness ids, in their brand casing (mirrors `HARNESS_LABEL` in
  /// src/card/RecapCard.tsx). An id this build does not know is shown as sent, not hidden.
  static func harnessName(_ id: String) -> String {
    switch id {
    case "claude_code", "claude": return "Claude Code"
    case "cursor_ide", "cursor": return "Cursor"
    case "cursor_agent": return "cursor-agent"
    case "codex": return "Codex"
    case "gemini_cli", "gemini": return "Gemini CLI"
    case "cline": return "Cline"
    case "opencode": return "opencode"
    case "aider": return "Aider"
    default: return id
    }
  }

  /// "0m", "22m", "1h 05m" (the server's `_hm`, so a banner and a Lock Screen agree).
  static func duration(_ seconds: Double, roundUp: Bool = false) -> String {
    let total = roundUp ? Int((seconds / 60).rounded(.up)) : Int(seconds / 60)
    let h = total / 60, m = total % 60
    return h > 0 ? "\(h)h \(m < 10 ? "0" : "")\(m)m" : "\(m)m"
  }

  static func durationCompact(_ seconds: Double) -> String {
    let h = Int(seconds / 3600)
    return h >= 10 ? "\(h)h" : duration(seconds)
  }

  /// 420, 1,204 as 1.2k, 38k, 1.4M: product formatting with no locale surprise.
  static func count(_ n: Int) -> String {
    let v = abs(n)
    switch v {
    case ..<1_000: return "\(v)"
    case ..<10_000: return trimmed(Double(v) / 1_000) + "k"
    case ..<1_000_000: return "\(Int((Double(v) / 1_000).rounded()))k"
    default: return trimmed(Double(v) / 1_000_000) + "M"
    }
  }

  private static func trimmed(_ x: Double) -> String {
    let r = (x * 10).rounded() / 10
    return r == r.rounded() ? "\(Int(r))" : String(format: "%.1f", r)
  }
}
