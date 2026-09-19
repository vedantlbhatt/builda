import Foundation

/// What a running Claude Code transcript's last records say: is the agent working, and on
/// what, or is it waiting on the person.
///
/// The Mac's island asks this of every running agent, and it has no network: this reads the
/// file on disk. The rules are `analysis/live.py`'s (`_turn_ended`, `_activity`), which the
/// phone's mission control already runs on, so the notch and the phone name the same wait:
///
/// 1. **Only the harness saying so hands the turn back.** A transcript whose last meaningful
///    record is an assistant message with `stop_reason` `end_turn` or `stop_sequence` (or an
///    interrupt) is waiting on the person. MEASURED on this machine's `~/.claude/projects`
///    (218 root transcripts, 2026-09-19): 35,291 assistant records, `tool_use` 32,826,
///    `end_turn` 2,383, `stop_sequence` 25 and no stop reason at all on 57, so the field is
///    there to be read; and 128 of the 218 transcripts end on `end_turn` text, which is what
///    a finished turn looks like at rest.
/// 2. **A long silence after a tool call is NOT waiting on you** (live.py rule 1): a permission
///    prompt and a long test run look the same in a transcript. Except where they cannot:
///    MEASURED on the same corpus, 970 Edit and Write calls, result p50 0.04 s, p99 0.58 s,
///    and not one took 5 s. A file edit with no result for `permissionAfterSeconds` is a
///    permission prompt. Bash cannot be read this way (p90 14.9 s, p99 311 s: tests and builds
///    are long), so a quiet Bash call stays "Running", never "waiting".
/// 3. **A tool built for asking is asking.** `AskUserQuestion` and `ExitPlanMode` with no
///    result are the agent waiting on an answer by definition.
/// 4. **A turn handed back with its own work still out is not your turn** (live.py
///    `BACKGROUND_BASIS`, FOUND IN REVIEW there): an agent that launched a background shell,
///    a subagent or a workflow and ended its turn is waiting on its job, and Claude Code
///    wakes it when the job reports back. A launch is known by its result ("Async agent
///    launched successfully", "Command running in background"), and its report by a record
///    carrying `<tool-use-id>` of the launch (a queued task notification). Unless the turn
///    ended on a question, which is the person's turn whatever is still running.
///
/// LOCAL ONLY: file names, the question and the last thing the agent said are shown on this
/// Mac and never leave it. Nothing here is on any wire.
public enum LiveTail {

    public struct Turn: Equatable, Sendable {
        public enum Waiting: String, Sendable { case turnEnded, question, permission }

        /// "Editing IslandView.swift", "Running the tests", "Thinking". nil when waiting.
        public var activity: String?
        public var waiting: Waiting?
        /// When the wait began (unix seconds).
        public var waitingSince: Double?
        /// What it is waiting on, in a line.
        public var detail: String?
        /// The newest timestamp seen in the tail.
        public var lastTs: Double?
        public var cwd: String?
    }

    /// An edit with no result for this long is a permission prompt (rule 2). The measured
    /// maximum is under 5 s; this is that bound, not a margin on top of it.
    public static let permissionAfterSeconds: Double = 5

    /// live.py `THINKING_MIN_SEC`: a result older than the p90 record gap (13 s) with nothing
    /// after it is the agent composing its next step.
    public static let thinkingAfterSeconds: Double = 13

    /// live.py `IDLE_SEC`: past the p99 record gap (171 s) the silence is not the agent's.
    public static let idleAfterSeconds: Double = 180

    /// The stop reasons that hand the turn back (live.py `TURN_ENDED_STOPS`).
    public static let turnEndedStops: Set<String> = ["end_turn", "stop_sequence"]

    /// Tools that exist to ask the person something.
    public static let askingTools: Set<String> = ["AskUserQuestion", "ExitPlanMode"]

    /// Tools whose result is measured to arrive in under a second (rule 2).
    public static let instantTools: Set<String> = ["Edit", "Write", "MultiEdit", "NotebookEdit"]

