import BuilderAnalysis
import BuilderParse
import Foundation
import Testing

/// Whether a shell command, whole, can only read: the Swift twin gives the Python's answer.
///
/// `analysis/digest.py` `shell_reads_only` decides it on the FULL command at parse time
/// (`Ev.reads_only`), because the digest keeps 160 characters of a command and 10,313 of the
/// 14,100 shell calls under ~/.claude/projects are longer (FOUND IN REVIEW, 2026-09-14). Two
/// counters for one number is the same bug as a wrong number (CLAUDE.md), so
/// `spec/fixtures/digest/reads_only.json`, which `scripts/gen_copy.py` writes with Python's
/// answers, holds this one to them case for case.
@Suite("Read only shell commands, one answer in Swift and Python")
struct ShellReadsOnlyTests {

    struct Case: Decodable {
        let command: String
        let reads_only: Bool
    }

    static var fixture: URL? {
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        for _ in 0..<8 {
            let candidate = dir.appendingPathComponent("spec/fixtures/digest/reads_only.json")
            if FileManager.default.fileExists(atPath: candidate.path) { return candidate }
            dir = dir.deletingLastPathComponent()
        }
        return nil
    }

    @Test func everyCaseGetsThePythonsAnswer() throws {
        let url = try #require(Self.fixture)
        let cases = try JSONDecoder().decode([Case].self, from: Data(contentsOf: url))
        #expect(cases.count > 40)
        #expect(cases.contains { $0.reads_only } && cases.contains { !$0.reads_only })
        for c in cases {
            #expect(ShellFileEffect.readsOnly(c.command) == c.reads_only, "\(c.command)")
        }
    }

    /// The digest's own event carries the decision from the whole command, even though its
    /// text keeps only the first 160 characters.
    @Test func theDigestDecidesOnTheWholeCommand() throws {
        let read =
            "cd /Users/someone/Downloads/projects/tramline/backend && grep -rn \"shadow_walk\" --include=*.py "
            + "services/ routes/ | head -40 && git log --oneline -20 -- services/route_service.py"
        let write = read + " && ./scripts/regen_routes.sh > services/route_table.py"
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("reads-only-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let path = dir.appendingPathComponent("00000000-0000-4000-8000-0000000000aa.jsonl")
        var lines: [String] = []
        for (i, cmd) in [read, write].enumerated() {
            let input = String(data: try JSONSerialization.data(withJSONObject: ["command": cmd]), encoding: .utf8)!
            lines.append(
                "{\"type\":\"assistant\",\"uuid\":\"a\(i)\",\"parentUuid\":null,"
                    + "\"sessionId\":\"00000000-0000-4000-8000-0000000000aa\","
                    + "\"timestamp\":\"2026-09-14T10:00:0\(i).000Z\",\"cwd\":\"/r\","
                    + "\"message\":{\"role\":\"assistant\",\"model\":\"claude-opus-5\",\"id\":\"msg_\(i)\","
                    + "\"content\":[{\"type\":\"tool_use\",\"id\":\"tu_\(i)\",\"name\":\"Bash\",\"input\":\(input)}],"
                    + "\"usage\":{\"input_tokens\":1,\"output_tokens\":1}}}")
        }
        try (lines.joined(separator: "\n") + "\n").write(to: path, atomically: true, encoding: .utf8)
        let events = try SessionDigest.loadClaudeCodeEvents(paths: [path.path]).filter { $0.tool == "Bash" }
        #expect(events.count == 2)
        #expect(events.allSatisfy { $0.text.contains("…[+") })
        #expect(events.map(\.readsOnly) == [true, false])
    }
}
