import BuilderIngest
import Foundation
import Testing

/// What the notch island reads off the end of a running transcript. The records are the
/// shapes Claude Code writes (checked against this machine's transcripts, LiveTail's header);
/// each test is one rule, and the wrong answer for each is a plausible sentence on the notch.
@Suite("Live tail")
struct LiveTailTests {

    static let t0 = 1_800_000_000.0

    static func iso(_ t: Double) -> String {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.string(from: Date(timeIntervalSince1970: t))
    }

    static func line(_ obj: [String: Any]) -> Data {
        try! JSONSerialization.data(withJSONObject: obj)
    }

    static func prompt(_ text: String, at t: Double) -> Data {
        line(["type": "user", "timestamp": iso(t), "cwd": "/tmp/repo",
              "message": ["role": "user", "content": text]])
    }

    static func assistant(text: String? = nil, tool: (id: String, name: String, input: [String: Any])? = nil,
                          stop: String?, at t: Double) -> Data {
        var content: [[String: Any]] = []
        if let text { content.append(["type": "text", "text": text]) }
        if let tool { content.append(["type": "tool_use", "id": tool.id, "name": tool.name, "input": tool.input]) }
        var message: [String: Any] = ["role": "assistant", "content": content]
        message["stop_reason"] = stop ?? NSNull()
        return line(["type": "assistant", "timestamp": iso(t), "message": message])
    }

    static func result(_ id: String, _ text: String = "ok", at t: Double) -> Data {
        line(["type": "user", "timestamp": iso(t),
              "message": ["role": "user", "content": [["type": "tool_result", "tool_use_id": id, "content": text]]]])
    }

    @Test("an assistant message with end_turn is the turn handed back")
    func turnEnded() {
        let lines = [
            Self.prompt("fix the build", at: Self.t0),
            Self.assistant(tool: ("t1", "Bash", ["command": "swift build"]), stop: "tool_use", at: Self.t0 + 2),
            Self.result("t1", at: Self.t0 + 20),
            Self.assistant(text: "Fixed it. Should I also bump the version?", stop: "end_turn", at: Self.t0 + 25),
        ]
        let t = LiveTail.turn(lines: lines, now: Self.t0 + 100)
        #expect(t.waiting == .turnEnded)
        #expect(t.waitingSince == Self.t0 + 25)
        #expect(t.detail == "Should I also bump the version?")
        #expect(t.activity == nil)
    }

    @Test("a long Bash call with no result is running, never waiting (live.py rule 1)")
    func longBashIsRunning() {
        let lines = [
            Self.prompt("run the tests", at: Self.t0),
            Self.assistant(tool: ("t1", "Bash", ["command": "swift test --parallel"]), stop: "tool_use", at: Self.t0 + 1),
        ]
        let t = LiveTail.turn(lines: lines, now: Self.t0 + 90)
        #expect(t.waiting == nil)
        #expect(t.activity == "Running the tests")
    }

    @Test("an edit unanswered past any measured edit time is a permission prompt")
    func pendingEditIsPermission() {
        let lines = [
            Self.prompt("rename it", at: Self.t0),
            Self.assistant(tool: ("e1", "Edit", ["file_path": "/tmp/repo/Sources/App.swift"]), stop: "tool_use", at: Self.t0 + 3),
        ]
        let early = LiveTail.turn(lines: lines, now: Self.t0 + 3 + LiveTail.permissionAfterSeconds - 1)
        #expect(early.waiting == nil)
        #expect(early.activity == "Editing App.swift")
        let late = LiveTail.turn(lines: lines, now: Self.t0 + 3 + LiveTail.permissionAfterSeconds + 1)
        #expect(late.waiting == .permission)
        #expect(late.detail == "App.swift")
    }

    @Test("an unanswered AskUserQuestion is a question, with its words")
    func askingToolAsks() {
        let lines = [
            Self.assistant(tool: ("q1", "AskUserQuestion",
                                  ["questions": [["question": "Which database should it use?\nPostgres or SQLite"]]]),
                           stop: "tool_use", at: Self.t0),
        ]
        let t = LiveTail.turn(lines: lines, now: Self.t0 + 1)
        #expect(t.waiting == .question)
        #expect(t.detail == "Which database should it use?")
    }

