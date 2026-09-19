import Foundation
import Security

/// The one credential anything outside the app's own JavaScript may use: a copy of the app's
/// SHORT-LIVED access token (fifteen minutes, `server/builder/auth.py issue_access_token`) and
/// the API address, kept in the keychain under the App Group so the share extension and the
/// Live Activity's Start button can read it (docs/drop-island.md, "The token model").
///
/// ONE FILE, compiled into four binaries. This is the copy in `modules/builder-drops/ios`, which
/// the app writes through (`BuilderDropsModule.mirrorCredential`); `targets/share/`,
/// `targets/widget/_shared/` and `modules/builder-live/ios/` hold SYMLINKS to it, for the reason
/// `BuilderDropsInbox.swift` is shared the same way: two copies of "where the token is and what
/// it looks like" is how a share silently stops being sent one release after somebody edits one.
///
/// WHAT IS HERE AND WHAT IS NOT. The access token and its expiry, never the refresh token: the
/// refresh token rotates, a second redeemer of it is reuse, and reuse revokes every token the
/// device holds (`auth.redeem_refresh_token`). So nothing outside the app can refresh, and a copy
/// that leaks is worth at most fifteen minutes. `WhenUnlockedThisDeviceOnly`: readable only while
/// the phone is unlocked, never in a backup and never restored to another phone. A locked phone's
/// Start button therefore cannot act without the person unlocking it, which is the point.
///
/// Refused `margin` seconds before it expires: a request that leaves with ten seconds left can
/// arrive with none, and the fallback (the App Group queue) is always there.
public struct BuilderDropsCredential: Equatable {
  public let token: String
  /// Unix seconds, the JWT's own `exp`.
  public let expiresEpoch: Double
  /// The API the app talks to, "https://..." with no trailing slash.
  public let baseURL: String

  /// Must equal the App Group in app.config.ts (and BuilderDropsInbox.suiteName): every target's
  /// entitlement names it, and a keychain item in an App Group's access group is readable by every
  /// target that holds that group and by nothing else.
  public static let accessGroup = "group.com.vedantlbhatt.Builder"
  static let service = "com.vedantlbhatt.Builder.drops"
  static let account = "access.v1"
  public static let margin: Double = 30

  public init(token: String, expiresEpoch: Double, baseURL: String) {
    self.token = token
    self.expiresEpoch = expiresEpoch
    self.baseURL = baseURL
  }

  /// Seconds left before it may no longer be used, at `now`.
  public func secondsLeft(now: Date = Date()) -> Double {
    expiresEpoch - Self.margin - now.timeIntervalSince1970
  }

  private static func query() -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecAttrAccessGroup as String: accessGroup,
    ]
  }

  /// Replace what is stored. Called by the app every time its access token changes. Returns the
  /// keychain's status so the debug route can say why a write did not land.
  @discardableResult
  public static func write(_ c: BuilderDropsCredential) -> OSStatus {
    let body: [String: Any] = ["t": c.token, "e": c.expiresEpoch, "b": c.baseURL]
    guard let data = try? JSONSerialization.data(withJSONObject: body) else { return errSecParam }
    SecItemDelete(query() as CFDictionary)
    var add = query()
    add[kSecValueData as String] = data
    add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    return SecItemAdd(add as CFDictionary, nil)
  }

  /// Signed out, or the app's token cleared: nothing outside the app may act any more.
  public static func clear() {
    SecItemDelete(query() as CFDictionary)
  }

  /// What is stored, whether or not it is still usable.
  public static func stored() -> BuilderDropsCredential? {
    var q = query()
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var out: CFTypeRef?
    guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess,
          let data = out as? Data,
          let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let t = body["t"] as? String, let e = body["e"] as? Double, let b = body["b"] as? String,
          !t.isEmpty, b.hasPrefix("http")
    else { return nil }
    return BuilderDropsCredential(token: t, expiresEpoch: e, baseURL: b)
  }

  /// The credential, only while it is still usable: present, and not within `margin` of expiry.
  public static func usable(now: Date = Date()) -> BuilderDropsCredential? {
    guard let c = stored(), c.secondsLeft(now: now) > 0 else { return nil }
    return c
  }

  /// A request to one route of the API with this credential's bearer. `timeout` is the whole
  /// request: the share sheet has a person waiting on it.
  public func request(_ method: String, _ path: String, json: Any?, timeout: TimeInterval) -> URLRequest? {
    guard let url = URL(string: baseURL + path) else { return nil }
    var r = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
    r.httpMethod = method
    r.setValue("application/json", forHTTPHeaderField: "Accept")
    r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    if let json {
      r.setValue("application/json", forHTTPHeaderField: "Content-Type")
      r.httpBody = try? JSONSerialization.data(withJSONObject: json)
    }
    return r
  }

  /// A session that gives up after `timeout` seconds in total, keeps no cookies and no cache.
  public static func session(timeout: TimeInterval) -> URLSession {
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = timeout
    config.timeoutIntervalForResource = timeout
    config.waitsForConnectivity = false
    return URLSession(configuration: config)
  }
}
