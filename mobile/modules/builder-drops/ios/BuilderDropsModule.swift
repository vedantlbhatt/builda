import ExpoModulesCore

// The bridge from the share extension's queue to JS, and from the app's token to the extension.
//
// The queue: the extension writes the link into the shared App Group when it cannot send it
// itself, and the app drains it on the next foreground, which is the same shape the widget's
// snapshot already uses.
//
// The queue is capped. A share extension is launched by the system and can run while the app is
// gone for days, so an unbounded array is a defaults file that grows until somebody notices.
// Oldest out first: the reel you shared this morning matters more than the one you shared last
// month and never opened the app for.
//
// The credential (docs/drop-island.md): every time the app's ACCESS token changes, JS hands it
// here and it is copied into the App Group's keychain (`BuilderDropsCredential`), so the share
// extension can post the one route it may and the island's Start button can start one move. The
// refresh token never comes through here: `src/drops/shareCredential.ts` only ever passes the
// access token, and this module has no function that takes another.

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

    /// Store the app's current access token for the extension and the island. `expiresEpoch` is
    /// the JWT's own `exp`. Returns the keychain status (0 is success) for the debug route.
    Function("mirrorCredential") { (token: String, expiresEpoch: Double, baseURL: String) -> Int in
      Int(BuilderDropsCredential.write(
        BuilderDropsCredential(token: token, expiresEpoch: expiresEpoch, baseURL: baseURL)))
    }

    /// Signed out, or the token cleared: nothing outside the app may act any more.
    Function("clearCredential") { () in
      BuilderDropsCredential.clear()
    }

    /// DEBUG: what the extension would find, without the token itself.
    Function("credentialStatus") { () -> [String: Any] in
      guard let c = BuilderDropsCredential.stored() else { return ["present": false] }
      return [
        "present": true,
        "usable": c.secondsLeft() > 0,
        "secondsLeft": c.secondsLeft(),
        "baseURL": c.baseURL,
      ]
    }

    /// DEBUG: run the share extension's own send (`BuilderDropsShare`) from the app, so the
    /// direct path can be checked on a simulator that has no share sheet to drive. It does NOT
    /// fall back to the queue: the answer is what the extension would have done.
    AsyncFunction("debugShareDirect") { (url: String, text: String, promise: Promise) in
      BuilderDropsShare.send(url: url, text: text) { outcome in
        switch outcome {
        case .sent(let id): promise.resolve(["sent": true, "dropId": id])
        case .kept(let why): promise.resolve(["sent": false, "why": why])
        }
      }
    }
  }
}
