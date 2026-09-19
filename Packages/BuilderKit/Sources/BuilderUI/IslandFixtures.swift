import Foundation

/// Fixture data for the island: the demo cycle (`BUILDER_ISLAND_DEMO=1`), `builder preview
/// island`, and the tests. Repository names and sentences are made up; nothing here is read
/// from this machine, so a screenshot of the demo shows nobody's work.
public enum IslandFixtures {

    /// Three agents across two projects, one of them in a second window of the first.
    public static func crew(now: Double = Date().timeIntervalSince1970) -> [IslandAgent] {
        let a = "demo-session-builder"
        let b = "demo-session-transit"
        let creatures = CrewRule.creatures(sessions: [(a, now - 2400), (b, now - 900)])
        return [
            IslandAgent(
                id: "demo-agent-1", sessionID: a, repo: "builder", creature: creatures[a] ?? "fox",
                activity: "Editing IslandView.swift", waiting: nil, lastEventAt: now - 4),
            IslandAgent(
                id: "demo-agent-2", sessionID: a, repo: "builder", creature: creatures[a] ?? "fox",
                activity: "Running the tests", waiting: nil, lastEventAt: now - 9),
            IslandAgent(
                id: "demo-agent-3", sessionID: b, repo: "gt-transit", creature: creatures[b] ?? "whale",
                activity: "Reading routes.py", waiting: nil, lastEventAt: now - 20),
        ]
    }

    /// The same crew, with the transit agent's turn over two minutes ago.
    public static func needsYou(now: Double = Date().timeIntervalSince1970) -> [IslandAgent] {
        var agents = crew(now: now)
        let t = agents[2]
        agents[2] = IslandAgent(
            id: t.id, sessionID: t.sessionID, repo: t.repo, creature: t.creature,
            activity: nil,
            waiting: IslandAgent.Waiting(
                reason: .turnEnded, since: now - 128,
                detail: "Should I run the migration against staging now?"),
            lastEventAt: now - 128)
        return agents
    }

    public static func shipped() -> IslandShipped {
        IslandShipped(sessionID: "demo-session-builder", repo: "builder", activeSeconds: 42 * 60, commits: 6)
    }

    /// The demo cycle, one snapshot per step: idle, crew, needs you, shipped, the drop zone,
    /// and the dropped link going through its three steps.
    public static func demoCycle(now: Double = Date().timeIntervalSince1970) -> [(name: String, snapshot: IslandSnapshot, expanded: Bool)] {
        [
            ("idle", IslandSnapshot(agents: [], ranToday: true), false),
            ("crew-collapsed", IslandSnapshot(agents: crew(now: now), ranToday: true), false),
            ("crew", IslandSnapshot(agents: crew(now: now), ranToday: true), true),
            ("needs-you-collapsed", IslandSnapshot(agents: needsYou(now: now), ranToday: true), false),
            ("needs-you", IslandSnapshot(agents: needsYou(now: now), ranToday: true), true),
            ("shipped", IslandSnapshot(agents: [], ranToday: true, shipped: shipped()), true),
            ("drop-zone", IslandSnapshot(agents: [], ranToday: true, drop: .zone(valid: true)), true),
            ("drop-reading", IslandSnapshot(agents: [], ranToday: true, drop: .progress(id: "demo", step: 1, moves: nil)), true),
            ("drop-planned", IslandSnapshot(agents: [], ranToday: true, drop: .progress(id: "demo", step: 2, moves: 3)), true),
            ("filming-collapsed", IslandSnapshot(agents: crew(now: now), ranToday: true, filming: IslandFilming(project: "tramline", since: now - 190)), false),
            ("filming", IslandSnapshot(agents: crew(now: now), ranToday: true, filming: IslandFilming(project: "tramline", since: now - 190)), true),
        ]
    }
}
