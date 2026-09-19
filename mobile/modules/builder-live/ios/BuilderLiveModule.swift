import ActivityKit
import ExpoModulesCore
import WidgetKit

// The bridge from JS to ActivityKit (verified in the lab: JS -> this module -> ActivityKit ->
// the widget extension's SwiftUI). JS decides WHAT to show and WHEN (src/live/surface.ts);
// this only carries it across. One Live Activity per session: `start` for a session that
// already has one updates it instead of stacking a second.

// MARK: - Records (JS objects <-> Swift). Field names are the JS keys.
// A key JS sends that is missing here is dropped without a word, so
// __tests__/liveActivityAttributes.test.ts holds SessionStateRecord's fields equal to
// ContentState's.

struct SessionAttrsRecord: Record {
  @Field var sessionId: String = ""
  @Field var repo: String = ""
  @Field var agent: String = "claude_code"
  @Field var startedEpoch: Double = 0
}

struct SessionStateRecord: Record {
  @Field var phase: String = "working"
  @Field var sentence: String = ""
  @Field var progress: Double = -1
  @Field var filesChanged: Int = -1
  @Field var etaEpoch: Double? = nil
  @Field var sinceEpoch: Double? = nil
  @Field var endedEpoch: Double? = nil
  @Field var trajectory: String = "none"
  @Field var creature: String = "bit"
  @Field var linesAdded: Int? = nil
  @Field var linesRemoved: Int? = nil
  @Field var commits: Int? = nil
  @Field var runningCount: Int = 0
  @Field var updatedEpoch: Double = 0
}

struct ContentOptionsRecord: Record {
  /// Seconds from now until the content is considered stale (context.isStale flips to true).
  @Field var staleInSeconds: Double? = nil
  /// Higher wins the Dynamic Island when several Builder activities run (100 for needs you).
  @Field var relevance: Double? = nil
  /// Ask ActivityKit for a per-activity APNs push token (needs the Push Notifications capability).
  @Field var push: Bool = false
  /// update(): lights the screen and plays the expanded Dynamic Island. Only for "needs you".
  @Field var alertTitle: String? = nil
  @Field var alertBody: String? = nil
  /// end(): nil = system default (up to 4h on Lock Screen), 0 = immediate, N = N seconds.
  @Field var dismissAfterSeconds: Double? = nil
}

final class LiveActivitiesUnavailableException: Exception {
  override var reason: String { "Live Activities need iOS 16.2+ and must be enabled for Builder in Settings." }
}

final class ActivityNotFoundException: GenericException<String> {
  override var reason: String { "No running Live Activity with id \(param)" }
}

final class PreviewRendererMissingException: Exception {
  override var reason: String {
    "BuilderPreviewRenderer is not in this binary: run expo prebuild so targets/widget/_shared is compiled into the app."
  }
}

// MARK: - Module

public class BuilderLiveModule: Module {
  private var observers: [String: [Task<Void, Never>]] = [:]
  private var latestPushToStartToken: String?

