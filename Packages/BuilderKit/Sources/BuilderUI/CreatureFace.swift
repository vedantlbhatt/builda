import SwiftUI

/// The face's state: colour on the character, not a label (docs/motion.md, rule 5).
///
/// The table is the notch kit's (`motion.js` STATES), with one row added: `waiting`, which the
/// kit does not have and Builda needs most. Amber on a live surface means "needs you" and
/// nothing else (design/tokens.json `spectrum.crew`), so waiting is the only amber glow.
public enum FaceState: String, CaseIterable, Sendable {
    case idle, working, thinking, waiting, error, done, sleep

    public enum Eyes: Sendable { case dot, line, arc, closed }

    public var eyes: Eyes {
        switch self {
        case .idle, .working, .thinking: return .dot
        // "The creature's eyes flatten" is the needs-you face (docs/motion.md): flat, like
        // the kit's annoyed error face, because being kept waiting is the same feeling.
        case .waiting, .error: return .line
        case .done: return .arc
        case .sleep: return .closed
        }
    }

    /// The ink the creature is drawn in: pale, so the glow carries the colour.
    public var tint: RGBA {
        switch self {
        case .idle: return RGBA(hex: 0xDCE2EA)
        case .working: return RGBA(hex: 0xD7E4F7)
        case .thinking: return RGBA(hex: 0xE0D8F6)
        case .waiting: return RGBA(hex: 0xF6E6C4)
        case .error: return RGBA(hex: 0xF7D9D5)
        case .done: return RGBA(hex: 0xD6F2E2)
        case .sleep: return RGBA(hex: 0xD2D6E0)
        }
    }

    /// The soft light behind it.
    public var glow: RGBA {
        switch self {
        case .idle: return RGBA(r: 200, g: 208, b: 220, a: 0.55)
        case .working: return RGBA(r: 90, g: 160, b: 255, a: 0.75)
        case .thinking: return RGBA(r: 150, g: 110, b: 255, a: 0.75)
        case .waiting: return RGBA(r: 255, g: 179, b: 0, a: 0.8)
        case .error: return RGBA(r: 255, g: 80, b: 70, a: 0.75)
        case .done: return RGBA(r: 50, g: 215, b: 120, a: 0.7)
        case .sleep: return RGBA(r: 120, g: 120, b: 160, a: 0.45)
        }
    }

    /// Eye height as a fraction of an open eye (the kit's: line 18%, arc 55%, closed 12%).
    public var eyeHeight: Double {
        switch eyes {
        case .dot: return 1
        case .line: return 0.18
        case .arc: return 0.55
        case .closed: return 0.12
        }
    }

    /// 1 when the eye's bottom corners round into an arc.
    public var eyeArc: Double { eyes == .arc ? 1 : 0 }
}

/// A colour as four numbers SwiftUI can interpolate, so a state change springs the tint and
/// the glow rather than cutting them.
public struct RGBA: VectorArithmetic, Sendable {
    public var r: Double, g: Double, b: Double, a: Double

    public init(r: Double, g: Double, b: Double, a: Double = 1) {
        self.r = r / 255
        self.g = g / 255
        self.b = b / 255
        self.a = a
    }

    public init(hex: UInt32, a: Double = 1) {
        self.init(
            r: Double((hex >> 16) & 0xFF), g: Double((hex >> 8) & 0xFF), b: Double(hex & 0xFF), a: a)
    }

    private init(unit r: Double, _ g: Double, _ b: Double, _ a: Double) {
        self.r = r
        self.g = g
        self.b = b
        self.a = a
    }

    public var color: Color { Color(.sRGB, red: r, green: g, blue: b, opacity: max(0, min(1, a))) }

    public static var zero: RGBA { RGBA(unit: 0, 0, 0, 0) }
    public static func + (l: RGBA, r: RGBA) -> RGBA { RGBA(unit: l.r + r.r, l.g + r.g, l.b + r.b, l.a + r.a) }
    public static func - (l: RGBA, r: RGBA) -> RGBA { RGBA(unit: l.r - r.r, l.g - r.g, l.b - r.b, l.a - r.a) }
    public mutating func scale(by rhs: Double) {
        r *= rhs
        g *= rhs
        b *= rhs
        a *= rhs
    }
    public var magnitudeSquared: Double { r * r + g * g + b * b + a * a }
}

