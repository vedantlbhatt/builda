import ExpoModulesCore
import UIKit

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
