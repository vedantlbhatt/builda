import AppKit
import BuilderAnalysis
import BuilderIngest
import BuilderModel
import BuilderSchema
import BuilderSQLite
import BuilderSync
import BuilderUI
import SwiftUI
import UserNotifications

/// The menu bar agent.
///
/// `NSStatusItem` + `NSPopover` + an `AppDelegate`, deliberately NOT `MenuBarExtra`. The
/// SwiftUI scene has no supported API to present or dismiss its own window
/// programmatically, and this app has to open the popover from a notification tap and
/// from a login-item launch. It also needs a right-click menu for Quit and Pause that
/// does not fight the popover.
///
/// **No App Sandbox.** None of the four roots Builder reads are TCC-protected:
/// `~/.claude`, `~/.codex` and `~/.cursor` are ordinary home dotfolders, and Cursor's
/// application-support directory is a third-party vendor folder outside the Full Disk
/// Access set. An unsandboxed, notarized app reads them with zero prompts — which is the
/// only way "your history, already populated, before we ask you for anything" is
/// achievable. A sandboxed build would need a folder-picker dance on first launch, and
/// the first thing the user would see is a permission dialog rather than their own work.
@main
struct BuilderMacApp {
    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        // LSUIElement in Info.plist keeps us out of the Dock; this matches it at runtime
        // so the app never steals focus when the daemon wakes.
        app.setActivationPolicy(.accessory)
        app.run()
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {

    private var statusItem: NSStatusItem!
    private var popover: NSPopover!
    private let store = AppStore()
    private let island = IslandController()

    /// The setting behind "Show island at the notch". On unless turned off.
    static let showIslandKey = "ShowIslandAtNotch"
    private var showIsland: Bool {
        get { UserDefaults.standard.object(forKey: Self.showIslandKey) as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: Self.showIslandKey) }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSLog("builder: launched, bundle=%@", Bundle.main.bundleIdentifier ?? "none")
        let env = ProcessInfo.processInfo.environment
        // A copy of the store to run against, so a development build never migrates the
        // real one forward (state.sqlite is forward-only, and an older build refuses a newer
        // store rather than dropping columns it does not know).
        if let dir = env["BUILDER_STORE_DIR"] { StorePaths.root = dir }
        setUpStatusItem()
        setUpPopover()
        setUpIsland()
        recordIfAsked(env)

        // BUILDER_ISLAND_DEMO=1 cycles the island through every mode on fixture data, for
        // screenshots and recordings. It leaves the store alone: a demo should neither read
        // nor announce anyone's sessions.
        if env["BUILDER_ISLAND_DEMO"] == "1" {
            island.start()
            island.startDemo(shotsDir: env["BUILDER_ISLAND_RECORD"])
            return
        }
        // A development run against a copied store neither asks for nor sends notifications:
        // its sessions are real, and a banner about one would be a real banner.
        if !AppStore.keychainOff { requestNotificationPermission() }
        store.start()
        fakeDropIfAsked(env)
    }

