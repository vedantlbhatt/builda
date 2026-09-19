import BuilderUI
import Foundation
import Testing

/// The island's shape and what decides it.
@Suite("Island layout")
struct IslandLayoutTests {

    let notch = NotchMetrics.macBookPro14

    @Test("collapsed, the island is the notch plus two ears, exactly the notch's height")
    func hugsTheNotch() {
        let g = IslandLayout.geometry(mode: .crew, expanded: false, notch: notch)
        #expect(g.w == Double(185 + 2 * IslandLayout.ear))
        #expect(g.h == 32)
        #expect(g.r == Double(IslandLayout.collapsedRadius))
    }

    @Test("idle never opens, whatever asks it to")
    func idleStaysShut() {
        #expect(IslandLayout.geometry(mode: .idle, expanded: true, notch: notch)
            == IslandLayout.geometry(mode: .idle, expanded: false, notch: notch))
    }

    @Test("every open mode is wider than the notch and hangs below it")
    func openModes() {
        for mode in IslandMode.allCases where mode != .idle {
            let g = IslandLayout.geometry(mode: mode, expanded: true, notch: notch)
            #expect(g.w > notch.width + 2 * IslandLayout.ear, "\(mode)")
            #expect(g.h > notch.height + 40, "\(mode)")
            #expect(g.r == Double(IslandLayout.expandedRadius))
        }
    }

    /// The window never resizes, so it has to hold the largest mode at the top of ISLAND's
    /// overshoot, and the rail beside it, or a frame of the morph is clipped.
    @Test("the window holds the widest mode at its overshoot, and the rail")
    func canvasHoldsTheOvershoot() {
        let canvas = IslandLayout.canvas(notch: notch)
        let over = 1 + IslandMotion.island.firstPeak.overshoot
        for mode in IslandMode.allCases {
            let g = IslandLayout.geometry(mode: mode, expanded: true, notch: notch)
            #expect(g.w * over + 2 * (IslandLayout.railGap + 44) <= canvas.width, "\(mode)")
            #expect(g.h * over <= canvas.height, "\(mode)")
        }
    }

    @Test("a screen with no notch gets a pill of its own")
    func pill() {
        let g = IslandLayout.geometry(mode: .crew, expanded: false, notch: .pill)
        #expect(g.r == g.h / 2)
        #expect(g.w < 185)
    }

    @Test("what you are doing with your hands beats a beat, which beats a wait, which beats work")
    func precedence() {
        let crew = IslandFixtures.crew()
        let waiting = IslandFixtures.needsYou()
        #expect(IslandSnapshot(agents: []).mode == .idle)
        #expect(IslandSnapshot(agents: crew).mode == .crew)
        #expect(IslandSnapshot(agents: waiting).mode == .needsYou)
        #expect(IslandSnapshot(agents: waiting, shipped: IslandFixtures.shipped()).mode == .shipped)
        #expect(IslandSnapshot(agents: waiting, shipped: IslandFixtures.shipped(), drop: .zone(valid: true)).mode == .drop)
    }

    @Test("the face sleeps only when nothing ran today")
    func sleeps() {
        #expect(IslandSnapshot(agents: [], ranToday: false).face == .sleep)
        #expect(IslandSnapshot(agents: [], ranToday: true).face == .idle)
        #expect(IslandSnapshot(agents: IslandFixtures.needsYou()).face == .waiting)
    }

    @Test("the shipped sentence drops a zero rather than print one")
    func shippedSentence() {
        #expect(IslandFixtures.shipped().sentence == "Shipped · builder · 42m · 6 commits")
        let none = IslandShipped(sessionID: "s", repo: "r", activeSeconds: 3900, commits: 0)
        #expect(none.sentence == "Shipped · r · 1h 5m")
        let run = IslandShipped(sessionID: "s", repo: "r", activeSeconds: 600, commits: 1, unattended: true)
        #expect(run.sentence == "Finished · r · 10m · 1 commit")
    }

    @Test("the longest wait is first")
    func waitOrder() {
        let now = 1_800_000_000.0
        func a(_ id: String, since: Double) -> IslandAgent {
            IslandAgent(id: id, sessionID: id, repo: id, creature: "fox", activity: nil,
                        waiting: .init(reason: .turnEnded, since: since, detail: nil), lastEventAt: since)
        }
        let s = IslandSnapshot(agents: [a("new", since: now - 10), a("old", since: now - 600)])
        #expect(s.waiting.map(\.id) == ["old", "new"])
    }

    @Test("every creature is 16 by 16 with its eyes where the family keeps them")
    func creatureGrids() {
        for id in CreatureGrids.ids {
            let rest = CreatureGrids.rest[id]!
            #expect(rest.count == 16 && rest.allSatisfy { $0.count == 16 }, "\(id)")
            guard id != "bit-sleeping" else { continue }
            for e in CreatureGrids.eyes {
                let row = Array(rest[e.y])
                #expect(row[e.x] == ".", "\(id) eye cell \(e)")
            }
        }
        #expect(CreatureGrids.eyes.count == 8)
    }
}

