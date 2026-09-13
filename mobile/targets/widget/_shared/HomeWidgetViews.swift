import SwiftUI
import WidgetKit

// The Home Screen widget (DESIGN-DIRECTION 7.3): small and medium, light, dark and tinted.
// Plain SwiftUI, so the main app can render it for review; the extension wraps it in
// `containerBackground`, which also gives it the system's 16pt content margins.

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
    var phase: String
    var sentence: String
    var trajectory: String
    /// Unix seconds.
    var startedEpoch: Double
    var progress: Double
    /// Files changed (edits, never reads); negative when not counted.
    var filesChanged: Int
    var etaEpoch: Double?
    /// When the condition began: waiting on you, no new output, a failing command.
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
  var creature: String
  /// Every session running, which can be more than the four listed.
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

@available(iOS 16.1, *)
extension WidgetSnapshot {
  /// `more`: the sessions running beside this one that the widget does not show otherwise.
  func display(_ s: Session, now: Date, more: Int = 0) -> LiveDisplay {
    LiveDisplay(
      sessionId: s.id, repo: s.repo, agent: s.agent, startedEpoch: s.startedEpoch,
      phase: s.phase, sentence: s.sentence, progress: s.progress, filesChanged: s.filesChanged,
      etaEpoch: s.etaEpoch, sinceEpoch: s.sinceEpoch, endedEpoch: nil,
      trajectory: s.trajectory, creature: creature,
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
          SmallRunning(d: snap.display(top, now: now, more: snap.runningCount - 1), stale: stale, pal: pal, accented: accented)
        case .medium:
          // A hairline between the columns; the others are rows, so the left says no "N more".
          let others = Array(sessions.dropFirst().prefix(3))
          HStack(alignment: .top, spacing: 12) {
            SmallRunning(d: snap.display(top, now: now), stale: stale, pal: pal, accented: accented)
              .frame(width: 150, alignment: .leading)
            Rectangle().fill(pal.border).frame(width: 1)
            if others.isEmpty {
              TodayColumn(today: snap.today, pal: pal, accented: accented)
            } else {
              SessionRows(rows: others.map { snap.display($0, now: now) },
                          hidden: max(0, snap.runningCount - 1 - others.count), stale: stale, pal: pal)
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

/// The repo top left with the creature small beside it on the right (the Home Screen already
/// labels the widget "Builder", so the mark only has to be recognisable), the big number, the
/// sentence on up to three lines, and the state. The small widget, and the left of the medium.
///
/// The big number is the one that matters for the state: how long it has waited on you when it
/// needs you, otherwise how long it has run. Each is drawn at the timeline entry's `now`, which
/// advances every minute.
@available(iOS 17.0, *)
private struct SmallRunning: View {
  let d: LiveDisplay
  let stale: Bool
  let pal: BuilderPalette.Scheme
  let accented: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .center, spacing: 6) {
        Text(d.repo)
          .font(LiveType.font(13, .semibold, mono: true))
          .foregroundStyle(pal.text)
          .lineLimit(1)
          .truncationMode(.middle)
        Spacer(minLength: 4)
        CreatureMark(creature: d.creature, points: 16, tint: stale ? pal.textFaint : pal.accent)
      }
      Spacer(minLength: 2)
      Text(d.phase == .needsYou ? (d.sinceElapsed ?? d.elapsed) : d.elapsed)
        .font(LiveType.font(28, .heavy))
        .tracking(-0.5)
        .monospacedDigit()
        .foregroundStyle(stale ? pal.textDim : pal.text)
        .lineLimit(1)
        .minimumScaleFactor(0.7)
      Text(d.sentence)
        .font(LiveType.font(13, .semibold))
        .foregroundStyle(stale ? pal.textDim : pal.text)
        .lineLimit(3)
        .minimumScaleFactor(0.9)
        .fixedSize(horizontal: false, vertical: true)
      StateLine(d: d, stale: stale, pal: pal, size: 12)
        .padding(.top, 3)
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
      let more = d.others == 0 ? nil : "\(d.others) more"
      ViewThatFits(in: .horizontal) {
        HStack(spacing: 4) {
          StateWord(d: d, pal: pal, size: size).fixedSize()
          if let more {
            Dot(color: pal.textDim).font(LiveType.font(size, .medium))
            Text(more).font(LiveType.font(size, .semibold)).foregroundStyle(pal.textDim).fixedSize()
          }
        }
        StateWord(d: d, pal: pal, size: size).fixedSize()
      }
    }
  }
}

/// The state as a word. Needs you is a 6pt amber dot and the words, amber on dark and `text`
/// on light (amber text is 1.7:1 on the light ground); the Lock Screen's raised hand is too wide
/// for a widget's column beside "4 more". A verdict is its drawn glyph and word in `textDim`.
/// The word always carries the meaning, so tinted and clear widgets lose nothing.
@available(iOS 17.0, *)
private struct StateWord: View {
  let d: LiveDisplay
  let pal: BuilderPalette.Scheme
  var size: CGFloat

  var body: some View {
    if d.phase == .needsYou {
      HStack(spacing: 5) {
        Circle().fill(pal.accent).frame(width: 6, height: 6).widgetAccentable()
        Text(LiveCopy.needsYou)
          .font(LiveType.font(size, .semibold))
          .foregroundStyle(pal.amberIsText ? pal.accent : pal.text)
      }
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

/// Up to three more sessions, one row each with a hairline between: the repo in mono and the
/// elapsed time, then the state and which harness, cut to the word that tells two rows apart
/// ("Claude", "Codex"). Each row opens its session. Then "+N more" for any not listed.
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
    let content = VStack(alignment: .leading, spacing: 1) {
      HStack(alignment: .firstTextBaseline, spacing: 6) {
        Text(d.repo)
          .font(LiveType.font(13, .medium, mono: true))
          .foregroundStyle(pal.text)
          .lineLimit(1)
          .truncationMode(.middle)
        Spacer(minLength: 4)
        Text(d.elapsed)
          .font(LiveType.font(13, .semibold))
          .monospacedDigit()
          .foregroundStyle(pal.textDim)
          .layoutPriority(1)
      }
      // The state always; the harness when it fits whole.
      ViewThatFits(in: .horizontal) {
        HStack(spacing: 4) {
          RowState(d: d, stale: stale, pal: pal).fixedSize()
          Dot(color: pal.textDim).font(LiveType.font(12, .medium))
          Text(d.harnessShort)
            .font(LiveType.font(12, .medium))
            .foregroundStyle(pal.textDim)
            .fixedSize()
        }
        RowState(d: d, stale: stale, pal: pal).fixedSize()
      }
    }
    if let url = d.url {
      Link(destination: url) { content }
    } else {
      content
    }
  }
}

/// A row's state: the word only. The verdict glyph cost the first build's rows the harness
/// ("converging" under RideGT beside "circling · Codex" under RideGT), and the harness is what
/// tells two rows of one repo apart. Needs you is still marked with the amber dot.
@available(iOS 17.0, *)
private struct RowState: View {
  let d: LiveDisplay
  let stale: Bool
  let pal: BuilderPalette.Scheme

  var body: some View {
    if !stale && d.phase == .needsYou {
      HStack(spacing: 4) {
        Circle().fill(pal.accent).frame(width: 6, height: 6).widgetAccentable()
        Text(LiveCopy.needsYou).font(LiveType.font(12, .semibold)).foregroundStyle(pal.amberIsText ? pal.accent : pal.text)
      }
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

/// The right of a medium widget with one session running: today's time and the week.
@available(iOS 17.0, *)
private struct TodayColumn: View {
  let today: WidgetSnapshot.Today?
  let pal: BuilderPalette.Scheme
  let accented: Bool

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
      Text("Nothing else running.")
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
