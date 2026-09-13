import SwiftUI
import WidgetKit

// The Live Activity's layouts (DESIGN-DIRECTION 7.2). Plain SwiftUI so they compile into the
// main app too, where the debug renderer draws them to PNGs; `BuilderLiveActivity.swift` in
// the extension only places them in ActivityKit's slots.
//
// HIG numbers these are built to: Lock Screen 371 x 84 to 160pt with a 14pt margin (this one
// lands near 124pt), compact slots 52.33 x 36.67, minimal 36.67 to 45 x 36.67, expanded 371 x
// 84 to 160. Text is medium weight or heavier. Amber is spent on progress, the creature and
// "needs you"; green and red appear only as the lines a finished session added and removed.

// MARK: - Lock Screen

@available(iOS 17.0, *)
struct LockScreenLiveView: View {
  let d: LiveDisplay
  let isStale: Bool

  /// "Not updating" is the one thing at full strength when the data stopped arriving.
  private var dim: Double { isStale ? 0.45 : 1 }

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      // Identity over progress: the creature, then the ring, one 44pt column.
      VStack(spacing: 6) {
        CreatureMark(creature: d.creature, points: 32)
        LiveRing(progress: d.ring, size: 44, stroke: 5) { RingCount(files: d.files, size: 13) }
      }
      .frame(width: 44)
      .opacity(dim)

      VStack(alignment: .leading, spacing: 0) {
        header
          .frame(height: 32)
          .opacity(dim)
        Text(d.sentence)
          .font(LiveType.font(15, .semibold))
          .foregroundStyle(BuilderPalette.text)
          .lineLimit(2)
          .fixedSize(horizontal: false, vertical: true)
          .contentTransition(.opacity)
          .padding(.top, 6)  // the first line starts level with the ring
          .opacity(dim)
        caption
          .padding(.top, 6)
      }
    }
    .padding(14)
  }

  private var header: some View {
    HStack(alignment: .firstTextBaseline, spacing: 6) {
      Text(d.repo)
        .font(LiveType.font(15, .semibold))
        .foregroundStyle(BuilderPalette.text)
        .lineLimit(1)
      Text(d.harness)
        .font(LiveType.font(13, .medium))
        .foregroundStyle(BuilderPalette.textDim)
        .lineLimit(1)
      Spacer(minLength: 8)
      trailing.layoutPriority(1)
    }
  }

  @ViewBuilder private var trailing: some View {
    switch d.phase {
    case .needsYou:
      NeedsYouMark(size: 15)
    case .done:
      Text(LiveCopy.finished)
        .font(LiveType.font(15, .semibold))
        .foregroundStyle(BuilderPalette.text)
    case .working, .stalled:
      Text(d.elapsed)
        .font(LiveType.font(15, .semibold))
        .monospacedDigit()
        .foregroundStyle(d.phase == .stalled ? BuilderPalette.textDim : BuilderPalette.text)
        .contentTransition(.numericText())
    }
  }

  @ViewBuilder private var caption: some View {
    if isStale {
      Text(LiveCopy.notUpdating)
        .font(LiveType.font(13, .semibold))
        .foregroundStyle(BuilderPalette.textDim)
    } else if d.phase == .done {
      FinishedLine(d: d, size: 13, more: d.moreRunning)
    } else {
      ProgressCaption(d: d, size: 13)
    }
  }
}

/// "about 18m left · (o) converging · 2 more running", shedding its tail when the width runs out
/// rather than truncating mid word.
@available(iOS 17.0, *)
struct ProgressCaption: View {
  let d: LiveDisplay
  var size: CGFloat
  var showMore: Bool = true

  var body: some View {
    ViewThatFits(in: .horizontal) {
      row(verdict: true, more: showMore)
      row(verdict: true, more: false)
      row(verdict: false, more: false)
    }
  }

  private func row(verdict: Bool, more: Bool) -> some View {
    HStack(spacing: 6) {
      Text(d.eta).fixedSize()
      if verdict, let v = d.verdict {
        Dot()
        VerdictLabel(verdict: v, size: size).fixedSize()
      }
      if more, let m = d.moreRunning {
        Dot()
        Text(m).fixedSize()
      }
    }
    .font(LiveType.font(size, .medium))
    .foregroundStyle(BuilderPalette.textDim)
    .lineLimit(1)
  }
}

/// "+420 −88 · 3 commits": green added, red removed (the only colours besides amber), each part
/// only when it was counted. Nothing counted is no line at all, never "+0".
@available(iOS 17.0, *)
struct FinishedLine: View {
  let d: LiveDisplay
  var size: CGFloat
  var more: String?
  var add: Color = BuilderPalette.add
  var del: Color = BuilderPalette.del
  var dimColor: Color = BuilderPalette.textDim

  var body: some View {
    let hasLines = d.added != nil || d.removed != nil
    HStack(spacing: 6) {
      if let a = d.added { Text(a).foregroundStyle(add) }
      if let r = d.removed { Text(r).foregroundStyle(del) }
      if let c = d.commitsText {
        if hasLines { Dot(color: dimColor) }
        Text(c).foregroundStyle(dimColor)
      }
      if let m = more {
        if hasLines || d.commitsText != nil { Dot(color: dimColor) }
        Text(m).foregroundStyle(dimColor)
      }
    }
    .font(LiveType.font(size, .semibold))
    .monospacedDigit()
    .lineLimit(1)
  }
}

/// hand.raised.fill and the words, amber. Never teal: amber is the one "look here" colour.
@available(iOS 17.0, *)
struct NeedsYouMark: View {
  var size: CGFloat
  var color: Color = BuilderPalette.amber