/// The builder's pixel creature with the notch kit's face on it.
///
/// What it takes from the kit is the STATE MACHINE, not the 3D sphere (docs/motion.md): tint
/// and glow spring between states on CONTENT, the eyes change shape (dot, flat line, arc,
/// closed) by springing their height, the glow breathes 1500 ms out and 1700 ms back, and the
/// eyes blink on a random 1.8 to 5 s gap with a 25% double. The creature itself never scales:
/// the pack forbids a scale breath on a pixel icon, so its breath is its own drawn breath frame
/// (`CreatureGrids.breath`), swapped in at the top of the glow's breath.
public struct CreatureFace: View {
    let creature: String
    let state: FaceState
    let points: CGFloat
    /// Draw the creature in this ink instead of the state's tint (the rail's faces wear their
    /// session's hue; the builder's own face wears its state).
    let ink: Color?
    let glow: Bool
    /// Run the idle loops. Off for still renders and under Reduce Motion.
    let alive: Bool
    /// A per-face seed so two faces never blink together.
    let seed: UInt64

    public init(
        creature: String = "bit", state: FaceState, points: CGFloat = 24, ink: Color? = nil,
        glow: Bool = true, alive: Bool = true, seed: UInt64 = 1
    ) {
        self.creature = creature
        self.state = state
        self.points = points
        self.ink = ink
        self.glow = glow
        self.alive = alive
        self.seed = seed
    }

    @State private var breathFrame = false
    @State private var blink: Double = 0

    /// How the loops run, and why not on a SwiftUI clock. MEASURED in demo mode, the island held
    /// collapsed and idle, CPU seconds over 30 s: loops paused 0.1% of a core; the face on a
    /// `TimelineView` about 5%, at 30 fps and at 12 fps alike, on the display link and on a
    /// plain timer alike. The cost was re-rendering the face at all, not how often. So the one
    /// continuous thing, the glow's breath, is a Core Animation keyframe animation that the
    /// render server plays with no app work (`BreathingGlow`), and the pixel creature is drawn
    /// only when it changes: the breath frame swapped twice a cycle, a blink every few seconds.
    public var body: some View {
        let still = !alive || IslandMotion.reduceMotion
        FaceRender(
            creature: state == .sleep && creature == "bit" ? "bit-sleeping" : creature,
            points: points,
            useBreathFrame: !still && breathFrame,
            blink: state.eyes == .dot ? blink : 0,
            ink: ink,
            showGlow: glow,
            liveGlow: !still,
            tint: state.tint,
            glowColor: state.glow,
            eyeHeight: state.eyeHeight,
            eyeArc: state.eyeArc)
            .animation(IslandMotion.animation(IslandMotion.content), value: state)
            .frame(width: points * 1.5, height: points * 1.5)
            .accessibilityLabel(Text(Self.spoken(state)))
            .task(id: still) {
                guard !still else { return }
                await withTaskGroup(of: Void.self) { group in
                    group.addTask { await breathLoop() }
                    group.addTask { await blinkLoop() }
                }
            }
    }

