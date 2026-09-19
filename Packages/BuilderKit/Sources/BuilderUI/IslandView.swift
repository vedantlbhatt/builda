import SwiftUI

/// Where the island sits: the notch's measured size, or no notch at all.
public struct NotchMetrics: Equatable, Sendable {
    /// The camera housing's width in points. 0 on a screen without one.
    public let width: CGFloat
    /// Its height, which is also the collapsed island's: the black shape ends where the notch
    /// ends, so the two read as one piece of hardware.
    public let height: CGFloat
    public let hasNotch: Bool

    public init(width: CGFloat, height: CGFloat, hasNotch: Bool) {
        self.width = width
        self.height = height
        self.hasNotch = hasNotch
    }

    /// MEASURED on the MacBook Pro 14" this was built on (`NSScreen.auxiliaryTopLeftArea` and
    /// `auxiliaryTopRightArea`): the notch runs from x 665 to 850 of 1512 pt, 185 pt wide, and
    /// `safeAreaInsets.top` is 32. Used by previews and tests; the app measures the real screen.
    public static let macBookPro14 = NotchMetrics(width: 185, height: 32, hasNotch: true)

    /// A screen with no notch: the island is a pill of its own just under the menu bar.
    public static let pill = NotchMetrics(width: 0, height: 30, hasNotch: false)
}

/// The island's size in one value: width, height and bottom corner radius.
///
/// ONE spring moves all three, because it is one value (docs/motion.md rule 2). Two springs on
/// one box drift apart the moment a morph is interrupted and the corners visibly wobble.
public struct IslandGeometry: VectorArithmetic, Sendable {
    public var w: Double, h: Double, r: Double

    public init(w: Double, h: Double, r: Double) {
        self.w = w
        self.h = h
        self.r = r
    }

    public static var zero: IslandGeometry { IslandGeometry(w: 0, h: 0, r: 0) }
    public static func + (a: Self, b: Self) -> Self { Self(w: a.w + b.w, h: a.h + b.h, r: a.r + b.r) }
    public static func - (a: Self, b: Self) -> Self { Self(w: a.w - b.w, h: a.h - b.h, r: a.r - b.r) }
    public mutating func scale(by k: Double) {
        w *= k
        h *= k
        r *= k
    }
    public var magnitudeSquared: Double { w * w + h * h + r * r }
}

/// Every size the island takes, in one table. Add a mode here and the view picks it up.
public enum IslandLayout {
    /// Each ear: the black that pokes out either side of the notch. 38 pt holds a 20 pt face
    /// with its glow, and a 2x2 cluster of 7 pt dots with room around it.
    public static let ear: CGFloat = 38
    /// The collapsed bottom corners. The notch's own are about 8; the island's sit a touch
    /// rounder so it reads as a soft object hung off the hardware rather than a second notch.
    public static let collapsedRadius: CGFloat = 10
    public static let expandedRadius: CGFloat = 22
    /// The concave curve where the island leaves the top edge, so it pours out of the bezel
    /// instead of being stuck to it.
    public static let flare: CGFloat = 6
    /// Gap between the island and the agent rail.
    public static let railGap: CGFloat = 8

    /// The body under the notch band, per expanded mode.
    public static func bodyHeight(_ mode: IslandMode) -> CGFloat {
        switch mode {
        case .idle: return 0
        case .crew: return 86
        case .needsYou: return 70
        case .shipped: return 54
        case .drop: return 74
        }
    }

    public static func width(_ mode: IslandMode) -> CGFloat {
        switch mode {
        case .idle: return 0
        case .crew: return 410
        case .needsYou: return 440
        case .shipped: return 420
        case .drop: return 420
        }
    }

    public static func geometry(mode: IslandMode, expanded: Bool, notch: NotchMetrics) -> IslandGeometry {
        let collapsedW = notch.hasNotch ? notch.width + 2 * ear : 2 * ear + 28
        let collapsedH = notch.height
        if !expanded || mode == .idle {
            let r = notch.hasNotch ? collapsedRadius : collapsedH / 2
            return IslandGeometry(w: collapsedW, h: collapsedH, r: r)
        }
        return IslandGeometry(
            w: max(width(mode), collapsedW), h: collapsedH + bodyHeight(mode), r: expandedRadius)
    }

