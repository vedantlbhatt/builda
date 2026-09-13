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
    var filesTouched: Int
    var etaEpoch: Double?
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
  func display(_ s: Session, now: Date) -> LiveDisplay {
    LiveDisplay(
      sessionId: s.id, repo: s.repo, agent: s.agent, startedEpoch: s.startedEpoch,
      phase: s.phase, sentence: s.sentence, progress: s.progress, filesTouched: s.filesTouched,
      etaEpoch: s.etaEpoch, trajectory: s.trajectory, creature: creature,
      linesAdded: nil, linesRemoved: nil, commits: nil,
      runningCount: max(0, runningCount - 1), now: max(now.timeIntervalSince1970, updatedEpoch))
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
        let d = snap.display(top, now: now)
        switch size {
        case .small:
          SmallRunning(d: d, running: snap.runningCount, stale: stale, pal: pal)
        case .medium:
          // A hairline between the columns: without it the running count ("5 running") and
          // the first row's repo read as one line of text.
          HStack(alignment: .top, spacing: 12) {
            SmallRunning(d: d, running: snap.runningCount, stale: stale, pal: pal)
              .frame(width: 150)
            Rectangle().fill(pal.border).frame(width: 1)
            let others = Array(sessions.dropFirst().prefix(3))
            if others.isEmpty {
              TodayColumn(today: snap.today, pal: pal, accented: accented)
            } else {
              SessionRows(rows: others.map { snap.display($0, now: now) }, stale: stale, pal: pal)
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
              .frame(width: 150)
            VStack(alignment: .leading, spacing: 4) {
              Text(LiveCopy.nothingRunning)
                .font(LiveType.font(15, .semibold))
                .foregroundStyle(pal.text)
              Text(LiveCopy.goDoSomethingElse)
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

/// Creature 32 top left, running count top right, the elapsed time big, the sentence on two
/// lines, and one state word. The small widget, and the left of the medium one.
@available(iOS 17.0, *)
private struct SmallRunning: View {
  let d: LiveDisplay
  let running: Int
  let stale: Bool
  let pal: BuilderPalette.Scheme

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .top) {
        CreatureMark(creature: d.creature, points: 32, tint: pal.accent, trim: .leading)
        Spacer(minLength: 4)
        Text("\(running) running")
          .font(LiveType.font(13, .semibold))
          .foregroundStyle(pal.textDim)
          .lineLimit(1)
      }
      Spacer(minLength: 0)
      Text(d.elapsed)
        .font(LiveType.font(34, .heavy))
        .tracking(-0.6)
        .monospacedDigit()
        .foregroundStyle(pal.text)
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .opacity(stale ? 0.45 : 1)
      Text(d.sentence)
        .font(LiveType.font(13, .semibold))
        .foregroundStyle(pal.text)
        .lineLimit(2)
        .fixedSize(horizontal: false, vertical: true)
        .opacity(stale ? 0.45 : 1)
      StateWord(d: d, stale: stale, pal: pal, size: 12)
        .padding(.top, 3)
    }
  }
}

/// The state as a word. Needs you is amber on dark and `text` after an amber dot on light
/// (amber text is 1.7:1 on the light ground). A verdict is its drawn glyph and word in
/// `textDim`. The word always carries the meaning, so tinted and clear widgets lose nothing.
@available(iOS 17.0, *)
private struct StateWord: View {
  let d: LiveDisplay
  let stale: Bool
  let pal: BuilderPalette.Scheme
  var size: CGFloat

  var body: some View {
    if stale {
      Text(LiveCopy.notUpdating)
        .font(LiveType.font(size, .semibold))
        .foregroundStyle(pal.textDim)
    } else if d.phase == .needsYou {
      if pal.amberIsText {
        NeedsYouMark(size: size, color: pal.accent)
      } else {
        HStack(spacing: 5) {
          Circle().fill(pal.accent).frame(width: 6, height: 6).widgetAccentable()
          Text(LiveCopy.needsYou)
            .font(LiveType.font(size, .semibold))
            .foregroundStyle(pal.text)
        }
      }
    } else if d.phase == .working, let v = d.verdict {
      VerdictLabel(verdict: v, size: size, color: pal.textDim)
    } else {
      Text(d.stateWord)
        .font(LiveType.font(size, .semibold))
        .foregroundStyle(pal.textDim)
    }
  }
}

/// Up to three more sessions, one row each with a hairline between: the repo in mono and the
/// elapsed time, then the state and the harness. Each row opens its session.
@available(iOS 17.0, *)
private struct SessionRows: View {
  let rows: [LiveDisplay]
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
        Spacer(minLength: 4)
        Text(d.elapsed)
          .font(LiveType.font(13, .semibold))
          .monospacedDigit()
          .foregroundStyle(pal.textDim)
          .layoutPriority(1)
      }
      // The state always; the harness only when it fits whole, never "Claud...".
      ViewThatFits(in: .horizontal) {
        HStack(spacing: 4) {
          StateWord(d: d, stale: stale, pal: pal, size: 12).fixedSize()
          Dot(color: pal.textDim).font(LiveType.font(12, .medium))
          Text(d.harness)
            .font(LiveType.font(12, .medium))
            .foregroundStyle(pal.textDim)
            .fixedSize()
        }
        StateWord(d: d, stale: stale, pal: pal, size: 12).fixedSize()
      }
    }
    if let url = d.url {
      Link(destination: url) { content }
    } else {
      content
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
