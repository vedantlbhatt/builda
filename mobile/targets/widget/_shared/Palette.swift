import SwiftUI

// Mirrors design/tokens.json (surface, data, graph.levels), the only place colours live. This
// file is hand-written for now and will be emitted by scripts/gen_tokens.py, like the Mac's
// DesignTokens.swift; until that lands, a colour changed here and not there is a drift bug.
//
// Every value is Color(.sRGB, ...) from the token's sRGB hex. Two traps this avoids:
// SwiftUI's bare Color(red:green:blue:) is DISPLAY P3, and @bacons/apple-targets writes its
// colorsets as display-p3 from sRGB hex; either would make the widget's amber visibly more
// saturated than the app's. It also compiles into the main app (via _shared) for the
// ImageRenderer previews, where the widget's asset catalog colours would resolve to clear.

enum BuilderPalette {
  // Dark, the Lock Screen and Dynamic Island in both appearances.
  static let bg = Color(.sRGB, red: 0x14 / 255, green: 0x12 / 255, blue: 0x10 / 255, opacity: 1)         // #141210
  static let card = Color(.sRGB, red: 0x1E / 255, green: 0x1B / 255, blue: 0x18 / 255, opacity: 1)       // #1E1B18
  static let border = Color(.sRGB, red: 0x2F / 255, green: 0x2B / 255, blue: 0x27 / 255, opacity: 1)     // #2F2B27
  static let text = Color(.sRGB, red: 0xF5 / 255, green: 0xF1 / 255, blue: 0xEA / 255, opacity: 1)       // #F5F1EA
  static let textDim = Color(.sRGB, red: 0xA8 / 255, green: 0xA2 / 255, blue: 0x9A / 255, opacity: 1)    // #A8A29A
  static let textFaint = Color(.sRGB, red: 0x6B / 255, green: 0x65 / 255, blue: 0x5D / 255, opacity: 1)  // #6B655D
  static let amber = Color(.sRGB, red: 0xFF / 255, green: 0xB3 / 255, blue: 0x00 / 255, opacity: 1)      // #FFB300
  static let add = Color(.sRGB, red: 0x7B / 255, green: 0xC9 / 255, blue: 0x6F / 255, opacity: 1)        // #7BC96F
  static let del = Color(.sRGB, red: 0xE5 / 255, green: 0x48 / 255, blue: 0x4D / 255, opacity: 1)        // #E5484D

  /// One appearance's worth of tokens. Home Screen widgets render light and dark, so the
  /// widget reads `BuilderPalette.scheme(colorScheme)`; the Lock Screen and island are dark only.
  struct Scheme {
    let bg: Color
    let card: Color
    let border: Color
    let text: Color
    let textDim: Color
    let textFaint: Color
    let accent: Color
    let add: Color
    let del: Color
    /// graph.levels, 0 (no time) to 5 (8h and over): the amber ramp, never GitHub green.
    let graph: [Color]
    /// Amber is text only on dark (10:1). On the light ground it is 1.7:1, so it becomes a
    /// 6pt dot beside `text`, never the text itself (DESIGN-DIRECTION 3.1).
    let amberIsText: Bool
  }

  static let dark = Scheme(
    bg: bg, card: card, border: border, text: text, textDim: textDim, textFaint: textFaint,
    accent: amber, add: add, del: del,
    graph: [
      Color(.sRGB, red: 0x22 / 255, green: 0x1F / 255, blue: 0x1C / 255, opacity: 1),  // #221F1C
      Color(.sRGB, red: 0x4A / 255, green: 0x37 / 255, blue: 0x14 / 255, opacity: 1),  // #4A3714
      Color(.sRGB, red: 0x7A / 255, green: 0x5A / 255, blue: 0x12 / 255, opacity: 1),  // #7A5A12
      Color(.sRGB, red: 0xB3 / 255, green: 0x7E / 255, blue: 0x00 / 255, opacity: 1),  // #B37E00
      Color(.sRGB, red: 0xE0 / 255, green: 0xA3 / 255, blue: 0x00 / 255, opacity: 1),  // #E0A300
      Color(.sRGB, red: 0xFF / 255, green: 0xB3 / 255, blue: 0x00 / 255, opacity: 1),  // #FFB300
    ],
    amberIsText: true
  )

  static let light = Scheme(
    bg: Color(.sRGB, red: 0xFB / 255, green: 0xF9 / 255, blue: 0xF5 / 255, opacity: 1),         // #FBF9F5
    card: Color(.sRGB, red: 0xFF / 255, green: 0xFF / 255, blue: 0xFF / 255, opacity: 1),       // #FFFFFF
    border: Color(.sRGB, red: 0xE7 / 255, green: 0xE3 / 255, blue: 0xDC / 255, opacity: 1),     // #E7E3DC
    text: Color(.sRGB, red: 0x1C / 255, green: 0x19 / 255, blue: 0x17 / 255, opacity: 1),       // #1C1917
    textDim: Color(.sRGB, red: 0x6B / 255, green: 0x65 / 255, blue: 0x5D / 255, opacity: 1),    // #6B655D
    textFaint: Color(.sRGB, red: 0xA8 / 255, green: 0xA2 / 255, blue: 0x9A / 255, opacity: 1),  // #A8A29A
    accent: amber,
    add: Color(.sRGB, red: 0x2B / 255, green: 0x7F / 255, blue: 0x3A / 255, opacity: 1),        // #2B7F3A
    del: Color(.sRGB, red: 0xC6 / 255, green: 0x2A / 255, blue: 0x2F / 255, opacity: 1),        // #C62A2F
    graph: [
      Color(.sRGB, red: 0xEF / 255, green: 0xEB / 255, blue: 0xE4 / 255, opacity: 1),  // #EFEBE4
      Color(.sRGB, red: 0xFF / 255, green: 0xE7 / 255, blue: 0xB0 / 255, opacity: 1),  // #FFE7B0
      Color(.sRGB, red: 0xFF / 255, green: 0xD2 / 255, blue: 0x75 / 255, opacity: 1),  // #FFD275
      Color(.sRGB, red: 0xFF / 255, green: 0xB3 / 255, blue: 0x00 / 255, opacity: 1),  // #FFB300
      Color(.sRGB, red: 0xE0 / 255, green: 0x8A / 255, blue: 0x00 / 255, opacity: 1),  // #E08A00
      Color(.sRGB, red: 0xB3 / 255, green: 0x6B / 255, blue: 0x00 / 255, opacity: 1),  // #B36B00
    ],
    amberIsText: false
  )

  static func scheme(_ colorScheme: ColorScheme) -> Scheme {
    colorScheme == .dark ? dark : light
  }
}
