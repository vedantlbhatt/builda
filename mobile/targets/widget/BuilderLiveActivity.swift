import ActivityKit
import SwiftUI
import WidgetKit

/// One running session on the Lock Screen and in the Dynamic Island. The layouts are in
/// `_shared/LiveActivityViews.swift`; this file only puts them in ActivityKit's slots.
///
/// The system ignores `withAnimation` here and caps animation at two seconds, so the only
/// motion is `.contentTransition`: the file count rolls, the sentence cross-fades.
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
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          IslandExpandedLeading(d: d)
        }
        DynamicIslandExpandedRegion(.trailing) {
          IslandExpandedTrailing(d: d)
        }
        DynamicIslandExpandedRegion(.bottom) {
          IslandExpandedBottom(d: d, isStale: context.isStale)
        }
      } compactLeading: {
        IslandCompactLeading(d: d)
      } compactTrailing: {
        IslandCompactTrailing(d: d)
      } minimal: {
        IslandMinimal(d: d)
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
  LiveFixtures.needsYou
  LiveFixtures.done
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
