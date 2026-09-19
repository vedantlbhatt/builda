import Foundation

/// A link dropped on the notch, normalised the way every other door normalises it.
///
/// NORMALISATION IS THE CLIENT'S AND VALIDATION IS THE SERVER'S (`server/builder/routes/
/// drops.py`): the server checks the shape of what arrives and never rewrites it, so the two
/// existing opinions, `drops/urls.py` on the Mac's Python side and `mobile/src/drops/urls.ts`
/// on the phone, must be the only opinion. This is the third copy, and `DropLinkTests` holds
/// it to the Python over the phone's own cases, so the same reel dropped on the notch and
/// shared from the phone is one card, not two. The rules and why each exists are in
/// `drops/urls.py`; in short: https only, the platform's own host (`www.` is not noise: without
/// it TikTok's oEmbed answers 400), the sharer's parameters stripped, the rest sorted.
public enum DropLink {

    public struct Shared: Equatable, Sendable {
        public let url: String
        /// One of the spec's platforms (`spec/drops.v1.json`): instagram, tiktok, youtube, x,
        /// reddit, threads, web.
        public let platform: String
        /// Whatever came with the link, if it came inside some text.
        public let text: String
    }

    public static let maxURL = 500

    /// Same list, same order, as `drops/urls.py` HOSTS.
    static let hosts: [(String, String)] = [
        ("instagram.com", "instagram"), ("instagr.am", "instagram"), ("tiktok.com", "tiktok"),
        ("youtube.com", "youtube"), ("youtu.be", "youtube"), ("twitter.com", "x"), ("x.com", "x"),
        ("reddit.com", "reddit"), ("redd.it", "reddit"), ("threads.net", "threads"),
        ("threads.com", "threads"),
    ]

    /// `drops/urls.py` CANONICAL_HOST.
    static let canonical: [String: String] = [
        "instagram.com": "www.instagram.com", "tiktok.com": "www.tiktok.com",
        "youtube.com": "www.youtube.com", "twitter.com": "x.com", "x.com": "x.com",
        "reddit.com": "www.reddit.com", "threads.net": "www.threads.com",
        "threads.com": "www.threads.com",
    ]

    /// `drops/urls.py` SHARE_PARAMS: the sharer's id, not the post's.
    static let shareParams: Set<String> = [
        "igsh", "igshid", "_t", "_r", "_d", "si", "s", "t", "share_id", "context",
        "fbclid", "gclid", "feature", "app", "is_from_webapp", "sender_device",
    ]

    static let urlInText = try! NSRegularExpression(
        pattern: #"https?://[^\s<>"'\])]+"#, options: [.caseInsensitive])

    public static func platform(ofHost host: String) -> String {
        var h = host.lowercased()
        for p in ["www.", "m.", "vm."] where h.hasPrefix(p) { h.removeFirst(p.count); break }
        for (suffix, name) in hosts where h == suffix || h.hasSuffix("." + suffix) {
            return name
        }
        return "web"
    }

    /// A dropped payload as (url, platform, text), or nil when there is no link in it. Never
    /// throws: a drop that cannot be read is "that has no link in it" on the notch.
    public static func normalize(_ payload: String) -> Shared? {
        let raw = payload.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty else { return nil }
        var found: String?
        if let m = urlInText.firstMatch(in: raw, range: NSRange(raw.startIndex..., in: raw)),
           let r = Range(m.range, in: raw) {
            var s = String(raw[r])
            while let last = s.last, ".,;:".contains(last) { s.removeLast() }
            found = s
        }
        let candidate = found ?? (raw.contains("://") ? raw : "https://" + raw)
        guard candidate.count <= maxURL,
              let comps = URLComponents(string: candidate),
              let scheme = comps.scheme?.lowercased(), scheme == "https" || scheme == "http",
              comps.user == nil, comps.password == nil,
              let rawHost = comps.host?.lowercased(), rawHost.contains(".")
        else { return nil }

        let platform = platform(ofHost: rawHost)
        var bare = rawHost
        for p in ["www.", "m."] where bare.hasPrefix(p) { bare.removeFirst(p.count); break }
        let host = canonical[bare] ?? rawHost

        let keep = (comps.queryItems ?? [])
            .compactMap { item -> (String, String)? in
                guard let v = item.value, !v.isEmpty else { return nil }
                if shareParams.contains(item.name) || item.name.hasPrefix("utm_") { return nil }
                return (item.name, v)
            }
            .sorted { $0.0 != $1.0 ? $0.0 < $1.0 : $0.1 < $1.1 }
        let query = keep.map { "\(encode($0.0))=\(encode($0.1))" }.joined(separator: "&")
        var path = comps.percentEncodedPath
        while path.hasSuffix("/") { path.removeLast() }
        if path.isEmpty { path = "/" }
        let port = comps.port.flatMap { $0 == 80 || $0 == 443 ? nil : ":\($0)" } ?? ""

        let text: String
        if let found {
            text = raw.replacingOccurrences(of: found, with: " ")
                .split(whereSeparator: \.isWhitespace).joined(separator: " ")
        } else {
            text = ""
        }
        return Shared(
            url: "https://\(host)\(port)\(path)\(query.isEmpty ? "" : "?" + query)",
            platform: platform, text: text)
    }

    /// encodeURIComponent's set: letters, digits and `-_.!~*'()` pass, everything else is
    /// percent encoded as UTF-8.
    static func encode(_ s: String) -> String {
        var allowed = CharacterSet.alphanumerics.intersection(CharacterSet(charactersIn: Unicode.Scalar(0)..<Unicode.Scalar(128)))
        allowed.insert(charactersIn: "-_.!~*'()")
        return s.addingPercentEncoding(withAllowedCharacters: allowed) ?? s
    }
}

extension SyncClient {

    /// A drop as the server holds it: its id and where it is (`spec/drops.v1.json`
    /// drop_status: waiting, resolving, planned, refused, archived).
    public struct DropState: Sendable, Equatable {
        public let id: String
        public let status: String
        /// Moves offered once planned; nil before.
        public let moves: Int?
        public let refusal: String?
    }
}
