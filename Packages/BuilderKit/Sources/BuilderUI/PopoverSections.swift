import BuilderModel
import SwiftUI

// The menu bar popover in the island's language (docs/motion.md): one headline number set
// still, the builder's face with its state, and what is running now as the island shows it,
// a wheel of agents inside the one aura on the screen. Shared by the live popover
// (BuilderMac/MenuBarView) and the offscreen panel (MenuBarPanel), so the two cannot drift.

/// The top of the popover: the face, today's active time (the one number the popover leads
/// with, set still in tabular figures, never counted up), and the streak as a caption.
public struct PopoverHeader: View {
    let todaySeconds: Double
    let streakDays: Int
    let face: FaceState
    let creature: String
    let alive: Bool

    public init(todaySeconds: Double, streakDays: Int, face: FaceState, creature: String = "bit", alive: Bool = true) {
        self.todaySeconds = todaySeconds
        self.streakDays = streakDays
        self.face = face
        self.creature = creature
        self.alive = alive
    }

    public var body: some View {
        HStack(alignment: .center, spacing: 12) {
            CreatureFace(creature: creature, state: face, points: 32, alive: alive, seed: 11)
                .frame(width: 44, height: 44)
            VStack(alignment: .leading, spacing: 1) {
                Text(IslandText.minutes(todaySeconds))
                    .font(.system(size: 26, weight: .bold, design: .rounded).monospacedDigit())
                    .foregroundStyle(StripPalette.text(dark: true))
                    .contentTransition(.numericText())
                Text("active today")
                    .font(.system(size: 12))
                    .foregroundStyle(StripPalette.textDim(dark: true))
            }
            Spacer()
            if streakDays > 1 {
                Text("\(streakDays) day streak")
                    .font(.system(size: 11, weight: .medium).monospacedDigit())
                    .foregroundStyle(StripPalette.textDim(dark: true))
            }
        }
    }
}

/// What is running now: the island's crew wheel, the needs-you line, and the live session's
/// strip, in a black card. While an agent is driving (running, not waiting on you) the card
/// wears the aura, and nothing else in the popover ever does: one per screen, or the ring stops
/// meaning "this is what an agent is on".
public struct NowCard: View {
    let agents: [IslandAgent]
    let strip: (columns: [UInt8], marks: [(ms: Int, kind: StripMarkKind)], spanMs: Int)?
    let sinceStart: Double?
    let wheelIndex: Int
    let now: Date
    let alive: Bool
    let onOpen: ((IslandAgent) -> Void)?

    public init(
        agents: [IslandAgent],
        strip: (columns: [UInt8], marks: [(ms: Int, kind: StripMarkKind)], spanMs: Int)?,
        sinceStart: Double?, wheelIndex: Int, now: Date = Date(), alive: Bool = true,
        onOpen: ((IslandAgent) -> Void)? = nil
    ) {
        self.agents = agents
        self.strip = strip
        self.sinceStart = sinceStart
        self.wheelIndex = wheelIndex
        self.now = now
        self.alive = alive
        self.onOpen = onOpen
    }

    var driving: Bool { agents.contains { $0.waiting == nil && $0.activity != "Idle" } }

    public var body: some View {
        let waiting = agents.filter { $0.waiting != nil }
            .sorted { ($0.waiting?.since ?? 0) < ($1.waiting?.since ?? 0) }
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                AgentDots(hues: agents.map(\.hue), size: 6)
                Text(agents.count == 1 ? "1 agent running" : "\(agents.count) agents running")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(StripPalette.textDim(dark: true))
                Spacer()
                if let sinceStart {
                    Text(IslandText.minutes(sinceStart))
                        .font(.system(size: 11).monospacedDigit())
                        .foregroundStyle(StripPalette.textDim(dark: true))
                }
            }
            if let first = waiting.first, let w = first.waiting {
                Button {
                    onOpen?(first)
                } label: {
                    HStack(spacing: 8) {
                        Circle().fill(StripPalette.accent(dark: true)).frame(width: 6, height: 6)
                        Text("\(first.repo) is waiting on you")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(StripPalette.text(dark: true))
                        Spacer(minLength: 6)
                        Text(IslandText.waited(since: w.since, now: now.timeIntervalSince1970))
                            .font(.system(size: 11, weight: .semibold).monospacedDigit())
                            .foregroundStyle(StripPalette.accent(dark: true))
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .transition(.opacity.combined(with: .offset(y: -4)))
            }
            StatusWheel(
                rows: agents.map {
                    StatusWheel.Row(
                        id: $0.id, lead: $0.repo,
                        text: $0.waiting != nil ? "waiting on you" : ($0.activity ?? "working"),
                        tint: $0.hue)
                },
                index: agents.isEmpty ? 0 : wheelIndex % agents.count, rowHeight: 20, alive: alive)
            if let strip, !strip.columns.isEmpty {
                TimelineStripView(
                    columns: strip.columns, marks: strip.marks, spanMs: strip.spanMs,
                    preset: .row, dark: true)
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.black))
        .aura(driving && alive, radius: 16, width: 1.5)
        .animation(IslandMotion.animation(IslandMotion.island), value: waiting.map(\.id))
    }
}

/// The popover's section titles: small, spaced capitals, dim.
public struct SectionTitle: View {
    let text: String
    public init(_ text: String) { self.text = text }
    public var body: some View {
        Text(text.uppercased())
            .font(.system(size: 10, weight: .bold)).kerning(0.8)
            .foregroundStyle(StripPalette.textDim(dark: true))
    }
}

extension AnyTransition {
    /// A section arriving the island's way: late, from a touch small, settling on CONTENT; and
    /// leaving all at once in 120 ms. Sections morph in and out rather than cutting.
    @MainActor
    public static var section: AnyTransition {
        if IslandMotion.reduceMotion { return .opacity.animation(.easeOut(duration: 0.12)) }
        return .asymmetric(
            insertion: .opacity.combined(with: .scale(scale: IslandMotion.incomingScale, anchor: .top))
                .animation(IslandMotion.content.delayed(IslandMotion.incomingDelaySeconds)),
            removal: .opacity.animation(.easeOut(duration: Double(IslandMotion.exitMs) / 1000)))
    }
}
