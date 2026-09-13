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
  @Field var filesTouched: Int = -1
  @Field var etaEpoch: Double? = nil
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
      }
      if #available(iOS 17.2, *) {
        Task {
          for await data in Activity<BuilderSessionAttributes>.pushToStartTokenUpdates {
            let token = data.map { String(format: "%02x", $0) }.joined()
            self.latestPushToStartToken = token
            self.sendEvent("onPushToStartToken", ["token": token])
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

    AsyncFunction("endAll") { () async in
      guard #available(iOS 16.2, *) else { return }
      for activity in Activity<BuilderSessionAttributes>.activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
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
        phase: s.phase, sentence: s.sentence, progress: s.progress, filesTouched: s.filesTouched,
        etaEpoch: s.etaEpoch, trajectory: s.trajectory, creature: s.creature,
        linesAdded: s.linesAdded, linesRemoved: s.linesRemoved, commits: s.commits,
        runningCount: s.runningCount, updatedEpoch: s.updatedEpoch),
      staleDate: opts?.staleInSeconds.map { Date().addingTimeInterval($0) },
      relevanceScore: opts?.relevance ?? 0
    )
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
