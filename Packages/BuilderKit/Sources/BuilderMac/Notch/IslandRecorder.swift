import AppKit
import Foundation

/// `BUILDER_ISLAND_RECORD=<dir>`: the app films the top of the screen around its own island,
/// frame by frame, so the motion can be looked at without a screen recording permission.
///
/// Why from inside the app: MEASURED on the machine this was built on, a process without the
/// Screen Recording permission gets the wallpaper, the menu bar and ITS OWN windows from
/// `CGWindowListCreateImage`, with every other app's windows filtered out. A capture tool run
/// beside the app films an empty menu bar; the app filming itself films the island over the
/// real menu bar, notch and wallpaper, exactly as they composite. `screencapture` and ffmpeg's
/// avfoundation input refused outright. The function is obsolete in the macOS 15 SDK, so it is
/// found at run time; it still answers on macOS 26.
///
/// Frames go to `<dir>/frame_NNNNN.png` with `timestamps.txt`, captured off the main thread
/// so filming does not slow the thing being filmed. Debug only: nothing reaches here unless
/// the environment asks for it.
final class IslandRecorder: @unchecked Sendable {
    fileprivate typealias CreateImage = @convention(c) (CGRect, UInt32, UInt32, UInt32) -> Unmanaged<CGImage>?

    private let dir: String
    private let rect: CGRect
    private let fps: Double
    private let seconds: Double
    private let queue = DispatchQueue(label: "dev.builder.island.recorder", qos: .userInitiated)
    private let writer = DispatchQueue(label: "dev.builder.island.writer", qos: .utility, attributes: .concurrent)
    private var create: CreateImage?

    /// `rect` in CG global coordinates: origin at the top left of the main display, y down.
    init(dir: String, rect: CGRect, fps: Double = 30, seconds: Double = 26) {
        self.dir = dir
        self.rect = rect
        self.fps = fps
        self.seconds = seconds
        if let sym = dlsym(dlopen(nil, RTLD_NOW), "CGWindowListCreateImage") {
            create = unsafeBitCast(sym, to: CreateImage.self)
        }
    }

    /// One picture of `rect` (CG global coordinates) to `path`.
    static func still(rect: CGRect, to path: String) {
        guard let sym = dlsym(dlopen(nil, RTLD_NOW), "CGWindowListCreateImage") else { return }
        let create = unsafeBitCast(sym, to: CreateImage.self)
        guard let image = create(rect, 1 << 0, 0, 1 << 3)?.takeRetainedValue() else { return }
        let rep = NSBitmapImageRep(cgImage: image)
        try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: path))
        NSLog("builder: wrote %@", path)
    }

    func start() {
        guard create != nil else {
            NSLog("builder: island recorder: CGWindowListCreateImage is not available")
            return
        }
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        queue.async { [self] in run() }
    }

    private func run() {
        guard let create else { return }
        let start = Date()
        var n = 0
        var stamps = ""
        while true {
            let t = Date().timeIntervalSince(start)
            if t > seconds { break }
            // kCGWindowListOptionOnScreenOnly, kCGNullWindowID, kCGWindowImageBestResolution
            if let image = create(rect, 1 << 0, 0, 1 << 3)?.takeRetainedValue() {
                let path = String(format: "%@/frame_%05d.png", dir, n)
                writer.async {
                    let rep = NSBitmapImageRep(cgImage: image)
                    try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: path))
                }
                stamps += String(format: "%05d %.3f\n", n, t)
                n += 1
            }
            let wait = start.addingTimeInterval(Double(n) / fps).timeIntervalSinceNow
            if wait > 0 { Thread.sleep(forTimeInterval: wait) }
        }
        writer.sync(flags: .barrier) {}
        try? stamps.write(toFile: dir + "/timestamps.txt", atomically: true, encoding: .utf8)
        NSLog("builder: island recorder wrote %d frames to %@", n, dir)
    }
}
