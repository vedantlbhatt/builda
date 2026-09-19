import BuilderModel
import Foundation
import SwiftUI

/// What the notch island is showing, as plain data.
///
/// The rule it is built on (docs/motion.md, "The island is one object, everywhere"): only
/// what is HAPPENING ELSEWHERE, ON YOUR BEHALF, that you might need to act on. So nothing
/// here is a total, a streak or a number that is true all day. An island that shows a number
/// that has not changed since breakfast is an island you learn to ignore, and then the one
/// that needs you is ignored too.
public enum IslandMode: String, Sendable, CaseIterable {
    /// Nothing running: the ears alone, the face asleep if nothing ran today.
    case idle
    /// Agents running: the face working, one dot per agent in the right ear.
    case crew
    /// A running session handed the turn back to you, or is waiting on a permission.
    case needsYou
    /// A session just finished. The one moment worth a beat.
    case shipped
    /// A link is being dragged onto the notch, or one was just dropped.
    case drop
    /// The Mac is filming a demo (the ship kit's worker, `capture demo watch`): a simulator is
    /// running headless and the fans may say so, so the notch says what it is for.
    case filming
    /// You came back to the Mac after an hour or more and sessions finished meanwhile: one beat
    /// that says what, since each one's own shipped beat played to an empty room.
    case away
}

/// One running agent: one transcript being written to right now.
public struct IslandAgent: Identifiable, Equatable, Sendable {
    /// The transcript's source id. Two Claude Code windows in one repository are one Builder
    /// session (sessions pool by repository) and two agents.
    public let id: String
    /// The Builder session it belongs to (`client_session_id`), which decides its creature.
    public let sessionID: String
    public let repo: String
    /// The crew creature its session wears (`CrewRule`), so the phone and the Mac agree.
    public let creature: String
    /// A sentence of what it is doing, from its last tool call ("Editing IslandView.swift").
    /// nil when the tail says nothing a person could read.
    public let activity: String?
    /// Set when it is waiting on you.
    public let waiting: Waiting?
    public let lastEventAt: Double
    /// The transcript on disk, so a click can reveal it when no terminal can be found.
    public let transcriptPath: String?
    public let cwd: String?
    /// The branch checked out where it runs, to tell apart two agents in one repository
    /// (two worktrees of it, most often). LOCAL: shown on this Mac only.
    public let branch: String?

    public init(
        id: String, sessionID: String, repo: String, creature: String, activity: String?,
        waiting: Waiting?, lastEventAt: Double, transcriptPath: String? = nil, cwd: String? = nil,
        branch: String? = nil
    ) {
        self.id = id
        self.sessionID = sessionID
        self.repo = repo
        self.creature = creature
        self.activity = activity
        self.waiting = waiting
        self.lastEventAt = lastEventAt
        self.transcriptPath = transcriptPath
        self.cwd = cwd
        self.branch = branch
    }

    public var hue: Color { CrewRule.color(ofCreature: creature) }

    public struct Waiting: Equatable, Sendable {
        public enum Reason: String, Sendable {
            /// The agent ended its turn (`stop_reason` end_turn or stop_sequence).
            case turnEnded
            /// The agent asked a question with a tool built for asking (AskUserQuestion).
            case question
            /// A file edit has had no result for longer than any edit ever took: a
            /// permission prompt is open (measured, `LiveTail.permissionAfterSeconds`).
            case permission
        }

        public let reason: Reason
        /// When the wait began, unix seconds.
        public let since: Double
        /// What it is waiting on, in a line: the end of what it said, the question it asked,
        /// or the file it wants to change. LOCAL: shown on this Mac, never uploaded.
        public let detail: String?

        public init(reason: Reason, since: Double, detail: String?) {
            self.reason = reason
            self.since = since
            self.detail = detail
        }
    }
}

/// A session that just finished, for the beat.
public struct IslandShipped: Equatable, Sendable {
    public let sessionID: String
    public let repo: String
    public let activeSeconds: Double
    public let commits: Int
    /// "Agent run finished" rather than "Session finished": nobody was at the keyboard.
    public let unattended: Bool
    public let at: Date

    public init(
        sessionID: String, repo: String, activeSeconds: Double, commits: Int,
        unattended: Bool = false, at: Date = Date()
    ) {
        self.sessionID = sessionID
        self.repo = repo
        self.activeSeconds = activeSeconds
        self.commits = commits
        self.unattended = unattended
        self.at = at
    }

    /// "Shipped · builder · 42m · 6 commits". The commit count is dropped when git saw none
    /// rather than printed as a zero nobody asked for.
    public var sentence: String {
        var parts = [unattended ? "Finished" : "Shipped", repo, IslandText.minutes(activeSeconds)]
        if commits > 0 { parts.append(commits == 1 ? "1 commit" : "\(commits) commits") }
        return parts.joined(separator: " · ")
    }
}

