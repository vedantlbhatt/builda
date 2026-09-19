import AppKit
import BuilderSync
import BuilderUI
import Observation
import SwiftUI

/// The island's brain: what it shows, whether it is open, and what the pointer and a dragged
/// link do to it.
///
/// Every visible change goes through `apply`, inside ONE `withAnimation` on the ISLAND spring,
/// so the shape, the face flying between ear and body, and the content swap are one morph
/// with one clock. Nothing here animates anything on its own.
@Observable
@MainActor
final class IslandController {

    // MARK: What the view reads

    private(set) var snapshot = IslandSnapshot()
    private(set) var expanded = false
    private(set) var wheelIndex = 0
    private(set) var placement: NotchPlacement?
    var notch: NotchMetrics { placement?.metrics ?? .macBookPro14 }
    /// Which creature is the builder's face. Bit, the brand, unless the defaults say otherwise
    /// (`defaults write com.vedantlbhatt.Builder.Mac IslandCreature fox`).
    let creature = UserDefaults.standard.string(forKey: "IslandCreature") ?? "bit"

    // MARK: Hooks the app fills in

    var openPopover: (() -> Void)?
    var openAgent: ((IslandAgent) -> Void)?
    var isPaired: (() async -> Bool)?
    var shareDrop: ((DropLink.Shared) async throws -> SyncClient.DropState)?
    var pollDrop: ((String) async throws -> SyncClient.DropState)?

    // MARK: Inputs

    private var agents: [IslandAgent] = []
    private var ranToday = false
    private var shipped: IslandShipped?
    private var shippedQueue: [IslandShipped] = []
    private var drop: DropPhase?
    private var filming: IslandFilming?
    private var away: IslandAway?
    /// Shipped beats that played while nobody was at the Mac, for the away beat.
    private var missed: [IslandShipped] = []
    /// The longest idle seen since the last time someone was at the Mac.
    private var idleRun: Double = 0
    private var awayTask: Task<Void, Never>?

    // MARK: Pointer and beats

    private var hovering = false
    private var pinned = false
    /// Set after a click closed a pinned island, so the pointer still resting on it does not
    /// open it again until it has left once.
    private var suppressHoverUntilExit = false
    private var beatUntil: Date?
    private var seenWaiting = Set<String>()
    private var primed = false
    private var hoverTask: Task<Void, Never>?
    private var collapseTask: Task<Void, Never>?
    private var beatTask: Task<Void, Never>?
    private var shippedTask: Task<Void, Never>?
    private var dropTask: Task<Void, Never>?
    private var wheelTimer: Timer?
    private var pollTimer: Timer?
    private var monitors: [Any] = []
    private var screenObserver: NSObjectProtocol?

    private var panel: IslandPanel?
    private(set) var demo: IslandDemo?

    // MARK: Constants (each one a judgement about a person's pointer, not a measurement)

    /// How long the pointer rests on the ears before the island opens. The ears sit in the
    /// menu bar, so a pointer on its way to a menu crosses them; opening on contact would open
    /// the island every time someone reached for the Wi-Fi menu. UNMEASURED JUDGEMENT CALL.
    static let hoverOpenDelay: Double = 0.18
    /// The brief's ~400 ms: long enough to cross the gap to the rail, short enough to feel let go.
    static let hoverCloseDelay: Double = 0.4
    /// A new "needs you" opens the island on its own for this long, once per wait.
    static let needsYouBeat: Double = 3.5
    /// A wait older than this when first seen is not news. Two daemon ticks (30 s each) plus
    /// the 2 s debounce: a wait the daemon could have seen begin, it did.
    static let freshWait: Double = 62
    /// The brief's ~4 s for the shipped sentence: 55 ms a word reads a sentence in under one.
    static let shippedBeat: Double = 4.0
    /// Between turns of the crew wheel while open.
    static let wheelTurn: Double = 2.6

    // MARK: Lifecycle