    /// The largest the island can be, overshoot included, plus the rail: what the window
    /// holding it has to fit without ever clipping a frame of a morph.
    public static func canvas(notch: NotchMetrics) -> CGSize {
        let widest = IslandMode.allCases.map { width($0) }.max() ?? 470
        let tallest = IslandMode.allCases.map { bodyHeight($0) }.max() ?? 86
        // ISLAND overshoots ~10% (IslandMotion.island.firstPeak); 15% leaves room for an
        // interrupted morph that starts with velocity already in it.
        return CGSize(
            width: (widest * 1.15 + 2 * (railGap + 50)).rounded(.up),
            height: (notch.height + tallest * 1.15 + 20 + 6 * 34).rounded(.up))
    }
}

/// The notch island, drawn. A pure view over data: the app hands it a snapshot and whether it
/// is open, and the same view renders offscreen for tests and screenshots.
public struct IslandView: View {
    let snapshot: IslandSnapshot
    let expanded: Bool
    let notch: NotchMetrics
    /// The wheel's active row in crew mode (the controller turns it).
    let wheelIndex: Int
    let alive: Bool
    let creature: String
    let now: Date?
    let onOpenAgent: ((IslandAgent) -> Void)?
    /// Draw a hairline round the black shape. Never on in use: the island is black on a black
    /// menu bar by design, which is also what makes it impossible to judge the shape in a
    /// recording. `BUILDER_ISLAND_EDGE=1` turns it on for exactly that.
    let edge: Bool

    public init(
        snapshot: IslandSnapshot, expanded: Bool, notch: NotchMetrics, wheelIndex: Int = 0,
        creature: String = "bit", alive: Bool = true, now: Date? = nil,
        onOpenAgent: ((IslandAgent) -> Void)? = nil, edge: Bool = false
    ) {
        self.snapshot = snapshot
        self.expanded = expanded
        self.notch = notch
        self.wheelIndex = wheelIndex
        self.creature = creature
        self.alive = alive
        self.now = now
        self.onOpenAgent = onOpenAgent
        self.edge = edge
    }

    var mode: IslandMode { snapshot.mode }
    var isOpen: Bool { expanded && mode != .idle }

