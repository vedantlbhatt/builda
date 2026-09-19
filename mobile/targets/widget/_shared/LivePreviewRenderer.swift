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
    // Afresh each time: a state this build no longer draws must not be pulled out beside the
    // ones it does (an old lock-working-owl.png sat in the first capture of the crew hues).
    try? FileManager.default.removeItem(at: url)
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
    // The newest surfaces first (the demo card, then the drop card): a render that stops part way
    // (a view the system traps on) should not take their states down with it.
    var out: [(String, AnyView)] = demoGallery() + dropGallery()

    let lock: [(String, BuilderSessionAttributes, BuilderSessionAttributes.ContentState, Bool)] = [
      ("lock-working", F.rideGT, F.working, false),
      ("lock-working-no-eta", F.builder, F.workingNoEta, false),
      ("lock-background", F.builder, F.background, false),
      ("lock-needs-you", F.builder, F.needsYou, false),
      ("lock-circling", F.rideGT, F.circling, false),
      ("lock-over-typical", F.rideGT, F.overTypical, false),
      ("lock-lost", F.rideGT, F.lost, false),
      ("lock-stalled", F.rideGT, F.stalled, false),
      ("lock-done", F.builder, F.done, false),
      ("lock-done-unreviewed", F.builder, F.doneUnreviewed, false),
      ("lock-done-nothing", F.builder, F.doneNothing, false),
      ("lock-nothing-yet", F.privateRepo, F.nothingYet, false),
      ("lock-unnamed-aider", F.unnamedRepo, F.nothingYet, false),
      ("lock-stale", F.rideGT, F.working, true),
      ("lock-long", F.longRun, F.workingNoEta, false),
    ]
    for (name, a, s, stale) in lock {
      out.append((name, AnyView(LockFrame { LockScreenLiveView(d: F.display(a, s), isStale: stale) })))
    }
    // Every crew creature working, one card each: the eight hues on the dark card, the ring and
    // the creature in each (DESIGN-V2 2.2), and every harness mark in the header.
    let agents = ["claude_code", "codex", "gemini_cli", "cursor_ide", "cline", "opencode", "aider", "claude_code"]
    for (i, c) in BuilderPalette.crewRing.enumerated() {
      var s = F.working
      s.creature = c
      let a = BuilderSessionAttributes(sessionId: "fixture-\(c)", repo: "tramline", agent: agents[i], startedEpoch: F.t - 12 * 60)
      out.append(("lock-crew-\(c)", AnyView(LockFrame { LockScreenLiveView(d: F.display(a, s), isStale: false) })))
    }
    var bit = F.needsYou
    bit.creature = "bit"
    out.append(("island-compact-bit", AnyView(CompactFrame(d: F.display(F.builder, bit), isStale: false))))
    out.append(("island-minimal-bit", AnyView(MinimalFrame(d: F.display(F.builder, { var s = F.working; s.creature = "bit"; return s }()), isStale: false))))

    let island: [(String, BuilderSessionAttributes, BuilderSessionAttributes.ContentState, Bool)] = [
      ("working", F.rideGT, F.working, false),
      ("needs-you", F.builder, F.needsYou, false),
      ("no-eta", F.builder, F.workingNoEta, false),
      ("circling", F.rideGT, F.circling, false),
      ("private", F.privateRepo, F.nothingYet, false),
      ("unnamed", F.unnamedRepo, F.nothingYet, false),
      ("stale", F.rideGT, F.working, true),
      ("long", F.longRun, F.workingNoEta, false),
      ("done", F.builder, F.done, false),
      ("done-unreviewed", F.builder, F.doneUnreviewed, false),
    ]
    for (name, a, s, stale) in island {
      let d = F.display(a, s)
      out.append(("island-compact-\(name)", AnyView(CompactFrame(d: d, isStale: stale))))
      out.append(("island-minimal-\(name)", AnyView(MinimalFrame(d: d, isStale: stale))))
      out.append(("island-expanded-\(name)", AnyView(ExpandedFrame(d: d, isStale: stale))))
    }

    let widgets: [(String, WidgetSnapshot)] = [
      ("four", F.widgetFour), ("circling", F.widgetCircling), ("one", F.widgetWorking), ("idle", F.widgetIdle),
      ("finished", F.widgetFinished), ("longest", F.widgetLongest),
    ]
    for (name, snap) in widgets {
      for scheme in [ColorScheme.dark, .light] {
        let tag = scheme == .dark ? "dark" : "light"
        out.append(("widget-small-\(name)-\(tag)", AnyView(WidgetFrame(size: .small, snapshot: snap, scheme: scheme))))
        out.append(("widget-medium-\(name)-\(tag)", AnyView(WidgetFrame(size: .medium, snapshot: snap, scheme: scheme))))
      }
    }
    // Twenty minutes on with nothing written since: past the snapshot's stale date.
    let later = F.now.addingTimeInterval(20 * 60)
    out.append(("widget-small-four-stale", AnyView(WidgetFrame(size: .small, snapshot: F.widgetFour, scheme: .dark, now: later))))
    out.append(("widget-medium-four-stale", AnyView(WidgetFrame(size: .medium, snapshot: F.widgetFour, scheme: .dark, now: later))))
    return out
  }

  /// A reel you shared, every state its card draws (docs/drop-island.md): the walk from sent to
  /// an answer, each kind's hue once it is read, the move that needs you to pick a repository,
  /// a refusal, a start, and a Mac that has not answered by the stale date.
  @available(iOS 17.0, *)
  @MainActor
  static func dropGallery() -> [(String, AnyView)] {
    typealias D = DropFixtures
    let states: [(String, BuilderDropAttributes, BuilderDropAttributes.ContentState, Bool)] = [
      ("sent", D.instagram, D.sent, false),
      ("reading", D.instagram, D.reading, false),
      ("planned", D.instagram, D.planned, false),
      ("planned-one", D.tiktok, D.plannedOne, false),
      ("planned-needs-repo", D.tiktok, D.plannedNeedsRepo, false),
      ("planned-recipe", D.instagram, D.plannedRecipe, false),
      ("planned-tool", D.tiktok, D.plannedTool, false),
      ("planned-unknown", D.instagram, D.plannedUnknown, false),
      ("refused", D.instagram, D.refused, false),
      ("started", D.instagram, D.started, false),
      ("waiting-stale", D.tiktok, D.reading, true),
      ("planned-stale", D.instagram, D.planned, true),
    ]
    var out: [(String, AnyView)] = []
    for (name, a, s, stale) in states {
      let d = DropDisplay(attributes: a, state: s, isStale: stale)
      out.append(("drop-lock-\(name)", AnyView(LockFrame { DropLockScreenView(d: d) })))
      out.append(("drop-compact-\(name)", AnyView(DropCompactFrame(d: d))))
      out.append(("drop-minimal-\(name)", AnyView(DropMinimalFrame(d: d))))
      out.append(("drop-expanded-\(name)", AnyView(DropExpandedFrame(d: d))))
    }
    return out
  }
}

