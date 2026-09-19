import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// What comes up when you share a reel into Builda.
///
/// It reads the link out of the item, sends it, and says which of two things happened:
///
///   Sent to your Mac            the extension posted it itself (`BuilderDropsShare`), so the Mac
///                               reads it now and the Dynamic Island can carry the answer while
///                               you keep scrolling (docs/drop-island.md);
///   Kept for when Builda opens  it went into the App Group queue (`BuilderDropsInbox`), exactly
///                               as before, and the app sends it on its next foreground.
///
/// ONE ROUTE, ONE SHORT-LIVED TOKEN. The extension may call `POST /v1/drops` and nothing else,
/// with the copy of the app's fifteen minute access token the app mirrors into the App Group's
/// keychain (`BuilderDropsCredential`), never the refresh token. Why it may now: a share that
/// waits for the app to open is a share the Mac reads hours later, and the island has nothing to
/// show while you are still in Instagram. Why that is safe: the token is worth fifteen minutes at
/// most, the extension cannot mint another (only the app can refresh, because a second redeemer
/// of a rotating refresh token is reuse and signs the device out), and the route it calls only
/// ever makes an inert card: nothing runs until a person taps a move. Any failure at all (no
/// token, an expired one, four seconds without an answer, a refusal) falls back to the queue, so
/// the old path is still the floor.
///
/// It still does not read the post, fetch the link or look at the account. Normalising the link
/// is `BuilderDropsURL`, the Swift port of `src/drops/urls.ts`, so the same reel shared here and
/// pasted in the app is one card.
///
/// THE SHEET IS THE PRODUCT'S OWN. A share extension that shows the system's compose sheet with
/// a "Post" button is telling the person they are publishing something. Nothing is published
/// here; something is being kept. So it is Builda's own ground, Builda's own type, and one line
/// that says what happens next.
final class ShareViewController: UIViewController {
  private var handled = false
  private let model = ShareSheetModel()

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .clear
    present()
    extract { [weak self] url, text in
      guard let self else { return }
      guard let url else {
        self.model.state = .refused
        return
      }
      self.send(url: url, text: text)
    }
  }

  /// Straight to the API when the app has left a usable token behind; the queue otherwise, and
  /// on any failure. The queue write is the same one the extension always made.
  private func send(url: String, text: String) {
    guard BuilderDropsCredential.usable() != nil else {
      BuilderDropsInbox.add(url: url, text: text)
      model.state = .kept
      return
    }
    model.state = .sending
    BuilderDropsShare.send(url: url, text: text) { [weak self] outcome in
      DispatchQueue.main.async {
        guard let self else { return }
        switch outcome {
        case .sent:
          self.model.state = .sent
        case .kept:
          BuilderDropsInbox.add(url: url, text: text)
          self.model.state = .kept
        }
      }
    }
  }

  private func present() {
    let sheet = UIHostingController(
      rootView: ShareSheetView(model: model) { [weak self] in self?.finish() }
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
