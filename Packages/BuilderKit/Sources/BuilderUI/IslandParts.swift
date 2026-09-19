import BuilderModel
import SwiftUI

// The pieces the island is built from, each one the kit's component in SwiftUI. They live in
// BuilderUI rather than in the app so the popover, the island and an offscreen render all
// draw the same thing.

// MARK: - The status wheel

/// A vertical list whose active line is bright and centred, with its neighbours above and
/// below dimmer and smaller (±1 row: 0.34 opacity, 0.78 scale; ±2: 0.14, 0.66).
///
/// ONE value, the fractional index, drives every row's position, opacity and scale, and it
/// moves on the WHEEL spring. Rows cannot disagree about where the wheel is because none of
/// them has an opinion: each is a function of its distance from `position`.
public struct StatusWheel: View {

    public struct Row: Identifiable, Equatable, Sendable {
        public let id: String
        public let lead: String
        public let text: String?
        public let tint: Color?

        public init(id: String, lead: String, text: String? = nil, tint: Color? = nil) {
            self.id = id
            self.lead = lead
            self.text = text
            self.tint = tint
        }
    }

    let rows: [Row]
    let index: Int
    let rowHeight: CGFloat
    let alive: Bool

    public init(rows: [Row], index: Int, rowHeight: CGFloat = 22, alive: Bool = true) {
        self.rows = rows
        self.index = index
        self.rowHeight = rowHeight
        self.alive = alive
    }

    public var body: some View {
        WheelRows(rows: rows, position: Double(index), rowHeight: rowHeight, alive: alive)
            .animation(IslandMotion.animation(IslandMotion.wheel), value: index)
            .frame(height: rowHeight * 3)
            .clipped()
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(rows.indices.contains(index) ? Self.spoken(rows[index]) : ""))
    }

    static func spoken(_ r: Row) -> String { [r.lead, r.text].compactMap { $0 }.joined(separator: ", ") }
}

private struct WheelRows: View, Animatable {
    let rows: [StatusWheel.Row]
    var position: Double
    let rowHeight: CGFloat
    let alive: Bool

    var animatableData: Double {
        get { position }
        set { position = newValue }
    }