extension BuilderPreviewRenderer {
  /// A demo you asked your Mac for, every state its card draws (docs/demo-island.md): the walk
  /// from asked to the kit, a failure in the spec's shortest and longest words, a long project
  /// name with no hue, a run past an hour (the timer's box must hold hours), and the Mac going
  /// quiet past the stale date, asked and filming. Timers are frozen at `LiveFixtures.now`.
  @available(iOS 17.0, *)
  @MainActor
  static func demoGallery() -> [(String, AnyView)] {
    typealias D = DemoFixtures
    let states: [(String, BuilderDemoAttributes, BuilderDemoAttributes.ContentState, Bool)] = [
      ("asked", D.builda, D.asked, false),
      ("filming", D.builda, D.filming, false),
      ("ready", D.builda, D.ready, false),
      ("failed", D.builda, D.failed, false),
      ("failed-long", D.longName, D.failedLong, false),
      ("filming-long-name", D.longName, D.filming, false),
      ("filming-hours", D.builda, D.filmingLong, false),
      ("asked-stale", D.builda, D.asked, true),
      ("filming-stale", D.builda, D.filming, true),
    ]
    var out: [(String, AnyView)] = []
    for (name, a, s, stale) in states {
      let d = DemoDisplay(attributes: a, state: s, isStale: stale)
      out.append(("demo-lock-\(name)", AnyView(LockFrame { DemoLockScreenView(d: d) })))
      out.append(("demo-compact-\(name)", AnyView(DemoCompactFrame(d: d))))
      out.append(("demo-minimal-\(name)", AnyView(DemoMinimalFrame(d: d))))
      out.append(("demo-expanded-\(name)", AnyView(DemoExpandedFrame(d: d))))
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
      .environment(\.liveFrozenNow, LiveFixtures.now)
  }
}

@available(iOS 17.0, *)
private struct CompactFrame: View {
  let d: LiveDisplay
  let isStale: Bool
  var body: some View {
    HStack(spacing: 0) {
      IslandCompactLeading(d: d, isStale: isStale)
      Spacer(minLength: 0)
      IslandCompactTrailing(d: d, isStale: isStale)
    }
    .padding(.horizontal, 9)
    .frame(width: 230, height: 36.67)
    .background(Capsule().fill(Color.black))
    .padding(12)
    .environment(\.colorScheme, .dark)
    .environment(\.liveFrozenNow, LiveFixtures.now)
  }
}

@available(iOS 17.0, *)
private struct MinimalFrame: View {
  let d: LiveDisplay
  let isStale: Bool
  var body: some View {
    IslandMinimal(d: d, isStale: isStale)
      .frame(width: 36.67, height: 36.67)
      .background(Circle().fill(Color.black))
      .padding(12)
      .environment(\.colorScheme, .dark)
      .environment(\.liveFrozenNow, LiveFixtures.now)
  }
}

/// The leading region is about 100pt wide on the device beside the camera (measured on the
/// 16 Pro, 2026-09-13); the first mock gave it 150, so the previews never showed "privat...".
///
/// The system's `.belowIfTooWide` (BuilderLiveActivity.swift), which the first mock left out: the
/// leading content sits beside the camera when its own width fits the region there, and otherwise
/// on a row of its own under the camera at the island's width. FOUND IN THE CAPTURE PASS
/// (2026-09-14): the mock cut "private repo" to "priva...repo" in a fixed 118pt with the rest of
/// the row empty, a layout the device never draws; "Private project 2" is longer again.
@available(iOS 17.0, *)
private struct ExpandedFrame: View {
  let d: LiveDisplay
  let isStale: Bool
  var body: some View {
    VStack(spacing: 8) {
      IslandTopRows(beside: 118, row: 36) {
        IslandExpandedLeading(d: d, isStale: isStale)
        IslandExpandedTrailing(d: d, isStale: isStale).frame(width: 100, height: 36)
      }
      IslandExpandedBottom(d: d, isStale: isStale)
    }
    .padding(.horizontal, 18)
    .padding(.top, 14)
    .padding(.bottom, 10)
    .frame(width: 371)
    .background(RoundedRectangle(cornerRadius: 44, style: .continuous).fill(Color.black))
    .padding(12)
    .environment(\.colorScheme, .dark)
    .environment(\.liveFrozenNow, LiveFixtures.now)
  }
}

@available(iOS 17.0, *)
private struct DropCompactFrame: View {
  let d: DropDisplay
  var body: some View {
    HStack(spacing: 0) {
      DropCompactLeading(d: d)
      Spacer(minLength: 0)
      DropCompactTrailing(d: d)
    }
    .padding(.horizontal, 9)
    .frame(width: 230, height: 36.67)
    .background(Capsule().fill(Color.black))
    .padding(12)
    .environment(\.colorScheme, .dark)
  }
}

@available(iOS 17.0, *)
private struct DropMinimalFrame: View {
  let d: DropDisplay
  var body: some View {
    DropMinimal(d: d)
      .frame(width: 36.67, height: 36.67)
      .background(Circle().fill(Color.black))
      .padding(12)
      .environment(\.colorScheme, .dark)
  }
}

/// The same top row as a session's (`ExpandedFrame`): the leading content beside the camera when
/// it fits the region there, under it otherwise, as `.belowIfTooWide` places it.
@available(iOS 17.0, *)
private struct DropExpandedFrame: View {
  let d: DropDisplay
  var body: some View {
    VStack(spacing: 8) {
      IslandTopRows(beside: 118, row: 36) {
        DropExpandedLeading(d: d)
        DropExpandedTrailing(d: d).frame(width: 100, height: 36)
      }
      DropExpandedBottom(d: d)
    }
    .padding(.horizontal, 18)
    .padding(.top, 14)
    .padding(.bottom, 10)
    .frame(width: 371)
    .background(RoundedRectangle(cornerRadius: 44, style: .continuous).fill(Color.black))
    .padding(12)
    .environment(\.colorScheme, .dark)
  }
}

@available(iOS 17.0, *)
private struct DemoCompactFrame: View {
  let d: DemoDisplay
  var body: some View {
    HStack(spacing: 0) {
      DemoCompactLeading(d: d)
      Spacer(minLength: 0)
      DemoCompactTrailing(d: d)
    }
    .padding(.horizontal, 9)
    .frame(width: 230, height: 36.67)
    .background(Capsule().fill(Color.black))
    .padding(12)
    .environment(\.colorScheme, .dark)
    .environment(\.liveFrozenNow, LiveFixtures.now)
  }
}

@available(iOS 17.0, *)
private struct DemoMinimalFrame: View {
  let d: DemoDisplay
  var body: some View {
    DemoMinimal(d: d)
      .frame(width: 36.67, height: 36.67)
      .background(Circle().fill(Color.black))
      .padding(12)
      .environment(\.colorScheme, .dark)
      .environment(\.liveFrozenNow, LiveFixtures.now)
  }
}

/// The same top row as a drop's (`DropExpandedFrame`), as `.belowIfTooWide` places it.
@available(iOS 17.0, *)
private struct DemoExpandedFrame: View {
  let d: DemoDisplay
  var body: some View {
    VStack(spacing: 8) {
      IslandTopRows(beside: 118, row: 36) {
        DemoExpandedLeading(d: d)
        DemoExpandedTrailing(d: d).frame(width: 100, height: 36)
      }
      DemoExpandedBottom(d: d)
    }
    .padding(.horizontal, 18)
    .padding(.top, 14)
    .padding(.bottom, 10)
    .frame(width: 371)
    .background(RoundedRectangle(cornerRadius: 44, style: .continuous).fill(Color.black))
    .padding(12)
    .environment(\.colorScheme, .dark)
    .environment(\.liveFrozenNow, LiveFixtures.now)
  }
}

@available(iOS 17.0, *)
private struct WidgetFrame: View {
  let size: HomeWidgetView.Size
  let snapshot: WidgetSnapshot
  let scheme: ColorScheme
  var now: Date = LiveFixtures.now
  var body: some View {
    let pal = BuilderPalette.scheme(scheme)
    HomeWidgetView(size: size, snapshot: snapshot, now: now)
      .padding(16)
      .frame(width: size == .small ? 158 : 338, height: 158)
      .background(pal.bg)
      .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
      .padding(12)
      .background(scheme == .dark ? Color.black : Color(white: 0.86))
      .environment(\.colorScheme, scheme)
  }
}

/// The expanded island's top: the leading content (first view) beside the camera when its ideal
/// width fits `beside`, else under the camera row at the full width, as `.belowIfTooWide` places
/// it; the trailing content (second view) at the top right either way.
@available(iOS 17.0, *)
private struct IslandTopRows: Layout {
  let beside: CGFloat
  let row: CGFloat

