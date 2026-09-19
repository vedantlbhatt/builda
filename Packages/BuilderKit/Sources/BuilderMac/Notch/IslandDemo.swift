import AppKit
import BuilderUI
import Foundation

/// `BUILDER_ISLAND_DEMO=1`: the island cycles through every mode on fixture data, so it can be
/// screenshotted and recorded on a machine with nothing running, and so a person can see what
/// it does without waiting for an agent to need them.
///
/// Idle, the crew collapsed then open, needs you collapsed then open, shipped, the drop zone,
/// and a dropped link reading and planned; about three seconds a mode, round and round. Every
/// step is logged with its time (`builder: island demo step <name>`), which is how a recording
/// made alongside it is cut into stills.
@MainActor
final class IslandDemo {
    private weak var controller: IslandController?
    private var timer: Timer?
    private var index = -1
    private let started = Date()
    private let log: FileHandle?

    /// Seconds on each step. Collapsed steps are short: they are the moment before a morph.
    static let durations: [String: Double] = [
        "idle": 3.0, "crew-collapsed": 1.6, "crew": 3.6, "needs-you-collapsed": 1.6,
        "needs-you": 3.0, "shipped": 4.0, "drop-zone": 3.0, "drop-reading": 1.6, "drop-planned": 2.6,
    ]

    init(controller: IslandController, shotsDir: String?) {
        self.controller = controller
        if let dir = shotsDir {
            try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
            let path = (dir as NSString).appendingPathComponent("demo-steps.log")
            FileManager.default.createFile(atPath: path, contents: nil)
            log = FileHandle(forWritingAtPath: path)
        } else {
            log = nil
        }
    }

    func start() { advance() }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    private func advance() {
        let steps = IslandFixtures.demoCycle()
        // `BUILDER_ISLAND_DEMO_HOLD=<step>` holds one step, to measure what it costs to show.
        if let hold = ProcessInfo.processInfo.environment["BUILDER_ISLAND_DEMO_HOLD"],
           let step = steps.first(where: { $0.name == hold }) {
            controller?.applyDemo(step.snapshot, expanded: step.expanded)
            NSLog("builder: island demo holding %@", hold)
            return
        }
        index = (index + 1) % steps.count
        let step = steps[index]
        controller?.applyDemo(step.snapshot, expanded: step.expanded)
        let t = Date().timeIntervalSince(started)
        let line = String(format: "%.3f %@\n", t, step.name)
        NSLog("builder: island demo step %@ at %.3f", step.name, t)
        log?.write(Data(line.utf8))
        timer = Timer.scheduledTimer(withTimeInterval: Self.durations[step.name] ?? 3, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.advance() }
        }
    }
}
