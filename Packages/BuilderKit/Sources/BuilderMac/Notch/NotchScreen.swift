import AppKit
import BuilderUI

/// Where the island goes: the built-in screen's notch, measured, or a pill under the menu bar.
///
/// MEASURED on the MacBook Pro 14" this was written on: `safeAreaInsets.top` 32, the notch
/// between `auxiliaryTopLeftArea.maxX` 665 and `auxiliaryTopRightArea.minX` 850 of a 1512 pt
/// wide screen, so 185 pt wide and centred at 757.5, which is NOT the screen's centre (756).
/// The island is centred on the measured notch, not on the screen, or its ears would sit 1.5 pt
/// off the hardware and the seam would show. The menu bar there is 34 pt (982 - the visible
/// frame's top 948), two points taller than the notch.
struct NotchPlacement: Equatable {
    let screen: NSScreen
    let metrics: NotchMetrics
    /// The notch's centre, in global screen coordinates.
    let centerX: CGFloat
    /// Where the island's top edge goes: the screen's top on a notch, under the menu bar on a pill.
    let top: CGFloat

    static func == (a: NotchPlacement, b: NotchPlacement) -> Bool {
        a.screen == b.screen && a.metrics == b.metrics && a.centerX == b.centerX && a.top == b.top
    }

    /// The built-in screen when it has a notch, else the main screen with a pill.
    static func current() -> NotchPlacement? {
        let screens = NSScreen.screens
        if let notched = screens.first(where: { isBuiltIn($0) && $0.safeAreaInsets.top > 0 })
            ?? screens.first(where: { $0.safeAreaInsets.top > 0 }),
           let placement = notch(on: notched) {
            return placement
        }
        guard let screen = NSScreen.main ?? screens.first else { return nil }
        let menuBar = screen.frame.maxY - screen.visibleFrame.maxY
        return NotchPlacement(
            screen: screen, metrics: .pill, centerX: screen.frame.midX,
            top: screen.frame.maxY - max(menuBar, 24) - 6)
    }

    static func notch(on screen: NSScreen) -> NotchPlacement? {
        guard let left = screen.auxiliaryTopLeftArea, let right = screen.auxiliaryTopRightArea else {
            return nil
        }
        // The two areas are the menu bar either side of the camera; the gap is the notch.
        // They are in the screen's coordinate space, which for a screen whose frame does not
        // start at x 0 is offset from the global one.
        let offset = left.minX < screen.frame.minX - 0.5 ? screen.frame.minX : 0
        let width = right.minX - left.maxX
        guard width > 0 else { return nil }
        let height = screen.safeAreaInsets.top
        return NotchPlacement(
            screen: screen,
            metrics: NotchMetrics(width: width, height: height, hasNotch: true),
            centerX: offset + left.maxX + width / 2,
            top: screen.frame.maxY)
    }

    static func isBuiltIn(_ screen: NSScreen) -> Bool {
        guard let n = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber
        else { return false }
        return CGDisplayIsBuiltin(CGDirectDisplayID(n.uint32Value)) != 0
    }

    /// The island's rect in global coordinates for a given geometry.
    func rect(for g: IslandGeometry) -> NSRect {
        NSRect(x: centerX - g.w / 2, y: top - g.h, width: g.w, height: g.h)
    }
}
