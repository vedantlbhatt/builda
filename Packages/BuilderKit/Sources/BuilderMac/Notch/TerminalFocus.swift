import AppKit
import BuilderUI
import Darwin

/// Clicking a waiting agent takes you to it: the app that owns its terminal, brought to the
/// front, or failing that its transcript shown in Finder.
///
/// How the app is found, and why it is not guessed from a list of terminal names: every
/// Claude Code process is named `claude` (MEASURED here: `/Users/…/.local/bin/claude`, one per
/// open session), its working directory is the session's, and walking its parents reaches the
/// app that started the shell it runs in (here, cmux; elsewhere Terminal, iTerm2, Ghostty,
/// Warp, or an editor's terminal). The first ancestor that is a regular app is the answer, so
/// a terminal nobody has heard of works the same as Terminal.app.
enum TerminalFocus {

    /// Bring the agent's terminal forward. Returns false when none was found, after revealing
    /// the transcript instead.
    @discardableResult
    static func open(_ agent: IslandAgent) -> Bool {
        if let cwd = agent.cwd, let app = owningApp(cwd: cwd) {
            app.activate(options: [.activateAllWindows])
            return true
        }
        if let path = agent.transcriptPath {
            NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
        }
        return false
    }

    static func owningApp(cwd: String) -> NSRunningApplication? {
        let procs = processes()
        let byPID = Dictionary(procs.map { ($0.pid, $0) }, uniquingKeysWith: { a, _ in a })
        let target = (cwd as NSString).standardizingPath
        // Newest first: when two sessions share a directory the latest is the likelier one.
        for p in procs.filter({ $0.name == "claude" }).sorted(by: { $0.pid > $1.pid }) {
            guard let dir = workingDirectory(p.pid),
                  (dir as NSString).standardizingPath == target
            else { continue }
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

    struct Proc {
        let pid: pid_t
        let ppid: pid_t
        let name: String
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
            return Proc(pid: kp.kp_proc.p_pid, ppid: kp.kp_eproc.e_ppid, name: name)
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
