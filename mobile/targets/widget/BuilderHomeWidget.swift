import SwiftUI
import WidgetKit

/// The Home Screen widget: what is running, or, with nothing running, how today went.
///
/// The app writes the snapshot into the App Group on its foreground tick and reloads this
/// widget (`src/live/widget.ts`); reloads while the app is in front are free, which is where the
/// freshness comes from. The widget is not the live surface (the Live Activity is), so the
/// timeline only advances the elapsed minutes of what was last written, and flips to "Not
/// updating" at the snapshot's own `staleEpoch` rather than showing old work as current.
struct SnapshotEntry: TimelineEntry {
  let date: Date
  let snapshot: WidgetSnapshot?
}

struct SnapshotProvider: TimelineProvider {
  func placeholder(in context: Context) -> SnapshotEntry {
    SnapshotEntry(date: .now, snapshot: LiveFixtures.widgetWorking)
  }

  func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry) -> Void) {
    // The gallery shows a real layout even before the app has written anything.
    let stored = WidgetSnapshot.load()
    completion(SnapshotEntry(date: .now, snapshot: stored ?? (context.isPreview ? LiveFixtures.widgetWorking : nil)))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<SnapshotEntry>) -> Void) {
    let snapshot = WidgetSnapshot.load()
    let now = Date.now
    guard let snapshot, !snapshot.sessions.isEmpty else {
      completion(Timeline(entries: [SnapshotEntry(date: now, snapshot: snapshot)],
                          policy: .after(now.addingTimeInterval(30 * 60))))
      return
    }
    // One entry a minute for half an hour: "22m" moves by the minute, like the island's, with
    // no ticking seconds. One reload buys all of them.
    let start = Calendar.current.dateInterval(of: .minute, for: now)?.start ?? now
    let entries = (0...30).map { i in
      SnapshotEntry(date: i == 0 ? now : start.addingTimeInterval(Double(i) * 60), snapshot: snapshot)
    }
    completion(Timeline(entries: entries, policy: .atEnd))
  }
}

struct BuilderHomeWidgetEntryView: View {
  @Environment(\.widgetFamily) private var family
  @Environment(\.colorScheme) private var colorScheme
  let entry: SnapshotEntry

  var body: some View {
    let top = entry.snapshot?.sessions.first
    HomeWidgetView(size: family == .systemMedium ? .medium : .small, snapshot: entry.snapshot, now: entry.date)
      .containerBackground(for: .widget) { BuilderPalette.scheme(colorScheme).bg }
      // Small widgets are one tap target: the top session, or the app when nothing runs.
      .widgetURL(top.map { URL(string: "builder://session/\($0.id)") } ?? URL(string: "builder://now"))
  }
}

struct BuilderHomeWidget: Widget {
  let kind = "BuilderHomeWidget"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: SnapshotProvider()) { entry in
      BuilderHomeWidgetEntryView(entry: entry)
    }
    // The gallery lists this under the app's name, Builda (brief.md: every word a person reads
    // says Builda; the kind and the types keep their code names).
    .configurationDisplayName("Builda")
    .description("What your agents are doing, and who needs you first.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}

// MARK: - Previews

#Preview("Small: running", as: .systemSmall) {
  BuilderHomeWidget()
} timeline: {
  SnapshotEntry(date: LiveFixtures.now, snapshot: LiveFixtures.widgetWorking)
  SnapshotEntry(date: LiveFixtures.now, snapshot: LiveFixtures.widgetFour)
  SnapshotEntry(date: LiveFixtures.now, snapshot: LiveFixtures.widgetCircling)
  SnapshotEntry(date: LiveFixtures.now.addingTimeInterval(20 * 60), snapshot: LiveFixtures.widgetWorking)
}

#Preview("Small: idle", as: .systemSmall) {
  BuilderHomeWidget()
} timeline: {
  SnapshotEntry(date: LiveFixtures.now, snapshot: LiveFixtures.widgetIdle)
  SnapshotEntry(date: LiveFixtures.now, snapshot: nil)
}

#Preview("Medium", as: .systemMedium) {
  BuilderHomeWidget()
} timeline: {
  SnapshotEntry(date: LiveFixtures.now, snapshot: LiveFixtures.widgetFour)
  SnapshotEntry(date: LiveFixtures.now, snapshot: LiveFixtures.widgetWorking)
  SnapshotEntry(date: LiveFixtures.now, snapshot: LiveFixtures.widgetIdle)
}
