import SwiftUI
import WidgetKit

// The Live Activity's layouts (DESIGN-DIRECTION 7.2). Plain SwiftUI so they compile into the
// main app too, where the debug renderer draws them to PNGs; `BuilderLiveActivity.swift` in
// the extension only places them in ActivityKit's slots.
//
// HIG numbers these are built to: Lock Screen 371 x 84 to 160pt with a 14pt margin (this one
// lands near 110pt), compact slots 52.33 x 36.67, minimal 36.67 to 45 x 36.67, expanded 371 x
// 84 to 160. Text is medium weight or heavier. Each session is drawn in its own crew creature's
// hue (DESIGN-V2 2.2; `LiveDisplay.hue`, from the generated Palette.swift): the creature, the
// ring and the capsule while the run is on track, "needs you" and its raised hand, the finished
// check. No session is Bit, so none is amber. Green and red appear only as the lines a finished
// session added and removed. Nothing is a duration computed at render (see `LiveDisplay`).
//
// Contrast, on the Lock Screen's #141210 (the island is black, higher still): every ink clears
// 4.5:1, the lowest being iris at 5.5:1, so the hue is also a word here ("needs you" at 15pt
// semibold). The numbers are in Palette.swift beside each hue, measured by gen_tokens.py.

/// The tints one card draws its marks in: the session's hue while on track, `textDim` otherwise;
/// when the data is stale, `textFaint` everywhere (a hue at partial opacity turns brown); on the
/// Always-On display the creature and ring go `textDim` (a solid coloured creature would be the
/// brightest thing on it). `accent` is the hue as a word or a state mark (needs you, finished).
@available(iOS 16.1, *)
struct MarkTints {
  let creature: Color
  let ring: Color
  let accent: Color

  init(_ d: LiveDisplay, stale: Bool, dimmed: Bool) {
    let hue = d.hue.ink
    if stale {
      creature = BuilderPalette.textFaint
      ring = BuilderPalette.textFaint
      accent = BuilderPalette.textDim
    } else if dimmed {
      creature = BuilderPalette.textDim
      ring = BuilderPalette.textDim
      accent = hue
    } else {
      creature = hue
      let full = d.onTrack || (d.phase == .done && d.ring == .arc(1))
      ring = full ? hue : BuilderPalette.textDim
      accent = hue
    }
  }
}

// MARK: - Lock Screen

@available(iOS 17.0, *)
struct LockScreenLiveView: View {
  let d: LiveDisplay
  let isStale: Bool

  @Environment(\.isLuminanceReduced) private var dimmed

  var body: some View {
    let tints = MarkTints(d, stale: isStale, dimmed: dimmed)
    HStack(alignment: .top, spacing: 12) {
      // Identity and progress, one mark: the creature inside its ring.
      LiveRing(ring: d.ring, size: 52, stroke: 4, tint: tints.ring) {
        CreatureMark(creature: d.creature, points: 32, tint: tints.creature)
      }

      VStack(alignment: .leading, spacing: 0) {
        header
        Text(d.sentence)
          .font(LiveType.font(16, .semibold))
          .foregroundStyle(BuilderPalette.text)
          .lineLimit(2)
          .fixedSize(horizontal: false, vertical: true)
          .contentTransition(.opacity)
          .padding(.top, 3)
        caption
          .padding(.top, 5)
      }
    }
    .padding(14)
  }

