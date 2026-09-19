import ActivityKit
import ExpoModulesCore
import Foundation

// The demo half of the Live Activity bridge (docs/demo-island.md): a demo you asked your Mac for
// from the phone. JS starts the card the moment you tap "Request a demo" (the app is in front
// then, so no push-to-start is needed) and moves it from the poll `trackDemo` already runs; the
// server moves it by push while the app is away (the Mac picking it up, the kit landing). This
// file is the native part of both: the records, one card per request, and handing the server
// each card's update token.
//
// WHY THE TOKEN IS POSTED FROM SWIFT, as the drop's is (BuilderDropLive.swift): ActivityKit hands
// the update token over asynchronously, a moment after the card starts, and the moment after
// tapping Request is exactly when a person leaves the app. A token that has to wait for a JS
// event loop to take it is a token that waits for the next time Builda is opened, and every
// push in between (the Mac filming, the kit up) has nowhere to go. The Swift task posts it with
// the mirrored short-lived credential (`BuilderDropsCredential`) as soon as it exists; a post
// that fails is retried on the next `flushDemoTokens` from the foreground poll.

// MARK: - Records. Field names are the JS keys; __tests__/liveActivityAttributes.test.ts holds
// them equal to BuilderDemoAttributes, since a key the bridge does not declare is dropped.

struct DemoAttrsRecord: Record {
  @Field var requestId: String = ""
  @Field var projectKey: String = ""
  @Field var title: String = ""
  @Field var hue: String? = nil
}

struct DemoStateRecord: Record {
  @Field var phase: String = "asked"
  @Field var sinceEpoch: Double = 0
  @Field var failure: String? = nil
  @Field var updatedEpoch: Double = 0
}

@available(iOS 16.2, *)
enum DemoLive {
  static func content(_ s: DemoStateRecord, _ opts: ContentOptionsRecord?) -> ActivityContent<BuilderDemoAttributes.ContentState> {
    ActivityContent(
      state: BuilderDemoAttributes.ContentState(
        phase: s.phase, sinceEpoch: s.sinceEpoch, failure: s.failure, updatedEpoch: s.updatedEpoch),
      staleDate: opts?.staleInSeconds.map { Date().addingTimeInterval($0) },
      relevanceScore: opts?.relevance ?? 0
    )
  }

  static func isLive(_ state: ActivityState) -> Bool {
    state == .active || state == .stale
  }

  /// The one live card for a request, if there is one.
  static func live(_ requestId: String) -> Activity<BuilderDemoAttributes>? {
    Activity<BuilderDemoAttributes>.activities.first { $0.attributes.requestId == requestId && isLive($0.activityState) }
  }
}

// MARK: - The tokens the server pushes to

/// The server's copy of this phone's demo card tokens (`POST /v1/push/demo-activity`), one per
/// card. Held in memory and posted when a usable credential and the switches allow it; `flush`
/// retries whatever did not land. No push-to-start token: a demo card is only ever started by
/// the app, in front, at the tap.
@available(iOS 16.2, *)
actor DemoTokenRegistrar {
  static let shared = DemoTokenRegistrar()

  /// Settings > Live Activities AND Show details on Lock Screen, and signed in, as the last JS
  /// sync heard them (`setDemoPush`). Remembered in the app's own defaults so a token that
  /// arrives before the first sync of a launch still knows whether it may go.
  static let enabledKey = "builda.demoIsland.push"
  static let environmentKey = "builda.demoIsland.environment"

  struct Held {
    let requestId: String
    let token: String
    var phase: String
    var posted: Bool
  }

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
      for k in held.keys { held[k]?.posted = false }
    }
    if !on && was { await forgetAll() }
    if on { await flush() }
  }

  func activityToken(activityId: String, requestId: String, token: String, phase: String) async {
    if let h = held[activityId], h.token == token, h.posted { return }
    held[activityId] = Held(requestId: requestId, token: token, phase: phase, posted: false)
    await flush()
  }

  /// The card ended or was swiped away: nothing may push to it again.
  func ended(activityId: String) async {
    guard let h = held.removeValue(forKey: activityId), h.posted else { return }
    _ = await IslandTokenPost.send("DELETE", "/v1/push/demo-activity/\(activityId)", nil)
  }

  /// Post whatever has not landed. Called on every token and on every foreground sync.
  func flush() async {
    guard enabled else { return }
    for (id, h) in held where !h.posted {
      let body: [String: Any] = [
        "request_id": h.requestId, "activity_id": id, "token": h.token,
        "environment": environment, "showing": h.phase,
      ]
      switch await IslandTokenPost.send("POST", "/v1/push/demo-activity", body) {
      case .ok: held[id]?.posted = true
      // Not this account's request, or gone: nothing will ever push to it, so stop trying.
      case .refused: held.removeValue(forKey: id)
      case .later: break
      }
    }
  }

  /// The switch went off: the server forgets every token this process gave it.
  func forgetAll() async {
    for (id, h) in held where h.posted {
      _ = await IslandTokenPost.send("DELETE", "/v1/push/demo-activity/\(id)", nil)
      held[id]?.posted = false
    }
  }

  func status() -> [String: Any] {
    [
      "enabled": enabled,
      "environment": environment,
      "activities": held.map { (id, h) -> [String: Any] in
        ["activityId": id, "requestId": h.requestId, "registered": h.posted]
      },
    ]
  }
}
