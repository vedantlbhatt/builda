import AppKit
import Darwin

/// Clicking a waiting agent takes you to it: the app that owns its terminal, brought to the
/// front, or failing that its transcript shown in Finder.
///
/// How the app is found, and why it is not guessed from a list of terminal names: walking a
/// Claude Code process's parents reaches the app that started the shell it runs in (here,
/// cmux; elsewhere Terminal, iTerm2, Ghostty, Warp, or an editor's terminal). The first
/// ancestor that is a regular app is the answer, so a terminal nobody has heard of works the
/// same as Terminal.app.
///
/// Which process is Claude Code, MEASURED on this machine: four of them, each an executable at
/// `~/.local/share/claude/versions/<version>` whose kernel name (`p_comm`) is the VERSION,
/// "2.1.276", not "claude". A first version matched the name "claude" and found nothing. And
/// all four had the same working directory, the home folder they were started in, so the
/// directory alone cannot say which terminal is whose: the one started closest before the
/// transcript's first record is taken.
public enum TerminalFocus {

    /// Bring the agent's terminal forward. Returns false when none was found, after revealing
    /// the transcript instead.
    @discardableResult
    public static func open(_ agent: IslandAgent) -> Bool {
        if let app = owningApp(of: agent) {
            app.activate(options: [.activateAllWindows])
            return true
        }
        if let path = agent.transcriptPath {
            NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
        }
        return false
    }

    /// The app running the agent's `claude`, or nil.
    ///
    /// Matched on the directory `claude` was STARTED in, which is its process's working
    /// directory and, slugged, the name of the project folder its transcript lives in
    /// (`~/.claude/projects/-Users-me-src-app/<id>.jsonl`). Not on the transcript's latest
    /// `cwd`: FOUND BY RUNNING IT, that follows every `cd` the agent's shell makes, so an agent
    /// started in the home directory that had moved into a repository matched nothing.
    public static func owningApp(of agent: IslandAgent) -> NSRunningApplication? {
        let slug = agent.transcriptPath.map { ($0 as NSString).deletingLastPathComponent }
            .map { ($0 as NSString).lastPathComponent }
        return owningApp(
            matching: { dir in
                (slug != nil && Self.slug(dir) == slug) || (agent.cwd.map { standard($0) == standard(dir) } ?? false)
            },
            startedNear: agent.transcriptPath.flatMap(transcriptStart))
    }

    /// Claude Code's project folder name for a directory: every character that is not a letter
    /// or a digit becomes "-" (`/Users/me/.claude` is `-Users-me--claude`).
    public static func slug(_ dir: String) -> String {
        String(dir.map { $0.isLetter || $0.isNumber ? $0 : "-" })
    }

    static func standard(_ path: String) -> String { (path as NSString).standardizingPath }

    static func owningApp(
        matching: (String) -> Bool, startedNear: Double? = nil
    ) -> NSRunningApplication? {
        let procs = processes()
        let byPID = Dictionary(procs.map { ($0.pid, $0) }, uniquingKeysWith: { a, _ in a })
        var candidates = procs.filter { isClaudeCode($0.pid) }
            .filter { workingDirectory($0.pid).map(matching) ?? false }
        if let t = startedNear {
            // Started before its transcript's first record, and the latest such; a process
            // started after it is a resumed session, taken only when nothing started before.
            candidates.sort { a, b in
                let (da, db) = (t - a.startedAt, t - b.startedAt)
                if (da >= -5) != (db >= -5) { return da >= -5 }
                return abs(da) < abs(db)
            }
        } else {
            candidates.sort { $0.startedAt > $1.startedAt }
        }
        for p in candidates {
            var ppid = p.ppid
            var hops = 0
            while ppid > 1, hops < 32 {
                if let app = NSRunningApplication(processIdentifier: ppid), app.activationPolicy == .regular {
                    return app
                }
                ppid = byPID[ppid]?.ppid ?? 0
                hops += 1
            }
        }
        return nil
    }

    /// Claude Code, by where its executable lives: the native install's
    /// `…/claude/versions/<version>`, or a binary or script called `claude`.
    static func isClaudeCode(_ pid: pid_t) -> Bool {
        var buf = [CChar](repeating: 0, count: 4096)
        guard proc_pidpath(pid, &buf, UInt32(buf.count)) > 0 else { return false }
        let path = String(cString: buf)
        return path.contains("/claude/versions/") || (path as NSString).lastPathComponent == "claude"
    }

    /// When a transcript's first timestamped record was written: the session's start.
    static func transcriptStart(_ path: String) -> Double? {
        guard let fh = FileHandle(forReadingAtPath: path) else { return nil }
        defer { try? fh.close() }
        guard let data = try? fh.read(upToCount: 256 * 1024) else { return nil }
        for line in data.split(separator: UInt8(ascii: "\n")).prefix(50) {
            guard let obj = try? JSONSerialization.jsonObject(with: Data(line)) as? [String: Any],
                  let ts = obj["timestamp"] as? String
            else { continue }
            let f = ISO8601DateFormatter()
            f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let d = f.date(from: ts) { return d.timeIntervalSince1970 }
        }
        return nil
    }

    struct Proc {
        let pid: pid_t
        let ppid: pid_t
        let name: String
        let startedAt: Double
    }

    /// Every process: pid, parent and short name, from one `sysctl` (no `ps` fork).
    static func processes() -> [Proc] {
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_ALL, 0]
        var size = 0
        guard sysctl(&mib, 4, nil, &size, nil, 0) == 0, size > 0 else { return [] }
        let count = size / MemoryLayout<kinfo_proc>.stride + 16
        var buf = [kinfo_proc](repeating: kinfo_proc(), count: count)
        size = count * MemoryLayout<kinfo_proc>.stride
        guard sysctl(&mib, 4, &buf, &size, nil, 0) == 0 else { return [] }
        let n = size / MemoryLayout<kinfo_proc>.stride
        return buf.prefix(n).map { kp in
            var comm = kp.kp_proc.p_comm
            let name = withUnsafeBytes(of: &comm) { raw in
                String(decoding: raw.prefix(while: { $0 != 0 }), as: UTF8.self)
            }
            let tv = kp.kp_proc.p_un.__p_starttime
            return Proc(
                pid: kp.kp_proc.p_pid, ppid: kp.kp_eproc.e_ppid, name: name,
                startedAt: Double(tv.tv_sec) + Double(tv.tv_usec) / 1e6)
        }
    }

    static func workingDirectory(_ pid: pid_t) -> String? {
        var info = proc_vnodepathinfo()
        let size = Int32(MemoryLayout<proc_vnodepathinfo>.size)
        guard proc_pidinfo(pid, PROC_PIDVNODEPATHINFO, 0, &info, size) == size else { return nil }
        var path = info.pvi_cdir.vip_path
        return withUnsafeBytes(of: &path) { raw in
            String(decoding: raw.prefix(while: { $0 != 0 }), as: UTF8.self)
        }
    }
}
