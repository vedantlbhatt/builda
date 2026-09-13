import SwiftUI
import WidgetKit

// The drawn marks every live surface shares: the progress ring, the verdict glyphs, the
// creature, and the island's progress capsule. Pure SwiftUI (plus two WidgetKit modifiers that
// are no-ops outside a widget), so the main app can ImageRenderer them for review.

enum LiveType {
  /// SF Pro at a fixed size. Live surfaces use medium weight or heavier (HIG), so there is no
  /// regular here on purpose.
  static func font(_ size: CGFloat, _ weight: Font.Weight, mono: Bool = false) -> Font {
    .system(size: size, weight: weight, design: mono ? .monospaced : .default)
  }
}

// MARK: - Ring

/// Apple Fitness geometry: an arc on a hairline-colour track, round caps, starting at 12
/// o'clock and running clockwise, with the creature inside, so identity and progress are one
/// mark. The arc is amber only while the run is on track (the caller passes `textDim` for
/// circling, lost, stalled and past the typical run, so a full amber ring never means both
/// "finished" and "running long"). `.dotted` is "no honest number yet": fine dots in
/// `textFaint` round the track, never a guessed arc; fat dots read as a loading spinner at
/// this size (critique, 2026-09-13), so these are 1.5pt, about 4pt apart. `.track` is the
/// empty ring: waiting on you, or finished with nothing landed.
@available(iOS 17.0, *)
struct LiveRing<Center: View>: View {
  var ring: LiveDisplay.Ring
  var size: CGFloat
  var stroke: CGFloat
  var track: Color = BuilderPalette.border
  var tint: Color = BuilderPalette.amber
  var dots: Color = BuilderPalette.textFaint
  @ViewBuilder var center: () -> Center

  var body: some View {
    ZStack {
      switch ring {
      case .arc(let p):
        Circle().inset(by: stroke / 2).stroke(track, lineWidth: stroke)
        Circle().inset(by: stroke / 2)
          .trim(from: 0, to: max(0.0001, min(p, 1)))
          .stroke(tint, style: StrokeStyle(lineWidth: stroke, lineCap: .round))
          .rotationEffect(.degrees(-90))
          .widgetAccentable()
      case .track:
        Circle().inset(by: stroke / 2).stroke(track, lineWidth: stroke)
      case .dotted:
        let w: CGFloat = 1.5
        let circumference = Double.pi * Double(size - stroke)
        let count = max(12, (circumference / 4.5).rounded())
        let interval = CGFloat(circumference / count)
        Circle().inset(by: stroke / 2)
          .stroke(dots, style: StrokeStyle(lineWidth: w, lineCap: .round, dash: [0.001, interval - 0.001]))
          .rotationEffect(.degrees(-90))
      }
      center()
    }
    .frame(width: size, height: size)
  }
}

/// src/ui/shape.ts `ringStroke`: 5pt at 44, scaled, never under 2.
func liveRingStroke(_ size: CGFloat) -> CGFloat { max(2, (size * 5 / 44).rounded()) }

// MARK: - Verdict glyphs

/// The three verdicts as drawn glyphs, on the same 16 unit grid in an 18 unit box as
/// `src/ui/verdicts.ts` (Linear's idea: a state is a drawn icon, not a coloured badge).
/// converging, three lines meeting at a point; circling, a loop with one arrowhead, left open
/// before the head; lost, a dashed circle open at the top. `textDim`, never a colour.
///
/// The stroke is 2pt from 16pt up and 1.5pt below. At the 12pt a caption used, 2pt closed the
/// gaps between converging's three lines and it rendered as a solid arrowhead (read: "send"),
/// so the smaller glyph takes the lighter stroke, and captions draw it at 14pt. Lost's dashes
/// only from 16pt up: below that a dashed circle reads as a loading spinner, and the gap
/// across its top still tells it from circling's arrowhead.
@available(iOS 16.1, *)
struct VerdictShape: Shape {
  var verdict: LiveDisplay.Verdict

