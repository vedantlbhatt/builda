import BuilderSync
import Foundation
import Testing

/// A link dropped on the notch is normalised exactly as the phone and the Python normalise it
/// (`drops/urls.py`, `mobile/src/drops/urls.ts`), because the server validates and never
/// rewrites: two opinions about one reel's link is two cards for one reel.
@Suite("Drop link")
struct DropLinkTests {

    /// The phone's parity cases (`mobile/__tests__/dropsUrls.test.ts`), with what
    /// `drops.urls.normalize` returned for each on 2026-09-19. Written out so this suite checks
    /// something on a machine with no Python; `matchesPythonLive` re-asks Python when there is one.
    static let cases: [(String, String, String)] = [
        ("https://www.instagram.com/reel/DGxvBNzR8vC/?igsh=MXY&utm_source=ig_web", "https://www.instagram.com/reel/DGxvBNzR8vC", "instagram"),
        ("https://instagram.com/reel/DGxvBNzR8vC", "https://www.instagram.com/reel/DGxvBNzR8vC", "instagram"),
        ("https://www.tiktok.com/@nocode.joshua/video/7620790035939462407?_t=1&_r=1", "https://www.tiktok.com/@nocode.joshua/video/7620790035939462407", "tiktok"),
        ("https://tiktok.com/@a/video/1", "https://www.tiktok.com/@a/video/1", "tiktok"),
        ("https://vm.tiktok.com/ZMabc/", "https://vm.tiktok.com/ZMabc", "tiktok"),
        ("https://www.youtube.com/shorts/2Nn9?feature=share", "https://www.youtube.com/shorts/2Nn9", "youtube"),
        ("https://youtu.be/xyz?si=abc", "https://youtu.be/xyz", "youtube"),
        ("https://m.youtube.com/watch?v=abc&t=30", "https://www.youtube.com/watch?v=abc", "youtube"),
        ("https://twitter.com/x/status/1", "https://x.com/x/status/1", "x"),
        ("https://www.reddit.com/r/a/comments/b/c/", "https://www.reddit.com/r/a/comments/b/c", "reddit"),
        ("https://example.com/a/b?z=1&a=2", "https://example.com/a/b?a=2&z=1", "web"),
    ]

    @Test("each case normalises to what the Python returned")
    func matchesRecordedPython() {
        for (raw, url, platform) in Self.cases {
            let s = DropLink.normalize(raw)
            #expect(s?.url == url, "\(raw)")
            #expect(s?.platform == platform, "\(raw)")
        }
    }

    @Test("and to what the Python in this checkout says now")
    func matchesPythonLive() throws {
        var root = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        while !FileManager.default.fileExists(atPath: root.appendingPathComponent("drops/urls.py").path) {
            root.deleteLastPathComponent()
            if root.path == "/" { return }
        }
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        p.currentDirectoryURL = root
        let inputs = Self.cases.map(\.0)
        let json = String(decoding: try JSONSerialization.data(withJSONObject: inputs), as: UTF8.self)
        p.arguments = ["python3", "-c",
                       "import json,sys\nfrom drops import urls as u\nprint(json.dumps([list(u.normalize(c)) for c in json.loads(sys.argv[1])]))",
                       json]
        let out = Pipe()
        p.standardOutput = out
        p.standardError = Pipe()
        guard (try? p.run()) != nil else { return }
        p.waitUntilExit()
        guard p.terminationStatus == 0 else { return }
        let theirs = try JSONSerialization.jsonObject(with: out.fileHandleForReading.readDataToEndOfFile()) as? [[String]] ?? []
        #expect(theirs.count == inputs.count)
        for (raw, pair) in zip(inputs, theirs) {
            let mine = DropLink.normalize(raw)
            #expect(mine?.url == pair.first, "\(raw)")
            #expect(mine?.platform == pair.last, "\(raw)")
        }
    }

    @Test("text around a link is kept as the shared text")
    func sharedText() {
        let s = DropLink.normalize("check this out https://www.tiktok.com/@a/video/1 wild")
        #expect(s?.url == "https://www.tiktok.com/@a/video/1")
        #expect(s?.text == "check this out wild")
    }

    @Test("no link, a hidden host, a foreign scheme and an overlong link are all refused")
    func refusals() {
        #expect(DropLink.normalize("just some words") == nil)
        #expect(DropLink.normalize("") == nil)
        #expect(DropLink.normalize("https://evil.example@instagram.com/reel/x") == nil)
        #expect(DropLink.normalize("javascript:alert(1)") == nil)
        #expect(DropLink.normalize("file:///etc/passwd") == nil)
        #expect(DropLink.normalize("https://x.com/" + String(repeating: "a", count: 600)) == nil)
    }

    @Test("the same reel shared twice is the same url")
    func idempotent() {
        let a = DropLink.normalize("https://www.instagram.com/reel/X/?igsh=one")?.url
        let b = DropLink.normalize("https://instagram.com/reel/X?igsh=two&utm_medium=copy")?.url
        #expect(a != nil && a == b)
    }
}
