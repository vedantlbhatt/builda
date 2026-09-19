import Foundation
import SwiftUI

#if canImport(AppKit)
    import AppKit
#endif

/// One spring, as the three numbers docs/motion.md gives it.
///
/// SwiftUI's `.interpolatingSpring(mass:stiffness:damping:initialVelocity:)` integrates the
/// same damped oscillator Reanimated's `withSpring({damping, stiffness, mass})` does, so the
/// phone's `ISLAND` and the Mac's `IslandMotion.island` are one physical object, not two
/// springs tuned by eye to look alike. The closed form below is here so a test can hold the
/// feel to the clip's measurements (first peak ~300 ms, ~10% past target, settled ~450 ms)
/// rather than to the constants restated.
public struct SpringSpec: Sendable, Equatable {
    public let mass: Double
    public let stiffness: Double
    public let damping: Double

    public init(mass: Double, stiffness: Double, damping: Double) {
        self.mass = mass
        self.stiffness = stiffness
        self.damping = damping
    }

    /// The SwiftUI animation. Velocity 0: a morph starts from rest, and an interrupted one is
    /// retargeted by SwiftUI, which carries the in-flight velocity over on its own.
    public var animation: Animation {
        .interpolatingSpring(mass: mass, stiffness: stiffness, damping: damping, initialVelocity: 0)
    }

    public func delayed(_ seconds: Double) -> Animation { animation.delay(seconds) }

    /// ζ. Below 1 the spring overshoots, which is the point of ISLAND.
    public var dampingRatio: Double { damping / (2 * (stiffness * mass).squareRoot()) }
    /// ω₀ in rad/s.
    public var naturalFrequency: Double { (stiffness / mass).squareRoot() }

    /// Where a step from 0 to 1 is at `t` seconds, starting from rest.
    public func value(at t: Double) -> Double {
        guard t > 0 else { return 0 }
        let w0 = naturalFrequency
        let z = dampingRatio
        if z < 1 {
            let wd = w0 * (1 - z * z).squareRoot()
            let e = exp(-z * w0 * t)
            return 1 - e * (cos(wd * t) + (z * w0 / wd) * sin(wd * t))
        }
        if z == 1 {
            return 1 - exp(-w0 * t) * (1 + w0 * t)
        }
        let s = (z * z - 1).squareRoot()
        let r1 = -w0 * (z - s)
        let r2 = -w0 * (z + s)
        return 1 + (r2 * exp(r1 * t) - r1 * exp(r2 * t)) / (r1 - r2)
    }

    /// The first time the step reaches `fraction` (0...1), to the millisecond.
    public func time(toReach fraction: Double) -> Double {
        var t = 0.0
        while t < 5 {
            if value(at: t) >= fraction { return t }
            t += 0.0005
        }
        return 5
    }

    /// Time of the first peak, and how far past the target it goes (0.10 is 10%).
    public var firstPeak: (time: Double, overshoot: Double) {
        let z = dampingRatio
        guard z < 1 else { return (.infinity, 0) }
        let wd = naturalFrequency * (1 - z * z).squareRoot()
        let t = Double.pi / wd
        return (t, value(at: t) - 1)
    }

    /// The last time the step is outside `tolerance` of its target.
    public func settleTime(tolerance: Double = 0.02) -> Double {
        var last = 0.0
        var t = 0.0
        while t < 5 {
            if abs(value(at: t) - 1) > tolerance { last = t }
            t += 0.001
        }
        return last
    }
}

/// The motion constants of docs/motion.md, in SwiftUI.
///
/// `mobile/src/motion/spec.ts` is where they live for the phone; this is the Mac's copy, and
/// `IslandMotionTests` reads the table in docs/motion.md so the two cannot drift silently.
/// Everything that moves on the notch or in the popover takes one of these five and nothing
/// else: eleven ad hoc springs is how the app ended up disagreeing with itself about how a
/// thing moves.
public enum IslandMotion {

