import ExpoModulesCore
import UIKit

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
//
// `shareItems` is the other direction (docs/ship-kit.md): the ship kit's video and any stills
// the person picked, ONE share sheet, to any app. expo-sharing takes one file; a post is a video
// and three screenshots, so this presents UIActivityViewController with every file URL at once.
// Some destinations drop the text when files come with it (Instagram, X's extension with more
// than one item), so the caption also goes on the pasteboard before the sheet opens: it is one
// paste away in every app, whatever the app does with the item.

final class ShareUnavailableException: Exception {
  override var reason: String { "There is no screen to present the share sheet from." }
}

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

    AsyncFunction("shareItems") { (paths: [String], text: String?, promise: Promise) in
      var items: [Any] = []
      var missing = 0
      for p in paths {
        let url = p.hasPrefix("file://") ? URL(string: p) : URL(fileURLWithPath: p)
        if let u = url, FileManager.default.fileExists(atPath: u.path) {
          items.append(u)
        } else {
          missing += 1
        }
      }
      if let t = text, !t.isEmpty {
        UIPasteboard.general.string = t
        items.append(t)
      }
      if items.isEmpty {
        promise.resolve(["shared": false, "activity": NSNull(), "missing": missing])
        return
      }
      guard let top = self.appContext?.utilities?.currentViewController() else {
        promise.reject(ShareUnavailableException())
        return
      }
      let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
      sheet.completionWithItemsHandler = { activity, completed, _, _ in
        promise.resolve(["shared": completed, "activity": activity?.rawValue ?? NSNull(), "missing": missing])
      }
      if let pop = sheet.popoverPresentationController {
        // An iPad presents the sheet as a popover, which needs somewhere to point.
        pop.sourceView = top.view
        pop.sourceRect = CGRect(x: top.view.bounds.midX, y: top.view.bounds.maxY - 80, width: 1, height: 1)
      }
      top.present(sheet, animated: true)
    }.runOnQueue(.main)
  }
}
