import BuilderSync
import Foundation
import Testing

/// The notch's one input, on the wire: what the Mac sends when a link is dropped on it, and
/// how it reads the drop back. Held to the server's own models (`server/builder/routes/
/// drops.py`): `DropIn` is `extra="forbid"`, so one key too many is a 422 on every drop, and
/// the platform must be one the spec lists.
@Suite("Drop client", .serialized)
struct DropClientTests {

    /// Answers every request with the next canned response and remembers what was asked.
    final class Stub: URLProtocol, @unchecked Sendable {
        nonisolated(unsafe) static var responses: [(Int, String)] = []
        nonisolated(unsafe) static var requests: [URLRequest] = []
        nonisolated(unsafe) static var bodies: [Data] = []
        static let lock = NSLock()

        override class func canInit(with request: URLRequest) -> Bool { true }
        override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

        override func startLoading() {
            let (status, body) = Self.lock.withLock { () -> (Int, String) in
                Self.requests.append(request)
                Self.bodies.append(request.httpBody ?? request.httpBodyStream.map(Self.read) ?? Data())
                return Self.responses.isEmpty ? (500, "{}") : Self.responses.removeFirst()
            }
            let response = HTTPURLResponse(
                url: request.url!, statusCode: status, httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(body.utf8))
            client?.urlProtocolDidFinishLoading(self)
        }

        override func stopLoading() {}

        /// Set the canned responses and forget earlier requests, synchronously.
        static func reset(_ canned: [(Int, String)]) {
            lock.withLock {
                responses = canned
                requests = []
                bodies = []
            }
        }

        static func read(_ stream: InputStream) -> Data {
            stream.open()
            defer { stream.close() }
            var out = Data()
            var buf = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let n = stream.read(&buf, maxLength: buf.count)
                if n <= 0 { break }
                out.append(buf, count: n)
            }
            return out
        }
    }

    static func client() -> SyncClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [Stub.self]
        return SyncClient(
            baseURL: URL(string: "http://127.0.0.1:8787")!, session: URLSession(configuration: config),
            accessToken: { "test-token" })
    }

    /// The row shape the route returns (`drops_store.DROP_COLUMNS`, serialised by `_row`).
    static func dropRow(status: String, refusal: String? = nil) -> String {
        """
        {"id": "0b1d3c9e-7c2a-4d6e-9a51-3f7b8e2c4d10", "url": "https://www.tiktok.com/@a/video/1",
         "platform": "tiktok", "status": "\(status)", "kind": null, "title": null, "summary": null,
         "thumbnail_url": null, "refusal": \(refusal.map { "\"\($0)\"" } ?? "null"), "resolution": null,
         "created_at": "2026-09-19T05:00:00+00:00", "resolved_at": null, "archived_at": null}
        """
    }

    @Test("a dropped link is POSTed as exactly the route's three fields, with the Mac's token")
    func shareSendsTheContract() async throws {
        Stub.reset([(201, #"{"drop": \#(Self.dropRow(status: "waiting")), "created": true}"#)])

        let shared = try #require(DropLink.normalize("look https://www.tiktok.com/@a/video/1?_t=9 wild"))
        let state = try await Self.client().shareDrop(
            url: shared.url, platform: shared.platform, sharedText: shared.text)

        #expect(state.id == "0b1d3c9e-7c2a-4d6e-9a51-3f7b8e2c4d10")
        #expect(state.status == "waiting")
        #expect(state.moves == nil)

        let request = try #require(Stub.requests.first)
        #expect(request.httpMethod == "POST")
        #expect(request.url?.path == "/v1/drops")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer test-token")
        let body = try #require(JSONSerialization.jsonObject(with: Stub.bodies[0]) as? [String: Any])
        #expect(Set(body.keys) == ["url", "platform", "shared_text"])
        #expect(body["url"] as? String == "https://www.tiktok.com/@a/video/1")
        #expect(body["platform"] as? String == "tiktok")
        #expect(body["shared_text"] as? String == "look wild")
    }

    @Test("a drop read back counts its moves once it is planned, and carries a refusal")
    func pollReadsStatus() async throws {
        Stub.reset([
            (200, #"{"drop": \#(Self.dropRow(status: "planned")), "moves": [{"id": "m1"}, {"id": "m2"}, {"id": "m3"}]}"#),
            (200, #"{"drop": \#(Self.dropRow(status: "refused", refusal: "no_text")), "moves": []}"#),
        ])

        let client = Self.client()
        let planned = try await client.drop(id: "0b1d3c9e-7c2a-4d6e-9a51-3f7b8e2c4d10")
        #expect(planned.status == "planned")
        #expect(planned.moves == 3)
        #expect(Stub.requests.first?.url?.path == "/v1/drops/0b1d3c9e-7c2a-4d6e-9a51-3f7b8e2c4d10")
        #expect(Stub.requests.first?.httpMethod == "GET")

        let refused = try await client.drop(id: "0b1d3c9e-7c2a-4d6e-9a51-3f7b8e2c4d10")
        #expect(refused.status == "refused")
        #expect(refused.refusal == "no_text")
        #expect(refused.moves == nil)
    }

    @Test("with no token the drop is refused before anything is sent")
    func unpaired() async {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [Stub.self]
        let client = SyncClient(
            baseURL: URL(string: "http://127.0.0.1:8787")!, session: URLSession(configuration: config),
            accessToken: { nil })
        await #expect(throws: SyncClient.SyncError.self) {
            _ = try await client.shareDrop(url: "https://x.com/a/status/1", platform: "x", sharedText: nil)
        }
    }

    @Test("every platform the Mac can name is one the spec allows")
    func platformsAreTheSpecs() throws {
        var root = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        while !FileManager.default.fileExists(atPath: root.appendingPathComponent("spec/drops.v1.json").path) {
            root.deleteLastPathComponent()
            if root.path == "/" { Issue.record("spec/drops.v1.json not found"); return }
        }
        let data = try Data(contentsOf: root.appendingPathComponent("spec/drops.v1.json"))
        let spec = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let enums = (spec["enums"] as? [String: Any]) ?? spec
        let allowed = Set(try #require(enums["platform"] as? [String]))
        for host in ["www.instagram.com", "instagr.am", "vm.tiktok.com", "youtu.be", "twitter.com",
                     "x.com", "old.reddit.com", "redd.it", "threads.net", "example.com"] {
            #expect(allowed.contains(DropLink.platform(ofHost: host)), "\(host)")
        }
    }
}
