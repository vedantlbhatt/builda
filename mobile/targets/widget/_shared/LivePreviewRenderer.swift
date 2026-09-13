import SwiftUI
import UIKit

/// The debug path that needs no SpringBoard (research/SYNTHESIS.md section 3, "fallback"):
/// renders the EXACT views the extension shows, every state, to PNGs at @3x, so a review does
/// not depend on coaxing the Lock Screen or the Home Screen into a screenshot. Timers render
/// frozen at `LiveFixtures.now`, and the island presentations are mocks of the system's black
/// shape (the system draws the real one), so these are for layout and copy, not for pixels
/// the system owns.
///
/// This file is in `_shared`, so it compiles into the main app, where the creature images are
/// read out of the embedded extension bundle. The Expo module is a separate pod and cannot see
/// app code, so it finds this class by its Objective-C name:
///
///     NSClassFromString("BuilderPreviewRenderer") ... perform("renderAllInto:")
///
/// `BuilderLive.renderPreviews()` from JS returns the written paths; pull them with
/// `xcrun simctl get_app_container <udid> com.vedantlbhatt.Builder data` (Documents/live-previews).
@objc(BuilderPreviewRenderer)
public final class BuilderPreviewRenderer: NSObject {
  @MainActor @objc public func renderAll(into dir: String) -> NSArray {
    guard #available(iOS 17.0, *) else { return [] }
    let url = URL(fileURLWithPath: dir, isDirectory: true)
    try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    var written: [String] = []
    for (name, view) in Self.gallery() {
      let renderer = ImageRenderer(content: view)
      renderer.scale = 3
      guard let png = renderer.uiImage?.pngData() else { continue }
      let file = url.appendingPathComponent("\(name).png")
      if (try? png.write(to: file)) != nil { written.append(file.path) }
    }
    return written as NSArray
  }

  @available(iOS 17.0, *)
  @MainActor
  static func gallery() -> [(String, AnyView)] {
    typealias F = LiveFixtures
    var out: [(String, AnyView)] = []

    let lock: [(String, BuilderSessionAttributes, BuilderSessionAttributes.ContentState, Bool)] = [
      ("lock-working", F.rideGT, F.working, false),
      ("lock-working-no-eta", F.builder, F.workingNoEta, false),
      ("lock-needs-you", F.builder, F.needsYou, false),
      ("lock-circling", F.rideGT, F.circling, false),
      ("lock-over-typical", F.rideGT, F.overTypical, false),
      ("lock-lost", F.rideGT, F.lost, false),
      ("lock-stalled", F.rideGT, F.stalled, false),
      ("lock-done", F.builder, F.done, false),
      ("lock-stale", F.rideGT, F.working, true),
    ]
    for (name, a, s, stale) in lock {
      out.append((name, AnyView(LockFrame { LockScreenLiveView(d: F.display(a, s), isStale: stale) })))
    }
    // Other creatures: the owl's face is holes in the ink, and Bit is narrow in its frame (the
    // compact island trims the empty columns so it still sits snug to the camera).
    var owl = F.working
    owl.creature = "owl"
    out.append(("lock-working-owl", AnyView(LockFrame { LockScreenLiveView(d: F.display(F.rideGT, owl), isStale: false) })))
    var bit = F.needsYou
    bit.creature = "bit"
    out.append(("island-compact-bit", AnyView(CompactFrame(d: F.display(F.builder, bit)))))

    let island: [(String, BuilderSessionAttributes, BuilderSessionAttributes.ContentState)] = [
      ("working", F.rideGT, F.working),
      ("needs-you", F.builder, F.needsYou),
      ("no-eta", F.builder, F.workingNoEta),
      ("done", F.builder, F.done),
    ]
    for (name, a, s) in island {
      let d = F.display(a, s)
      out.append(("island-compact-\(name)", AnyView(CompactFrame(d: d))))
      out.append(("island-minimal-\(name)", AnyView(MinimalFrame(d: d))))
      out.append(("island-expanded-\(name)", AnyView(ExpandedFrame(d: d))))
    }

    let widgets: [(String, WidgetSnapshot)] = [
      ("four", F.widgetFour), ("one", F.widgetWorking), ("idle", F.widgetIdle),
    ]
    for (name, snap) in widgets {
      for scheme in [ColorScheme.dark, .light] {
        let tag = scheme == .dark ? "dark" : "light"
        out.append(("widget-small-\(name)-\(tag)", AnyView(WidgetFrame(size: .small, snapshot: snap, scheme: scheme))))
        out.append(("widget-medium-\(name)-\(tag)", AnyView(WidgetFrame(size: .medium, snapshot: snap, scheme: scheme))))
      }
    }
    return out
  }
}

// MARK: - Frames standing in for what the system draws around the views

@available(iOS 17.0, *)
private struct LockFrame<Content: View>: View {
  @ViewBuilder var content: () -> Content
  var body: some View {
    content()
      .frame(width: 371, alignment: .leading)
      .background(BuilderPalette.bg)
      .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
      .padding(12)
      .environment(\.colorScheme, .dark)
  }
}

@available(iOS 17.0, *)
private struct CompactFrame: View {
  let d: LiveDisplay
  var body: some View {
    HStack(spacing: 0) {
      IslandCompactLeading(d: d)
      Spacer(minLength: 0)
      IslandCompactTrailing(d: d)
    }
    .padding(.horizontal, 9)
    .frame(width: 230, height: 36.67)
    .background(Capsule().fill(Color.black))
    .padding(12)
    .environment(\.colorScheme, .dark)
  }
}

@available(iOS 17.0, *)
private struct MinimalFrame: View {
  let d: LiveDisplay
  var body: some View {
    IslandMinimal(d: d)
      .frame(width: 36.67, height: 36.67)
      .background(Circle().fill(Color.black))
      .padding(12)
      .environment(\.colorScheme, .dark)
  }
}

@available(iOS 17.0, *)
private struct ExpandedFrame: View {
  let d: LiveDisplay
  var body: some View {
    VStack(spacing: 8) {
      HStack(alignment: .top, spacing: 0) {
        IslandExpandedLeading(d: d).frame(width: 150, height: 36)
        Spacer(minLength: 0)
        IslandExpandedTrailing(d: d).frame(width: 120, height: 36)
      }
      IslandExpandedBottom(d: d, isStale: false)
    }
    .padding(.horizontal, 18)
    .padding(.top, 14)
    .padding(.bottom, 18)
    .frame(width: 371)
    .background(RoundedRectangle(cornerRadius: 44, style: .continuous).fill(Color.black))
    .padding(12)
    .environment(\.colorScheme, .dark)
  }
}

@available(iOS 17.0, *)
private struct WidgetFrame: View {
  let size: HomeWidgetView.Size
  let snapshot: WidgetSnapshot
  let scheme: ColorScheme
  var body: some View {
    let pal = BuilderPalette.scheme(scheme)
    HomeWidgetView(size: size, snapshot: snapshot, now: LiveFixtures.now)
      .padding(16)
      .frame(width: size == .small ? 158 : 338, height: 158)
      .background(pal.bg)
      .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
      .padding(12)
      .background(scheme == .dark ? Color.black : Color(white: 0.86))
      .environment(\.colorScheme, scheme)
  }
}