    /// The creature's own breath frame, on while the glow is past half its breath: 0.75 s into
    /// the 1.5 s rise until 0.85 s into the 1.7 s fall (FaceClock.breath crosses 0.5 there).
    @MainActor
    private func breathLoop() async {
        let out = Double(IslandMotion.breatheOutMs) / 1000
        let back = Double(IslandMotion.breatheBackMs) / 1000
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: UInt64(out / 2 * 1e9))
            breathFrame = true
            try? await Task.sleep(nanoseconds: UInt64((out / 2 + back / 2) * 1e9))
            breathFrame = false
            try? await Task.sleep(nanoseconds: UInt64(back / 2 * 1e9))
        }
    }

    /// Blinks on BlinkSchedule's seeded gaps: close in 70 ms, open in 90, a quarter doubled.
    @MainActor
    private func blinkLoop() async {
        let schedule = BlinkSchedule(seed: seed)
        let close = Double(IslandMotion.blinkCloseMs) / 1000
        let open = Double(IslandMotion.blinkOpenMs) / 1000
        var n: UInt64 = 1
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: UInt64(schedule.gap(n) * 1e9))
            let times = FaceClock.unit(seed, n, 2) < IslandMotion.blinkDoubleChance ? 2 : 1
            for i in 0..<times {
                if i > 0 { try? await Task.sleep(nanoseconds: 90_000_000) }
                withAnimation(.linear(duration: close)) { blink = 1 }
                try? await Task.sleep(nanoseconds: UInt64(close * 1e9))
                withAnimation(.linear(duration: open)) { blink = 0 }
                try? await Task.sleep(nanoseconds: UInt64(open * 1e9))
            }
            n += 1
        }
    }

    static func spoken(_ s: FaceState) -> String {
        switch s {
        case .idle: return "Builder, idle"
        case .working: return "Builder, agents working"
        case .thinking: return "Builder, reading"
        case .waiting: return "Builder, waiting on you"
        case .error: return "Builder, something went wrong"
        case .done: return "Builder, finished"
        case .sleep: return "Builder, asleep"
        }
    }
}

/// The idle clocks. Pure functions of time, so a still render, a test and the live face agree.
public enum FaceClock {

    /// 0 at rest, 1 at the top of the breath: 1500 ms out and 1700 ms back, ease in-out quad.
    public static func breath(at t: Double) -> Double {
        let out = Double(IslandMotion.breatheOutMs) / 1000
        let back = Double(IslandMotion.breatheBackMs) / 1000
        let phase = t.truncatingRemainder(dividingBy: out + back)
        if phase < out { return quad(phase / out) }
        return 1 - quad((phase - out) / back)
    }

    static func quad(_ x: Double) -> Double {
        x < 0.5 ? 2 * x * x : 1 - pow(-2 * x + 2, 2) / 2
    }

    /// A uniform number in [0, 1) from three integers (SplitMix64).
    public static func unit(_ a: UInt64, _ b: UInt64, _ c: UInt64) -> Double {
        var z = a &* 0x9E37_79B9_7F4A_7C15 &+ b &* 0xBF58_476D_1CE4_E5B9 &+ c &* 0x94D0_49BB_1331_11EB
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        z ^= z >> 31
        return Double(z >> 11) / Double(1 << 53)
    }
}

/// When the eyes blink. Blinks land on a random gap of 1.8 to 5 s (a fixed interval reads as
/// a metronome), close in 70 ms and open in 90 ms, and a quarter of them are doubles.
///
/// A class held in `@State` because a schedule is history: the next gap is drawn when the
/// last blink is done. Seeded (SplitMix64 over seed and blink number), so two faces on screen
/// never blink together and a test can replay one.
public final class BlinkSchedule {
    private let seed: UInt64
    private var count: UInt64 = 0
    private var start: Double?
    private var isDouble = false

    public init(seed: UInt64) { self.seed = seed }

    /// 0 open to 1 shut, at time `t` (seconds, any monotonic clock).
    public func value(at t: Double) -> Double {
        let close = Double(IslandMotion.blinkCloseMs) / 1000
        let open = Double(IslandMotion.blinkOpenMs) / 1000
        let pause = 0.09
        guard let s = start else {
            schedule(after: t)
            return 0
        }
        let span = (close + open) * (isDouble ? 2 : 1) + (isDouble ? pause : 0)
        if t > s + span {
            schedule(after: s + span)
            return value(at: t)
        }
        func one(_ at: Double) -> Double {
            let d = t - at
            if d < 0 || d > close + open { return 0 }
            return d < close ? d / close : 1 - (d - close) / open
        }
        var v = one(s)
        if isDouble { v = max(v, one(s + close + open + pause)) }
        return v
    }

    private func schedule(after t: Double) {
        let minGap = Double(IslandMotion.blinkGapMinMs) / 1000
        let spread = Double(IslandMotion.blinkGapMaxMs - IslandMotion.blinkGapMinMs) / 1000
        count += 1
        start = t + minGap + spread * FaceClock.unit(seed, count, 1)
        isDouble = FaceClock.unit(seed, count, 2) < IslandMotion.blinkDoubleChance
    }

