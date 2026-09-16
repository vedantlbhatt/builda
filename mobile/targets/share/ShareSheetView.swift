import SwiftUI

enum ShareSheetState {
  case kept(url: String)
  case refused
}

/// Builda's own sheet, in the share extension.
///
/// It says one true thing and closes. What it must NOT do is promise a reading of the post: the
/// extension has not read it and cannot, so the line is "your Mac will read it" rather than a
/// spinner that implies work is happening behind it.
///
/// The colours are literals from design/tokens.json rather than a colorset, for the reason
/// targets/widget gives: the plugin writes colorsets as display P3 from sRGB hex, so a colour
/// declared there comes out more saturated than the same hex on the phone.
struct ShareSheetView: View {
  let state: ShareSheetState
  let onDone: () -> Void

  private let ground = Color(.sRGB, red: 0.078, green: 0.071, blue: 0.063, opacity: 1)      // #141210
  private let ink = Color(.sRGB, red: 0.961, green: 0.945, blue: 0.918, opacity: 1)         // #F5F1EA
  private let dim = Color(.sRGB, red: 0.659, green: 0.635, blue: 0.604, opacity: 1)         // #A8A29A
  private let hue = Color(.sRGB, red: 0.651, green: 0.439, blue: 0.953, opacity: 1)         // iris #A670F3

  var body: some View {
    ZStack {
      ground.ignoresSafeArea()
      VStack(spacing: 0) {
        Spacer(minLength: 0)
        // Type, and one rule. The first version drew a generated pixel glyph here, and a mark
        // grown from a URL says nothing about the post it stands for: on a sheet whose whole job
        // is to confirm THIS link went somewhere, a picture of nothing is worse than no picture.
        Text(headline)
          .font(.system(size: 34, weight: .bold))
          .foregroundColor(ink)
          .multilineTextAlignment(.center)
          .padding(.horizontal, 28)
        Rectangle()
          .fill(hue)
          .frame(width: 44, height: 3)
          .padding(.top, 20)
        Text(detail)
          .font(.system(size: 15))
          .foregroundColor(dim)
          .multilineTextAlignment(.center)
          .padding(.top, 20)
          .padding(.horizontal, 34)
        Spacer(minLength: 0)
        Button(action: onDone) {
          Text("Done")
            .font(.system(size: 17, weight: .semibold))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 15)
            .background(hue)
            .foregroundColor(Color(.sRGB, red: 0.110, green: 0.098, blue: 0.090, opacity: 1))
            .clipShape(Capsule())
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 28)
      }
    }
    // The sheet closes itself after a beat: a share is a one tap gesture and making somebody
    // tap Done to get back to the video they were watching is a tax. The button stays for
    // anybody who wants it gone now.
    .onAppear {
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) { onDone() }
    }
  }

  private var headline: String {
    switch state {
    case .kept: return "On your board"
    case .refused: return "No link in that"
    }
  }

  private var detail: String {
    switch state {
    case .kept:
      return "Your Mac reads it and works out what you could do with it. Nothing runs until you tap it."
    case .refused:
      return "Builda takes a link. Share the post itself rather than a screenshot of it."
    }
  }
}