/// Two agents in one repository are told apart by branch, read from git's own files.
@Suite("Island agent names")
struct IslandAgentNameTests {

    static func agent(_ id: String, repo: String, branch: String?) -> IslandAgent {
        IslandAgent(id: id, sessionID: id, repo: repo, creature: "fox", activity: "Working",
                    waiting: nil, lastEventAt: 0, branch: branch)
    }

    @Test("a lone agent is its repository; twins carry their branch's last part")
    func labels() {
        let a = Self.agent("a", repo: "builder", branch: "claude/motion-mac")
        let b = Self.agent("b", repo: "builder", branch: "claude/motion")
        let c = Self.agent("c", repo: "gt-transit", branch: "main")
        let s = IslandSnapshot(agents: [a, b, c])
        #expect(s.label(for: a) == "builder/motion-mac")
        #expect(s.label(for: b) == "builder/motion")
        #expect(s.label(for: c) == "gt-transit")
    }

    @Test("the branch is read from a checkout and from a worktree's .git file, and a detached HEAD has none")
    func readsHead() throws {
        let root = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("githead-\(UUID().uuidString)")
        let fm = FileManager.default
        // A main checkout: .git is a directory.
        let main = root.appendingPathComponent("repo")
        try fm.createDirectory(at: main.appendingPathComponent(".git"), withIntermediateDirectories: true)
        try "ref: refs/heads/feature/island\n".write(
            to: main.appendingPathComponent(".git/HEAD"), atomically: true, encoding: .utf8)
        try fm.createDirectory(at: main.appendingPathComponent("Sources/App"), withIntermediateDirectories: true)
        // A worktree: .git is a file naming the real git directory.
        let wtGit = main.appendingPathComponent(".git/worktrees/wt")
        try fm.createDirectory(at: wtGit, withIntermediateDirectories: true)
        try "ref: refs/heads/claude/motion-mac\n".write(
            to: wtGit.appendingPathComponent("HEAD"), atomically: true, encoding: .utf8)
        let wt = root.appendingPathComponent("wt")
        try fm.createDirectory(at: wt, withIntermediateDirectories: true)
        try "gitdir: \(wtGit.path)\n".write(to: wt.appendingPathComponent(".git"), atomically: true, encoding: .utf8)
        // Detached.
        let det = root.appendingPathComponent("detached")
        try fm.createDirectory(at: det.appendingPathComponent(".git"), withIntermediateDirectories: true)
        try "3f2a9c0e1d\n".write(to: det.appendingPathComponent(".git/HEAD"), atomically: true, encoding: .utf8)
        defer { try? fm.removeItem(at: root) }

        #expect(GitHead.branch(at: main.appendingPathComponent("Sources/App").path) == "feature/island")
        #expect(GitHead.branch(at: wt.path) == "claude/motion-mac")
        #expect(GitHead.branch(at: det.path) == nil)
    }
}
