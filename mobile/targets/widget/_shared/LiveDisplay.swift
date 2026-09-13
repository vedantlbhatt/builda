import Foundation

/// Everything the Lock Screen, the Dynamic Island and the Home Screen widget say about one
/// session, derived once from `BuilderSessionAttributes` + `ContentState` (or a widget snapshot
/// row) at a given `now`. The views only lay these out, so the copy lives in one place.
///
/// Copy rules (brief, DESIGN-DIRECTION 9): no dashes anywhere (`plain.DASH_CHARS`: em, en, the
/// horizontal bar and the U+2212 minus sign; a removed count is "-88" with a hyphen, as the
/// phone writes it), captions lower case, numbers tabular, and a refused number is a sentence
/// ("no ETA yet"), never a 0 or "--".
///
/// Time rule: a Live Activity is redrawn only when an update arrives, and none arrives while
/// the app is in the background. So nothing on it is a duration computed at render ("12m",
/// "about 9m left", "for four minutes" all froze on the Lock Screen, 2026-09-13): the elapsed
/// time is a system timer counting from `startDate`, and every other time is a clock time
/// ("waiting since 9:37", "done around 9:50"), which stays true. The widget redraws on its own
/// timeline (one entry a minute), so it may use the minute strings computed at `now`.
@available(iOS 16.1, *)
struct LiveDisplay {
  enum Phase: String {
    case working, needsYou, done, stalled
  }

  enum Verdict: String, CaseIterable {
    case converging, circling, lost
  }

  /// What the ring (and the island's capsule) draws. `arc` is elapsed over typical, `dotted` is
  /// "no honest number yet", `track` is the empty ring: a session waiting on you, or one that
  /// finished with nothing landed.
  enum Ring: Equatable {
    case arc(Double)
    case dotted
    case track
  }

  /// One piece of a caption, most important first; a caption drops pieces from the end when
  /// the width runs out, never a word in the middle.
  enum Part: Hashable {
    case words(String)
    /// "waiting since" and a clock time.
    case clock(String, Date)
    case verdict(Verdict)
    /// "circling since" and a clock time.
    case verdictSince(Verdict, Date)
  }

  let sessionId: String
  let phase: Phase
  /// nil when the engine has no verdict yet: the caption drops it rather than guess one.
  let verdict: Verdict?
  let repo: String
  let harness: String
  /// "Claude", "Codex", "Gemini": where a row has no room for the brand name in full.
  let harnessShort: String
  let creature: String
  let sentence: String
  /// When the session started. The elapsed time on the Lock Screen and in the island is a
  /// system timer from here, so it moves with no update.
  let startDate: Date
  /// Minutes since the start at `now`: "22m", "1h 05m". For the widget, which redraws each minute.
  let elapsed: String
  /// When the condition the sentence names began (needs you, no output, a failing command).
  let since: Date?
  /// Minutes since `since` at `now`, for the widget: "4m".
  let sinceElapsed: String?
  /// How long a finished session ran ("47m"); nil while it runs or when its end is not known.
  let ranFor: String?
  /// When the data behind this card was taken: "Not updating since 9:41".
  let updated: Date
  let ring: Ring
  let overTypical: Bool
  /// Working, inside its typical run, with no verdict against it. Amber progress (the arc, the
  /// capsule) and an ETA are drawn for this state only, so amber always means "on track".
  let onTrack: Bool
  /// Files the agent changed, when counted and more than none: the caption's "9 files changed".
  let filesChanged: Int?
  /// When a typical run like this ends, while on track; nil when refused or already past it.
  let etaDate: Date?
  let etaRefused: Bool
  /// Sessions running beside this one that nothing else on the surface shows.
  let others: Int
  /// "2 more running", or nil when there are none.
  var moreRunning: String? { others > 0 ? "\(others) more running" : nil }
  let linesAdded: Int?
  let linesRemoved: Int?
  let commits: Int?