    var body: some View {
        ZStack(alignment: .leading) {
            ForEach(Array(rows.enumerated()), id: \.element.id) { i, row in
                let d = Double(i) - position
                let active = abs(d) < 0.5
                WheelLine(row: row, active: active, shimmer: active && alive)
                    .scaleEffect(IslandMotion.wheelScale(at: d), anchor: .leading)
                    .opacity(IslandMotion.wheelOpacity(at: d))
                    .offset(y: CGFloat(d) * rowHeight)
                    .frame(height: rowHeight)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

private struct WheelLine: View {
    let row: StatusWheel.Row
    let active: Bool
    let shimmer: Bool

    var body: some View {
        let line = HStack(spacing: 6) {
            if let tint = row.tint {
                RoundedRectangle(cornerRadius: 1.5)
                    .fill(tint)
                    .frame(width: 6, height: 6)
            }
            Text(row.lead)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.white)
            if let text = row.text {
                Text(text)
                    .font(.system(size: 13, weight: .regular))
                    .foregroundStyle(.white.opacity(0.72))
            }
        }
        .lineLimit(1)
        .truncationMode(.tail)
        if shimmer {
            // The sweep sized to the line, the two as one layer, masked by the line: the light
            // exists only where there are letters. A sweep in a ZStack beside the line widened
            // the row, so the centred mask cut the line in half (caught in a recorded frame).
            // A hairline beside the rail in other frames was NOT this: it is one column the
            // capture leaves at 62% alpha where a black edge lands between pixels, invisible
            // on screen, and the stills in shots/ are flattened onto black for that reason.
            line
                .overlay { ShimmerSweep() }
                .compositingGroup()
                .mask { line }
        } else {
            line
        }
    }
}

/// The light sweep across the active line's letters: a narrow bright band travelling left to
/// right once every `IslandMotion.shimmerMs`, masked by the text, so it lives on the letters and
/// never on the black around them.
public struct ShimmerSweep: View {
    public init() {}

    public var body: some View {
        // 20 frames a second: the band is soft and travels a line in 1.9 s, so it moves a few
        // points a frame, and the open crew is the one state that draws continuously.
        TimelineView(LoopSchedule(fps: 20, paused: IslandMotion.reduceMotion)) { tl in
            GeometryReader { geo in
                let period = Double(IslandMotion.shimmerMs) / 1000
                let phase = tl.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: period) / period
                let band = max(40, geo.size.width * 0.35)
                let x = -band + (geo.size.width + 2 * band) * phase
                LinearGradient(
                    colors: [.white.opacity(0), .white.opacity(0.9), .white.opacity(0)],
                    startPoint: .leading, endPoint: .trailing)
                    .frame(width: band)
                    .offset(x: x)
            }
        }
        .allowsHitTesting(false)
    }
}

// MARK: - A sentence, a word at a time

/// The summary line arriving a word at a time, 55 ms apart, each word rising 5 pt on POP:
/// slow enough to read as speech, fast enough that nobody waits for it.
public struct WordReveal: View {
    let text: String
    let size: CGFloat
    let weight: Font.Weight
    @State private var shown = false

    public init(_ text: String, size: CGFloat = 13, weight: Font.Weight = .semibold) {
        self.text = text
        self.size = size
        self.weight = weight
    }

    public var body: some View {
        let words = text.split(separator: " ").map(String.init)
        HStack(spacing: size * 0.28) {
            ForEach(Array(words.enumerated()), id: \.offset) { i, w in
                Text(w)
                    .font(.system(size: size, weight: w == "·" ? .regular : weight))
                    .foregroundStyle(w == "·" ? .white.opacity(0.4) : .white)
                    .opacity(shown ? 1 : 0)
                    .offset(y: shown ? 0 : IslandMotion.incomingRise)
                    .animation(
                        IslandMotion.reduceMotion
                            ? .easeOut(duration: 0.12)
                            : IslandMotion.pop.delayed(Double(i * IslandMotion.wordStaggerMs) / 1000),
                        value: shown)
            }
        }
        .lineLimit(1)
        .fixedSize()
        .onAppear { shown = true }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(text))
    }
}

// MARK: - Agent dots and the agent rail

/// The right ear: one dot per running agent in a 2x2 cluster, each in its session's hue. A
/// fifth agent and beyond is not a fifth dot; the cluster is a glance, and the rail and the
/// wheel have the whole crew.
public struct AgentDots: View {
    let hues: [Color]
    let size: CGFloat

    public init(hues: [Color], size: CGFloat = 7) {
        self.hues = hues
        self.size = size
    }

    public var body: some View {
        let cells = Array(hues.prefix(4))
        Grid(horizontalSpacing: size * 0.45, verticalSpacing: size * 0.45) {
            GridRow {
                dot(cells, 0)
                dot(cells, 1)
            }
            GridRow {
                dot(cells, 2)
                dot(cells, 3)
            }
        }
    }

    @ViewBuilder
    private func dot(_ cells: [Color], _ i: Int) -> some View {
        if i < cells.count {
            RoundedRectangle(cornerRadius: size * 0.3)
                .fill(cells[i])
                .frame(width: size, height: size)
                .transition(.scale(scale: 0.4).combined(with: .opacity))
        } else {
            // An empty socket, barely there: the cluster keeps its shape as agents come and go.
            RoundedRectangle(cornerRadius: size * 0.3)
                .stroke(.white.opacity(0.10), lineWidth: 1)
                .frame(width: size, height: size)
        }
    }
}

/// The stack of agent faces beside the island: a SEPARATE surface, not part of the island, so
/// it arrives and leaves on its own timing, which is what makes it read as a second object
/// rather than the panel growing sideways. It scales in from its left edge on ISLAND; the faces
/// pop in 60 ms apart on POP and all leave together.
public struct AgentRail: View {

    public struct Face: Identifiable, Equatable {
        public let id: String
        public let creature: String
        public let hue: Color
        public let waiting: Bool

        public init(id: String, creature: String, hue: Color, waiting: Bool) {
            self.id = id
            self.creature = creature
            self.hue = hue
            self.waiting = waiting
        }
    }

    let faces: [Face]
    let open: Bool
    let alive: Bool

    public init(faces: [Face], open: Bool, alive: Bool = true) {
        self.faces = faces
        self.open = open
        self.alive = alive
    }