    func start() {
        guard panel == nil else { return }
        guard let placement = NotchPlacement.current() else { return }
        self.placement = placement
        let size = IslandLayout.canvas(notch: placement.metrics)
        let panel = IslandPanel(size: size)
        let root = IslandRoot(controller: self)
        let container = IslandContainerView(controller: self, root: root)
        panel.contentView = container
        self.panel = panel
        position()
        panel.orderFrontRegardless()

        monitors.append(
            NSEvent.addGlobalMonitorForEvents(matching: [.mouseMoved, .leftMouseDragged]) { [weak self] _ in
                MainActor.assumeIsolated { self?.track() }
            } as Any)
        monitors.append(
            NSEvent.addLocalMonitorForEvents(matching: [.mouseMoved, .leftMouseDragged]) { [weak self] e in
                MainActor.assumeIsolated { self?.track() }
                return e
            } as Any)
        // A safety net for the monitors: a drag from another app can starve them, and a
        // pointer that leaves while the app is busy must still let the island close. Ten
        // times a second is one property read and a rect test.
        pollTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.track() }
        }
        wheelTimer = Timer.scheduledTimer(withTimeInterval: Self.wheelTurn, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.turnWheel() }
        }
        screenObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.screensChanged() }
        }
    }

    func stop() {
        panel?.orderOut(nil)
        panel = nil
        for m in monitors { NSEvent.removeMonitor(m) }
        monitors = []
        pollTimer?.invalidate()
        wheelTimer?.invalidate()
        if let screenObserver { NotificationCenter.default.removeObserver(screenObserver) }
        screenObserver = nil
        demo?.stop()
        demo = nil
    }

    var isRunning: Bool { panel != nil }

    private func screensChanged() {
        guard let p = NotchPlacement.current() else { return }
        if p != placement {
            placement = p
            position()
        }
    }

    private func position() {
        guard let panel, let placement else { return }
        let size = IslandLayout.canvas(notch: placement.metrics)
        panel.setFrame(
            NSRect(x: placement.centerX - size.width / 2, y: placement.top - size.height,
                   width: size.width, height: size.height),
            display: true)
    }

    // MARK: Data in

    /// The daemon's view of what is running. Called after every pass.
    func update(agents: [IslandAgent], ranToday: Bool) {
        guard demo == nil else { return }
        self.agents = agents
        self.ranToday = ranToday
        // A wait that is new since the last pass gets a beat: the island opens on its own for a
        // few seconds, once. The same wait on the next pass is not news.
        let waiting = agents.filter { $0.waiting != nil }
        let waitingNow = Set(waiting.map(\.id))
        let now = Date().timeIntervalSince1970
        // Only a wait that BEGAN recently is news: the first pass after launch finds waits that
        // are hours old, and opening the island for those is the backfill mistake CLAUDE.md
        // records (71 historical sessions announced at once), in miniature.
        let fresh = waiting.filter {
            !seenWaiting.contains($0.id) && now - ($0.waiting?.since ?? 0) < Self.freshWait
        }
        seenWaiting = waitingNow
        if primed && !fresh.isEmpty { beat(Self.needsYouBeat) }
        // A demo the worker started since the last pass is news too, once: a simulator just
        // booted headless and the fans may be the first sign of it.
        noticeReturn()
        let film = IslandFilming.read(queueRoot: Self.demoQueue)
        if primed, film != nil, filming == nil { beat(Self.filmingBeat) }
        filming = film
        primed = true
        apply()
    }

    // MARK: While you were away

    /// Idle this long when a shipped beat plays and nobody saw it. Two minutes: the screen dims at
    /// about that on a default MacBook, and a person reading something is rarely still for longer.
    static let unwatchedIdle: Double = 120
    /// Away this long before the return gets a beat: an hour, the phone's `AWAY_MIN_MS`, so the two
    /// agree about what "away" means.
    static let awayIdle: Double = 3600
    /// Idle under this means someone is at the Mac now.
    static let backIdle: Double = 5
    /// How long the away beat stays open: one sentence of five or six words, read once.
    static let awayBeat: Double = 6

    /// Seconds since the last keyboard, mouse or trackpad event, from the HID system. It needs no
    /// permission (it is a number, not the events), and it is what the screen saver reads.
    static func idleSeconds() -> Double {
        CGEventSource.secondsSinceLastEventType(.hidSystemState, eventType: CGEventType(rawValue: ~0)!)
    }

    /// Called every pass: once someone is back after an hour or more away, say what finished.
    private func noticeReturn() {
        let idle = Self.idleSeconds()
        if idle >= Self.backIdle {
            idleRun = max(idleRun, idle)
            return
        }
        let wasAway = idleRun >= Self.awayIdle
        idleRun = 0
        guard wasAway, let summary = IslandAway.of(missed) else {
            if !wasAway { missed.removeAll() }
            return
        }
        missed.removeAll()
        away = summary
        apply()
        awayTask?.cancel()
        awayTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(Self.awayBeat * 1e9))
            guard let self, !Task.isCancelled else { return }
            self.away = nil
            self.apply()
        }
    }

    /// The ship kit worker's queue (`capture/shipkit/queue.py`): `BUILDER_DEMOS_DIR/queue` when
    /// set, as the worker reads it, else `~/.builder/demos/queue`.
    static var demoQueue: URL {
        if let dir = ProcessInfo.processInfo.environment["BUILDER_DEMOS_DIR"], !dir.isEmpty {
            return URL(fileURLWithPath: dir).appendingPathComponent("queue", isDirectory: true)
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".builder/demos/queue", isDirectory: true)
    }

    /// How long the island opens when a demo starts filming: the shipped beat's length, since
    /// it is one sentence read once.
    static let filmingBeat: Double = shippedBeat

    /// A session finished: the shipped beat.
    func showShipped(_ s: IslandShipped) {
        guard demo == nil else { return }
        // Nobody at the Mac to see it: it plays anyway, and is also kept for the away beat.
        if Self.idleSeconds() >= Self.unwatchedIdle { missed.append(s) }
        if shipped != nil {
            shippedQueue.append(s)
            return
        }
        shipped = s
        apply()
        shippedTask?.cancel()
        shippedTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(Self.shippedBeat * 1e9))
            guard let self, !Task.isCancelled else { return }
            self.shipped = nil
            self.apply()
            if !self.shippedQueue.isEmpty { self.showShipped(self.shippedQueue.removeFirst()) }
        }
    }

    private func beat(_ seconds: Double) {
        beatUntil = Date().addingTimeInterval(seconds)
        beatTask?.cancel()
        beatTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1e9))
            guard let self, !Task.isCancelled else { return }
            self.beatUntil = nil
            self.apply()
        }
    }

    // MARK: The one place anything changes

    private func apply() {
        let next = IslandSnapshot(agents: agents, ranToday: ranToday, shipped: shipped, drop: drop, filming: filming, away: away)
        let mode = next.mode
        let hoverOpens = (mode == .crew || mode == .needsYou || mode == .filming) && hovering
        let open =
            mode == .drop || mode == .shipped || mode == .away
            || (mode != .idle && (pinned || hoverOpens || (beatUntil.map { $0 > Date() } ?? false)))
        if mode == .idle { pinned = false }
        guard next != snapshot || open != expanded else { return }
        withAnimation(IslandMotion.animation(IslandMotion.island)) {
            snapshot = next
            expanded = open
        }
        if let rows = Optional(snapshot.agents.count), rows > 0, wheelIndex >= rows { wheelIndex = 0 }
    }

    /// Demo mode sets both halves directly.
    func applyDemo(_ s: IslandSnapshot, expanded open: Bool) {
        withAnimation(IslandMotion.animation(IslandMotion.island)) {
            snapshot = s
            expanded = open
        }
    }

    private func turnWheel() {
        guard expanded, snapshot.mode == .crew, snapshot.agents.count > 1 else { return }
        withAnimation(IslandMotion.animation(IslandMotion.wheel)) {
            wheelIndex = (wheelIndex + 1) % snapshot.agents.count
        }
    }

    func startDemo(shotsDir: String?) {
        let d = IslandDemo(controller: self, shotsDir: shotsDir)
        demo = d
        d.start()
    }

    // MARK: The pointer

    /// Where the island is on screen now, for hit testing: its target shape (what it is
    /// becoming), with a little slack, because a pointer that has just made it open is by
    /// definition at its old edge.
    func islandRect(dragging: Bool = false) -> NSRect? {
        guard let placement else { return nil }
        let g = IslandLayout.geometry(mode: snapshot.mode, expanded: expanded, notch: placement.metrics)
        var r = placement.rect(for: g).insetBy(dx: -IslandLayout.flare, dy: 0)
        // A dragged link is aimed at the notch from somewhere below it; a generous target
        // under the ears is what makes it land. UNMEASURED JUDGEMENT CALL: 40 pt either side,
        // 36 below.
        if dragging { r = r.insetBy(dx: -40, dy: 0).union(r.offsetBy(dx: 0, dy: -36)) }
        return r
    }

    func track() {
        guard let panel else { return }
        let p = NSEvent.mouseLocation
        let dragging = NSEvent.pressedMouseButtons & 1 != 0
        let inside = islandRect(dragging: dragging)?.contains(p) ?? false
        // Mouse events only where the island is: everywhere else the menu bar is the menu bar.
        if panel.ignoresMouseEvents == inside { panel.ignoresMouseEvents = !inside }
        let over = inside && !dragging
        if over { pointerEntered() } else { pointerLeft() }
    }

    /// Called on every sample while the pointer is over the island, so it must be idempotent:
    /// a pending open is left to finish. (The first version restarted the delay on every call,
    /// and with the monitors and the 10 Hz poll both calling, a moving pointer never opened it.)
    private func pointerEntered() {
        collapseTask?.cancel()
        collapseTask = nil
        guard !hovering, hoverTask == nil, !suppressHoverUntilExit else { return }
        hoverTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(Self.hoverOpenDelay * 1e9))
            guard let self, !Task.isCancelled else { return }
            self.hoverTask = nil
            self.hovering = true
            self.apply()
        }
    }

    private func pointerLeft() {
        hoverTask?.cancel()
        hoverTask = nil
        suppressHoverUntilExit = false
        guard hovering, collapseTask == nil else { return }
        collapseTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(Self.hoverCloseDelay * 1e9))
            guard let self, !Task.isCancelled else { return }
            self.collapseTask = nil
            self.hovering = false
            self.apply()
        }
    }

    /// A click on the island. Idle, it opens the menu bar popover (the island has nothing to
    /// say, so the click goes where there is something). Otherwise it pins the island open, and
    /// a second click lets it go.
    func clicked() {
        switch snapshot.mode {
        case .idle:
            openPopover?()
        case .shipped, .drop, .filming, .away:
            break
        case .crew, .needsYou:
            pinned.toggle()
            if !pinned {
                hovering = false
                suppressHoverUntilExit = true
            }
            apply()
        }
    }

    // MARK: A dragged link

    func dragEntered(hasLink: Bool) {
        if case .sending = drop { return }
        if case .progress = drop { return }
        dropTask?.cancel()
        drop = .zone(valid: hasLink)
        apply()
    }

    func dragExited() {
        if case .zone = drop {
            drop = nil
            apply()
        }
    }

    func dropped(payload: String) {
        guard let shared = DropLink.normalize(payload) else {
            hold(.failed("There is no link in that"), for: 2.5)
            return
        }
        dropTask?.cancel()
        dropTask = Task { [weak self] in
            guard let self else { return }
            guard await self.isPaired?() == true else {
                self.hold(.unpaired, for: 3.0)
                return
            }
            self.drop = .sending(url: shared.url)
            self.apply()
            do {
                guard let share = self.shareDrop, let poll = self.pollDrop else { return }
                var state = try await share(shared)
                self.drop = .progress(id: state.id, step: Self.step(state), moves: state.moves)
                self.apply()
                // The Mac reads the post and Claude plans it (`python -m drops watch`), which
                // takes seconds when that runner is up and never happens when it is not. Poll
                // for a minute and a half; if nothing has read it by then the card is on the
                // board saying "waiting for your Mac", which is the true state, and the island
                // lets go.
                let deadline = Date().addingTimeInterval(90)
                var lastStep = Self.step(state)
                var sameSince = Date()
                while !Task.isCancelled, Date() < deadline {
                    if state.status == "planned" || state.status == "refused" { break }
                    if lastStep == 0, Date().timeIntervalSince(sameSince) > 15 { break }
                    try await Task.sleep(nanoseconds: 2_000_000_000)
                    state = try await poll(state.id)
                    let step = Self.step(state)
                    if step != lastStep {
                        lastStep = step
                        sameSince = Date()
                    }
                    self.drop = .progress(id: state.id, step: step, moves: state.moves)
                    self.apply()
                }
                if state.status == "refused" {
                    self.hold(.failed(Self.refusalWords(state.refusal)), for: 3.5)
                } else {
                    self.hold(self.drop ?? .progress(id: state.id, step: lastStep, moves: state.moves), for: 2.5)
                }
            } catch {
                let message = (error as? SyncClient.SyncError)?.description ?? error.localizedDescription
                self.hold(.failed(String(message.prefix(80))), for: 3.5)
            }
        }
    }

    private func hold(_ phase: DropPhase, for seconds: Double) {
        drop = phase
        apply()
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1e9))
            guard let self, self.drop == phase else { return }
            self.drop = nil
            self.apply()
        }
    }

    /// drop_status to the wheel's step: waiting is Sent, resolving is Reading, planned is
    /// Planned (`spec/drops.v1.json`).
    static func step(_ s: SyncClient.DropState) -> Int {
        switch s.status {
        case "resolving": return 1
        case "planned": return 2
        default: return 0
        }
    }

    static func refusalWords(_ code: String?) -> String {
        switch code {
        case nil: return "It could not be read"
        case "url_unsupported": return "That is not a link it can read"
        case "no_text": return "The post had nothing to read"
        default: return code!.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }
}

/// The SwiftUI root inside the panel.
struct IslandRoot: View {
    let controller: IslandController

    var body: some View {
        TimelineView(.periodic(from: .now, by: 15)) { tl in
            IslandView(
                snapshot: controller.snapshot, expanded: controller.expanded,
                notch: controller.notch, wheelIndex: controller.wheelIndex,
                creature: controller.creature, alive: true, now: max(tl.date, Date()),
                onOpenAgent: { controller.openAgent?($0) },
                edge: ProcessInfo.processInfo.environment["BUILDER_ISLAND_EDGE"] == "1")
                .contentShape(Rectangle())
                .onTapGesture { controller.clicked() }
        }
        .padding(.top, controller.notch.hasNotch ? 0 : 0)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
}