  init(attributes a: BuilderSessionAttributes, state s: BuilderSessionAttributes.ContentState, now: Date) {
    let t = max(now.timeIntervalSince1970, s.updatedEpoch)
    self.init(
      sessionId: a.sessionId, repo: a.repo, agent: a.agent, startedEpoch: a.startedEpoch,
      phase: s.phase, sentence: s.sentence, progress: s.progress, filesChanged: s.filesChanged,
      etaEpoch: s.etaEpoch, sinceEpoch: s.sinceEpoch, endedEpoch: s.endedEpoch,
      trajectory: s.trajectory, creature: s.creature,
      linesAdded: s.linesAdded, linesRemoved: s.linesRemoved, commits: s.commits,
      runningCount: s.runningCount, updatedEpoch: s.updatedEpoch, now: t)
  }

  init(sessionId: String, repo: String, agent: String, startedEpoch: Double,
       phase: String, sentence: String, progress: Double, filesChanged: Int,
       etaEpoch: Double?, sinceEpoch: Double?, endedEpoch: Double?,
       trajectory: String, creature: String,
       linesAdded: Int?, linesRemoved: Int?, commits: Int?,
       runningCount: Int, updatedEpoch: Double, now: Double) {
    self.sessionId = sessionId
    let phase = Phase(rawValue: phase) ?? .working
    self.phase = phase
    // A stalled session has no verdict worth showing: "converging" beside "No new output" is
    // a claim the silence does not support.
    let verdict = phase == .stalled ? nil : Verdict(rawValue: trajectory)
    self.verdict = verdict
    self.repo = repo.isEmpty ? "private repo" : repo
    self.harness = LiveCopy.harnessName(agent)
    self.harnessShort = LiveCopy.harnessShort(agent)
    self.creature = creature
    self.sentence = sentence
    self.startDate = Date(timeIntervalSince1970: startedEpoch)
    self.elapsed = LiveCopy.duration(max(0, now - startedEpoch))
    self.since = sinceEpoch.map { Date(timeIntervalSince1970: $0) }
    self.sinceElapsed = sinceEpoch.map { LiveCopy.duration(max(0, now - $0)) }
    self.ranFor = phase == .done ? endedEpoch.map { LiveCopy.duration(max(0, $0 - startedEpoch)) } : nil
    self.updated = Date(timeIntervalSince1970: updatedEpoch)
    // Past the typical run: the ring stays full and the caption says so, never a second lap.
    let over = progress >= 1 || (etaEpoch.map { $0 <= now } ?? false)
    self.overTypical = over
    let onTrack = phase == .working && (verdict == nil || verdict == .converging) && !over
    self.onTrack = onTrack
    let landed = (linesAdded ?? 0) + (linesRemoved ?? 0) > 0 || (commits ?? 0) > 0
    switch phase {
    case .done: self.ring = landed ? .arc(1) : .track
    case .needsYou: self.ring = .track
    case .working, .stalled: self.ring = progress < 0 ? .dotted : .arc(over ? 1 : min(progress, 1))
    }
    self.filesChanged = filesChanged > 0 ? filesChanged : nil
    self.etaRefused = etaEpoch == nil
    self.etaDate = onTrack ? etaEpoch.map { Date(timeIntervalSince1970: $0) } : nil
    self.others = max(0, runningCount)
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

  /// The caption under the sentence, most important piece first (`CaptionLine` sheds from the
  /// end). A finished card has its own line (`FinishedLine`), and a stale one says only that.
  var captionParts: [Part] {
    var parts: [Part] = []
    switch phase {
    case .done:
      return []
    case .needsYou:
      if let since { parts.append(.clock(LiveCopy.waitingSince, since)) }
    case .stalled:
      if let since { parts.append(.clock(LiveCopy.lastOutput, since)) } else { parts.append(.words(LiveCopy.noNewOutput)) }
      if let f = filesChanged { parts.append(.words(LiveCopy.filesChanged(f))) }
    case .working:
      if onTrack {
        if let eta = etaDate {
          parts.append(.clock(LiveCopy.doneAround, eta))
        } else if etaRefused {
          parts.append(.words(LiveCopy.noEta))
        }
        if let v = verdict { parts.append(.verdict(v)) }
      } else if let v = verdict, v != .converging {
        // Circling or lost: the verdict leads and no ETA is offered; a run going nowhere has
        // no "left" to count down.
        parts.append(since.map { .verdictSince(v, $0) } ?? .verdict(v))
      } else {
        parts.append(.words(LiveCopy.overTypical))
        if let v = verdict { parts.append(.verdict(v)) }
      }
      if let f = filesChanged { parts.append(.words(LiveCopy.filesChanged(f))) }
    }
    if let m = moreRunning { parts.append(.words(m)) }
    return parts
  }

  /// Lines, commits and files a finished session left, each only when more than none.
  var landedParts: (added: String?, removed: String?, commits: String?, files: String?) {
    let a = linesAdded ?? 0, r = linesRemoved ?? 0, c = commits ?? 0
    return (
      a > 0 ? "+" + LiveCopy.count(a) : nil,
      r > 0 ? LiveCopy.minus + LiveCopy.count(r) : nil,
      c > 0 ? (c == 1 ? "1 commit" : "\(LiveCopy.count(c)) commits") : nil,
      filesChanged.map { LiveCopy.filesChanged($0) }
    )
  }

  /// Nothing landed, and that was counted (lines and commits both measured at zero, no file
  /// changed): the one case where a finished card may say so. Unknown counts say nothing.
  var countedNothing: Bool {
    linesAdded != nil && commits != nil && (linesAdded ?? 0) + (linesRemoved ?? 0) == 0
      && (commits ?? 0) == 0 && filesChanged == nil
  }
}

enum LiveCopy {
  static let needsYou = "needs you"
  static let finished = "finished"
  static let working = "working"
  static let noNewOutput = "no new output"
  static let notUpdatingSince = "Not updating since"
  static let noEta = "no ETA yet"
  static let overTypical = "running longer than usual"
  static let waitingSince = "waiting since"
  static let lastOutput = "last output"
  static let doneAround = "done around"
  static let since = "since"
  static let ran = "ran"
  static let nothingLanded = "nothing written, nothing committed"
  static let nothingRunning = "Nothing running."
  static let showsUpHere = "Your agents show up here while they run."
  static let today = "today"
  /// The sign on "-88": a hyphen, as the phone writes a negative number (src/copy/plain.ts).
  /// FOUND IN INTEGRATION (2026-09-13): this was U+2212, which `plain.DASH_CHARS` counts as a
  /// dash, so the Lock Screen broke the one rule the no dash tests hold every other surface to.
  static let minus = "-"
  static let separator = "\u{00B7}"

