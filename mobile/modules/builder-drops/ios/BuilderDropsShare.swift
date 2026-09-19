import Foundation

/// The share extension's one call to the API: `POST /v1/drops`, the body `api.shareDrop` sends
/// (`src/data/api.ts`), with the mirrored short-lived token (`BuilderDropsCredential`).
///
/// Compiled into the share extension (a symlink in targets/share, like BuilderDropsInbox) and
/// into the app, where the debug route runs the same call so it can be checked on a simulator
/// that has no share sheet to drive.
///
/// ANY failure is `.kept`, and the caller then queues the share in the App Group exactly as it
/// always did: no credential, one about to expire, a link this build's port of the normaliser
/// could not read, a timeout, a refusal, a body that is not a drop. A share is never lost to
/// this path; at worst it waits for the app, which is where it always waited.
public enum BuilderDropsShare {
  /// The whole request, connection included. A person is looking at the sheet.
  public static let timeout: TimeInterval = 4

  public enum Outcome: Equatable {
    /// The server has it; `dropId` is its card.
    case sent(dropId: String)
    /// Not sent. `why` is for the debug route and the log, never shown to a person.
    case kept(why: String)
  }

  /// Send one share. `url` is the link as the host handed it over, `text` whatever text came
  /// with it; both go through the same normalising the app applies (`landShared`).
  public static func send(url: String, text: String, now: Date = Date(), completion: @escaping (Outcome) -> Void) {
    guard let credential = BuilderDropsCredential.usable(now: now) else {
      completion(.kept(why: "no usable credential"))
      return
    }
    guard let shared = BuilderDropsURL.normalize(url) else {
      completion(.kept(why: "the link did not normalise"))
      return
    }
    // Exactly `api.shareDrop`'s body: `shared_text` is null, never "", when nothing came with it.
    var body: [String: Any] = ["url": shared.url, "platform": shared.platform, "shared_text": NSNull()]
    if let t = BuilderDropsURL.sharedText(shared, extra: text) { body["shared_text"] = t }
    guard let request = credential.request("POST", "/v1/drops", json: body, timeout: timeout) else {
      completion(.kept(why: "the API address is not a URL"))
      return
    }
    let session = BuilderDropsCredential.session(timeout: timeout)
    session.dataTask(with: request) { data, response, error in
      defer { session.finishTasksAndInvalidate() }
      if let error {
        completion(.kept(why: "transport: \(error.localizedDescription)"))
        return
      }
      let status = (response as? HTTPURLResponse)?.statusCode ?? 0
      guard (200..<300).contains(status),
            let data,
            let doc = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let drop = doc["drop"] as? [String: Any],
            let id = drop["id"] as? String
      else {
        completion(.kept(why: "http \(status)"))
        return
      }
      completion(.sent(dropId: id))
    }.resume()
  }
}
