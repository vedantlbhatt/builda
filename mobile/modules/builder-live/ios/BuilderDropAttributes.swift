import ActivityKit
import Foundation

/// A reel you shared, being read on your Mac, in the Dynamic Island and on the Lock Screen
/// (docs/drop-island.md). ONE definition, byte-identical in two places, as
/// `BuilderSessionAttributes` is:
///   targets/widget/_shared/BuilderDropAttributes.swift   (widget extension + main app, via _shared)
///   modules/builder-live/ios/BuilderDropAttributes.swift (the Expo module pod)
/// `__tests__/liveActivityAttributes.test.ts` fails on either copy drifting, and holds the JS
/// `DropState` keys, the module's Records and the server's push (`server/builder/drop_push.py`
/// CONTENT_STATE_KEYS) to the fields below. ActivityKit pairs the app's copy with the
/// extension's by the struct NAME and its Codable shape, and a push-to-start names the type by
/// that same name (`attributes-type`), so a rename here is a start that never arrives.
///
/// Why this is in the island at all: you shared from Instagram and you are still in Instagram.
/// A banner would pull you out; the island lets you keep scrolling and see the answer land, with
/// a Start button for the first move (docs/motion.md, "The island is one object, everywhere").
///
/// Every number is a plain Int or Double (Unix seconds) so JS, Swift and the APNs
/// `content-state` JSON agree without an encoder. Absent is not zero: a title the Mac has not
/// read yet is nil, never "".
///
/// The main app deploys to iOS 15.1 and this file compiles into it via _shared, so the
/// availability annotation is required (ActivityKit is 16.1+).
@available(iOS 16.1, *)
public struct BuilderDropAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    /// "sent" | "reading" | "planned" | "refused" | "started". The first four are the drop's own
    /// status as the server holds it (waiting, resolving, planned, refused); "started" is written
    /// only after a person tapped Start and the server took it, so it always means that.
    public var phase: String
    /// What the Mac read the post to be, once it has. nil before, and for a refusal with no title.
    public var title: String?
    /// Moves offered once planned. 0 before, and after a refusal.
    public var moves: Int
    /// The first offered move's title: what Start would start. nil when there is none.
    public var firstMoveTitle: String?
    /// Its id, for the Start button's intent. nil also means "this card cannot start it from
    /// here" (no credential the island may use): the card then says to open Builda instead.
    public var firstMoveId: String?
    /// The drop kind (spec/drops.v1.json `drop_kind`) once planned, which picks the hue.
    public var kind: String?
    /// Unix seconds of the data this state was built from.
    public var updatedEpoch: Double

    public init(phase: String, title: String?, moves: Int, firstMoveTitle: String?,
                firstMoveId: String?, kind: String?, updatedEpoch: Double) {
      self.phase = phase
      self.title = title
      self.moves = moves
      self.firstMoveTitle = firstMoveTitle
      self.firstMoveId = firstMoveId
      self.kind = kind
      self.updatedEpoch = updatedEpoch
    }
  }

  /// The server's drop uuid.
  public var dropId: String
  /// Where it came from, as a person reads it: "instagram.com", "vm.tiktok.com".
  public var host: String
  /// spec/drops.v1.json `platform`: instagram, tiktok, youtube, x, reddit, threads or web.
  public var platform: String

  public init(dropId: String, host: String, platform: String) {
    self.dropId = dropId
    self.host = host
    self.platform = platform
  }
}