  private var header: some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      // The harness with its mark when it fits whole, never "Claude Co..."; then the mark alone
      // (read out as the name); then the repo alone.
      ViewThatFits(in: .horizontal) {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
          repo
          harnessMark.padding(.leading, 2)
          Text(d.harness)
            .font(LiveType.font(13, .medium))
            .foregroundStyle(BuilderPalette.textDim)
            .lineLimit(1)
            .fixedSize()
            .padding(.leading, -2)
        }
        HStack(alignment: .firstTextBaseline, spacing: 6) {
          repo
          harnessMark.accessibilityLabel(d.harness)
        }
        repo
      }
      Spacer(minLength: 0)
      trailing.layoutPriority(1)
    }
  }

  /// 14pt, sitting 2pt under the text's baseline, so its middle lines up with the lowercase of
  /// the 13pt name beside it.
  @ViewBuilder private var harnessMark: some View {
    if HarnessMark.has(d.agent) {
      HarnessMark(agent: d.agent, size: 14, tint: isStale ? BuilderPalette.textFaint : BuilderPalette.textDim, flat: isStale)
        .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 2 }
    }
  }

  private var repo: some View {
    Text(d.repo)
      .font(LiveType.font(14, .semibold, mono: true))
      .foregroundStyle(BuilderPalette.text)
      .lineLimit(1)
      .truncationMode(.middle)
  }

  @ViewBuilder private var trailing: some View {
    if isStale {
      // Whether it still runs is exactly what is not known: no timer claiming it does.
      EmptyView()
    } else {
      switch d.phase {
      case .needsYou:
        NeedsYouMark(size: 15, color: MarkTints(d, stale: false, dimmed: dimmed).accent)
      case .done:
        Text(d.ranFor.map { "\(LiveCopy.ran) \($0)" } ?? LiveCopy.finished)
          .font(LiveType.font(15, .semibold))
          .monospacedDigit()
          .foregroundStyle(BuilderPalette.textDim)
          .lineLimit(1)
      case .working, .stalled:
        ElapsedTimer(start: d.startDate, size: 15,
                     color: d.phase == .stalled ? BuilderPalette.textDim : BuilderPalette.text)
      }
    }
  }

  @ViewBuilder private var caption: some View {
    if isStale {
      NotUpdatingLine(since: d.updated, size: 13)
    } else if d.phase == .done {
      FinishedLine(d: d, size: 13)
    } else {
      CaptionLine(parts: d.captionParts, size: 13)
    }
  }
}

/// "Not updating since 9:41", at full strength: the one thing on a stale card that is news.
@available(iOS 16.1, *)
struct NotUpdatingLine: View {
  let since: Date
  var size: CGFloat
  var color: Color = BuilderPalette.text

  var body: some View {
    (Text(LiveCopy.notUpdatingSince + " ") + Text(since, style: .time))
      .font(LiveType.font(size, .semibold))
      .foregroundStyle(color)
      .lineLimit(1)
  }
}

/// "done around 9:50 · (>) converging · 9 files changed · 1 more running", shedding pieces from
/// the end when the width runs out rather than truncating mid word.
@available(iOS 17.0, *)
struct CaptionLine: View {
  let parts: [LiveDisplay.Part]
  var size: CGFloat
  var color: Color = BuilderPalette.textDim

  var body: some View {
    let n = parts.count
    ViewThatFits(in: .horizontal) {
      row(n)
      row(max(1, n - 1))
      row(max(1, n - 2))
      row(1)
    }
  }

  private func row(_ k: Int) -> some View {
    HStack(spacing: 6) {
      ForEach(Array(parts.prefix(k).enumerated()), id: \.offset) { i, part in
        if i > 0 { Dot(color: color) }
        piece(part).fixedSize()
      }
    }
    .font(LiveType.font(size, .medium))
    .foregroundStyle(color)
    .lineLimit(1)
  }

  @ViewBuilder private func piece(_ part: LiveDisplay.Part) -> some View {
    switch part {
    case .words(let w):
      Text(w)
    case .clock(let words, let date):
      Text(words + " ") + Text(date, style: .time)
    case .verdict(let v):
      VerdictLabel(verdict: v, size: size, color: color)
    case .verdictSince(let v, let date):
      VerdictLabel(verdict: v, size: size, color: color, since: date)
    }
  }
}

/// "+420 -88 · 3 commits · 12 files changed": green added, red removed (the only colours
/// besides the session's hue), each part only when MORE THAN NONE. The first build drew "+0 -0 · 0
/// commits" in green and red for a session that wrote nothing (it tested nil, and 0 is not
/// nil). Nothing landed, and counted as nothing, is one quiet line; unknown counts are none.
@available(iOS 17.0, *)
struct FinishedLine: View {
  let d: LiveDisplay
  var size: CGFloat
  var add: Color = BuilderPalette.add
  var del: Color = BuilderPalette.del
  var dimColor: Color = BuilderPalette.textDim