    /// `quality.TEST_CMD`, the same words in the same order.
    static let testCommand = try! NSRegularExpression(
        pattern: #"(?<![\w/.-])(pytest|bun test|npm test|swift test|jest|cargo test|go test|make test)\b"#)

    /// Read the end of the transcript at `path` and say what it is doing.
    public static func read(path: String, now: Double = Date().timeIntervalSince1970) -> Turn? {
        guard let lines = tailLines(path: path) else { return nil }
        return turn(lines: lines, now: now)
    }

    /// Complete lines from the end of the file, oldest first. The window grows until it holds
    /// a dozen whole records or reaches 4 MB: one tool result can be hundreds of kilobytes.
    /// The last line is dropped unless the file ends in a newline, because a transcript being
    /// written is routinely half a line long at its end, and the first line of the window is
    /// dropped because it almost always starts mid record.
    static func tailLines(path: String) -> [Data]? {
        guard let fh = FileHandle(forReadingAtPath: path) else { return nil }
        defer { try? fh.close() }
        guard let size = try? fh.seekToEnd(), size > 0 else { return [] }
        var window: UInt64 = 128 * 1024
        while true {
            let start = size > window ? size - window : 0
            try? fh.seek(toOffset: start)
            guard let data = try? fh.read(upToCount: Int(size - start)) else { return nil }
            var parts = data.split(separator: UInt8(ascii: "\n"), omittingEmptySubsequences: false)
            if data.last != UInt8(ascii: "\n") { parts.removeLast() } else if parts.last?.isEmpty == true { parts.removeLast() }
            if start > 0, !parts.isEmpty { parts.removeFirst() }
            let lines = parts.filter { !$0.isEmpty }.map { Data($0) }
            if lines.count >= 12 || start == 0 || window >= 4 * 1024 * 1024 { return lines }
            window *= 4
        }
    }

    struct ToolCall {
        let id: String
        let name: String
        let input: [String: Any]
        let ts: Double
    }

    /// The rules, over parsed lines. Separate from the file so a test can hand it records.
    public static func turn(lines: [Data], now: Double) -> Turn {
        var out = Turn()
        var pending: [String: ToolCall] = [:]
        var lastTool: ToolCall?
        var lastResultTs: Double?
        var launched = Set<String>()
        var reported = Set<String>()
        // The last meaningful record: an assistant message (with its stop reason and text), a
        // tool result, a prompt or an interrupt.
        enum Last { case assistant(stop: String?, text: String?, ts: Double), result(ts: Double), prompt(ts: Double), interrupt(ts: Double) }
        var last: Last?

        for line in lines {
            // A task notification can arrive as a queue operation, an attachment or a user
            // record, so its launch id is read off the raw line whatever the shape.
            if line.range(of: toolUseIDMarker) != nil { reported.formUnion(notifiedIDs(line)) }
            guard let obj = try? JSONSerialization.jsonObject(with: line) as? [String: Any] else { continue }
            if (obj["isSidechain"] as? Bool) == true { continue }
            let type = obj["type"] as? String
            guard type == "assistant" || type == "user" else { continue }
            if (obj["isMeta"] as? Bool) == true { continue }
            let ts = timestamp(obj["timestamp"]) ?? out.lastTs ?? now
            out.lastTs = max(out.lastTs ?? 0, ts)
            if let cwd = obj["cwd"] as? String { out.cwd = cwd }
            let message = obj["message"] as? [String: Any]
            let content = message?["content"]

            if type == "assistant" {
                var text: String?
                if let blocks = content as? [[String: Any]] {
                    for b in blocks {
                        switch b["type"] as? String {
                        case "text":
                            if let t = b["text"] as? String, !t.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { text = t }
                        case "tool_use":
                            let call = ToolCall(
                                id: b["id"] as? String ?? UUID().uuidString, name: b["name"] as? String ?? "",
                                input: b["input"] as? [String: Any] ?? [:], ts: ts)
                            pending[call.id] = call
                            lastTool = call
                        default:
                            break
                        }
                    }
                } else if let s = content as? String {
                    text = s
                }
                last = .assistant(stop: message?["stop_reason"] as? String, text: text, ts: ts)
                continue
            }

            // user: a tool result, an interrupt, or a prompt.
            if let blocks = content as? [[String: Any]] {
                var sawResult = false
                for b in blocks where (b["type"] as? String) == "tool_result" {
                    sawResult = true
                    guard let id = b["tool_use_id"] as? String else { continue }
                    if let call = pending.removeValue(forKey: id), isBackgroundLaunch(call, result: b["content"]) {
                        launched.insert(id)
                    }
                }
                if sawResult {
                    lastResultTs = ts
                    last = .result(ts: ts)
                    continue
                }
                let text = blocks.compactMap { $0["text"] as? String }.joined(separator: " ")
                last = text.hasPrefix("[Request interrupted by user") ? .interrupt(ts: ts) : .prompt(ts: ts)
            } else if let s = content as? String {
                last = s.hasPrefix("[Request interrupted by user") ? .interrupt(ts: ts) : .prompt(ts: ts)
            }
        }

        // 3. A pending tool built for asking.
        if let ask = pending.values.filter({ askingTools.contains($0.name) }).max(by: { $0.ts < $1.ts }) {
            out.waiting = .question
            out.waitingSince = ask.ts
            out.detail = question(of: ask)
            return out
        }
        // 2. A pending file edit older than any edit has ever taken.
        if let edit = pending.values.filter({ instantTools.contains($0.name) }).max(by: { $0.ts < $1.ts }),
           now - edit.ts >= permissionAfterSeconds {
            out.waiting = .permission
            out.waitingSince = edit.ts
            out.detail = (edit.input["file_path"] as? String ?? edit.input["notebook_path"] as? String)
                .map { ($0 as NSString).lastPathComponent }
            return out
        }
        // 1. The turn was handed back.
        switch last {
        case .assistant(let stop, let text, let ts) where stop.map(turnEndedStops.contains) == true:
            let said = text.map(lastSentence)
            let outstanding = launched.subtracting(reported).count
            // 4. Its own work is still out and it did not end on a question: not your turn.
            if outstanding > 0, stop == "end_turn", said?.hasSuffix("?") != true {
                out.activity = outstanding == 1
                    ? "Waiting on its background job" : "Waiting on \(outstanding) background jobs"
                return out
            }
            out.waiting = .turnEnded
            out.waitingSince = ts
            out.detail = said
            return out
        case .interrupt(let ts):
            out.waiting = .turnEnded
            out.waitingSince = ts
            out.detail = "You stopped it"
            return out
        default:
            break
        }

        // Working: what on.
        let lastOutput = max(out.lastTs ?? 0, lastResultTs ?? 0)
        if now - lastOutput >= idleAfterSeconds {
            out.activity = "Idle"
        } else if case .prompt = last {
            out.activity = "Thinking"
        } else if let tool = lastTool, pending[tool.id] != nil {
            out.activity = sentence(for: tool)
        } else if let r = lastResultTs, now - r >= thinkingAfterSeconds {
            out.activity = "Thinking"
        } else if let tool = lastTool {
            out.activity = sentence(for: tool)
        } else {
            out.activity = "Thinking"
        }
        return out
    }

    static let toolUseIDMarker = Data("<tool-use-id>".utf8)

    static let toolUseIDPattern = try! NSRegularExpression(pattern: #"<tool-use-id>([A-Za-z0-9_\-]+)</tool-use-id>"#)

    static func notifiedIDs(_ line: Data) -> Set<String> {
        // A JSON writer may escape "/" as "\/" (Foundation's does; Node's does not), so the
        // closing tag is read either way.
        let s = String(decoding: line, as: UTF8.self).replacingOccurrences(of: "\\/", with: "/")
        var out = Set<String>()
        for m in toolUseIDPattern.matches(in: s, range: NSRange(s.startIndex..., in: s)) {
            if let r = Range(m.range(at: 1), in: s) { out.insert(String(s[r])) }
        }
        return out
    }

    /// Whether a finished call only STARTED work that reports back later. MEASURED in this
    /// machine's transcripts: every background shell's result reads "Command running in
    /// background with ID", every background agent's "Async agent launched successfully";
    /// live.py measured "Workflow launched in background" and "Monitor started".
    static func isBackgroundLaunch(_ call: ToolCall, result: Any?) -> Bool {
        if (call.input["run_in_background"] as? Bool) == true { return true }
        if call.name == "Workflow" || call.name == "Monitor" { return true }
        let text: String
        if let s = result as? String {
            text = s
        } else if let blocks = result as? [[String: Any]] {
            text = blocks.compactMap { $0["text"] as? String }.joined(separator: " ")
        } else {
            return false
        }
        return text.hasPrefix("Async agent launched") || text.hasPrefix("Command running in background")
    }

    /// One short sentence for one tool call, in the phone's words where it has them.
    static func sentence(for call: ToolCall) -> String {
        let file = (call.input["file_path"] as? String ?? call.input["notebook_path"] as? String)
            .map { ($0 as NSString).lastPathComponent }
        switch call.name {
        case "Read": return file.map { "Reading \($0)" } ?? "Reading"
        case "Edit", "MultiEdit", "NotebookEdit": return file.map { "Editing \($0)" } ?? "Editing"
        case "Write": return file.map { "Writing \($0)" } ?? "Writing"
        case "Grep", "Glob", "LS": return "Searching the code"
        case "Task", "Agent": return "Handing work to an agent"
        case "WebFetch", "WebSearch": return "Reading the web"
        case "TodoWrite": return "Planning"
        case "Bash":
            let cmd = call.input["command"] as? String ?? ""
            let range = NSRange(cmd.startIndex..., in: cmd)
            if testCommand.firstMatch(in: cmd, range: range) != nil { return "Running the tests" }
            if cmd.contains("git commit") { return "Committing" }
            if cmd.contains("git push") { return "Pushing" }
            if cmd.contains(" build") || cmd.hasPrefix("make") || cmd.contains("xcodebuild") { return "Building" }
            return "Running a command"
        default:
            if call.name.hasPrefix("mcp__") { return "Using a connected tool" }
            return "Working"
        }
    }

    /// The question an asking tool put to the person, or the plan's first line.
    static func question(of call: ToolCall) -> String? {
        if let qs = call.input["questions"] as? [[String: Any]], let q = qs.first?["question"] as? String {
            return firstLine(q)
        }
        if let q = call.input["question"] as? String { return firstLine(q) }
        if call.name == "ExitPlanMode" { return "Approve the plan" }
        return nil
    }

    /// The last sentence of what the agent said, which is where a turn that ends on a question
    /// asks it. Cut at 140 characters.
    static func lastSentence(_ text: String) -> String {
        let flat = text.replacingOccurrences(of: "\n", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        var sentences: [String] = []
        flat.enumerateSubstrings(in: flat.startIndex..., options: .bySentences) { s, _, _, _ in
            if let s = s?.trimmingCharacters(in: .whitespaces), !s.isEmpty { sentences.append(s) }
        }
        let pick = sentences.last(where: { $0.count > 3 }) ?? flat
        return pick.count > 140 ? String(pick.prefix(139)) + "…" : pick
    }

    static func firstLine(_ s: String) -> String {
        let line = s.split(separator: "\n").first.map(String.init) ?? s
        return line.count > 140 ? String(line.prefix(139)) + "…" : line
    }

    static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    static let isoPlain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    static func timestamp(_ value: Any?) -> Double? {
        guard let s = value as? String else { return nil }
        return (iso.date(from: s) ?? isoPlain.date(from: s))?.timeIntervalSince1970
    }
}
