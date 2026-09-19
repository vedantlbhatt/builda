import ActivityKit
import SwiftUI
import WidgetKit

/// A reel you shared, being read on your Mac, on the Lock Screen and in the Dynamic Island
/// (docs/drop-island.md). The layouts are in `_shared/DropActivityViews.swift`; this file only
/// puts them in ActivityKit's slots, as `BuilderLiveActivity.swift` does for a session.
///
/// It exists because of where you are when it matters: in Instagram, having just shared. A
/// banner would pull you out of the video; the island lets you keep scrolling and see the answer
/// land, with a Start button for the first move (docs/motion.md, the island table).
struct BuilderDropActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: BuilderDropAttributes.self) { context in
      let d = DropDisplay(attributes: context.attributes, state: context.state, isStale: context.isStale)
      DropLockScreenView(d: d)
        .activityBackgroundTint(BuilderPalette.bg)
        .activitySystemActionForegroundColor(BuilderPalette.text)
        .widgetURL(d.url)
    } dynamicIsland: { context in
      let d = DropDisplay(attributes: context.attributes, state: context.state, isStale: context.isStale)
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading, priority: 1) {
          DropExpandedLeading(d: d)
            .dynamicIsland(verticalPlacement: .belowIfTooWide)
        }
        DynamicIslandExpandedRegion(.trailing) {
          DropExpandedTrailing(d: d)
        }
        DynamicIslandExpandedRegion(.bottom) {
          DropExpandedBottom(d: d)
        }
      } compactLeading: {
        DropCompactLeading(d: d)
      } compactTrailing: {
        DropCompactTrailing(d: d)
      } minimal: {
        DropMinimal(d: d)
      }
      // The island's outline takes the card's colour, as a session's takes its creature's.
      .keylineTint(d.tint)
      .widgetURL(d.url)
    }
  }
}

// MARK: - Previews (Xcode canvas: pick the widget extension scheme)

#Preview("Drop: lock", as: .content, using: DropFixtures.instagram) {
  BuilderDropActivity()
} contentStates: {
  DropFixtures.sent
  DropFixtures.reading
  DropFixtures.planned
  DropFixtures.refused
  DropFixtures.started
}

#Preview("Drop: expanded", as: .dynamicIsland(.expanded), using: DropFixtures.instagram) {
  BuilderDropActivity()
} contentStates: {
  DropFixtures.reading
  DropFixtures.planned
}

#Preview("Drop: compact", as: .dynamicIsland(.compact), using: DropFixtures.instagram) {
  BuilderDropActivity()
} contentStates: {
  DropFixtures.reading
  DropFixtures.planned
}