    /// Every container morph: the island, a card becoming a page, a sheet. Underdamped on
    /// purpose (ζ 0.59): ~10% past the target at the first peak, settled by ~470 ms.
    public static let island = SpringSpec(mass: 1, stiffness: 210, damping: 17)
    /// What rides inside a container. Stiffer and better damped, so it settles BEFORE the box.
    public static let content = SpringSpec(mass: 0.9, stiffness: 320, damping: 22)
    /// Small things arriving: chips, faces, badges, words.
    public static let pop = SpringSpec(mass: 0.7, stiffness: 260, damping: 14)
    /// The status wheel, and anything list-like that moves as one. Heavier, so a step weighs.
    public static let wheel = SpringSpec(mass: 1, stiffness: 190, damping: 20)
    /// A finger (or a cursor) let go: settle with no visible bounce.
    public static let snap = SpringSpec(mass: 1, stiffness: 300, damping: 26)

    // MARK: stagger in, never out

    /// Between consecutive chips.
    public static let chipStaggerMs = 45
    /// Between agent faces on the rail.
    public static let railStaggerMs = 60
    /// Between words of a sentence revealed a word at a time.
    public static let wordStaggerMs = 55
    /// Everything that leaves, leaves together, in this long. A staggered exit makes a panel
    /// look reluctant to close.
    public static let exitMs = 120

    // MARK: the morph's choreography (fractions of the ISLAND spring's progress)

    /// The outgoing layer is gone by this far into the morph...
    public static let outgoingGoneAt = 0.28
    /// ...and scales UP to this as it leaves, as if it were blown out of the box.
    public static let outgoingScale = 1.22
    /// The incoming layer starts here, on CONTENT, so the box is open before anything is in it.
    public static let incomingStartsAt = 0.34
    /// Incoming content starts this small and this far up, and settles into place.
    public static let incomingScale = 0.92
    public static let incomingRise = 5.0

    /// Seconds for the ISLAND spring to cover `outgoingGoneAt`: how long the outgoing fade is.
    public static var outgoingSeconds: Double { island.time(toReach: outgoingGoneAt) }
    /// Seconds for the ISLAND spring to cover `incomingStartsAt`: the incoming layer's delay.
    public static var incomingDelaySeconds: Double { island.time(toReach: incomingStartsAt) }

    // MARK: idle loops (never in step with each other)

    public static let breatheOutMs = 1500
    public static let breatheBackMs = 1700
    public static let blinkGapMinMs = 1800
    public static let blinkGapMaxMs = 5000
    public static let blinkDoubleChance = 0.25
    public static let blinkCloseMs = 70
    public static let blinkOpenMs = 90
    /// One sweep of the shimmer across the wheel's active line. Not a kit number: the kit
    /// shows the sweep and does not time it. 1900 ms against the breath's 1500 and 1700 only
    /// comes round together every 28.5 and 32.3 s, so the shimmer does not ride the breath.
    public static let shimmerMs = 1900
    /// The aura ring turns once in this long, linear.
    public static let auraTurnMs = 5000
    /// The aura fades in and out over this long.
    public static let auraFadeMs = 420

    // MARK: the wheel's falloff, by rows from the centre

    public static let wheelOpacity: [Double] = [1, 0.34, 0.14, 0]
    public static let wheelScale: [Double] = [1, 0.78, 0.66]

    /// Opacity of a wheel row `distance` rows from the centre, interpolated between the table.
    public static func wheelOpacity(at distance: Double) -> Double {
        interpolate(abs(distance), table: wheelOpacity)
    }

    public static func wheelScale(at distance: Double) -> Double {
        interpolate(abs(distance), table: wheelScale)
    }

    static func interpolate(_ x: Double, table: [Double]) -> Double {
        guard let last = table.last else { return 0 }
        if x <= 0 { return table[0] }
        if x >= Double(table.count - 1) { return last }
        let i = Int(x)
        let f = x - Double(i)
        return table[i] + (table[i + 1] - table[i]) * f
    }

    // MARK: Reduce Motion

    /// Whether the person asked for less motion. Read at each use rather than cached: the
    /// setting can change while the app runs, and a cached "no" keeps every loop going.
    @MainActor
    public static var reduceMotion: Bool {
        #if canImport(AppKit)
            return NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        #else
            return false
        #endif
    }

    /// `spec`'s animation, or, under Reduce Motion, a short fade that reaches the same end.
    /// No overshoot and no travel: "instant morphs with a short fade".
    @MainActor
    public static func animation(_ spec: SpringSpec) -> Animation {
        reduceMotion ? .easeOut(duration: 0.12) : spec.animation
    }
}
