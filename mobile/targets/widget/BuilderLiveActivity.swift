import ActivityKit
import SwiftUI
import WidgetKit

/// One running session on the Lock Screen and in the Dynamic Island. The layouts are in
/// `_shared/LiveActivityViews.swift`; this file only puts them in ActivityKit's slots.
///
/// The system ignores `withAnimation` here and caps animation at two seconds, so the only
/// motion is `.contentTransition` (the sentence cross-fades) and the system's own timers.
struct BuilderLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: BuilderSessionAttributes.self) { context in
      let d = LiveDisplay(attributes: context.attributes, state: context.state, now: .now)
      // The Lock Screen, and the banner on phones with no Dynamic Island. Custom background in
      // both appearances: the design is dark first and the island is black anyway.
      LockScreenLiveView(d: d, isStale: context.isStale)
        .activityBackgroundTint(BuilderPalette.bg)
        .activitySystemActionForegroundColor(BuilderPalette.text)
        .widgetURL(d.url)
    } dynamicIsland: { context in
      let d = LiveDisplay(attributes: context.attributes, state: context.state, now: .now)
      let stale = context.isStale
      return DynamicIsland {
        // The repo takes the width before the time does, and drops under the camera when even
        // then it cannot fit, rather than being cut to "privat...".
        DynamicIslandExpandedRegion(.leading, priority: 1) {
          IslandExpandedLeading(d: d, isStale: stale)
            .dynamicIsland(verticalPlacement: .belowIfTooWide)
        }
        DynamicIslandExpandedRegion(.trailing) {
          IslandExpandedTrailing(d: d, isStale: stale)
        }
        DynamicIslandExpandedRegion(.bottom) {
          IslandExpandedBottom(d: d, isStale: stale)
        }
      } compactLeading: {
        IslandCompactLeading(d: d, isStale: stale)
      } compactTrailing: {
        IslandCompactTrailing(d: d, isStale: stale)
      } minimal: {
        IslandMinimal(d: d, isStale: stale)
      }
      .keylineTint(BuilderPalette.amber)
      .widgetURL(d.url)
    }
  }
}

// MARK: - Previews, one per state (Xcode canvas: pick the widget extension scheme)

#Preview("Lock: working", as: .content, using: LiveFixtures.rideGT) {
  BuilderLiveActivity()
} contentStates: {
  LiveFixtures.working
  LiveFixtures.circling
  LiveFixtures.overTypical
  LiveFixtures.lost
  LiveFixtures.stalled
}

#Preview("Lock: builder", as: .content, using: LiveFixtures.builder) {
  BuilderLiveActivity()
} contentStates: {
  LiveFixtures.workingNoEta
  LiveFixtures.background
  LiveFixtures.needsYou
  LiveFixtures.done
  LiveFixtures.doneNothing
}

#Preview("Island: compact", as: .dynamicIsland(.compact), using: LiveFixtures.rideGT) {
  BuilderLiveActivity()
} contentStates: {
  LiveFixtures.working
  LiveFixtures.needsYou
  LiveFixtures.stalled
}

#Preview("Island: minimal", as: .dynamicIsland(.minimal), using: LiveFixtures.rideGT) {
  BuilderLiveActivity()
} contentStates: {
  LiveFixtures.working
  LiveFixtures.workingNoEta
  LiveFixtures.needsYou
}

#Preview("Island: expanded", as: .dynamicIsland(.expanded), using: LiveFixtures.builder) {
  BuilderLiveActivity()
} contentStates: {
  LiveFixtures.workingNoEta
  LiveFixtures.needsYou
  LiveFixtures.done
}