  var body: some View {
    let p = d.landedParts
    if p.added == nil && p.removed == nil && p.commits == nil && p.files == nil {
      if d.countedNothing {
        Text(LiveCopy.nothingLanded)
          .font(LiveType.font(size, .semibold))
          .foregroundStyle(dimColor)
          .lineLimit(1)
      }
    } else {
      ViewThatFits(in: .horizontal) {
        line(files: true)
        line(files: false)
      }
    }
  }

  private func line(files: Bool) -> some View {
    let p = d.landedParts
    let hasLines = p.added != nil || p.removed != nil
    return HStack(spacing: 6) {
      if let a = p.added { Text(a).foregroundStyle(add) }
      if let r = p.removed { Text(r).foregroundStyle(del) }
      if let c = p.commits {
        if hasLines { Dot(color: dimColor) }
        Text(c).foregroundStyle(dimColor)
      }
      if files, let f = p.files {
        if hasLines || p.commits != nil { Dot(color: dimColor) }
        Text(f).foregroundStyle(dimColor)
      }
    }
    .font(LiveType.font(size, .semibold))
    .monospacedDigit()
    .lineLimit(1)
    .fixedSize()
  }
}

/// hand.raised.fill and the words, in the session's hue: the one "look here" on its card. Its
/// shape and the words say it, so a colour blind reader and a tinted widget lose nothing.
@available(iOS 17.0, *)
struct NeedsYouMark: View {
  var size: CGFloat
  var color: Color