    /// `BUILDER_ISLAND_FAKE_DROP=<text>`: three seconds after launch, a drag carrying `<text>`
    /// hovers over the notch for two seconds and is dropped, through the same controller calls
    /// the drop target makes. A real drag cannot be synthesised without the Accessibility
    /// permission; this runs everything after the pasteboard. Point BUILDER_API_URL at a local
    /// server when using it: a paired Mac posts a real drop.
    private func fakeDropIfAsked(_ env: [String: String]) {
        guard let text = env["BUILDER_ISLAND_FAKE_DROP"] else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
            self?.island.dragEntered(hasLink: DropLink.normalize(text) != nil)
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
                self?.island.dropped(payload: text)
            }
        }
    }

    /// `BUILDER_ISLAND_RECORD=<dir>`: film the top of the screen around the island
    /// (IslandRecorder), in the demo or on live data. With `BUILDER_ISLAND_RECORD_AFTER_PASS=1`
    /// filming starts when the first pass lands, which on a busy machine is a minute or more.
    private func recordIfAsked(_ env: [String: String], afterPass: Bool = false) {
        guard let dir = env["BUILDER_ISLAND_RECORD"] else { return }
        guard (env["BUILDER_ISLAND_RECORD_AFTER_PASS"] == "1") == afterPass else { return }
        if env["BUILDER_ISLAND_DEMO"] == "1" { island.start() }
        guard let p = island.placement ?? NotchPlacement.current() else { return }
        // The top of the screen around the notch, in CG's top-left coordinates.
        let screenTop = NSScreen.screens.first?.frame.maxY ?? p.top
        let rect = CGRect(x: p.centerX - 330, y: screenTop - p.top, width: 660, height: 190)
        let seconds = Double(env["BUILDER_ISLAND_RECORD_SECONDS"] ?? "") ?? 26
        IslandRecorder(dir: dir, rect: rect, seconds: seconds).start()
    }

    // MARK: - Island

    private func setUpIsland() {
        island.openPopover = { [weak self] in
            guard let self, let button = self.statusItem.button else { return }
            if !self.popover.isShown { self.togglePopover(button) }
        }
        island.openAgent = { agent in TerminalFocus.open(agent) }
        let store = self.store
        island.isPaired = { await store.isPaired() }
        island.shareDrop = { shared in try await store.shareDrop(shared) }
        island.pollDrop = { id in try await store.dropState(id: id) }
        store.onIsland = { [weak self] agents, ranToday in
            self?.island.update(agents: agents, ranToday: ranToday)
        }
        store.onShipped = { [weak self] shipped in self?.island.showShipped(shipped) }
        if showIsland && ProcessInfo.processInfo.environment["BUILDER_ISLAND_DEMO"] != "1" {
            island.start()
        }
    }

    @objc private func toggleIsland() {
        showIsland.toggle()
        if showIsland {
            island.start()
            store.refresh(force: false)
        } else {
            island.stop()
        }
    }

    // MARK: - Status item

    private func setUpStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        guard let button = statusItem.button else { return }

        button.image = NSImage(
            systemSymbolName: "chart.bar.fill", accessibilityDescription: "Builder")
        button.image?.isTemplate = true
        button.action = #selector(statusItemClicked(_:))
        button.target = self
        button.sendAction(on: [.leftMouseUp, .rightMouseUp])

        // The title carries today's active time, so the answer to "how long have I been
        // at this" is available without opening anything.
        store.onSummaryChange = { [weak self] summary in
            DispatchQueue.main.async {
                NSLog("builder: status summary = %@", summary)
                self?.statusItem.button?.title = summary.isEmpty ? "" : " \(summary)"
                self?.shootPopoverIfAsked()
                if self?.firstPassSeen == false {
                    self?.firstPassSeen = true
                    self?.recordIfAsked(ProcessInfo.processInfo.environment, afterPass: true)
                }
            }
        }
    }

    private var firstPassSeen = false

    /// `BUILDER_POPOVER_SHOT=<file.png>`: after the first pass, open the popover and save a
    /// picture of it, the app photographing its own window (IslandRecorder says why it has to).
    private var popoverShot = ProcessInfo.processInfo.environment["BUILDER_POPOVER_SHOT"]

    private func shootPopoverIfAsked() {
        guard let path = popoverShot, let button = statusItem.button else { return }
        popoverShot = nil
        if !popover.isShown { togglePopover(button) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
            guard let window = self?.popover.contentViewController?.view.window else { return }
            let screenTop = NSScreen.screens.first?.frame.maxY ?? 0
            let f = window.frame
            let rect = CGRect(x: f.minX, y: screenTop - f.maxY, width: f.width, height: f.height)
            IslandRecorder.still(rect: rect, to: path)
        }
    }

    @objc private func statusItemClicked(_ sender: NSStatusBarButton) {
        guard let event = NSApp.currentEvent else { return }
        if event.type == .rightMouseUp {
            showContextMenu(sender)
        } else {
            togglePopover(sender)
        }
    }

    private func showContextMenu(_ sender: NSStatusBarButton) {
        let menu = NSMenu()
        menu.addItem(
            withTitle: store.isPaused ? "Resume tracking" : "Pause tracking",
            action: #selector(togglePause), keyEquivalent: "")
        menu.addItem(.separator())
        menu.addItem(withTitle: "Rescan now", action: #selector(rescan), keyEquivalent: "r")
        let islandItem = NSMenuItem(
            title: "Show island at the notch", action: #selector(toggleIsland), keyEquivalent: "")
        islandItem.state = showIsland ? .on : .off
        menu.addItem(islandItem)
        menu.addItem(
            withTitle: "Reveal data folder", action: #selector(revealData), keyEquivalent: "")
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit Builder", action: #selector(quit), keyEquivalent: "q")
        for item in menu.items { item.target = self }
        statusItem.menu = menu
        sender.performClick(nil)
        statusItem.menu = nil
    }

    @objc private func togglePause() { store.isPaused.toggle() }
    @objc private func rescan() { store.refresh(force: true) }
    @objc private func quit() { NSApp.terminate(nil) }

    @objc private func revealData() {
        NSWorkspace.shared.selectFile(
            StorePaths.state, inFileViewerRootedAtPath: StorePaths.root)
    }

    // MARK: - Popover

    private func setUpPopover() {
        popover = NSPopover()
        popover.behavior = .transient
        popover.contentSize = NSSize(width: 420, height: 560)
        popover.contentViewController = NSHostingController(
            rootView: MenuBarView().environment(store))
    }

    private func togglePopover(_ sender: NSStatusBarButton) {
        if popover.isShown {
            popover.performClose(nil)
        } else {
            store.refresh(force: false)
            popover.show(relativeTo: sender.bounds, of: sender, preferredEdge: .minY)
            popover.contentViewController?.view.window?.makeKey()
        }
    }

    // MARK: - Notifications

    private func requestNotificationPermission() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        // Asked at launch rather than on first session end. A permission prompt that
        // arrives fifteen minutes after you stopped working, with no context, gets denied.
        center.requestAuthorization(options: [.alert, .sound]) { _, _ in }

        let view = UNNotificationAction(identifier: "view", title: "View recap", options: [.foreground])
        let share = UNNotificationAction(identifier: "share", title: "Share", options: [.foreground])
        center.setNotificationCategories([
            UNNotificationCategory(
                identifier: "session_finished", actions: [view, share],
                intentIdentifiers: [], options: [])
        ])

        store.notifier = UNNotifier()
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let sessionID = response.notification.request.content.userInfo["session"] as? String
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if response.actionIdentifier == "share", let sessionID {
                self.store.share(sessionID: sessionID)
            } else {
                self.store.selectedSessionID = sessionID
                if let button = self.statusItem.button { self.togglePopover(button) }
            }
        }
        completionHandler()
    }

    /// Show the banner even when Builder is frontmost — the app is a menu bar item, so
    /// "frontmost" usually means the popover happens to be open, and suppressing the alert
    /// there would silently drop it.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }
}

/// Real macOS notifications, with actions. The CLI's `MacOSNotifier` shells out to
/// osascript because a bare SwiftPM executable has no bundle identifier to register with
/// `UNUserNotificationCenter`; inside the app bundle we get the real thing.
struct UNNotifier: Notifier {
    let channel = "local"

    func deliver(_ alert: SessionAlert) throws {
        let content = UNMutableNotificationContent()
        content.title = alert.title
        content.body = alert.body
        content.categoryIdentifier = "session_finished"
        content.userInfo = ["session": alert.clientSessionID]
        content.interruptionLevel = .active

        UNUserNotificationCenter.current().add(
            UNNotificationRequest(
                identifier: alert.clientSessionID, content: content, trigger: nil))
    }
}