  static func filesChanged(_ n: Int) -> String { n == 1 ? "1 file changed" : "\(count(n)) files changed" }

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

  /// The same names cut to the word that tells them apart, for a widget row: two RideGT rows,
  /// one under Claude Code and one under Codex, must never read the same.
  static func harnessShort(_ id: String) -> String {
    switch id {
    case "claude_code", "claude": return "Claude"
    case "gemini_cli", "gemini": return "Gemini"
    case "cursor_agent": return "cursor-agent"
    default: return harnessName(id)
    }
  }

  /// "0m", "22m", "1h 05m" (the server's `_hm`, so a banner and a Lock Screen agree).
  static func duration(_ seconds: Double, roundUp: Bool = false) -> String {
    let total = roundUp ? Int((seconds / 60).rounded(.up)) : Int(seconds / 60)
    let h = total / 60, m = total % 60
    return h > 0 ? "\(h)h \(m < 10 ? "0" : "")\(m)m" : "\(m)m"
  }

  /// "12:00", "1:02:34": what `Text(timerInterval:)` counting up reads after `seconds`.
  static func timerText(_ seconds: Double) -> String {
    let s = Int(seconds), h = s / 3600, m = (s % 3600) / 60, sec = s % 60
    let mm = h > 0 && m < 10 ? "0\(m)" : "\(m)"
    let ss = sec < 10 ? "0\(sec)" : "\(sec)"
    return h > 0 ? "\(h):\(mm):\(ss)" : "\(mm):\(ss)"
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
