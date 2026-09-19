import BuilderUI
import Foundation

/// `builder preview-island [--out DIR] [--outline] [--pill]` — the notch island in every mode,
/// collapsed and open, rendered offscreen from fixture data (nothing from this machine).
///
/// The running app is the real test (`BUILDER_ISLAND_DEMO=1`); this is for looking at a layout
/// without launching anything, and for a machine that may not grant screen recording.
enum IslandPreviewCommand {

    static func run() throws {
        let outDir = CLIArgs.value("out") ?? "/tmp/builder-island"
        try FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)
        let outline = CommandLine.arguments.contains("--outline")
        let notch: NotchMetrics = CommandLine.arguments.contains("--pill") ? .pill : .macBookPro14

        try MainActor.assumeIsolated {
            for step in IslandFixtures.demoCycle() {
                let stage = IslandStage(
                    snapshot: step.snapshot, expanded: step.expanded, notch: notch, outline: outline)
                let data = try ImageExport.png(of: stage, scale: 2)
                let path = "\(outDir)/\(step.name).png"
                try data.write(to: URL(fileURLWithPath: path))
                print("  \(path)")
            }
        }
    }
}
