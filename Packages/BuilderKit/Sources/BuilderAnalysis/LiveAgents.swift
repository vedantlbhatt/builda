import BuilderIngest
import BuilderModel
import BuilderSQLite
import Foundation

/// Every agent running on this Mac right now: one row per transcript being written to inside
/// an open session.
///
/// A Builder session is one person's sitting in one repository (sessions pool by repository),
/// so two Claude Code windows in one repository are ONE session and TWO agents. The island
/// counts agents, because "several agents at once is the thing you cannot see from the sofa"
/// (docs/motion.md). Found the way `AnalysisJob.make` finds a session's transcripts, the same
/// pool predicate and the same root allowlist, so a subagent sidecar is never an agent of its
/// own: its work is its parent's.
public enum LiveAgents {

    public struct Running: Sendable, Equatable {
        public let sessionID: String
        public let sessionStartedAt: Double
        public let harness: Harness
        public let repo: String
        public let sourceID: String
        public let path: String
        public let lastEventAt: Double
        public let cwd: String?
    }

    /// Transcripts of `open` sessions with an event inside `window` seconds of `now`.
    ///
    /// `window` is the session threshold: a transcript quiet for longer than that would have
    /// ended its session, so anything inside it is still that session's agent, including one
    /// that has been waiting on you for ten minutes, which is exactly the one to show.
    public static func running(
        state: SQLiteDB, open: [DetectedSession], repoNames: [Int: String],
        now: Double = Date().timeIntervalSince1970, window: Double = Tuning.tauSessionSec
    ) throws -> [Running] {
        var out: [Running] = []
        for s in open {
            let prefix = s.harness.rawValue + "|"
            let pool = s.poolKey.hasPrefix(prefix) ? String(s.poolKey.dropFirst(prefix.count)) : s.poolKey
            let repo = Int(pool).flatMap { repoNames[$0] }
                ?? (pool == "unknown" ? "a session" : (pool as NSString).lastPathComponent)
            try state.query(
                """
                SELECT e.source_id, w.path, MAX(e.ts), MAX(e.cwd)
                FROM raw_event e JOIN ingest_watermark w ON w.source_id = e.source_id
                WHERE e.harness = ? AND e.ts >= ? AND e.is_sidechain = 0
                  AND COALESCE(CAST(e.repo_id AS TEXT), e.cwd, 'unknown') = ?
                GROUP BY e.source_id
                """,
                [.text(s.harness.rawValue), .double(max(s.startedAt, now - window)), .text(pool)]
            ) { st in
                guard let source = st.text(0), let path = st.text(1), let last = st.double(2) else { return }
                if s.harness == .claudeCode,
                   !AnalysisJob.isRootTranscript(path: path, sourceID: source) { return }
                out.append(
                    Running(
                        sessionID: s.clientSessionID, sessionStartedAt: s.startedAt,
                        harness: s.harness, repo: repo, sourceID: source, path: path,
                        lastEventAt: last, cwd: st.text(3)))
            }
        }
        // One transcript is one agent, even when its records landed in two sessions: the Swift
        // deriver pools by the repository each record's cwd resolves to, so a sitting that
        // `cd`'d out of the repo is split (CLAUDE.md, "Pooling by the repository each record's
        // cwd resolves to"). FOUND BY RUNNING IT: this Mac's orchestrator transcript came back
        // twice, once under its repository and once under its home directory, and the wheel,
        // keyed by transcript, drew only one of the two rows. The copy kept is the one whose
        // session saw the latest event, a resolved repository breaking a tie.
        var best: [String: Running] = [:]
        for r in out {
            guard let seen = best[r.sourceID] else {
                best[r.sourceID] = r
                continue
            }
            let known = { (x: Running) in x.repo != "a session" && !x.repo.hasPrefix("/") }
            if (r.lastEventAt, known(r) ? 1 : 0) > (seen.lastEventAt, known(seen) ? 1 : 0) {
                best[r.sourceID] = r
            }
        }
        return best.values.sorted { ($0.lastEventAt, $0.sourceID) > ($1.lastEventAt, $1.sourceID) }
    }
}