    /// The gap before blink `n`, for tests.
    public func gap(_ n: UInt64) -> Double {
        let minGap = Double(IslandMotion.blinkGapMinMs) / 1000
        let spread = Double(IslandMotion.blinkGapMaxMs - IslandMotion.blinkGapMinMs) / 1000
        return minGap + spread * FaceClock.unit(seed, n, 1)
    }
}

/// The drawing, with everything that springs as animatable data.
struct FaceRender: View, Animatable {
    let creature: String
    let points: CGFloat
    let useBreathFrame: Bool
    var blink: Double
    let ink: Color?
    let showGlow: Bool
    /// The breathing Core Animation glow; false draws it still at mid breath (offscreen
    /// renders, Reduce Motion), which ImageRenderer can see and a layer it cannot.
    let liveGlow: Bool
    var tint: RGBA
    var glowColor: RGBA
    var eyeHeight: Double
    var eyeArc: Double

    var animatableData: AnimatablePair<AnimatablePair<RGBA, RGBA>, AnimatablePair<Double, AnimatablePair<Double, Double>>> {
        get { AnimatablePair(AnimatablePair(tint, glowColor), AnimatablePair(eyeHeight, AnimatablePair(eyeArc, blink))) }
        set {
            tint = newValue.first.first
            glowColor = newValue.first.second
            eyeHeight = newValue.second.first
            eyeArc = newValue.second.second.first
            blink = newValue.second.second.second
        }
    }

    var body: some View {
        let grid =
            (useBreathFrame ? CreatureGrids.breath[creature] : nil)
            ?? CreatureGrids.rest[creature] ?? CreatureGrids.rest["bit"]!
        ZStack {
            if showGlow && liveGlow {
                BreathingGlow(color: glowColor)
                    .frame(width: points * 1.45, height: points * 1.45)
            } else if showGlow {
                // Still, at mid breath.
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [glowColor.color, glowColor.color.opacity(0)],
                            center: .center, startRadius: 0, endRadius: points * 0.72))
                    .frame(width: points * 1.45, height: points * 1.45)
                    .scaleEffect(1.07)
                    .opacity(0.65)
            }
            // Rounded to what a pixel can show, so a face at rest compares equal frame to frame
            // and its cells are not redrawn on every tick of the breath (`PixelCreature`).
            PixelCreature(
                creature: creature, rows: grid, ink: ink ?? tint.color,
                eyeOpen: (max(0, eyeHeight * (1 - 0.92 * blink)) * 100).rounded() / 100,
                eyeArc: (eyeArc * 100).rounded() / 100)
                .equatable()
            .frame(width: points, height: points)
        }
        .frame(width: points * 1.5, height: points * 1.5)
    }
}

/// The creature's cells and eyes. Equatable, so SwiftUI skips it whenever the face changes only
/// in its glow: MEASURED, the island collapsed and idle cost 4.3% of a core with the cells
/// redrawn 30 times a second for a breath that only moves the light behind them.
struct PixelCreature: View, Equatable {
    let creature: String
    let rows: [String]
    let ink: Color
    let eyeOpen: Double
    let eyeArc: Double

