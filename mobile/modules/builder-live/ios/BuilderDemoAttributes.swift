import ActivityKit
import Foundation

/// A demo you asked your Mac for from the phone, in the Dynamic Island and on the Lock Screen
/// (docs/demo-island.md). ONE definition, byte-identical in two places, as
/// `BuilderDropAttributes` is:
///   targets/widget/_shared/BuilderDemoAttributes.swift   (widget extension + main app, via _shared)
///   modules/builder-live/ios/BuilderDemoAttributes.swift (the Expo module pod)
/// `__tests__/liveActivityAttributes.test.ts` fails on either copy drifting, and holds the JS
/// `DemoState` keys, the module's Records and the server's push (`server/builder/demo_push.py`
/// CONTENT_STATE_KEYS) to the fields below. ActivityKit pairs the app's copy with the
/// extension's by the struct NAME and its Codable shape, so a rename here is a card that
/// silently never updates.
///
/// Why this is in the island at all: a demo takes minutes on the Mac and you do not wait on the
/// kit screen for it. You tap "Request a demo", go back to what you were doing, and want to post
/// the moment it is ready (docs/motion.md, the island table: "a demo being cut").
///
/// Every time is a plain Double (Unix seconds) so JS, Swift and the APNs `content-state` JSON
/// agree without an encoder. Absent is not empty: a request that did not fail has no failure
/// words, nil, never "".
///
/// The main app deploys to iOS 15.1 and this file compiles into it via _shared, so the
/// availability annotation is required (ActivityKit is 16.1+).
@available(iOS 16.1, *)
public struct BuilderDemoAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    /// "asked" | "filming" | "made" | "ready" | "failed": the request's status as the server holds
    /// it (queued, claimed, done, failed), through `demoStepFor`, the rule the in-app island reads.
    /// A done request is "ready" only when a kit was published at or after the Mac took it
    /// (`kitFromRequest`); otherwise the Mac made it and kept it, "made".
    public var phase: String
    /// Unix seconds the phone asked (the request's `created_at`): the clock the compact island
    /// counts up from while the Mac has not finished.
    public var sinceEpoch: Double
    /// Why it could not be made, in the kit screen's words (spec/shipkit.v1.json `refusals`).
    /// nil unless the phase is failed.
    public var failure: String?
    /// Unix seconds of the data this state was built from: when the card last moved.
    public var updatedEpoch: Double

    public init(phase: String, sinceEpoch: Double, failure: String?, updatedEpoch: Double) {
      self.phase = phase
      self.sinceEpoch = sinceEpoch
      self.failure = failure
      self.updatedEpoch = updatedEpoch
    }
  }

  /// The server's request uuid: the card's identity, and what its update token is filed under.
  public var requestId: String
  /// The project's key (64 hex), for the Share link `builder://ship/<key>`.
  public var projectKey: String
  /// The project as the phone names it, what the card's first line says.
  public var title: String
  /// The project's hue name (`theme.ts` HueName), which its title wears; nil draws it in the warm
  /// greys.
  public var hue: String?

  public init(requestId: String, projectKey: String, title: String, hue: String?) {
    self.requestId = requestId
    self.projectKey = projectKey
    self.title = title
    self.hue = hue
  }
}
