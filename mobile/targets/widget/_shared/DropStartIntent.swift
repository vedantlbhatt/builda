import ActivityKit
import AppIntents
import Foundation

/// The Start button on a drop's Live Activity: starts the first move Builda found in a reel you
/// shared, on your Mac, without opening the app (docs/drop-island.md).
///
/// A `LiveActivityIntent`, so the system runs `perform()` in the APP's process (launching it in
/// the background when it is not running), which is where ActivityKit lets a card be updated.
/// That is why this file is in `_shared`: the widget extension needs the type to draw
/// `Button(intent:)`, and the app needs it to run.
///
/// It calls ONE route, `POST /v1/drops/{id}/moves/{move}:start` (`routes/drops.py start`, THE
/// ONLY WAY A MOVE IS EVER QUEUED), the same call the board's tap makes, with the mirrored
/// short-lived token (`BuilderDropsCredential`). It cannot refresh that token and does not try:
/// a second refresher of a rotating refresh token is reuse, and reuse signs the phone out. So
/// when the token has run out the card says to open Builda instead of pretending.
///
/// `requiresAuthentication`: a move starts Claude Code on your Mac, and a Lock Screen button
/// anybody holding the phone could press is not "a person tapped it" in the sense the rule
/// means. The keychain item is readable only while unlocked for the same reason.
@available(iOS 17.0, *)
struct StartDropMoveIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "Start the first move"
  static let description = IntentDescription("Starts the first move Builda found in a reel you shared, on your Mac.")
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication
  static let isDiscoverable = false

  @Parameter(title: "Drop")
  var dropId: String

  @Parameter(title: "Move")
  var moveId: String

  init() {}

  init(dropId: String, moveId: String) {
    self.dropId = dropId
    self.moveId = moveId
  }

  func perform() async throws -> some IntentResult {
    let outcome = await DropMoveStart.start(dropId: dropId, moveId: moveId)
    await DropMoveStart.show(outcome, dropId: dropId)
    return .result()
  }
}

@available(iOS 17.0, *)
enum DropMoveStart {
  /// Longer than the share sheet's four seconds: nobody is waiting on a sheet here, and a start
  /// that times out after the server took it would draw "open Builda" over a move that runs.
  static let timeout: TimeInterval = 8
  /// How long "started on your Mac" holds before the card comes down (docs/drop-island.md: the
  /// in-app island's `DROP_DONE_HOLD_MS`, the same beat).
  static let holdSeconds: Double = 9

  enum Outcome: Equatable {
    /// The server queued it, or it was already going (a 409: a double tap, or the board got
    /// there first). Either way it is running on the Mac.
    case started
    /// No usable token, or the server refused this one: only the app can go further.
    case needsApp
    /// Gone, or the network: leave the card as it was.
    case failed
  }

  static func start(dropId: String, moveId: String) async -> Outcome {
    guard let c = BuilderDropsCredential.usable() else { return .needsApp }
    let path = "/v1/drops/\(escape(dropId))/moves/\(escape(moveId)):start"
    guard let request = c.request("POST", path, json: ["adjustment": NSNull(), "repo_key": NSNull()], timeout: timeout)
    else { return .failed }
    let session = BuilderDropsCredential.session(timeout: timeout)
    defer { session.finishTasksAndInvalidate() }
    guard let (_, response) = try? await session.data(for: request),
          let status = (response as? HTTPURLResponse)?.statusCode
    else { return .failed }
    switch status {
    case 200..<300, 409: return .started
    case 401, 403: return .needsApp
    default: return .failed
    }
  }

  /// Draw what happened on the drop's card: "started on your Mac" and then down after the
  /// beat, or the Start button taken away so the card points at the app instead.
  static func show(_ outcome: Outcome, dropId: String) async {
    guard let activity = Activity<BuilderDropAttributes>.activities.first(where: {
      $0.attributes.dropId == dropId && ($0.activityState == .active || $0.activityState == .stale)
    }) else { return }
    var state = activity.content.state
    state.updatedEpoch = Date().timeIntervalSince1970
    switch outcome {
    case .started:
      state.phase = "started"
      await activity.update(ActivityContent(state: state, staleDate: nil, relevanceScore: 20))
      // Best effort: the process may be suspended before this fires, and then the app's next
      // foreground ends it (src/live/dropActivity.ts sweeps answered cards past the beat).
      try? await Task.sleep(nanoseconds: UInt64(holdSeconds * 1_000_000_000))
      await activity.end(nil, dismissalPolicy: .immediate)
    case .needsApp:
      state.firstMoveId = nil
      await activity.update(ActivityContent(state: state, staleDate: nil))
    case .failed:
      break
    }
  }

  private static func escape(_ s: String) -> String {
    s.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/:"))) ?? s
  }
}