    @Test("a turn ended with its own background job out is not your turn")
    func backgroundOut() {
        let lines = [
            Self.assistant(tool: ("b1", "Bash", ["command": "make long", "run_in_background": true]), stop: "tool_use", at: Self.t0),
            Self.result("b1", "Command running in background with ID: x1", at: Self.t0 + 1),
            Self.assistant(text: "Started the build. I will check on it.", stop: "end_turn", at: Self.t0 + 2),
        ]
        let out = LiveTail.turn(lines: lines, now: Self.t0 + 30)
        #expect(out.waiting == nil)
        #expect(out.activity == "Waiting on its background job")

        // Once the job reports back (a queued task notification naming the launch), the turn
        // that ended afterwards is the person's.
        let reported = lines + [
            Self.line(["type": "queue-operation", "operation": "enqueue", "timestamp": Self.iso(Self.t0 + 40),
                       "content": "<task-notification>\n<tool-use-id>b1</tool-use-id>\n<status>completed</status>"]),
            Self.assistant(text: "The build passed.", stop: "end_turn", at: Self.t0 + 45),
        ]
        #expect(LiveTail.turn(lines: reported, now: Self.t0 + 60).waiting == .turnEnded)
    }

    @Test("a turn that ends on a question is yours even with a job out")
    func questionBeatsBackground() {
        let lines = [
            Self.assistant(tool: ("a1", "Agent", ["prompt": "survey"]), stop: "tool_use", at: Self.t0),
            Self.result("a1", "Async agent launched successfully.", at: Self.t0 + 1),
            Self.assistant(text: "While that runs: do you want the old API kept?", stop: "end_turn", at: Self.t0 + 2),
        ]
        #expect(LiveTail.turn(lines: lines, now: Self.t0 + 10).waiting == .turnEnded)
    }

    @Test("an interrupt hands the turn back")
    func interrupt() {
        let lines = [
            Self.assistant(tool: ("t1", "Bash", ["command": "rm -rf build"]), stop: "tool_use", at: Self.t0),
            Self.line(["type": "user", "timestamp": Self.iso(Self.t0 + 1),
                       "message": ["role": "user", "content": [["type": "text", "text": "[Request interrupted by user]"]]]]),
        ]
        #expect(LiveTail.turn(lines: lines, now: Self.t0 + 5).waiting == .turnEnded)
    }

    @Test("a stale result with nothing after it is thinking; long silence is idle")
    func thinkingAndIdle() {
        let lines = [
            Self.assistant(tool: ("r1", "Read", ["file_path": "/a/b.swift"]), stop: "tool_use", at: Self.t0),
            Self.result("r1", at: Self.t0 + 0.1),
        ]
        #expect(LiveTail.turn(lines: lines, now: Self.t0 + 2).activity == "Reading b.swift")
        #expect(LiveTail.turn(lines: lines, now: Self.t0 + 30).activity == "Thinking")
        #expect(LiveTail.turn(lines: lines, now: Self.t0 + 400).activity == "Idle")
    }

    @Test("sidechain and meta records are not the conversation")
    func ignoresSidechainAndMeta() {
        let lines = [
            Self.assistant(text: "Done. Anything else?", stop: "end_turn", at: Self.t0),
            Self.line(["type": "user", "isMeta": true, "timestamp": Self.iso(Self.t0 + 1),
                       "message": ["role": "user", "content": "<local-command-stdout>x</local-command-stdout>"]]),
            Self.line(["type": "assistant", "isSidechain": true, "timestamp": Self.iso(Self.t0 + 2),
                       "message": ["role": "assistant", "stop_reason": "tool_use", "content": []]]),
        ]
        #expect(LiveTail.turn(lines: lines, now: Self.t0 + 5).waiting == .turnEnded)
    }

    @Test("a half written last line is never read")
    func partialTrailingLine() throws {
        let path = NSTemporaryDirectory() + "livetail-\(UUID().uuidString).jsonl"
        var body = Data()
        body.append(Self.assistant(text: "All done. Ship it?", stop: "end_turn", at: Self.t0))
        body.append(Data("\n".utf8))
        // The agent has started writing its next record: a tool call, cut mid line.
        body.append(Data(#"{"type":"assistant","timestamp":"2027-01-15T08:00:00.000Z","message":{"stop_reason":"tool_use","content":[{"type":"tool_use","id":"z","name":"Ba"#.utf8))
        try body.write(to: URL(fileURLWithPath: path))
        defer { try? FileManager.default.removeItem(atPath: path) }
        let t = LiveTail.read(path: path, now: Self.t0 + 5)
        #expect(t?.waiting == .turnEnded)
    }
}