    public var body: some View {
        let g = IslandLayout.geometry(mode: mode, expanded: expanded, notch: notch)
        ZStack(alignment: .top) {
            IslandBody(
                geometry: g, notch: notch, content: content, face: { face(points: $0) }, ears: ears,
                wash: wash, washKey: isOpen ? contentKey : "none", contentKey: contentKey, edge: edge)
            rail(g)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    /// Which layer is showing. A new key is a morph (the outgoing layer gone by 28% scaling up,
    /// the incoming one in from 34%); the same key is the same layer changing in place. The drop
    /// has four layers, not one: FOUND IN A RECORDED FRAME, the zone and "Pair this Mac first"
    /// under one key cross faded, both legible at once, which is the cut the kit warns about.
    private var contentKey: String {
        guard isOpen else { return "collapsed" }
        guard mode == .drop else { return mode.rawValue }
        switch snapshot.drop {
        case .none, .zone: return "drop-zone"
        case .unpaired: return "drop-unpaired"
        case .sending, .progress: return "drop-progress"
        case .failed: return "drop-failed"
        }
    }

    // MARK: The face (one object from ear to body)

    /// Sized by the caller as the island opens: 24 pt in the ear and 32 pt in the body, the two
    /// sizes where a 16 cell creature lands on whole pixels at 2x (3 and 4 px a cell).
    private func face(points: CGFloat) -> some View {
        CreatureFace(creature: creature, state: snapshot.face, points: points, alive: alive, seed: 3)
    }

    // MARK: The ears

    @ViewBuilder
    private var ears: some View {
        if mode == .needsYou, let w = snapshot.waiting.first?.waiting {
            // The compact needs-you: how long, in amber, where the dots were.
            Text(compactWait(since: w.since))
                .font(.system(size: 11, weight: .bold).monospacedDigit())
                .foregroundStyle(StripPalette.accent(dark: true))
                .fixedSize()
        } else {
            AgentDots(hues: snapshot.agents.map(\.hue))
                .opacity(mode == .idle ? 0.8 : 1)
        }
    }

    private func compactWait(since: Double) -> String {
        let s = max(0, (now ?? Date()).timeIntervalSince1970 - since)
        if s < 60 { return "now" }
        if s < 3600 { return "\(Int(s / 60))m" }
        return "\(Int(s / 3600))h"
    }

    // MARK: The wash

    private var wash: AnyShapeStyle? {
        guard isOpen else { return nil }
        switch mode {
        case .needsYou:
            // Warm from the top, into the black.
            return AnyShapeStyle(
                LinearGradient(
                    colors: [Color(.sRGB, red: 1, green: 0.69, blue: 0.34, opacity: 0.30),
                             Color(.sRGB, red: 1, green: 0.69, blue: 0.34, opacity: 0.02)],
                    startPoint: .top, endPoint: .bottom))
        case .shipped:
            // Green across.
            return AnyShapeStyle(
                LinearGradient(
                    colors: [Color(.sRGB, red: 0.18, green: 0.83, blue: 0.65, opacity: 0.04),
                             Color(.sRGB, red: 0.18, green: 0.83, blue: 0.65, opacity: 0.34)],
                    startPoint: .topLeading, endPoint: .bottomTrailing))
        case .drop:
            if case .failed = snapshot.drop { return redWash }
            if case .unpaired = snapshot.drop { return redWash }
            if case .progress(_, let step, _) = snapshot.drop, step >= 2 {
                return AnyShapeStyle(
                    LinearGradient(
                        colors: [Color(.sRGB, red: 0.18, green: 0.83, blue: 0.65, opacity: 0.04),
                                 Color(.sRGB, red: 0.18, green: 0.83, blue: 0.65, opacity: 0.30)],
                        startPoint: .topLeading, endPoint: .bottomTrailing))
            }
            return nil
        default:
            return nil
        }
    }

    /// Red from the bottom.
    private var redWash: AnyShapeStyle {
        AnyShapeStyle(
            LinearGradient(
                colors: [Color(.sRGB, red: 1, green: 0.16, blue: 0.24, opacity: 0.04),
                         Color(.sRGB, red: 1, green: 0.36, blue: 0.18, opacity: 0.36)],
                startPoint: .top, endPoint: .bottom))
    }

    // MARK: The body's content, per mode

    @ViewBuilder
    private var content: some View {
        if !isOpen {
            Color.clear
        } else {
            switch mode {
            case .crew: crewBody
            case .needsYou: needsBody
            case .shipped: shippedBody
            case .drop: dropBody
            case .idle: Color.clear
            }
        }
    }

    private var crewBody: some View {
        let rows = snapshot.agents.map {
            StatusWheel.Row(id: $0.id, lead: $0.repo, text: $0.activity ?? "working", tint: $0.hue)
        }
        return StatusWheel(
            rows: rows, index: rows.isEmpty ? 0 : wheelIndex % rows.count, rowHeight: 22,
            alive: alive)
    }

    private var needsBody: some View {
        let waiting = snapshot.waiting
        let first = waiting.first
        return HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text("\(first?.repo ?? "A session") is waiting on you")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
                Text(needsDetail(first))
                    .font(.system(size: 11))
                    .foregroundStyle(.white.opacity(0.62))
            }
            .lineLimit(1)
            .truncationMode(.tail)
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 3) {
                if let since = first?.waiting?.since {
                    Text(IslandText.waited(since: since, now: (now ?? Date()).timeIntervalSince1970))
                        .font(.system(size: 13, weight: .semibold).monospacedDigit())
                        .foregroundStyle(StripPalette.accent(dark: true))
                }
                Text(waiting.count > 1 ? "+\(waiting.count - 1) more · Open" : "Open")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(.white.opacity(0.5))
            }
        }
        .contentShape(Rectangle())
        .onTapGesture { if let first { onOpenAgent?(first) } }
    }

    private func needsDetail(_ a: IslandAgent?) -> String {
        guard let w = a?.waiting else { return "" }
        switch w.reason {
        case .permission: return w.detail.map { "Wants to change \($0)" } ?? "Waiting for permission"
        case .question: return w.detail.map { "Asked: \($0)" } ?? "Asked you a question"
        case .turnEnded: return w.detail ?? "Its turn is over"
        }
    }

    @ViewBuilder
    private var shippedBody: some View {
        if let s = snapshot.shipped {
            WordReveal(s.sentence, size: 14, weight: .semibold)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private var dropBody: some View {
        switch snapshot.drop {
        case .none:
            DropZone(valid: true)
        case .zone(let valid):
            DropZone(valid: valid)
        case .unpaired:
            VStack(alignment: .leading, spacing: 3) {
                Text("Pair this Mac first")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
                Text("Builder in the menu bar, then Connect your phone")
                    .font(.system(size: 11))
                    .foregroundStyle(.white.opacity(0.62))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        case .sending:
            StatusWheel(rows: Self.dropRows(moves: nil), index: 0, alive: alive)
        case .progress(_, let step, let moves):
            StatusWheel(rows: Self.dropRows(moves: moves), index: min(step, 2), alive: alive)
        case .failed(let message):
            VStack(alignment: .leading, spacing: 3) {
                Text("That link did not land")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
                Text(message)
                    .font(.system(size: 11))
                    .foregroundStyle(.white.opacity(0.62))
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    static func dropRows(moves: Int?) -> [StatusWheel.Row] {
        [
            StatusWheel.Row(id: "sent", lead: "Sent", text: "on your board"),
            StatusWheel.Row(id: "reading", lead: "Reading", text: "what the post says"),
            StatusWheel.Row(
                id: "planned", lead: "Planned",
                text: moves.map { $0 == 1 ? "1 move to pick" : "\($0) moves to pick" } ?? "moves to pick"),
        ]
    }

    // MARK: The rail

    @ViewBuilder
    private func rail(_ g: IslandGeometry) -> some View {
        let open = isOpen && mode == .crew && snapshot.agents.count > 0
        AgentRail(
            faces: snapshot.agents.map {
                AgentRail.Face(id: $0.id, creature: $0.creature, hue: $0.hue, waiting: $0.waiting != nil)
            },
            open: open, alive: alive
        )
        .fixedSize()
        .offset(x: g.w / 2 + IslandLayout.railGap + 21, y: notch.height + 4)
        .frame(maxWidth: .infinity, alignment: .top)
        .allowsHitTesting(false)
    }
}

/// The drop zone: a dashed outline inside the island and one line of instruction.
private struct DropZone: View {
    let valid: Bool

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: valid ? "link" : "nosign")
                .font(.system(size: 12, weight: .semibold))
            Text(valid ? "Drop a link to make it a drop" : "That has no link in it")
                .font(.system(size: 13, weight: .semibold))
        }
        .foregroundStyle(.white.opacity(valid ? 0.92 : 0.55))
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(
                    .white.opacity(valid ? 0.45 : 0.18),
                    style: StrokeStyle(lineWidth: 1.2, dash: [5, 4])))
    }
}

/// The black shape and everything inside it, sized by ONE animatable geometry.
private struct IslandBody<Content: View, Face: View, Ears: View>: View, Animatable {
    var geometry: IslandGeometry
    let notch: NotchMetrics
    let content: Content
    let face: (CGFloat) -> Face
    let ears: Ears
    let wash: AnyShapeStyle?
    let washKey: String
    let contentKey: String
    let edge: Bool

    var animatableData: IslandGeometry {
        get { geometry }
        set { geometry = newValue }
    }

    var body: some View {
        let w = CGFloat(geometry.w)
        let h = CGFloat(geometry.h)
        // Size overshoots (that is the spring), the radius does not: an overshooting corner
        // reads as a bug. Clamped to the table's own range.
        let r = min(max(CGFloat(geometry.r), IslandLayout.collapsedRadius), IslandLayout.expandedRadius)
        let top: CGFloat = notch.hasNotch ? 0 : r
        let shape = IslandShape(bottomRadius: r, topRadius: top, flare: notch.hasNotch ? IslandLayout.flare : 0)
        let band = notch.height
        let earW = IslandLayout.ear
        // 0 collapsed to 1 open, read off the animated height, so everything that moves with
        // the opening rides the one spring. Clamped: the face should not fly past its seat.
        let t = min(1, max(0, (h - band) / 54))

        ZStack(alignment: .topLeading) {
            shape.fill(Color.black)
                .overlay { if edge { shape.stroke(Color.white.opacity(0.45), lineWidth: 1) } }
                .shadow(color: .black.opacity(0.35 * Double(t)), radius: 18, y: 8)

            if let wash {
                IslandShape(bottomRadius: r, topRadius: top, flare: 0)
                    .fill(wash)
                    .id(washKey)
                    .transition(.opacity.animation(IslandMotion.content.delayed(IslandMotion.incomingDelaySeconds)))
            }

            // The body under the band. Keyed by mode, so a change of mode swaps the layer:
            // the outgoing one is gone by 28% of the morph and scales up as it goes, the
            // incoming one starts at 34% on CONTENT and settles before the box does.
            ZStack {
                content
            }
            .padding(.leading, 64)
            .padding(.trailing, 18)
            .padding(.vertical, 6)
            .frame(width: w, height: max(0, h - band), alignment: .leading)
            .offset(y: band)
            .id(contentKey)
            .transition(IslandTransitions.content)

            // The face is ONE object: in the left ear when collapsed, in the body when open,
            // carried between the two by the same spring as the box (its place is a function
            // of the box's height), so it can never arrive before or after the shape does.
            face(24 + 8 * t)
                .position(
                    x: earW / 2 + 1 + (34 - earW / 2 - 1) * t,
                    y: band / 2 + ((band + (h - band) / 2) - band / 2) * t)

            // The right ear. The dots are the crew at a glance; open, the rail has them.
            ears
                .position(x: w - earW / 2 - 1, y: band / 2)
                .opacity(Double(max(0, 1 - 2 * t)))
        }
        .frame(width: w, height: h, alignment: .topLeading)
        .clipShape(IslandShape(bottomRadius: r, topRadius: top, flare: notch.hasNotch ? IslandLayout.flare : 0))
    }
}

enum IslandTransitions {
    /// In at 34% on CONTENT from 0.92 and 5 pt up; out by 28% scaling to 1.22.
    @MainActor
    static var content: AnyTransition {
        if IslandMotion.reduceMotion { return .opacity.animation(.easeOut(duration: 0.12)) }
        return .asymmetric(
            insertion: .modifier(
                active: ContentPhase(opacity: 0, scale: IslandMotion.incomingScale, rise: -IslandMotion.incomingRise),
                identity: ContentPhase(opacity: 1, scale: 1, rise: 0)
            ).animation(IslandMotion.content.delayed(IslandMotion.incomingDelaySeconds)),
            removal: .modifier(
                active: ContentPhase(opacity: 0, scale: IslandMotion.outgoingScale, rise: 0),
                identity: ContentPhase(opacity: 1, scale: 1, rise: 0)
            ).animation(.easeOut(duration: IslandMotion.outgoingSeconds)))
    }
}

struct ContentPhase: ViewModifier {
    let opacity: Double
    let scale: Double
    let rise: Double

    func body(content: Content) -> some View {
        content
            .opacity(opacity)
            .scaleEffect(scale)
            .offset(y: rise)
    }
}

/// The island's outline: square top flush with the screen edge (with a small concave flare
/// where it leaves the bezel), rounded bottom corners. With `topRadius` it is a plain pill,
/// for a screen with no notch.
public struct IslandShape: Shape {
    public var bottomRadius: CGFloat
    public var topRadius: CGFloat
    public var flare: CGFloat

    public init(bottomRadius: CGFloat, topRadius: CGFloat = 0, flare: CGFloat = 0) {
        self.bottomRadius = bottomRadius
        self.topRadius = topRadius
        self.flare = flare
    }

    public var animatableData: AnimatablePair<CGFloat, CGFloat> {
        get { AnimatablePair(bottomRadius, topRadius) }
        set {
            bottomRadius = newValue.first
            topRadius = newValue.second
        }
    }

    public func path(in rect: CGRect) -> Path {
        let r = min(bottomRadius, rect.height / 2, rect.width / 2)
        let t = min(topRadius, rect.height / 2, rect.width / 2)
        var p = Path()
        if flare > 0 && t == 0 {
            let f = min(flare, rect.height / 2)
            p.move(to: CGPoint(x: rect.minX - f, y: rect.minY))
            p.addLine(to: CGPoint(x: rect.maxX + f, y: rect.minY))
            p.addQuadCurve(
                to: CGPoint(x: rect.maxX, y: rect.minY + f),
                control: CGPoint(x: rect.maxX, y: rect.minY))
        } else {
            p.move(to: CGPoint(x: rect.minX + t, y: rect.minY))
            p.addLine(to: CGPoint(x: rect.maxX - t, y: rect.minY))
            if t > 0 {
                p.addArc(
                    center: CGPoint(x: rect.maxX - t, y: rect.minY + t), radius: t,
                    startAngle: .degrees(-90), endAngle: .degrees(0), clockwise: false)
            }
        }
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - r))
        p.addArc(
            center: CGPoint(x: rect.maxX - r, y: rect.maxY - r), radius: r,
            startAngle: .degrees(0), endAngle: .degrees(90), clockwise: false)
        p.addLine(to: CGPoint(x: rect.minX + r, y: rect.maxY))
        p.addArc(
            center: CGPoint(x: rect.minX + r, y: rect.maxY - r), radius: r,
            startAngle: .degrees(90), endAngle: .degrees(180), clockwise: false)
        if flare > 0 && t == 0 {
            let f = min(flare, rect.height / 2)
            p.addLine(to: CGPoint(x: rect.minX, y: rect.minY + f))
            p.addQuadCurve(
                to: CGPoint(x: rect.minX - f, y: rect.minY),
                control: CGPoint(x: rect.minX, y: rect.minY))
        } else {
            p.addLine(to: CGPoint(x: rect.minX, y: rect.minY + t))
            if t > 0 {
                p.addArc(
                    center: CGPoint(x: rect.minX + t, y: rect.minY + t), radius: t,
                    startAngle: .degrees(180), endAngle: .degrees(270), clockwise: false)
            }
        }
        p.closeSubpath()
        return p
    }
}
