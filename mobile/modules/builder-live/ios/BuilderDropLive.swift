import ActivityKit
import ExpoModulesCore
import Foundation

// The drop half of the Live Activity bridge (docs/drop-island.md): a reel you shared, being
// read on your Mac. JS starts one when the APP lands a drop while it is in front and moves it
// from its own poll (`src/live/dropActivity.ts`); the server starts one by push when the share
// extension sent the drop itself, and moves every one by push while the app is away. This file
// is the native part of both: the records, one activity per drop, and handing the server the
// tokens it pushes to.
//
// WHY THE TOKENS ARE POSTED FROM SWIFT AND NOT FROM JS. A push-to-start activity appears while
// you are in Instagram and Builda is not running; the system wakes the app in the background to
// hand over the new activity's update token, and the server needs that token to say "reading"
// and "3 moves". A background launch is not a place to wait for React Native to come up and a
// JS poll to run, so the token goes straight to the server from here, with the same mirrored
// short-lived credential the share extension uses (`BuilderDropsCredential`). While the app is
// in front the mirror is fresh (it is rewritten on every refresh), and a post that fails is
// retried on the next `flushDropTokens` from the foreground poll.

// MARK: - Records. Field names are the JS keys; __tests__/liveActivityAttributes.test.ts holds
// them equal to BuilderDropAttributes, since a key the bridge does not declare is dropped.

struct DropAttrsRecord: Record {
  @Field var dropId: String = ""
  @Field var host: String = ""
  @Field var platform: String = "web"
}

struct DropStateRecord: Record {
  @Field var phase: String = "sent"
  @Field var title: String? = nil
  @Field var moves: Int = 0
  @Field var firstMoveTitle: String? = nil
  @Field var firstMoveId: String? = nil
  @Field var kind: String? = nil
  @Field var updatedEpoch: Double = 0
}

@available(iOS 16.2, *)
enum DropLive {
  static func content(_ s: DropStateRecord, _ opts: ContentOptionsRecord?) -> ActivityContent<BuilderDropAttributes.ContentState> {
    ActivityContent(
      state: BuilderDropAttributes.ContentState(
        phase: s.phase, title: s.title, moves: s.moves, firstMoveTitle: s.firstMoveTitle,
        firstMoveId: s.firstMoveId, kind: s.kind, updatedEpoch: s.updatedEpoch),
      staleDate: opts?.staleInSeconds.map { Date().addingTimeInterval($0) },
      relevanceScore: opts?.relevance ?? 0
    )
  }

  static func isLive(_ state: ActivityState) -> Bool {
    state == .active || state == .stale
  }

  /// The one live card for a drop, if there is one.
  static func live(_ dropId: String) -> Activity<BuilderDropAttributes>? {
    Activity<BuilderDropAttributes>.activities.first { $0.attributes.dropId == dropId && isLive($0.activityState) }
  }

  static func hex(_ data: Data) -> String {
    data.map { String(format: "%02x", $0) }.joined()
  }
}

// MARK: - The tokens the server pushes to

