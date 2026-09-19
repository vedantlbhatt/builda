import Foundation

/// Sample demo requests for the Xcode previews and the debug ImageRenderer pass, one per state
/// the demo card draws. The clocks are `LiveFixtures.t` (the renders freeze every timer there),
/// and the gaps are the ones measured on the one phone request run end to end (docs/ship-kit.md:
/// picked up within the worker's 30 s look, the kit landing about thirteen minutes after the
/// ask). Computed, not stored, as `LiveFixtures` is.
@available(iOS 16.1, *)
enum DemoFixtures {
  typealias State = BuilderDemoAttributes.ContentState

  static var t: Double { LiveFixtures.t }

  /// A project with a hue, the way the kit screen asks for one (`preferredHue`).
  static var builda: BuilderDemoAttributes {
    BuilderDemoAttributes(requestId: "fixture-request-1", projectKey: String(repeating: "ab", count: 32),
                          title: "builda", hue: "orchid")
  }

  /// A long name, and no hue (the warm greys).
  static var longName: BuilderDemoAttributes {
    BuilderDemoAttributes(requestId: "fixture-request-2", projectKey: String(repeating: "cd", count: 32),
                          title: "personal-website-and-the-blog-behind-it", hue: nil)
  }

  static func state(_ phase: String, askedAgo: Double, movedAgo: Double, failure: String? = nil) -> State {
    State(phase: phase, sinceEpoch: t - askedAgo, failure: failure, updatedEpoch: t - movedAgo)
  }

  /// Just asked: the Mac has not looked yet.
  static var asked: State { state("asked", askedAgo: 20, movedAgo: 20) }
  /// Picked up half a minute later, filming for four minutes since.
  static var filming: State { state("filming", askedAgo: 4 * 60 + 30, movedAgo: 4 * 60) }
  /// Thirteen minutes after the ask the Mac finished, and kept the kit: a worker run without
  /// `--publish-requests`, the default.
  static var made: State { state("made", askedAgo: 13 * 60, movedAgo: 5) }
  /// Thirteen minutes after the ask, the kit is up.
  static var ready: State { state("ready", askedAgo: 13 * 60, movedAgo: 5) }
  /// `capture_failed`, in the spec's words.
  static var failed: State { state("failed", askedAgo: 6 * 60, movedAgo: 5, failure: "the Mac could not film it") }
  /// The longest sentence a failure carries (`privacy_refused`), for the wrap.
  static var failedLong: State {
    state("failed", askedAgo: 9 * 60, movedAgo: 5,
          failure: "the Mac found a name or a key on screen and kept the demo to itself")
  }
  /// Past an hour, so the timer shows hours: the box must hold "1:02:00".
  static var filmingLong: State { state("filming", askedAgo: 62 * 60, movedAgo: 61 * 60) }
}