  func path(in rect: CGRect) -> Path {
    var p = Path()
    func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x, y: y) }
    switch verdict {
    case .converging:
      p.move(to: pt(2.5, 3.5)); p.addLine(to: pt(13, 8))
      p.move(to: pt(2.5, 8)); p.addLine(to: pt(13, 8))
      p.move(to: pt(2.5, 12.5)); p.addLine(to: pt(13, 8))
    case .circling:
      // SVG `M11.9 4.1 A5.5 5.5 0 1 1 8 2.5`: centre (8, 8), clockwise from -45deg round to the top.
      p.addRelativeArc(center: pt(8, 8), radius: 5.5, startAngle: .degrees(-45), delta: .degrees(315))
      p.move(to: pt(6.9, 0.3)); p.addLine(to: pt(9.4, 2.5)); p.addLine(to: pt(6.9, 4.7))
    case .lost:
      // SVG `M10.4 3.05 A5.5 5.5 0 1 1 5.6 3.05`: the same circle, open across the top.
      p.addRelativeArc(center: pt(8, 8), radius: 5.5, startAngle: .degrees(-64.13), delta: .degrees(308.26))
    }
    // viewBox "-1 -1 18 18" onto the rect.
    let s = min(rect.width, rect.height) / 18
    return p.applying(
      CGAffineTransform(translationX: 1, y: 1)
        .concatenating(CGAffineTransform(scaleX: s, y: s))
        .concatenating(CGAffineTransform(translationX: rect.minX, y: rect.minY)))
  }
}

@available(iOS 16.1, *)
struct VerdictGlyph: View {
  var verdict: LiveDisplay.Verdict
  var size: CGFloat = 12
  var color: Color = BuilderPalette.textDim

  var body: some View {
    let w: CGFloat = size >= 16 ? 2 : 1.5
    VerdictShape(verdict: verdict)
      .stroke(color, style: StrokeStyle(
        lineWidth: w, lineCap: .round, lineJoin: .round,
        dash: verdict == .lost && size >= 16 ? [w * 0.9, w * 1.6] : []))
      .frame(width: size, height: size)
      .accessibilityHidden(true)
  }
}

/// The glyph and the word: "circling". The word is the information; the glyph is how it
/// reads at a glance. No colour, so it reads the same in tinted and clear widgets.
@available(iOS 16.1, *)
struct VerdictLabel: View {
  var verdict: LiveDisplay.Verdict
  var size: CGFloat = 13
  var color: Color = BuilderPalette.textDim
  /// Words after the verdict, in the same run of text: "since " and a clock time.
  var since: Date? = nil

  var body: some View {
    HStack(spacing: 4) {
      VerdictGlyph(verdict: verdict, size: size + 1, color: color)
      if let since {
        (Text(verdict.rawValue + " " + LiveCopy.since + " ") + Text(since, style: .time))
          .font(LiveType.font(size, .medium)).foregroundStyle(color)
      } else {
        Text(verdict.rawValue).font(LiveType.font(size, .medium)).foregroundStyle(color)
      }
    }
    .accessibilityElement(children: .combine)
  }
}

// MARK: - Creature

/// Where the creature PNGs live. The asset catalog is compiled into the widget extension only;
/// the main app (which renders these views for review with ImageRenderer) reads it out of the
/// embedded `PlugIns/BuilderWidgets.appex`.
enum CreatureAssets {
  static let bundle: Bundle = {
    if Bundle.main.bundleURL.pathExtension == "appex" { return .main }
    if let url = Bundle.main.builtInPlugInsURL?.appendingPathComponent("BuilderWidgets.appex"),
       let appex = Bundle(url: url) {
      return appex
    }
    return .main
  }()

  /// An id the catalog does not have (a creature from a newer app, a typo) draws Bit rather
  /// than nothing.
  static func resolve(_ id: String) -> String { CreatureArt.ids.contains(id) ? id : "bit" }

  /// The image name for `id` at `points` (16, 32, 48 or 64).
  static func name(_ id: String, points: Int) -> String {
    let size = CreatureArt.sizes.contains(points) ? points : 32
    return "\(CreatureArt.prefix)\(resolve(id))-\(size)"
  }
}

/// The builder's creature as a bare 1-bit mark, tinted. HIG: "display it without a container".
/// Only ever at 16, 32, 48 or 64pt, with no interpolation, so every cell is whole pixels.
///
/// Every image carries its full 16 cell frame, and Bit leaves four empty columns each side.
/// `trim` takes those off in layout (the drawing is untouched): `.leading` sits a creature flush
/// with the text under it, `.horizontal` keeps it snug to the camera in the compact island.
@available(iOS 16.1, *)
struct CreatureMark: View {
  var creature: String
  var points: Int = 32
  var tint: Color = BuilderPalette.amber
  var trim: Edge.Set = []