  public func definition() -> ModuleDefinition {
    Name("BuilderLive")

    Events("onPushToken", "onPushToStartToken", "onActivityState")

    OnCreate {
      if #available(iOS 16.2, *) {
        // Re-attach to activities that survived an app restart (the system keeps them alive).
        for activity in Activity<BuilderSessionAttributes>.activities { self.observe(activity) }
        // The drop cards too, and every new one: a push-to-start card appears while the app is
        // not running, and the system wakes it to hand over the card's update token
        // (BuilderDropLive.swift says why that goes to the server from here).
        for activity in Activity<BuilderDropAttributes>.activities { self.observeDrop(activity) }
        Task {
          for await activity in Activity<BuilderDropAttributes>.activityUpdates {
            await self.adoptDrop(activity)
          }
        }
      }
      if #available(iOS 17.2, *) {
        Task {
          for await data in Activity<BuilderSessionAttributes>.pushToStartTokenUpdates {
            let token = data.map { String(format: "%02x", $0) }.joined()
            self.latestPushToStartToken = token
            self.sendEvent("onPushToStartToken", ["token": token])
          }
        }
        Task {
          for await data in Activity<BuilderDropAttributes>.pushToStartTokenUpdates {
            await DropTokenRegistrar.shared.pushToStartToken(DropLive.hex(data))
          }
        }
      }
    }

    Function("areActivitiesEnabled") { () -> Bool in
      guard #available(iOS 16.2, *) else { return false }
      return ActivityAuthorizationInfo().areActivitiesEnabled
    }

    Function("getPushToStartToken") { () -> String? in
      self.latestPushToStartToken
    }

    /// Every activity the system still knows, ended ones included (they sit on the Lock Screen
    /// until dismissed): `state` is "active", "stale", "ended" or "dismissed".
    Function("list") { () -> [[String: Any]] in
      guard #available(iOS 16.2, *) else { return [] }
      return Activity<BuilderSessionAttributes>.activities.map {
        ["id": $0.id, "sessionId": $0.attributes.sessionId, "state": "\($0.activityState)"]
      }
    }

    AsyncFunction("start") { (attrs: SessionAttrsRecord, state: SessionStateRecord, opts: ContentOptionsRecord?) async throws -> String in
      guard #available(iOS 16.2, *), ActivityAuthorizationInfo().areActivitiesEnabled else {
        throw LiveActivitiesUnavailableException()
      }
      // One Live Activity per session: if a LIVE one exists, update it instead of stacking a
      // second. An ended one (still on the Lock Screen, showing "finished") is not reused: an
      // update to it would be accepted and never shown, and the session is running again.
      if let existing = Activity<BuilderSessionAttributes>.activities.first(where: {
        $0.attributes.sessionId == attrs.sessionId && Self.isLive($0.activityState)
      }) {
        await existing.update(Self.content(state, opts))
        return existing.id
      }
      let activity = try Activity.request(
        attributes: BuilderSessionAttributes(
          sessionId: attrs.sessionId, repo: attrs.repo, agent: attrs.agent, startedEpoch: attrs.startedEpoch),
        content: Self.content(state, opts),
        pushType: (opts?.push ?? false) ? .token : nil
      )
      self.observe(activity)
      return activity.id
    }

    AsyncFunction("update") { (id: String, state: SessionStateRecord, opts: ContentOptionsRecord?) async throws in
      guard #available(iOS 16.2, *) else { throw LiveActivitiesUnavailableException() }
      guard let activity = Activity<BuilderSessionAttributes>.activities.first(where: {
        $0.id == id && Self.isLive($0.activityState)
      }) else {
        throw ActivityNotFoundException(id)
      }
      if let title = opts?.alertTitle {
        let alert = AlertConfiguration(
          title: LocalizedStringResource(stringLiteral: title),
          body: LocalizedStringResource(stringLiteral: opts?.alertBody ?? ""),
          sound: .default)
        await activity.update(Self.content(state, opts), alertConfiguration: alert)
      } else {
        await activity.update(Self.content(state, opts))
      }
    }

    /// Also for a card that has ALREADY ended and sits on the Lock Screen as finished: an end
    /// with no state and `dismissAfterSeconds` 0 takes it down (surface.ts does this the moment
    /// another session runs, so a finished card never stacks on top of a running one).
    AsyncFunction("end") { (id: String, finalState: SessionStateRecord?, opts: ContentOptionsRecord?) async throws in
      guard #available(iOS 16.2, *) else { throw LiveActivitiesUnavailableException() }
      guard let activity = Activity<BuilderSessionAttributes>.activities.first(where: { $0.id == id }) else {
        throw ActivityNotFoundException(id)
      }
      let policy: ActivityUIDismissalPolicy
      switch opts?.dismissAfterSeconds {
      case .none: policy = .default
      case .some(let s) where s <= 0: policy = .immediate
      case .some(let s): policy = .after(Date().addingTimeInterval(s))
      }
      await activity.end(finalState.map { Self.content($0, opts) }, dismissalPolicy: policy)
    }

    /// Every Builda card, the drop cards included: Settings > Live Activities off, signing out
    /// and the details switch all mean no card of either kind stays up.
    AsyncFunction("endAll") { () async in
      guard #available(iOS 16.2, *) else { return }
      for activity in Activity<BuilderSessionAttributes>.activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
      for activity in Activity<BuilderDropAttributes>.activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
    }

    // MARK: drops (docs/drop-island.md, BuilderDropLive.swift)

    /// One card per drop: a live card for this drop is updated rather than stacked (a push may
    /// have started one a moment before the app's own start, or the other way round).
    AsyncFunction("startDrop") { (attrs: DropAttrsRecord, state: DropStateRecord, opts: ContentOptionsRecord?) async throws -> String in
      guard #available(iOS 16.2, *), ActivityAuthorizationInfo().areActivitiesEnabled else {
        throw LiveActivitiesUnavailableException()
      }
      if let existing = DropLive.live(attrs.dropId) {
        await existing.update(DropLive.content(state, opts))
        return existing.id
      }
      let attributes = BuilderDropAttributes(dropId: attrs.dropId, host: attrs.host, platform: attrs.platform)
      let activity: Activity<BuilderDropAttributes>
      do {
        activity = try Activity.request(
          attributes: attributes, content: DropLive.content(state, opts),
          pushType: (opts?.push ?? false) ? .token : nil)
      } catch where opts?.push ?? false {
        // A build or a simulator that cannot issue an ActivityKit push token: a card the app
        // moves itself beats no card, as `activity.ts startActivity` says for a session.
        activity = try Activity.request(attributes: attributes, content: DropLive.content(state, opts), pushType: nil)
      }
      self.observeDrop(activity)
      return activity.id
    }

    /// Move a drop's card. False when no live card shows it (swiped away, or never started).
    AsyncFunction("updateDrop") { (dropId: String, state: DropStateRecord, opts: ContentOptionsRecord?) async -> Bool in
      guard #available(iOS 16.2, *), let activity = DropLive.live(dropId) else { return false }
      await activity.update(DropLive.content(state, opts))
      return true
    }

    AsyncFunction("endDrop") { (dropId: String, finalState: DropStateRecord?, opts: ContentOptionsRecord?) async -> Bool in
      guard #available(iOS 16.2, *) else { return false }
      let cards = Activity<BuilderDropAttributes>.activities.filter { $0.attributes.dropId == dropId }
      let policy: ActivityUIDismissalPolicy
      switch opts?.dismissAfterSeconds {
      case .none: policy = .immediate
      case .some(let s) where s <= 0: policy = .immediate
      case .some(let s): policy = .after(Date().addingTimeInterval(s))
      }
      for activity in cards {
        await activity.end(finalState.map { DropLive.content($0, opts) }, dismissalPolicy: policy)
      }
      return !cards.isEmpty
    }

    /// Every drop card the system still knows: `state` is active, stale, ended or dismissed.
    Function("listDrops") { () -> [[String: Any]] in
      guard #available(iOS 16.2, *) else { return [] }
      return Activity<BuilderDropAttributes>.activities.map { a -> [String: Any] in
        [
          "id": a.id, "dropId": a.attributes.dropId, "state": "\(a.activityState)",
          "phase": a.content.state.phase, "updatedEpoch": a.content.state.updatedEpoch,
        ]
      }
    }

    /// Whether the server may push to this phone's drop cards: Live Activities and Lock Screen
    /// details on, and signed in. Off forgets every token on the server.
    AsyncFunction("setDropPush") { (enabled: Bool, environment: String) async in
      guard #available(iOS 16.2, *) else { return }
      await DropTokenRegistrar.shared.setEnabled(enabled, environment: environment)
    }

    /// Retry any token the server has not taken yet. The foreground poll calls it each tick.
    AsyncFunction("flushDropTokens") { () async -> [String: Any] in
      guard #available(iOS 16.2, *) else { return [:] }
      await DropTokenRegistrar.shared.flush()
      return await DropTokenRegistrar.shared.status()
    }

    // Home-screen widget refresh (ExtensionStorage.reloadWidget from @bacons/apple-targets
    // does the same; this one needs no second native module).
    Function("reloadWidgets") { (kind: String?) in
      if let kind { WidgetCenter.shared.reloadTimelines(ofKind: kind) } else { WidgetCenter.shared.reloadAllTimelines() }
    }

    /// DEBUG: render every Lock Screen, island and widget state to PNGs in Documents/live-previews
    /// with ImageRenderer (targets/widget/_shared/LivePreviewRenderer.swift, compiled into the
    /// app). This pod cannot import app code, so it finds the renderer by its Objective-C name.
    AsyncFunction("renderPreviews") { () async throws -> [String] in
      let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("live-previews", isDirectory: true).path
      return try await MainActor.run {
        guard let type = NSClassFromString("BuilderPreviewRenderer") as? NSObject.Type else {
          throw PreviewRendererMissingException()
        }
        let renderer = type.init()
        let result = renderer.perform(NSSelectorFromString("renderAllInto:"), with: dir)
        return (result?.takeUnretainedValue() as? [String]) ?? []
      }
    }
  }

  @available(iOS 16.2, *)
  private static func isLive(_ state: ActivityState) -> Bool {
    state == .active || state == .stale
  }

  @available(iOS 16.2, *)
  private static func content(_ s: SessionStateRecord, _ opts: ContentOptionsRecord?) -> ActivityContent<BuilderSessionAttributes.ContentState> {
    ActivityContent(
      state: BuilderSessionAttributes.ContentState(
        phase: s.phase, sentence: s.sentence, progress: s.progress, filesChanged: s.filesChanged,
        etaEpoch: s.etaEpoch, sinceEpoch: s.sinceEpoch, endedEpoch: s.endedEpoch,
        trajectory: s.trajectory, creature: s.creature,
        linesAdded: s.linesAdded, linesRemoved: s.linesRemoved, commits: s.commits,
        runningCount: s.runningCount, updatedEpoch: s.updatedEpoch),
      staleDate: opts?.staleInSeconds.map { Date().addingTimeInterval($0) },
      relevanceScore: opts?.relevance ?? 0
    )
  }

  /// A drop card the app did not start itself (a push started it). One card per drop: when the
  /// app's own start got there first, the newcomer comes down and the first one carries on.
  @available(iOS 16.2, *)
  private func adoptDrop(_ activity: Activity<BuilderDropAttributes>) async {
    let twin = Activity<BuilderDropAttributes>.activities.first {
      $0.id != activity.id && $0.attributes.dropId == activity.attributes.dropId && DropLive.isLive($0.activityState)
    }
    if twin != nil {
      await activity.end(nil, dismissalPolicy: .immediate)
      return
    }
    observeDrop(activity)
  }

  @available(iOS 16.2, *)
  private func observeDrop(_ activity: Activity<BuilderDropAttributes>) {
    guard observers[activity.id] == nil else { return }
    let tokenTask = Task {
      for await data in activity.pushTokenUpdates {
        await DropTokenRegistrar.shared.activityToken(
          activityId: activity.id, dropId: activity.attributes.dropId, token: DropLive.hex(data),
          phase: activity.content.state.phase)
      }
    }
    let stateTask = Task {
      for await state in activity.activityStateUpdates where state == .ended || state == .dismissed {
        await DropTokenRegistrar.shared.ended(activityId: activity.id)
      }
    }
    observers[activity.id] = [tokenTask, stateTask]
  }

  @available(iOS 16.2, *)
  private func observe(_ activity: Activity<BuilderSessionAttributes>) {
    guard observers[activity.id] == nil else { return }
    let tokenTask = Task {
      for await data in activity.pushTokenUpdates {
        let token = data.map { String(format: "%02x", $0) }.joined()
        self.sendEvent("onPushToken", [
          "activityId": activity.id, "sessionId": activity.attributes.sessionId, "token": token,
        ])
      }
    }
    let stateTask = Task {
      for await state in activity.activityStateUpdates {
        self.sendEvent("onActivityState", [
          "activityId": activity.id, "sessionId": activity.attributes.sessionId, "state": "\(state)",
        ])
      }
    }
    observers[activity.id] = [tokenTask, stateTask]
  }
}
