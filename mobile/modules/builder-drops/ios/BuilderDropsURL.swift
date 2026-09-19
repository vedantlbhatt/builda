import Foundation

/// A shared link, normalised, in Swift: `src/drops/urls.ts` `normalizeShared`, line for line.
///
/// WHY A THIRD COPY EXISTS. The share extension now sends the drop itself when it may
/// (docs/drop-island.md), and it has no JavaScript. The server validates rather than rewriting
/// (`routes/drops.py`), and the drop's natural key is the normalised link, so an extension that
/// sent the link as it came would make the same reel two cards: one from the sheet and one from
/// the app's paste. `__tests__/dropsUrlsSwift.test.ts` compiles this file and runs it over the same
/// cases the TypeScript is held to against `drops/urls.py`, and reads the three tables below out
/// of this file against the TypeScript's, so a drift is a failing test rather than a duplicate
/// card.
///
/// Returns nil for anything it cannot read, and the extension then queues the share exactly as
/// before, so the app's own normaliser makes the call: a link this port refuses is never lost.
public struct BuilderDropsShared: Equatable {
  public let url: String
  public let platform: String
  public let text: String
}

public enum BuilderDropsURL {
  /// `urls.ts` HOSTS: same list, same order.
  static let hosts: [(String, String)] = [
    ("instagram.com", "instagram"),
    ("instagr.am", "instagram"),
    ("tiktok.com", "tiktok"),
    ("youtube.com", "youtube"),
    ("youtu.be", "youtube"),
    ("twitter.com", "x"),
    ("x.com", "x"),
    ("reddit.com", "reddit"),
    ("redd.it", "reddit"),
    ("threads.net", "threads"),
    ("threads.com", "threads"),
  ]

  /// `urls.ts` CANONICAL: `www.` is not noise (CLAUDE.md), so the host becomes the form the
  /// platform itself publishes.
  static let canonical: [String: String] = [
    "instagram.com": "www.instagram.com",
    "tiktok.com": "www.tiktok.com",
    "youtube.com": "www.youtube.com",
    "twitter.com": "x.com",
    "x.com": "x.com",
    "reddit.com": "www.reddit.com",
    "threads.net": "www.threads.com",
    "threads.com": "www.threads.com",
  ]

  /// `urls.ts` SHARE_PARAMS: the sharer's id, not the post's.
  static let shareParams: Set<String> = [
    "igsh", "igshid", "_t", "_r", "_d", "si", "s", "t", "share_id", "context",
    "fbclid", "gclid", "feature", "app", "is_from_webapp", "sender_device",
  ]

  public static let maxURL = 500

  /// `URL_IN_TEXT`, case insensitive.
  private static let urlInText = try? NSRegularExpression(pattern: #"https?://[^\s<>"'\])]+"#, options: [.caseInsensitive])

  /// `encodeURIComponent`'s unreserved set.
  private static let componentSafe = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()")

  private static func dropPrefix(_ s: String, _ p: String) -> String {
    s.hasPrefix(p) ? String(s.dropFirst(p.count)) : s
  }

  public static func platformOf(_ host: String) -> String {
    let h = dropPrefix(dropPrefix(dropPrefix(host.lowercased(), "www."), "m."), "vm.")
    for (suffix, name) in hosts where h == suffix || h.hasSuffix("." + suffix) {
      return name
    }
    return "web"
  }

  /// `trim().replace(/\s+/g, ' ')`.
  private static func squash(_ s: String) -> String {
    s.components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " ")
  }

  /// `URLSearchParams`: split on `&`, then on the first `=`, `+` is a space, percent decoded.
  private static func formPairs(_ query: String) -> [(String, String)] {
    query.split(separator: "&", omittingEmptySubsequences: true).map { part in
      let s = String(part)
      let (k, v): (String, String)
      if let eq = s.firstIndex(of: "=") {
        (k, v) = (String(s[..<eq]), String(s[s.index(after: eq)...]))
      } else {
        (k, v) = (s, "")
      }
      func decode(_ x: String) -> String {
        let spaced = x.replacingOccurrences(of: "+", with: " ")
        return spaced.removingPercentEncoding ?? spaced
      }
      return (decode(k), decode(v))
    }
  }

  /// JavaScript's `<` on strings: UTF-16 code units.
  private static func jsLess(_ a: String, _ b: String) -> Bool {
    Array(a.utf16).lexicographicallyPrecedes(Array(b.utf16))
  }

  private static func encodeComponent(_ s: String) -> String {
    s.addingPercentEncoding(withAllowedCharacters: componentSafe) ?? s
  }

  /// A share sheet's payload as (url, platform, text), or nil when there is no link in it, or
  /// none this port can read (the app's own normaliser then decides).
  public static func normalize(_ payload: String) -> BuilderDropsShared? {
    let raw = payload.trimmingCharacters(in: .whitespacesAndNewlines)
    if raw.isEmpty { return nil }
    var found: String?
    if let re = urlInText,
       let m = re.firstMatch(in: raw, range: NSRange(raw.startIndex..., in: raw)),
       let r = Range(m.range, in: raw) {
      var f = String(raw[r])
      while let last = f.last, ".,;:".contains(last) { f.removeLast() }
      found = f
    }
    let candidate = found ?? (raw.contains("://") ? raw : "https://" + raw)
    if candidate.utf16.count > maxURL { return nil }

    guard let parsed = URLComponents(string: candidate), let scheme = parsed.scheme?.lowercased(),
          scheme == "https" || scheme == "http"
    else { return nil }
    // `https://evil.com@instagram.com/` reads as one host and resolves to another.
    if !(parsed.user ?? "").isEmpty || !(parsed.password ?? "").isEmpty { return nil }
    guard let rawHost = parsed.host, !rawHost.isEmpty else { return nil }
    let host = rawHost.lowercased()
    if !host.contains(".") { return nil }

    let platform = platformOf(host)
    let bare = dropPrefix(dropPrefix(host, "www."), "m.")
    let finalHost = canonical[bare] ?? host

    var keep: [(String, String)] = []
    for (k, v) in formPairs(parsed.percentEncodedQuery ?? "") {
      if !shareParams.contains(k) && !k.hasPrefix("utm_") && !v.isEmpty { keep.append((k, v)) }
    }
    keep.sort { a, b in a.0 == b.0 ? jsLess(a.1, b.1) : jsLess(a.0, b.0) }
    let qs = keep.map { "\(encodeComponent($0.0))=\(encodeComponent($0.1))" }.joined(separator: "&")
    var path = parsed.percentEncodedPath
    while path.hasSuffix("/") { path.removeLast() }
    if path.isEmpty { path = "/" }
    let port = parsed.port.map { $0 != 80 && $0 != 443 ? ":\($0)" : "" } ?? ""

    var text = ""
    if let found, let r = raw.range(of: found) {
      var rest = raw
      rest.replaceSubrange(r, with: " ")
      text = squash(rest)
    }
    return BuilderDropsShared(url: "https://\(finalHost)\(port)\(path)\(qs.isEmpty ? "" : "?\(qs)")", platform: platform, text: text)
  }

  /// What `landShared` sends as `shared_text`: the payload's own words and whatever text came
  /// beside the link, joined, cut to the column's 1000 characters; nil when there are none.
  public static func sharedText(_ shared: BuilderDropsShared, extra: String) -> String? {
    let joined = [shared.text, extra].filter { !$0.isEmpty }.joined(separator: " ")
    if joined.isEmpty { return nil }
    return String(String.UnicodeScalarView(joined.unicodeScalars.prefix(1000)))
  }
}