  var body: some View {
    let id = CreatureAssets.resolve(creature)
    let cell = CGFloat(points) / 16
    let inset = CreatureArt.insets[id] ?? (leading: 0, trailing: 0)
    Image(CreatureAssets.name(id, points: points), bundle: CreatureAssets.bundle)
      .renderingMode(.template)
      .interpolation(.none)
      .resizable()
      .frame(width: CGFloat(points), height: CGFloat(points))
      .padding(.leading, trim.contains(.leading) ? -CGFloat(inset.leading) * cell : 0)
      .padding(.trailing, trim.contains(.trailing) ? -CGFloat(inset.trailing) * cell : 0)
      .foregroundStyle(tint)
      .widgetAccentable()
      .accessibilityHidden(true)
  }
}

// MARK: - Progress capsule (expanded island)

/// A 4pt capsule track with the fill: elapsed over typical. Drawn only when there is an honest
/// number (the island's caption says "no ETA yet" in words, which a row of dots only repeated),
/// in amber while on track and `textDim` otherwise, like the ring.
@available(iOS 17.0, *)
struct ProgressCapsule: View {
  var progress: Double
  var height: CGFloat = 4
  var track: Color = BuilderPalette.border
  var tint: Color = BuilderPalette.amber

  var body: some View {
    ZStack(alignment: .leading) {
      Capsule().fill(track)
      CapsuleFill(fraction: max(0, min(progress, 1))).fill(tint).widgetAccentable()
    }
    .frame(height: height)
  }
}

private struct CapsuleFill: Shape {
  var fraction: Double
  func path(in rect: CGRect) -> Path {
    let w = max(rect.height, rect.width * fraction)
    return Capsule().path(in: CGRect(x: rect.minX, y: rect.minY, width: w, height: rect.height))
  }
}

// MARK: - Elapsed

/// The session's elapsed time as a SYSTEM timer ("12:34", "1:02:34"), counting up from the
/// start with no update. The first build drew "12m" from a string computed at render, which
/// froze on the Lock Screen for as long as the app was in the background (the smoke activity
/// still said 47m six minutes on, 2026-09-13). The lab's "10:--" was the Always-On display
/// dropping seconds, which it does to every timer by design.
///
/// A timer text sizes itself for the widest value it could show, so it gets a fixed trailing
/// box sized for "0:00:00" at its font, rather than taking whatever width it is offered.
/// MEASURED (SF Pro semibold, monospaced digits): "2:57:07" is 57.4pt at 15, 54.1 at 14, 63.9
/// at 17. The first boxes were 3.8 sizes wide (57pt at 15) and cut a three hour run to
/// "2:57:..." on the Lock Screen and in the island (replay of live-self-1, 2026-09-13).
@available(iOS 16.1, *)
struct ElapsedTimer: View {
  let start: Date
  var size: CGFloat
  var weight: Font.Weight = .semibold
  var color: Color = BuilderPalette.text
  /// Wide enough for "0:00:00" at `size` unless a slot says otherwise.
  var width: CGFloat? = nil

  @Environment(\.liveFrozenNow) private var frozen

  var body: some View {
    Group {
      if let frozen {
        // The debug renderer's fixed clock: what the timer reads at that moment.
        Text(LiveCopy.timerText(max(0, frozen.timeIntervalSince(start))))
      } else {
        Text(timerInterval: start...Date.distantFuture, countsDown: false)
      }
    }
    .font(LiveType.font(size, weight))
    .monospacedDigit()
    .foregroundStyle(color)
    .multilineTextAlignment(.trailing)
    .lineLimit(1)
    .frame(width: width ?? (size * 4.1).rounded(.up), alignment: .trailing)
  }
}

private struct LiveFrozenNowKey: EnvironmentKey {
  static let defaultValue: Date? = nil
}

extension EnvironmentValues {
  /// Set only by the debug ImageRenderer pass (`LivePreviewRenderer`): system timers draw what
  /// they would read at this moment, so the renders are reproducible. nil everywhere else.
  var liveFrozenNow: Date? {
    get { self[LiveFrozenNowKey.self] }
    set { self[LiveFrozenNowKey.self] = newValue }
  }
}
