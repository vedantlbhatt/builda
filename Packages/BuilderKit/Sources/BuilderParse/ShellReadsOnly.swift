import Foundation

/// Whether a shell command, WHOLE, can only read.
///
/// The Python half is `analysis/digest.py` `shell_reads_only`, and the two are held to one
/// answer by `spec/fixtures/digest/reads_only.json`, which the Python writes and
/// `ShellReadsOnlyTests` reads. It is decided on the FULL command, by the loader that has it,
/// because the digest keeps `SessionDigest.commandMax` (160) characters of a command: FOUND
/// IN REVIEW (2026-09-14), 10,313 of the 14,100 shell calls under ~/.claude/projects are longer
/// than that, and a rule that read the kept text had to refuse every cut one, so a read only
/// `cd … && grep -rn … | head -40 && git log …` with an absolute path counted as a possible
/// write. Two counters for one number is the same bug as a wrong number (CLAUDE.md), so this
/// is a port line for line, not a second opinion.
///
/// The membership of the lists is an ALLOWLIST, for the reason CLAUDE.md gives for sidecar
/// discovery: a program missing from it only makes a stretch unreadable, never "nothing was
/// written", which is the safe way to be wrong.
extension ShellFileEffect {

    static let readOnlyPrograms: Set<String> = [
        "[", "[[", "ack", "ag", "awk", "base64", "basename", "cat", "cd", "cmp", "column",
        "comm", "cut", "date", "df", "diff", "dig", "dirname", "du", "echo", "egrep", "exit",
        "export", "false", "fd", "fgrep", "file", "find", "fold", "git", "grep", "head",
        "hexdump", "host", "hostname", "id", "ifconfig", "jq", "kill", "less", "ls", "lsof",
        "md5", "md5sum", "more", "netstat", "nl", "nslookup", "od", "pgrep", "ping", "pkill",
        "printenv", "printf", "ps", "pwd", "read", "readlink", "realpath", "rev", "rg", "sed",
        "seq", "sha256sum", "shasum", "sleep", "sort", "stat", "strings", "sw_vers", "tail",
        "test", "tr", "tree", "true", "type", "uname", "uniq", "unset", "uptime", "vm_stat",
        "wait", "wc", "which", "whereis", "whoami", "xxd", "curl",
    ]

    /// git subcommands that only read. `git commit` is work the digest sees.
    static let readOnlyGit: Set<String> = [
        "blame", "cat-file", "check-ignore", "count-objects", "describe", "diff", "fetch",
        "for-each-ref", "grep", "help", "log", "ls-files", "ls-remote", "ls-tree",
        "merge-base", "name-rev", "rev-list", "rev-parse", "shortlog", "show", "status",
        "version",
    ]

    /// The listing forms of the git subcommands that can also write.
    static let gitListing: [String: Set<String>] = [
        "branch": ["-a", "-r", "-v", "-vv", "--all", "--remotes", "--list", "--show-current"],
        "remote": ["-v", "show", "get-url"],
        "stash": ["list", "show"],
        "tag": ["-l", "--list"],
        "worktree": ["list"],
        "config": ["--get", "--get-all", "--get-regexp", "--list", "-l"],
    ]
    /// The ones that only list when run bare. A bare `git stash` PUSHES.
    static let gitListsBare: Set<String> = ["branch", "remote", "tag"]

