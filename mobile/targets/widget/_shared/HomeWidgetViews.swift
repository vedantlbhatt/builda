import SwiftUI
import WidgetKit

// The Home Screen widget (DESIGN-DIRECTION 7.3): small and medium, light, dark and tinted.
// Plain SwiftUI, so the main app can render it for review; the extension wraps it in
// `containerBackground`, which also gives it the system's 16pt content margins.
//
// Each session row wears its own crew creature and that creature's hue (DESIGN-V2 2.2): the
// creature, the needs you dot and word, the finished check. On the dark widget a hue is its ink
// (4.5:1 or more on #141210); on the light widget a mark takes the hue's 3:1 light tone and a
// word its 4.5:1 light text tone (`BuilderPalette.Scheme.creature(_:)`, measured in Palette.swift).
// Tinted and clear Home Screens drop the colour; the creature's shape and the words still carry it.

// MARK: - What the app writes

/// `src/live/widget.ts` writes this as a JSON string under `widgetSnapshot` in the App Group
/// (`ExtensionStorage.set`), at most four sessions in mission control order: who needs you
/// most first. `src/live/surface.ts` `WidgetSnapshot` is the other half and a bun test holds
/// the two key sets equal.
struct WidgetSnapshot: Codable, Hashable {
  struct Session: Codable, Hashable {
    var id: String
    var repo: String
    var agent: String
    /// working, needsYou, stalled, or done: a turn the engine called done while the session is
    /// still live (finished, not looked at yet), listed like mission control's finished tile.
    var phase: String
    var sentence: String
    var trajectory: String
    /// This session's crew creature. nil from an app build older than the crew rule: the row
    /// then wears the snapshot's `creature`.
    var creature: String?
    /// Unix seconds.
    var startedEpoch: Double
    var progress: Double
    /// Files changed (edits, never reads); negative when not counted.
    var filesChanged: Int
    var etaEpoch: Double?
    /// When the condition began: waiting on you, no new output, a failing command; on a finished
    /// row, when the turn finished.
    var sinceEpoch: Double?
  }

  struct Today: Codable, Hashable {
    /// Attended seconds today (the 04:00 day). nil when the app could not say.
    var attendedSeconds: Double?
    /// Seven `graph.levels` indexes, 0 to 5, oldest first, today last.
    var week: [Int]
  }

  var v: Int
  var updatedEpoch: Double
  /// Past this, nothing has refreshed the snapshot: the widget says "Not updating".
  var staleEpoch: Double
  /// The builder's own creature. No session row wears it (each has its own `creature`).
  var creature: String
  /// Every session running, which can be more than the four listed. A finished row is not one.
  var runningCount: Int
  var sessions: [Session]
  var today: Today?

  static let appGroup = "group.com.vedantlbhatt.Builder"
  static let key = "widgetSnapshot"

  /// The app writes a JSON string (`setString`); an older build that wrote an object stored
  /// JSON Data (`setObject`). Read either, and nothing rather than a guess.
  static func load(from defaults: UserDefaults? = UserDefaults(suiteName: appGroup)) -> WidgetSnapshot? {
    guard let defaults else { return nil }
    let data = defaults.data(forKey: key) ?? defaults.string(forKey: key).map { Data($0.utf8) }
    guard let data else { return nil }
    return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
  }
}

extension WidgetSnapshot.Session {
  /// A finished row is listed, never counted among the running. (Outside the struct, so the key
  /// test reads only the stored keys; the literal, not `LiveDisplay.Phase`, because this compiles
  /// into the iOS 15.1 app and that type is 16.1.)
  var isRunning: Bool { phase != "done" }
}

@available(iOS 16.1, *)
extension WidgetSnapshot {
  /// `more`: the sessions running beside this one that the widget does not show otherwise.
  func display(_ s: Session, now: Date, more: Int = 0) -> LiveDisplay {
    LiveDisplay(
      sessionId: s.id, repo: s.repo, agent: s.agent, startedEpoch: s.startedEpoch,
      phase: s.phase, sentence: s.sentence, progress: s.progress, filesChanged: s.filesChanged,
      etaEpoch: s.etaEpoch, sinceEpoch: s.sinceEpoch, endedEpoch: nil,
      trajectory: s.trajectory, creature: s.creature ?? creature,
      linesAdded: nil, linesRemoved: nil, commits: nil,
      runningCount: max(0, more), updatedEpoch: updatedEpoch,
      now: max(now.timeIntervalSince1970, updatedEpoch))
  }

