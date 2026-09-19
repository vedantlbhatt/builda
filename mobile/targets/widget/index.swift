import SwiftUI
import WidgetKit

/// The widget extension's entry point: the Home Screen widget and the Live Activity live in
/// one extension (`expo-target.config.js`, type "widget"), so they share `_shared/` and the
/// creature asset catalog.
@main
struct BuilderWidgetBundle: WidgetBundle {
  var body: some Widget {
    BuilderHomeWidget()
    BuilderLiveActivity()
    // A reel you shared, being read on your Mac (docs/drop-island.md).
    BuilderDropActivity()
    // A demo you asked your Mac for from the phone (docs/demo-island.md).
    BuilderDemoActivity()
  }
}