/// What finished while nobody was at the Mac (`IslandController`, the shipped beats that played
/// while the Mac was idle), said once when someone comes back.
public struct IslandAway: Equatable, Sendable {
    public let finished: Int
    public let activeSeconds: Double
    public let commits: Int
    /// How many of them ran with nobody there (agent runs).
    public let alone: Int

    public init(finished: Int, activeSeconds: Double, commits: Int, alone: Int) {
        self.finished = finished
        self.activeSeconds = activeSeconds
        self.commits = commits
        self.alone = alone
    }

    /// The beats nobody saw, added up. Nil when there were none: nothing finished is not news.
    public static func of(_ missed: [IslandShipped]) -> IslandAway? {
        guard !missed.isEmpty else { return nil }
        return IslandAway(
            finished: missed.count,
            activeSeconds: missed.reduce(0) { $0 + $1.activeSeconds },
            commits: missed.reduce(0) { $0 + $1.commits },
            alone: missed.filter(\.unattended).count)
    }

    /// "While you were away · 3 finished · 5h 12m · 14 commits", the phone's words (`live/away.ts`),
    /// the shipped sentence's shape. Commits drop out at zero, as they do there.
    public var sentence: String {
        var parts = ["While you were away", "\(finished) finished", IslandText.minutes(activeSeconds)]
        if commits > 0 { parts.append(commits == 1 ? "1 commit" : "\(commits) commits") }
        return parts.joined(separator: " · ")
    }
}

/// Where a dropped link is.
public enum DropPhase: Equatable, Sendable {
    /// A drag is over the notch. `valid` is false when what is being dragged has no link in it.
    case zone(valid: Bool)
    /// The link cannot go anywhere: this Mac has no account to send it to.
    case unpaired
    /// Posted, waiting for the server to answer.
    case sending(url: String)
    /// The server holds it; the steps after this are the Mac reading it and Claude planning.
    case progress(id: String, step: Int, moves: Int?)
    case failed(String)

    /// The wheel's steps, in order. `progress.step` indexes this.
    public static let steps = ["Sent", "Reading", "Planned"]
}

/// A demo being filmed on this Mac: the job the worker holds in `~/.builder/demos/queue/running/`.
public struct IslandFilming: Equatable, Sendable {
    /// The project's folder name as the worker read it (the job's `name`).
    public var project: String
    /// When the worker took the job (the running file's modification time), Unix seconds.
    public var since: Double

    public init(project: String, since: Double) {
        self.project = project
        self.since = since
    }

    /// The job the one worker holds, if any. The worker keeps at most one job in `running/`
    /// (it holds `queue/worker.lock` for its whole life), so the first file is THE job; a file
    /// that does not parse is the worker mid write and is skipped until the next pass.
    public static func read(queueRoot: URL, now: Double = Date().timeIntervalSince1970) -> IslandFilming? {
        let dir = queueRoot.appendingPathComponent("running", isDirectory: true)
        let fm = FileManager.default
        guard let files = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey]) else { return nil }
        for f in files.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) where f.pathExtension == "json" {
            guard let data = try? Data(contentsOf: f),
                  let job = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
            let name = (job["name"] as? String).flatMap { $0.isEmpty ? nil : $0 }
                ?? (job["path"] as? String).map { URL(fileURLWithPath: $0).lastPathComponent }
                ?? "a project"
            let mtime = (try? f.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate?.timeIntervalSince1970 ?? now
            return IslandFilming(project: name, since: min(mtime, now))
        }
        return nil
    }
}

/// Everything the island draws, in one value, so a demo, a preview and the live app all hand
/// the same view the same shape.
public struct IslandSnapshot: Equatable, Sendable {
    public var agents: [IslandAgent]
    /// Whether anything ran today (`Tuning.dayBoundaryHour` day). The idle face sleeps when not.
    public var ranToday: Bool
    public var shipped: IslandShipped?
    public var drop: DropPhase?
    public var filming: IslandFilming?
    public var away: IslandAway?

    public init(
        agents: [IslandAgent] = [], ranToday: Bool = false, shipped: IslandShipped? = nil,
        drop: DropPhase? = nil, filming: IslandFilming? = nil, away: IslandAway? = nil
    ) {
        self.agents = agents
        self.ranToday = ranToday
        self.shipped = shipped
        self.drop = drop
        self.filming = filming
        self.away = away
    }

    /// What to call an agent in a list: its repository, and its branch when another agent in
    /// the list works in the same repository ("builder/motion-mac"), and only then, so a lone
    /// agent reads as plainly as the repository it is in.
    public func label(for agent: IslandAgent) -> String {
        let twins = agents.filter { $0.repo == agent.repo }.count
        guard twins > 1, let branch = agent.branch, !branch.isEmpty else { return agent.repo }
        return "\(agent.repo)/\(Self.shortBranch(branch))"
    }

