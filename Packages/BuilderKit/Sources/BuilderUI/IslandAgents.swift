import BuilderAnalysis
import BuilderIngest
import Foundation

/// Running transcripts to island agents, in one place: the app's pass and `builder island`
/// both call this, so what the CLI prints is what the notch draws.
public enum IslandAgents {

    public typealias Read = (agent: LiveAgents.Running, turn: LiveTail.Turn?)

    /// Each running transcript and what its tail says. Claude Code only: the other harnesses'
    /// stores are not JSONL transcripts, so their agents are shown without a sentence.
    public static func read(_ running: [LiveAgents.Running], now: Double) -> [Read] {
        running.map { r in (r, r.harness == .claudeCode ? LiveTail.read(path: r.path, now: now) : nil) }
    }

    /// The agents, each wearing its session's crew creature (the phone's rule, oldest session
    /// first). `kept` is the creatures already drawn in this process and comes back grown.
    public static func make(_ reads: [Read], kept: inout [String: String]) -> [IslandAgent] {
        var sessions: [(id: String, startedAt: Double)] = []
        for r in reads where !sessions.contains(where: { $0.id == r.agent.sessionID }) {
            sessions.append((r.agent.sessionID, r.agent.sessionStartedAt))
        }
        let creatures = CrewRule.creatures(sessions: sessions, kept: kept)
        kept.merge(creatures) { _, new in new }
        let all = reads.map { r -> IslandAgent in
            let t = r.turn
            let waiting = t?.waiting.map { w -> IslandAgent.Waiting in
                let reason: IslandAgent.Waiting.Reason
                switch w {
                case .turnEnded: reason = .turnEnded
                case .question: reason = .question
                case .permission: reason = .permission
                }
                return IslandAgent.Waiting(
                    reason: reason, since: t?.waitingSince ?? r.agent.lastEventAt, detail: t?.detail)
            }
            // A pool with no repository and no cwd has no name; the transcript's own cwd does.
            var repo = r.agent.repo
            if repo == "a session", let cwd = t?.cwd ?? r.agent.cwd, !cwd.isEmpty {
                repo = (cwd as NSString).lastPathComponent
            }
            return IslandAgent(
                id: r.agent.sourceID, sessionID: r.agent.sessionID, repo: repo,
                creature: creatures[r.agent.sessionID] ?? "bit", activity: t?.activity,
                waiting: waiting, lastEventAt: max(r.agent.lastEventAt, t?.lastTs ?? 0),
                transcriptPath: r.agent.path, cwd: t?.cwd ?? r.agent.cwd,
                branch: (t?.cwd ?? r.agent.cwd).flatMap(GitHead.branch(at:)))
        }
        // A transcript silent past the agent's own cadence (LiveTail.idleAfterSeconds, the p99
        // record gap) that did not hand the turn back is neither working nor waiting on you,
        // so it is not on the notch. FOUND BY RUNNING IT: the popover said "7 agents running"
        // over one repository, four of them Idle: windows left open, not work being done.
        return all.filter { $0.waiting != nil || $0.activity != "Idle" }
    }
}

/// The branch checked out in a working directory, read from the files git keeps, with no git
/// process: this runs for every running agent every two seconds.
public enum GitHead {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var cache: [String: (branch: String?, at: Date)] = [:]

    public static func branch(at cwd: String) -> String? {
        if let hit = lock.withLock({ cache[cwd] }), Date().timeIntervalSince(hit.at) < 30 {
            return hit.branch
        }
        let branch = read(cwd)
        lock.withLock { cache[cwd] = (branch, Date()) }
        return branch
    }

    /// Walk up to the `.git` entry: a directory in a main checkout, a file naming the real git
    /// directory in a worktree (`gitdir: /repo/.git/worktrees/name`). HEAD there is
    /// `ref: refs/heads/<branch>`, or a bare hash when detached, which has no name to show.
    private static func read(_ cwd: String) -> String? {
        let fm = FileManager.default
        var dir = URL(fileURLWithPath: cwd)
        for _ in 0..<32 {
            let dotgit = dir.appendingPathComponent(".git")
            var isDir: ObjCBool = false
            if fm.fileExists(atPath: dotgit.path, isDirectory: &isDir) {
                var gitdir = dotgit
                if !isDir.boolValue {
                    guard let text = try? String(contentsOf: dotgit, encoding: .utf8),
                          let line = text.split(separator: "\n").first, line.hasPrefix("gitdir:")
                    else { return nil }
                    let path = line.dropFirst("gitdir:".count).trimmingCharacters(in: .whitespaces)
                    gitdir = URL(fileURLWithPath: path, relativeTo: dir).standardizedFileURL
                }
                guard let head = try? String(contentsOf: gitdir.appendingPathComponent("HEAD"), encoding: .utf8)
                else { return nil }
                let ref = head.trimmingCharacters(in: .whitespacesAndNewlines)
                guard ref.hasPrefix("ref: refs/heads/") else { return nil }
                return String(ref.dropFirst("ref: refs/heads/".count))
            }
            let parent = dir.deletingLastPathComponent()
            if parent.path == dir.path { return nil }
            dir = parent
        }
        return nil
    }
}
