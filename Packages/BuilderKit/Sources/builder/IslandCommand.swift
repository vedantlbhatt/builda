import BuilderAnalysis
import BuilderIngest
import BuilderModel
import BuilderSchema
import BuilderUI
import AppKit
import Foundation

/// `builder island [--store DIR]` — what the notch island would show right now: every running
/// agent, its creature, and what the end of its transcript says (working on what, or waiting
/// on you, since when, on what). The app's pass calls the same functions.
///
/// It derives sessions (which rewrites the disposable cache) and reads the lifecycle as the
/// app last left it; it does not tick the lifecycle, so it never finalizes or announces
/// anything. `--store` points it at a copy of the store rather than the real one.
enum IslandCommand {

    static func run() throws {
        let state = try SchemaManager.openState()
        let sessions = try SessionDeriver.run(db: state, verbose: false)
        let open = try SessionLifecycle(db: state).openSessions(among: sessions)
        let names = try IngestCoordinator.repoNames(db: state)
        let now = Date().timeIntervalSince1970
        let running = try LiveAgents.running(state: state, open: open, repoNames: names, now: now)
        var kept: [String: String] = [:]
        let agents = IslandAgents.make(IslandAgents.read(running, now: now), kept: &kept)
        let snapshot = IslandSnapshot(agents: agents, ranToday: true)

        print("island: \(snapshot.mode.rawValue), face \(snapshot.face.rawValue)")
        print("  open sessions \(open.count), running agents \(agents.count)")
        for a in agents {
            let ago = Int(now - a.lastEventAt)
            print("  \(a.creature.padding(toLength: 8, withPad: " ", startingAt: 0)) \(a.repo)  (last event \(ago)s ago)")
            if let app = TerminalFocus.owningApp(of: a) {
                print("           terminal: \(app.localizedName ?? "?") (pid \(app.processIdentifier))")
            }
            if let w = a.waiting {
                print("           waiting: \(w.reason.rawValue) for \(Int(now - w.since))s  \(w.detail ?? "")")
            } else {
                print("           \(a.activity ?? "-")")
            }
        }
    }
}