    /// A branch's last part, readable at a glance. FOUND BY RUNNING IT on this Mac, where the
    /// agents' worktrees are on branches like `worktree-agent-a59698c5718…`: the wheel printed
    /// the whole hash and truncated the line. A `worktree-` prefix goes, and a run of hex eight
    /// or more long keeps its first four ("agent-a596"), as a short commit id does.
    public static func shortBranch(_ branch: String) -> String {
        let last = branch.split(separator: "/").last.map(String.init) ?? branch
        var parts = last.split(separator: "-").map(String.init)
        if parts.count > 1, parts.first == "worktree" { parts.removeFirst() }
        parts = parts.map { p in
            p.count >= 8 && p.allSatisfy(\.isHexDigit) ? String(p.prefix(4)) : p
        }
        return parts.joined(separator: "-")
    }

    /// Who needs you, longest wait first: the one waiting longest has lost the most.
    public var waiting: [IslandAgent] {
        agents.filter { $0.waiting != nil }
            .sorted { ($0.waiting?.since ?? 0) < ($1.waiting?.since ?? 0) }
    }

    /// The mode, by precedence: the thing you are doing with your hands (a drag) first, then
    /// the one-off beat, then what needs you, then a demo being filmed (the phone's order too:
    /// a demo outranks the crew it is not part of), then what is merely running.
    public var mode: IslandMode {
        if drop != nil { return .drop }
        if shipped != nil { return .shipped }
        if away != nil { return .away }
        if !waiting.isEmpty { return .needsYou }
        if filming != nil { return .filming }
        if !agents.isEmpty { return .crew }
        return .idle
    }

    /// The face's state for this snapshot.
    public var face: FaceState {
        switch mode {
        case .idle: return ranToday ? .idle : .sleep
        case .crew: return .working
        case .needsYou: return .waiting
        case .shipped: return .done
        case .filming: return .working
        case .away: return .done
        case .drop:
            if case .failed = drop { return .error }
            if case .unpaired = drop { return .error }
            if case .progress(_, let step, _) = drop, step >= 2 { return .done }
            if case .progress = drop { return .thinking }
            return .idle
        }
    }
}

/// Short words for the island, one place.
public enum IslandText {
    /// "42m", "1h 5m", "40s". Whole minutes, the phone's rule (`src/copy/plain.ts`).
    public static func minutes(_ seconds: Double) -> String {
        let s = max(0, Int(seconds.rounded()))
        if s < 60 { return "\(s)s" }
        let h = s / 3600
        let m = (s % 3600) / 60
        return h > 0 ? "\(h)h \(m)m" : "\(m)m"
    }

    /// "waiting 2m": how long something has waited, from `since` to `now`.
    public static func waited(since: Double, now: Double) -> String {
        let s = max(0, now - since)
        if s < 60 { return "just now" }
        return minutes(s)
    }
}

/// Which creature a session wears, and so its hue: the phone's rule (`mobile/src/live/crew.ts`,
/// DESIGN-V2 2.2), ported so a session on the Mac notch and the same session on the Lock
/// Screen are the same colour. The ring and the hues come from design/tokens.json through the
/// generator, never restated here.
public enum CrewRule {

    /// FNV-1a, 32 bit, over the UTF-8 bytes. The phone's three test vectors hold it
    /// (`IslandMotionTests.crewHashMatchesThePhone`).
    public static func fnv1a32(_ s: String) -> UInt32 {
        var h: UInt32 = 0x811C_9DC5
        for b in s.utf8 {
            h = (h ^ UInt32(b)) &* 0x0100_0193
        }
        return h
    }

    public static func hashed(_ clientSessionID: String) -> String {
        let ring = DesignTokens.Spectrum.crewRing
        return ring[Int(fnv1a32(clientSessionID) % UInt32(ring.count))]
    }

    /// Each session's creature: the hashed one, stepped forward along the ring past any
    /// creature a session that started earlier and is still running already wears. Taken
    /// oldest first. `kept` is what this process already drew, which never changes: a dot does
    /// not change colour under someone because a neighbour finished.
    public static func creatures(
        sessions: [(id: String, startedAt: Double)], kept: [String: String] = [:]
    ) -> [String: String] {
        let ring = DesignTokens.Spectrum.crewRing
        var out: [String: String] = [:]
        var worn: [String] = []
        for s in sessions.sorted(by: { ($0.startedAt, $0.id) < ($1.startedAt, $1.id) }) {
            if out[s.id] != nil { continue }
            var pick = kept[s.id]
            if pick == nil {
                let base = Int(fnv1a32(s.id) % UInt32(ring.count))
                pick = ring[base]
                for k in 0..<ring.count where !worn.contains(ring[(base + k) % ring.count]) {
                    pick = ring[(base + k) % ring.count]
                    break
                }
            }
            out[s.id] = pick
            worn.append(pick!)
        }
        return out
    }

    /// The dark ink of a creature's hue. Bit, and anything unknown, is the brand's amber.
    public static func srgb(ofCreature creature: String) -> SRGB {
        let hue = DesignTokens.Spectrum.creature[creature] ?? "amber"
        return DesignTokens.Spectrum.hues[hue] ?? SRGB(r: 1, g: 0.702, b: 0)
    }

    public static func color(ofCreature creature: String) -> Color {
        StripPalette.color(srgb(ofCreature: creature))
    }
}