    public var body: some View {
        VStack(spacing: 4) {
            ForEach(Array(faces.prefix(6).enumerated()), id: \.element.id) { i, f in
                RailFace(face: f, index: i, open: open, alive: alive)
            }
        }
        .padding(6)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(.black))
        .scaleEffect(open ? 1 : 0.9, anchor: .leading)
        .offset(x: open ? 0 : -14)
        .opacity(open ? 1 : 0)
        .animation(open ? IslandMotion.animation(IslandMotion.island) : .easeOut(duration: Double(IslandMotion.exitMs) / 1000), value: open)
    }
}

private struct RailFace: View {
    let face: AgentRail.Face
    let index: Int
    let open: Bool
    let alive: Bool

    var body: some View {
        // Alive only while the rail is out: a hidden face breathing is a core's percent spent
        // on nothing (MEASURED, crew collapsed 6.3% against idle 4.3% before this).
        CreatureFace(
            creature: face.creature, state: face.waiting ? .waiting : .working, points: 18,
            ink: face.hue, glow: face.waiting, alive: alive && open, seed: UInt64(index + 7))
            .frame(width: 30, height: 30)
            .scaleEffect(open ? 1 : 0.6)
            .opacity(open ? 1 : 0)
            .animation(
                open
                    ? IslandMotion.pop.delayed(Double(index * IslandMotion.railStaggerMs) / 1000)
                    : .easeOut(duration: Double(IslandMotion.exitMs) / 1000),
                value: open)
    }
}

// MARK: - The aura

/// The ring that says "an agent is driving this": ONE HUE, the state's own, a light travelling
/// round the edge with a tail behind it over a faint ring of the same colour. It turns once every
/// 5 s, linear, and fades in over 420 ms. ONE per screen at most: a second aura is two things
/// claiming to be the one an agent is on, and the ring stops meaning anything.
///
/// It was the kit's iridescent ring first, pink to violet to blue to green to gold. A multi hue
/// ring turning round a card is the most generated looking thing a screen can wear, and here a
/// colour already means a state, so five at once said five things. The phone's `Aura.tsx` made
/// the same change; both read `DesignTokens.Spectrum.island`.
public struct AuraRing: ViewModifier {
    let active: Bool
    let radius: CGFloat
    let width: CGFloat
    let color: Color

    public init(active: Bool, radius: CGFloat, width: CGFloat = 1.5, color: Color = AuraRing.working) {
        self.active = active
        self.radius = radius
        self.width = width
        self.color = color
    }

    public func body(content: Content) -> some View {
        content.overlay {
            if active {
                TimelineView(LoopSchedule(fps: 30, paused: IslandMotion.reduceMotion)) { tl in
                    let turn = Double(IslandMotion.auraTurnMs) / 1000
                    let angle = tl.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: turn) / turn * 360
                    ZStack {
                        RoundedRectangle(cornerRadius: radius, style: .continuous)
                            .strokeBorder(color.opacity(0.16), lineWidth: width)
                        RoundedRectangle(cornerRadius: radius, style: .continuous)
                            .strokeBorder(
                                AngularGradient(
                                    gradient: Gradient(stops: [
                                        .init(color: color.opacity(0), location: 0),
                                        .init(color: color.opacity(0), location: 0.45),
                                        .init(color: color.opacity(0.4), location: 0.82),
                                        .init(color: color, location: 0.985),
                                        .init(color: color.opacity(0), location: 1),
                                    ]),
                                    center: .center, angle: .degrees(angle)),
                                lineWidth: width)
                    }
                }
                .transition(.opacity.animation(.easeInOut(duration: Double(IslandMotion.auraFadeMs) / 1000)))
                .allowsHitTesting(false)
            }
        }
    }

    /// Working's colour, the default: an agent driving something is working.
    public static let working = island("working")

    /// An island state's colour from the generated tokens.
    public static func island(_ state: String) -> Color {
        StripPalette.color(DesignTokens.Spectrum.island[state] ?? DesignTokens.Spectrum.island["working"]!)
    }
}

extension View {
    /// Mark what an agent is driving right now. One per screen.
    public func aura(_ active: Bool, radius: CGFloat, width: CGFloat = 1.5, color: Color = AuraRing.working) -> some View {
        modifier(AuraRing(active: active, radius: radius, width: width, color: color))
    }
}