    /// Flags that turn a reading program into a writing one.
    static let writingFlags: [String: NSRegularExpression] = [
        "sed": readRegex(#"^(-i|--in-place)"#),
        "find": readRegex(#"^-(exec|execdir|ok|okdir|delete|fprint|fprint0|fprintf|fls)$"#),
        "curl": readRegex(#"^(-\w*[oO]|--output|--remote-name\S*|-J)$"#),
        "sort": readRegex(#"^(-o|--output)"#),
    ]

    /// Writes a program can make from inside its own script: awk's `print > "f"`, a pipe out
    /// or `system()`, and sed's `w file` command.
    static let writesInside: [String: NSRegularExpression] = [
        "awk": readRegex(#">|system\s*\(|\|\s*["']"#),
        "sed": readRegex(#"(^|[\s;{}/'"])[wW]\s+\S"#),
    ]

    static let shellKeywords: Set<String> = ["do", "then", "else", "elif", "if", "while", "until", "!", "time", "{", "}"]
    static let shellNoops: Set<String> = ["done", "fi", "for"]
    static let assignment = readRegex(#"^[A-Za-z_]\w*="#)

    /// Redirections that write no file: into /dev/null, one descriptor onto another, and the
    /// here string and heredoc openers.
    static let harmlessRedirect = readRegex(
        #"[&\d]?>{1,2}\s*/dev/null\b|\d?>&\d|&>\s*/dev/null\b|<<<|<<-?\s*['"]?\w+['"]?"#)

    /// `digest.shell_reads_only`. Empty is not read only: nothing ran that could be proven to.
    public static func readsOnly(_ command: String) -> Bool {
        if command.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return false }
        let lines = command.components(separatedBy: "\n")
        for i in commandLines(lines) {
            guard let commands = splitCommands(lines[i]),
                commands.allSatisfy(simpleReads)
            else { return false }
        }
        return true
    }

    /// `digest._split_commands`: one command line cut into the simple commands it RUNS, or
    /// nil when it writes a file through a redirection. Quote aware; a command substitution
    /// runs even inside double quotes, and what follows its close is data up to the next
    /// separator. Walked on Unicode scalars, which is what a Python `str` indexes.
    static func splitCommands(_ raw: String) -> [String]? {
        let ns = raw as NSString
        let line = harmlessRedirect.stringByReplacingMatches(
            in: raw, range: NSRange(location: 0, length: ns.length), withTemplate: " ")
        let cs = Array(line.unicodeScalars)
        var out: [String] = []
        var buf = String.UnicodeScalarView()
        var data = false
        var quote: Unicode.Scalar? = nil
        var tick = false
        var i = 0
        let n = cs.count

        func cut(_ nextIsData: Bool) {
            if !data { out.append(String(buf)) }
            buf = String.UnicodeScalarView()
            data = nextIsData
        }

        while i < n {
            let c = cs[i]
            if quote == "'" {
                if c == "'" { quote = nil }
                buf.append(c)
                i += 1
                continue
            }
            if c == "\\" && i + 1 < n {
                buf.append(c)
                buf.append(cs[i + 1])
                i += 2
                continue
            }
            if c == "$" && i + 1 < n && cs[i + 1] == "(" {
                cut(false)
                i += 2
                continue
            }
            if c == "`" {
                tick.toggle()
                cut(!tick)
                i += 1
                continue
            }
            if c == ")" {
                cut(true)
                i += 1
                continue
            }
            if quote == "\"" {
                if c == "\"" { quote = nil }
                buf.append(c)
                i += 1
                continue
            }
            if c == "'" || c == "\"" {
                quote = c
                buf.append(c)
                i += 1
                continue
            }
            if c == ">" { return nil }  // a file is written: the harmless forms were removed above
            if c == ";" || c == "|" || c == "&" || c == "(" {
                cut(false)
                i += (i + 1 < n && cs[i + 1] == c && (c == "|" || c == "&")) ? 2 : 1
                continue
            }
            buf.append(c)
            i += 1
        }
        cut(false)
        return out.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }

    /// `digest._simple_reads`: whether one simple command can only read.
    static func simpleReads(_ command: String) -> Bool {
        var words = command.split(whereSeparator: { $0.isWhitespace }).map(String.init)
        while let w = words.first, shellKeywords.contains(w) || matches(assignment, w) {
            words.removeFirst()
        }
        if words.first == "env" {
            words = words.dropFirst().filter { !matches(assignment, $0) }
        }
        if words.first == "timeout" {
            words = Array(words.dropFirst(2))
        }
        guard let first = words.first else { return true }
        if shellNoops.contains(first) || first.hasPrefix("#") { return true }
        let prog = first.split(separator: "/", omittingEmptySubsequences: false).last.map(String.init) ?? first
        guard readOnlyPrograms.contains(prog) else { return false }
        let args = Array(words.dropFirst())
        if let flags = writingFlags[prog],
            args.contains(where: { matches(flags, $0.trimmingCharacters(in: CharacterSet(charactersIn: "'\""))) })
        {
            return false
        }
        if let inside = writesInside[prog], search(inside, args.joined(separator: " ")) {
            return false
        }
        if prog != "git" { return true }
        var rest = args
        while let w = rest.first, w.hasPrefix("-") {
            rest = Array(rest.dropFirst(w == "-C" || w == "-c" ? 2 : 1))
        }
        guard let sub = rest.first else { return true }
        let subArgs = Array(rest.dropFirst())
        if readOnlyGit.contains(sub) { return true }
        guard let listing = gitListing[sub], !(subArgs.isEmpty && !gitListsBare.contains(sub)) else {
            return false
        }
        return subArgs.allSatisfy { listing.contains($0) }
    }

    /// Python's `re.match`: anchored at the start (every pattern here is anchored anyway).
    private static func matches(_ re: NSRegularExpression, _ s: String) -> Bool {
        let ns = s as NSString
        return re.firstMatch(in: s, options: [.anchored], range: NSRange(location: 0, length: ns.length)) != nil
    }

    /// Python's `re.search`.
    private static func search(_ re: NSRegularExpression, _ s: String) -> Bool {
        let ns = s as NSString
        return re.firstMatch(in: s, range: NSRange(location: 0, length: ns.length)) != nil
    }

    private static func readRegex(_ pattern: String) -> NSRegularExpression {
        do {
            return try NSRegularExpression(pattern: pattern)
        } catch {
            preconditionFailure("invalid read-only regex \(pattern): \(error)")
        }
    }
}
