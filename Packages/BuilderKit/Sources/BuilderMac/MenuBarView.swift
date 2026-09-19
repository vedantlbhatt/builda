import BuilderAnalysis
import BuilderModel
import BuilderUI
import SwiftUI

/// What drops down from the menu bar.
///
/// The ordering is still the whole design: **today, then what is running now, then recent
/// work, then the graph.** What changed (docs/motion.md): it speaks the island's language.
/// One number leads (today's active time, set still), the builder's face says the state,
/// what is running is the island's crew wheel inside the one aura on the screen, and a section
/// that arrives or leaves morphs on the island's springs rather than cutting. Pairing no longer
/// opens a sheet over everything: the phone row grows into the code.
struct MenuBarView: View {

    @Environment(AppStore.self) private var store
    @State private var showPairing = false

    private var face: FaceState {
        if store.islandAgents.contains(where: { $0.waiting != nil }) { return .waiting }
        if !store.islandAgents.isEmpty { return .working }
        return store.todayActiveSeconds > 0 ? .idle : .sleep
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PopoverHeader(
                todaySeconds: store.todayActiveSeconds, streakDays: store.streakDays, face: face,
                creature: UserDefaults.standard.string(forKey: "IslandCreature") ?? "bit")
                .padding(16)
            Divider().overlay(StripPalette.border(dark: true))

            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    now
                    AnalysisBlock(summary: store.analysis, dark: true)
                    recentSection
                    graphSection
                    phoneSection
                }
                .padding(16)
                .animation(IslandMotion.animation(IslandMotion.island), value: store.islandAgents.map(\.id))
                .animation(IslandMotion.animation(IslandMotion.island), value: showPairing)
                .animation(IslandMotion.animation(IslandMotion.island), value: store.liveSession?.id)
            }

            Divider().overlay(StripPalette.border(dark: true))
            footer
        }
        .frame(width: 420, height: 560)
        .background(StripPalette.card(dark: true))
        .preferredColorScheme(.dark)
        .onChange(of: store.pairing) { _, now in
            if now == .paired { showPairing = false }
        }
    }

    // MARK: Now

    @ViewBuilder
    private var now: some View {
        if !store.islandAgents.isEmpty {
            TimelineView(.periodic(from: .now, by: IslandController.wheelTurn)) { tl in
                NowCard(
                    agents: store.islandAgents,
                    strip: store.liveSession.flatMap { live in
                        live.strip.isEmpty ? nil
                            : (live.strip, live.marks, max(1, Int(live.wallSeconds * 1000)))
                    },
                    sinceStart: store.liveSession?.activeSeconds,
                    wheelIndex: Int(tl.date.timeIntervalSinceReferenceDate / IslandController.wheelTurn),
                    now: tl.date,
                    onOpen: { TerminalFocus.open($0) })
            }
            .transition(.section)
        } else if let live = store.liveSession {
            quietLive(live)
                .transition(.section)
        }
    }

    /// A session still open with no agent writing (idle inside its session threshold): no
    /// aura, because nothing is being driven, and no big number, because the header has one.
    private func quietLive(_ row: AppStore.SessionRow) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text("Open")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(StripPalette.textDim(dark: true))
                Text(row.repo)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(StripPalette.text(dark: true))
                Spacer()
                Text(duration(row.activeSeconds))
                    .font(.system(size: 11).monospacedDigit())
                    .foregroundStyle(StripPalette.textDim(dark: true))
            }
            if !row.strip.isEmpty {
                TimelineStripView(
                    columns: row.strip, marks: row.marks,
                    spanMs: max(1, Int(row.wallSeconds * 1000)), preset: .row, dark: true)
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.black))
    }

    // MARK: Recent

    private var recentSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle("Recent sessions")

            if store.recent.isEmpty {
                Text(store.scanning ? "Reading your history…" : "No sessions yet.")
                    .font(.system(size: 12))
                    .foregroundStyle(StripPalette.textDim(dark: true))
            }

            ForEach(store.recent) { row in
                sessionRow(row)
            }
        }
    }

    private func sessionRow(_ row: AppStore.SessionRow) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(row.headline)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(StripPalette.text(dark: true))
                    .lineLimit(1)
                Spacer(minLength: 8)
                Text(duration(row.activeSeconds))
                    .font(.system(size: 12).monospacedDigit())
                    .foregroundStyle(StripPalette.textDim(dark: true))
            }

            if !row.strip.isEmpty {
                TimelineStripView(
                    columns: row.strip, marks: row.marks,
                    spanMs: max(1, Int(row.wallSeconds * 1000)), preset: .row, dark: true)
            }

            HStack(spacing: 8) {
                Text(row.repo)
                Text("·")
                Text(relativeDate(row.startedAt))
                Spacer()
                Button {
                    store.share(sessionID: row.id)
                } label: {
                    Text("Share")
                        .font(.system(size: 11, weight: .medium))
                }
                .buttonStyle(.plain)
                .foregroundStyle(StripPalette.accent(dark: true))
            }
            .font(.system(size: 11))
            .foregroundStyle(StripPalette.textDim(dark: true))
        }
        .padding(.bottom, 4)
    }

    // MARK: Graph

    private var graphSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle("Last 17 weeks")
            ContributionGridView(days: store.graph, dark: true)
            HStack(spacing: 6) {
                Text("less")
                ForEach(0..<6, id: \.self) { level in
                    RoundedRectangle(cornerRadius: 2)
                        .fill(StripPalette.graphLevel(level, dark: true))
                        .frame(width: 9, height: 9)
                }
                Text("more")
                Spacer()
                Text("by active hours")
            }
            .font(.system(size: 10))
            .foregroundStyle(StripPalette.textDim(dark: true))
        }
    }

    // MARK: Phone

    /// The row, and when pairing, the row grown into the code: the same object saying more,
    /// rather than a sheet dropped over everything.
    @ViewBuilder
    private var phoneSection: some View {
        if showPairing {
            pairingCard
                .transition(.section)
        } else {
            PhoneConnectRow(
                status: store.pairing == .paired
                    ? .paired(label: store.pairedLabel ?? "this Mac")
                    : .notPaired,
                dark: true,
                onConnect: {
                    showPairing = true
                    store.startPairing()
                },
                onDisconnect: { store.disconnectPhone() })
            .transition(.section)
        }
    }

    private var pairingCard: some View {
        VStack(spacing: 14) {
            HStack {
                Text("Connect your phone")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(StripPalette.text(dark: true))
                Spacer()
                Button {
                    showPairing = false
                    store.cancelPairing()
                } label: {
                    Text("Close")
                        .font(.system(size: 11, weight: .medium))
                }
                .buttonStyle(.plain)
                .foregroundStyle(StripPalette.accent(dark: true))
            }

            switch store.pairing {
            case .idle, .starting:
                Text("Requesting a code…")
                    .font(.system(size: 12))
                    .foregroundStyle(StripPalette.textDim(dark: true))
                    .frame(height: 200)

            case .waiting(let userCode, let deepLink, let expiresAt):
                PairingQRView(userCode: userCode, payload: deepLink, dark: true, side: 200)
                Text("Waiting for your phone · code expires \(relativeTime(expiresAt))")
                    .font(.system(size: 11))
                    .foregroundStyle(StripPalette.textDim(dark: true))

            case .approved(let label):
                Text("Paired. This Mac is linked as “\(label)”.")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(StripPalette.text(dark: true))
                    .frame(height: 200)

            case .paired:
                Text("Phone connected.")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(StripPalette.text(dark: true))
                    .frame(height: 200)

            case .failed(let message):
                VStack(spacing: 10) {
                    Text(message)
                        .font(.system(size: 12))
                        .foregroundStyle(StripPalette.textDim(dark: true))
                        .multilineTextAlignment(.center)
                    Button {
                        store.startPairing()
                    } label: {
                        Text("Try again")
                            .font(.system(size: 11, weight: .medium))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(StripPalette.accent(dark: true))
                }
                .frame(height: 200)
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.black))
    }

    // MARK: Footer

    private var footer: some View {
        HStack {
            if store.isPaused {
                Text("paused")
            } else if store.scanning {
                Text("scanning…")
            } else if let last = store.lastScanAt {
                Text("updated \(relativeTime(last))")
            }
            Spacer()
            Text("\(store.totalSessions) sessions")
        }
        .font(.system(size: 10).monospacedDigit())
        .foregroundStyle(StripPalette.textDim(dark: true))
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    // MARK: Formatting

    private func duration(_ seconds: Double) -> String { IslandText.minutes(seconds) }

    private func relativeDate(_ ts: Double) -> String {
        let df = DateFormatter()
        df.doesRelativeDateFormatting = true
        df.dateStyle = .medium
        df.timeStyle = .short
        return df.string(from: Date(timeIntervalSince1970: ts))
    }

    private func relativeTime(_ date: Date) -> String {
        let f = RelativeDateTimeFormatter()
        f.unitsStyle = .abbreviated
        return f.localizedString(for: date, relativeTo: Date())
    }
}
