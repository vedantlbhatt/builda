import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// What comes up when you share a reel into Builda.
///
/// It does three things and stops: read the link out of the item, put it in the App Group
/// (`BuilderDropsInbox`), and say so. It does not fetch the link, call the API, or read the
/// person's account. The app drains the queue on its next foreground and everything else happens
/// there, where the rules about what may be sent already live.
///
/// THE SHEET IS THE PRODUCT'S OWN. A share extension that shows the system's compose sheet with
/// a "Post" button is telling the person they are publishing something. Nothing is published
/// here; something is being kept. So it is Builda's own ground, Builda's own type, the drop's
/// own sigil growing, and one line that says what happens next.
final class ShareViewController: UIViewController {
  private var handled = false

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .clear
    extract { [weak self] url, text in
      guard let self else { return }
      DispatchQueue.main.async {
        guard let url else {
          self.present(state: .refused)
          return
        }
        BuilderDropsInbox.add(url: url, text: text)
        self.present(state: .kept(url: url))
      }
    }
  }

  private func present(state: ShareSheetState) {
    let sheet = UIHostingController(
      rootView: ShareSheetView(state: state) { [weak self] in self?.finish() }
    )
    sheet.view.backgroundColor = .clear
    addChild(sheet)
    sheet.view.frame = view.bounds
    sheet.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.addSubview(sheet.view)
    sheet.didMove(toParent: self)
  }

  private func finish() {
    guard !handled else { return }
    handled = true
    extensionContext?.completeRequest(returningItems: nil)
  }

  /// The link, and any text that came with it.
  ///
  /// Hosts differ in what they put in the item, and the order below is the order they are
  /// trusted in: a real `public.url` attachment is unambiguous, and a plain text attachment is
  /// searched for a link only when there is no URL attachment. TikTok sends the caption and a
  /// link in one string; Instagram sends the link alone.
  private func extract(_ done: @escaping (String?, String) -> Void) {
    let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
    let attachments = items.flatMap { $0.attachments ?? [] }
    var foundURL: String?
    var foundText = ""
    let group = DispatchGroup()

    for provider in attachments {
      if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
        group.enter()
        provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { item, _ in
          if let u = item as? URL { foundURL = foundURL ?? u.absoluteString }
          if let s = item as? String { foundURL = foundURL ?? s }
          group.leave()
        }
      } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
        group.enter()
        provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { item, _ in
          if let s = item as? String, !s.isEmpty { foundText = s }
          group.leave()
        }
      }
    }

    group.notify(queue: .main) {
      // Only when no URL attachment came: a link inside the shared text.
      if foundURL == nil, let range = foundText.range(of: #"https?://[^\s]+"#, options: .regularExpression) {
        foundURL = String(foundText[range])
      }
      done(foundURL, foundText)
    }
  }
}
