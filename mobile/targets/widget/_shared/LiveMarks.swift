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

/// Apple Fitness geometry: an amber arc on a hairline-colour track, round caps, starting at
/// 12 o'clock and running clockwise. `progress` nil is "no honest number yet": whole dots
/// round an unfilled track, never a guessed arc and never a spinner. Past the typical run
/// the caller passes 1 and says "running longer than usual" in words.
@available(iOS 17.0, *)
struct LiveRing<Center: View>: View {
  var progress: Double?
  var size: CGFloat
  var stroke: CGFloat
  var track: Color = BuilderPalette.border
  var tint: Color = BuilderPalette.amber
  @ViewBuilder var center: () -> Center

  var body: some View {
    ZStack {
      if let p = progress {
        Circle().inset(by: stroke / 2).stroke(track, lineWidth: stroke)
        Circle().inset(by: stroke / 2)
          .trim(from: 0, to: max(0.0001, min(p, 1)))
          .stroke(tint, style: StrokeStyle(lineWidth: stroke, lineCap: .round))
          .rotationEffect(.degrees(-90))
          .widgetAccentable()
      } else {
        // src/ui/shape.ts `dottedTrack`: dots about 2.2 strokes apart, at least 8.
        let circumference = Double.pi * Double(size - stroke)
        let count = max(8, (circumference / Double(stroke * 2.2)).rounded())
        let interval = CGFloat(circumference / count)
        Circle().inset(by: stroke / 2)
          .stroke(track, style: StrokeStyle(lineWidth: stroke, lineCap: .round, dash: [0.001, interval - 0.001]))
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
/// The stroke is 2pt from 16pt up and 1.5pt below. At the 12pt a caption uses, 2pt closed the
/// gaps between converging's three lines and it rendered as a solid arrowhead (read: "send"),
/// so the smaller glyph takes the lighter stroke.
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
        dash: verdict == .lost ? [w * 0.9, w * 1.6] : []))
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

  var body: some View {
    HStack(spacing: 4) {
      VerdictGlyph(verdict: verdict, size: size - 1, color: color)
      Text(verdict.rawValue).font(LiveType.font(size, .medium)).foregroundStyle(color)
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

/// A 4pt capsule track with the amber fill, or a row of dots when there is no honest number.
@available(iOS 17.0, *)
struct ProgressCapsule: View {
  var progress: Double?
  var height: CGFloat = 4
  var track: Color = BuilderPalette.border
  var tint: Color = BuilderPalette.amber

  var body: some View {
    if let p = progress {
      ZStack(alignment: .leading) {
        Capsule().fill(track)
        CapsuleFill(fraction: max(0, min(p, 1))).fill(tint).widgetAccentable()
      }
      .frame(height: height)
    } else {
      DottedLine()
        .stroke(track, style: StrokeStyle(lineWidth: height, lineCap: .round, dash: [0.001, height * 2.2]))
        .frame(height: height)
    }
  }
}

private struct CapsuleFill: Shape {
  var fraction: Double
  func path(in rect: CGRect) -> Path {
    let w = max(rect.height, rect.width * fraction)
    return Capsule().path(in: CGRect(x: rect.minX, y: rect.minY, width: w, height: rect.height))
  }
}

private struct DottedLine: Shape {
  func path(in rect: CGRect) -> Path {
    var p = Path()
    p.move(to: CGPoint(x: rect.minX + rect.height / 2, y: rect.midY))
    p.addLine(to: CGPoint(x: rect.maxX - rect.height / 2, y: rect.midY))
    return p
  }
}