  var body: some View {
    HStack(spacing: 4) {
      Image(systemName: "hand.raised.fill")
        .font(LiveType.font(size - 2, .semibold))
      Text(LiveCopy.needsYou)
        .font(LiveType.font(size, .semibold))
    }
    .foregroundStyle(color)
    .widgetAccentable()
    .accessibilityElement(children: .combine)
  }
}

/// The count inside a ring: files touched, rolling when it changes. Empty when uncounted.
@available(iOS 17.0, *)
struct RingCount: View {
  let files: Int?
  var size: CGFloat
  var color: Color = BuilderPalette.text

  var body: some View {
    if let f = files {
      Text(LiveCopy.count(f))
        .font(LiveType.font(size, .bold))
        .monospacedDigit()
        .foregroundStyle(color)
        .lineLimit(1)
        .minimumScaleFactor(0.6)
        .contentTransition(.numericText(value: Double(f)))
        .accessibilityLabel("\(f) files")
    }
  }
}

@available(iOS 17.0, *)
struct Dot: View {
  var color: Color = BuilderPalette.textDim
  var body: some View {
    Text(LiveCopy.separator).foregroundStyle(color).accessibilityHidden(true)
  }
}

// MARK: - Dynamic Island

/// Compact leading: the creature, bare and snug to the camera. Its frame's empty columns are
/// trimmed, or a narrow creature (Bit leaves four a side) would carry padding the HIG rules out.
@available(iOS 17.0, *)
struct IslandCompactLeading: View {
  let d: LiveDisplay
  var body: some View {
    CreatureMark(creature: d.creature, points: 32, trim: .horizontal)
  }
}

/// Compact trailing: minutes, amber and tabular ("22m"), not `Text(timerInterval:)`, which
/// rendered "10:--" on a freshly locked phone in the lab. Needs you is the raised hand.
@available(iOS 17.0, *)
struct IslandCompactTrailing: View {
  let d: LiveDisplay
  var body: some View {
    switch d.phase {
    case .needsYou:
      Image(systemName: "hand.raised.fill")
        .font(LiveType.font(15, .semibold))
        .foregroundStyle(BuilderPalette.amber)
        .accessibilityLabel(LiveCopy.needsYou)
    case .done:
      Image(systemName: "checkmark")
        .font(LiveType.font(15, .bold))
        .foregroundStyle(BuilderPalette.amber)
        .accessibilityLabel(LiveCopy.finished)
    case .working, .stalled:
      Text(d.elapsedCompact)
        .font(LiveType.font(15, .semibold))
        .monospacedDigit()
        .foregroundStyle(d.phase == .stalled ? BuilderPalette.textDim : BuilderPalette.amber)
        .lineLimit(1)
        .minimumScaleFactor(0.7)
    }
  }
}

/// Minimal: the ring at 24pt with the file count (updated information, not a logo). StandBy
/// shows this one on its own, so it has to read without the rest.
@available(iOS 17.0, *)
struct IslandMinimal: View {
  let d: LiveDisplay
  var body: some View {
    LiveRing(progress: d.ring, size: 24, stroke: 3) {
      if d.phase == .needsYou {
        Image(systemName: "hand.raised.fill")
          .font(LiveType.font(10, .bold))
          .foregroundStyle(BuilderPalette.amber)
          .accessibilityLabel(LiveCopy.needsYou)
      } else {
        RingCount(files: d.files, size: 10)
      }
    }
  }
}

/// Expanded leading: the creature and the repo, pinned top leading so it sits level with the
/// trailing time instead of floating in the middle of its region.
@available(iOS 17.0, *)
struct IslandExpandedLeading: View {
  let d: LiveDisplay
  var body: some View {
    HStack(spacing: 8) {
      CreatureMark(creature: d.creature, points: 32, trim: .leading)
      Text(d.repo)
        .font(LiveType.font(15, .semibold))
        .foregroundStyle(BuilderPalette.text)
        .lineLimit(1)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .padding(.leading, 4)
  }
}

@available(iOS 17.0, *)
struct IslandExpandedTrailing: View {
  let d: LiveDisplay
  var body: some View {
    Group {
      switch d.phase {
      case .needsYou:
        NeedsYouMark(size: 15)
      case .done:
        Text(LiveCopy.finished)
          .font(LiveType.font(15, .semibold))
          .foregroundStyle(BuilderPalette.text)
      case .working, .stalled:
        Text(d.elapsed)
          .font(LiveType.font(22, .bold))
          .tracking(-0.3)
          .monospacedDigit()
          .foregroundStyle(d.phase == .stalled ? BuilderPalette.textDim : BuilderPalette.amber)
          .contentTransition(.numericText())
      }
    }
    .lineLimit(1)
    .frame(height: 32)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
    .padding(.trailing, 4)
  }
}

/// Expanded bottom: the sentence on two lines, then the 4pt progress capsule (dots when there
/// is no honest number) and the ETA with the verdict. A finished run shows what it made.
@available(iOS 17.0, *)
struct IslandExpandedBottom: View {
  let d: LiveDisplay
  let isStale: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(d.sentence)
        .font(LiveType.font(15, .semibold))
        .foregroundStyle(BuilderPalette.text)
        .lineLimit(2)
        .fixedSize(horizontal: false, vertical: true)
        .contentTransition(.opacity)
        .opacity(isStale ? 0.45 : 1)
      if d.phase == .done {
        FinishedLine(d: d, size: 13, more: nil)
      } else {
        ProgressCapsule(progress: d.ring)
          .opacity(isStale ? 0.45 : 1)
        if isStale {
          Text(LiveCopy.notUpdating)
            .font(LiveType.font(13, .semibold))
            .foregroundStyle(BuilderPalette.textDim)
        } else {
          ProgressCaption(d: d, size: 13, showMore: false)
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.horizontal, 4)
    .padding(.top, 2)
  }
}
