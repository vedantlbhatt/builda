import ActivityKit
import SwiftUI
import WidgetKit

/// A demo you asked your Mac for, on the Lock Screen and in the Dynamic Island
/// (docs/demo-island.md). The layouts are in `_shared/DemoActivityViews.swift`; this file only
/// puts them in ActivityKit's slots, as `BuilderDropActivity.swift` does for a shared reel.
///
/// It exists because of where you are when it matters: not on the kit screen. A demo takes
/// minutes on the Mac; you asked, went back to what you were doing, and want to post the moment
/// the kit is up (docs/motion.md, the island table).
struct BuilderDemoActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: BuilderDemoAttributes.self) { context in
      let d = DemoDisplay(attributes: context.attributes, state: context.state, isStale: context.isStale)
      DemoLockScreenView(d: d)
        .activityBackgroundTint(BuilderPalette.bg)
        .activitySystemActionForegroundColor(BuilderPalette.text)
        .widgetURL(d.url)
    } dynamicIsland: { context in
      let d = DemoDisplay(attributes: context.attributes, state: context.state, isStale: context.isStale)
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading, priority: 1) {
          DemoExpandedLeading(d: d)
            .dynamicIsland(verticalPlacement: .belowIfTooWide)
        }
        DynamicIslandExpandedRegion(.trailing) {
          DemoExpandedTrailing(d: d)
        }
        DynamicIslandExpandedRegion(.bottom) {
          DemoExpandedBottom(d: d)
        }
      } compactLeading: {
        DemoCompactLeading(d: d)
      } compactTrailing: {
        DemoCompactTrailing(d: d)
      } minimal: {
        DemoMinimal(d: d)
      }
      // The island's outline takes the record light's colour, as a drop's takes its kind's.
      .keylineTint(d.light)
      .widgetURL(d.url)
    }
  }
}

// MARK: - Previews (Xcode canvas: pick the widget extension scheme)

#Preview("Demo: lock", as: .content, using: DemoFixtures.builda) {
  BuilderDemoActivity()
} contentStates: {
  DemoFixtures.asked
  DemoFixtures.filming
  DemoFixtures.ready
  DemoFixtures.failed
}

#Preview("Demo: expanded", as: .dynamicIsland(.expanded), using: DemoFixtures.builda) {
  BuilderDemoActivity()
} contentStates: {
  DemoFixtures.filming
  DemoFixtures.ready
}

#Preview("Demo: compact", as: .dynamicIsland(.compact), using: DemoFixtures.builda) {
  BuilderDemoActivity()
} contentStates: {
  DemoFixtures.filming
  DemoFixtures.ready
}
