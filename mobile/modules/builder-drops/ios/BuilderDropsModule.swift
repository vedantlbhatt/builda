import ExpoModulesCore

// The bridge from the share extension's queue to JS.
//
// The extension cannot send the drop itself: the account's tokens live in the keychain behind
// the app's own access group, and an extension that could post to the API would be a second
// client of it with a second set of rules about what it may do. So the extension writes the
// link into the shared App Group and the app drains it on the next foreground, which is the
// same shape the widget's snapshot already uses.
//
// The queue is capped. A share extension is launched by the system and can run while the app is
// gone for days, so an unbounded array is a defaults file that grows until somebody notices.
// Oldest out first: the reel you shared this morning matters more than the one you shared last
// month and never opened the app for.

public final class BuilderDropsModule: Module {
  static let suiteName = BuilderDropsInbox.suiteName

  public func definition() -> ModuleDefinition {
    Name("BuilderDrops")

    Function("takePending") { () -> [[String: Any]] in
      BuilderDropsInbox.takeAll()
    }

    Function("pendingCount") { () -> Int in
      BuilderDropsInbox.count()
    }
  }
}