  var body: some View {
    HStack(spacing: 4) {
      Image(systemName: "hand.raised.fill")
        .font(LiveType.font(size - 1, .bold))
      Text(LiveCopy.needsYou)
        .font(LiveType.font(size, .semibold))
    }
    .foregroundStyle(color)
    .widgetAccentable()
    .accessibilityElement(children: .combine)
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

/// Compact leading: the creature in its hue, bare and snug to the camera. Its frame's empty
/// columns are trimmed, or a narrow creature (Bit leaves three a side) would carry padding the
/// HIG rules out.
@available(iOS 17.0, *)
struct IslandCompactLeading: View {
  let d: LiveDisplay
  let isStale: Bool
  var body: some View {
    CreatureMark(creature: d.creature, points: 32,
                 tint: MarkTints(d, stale: isStale, dimmed: false).creature, trim: .horizontal)
  }
}

/// Compact trailing: the elapsed time as a system timer, in `text`, not the hue: the hue here is
/// the creature beside it, so the move into needs you is a change of shape (the raised hand, in
/// the hue) and not a colour appearing. 14pt, the size at which "7:59:59" (54.1pt) fits the
/// slot: a run passes an hour with no redraw while the app is in the background, so the box is
/// sized for hours from the start. The hand is drawn to hold its own beside the 32pt creature.
@available(iOS 17.0, *)
struct IslandCompactTrailing: View {
  let d: LiveDisplay
  let isStale: Bool
  var body: some View {
    let accent = MarkTints(d, stale: isStale, dimmed: false).accent
    switch d.phase {
    case .needsYou:
      Image(systemName: "hand.raised.fill")
        .font(LiveType.font(18, .bold))
        .foregroundStyle(accent)
        .accessibilityLabel(LiveCopy.needsYou)
    case .done:
      Image(systemName: "checkmark")
        .font(LiveType.font(15, .bold))
        .foregroundStyle(accent)
        .accessibilityLabel(LiveCopy.finished)
    case .working, .stalled:
      ElapsedTimer(start: d.startDate, size: 14,
                   color: d.phase == .stalled || isStale ? BuilderPalette.textDim : BuilderPalette.text,
                   width: 56)
    }
  }
}

/// Minimal: the creature inside its 26pt ring, so it says Builda and how far along at once
/// (StandBy shows this view on its own); the raised hand when it needs you. The first build
/// put a bare file count here, which read as a countdown in a spinner.
@available(iOS 17.0, *)
struct IslandMinimal: View {
  let d: LiveDisplay
  let isStale: Bool
  var body: some View {
    let tints = MarkTints(d, stale: isStale, dimmed: false)
    LiveRing(ring: d.ring, size: 26, stroke: 2.5, tint: tints.ring) {
      if d.phase == .needsYou {
        Image(systemName: "hand.raised.fill")
          .font(LiveType.font(12, .bold))
          .foregroundStyle(tints.accent)
          .accessibilityLabel(LiveCopy.needsYou)
      } else {
        CreatureMark(creature: d.creature, points: 16, tint: tints.creature)
      }
    }
  }
}

/// Expanded leading: the creature at 16pt (the compact view already shows it at 32) and the
/// repo, level with the trailing time. It takes the width first (`priority` in
/// BuilderLiveActivity.swift), and a name too long to sit beside the camera drops below it
/// (`belowIfTooWide`) instead of being cut: "private repo" was "privat..." in the first build.
///
/// Its width is its own, never `maxWidth: .infinity`: the system measures the content to decide
/// "too wide", and an infinite frame read as too wide for every name, so even "RideGT" was put
/// under the camera, a line below the timer (capture, 2026-09-13).
@available(iOS 17.0, *)
struct IslandExpandedLeading: View {
  let d: LiveDisplay
  let isStale: Bool
  var body: some View {
    HStack(spacing: 6) {
      CreatureMark(creature: d.creature, points: 16,
                   tint: MarkTints(d, stale: isStale, dimmed: false).creature, trim: .leading)
      Text(d.repo)
        .font(LiveType.font(15, .semibold, mono: true))
        .foregroundStyle(BuilderPalette.text)
        .lineLimit(1)
        .truncationMode(.middle)
    }
    .frame(height: 22)
    .padding(.leading, 4)
    .frame(maxHeight: .infinity, alignment: .top)
  }
}

@available(iOS 17.0, *)
struct IslandExpandedTrailing: View {
  let d: LiveDisplay
  let isStale: Bool
  var body: some View {
    Group {
      if isStale {
        EmptyView()
      } else {
        switch d.phase {
        case .needsYou:
          NeedsYouMark(size: 15, color: d.hue.ink)
        case .done:
          Text(d.ranFor.map { "\(LiveCopy.ran) \($0)" } ?? LiveCopy.finished)
            .font(LiveType.font(15, .semibold))
            .monospacedDigit()
            .foregroundStyle(BuilderPalette.textDim)
        case .working, .stalled:
          ElapsedTimer(start: d.startDate, size: 17,
                       color: d.phase == .stalled ? BuilderPalette.textDim : BuilderPalette.text)
        }
      }
    }
    .lineLimit(1)
    .frame(height: 22)
    .frame(maxHeight: .infinity, alignment: .topTrailing)
    .padding(.trailing, 4)
  }
}

/// Expanded bottom: the sentence on two lines, then one row: the progress capsule when there is
/// an honest number, and the caption. Two rows, lifted off the bottom: the system clips this
/// region to the island's rounded lower corners, and a third row sitting low in them lost the
/// left of its first letter in every state ("no ETA yet", 2026-09-13), which the ImageRenderer
/// mock never shows. Lifted rather than inset, so the caption still lines up with the sentence.
@available(iOS 17.0, *)
struct IslandExpandedBottom: View {
  let d: LiveDisplay
  let isStale: Bool

  var body: some View {
    let tints = MarkTints(d, stale: isStale, dimmed: false)
    VStack(alignment: .leading, spacing: 8) {
      Text(d.sentence)
        .font(LiveType.font(15, .semibold))
        .foregroundStyle(BuilderPalette.text)
        .lineLimit(2)
        .fixedSize(horizontal: false, vertical: true)
        .contentTransition(.opacity)
      Group {
        if isStale {
          NotUpdatingLine(since: d.updated, size: 13)
        } else if d.phase == .done {
          FinishedLine(d: d, size: 13)
        } else if case .arc(let p) = d.ring {
          HStack(spacing: 10) {
            ProgressCapsule(progress: p, tint: tints.ring)
              .frame(width: 84)
            CaptionLine(parts: d.captionParts, size: 13)
            Spacer(minLength: 0)
          }
        } else {
          CaptionLine(parts: d.captionParts, size: 13)
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.horizontal, 4)
    .padding(.top, 2)
    .padding(.bottom, 8)
  }
}