/// The server's copy of this phone's drop activity tokens (`POST /v1/push/drop-activity`). One
/// push-to-start token for the app, one update token per card. Held in memory and posted when a
/// usable credential and the switch allow it; `flush` retries whatever did not land.
@available(iOS 16.2, *)
actor DropTokenRegistrar {
  static let shared = DropTokenRegistrar()

  /// Settings > Live Activities AND Show details on Lock Screen, and signed in, as the last JS
  /// sync heard them (`setDropPush`). Remembered across launches in the app's own defaults,
  /// because the launch that matters (a push woke the app) runs before any JS sync.
  static let enabledKey = "builda.dropIsland.push"
  static let environmentKey = "builda.dropIsland.environment"

  struct Held {
    let dropId: String
    let token: String
    var phase: String
    var posted: Bool
  }

  private var pushToStart: String?
  private var pushToStartPosted: String?
  private var held: [String: Held] = [:]

  var enabled: Bool { UserDefaults.standard.bool(forKey: Self.enabledKey) }
  var environment: String {
    UserDefaults.standard.string(forKey: Self.environmentKey) == "production" ? "production" : "sandbox"
  }

  func setEnabled(_ on: Bool, environment: String) async {
    let was = enabled
    let envMoved = self.environment != environment
    UserDefaults.standard.set(on, forKey: Self.enabledKey)
    UserDefaults.standard.set(environment == "production" ? "production" : "sandbox", forKey: Self.environmentKey)
    if on && envMoved {
      pushToStartPosted = nil
      for k in held.keys { held[k]?.posted = false }
    }
    if !on && was { await forgetAll() }
    if on { await flush() }
  }

  func pushToStartToken(_ token: String) async {
    pushToStart = token
    await flush()
  }

  func activityToken(activityId: String, dropId: String, token: String, phase: String) async {
    if let h = held[activityId], h.token == token, h.posted { return }
    held[activityId] = Held(dropId: dropId, token: token, phase: phase, posted: false)
    await flush()
  }

  /// The card ended or was swiped away: nothing may push to it again.
  func ended(activityId: String) async {
    guard let h = held.removeValue(forKey: activityId), h.posted else { return }
    _ = await send("DELETE", "/v1/push/drop-activity/\(activityId)", nil)
  }

  /// Post whatever has not landed. Called on every token and on every foreground sync.
  func flush() async {
    guard enabled else { return }
    if let t = pushToStart, t != pushToStartPosted {
      let body: [String: Any] = ["kind": "push_to_start", "token": t, "environment": environment]
      if await send("POST", "/v1/push/drop-activity", body) == .ok { pushToStartPosted = t }
    }
    for (id, h) in held where !h.posted {
      let body: [String: Any] = [
        "kind": "activity", "drop_id": h.dropId, "activity_id": id, "token": h.token,
        "environment": environment, "showing": h.phase,
      ]
      switch await send("POST", "/v1/push/drop-activity", body) {
      case .ok: held[id]?.posted = true
      // Not this account's drop, or gone: nothing will ever push to it, so stop trying.
      case .refused: held.removeValue(forKey: id)
      case .later: break
      }
    }
  }

  /// The switch went off: the server forgets every token this process gave it.
  func forgetAll() async {
    if let t = pushToStartPosted {
      _ = await send("DELETE", "/v1/push/drop-activity-start/\(t)", nil)
      pushToStartPosted = nil
    }
    for (id, h) in held where h.posted {
      _ = await send("DELETE", "/v1/push/drop-activity/\(id)", nil)
      held[id]?.posted = false
    }
  }

  func status() -> [String: Any] {
    [
      "enabled": enabled,
      "environment": environment,
      "pushToStart": pushToStart != nil,
      "pushToStartRegistered": pushToStart != nil && pushToStart == pushToStartPosted,
      "activities": held.map { (id, h) -> [String: Any] in
        ["activityId": id, "dropId": h.dropId, "registered": h.posted]
      },
    ]
  }

  typealias Sent = IslandTokenPost.Sent

  private func send(_ method: String, _ path: String, _ body: [String: Any]?) async -> Sent {
    await IslandTokenPost.send(method, path, body)
  }
}

/// The one way an island's token reaches the server: the mirrored short-lived credential, ten
/// seconds, and three answers. Shared by the drop cards and the demo cards
/// (`BuilderDemoLive.swift`), so the two cannot come to disagree about what a refusal is.
enum IslandTokenPost {
  enum Sent { case ok, refused, later }

  static func send(_ method: String, _ path: String, _ body: [String: Any]?) async -> Sent {
    guard let c = BuilderDropsCredential.usable(),
          let request = c.request(method, path, json: body, timeout: 10)
    else { return .later }
    let session = BuilderDropsCredential.session(timeout: 10)
    defer { session.finishTasksAndInvalidate() }
    guard let (_, response) = try? await session.data(for: request),
          let status = (response as? HTTPURLResponse)?.statusCode
    else { return .later }
    if (200..<300).contains(status) { return .ok }
    // Not this account's, gone, or a body the route will never take: retrying cannot help.
    if status == 404 || status == 409 || status == 422 { return .refused }
    return .later
  }
}