  private func below(_ subviews: Subviews) -> Bool {
    guard let leading = subviews.first else { return false }
    return leading.sizeThatFits(.unspecified).width > beside
  }

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    CGSize(width: proposal.width ?? 335, height: below(subviews) ? row * 2 : row)
  }

  /// FOUND RENDERING ON THE iOS 26.5 SIMULATOR (2026-09-19): a trailing region that draws
  /// nothing (a stale card's `EmptyView`) is not a subview there at all, so `subviews[1]` trapped
  /// in `LayoutSubviews.subscript` and took the app down half way through the gallery, at
  /// island-expanded-stale, every time. Each subview is placed only if it is there.
  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    guard !subviews.isEmpty else { return }
    if subviews.count > 1 {
      let trailing = subviews[1].sizeThatFits(.unspecified)
      subviews[1].place(at: CGPoint(x: bounds.maxX - trailing.width, y: bounds.minY), proposal: ProposedViewSize(trailing))
    }
    if below(subviews) {
      subviews[0].place(at: CGPoint(x: bounds.minX, y: bounds.minY + row), proposal: ProposedViewSize(width: bounds.width, height: row))
    } else {
      subviews[0].place(at: CGPoint(x: bounds.minX, y: bounds.minY), proposal: ProposedViewSize(width: beside, height: row))
    }
  }
}
