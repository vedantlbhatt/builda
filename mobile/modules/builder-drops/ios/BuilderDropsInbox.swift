import Foundation

/// The App Group queue the share extension writes and the app drains.
///
/// Compiled into BOTH the app (through the local module's podspec) and the share extension
/// target (targets/share includes this file), so the key, the cap and the shape are written
/// once. Two copies of "what a queued drop looks like" is how a share silently stops arriving.
public enum BuilderDropsInbox {
  /// Must equal the group in app.config.ts. The extension's entitlement names the same one.
  public static let suiteName = "group.com.vedantlbhatt.Builder"
  static let key = "drops.pending.v1"
  /// Shares kept while the app is away. Past this the oldest is dropped.
  static let cap = 64

  static func defaults() -> UserDefaults? {
    UserDefaults(suiteName: suiteName)
  }

  /// Append one share. Called from the extension.
  public static func add(url: String, text: String) {
    guard let d = defaults() else { return }
    var rows = (d.array(forKey: key) as? [[String: Any]]) ?? []
    rows.append(["url": url, "text": text, "at": Date().timeIntervalSince1970])
    if rows.count > cap { rows.removeFirst(rows.count - cap) }
    d.set(rows, forKey: key)
  }

  /// Everything queued, and the queue emptied. Called from the app.
  public static func takeAll() -> [[String: Any]] {
    guard let d = defaults() else { return [] }
    let rows = (d.array(forKey: key) as? [[String: Any]]) ?? []
    d.removeObject(forKey: key)
    return rows
  }

  public static func count() -> Int {
    guard let d = defaults() else { return 0 }
    return ((d.array(forKey: key) as? [[String: Any]]) ?? []).count
  }
}