    var body: some View {
        Canvas { ctx, size in
            let cell = size.width / CGFloat(CreatureGrids.size)
            var path = Path()
            for (y, row) in rows.enumerated() {
                for (x, ch) in row.enumerated() where ch == "#" {
                    path.addRect(CGRect(x: CGFloat(x) * cell, y: CGFloat(y) * cell, width: cell, height: cell))
                }
            }
            // Eyes: fill the eye cells, then cut the eye at its sprung height. Filling first is
            // what lets an eye close; cutting it from the centre is what makes a flat line and a
            // blink read as the same lid.
            let sleeping = creature == "bit-sleeping"
            if !sleeping {
                for e in CreatureGrids.eyes {
                    path.addRect(CGRect(x: CGFloat(e.x) * cell, y: CGFloat(e.y) * cell, width: cell, height: cell))
                }
            }
            ctx.fill(path, with: .color(ink))
            guard !sleeping else { return }
            // An open, flat or shut eye is a hole of that height. It fades out as the eye
            // becomes an arc, so dot to arc is one movement.
            let h = 2 * cell * eyeOpen * (1 - eyeArc)
            ctx.blendMode = .copy
            if h > 0.2 {
                for cx in [6.0, 10.0] {
                    let rect = CGRect(x: (cx - 1) * cell, y: 7 * cell - h / 2, width: 2 * cell, height: h)
                    ctx.fill(Path(roundedRect: rect, cornerRadius: 0.15 * cell), with: .color(.black))
                }
            }
            // Done: the eyes become arcs, the pixel face's ^ ^. The kit draws a half height eye
            // with a rounded bottom; on a 16 cell creature that read as sleepy, not pleased
            // (seen in the first render), so the arc bows up instead.
            if eyeArc > 0.01 {
                for cx in [6.0, 10.0] {
                    var arc = Path()
                    arc.move(to: CGPoint(x: (cx - 0.8) * cell, y: 7.6 * cell))
                    arc.addQuadCurve(
                        to: CGPoint(x: (cx + 0.8) * cell, y: 7.6 * cell),
                        control: CGPoint(x: cx * cell, y: 5.6 * cell))
                    ctx.stroke(
                        arc, with: .color(.black),
                        style: StrokeStyle(lineWidth: 0.62 * cell * eyeArc, lineCap: .round))
                }
            }
        }
    }
}

#if canImport(AppKit)
    import AppKit
    import QuartzCore

    /// The glow behind the face, breathing on the render server: brighter and 14% larger at the
    /// top of the breath, 1500 ms out and 1700 ms back, ease in-out, forever, with no app work
    /// per frame. Its colour is set from SwiftUI (which springs it between states on CONTENT).
    struct BreathingGlow: NSViewRepresentable {
        let color: RGBA

        func makeNSView(context: Context) -> GlowView { GlowView() }

        func updateNSView(_ view: GlowView, context: Context) { view.set(color) }

        final class GlowView: NSView {
            private let gradient = CAGradientLayer()

            override init(frame: NSRect) {
                super.init(frame: frame)
                wantsLayer = true
                layer = CALayer()
                gradient.type = .radial
                gradient.startPoint = CGPoint(x: 0.5, y: 0.5)
                gradient.endPoint = CGPoint(x: 1, y: 1)
                layer?.addSublayer(gradient)
                breathe()
            }

            @available(*, unavailable)
            required init?(coder: NSCoder) { fatalError() }

            override func hitTest(_ point: NSPoint) -> NSView? { nil }

            override func layout() {
                super.layout()
                CATransaction.begin()
                CATransaction.setDisableActions(true)
                gradient.frame = bounds
                CATransaction.commit()
            }

            func set(_ c: RGBA) {
                CATransaction.begin()
                CATransaction.setDisableActions(true)
                let a = max(0, min(1, c.a))
                gradient.colors = [
                    CGColor(srgbRed: c.r, green: c.g, blue: c.b, alpha: a),
                    CGColor(srgbRed: c.r, green: c.g, blue: c.b, alpha: 0),
                ]
                CATransaction.commit()
            }

            private func breathe() {
                let out = Double(IslandMotion.breatheOutMs) / 1000
                let back = Double(IslandMotion.breatheBackMs) / 1000
                let total = out + back
                let ease = CAMediaTimingFunction(name: .easeInEaseOut)
                let scale = CAKeyframeAnimation(keyPath: "transform.scale")
                scale.values = [1, 1.14, 1]
                let opacity = CAKeyframeAnimation(keyPath: "opacity")
                opacity.values = [0.45, 0.85, 0.45]
                let group = CAAnimationGroup()
                for a in [scale, opacity] {
                    a.keyTimes = [0, NSNumber(value: out / total), 1]
                    a.timingFunctions = [ease, ease]
                    a.duration = total
                }
                group.animations = [scale, opacity]
                group.duration = total
                group.repeatCount = .infinity
                group.isRemovedOnCompletion = false
                gradient.add(group, forKey: "breathe")
            }
        }
    }
#endif
