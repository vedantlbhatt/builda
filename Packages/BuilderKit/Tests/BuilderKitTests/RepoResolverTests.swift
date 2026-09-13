import BuilderGit
import BuilderModel
import Foundation
import Testing

/// A session in a git WORKTREE commits to the worktree's own branch, and `GitEnricher.stats`
/// runs `git log` in the repository's common root (`--git-common-dir`), the main checkout,
/// whose HEAD never reaches that branch. FOUND IN REVIEW (2026-09-13), MEASURED on the
/// builder repository with one worktree beside it: from the common root, `git log
/// --since='2 days ago'` counted 0 commits and with `--branches` 32. `capture/repo.py` had the
/// same call; `capture/tests/test_worktree_commits.py` holds the Python half to the same repo.
@Suite("Repo resolver — worktree commits")
struct RepoResolverTests {

    static let clock = 1_789_300_000

    @discardableResult
    static func git(_ args: [String], cwd: URL, at: Int? = nil) throws -> String {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        p.arguments = ["git", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main"] + args
        p.currentDirectoryURL = cwd
        var env = ProcessInfo.processInfo.environment
        env["GIT_AUTHOR_NAME"] = "t"
        env["GIT_AUTHOR_EMAIL"] = "t@example.invalid"
        env["GIT_COMMITTER_NAME"] = "t"
        env["GIT_COMMITTER_EMAIL"] = "t@example.invalid"
        env["GIT_CONFIG_NOSYSTEM"] = "1"
        env["HOME"] = cwd.path
        if let at {
            env["GIT_AUTHOR_DATE"] = "@\(at) +0000"
            env["GIT_COMMITTER_DATE"] = "@\(at) +0000"
        }
        p.environment = env
        let out = Pipe()
        p.standardOutput = out
        p.standardError = Pipe()
        try p.run()
        let data = out.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        #expect(p.terminationStatus == 0, "git \(args.joined(separator: " ")) failed")
        return String(decoding: data, as: UTF8.self)
    }

    /// Two commits on the worktree's branch and one on main, all inside the window.
    static func repository() throws -> (main: URL, worktree: URL) {
        let base = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("repo-resolver-\(UUID().uuidString)")
            .resolvingSymlinksInPath()
        let main = base.appendingPathComponent("app")
        try FileManager.default.createDirectory(at: main, withIntermediateDirectories: true)
        try git(["init", "-q"], cwd: main)
        try "one\n".write(to: main.appendingPathComponent("a.txt"), atomically: true, encoding: .utf8)
        try git(["add", "a.txt"], cwd: main)
        try git(["commit", "-q", "-m", "first"], cwd: main, at: clock - 86_400)
        let wt = base.appendingPathComponent("app-feature")
        try git(["worktree", "add", "-q", "-b", "feature", wt.path], cwd: main)
        for i in 0..<2 {
            try String(repeating: "x\n", count: i + 3)
                .write(to: wt.appendingPathComponent("f\(i).txt"), atomically: true, encoding: .utf8)
            try git(["add", "f\(i).txt"], cwd: wt)
            try git(["commit", "-q", "-m", "feat: worktree change \(i)"], cwd: wt, at: clock + 60 * i)
        }
        try "b\n".write(to: main.appendingPathComponent("b.txt"), atomically: true, encoding: .utf8)
        try git(["add", "b.txt"], cwd: main)
        try git(["commit", "-q", "-m", "fix: on main"], cwd: main, at: clock + 300)
        return (main, wt)
    }

    /// MEASURED with this test's repository: before the fix `stats` from the common root
    /// counted 1 commit (the main checkout's own) and 1 inserted line; after, 3 and 8.
    @Test func aWorktreesCommitsAreCountedFromTheCommonRoot() throws {
        let (main, wt) = try Self.repository()
        defer { try? FileManager.default.removeItem(at: main.deletingLastPathComponent()) }
        let git = GitEnricher()
        let ident = try #require(git.identity(forWorkingDirectory: wt.path))
        let root = try #require(ident.commonRoot)
        #expect(URL(fileURLWithPath: root).resolvingSymlinksInPath().path == main.path)
        let s = git.stats(cwd: root, from: Double(Self.clock - 10), to: Double(Self.clock + 600))
        #expect(s.commits == 3)
        #expect(s.insertions == 3 + 4 + 1)
        #expect(s.filesChanged == 3)
    }

    @Test func theRefsAreEveryLocalBranchNeverAll() {
        #expect(Tuning.gitLogRefs == ["--branches"])
    }
}