  func isStale(at now: Date) -> Bool { now.timeIntervalSince1970 >= staleEpoch }
}

// MARK: - The widget

@available(iOS 17.0, *)
struct HomeWidgetView: View {
  enum Size { case small, medium }

  let size: Size
  let snapshot: WidgetSnapshot?
  let now: Date

  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.widgetRenderingMode) private var renderingMode

  var body: some View {
    let pal = BuilderPalette.scheme(colorScheme)
    let accented = renderingMode == .accented
    let sessions = snapshot?.sessions ?? []
    let stale = snapshot?.isStale(at: now) ?? false
    Group {
      if let snap = snapshot, let top = sessions.first {
        switch size {
        case .small:
          // Everything running beside the top session is "N more" on the small widget.
          SmallRunning(d: snap.display(top, now: now, more: snap.runningCount - (top.isRunning ? 1 : 0)),
                       stale: stale, pal: pal, accented: accented)
        case .medium:
          // A hairline between the columns; the others are rows, so the left says no "N more".
          let others = Array(sessions.dropFirst().prefix(3))
          let listedRunning = ([top] + others).filter(\.isRunning).count
          HStack(alignment: .top, spacing: 12) {
            SmallRunning(d: snap.display(top, now: now), stale: stale, pal: pal, accented: accented)
              .frame(width: 150, alignment: .leading)
            Rectangle().fill(pal.border).frame(width: 1)
            if others.isEmpty {
              TodayColumn(today: snap.today, pal: pal, accented: accented, topRuns: top.isRunning)
            } else {
              SessionRows(rows: others.map { snap.display($0, now: now) },
                          hidden: max(0, snap.runningCount - listedRunning), stale: stale, pal: pal)
            }
          }
        }
      } else {
        switch size {
        case .small:
          SmallIdle(today: snapshot?.today, pal: pal, accented: accented, saysNothingRunning: true)
        case .medium:
          HStack(alignment: .top, spacing: 16) {
            SmallIdle(today: snapshot?.today, pal: pal, accented: accented, saysNothingRunning: false)
              .frame(width: 150, alignment: .leading)
            VStack(alignment: .leading, spacing: 4) {
              Text(LiveCopy.nothingRunning)
                .font(LiveType.font(15, .semibold))
                .foregroundStyle(pal.text)
              Text(LiveCopy.showsUpHere)
                .font(LiveType.font(13, .medium))
                .foregroundStyle(pal.textDim)
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
          }
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

/// The repo top left with the session's creature small beside it on the right, in its hue (the
/// Home Screen already labels the widget "Builda", so the mark only has to be recognisable), the
/// big number, the sentence on up to three lines, and the state. The small widget, and the left
/// of the medium.
///
/// The big number is the one that matters for the state: how long it has waited on you when it
/// needs you, how long it ran when it finished, otherwise how long it has run. Each is drawn at
/// the timeline entry's `now`, which advances every minute.
@available(iOS 17.0, *)
private struct SmallRunning: View {
  let d: LiveDisplay
  let stale: Bool
  let pal: BuilderPalette.Scheme
  let accented: Bool

  var body: some View {
    let hue = pal.creature(d.creature)
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .center, spacing: 6) {
        // Shrinks a little before it cuts: "private repo" was "priva...repo" beside the creature.
        Text(d.repo)
          .font(LiveType.font(13, .semibold, mono: true))
          .foregroundStyle(pal.text)
          .lineLimit(1)
          .minimumScaleFactor(0.8)
          .truncationMode(.middle)
        Spacer(minLength: 4)
        CreatureMark(creature: d.creature, points: 16, tint: stale ? pal.textFaint : hue.ink)
      }
      Spacer(minLength: 2)
      Text(bigNumber)
        .font(LiveType.font(28, .heavy))
        .tracking(-0.5)
        .monospacedDigit()
        .foregroundStyle(stale ? pal.textDim : pal.text)
        .lineLimit(1)
        .minimumScaleFactor(0.7)
      // Three lines is all a small widget has under the number, and 0.9 still cut the longest
      // sentence the engine writes (58 characters, `LiveFixtures.widgetLongest`) to
      // "migration, seventh…": "seventh" with no "pass" after it, so the count lost what it
      // counted. At 0.8 it holds whole; a sentence that fits at 13pt never shrinks.
      Text(d.sentence)
        .font(LiveType.font(13, .semibold))
        .foregroundStyle(stale ? pal.textDim : pal.text)
        .lineLimit(3)
        .minimumScaleFactor(0.8)
        .fixedSize(horizontal: false, vertical: true)
      StateLine(d: d, stale: stale, pal: pal, size: 12)
        .padding(.top, 3)
    }
  }

  private var bigNumber: String {
    switch d.phase {
    case .needsYou: return d.sinceElapsed ?? d.elapsed
    case .done: return d.ranFor ?? LiveCopy.finished
    case .working, .stalled: return d.elapsed
    }
  }
}

/// The state word, then how many more are running when this is the only place that says so.
/// Stale says only that, shrinking to fit rather than pushing the column wider than the widget.
@available(iOS 17.0, *)
private struct StateLine: View {
  let d: LiveDisplay
  let stale: Bool
  let pal: BuilderPalette.Scheme
  var size: CGFloat

  var body: some View {
    if stale {
      NotUpdatingLine(since: d.updated, size: size, color: pal.text)
        .minimumScaleFactor(0.7)
    } else {
      // A finished turn keeps "not looked at yet" over "2 more": its sentence already says
      // Finished, so the short word would only repeat it. For every other state the long and
      // the short word are the same, and "N more" goes first when there is no room.
      let more = d.others == 0 ? nil : "\(d.others) more"
      ViewThatFits(in: .horizontal) {
        line(long: true, more: more)
        line(long: true, more: nil)
        line(long: false, more: more)
        line(long: false, more: nil)
      }
    }
  }

  private func line(long: Bool, more: String?) -> some View {
    HStack(spacing: 4) {
      StateWord(d: d, pal: pal, size: size, long: long).fixedSize()
      if let more {
        Dot(color: pal.textDim).font(LiveType.font(size, .medium))
        Text(more).font(LiveType.font(size, .semibold)).foregroundStyle(pal.textDim).fixedSize()
      }
    }
  }
}

/// The state as a word. Needs you is a 6pt dot and the words, both in the session's hue (on the
/// light widget the dot takes the 3:1 mark tone and the words the 4.5:1 text tone); the Lock
/// Screen's raised hand is too wide for a widget's column beside "4 more". A finished turn is the
/// check in its hue and "not looked at yet" (or "finished" where that does not fit). A verdict is
/// its drawn glyph and word in `textDim`. The word always carries the meaning, so tinted and
/// clear widgets lose nothing.
@available(iOS 17.0, *)
private struct StateWord: View {
  let d: LiveDisplay
  let pal: BuilderPalette.Scheme
  var size: CGFloat
  var long: Bool

  var body: some View {
    let hue = pal.creature(d.creature)
    if d.phase == .needsYou {
      HStack(spacing: 5) {
        Circle().fill(hue.ink).frame(width: 6, height: 6).widgetAccentable()
        Text(LiveCopy.needsYou)
          .font(LiveType.font(size, .semibold))
          .foregroundStyle(hue.text)
      }
    } else if d.phase == .done {
      FinishedWord(size: size, check: hue.ink, color: pal.textDim, long: long)
    } else if d.phase == .working, let v = d.verdict {
      VerdictLabel(verdict: v, size: size, color: pal.textDim)
    } else if d.phase == .stalled, let quiet = d.sinceElapsed {
      Text("\(LiveCopy.noNewOutput) for \(quiet)")
        .font(LiveType.font(size, .semibold))
        .foregroundStyle(pal.textDim)
    } else {
      Text(d.stateWord)
        .font(LiveType.font(size, .semibold))
        .foregroundStyle(pal.textDim)
    }
  }
}

/// A turn that finished and nobody has looked at: the check in the session's hue, and the words.
@available(iOS 17.0, *)
private struct FinishedWord: View {
  var size: CGFloat
  var check: Color
  var color: Color
  var long: Bool

  var body: some View {
    HStack(spacing: 4) {
      Image(systemName: "checkmark")
        .font(LiveType.font(size - 1, .bold))
        .foregroundStyle(check)
        .widgetAccentable()
      Text(long ? LiveCopy.notLookedAt : LiveCopy.finished)
        .font(LiveType.font(size, .semibold))
        .foregroundStyle(color)
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("\(LiveCopy.finished), \(LiveCopy.notLookedAt)")
  }
}

/// Up to three more sessions, one row each with a hairline between: the session's creature in
/// its hue, the repo in mono and the elapsed time, then the state and which harness (its mark and
/// the word that tells two rows apart: "Claude", "Codex"). Each row opens its session. Then "+N
/// more running" for any not listed.
@available(iOS 17.0, *)
private struct SessionRows: View {
  let rows: [LiveDisplay]
  let hidden: Int
  let stale: Bool
  let pal: BuilderPalette.Scheme

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      ForEach(Array(rows.enumerated()), id: \.offset) { i, d in
        if i > 0 {
          Rectangle().fill(pal.border).frame(height: 1).padding(.vertical, 4)
        }
        row(d)
      }
      Spacer(minLength: 0)
      if hidden > 0 && !stale {
        Text("+\(hidden) more running")
          .font(LiveType.font(12, .semibold))
          .foregroundStyle(pal.textDim)
          .padding(.top, 4)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  @ViewBuilder private func row(_ d: LiveDisplay) -> some View {
    let content = HStack(alignment: .firstTextBaseline, spacing: 5) {
      // Its feet (the family's row 13 of 16) on the repo's baseline.
      CreatureMark(creature: d.creature, points: 16, tint: stale ? pal.textFaint : pal.creature(d.creature).ink,
                   trim: .leading)
        .alignmentGuide(.firstTextBaseline) { _ in 13 }
      VStack(alignment: .leading, spacing: 1) {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
          // Shrinks a little before it cuts ("gt-...nsit" in the first build of this row).
          Text(d.repo)
            .font(LiveType.font(13, .medium, mono: true))
            .foregroundStyle(pal.text)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .truncationMode(.middle)
          Spacer(minLength: 4)
          Text(d.phase == .done ? (d.ranFor ?? "") : d.elapsed)
            .font(LiveType.font(13, .semibold))
            .monospacedDigit()
            .foregroundStyle(pal.textDim)
            .layoutPriority(1)
        }
        // The state always; the harness mark and name when they fit whole; then the mark alone,
        // still after a dot (the first build set it against the word: "converging" and a burst).
        ViewThatFits(in: .horizontal) {
          HStack(spacing: 4) {
            RowState(d: d, stale: stale, pal: pal).fixedSize()
            Dot(color: pal.textDim).font(LiveType.font(12, .medium))
            RowHarness(d: d, pal: pal, name: true, stale: stale).fixedSize()
          }
          HStack(spacing: 4) {
            RowState(d: d, stale: stale, pal: pal).fixedSize()
            Dot(color: pal.textDim).font(LiveType.font(12, .medium))
            RowHarness(d: d, pal: pal, name: false, stale: stale).fixedSize()
          }
          RowState(d: d, stale: stale, pal: pal).fixedSize()
        }
      }
    }
    if let url = d.url {
      Link(destination: url) { content }
    } else {
      content
    }
  }
}

/// The harness in a row: the owner's mark at 11pt (Aider's is the phone's pixel glyph) and, when
/// there is room, the short name. A harness this build has no mark for is its name alone.
@available(iOS 17.0, *)
private struct RowHarness: View {
  let d: LiveDisplay
  let pal: BuilderPalette.Scheme
  let name: Bool
  let stale: Bool

  var body: some View {
    HStack(spacing: 3) {
      if HarnessMark.has(d.agent) {
        HarnessMark(agent: d.agent, size: 11, tint: stale ? pal.textFaint : pal.textDim, flat: stale)
      }
      if name || !HarnessMark.has(d.agent) {
        Text(d.harnessShort)
          .font(LiveType.font(12, .medium))
          .foregroundStyle(pal.textDim)
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(d.harness)
  }
}

/// A row's state: the word only. The verdict glyph cost the first build's rows the harness
/// ("converging" under RideGT beside "circling · Codex" under RideGT), and the harness is what
/// tells two rows of one repo apart. Needs you is marked with the dot, and a finished turn with
/// the check, in the session's hue.
@available(iOS 17.0, *)
private struct RowState: View {
  let d: LiveDisplay
  let stale: Bool
  let pal: BuilderPalette.Scheme

  var body: some View {
    let hue = pal.creature(d.creature)
    if !stale && d.phase == .needsYou {
      HStack(spacing: 4) {
        Circle().fill(hue.ink).frame(width: 6, height: 6).widgetAccentable()
        Text(LiveCopy.needsYou).font(LiveType.font(12, .semibold)).foregroundStyle(hue.text)
      }
    } else if !stale && d.phase == .done {
      FinishedWord(size: 12, check: hue.ink, color: pal.textDim, long: false)
    } else {
      Text(d.stateWord).font(LiveType.font(12, .medium)).foregroundStyle(pal.textDim)
    }
  }
}

/// Nothing running: Bit asleep, today's attended time, and the week as seven squares.
@available(iOS 17.0, *)
private struct SmallIdle: View {
  let today: WidgetSnapshot.Today?
  let pal: BuilderPalette.Scheme
  let accented: Bool
  let saysNothingRunning: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      CreatureMark(creature: "bit-sleeping", points: 32, tint: pal.accent, trim: .leading)
      Spacer(minLength: 0)
      if let seconds = today?.attendedSeconds {
        Text(LiveCopy.duration(seconds))
          .font(LiveType.font(34, .heavy))
          .tracking(-0.6)
          .monospacedDigit()
          .foregroundStyle(pal.text)
          .lineLimit(1)
          .minimumScaleFactor(0.7)
        Text(LiveCopy.today)
          .font(LiveType.font(12, .semibold))
          .foregroundStyle(pal.textDim)
      } else if saysNothingRunning {
        Text(LiveCopy.nothingRunning)
          .font(LiveType.font(15, .semibold))
          .foregroundStyle(pal.text)
      }
      if let week = today?.week, week.count == 7 {
        WeekRow(levels: week, pal: pal, accented: accented)
          .padding(.top, 8)
      }
    }
  }
}

/// The right of a medium widget with one session listed: today's time and the week.
@available(iOS 17.0, *)
private struct TodayColumn: View {
  let today: WidgetSnapshot.Today?
  let pal: BuilderPalette.Scheme
  let accented: Bool
  /// The session on the left is running (not a finished turn), so the others are "else".
  let topRuns: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      if let seconds = today?.attendedSeconds {
        Text(LiveCopy.today)
          .font(LiveType.font(12, .semibold))
          .foregroundStyle(pal.textDim)
        Text(LiveCopy.duration(seconds))
          .font(LiveType.font(22, .bold))
          .tracking(-0.3)
          .monospacedDigit()
          .foregroundStyle(pal.text)
      }
      if let week = today?.week, week.count == 7 {
        WeekRow(levels: week, pal: pal, accented: accented).padding(.top, 6)
      }
      Spacer(minLength: 0)
      Text(topRuns ? LiveCopy.nothingElseRunning : LiveCopy.nothingRunning)
        .font(LiveType.font(12, .medium))
        .foregroundStyle(pal.textDim)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

/// Seven 14pt squares in the `graph.levels` amber ramp, today last. Tinted and clear Home
/// Screens drop colour, so there the level is opacity and an empty day is an outline: the
/// week still reads without the ramp.
@available(iOS 17.0, *)
struct WeekRow: View {
  let levels: [Int]
  let pal: BuilderPalette.Scheme
  let accented: Bool

  var body: some View {
    HStack(spacing: 4) {
      ForEach(Array(levels.enumerated()), id: \.offset) { _, raw in
        square(max(0, min(5, raw))).frame(width: 14, height: 14)
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("the last seven days")
  }

  @ViewBuilder private func square(_ level: Int) -> some View {
    let shape = RoundedRectangle(cornerRadius: 3, style: .continuous)
    if accented {
      if level == 0 {
        shape.strokeBorder(pal.textFaint, lineWidth: 1)
      } else {
        shape.fill(pal.accent.opacity(0.2 + 0.16 * Double(level))).widgetAccentable()
      }
    } else {
      shape.fill(pal.graph[level])
    }
  }
}
