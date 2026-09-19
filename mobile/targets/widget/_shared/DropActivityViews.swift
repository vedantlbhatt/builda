import SwiftUI
import WidgetKit

// A reel you shared, being read on your Mac: the Lock Screen and the Dynamic Island
// (docs/drop-island.md). Plain SwiftUI, like LiveActivityViews.swift, so the main app's debug
// renderer draws the exact views to PNGs; `BuilderDropActivity.swift` only places them.
//
// What it says is the in-app island's drop (`src/island/model.ts dropSteps`), word for word:
// "Sent to your Mac", "Reading instagram.com", "3 moves ready", "Nothing to do with this one".
// `__tests__/liveActivityAttributes.test.ts` holds `DropCopy` to `dropSteps`, so the island
// inside the app and the one outside it cannot disagree about what is happening.
//
// Colour is state (docs/motion.md): the reading hue (spectrum.island.reading) while the Mac
// reads it, the drop KIND's hue once it knows what it is (spectrum.drop), the error red for a
// refusal, the warm grey for a kind with no hue and for a Mac that has not answered by the stale
// date. Every one from the generated Palette.swift.

/// Everything the drop surfaces draw, derived once from the attributes and the state.
@available(iOS 16.1, *)
struct DropDisplay {
  enum Phase: String {
    case sent, reading, planned, refused, started
  }

  let dropId: String
  let host: String
  let platform: String
  let phase: Phase
  let title: String?
  let moves: Int
  let firstMoveTitle: String?
  let firstMoveId: String?
  let kind: String?
  let updated: Date
  let isStale: Bool

  init(attributes a: BuilderDropAttributes, state s: BuilderDropAttributes.ContentState, isStale: Bool) {
    dropId = a.dropId
    host = a.host
    platform = a.platform
    // A phase this build does not know is drawn as the one that promises least.
    phase = Phase(rawValue: s.phase) ?? .sent
    title = s.title.flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 }
    moves = max(0, s.moves)
    firstMoveTitle = s.firstMoveTitle
    firstMoveId = s.firstMoveId
    kind = s.kind
    updated = Date(timeIntervalSince1970: s.updatedEpoch)
    self.isStale = isStale
  }

  /// The Mac has said what it is (or that it could not), or a move has started.
  var answered: Bool { phase == .planned || phase == .refused || phase == .started }

  /// Past the stale date with no answer: the Mac is asleep or away. The board says the same
  /// words ("waiting for your Mac", `src/drops/copy.ts`).
  var waitingOnMac: Bool { isStale && !answered }

  /// The one colour this card's marks take.
  var tint: Color {
    if waitingOnMac { return BuilderPalette.textFaint }
    switch phase {
    case .sent, .reading: return BuilderPalette.islandInk(.reading)
    case .planned, .started: return BuilderPalette.dropHue(kind)?.ink ?? BuilderPalette.textDim
    case .refused: return BuilderPalette.islandInk(.error)
    }
  }

  /// Where the walk stands: 0 sent, 1 reading, 2 answered.
  var step: Int {
    switch phase {
    case .sent: return 0
    case .reading: return 1
    case .planned, .refused, .started: return 2
    }
  }

  /// The walk's three stops, short: "sent", "reading", "3 moves".
  var stops: [String] {
    [DropCopy.wordSent, DropCopy.wordReading, answerWord]
  }

  /// The walk's last stop: ahead of it while the Mac reads ("moves"), the answer once it has one.
  private var answerWord: String {
    switch phase {
    case .sent, .reading: return DropCopy.wordMoves
    case .planned: return moves == 0 ? DropCopy.wordRead : DropCopy.movesShort(moves)
    case .refused: return DropCopy.wordNothing
    case .started: return DropCopy.wordStarted
    }
  }

  /// The compact island's trailing word: what is true now, in one word or two.
  var word: String {
    if waitingOnMac { return DropCopy.wordWaiting }
    switch phase {
    case .sent: return DropCopy.wordSent
    case .reading: return DropCopy.wordReading
    case .planned, .refused, .started: return answerWord
    }
  }

  /// The sentence for where it stands, the in-app island's wheel row.
  var sentence: String {
    if waitingOnMac { return DropCopy.waitingForMac }
    switch phase {
    case .sent: return DropCopy.sent
    case .reading: return DropCopy.reading(host)
    case .planned: return DropCopy.movesReady(moves)
    case .refused: return DropCopy.nothingToDo
    case .started: return DropCopy.started
    }
  }

  /// The big line: what the post is once the Mac has read it, and until then where it stands.
  var headline: String {
    if answered, let title { return title }
    return sentence
  }

  /// Start is offered only when the island can finish the job itself: planned, a first move that
  /// needs no choice from you (a move into one of your repositories needs you to pick which, so
  /// the server leaves its id out), and not stale (past it, the token the button would use has
  /// most likely expired, and a button that fails is worse than a line saying to open Builda).
  var canStart: Bool { phase == .planned && moves > 0 && firstMoveId != nil && !isStale }

  /// Planned, with a move to start, that this card cannot start: tap through to the board.
  var opensToStart: Bool { phase == .planned && moves > 0 && !canStart }

  /// Where it came from, short enough to sit beside the camera: the platform's own name, or the
  /// host for a link that is not one of them. The host itself is in the step sentence
  /// ("Reading instagram.com"), so the top row does not say it twice.
  var source: String {
    switch platform {
    case "instagram": return "Instagram"
    case "tiktok": return "TikTok"
    case "youtube": return "YouTube"
    case "x": return "X"
    case "reddit": return "Reddit"
    case "threads": return "Threads"
    default: return host
    }
  }

  /// A tap anywhere opens the board with this drop open (`drops_notify.drop_url`).
  var url: URL? { URL(string: "builder://drops?open=\(dropId)") }
}

/// The words. The first four are `src/island/model.ts dropSteps`, held to it by a test.
enum DropCopy {
  static let sent = "Sent to your Mac"
  static func reading(_ host: String) -> String { "Reading \(host)" }
  static func movesReady(_ n: Int) -> String { n == 1 ? "1 move ready" : "\(n) moves ready" }
  static let nothingToDo = "Nothing to do with this one"
  static let started = "Started on your Mac"
  static let waitingForMac = "Waiting for your Mac"
  static let openToStart = "Open Builda to start it"
  static let start = "Start"

  static let wordSent = "sent"
  static let wordReading = "reading"
  static let wordRead = "read"
  static let wordMoves = "moves"
  static let wordNothing = "nothing"
  static let wordStarted = "started"
  static let wordWaiting = "waiting"
  static func movesShort(_ n: Int) -> String { n == 1 ? "1 move" : "\(n) moves" }
}

// MARK: - Marks

/// The reel itself, as a mark: a 9:16 poster, the shape the in-app island draws a drop as. It
/// fills as the Mac gets further: an outline when sent, half full while it reads, full once it
/// knows what it is. A refusal stays an outline.
@available(iOS 16.1, *)
struct DropPosterGlyph: View {
  let d: DropDisplay
  var width: CGFloat = 12

  var body: some View {
    let height = (width * 16 / 9).rounded()
    let r = max(2, width * 0.22)
    let fill: CGFloat = {
      if d.waitingOnMac { return 0 }
      switch d.phase {
      case .sent, .refused: return 0
      case .reading: return 0.5
      case .planned, .started: return 1
      }
    }()
    ZStack(alignment: .bottom) {
      RoundedRectangle(cornerRadius: r, style: .continuous)
        .strokeBorder(d.tint, lineWidth: max(1.5, width / 8))
      if fill > 0 {
        // A level, not a smaller poster: the full shape, masked to the bottom `fill` of it.
        RoundedRectangle(cornerRadius: r, style: .continuous)
          .fill(d.tint)
          .mask(alignment: .bottom) { Rectangle().frame(height: height * fill) }
      }
    }
    .frame(width: width, height: height)
    .widgetAccentable()
    .accessibilityHidden(true)
  }
}

/// sent, reading, 3 moves: three stops on one hairline, the one it is at in the card's colour,
/// the ones behind it in the dim grey, the one ahead in the faint grey.
@available(iOS 17.0, *)
struct DropWalk: View {
  let d: DropDisplay
  var size: CGFloat = 13

  var body: some View {
    HStack(spacing: 6) {
      ForEach(Array(d.stops.enumerated()), id: \.offset) { i, stop in
        if i > 0 {
          Capsule()
            .fill(i <= d.step ? BuilderPalette.textDim : BuilderPalette.border)
            .frame(width: 18, height: 1.5)
        }
        Text(stop)
          .font(LiveType.font(size, i == d.step ? .semibold : .medium))
          .foregroundStyle(color(i))
          .lineLimit(1)
          .fixedSize()
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(d.sentence)
  }

  private func color(_ i: Int) -> Color {
    if i == d.step { return d.waitingOnMac ? BuilderPalette.textDim : d.tint }
    return i < d.step ? BuilderPalette.textDim : BuilderPalette.textFaint
  }
}

/// The first move, and the button that starts it on your Mac. The button is an App Intent
/// (`StartDropMoveIntent`), so it runs without opening Builda and the card says "started" when
/// the server has it. Planned with no button: one line saying where to go instead.
@available(iOS 17.0, *)
struct DropStartRow: View {
  let d: DropDisplay

  var body: some View {
    if d.canStart, let id = d.firstMoveId {
      HStack(spacing: 10) {
        Button(intent: StartDropMoveIntent(dropId: d.dropId, moveId: id)) {
          Text(DropCopy.start)
            .font(LiveType.font(15, .semibold))
            .foregroundStyle(BuilderPalette.onFill)
            .padding(.horizontal, 16)
            .frame(height: 32)
            .background(Capsule().fill(d.tint))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(DropCopy.start): \(d.firstMoveTitle ?? "")")
        if let t = d.firstMoveTitle {
          Text(t)
            .font(LiveType.font(13, .medium))
            .foregroundStyle(BuilderPalette.textDim)
            .lineLimit(1)
            .truncationMode(.tail)
        }
      }
    } else if d.phase == .started {
      HStack(spacing: 6) {
        Image(systemName: "checkmark")
          .font(LiveType.font(12, .bold))
          .foregroundStyle(d.tint)
          .accessibilityHidden(true)
        Text(d.firstMoveTitle ?? DropCopy.started)
          .font(LiveType.font(13, .medium))
          .foregroundStyle(BuilderPalette.text)
          .lineLimit(1)
      }
    } else if d.opensToStart {
      Text(DropCopy.openToStart)
        .font(LiveType.font(13, .semibold))
        .foregroundStyle(BuilderPalette.textDim)
        .lineLimit(1)
    }
  }
}

// MARK: - Lock Screen

@available(iOS 17.0, *)
struct DropLockScreenView: View {
  let d: DropDisplay

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      // Where it came from, and nothing on the right: the first build put the phase word there
      // too, and the card said "3 moves" twice, a line apart (render, 2026-09-19). The walk says
      // where it stands.
      HStack(alignment: .center, spacing: 8) {
        DropPosterGlyph(d: d, width: 12)
        Text(d.source)
          .font(LiveType.font(14, .semibold))
          .foregroundStyle(BuilderPalette.textDim)
          .lineLimit(1)
          .truncationMode(.middle)
        Spacer(minLength: 0)
      }
      Text(d.headline)
        .font(LiveType.font(16, .semibold))
        .foregroundStyle(BuilderPalette.text)
        .lineLimit(2)
        .fixedSize(horizontal: false, vertical: true)
        .contentTransition(.opacity)
        .padding(.top, 8)
      DropWalk(d: d, size: 13)
        .padding(.top, 8)
      if d.canStart || d.opensToStart || d.phase == .started {
        DropStartRow(d: d)
          .padding(.top, 10)
      }
    }
    .padding(14)
  }
}

// MARK: - Dynamic Island

/// Compact leading: the poster, snug to the camera, in the card's colour.
@available(iOS 17.0, *)
struct DropCompactLeading: View {
  let d: DropDisplay
  var body: some View {
    DropPosterGlyph(d: d, width: 12)
      .padding(.leading, 2)
  }
}

/// Compact trailing: the one word that is true now ("reading", "3 moves"), 13pt so "reading"
/// fits the 52pt slot. The hue only once it is an answer; while it reads the word is plain.
@available(iOS 17.0, *)
struct DropCompactTrailing: View {
  let d: DropDisplay
  var body: some View {
    Text(d.word)
      .font(LiveType.font(13, .semibold))
      .foregroundStyle(d.answered ? d.tint : BuilderPalette.text)
      .lineLimit(1)
      .minimumScaleFactor(0.8)
      .frame(maxWidth: 56, alignment: .trailing)
  }
}

/// Minimal: a ring around the one thing that matters. Dotted while it reads (there is no honest
/// progress to draw, the ring's own rule), full in the kind's hue with the move count inside once
/// planned, a check once started, an empty ring with a cross for a refusal.
@available(iOS 17.0, *)
struct DropMinimal: View {
  let d: DropDisplay
  var body: some View {
    let ring: LiveDisplay.Ring = {
      if d.waitingOnMac { return .dotted }
      switch d.phase {
      case .sent: return .track
      case .reading: return .dotted
      case .planned, .started: return .arc(1)
      case .refused: return .track
      }
    }()
    LiveRing(ring: ring, size: 26, stroke: 2.5, tint: d.tint, dots: d.waitingOnMac ? BuilderPalette.textFaint : d.tint) {
      switch d.phase {
      case .planned where d.moves > 0 && !d.waitingOnMac:
        Text("\(d.moves)")
          .font(LiveType.font(12, .bold))
          .foregroundStyle(d.tint)
      case .started:
        Image(systemName: "checkmark")
          .font(LiveType.font(10, .bold))
          .foregroundStyle(d.tint)
      case .refused:
        Image(systemName: "xmark")
          .font(LiveType.font(9, .bold))
          .foregroundStyle(d.tint)
      default:
        DropPosterGlyph(d: d, width: 7)
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(d.sentence)
  }
}

/// Expanded leading: the poster and where it came from ("Instagram"), which fits beside the
/// camera where "instagram.com" did not: the first render put the host under the camera, a row
/// below an otherwise empty top row. Its width is its own, for the reason `IslandExpandedLeading`
/// gives (`belowIfTooWide` measures it).
@available(iOS 17.0, *)
struct DropExpandedLeading: View {
  let d: DropDisplay
  var body: some View {
    HStack(spacing: 7) {
      DropPosterGlyph(d: d, width: 10)
      Text(d.source)
        .font(LiveType.font(14, .semibold))
        .foregroundStyle(BuilderPalette.textDim)
        .lineLimit(1)
        .truncationMode(.middle)
    }
    .frame(height: 22)
    .padding(.leading, 4)
    .frame(maxHeight: .infinity, alignment: .top)
  }
}

/// Expanded trailing: the moment it was last moved, as a clock ("9:41pm", `LiveClock`), dim.
/// Not the phase word: the walk below says that, and the first build said "3 moves" twice.
@available(iOS 17.0, *)
struct DropExpandedTrailing: View {
  let d: DropDisplay
  var body: some View {
    Text(LiveClock.words(d.updated))
      .font(LiveType.font(14, .medium))
      .monospacedDigit()
      .foregroundStyle(BuilderPalette.textFaint)
      .lineLimit(1)
      .frame(height: 22)
      .frame(maxHeight: .infinity, alignment: .topTrailing)
      .padding(.trailing, 4)
  }
}

/// Expanded bottom: what it is (or where it stands), the walk, and Start. Lifted off the
/// bottom and inset, for the clipping `IslandExpandedBottom` records: the system rounds this
/// region's lower corners and a row sitting low in them loses its first letter.
@available(iOS 17.0, *)
struct DropExpandedBottom: View {
  let d: DropDisplay
  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(d.headline)
        .font(LiveType.font(15, .semibold))
        .foregroundStyle(BuilderPalette.text)
        .lineLimit(2)
        .fixedSize(horizontal: false, vertical: true)
        .contentTransition(.opacity)
      DropWalk(d: d, size: 13)
      if d.canStart || d.opensToStart || d.phase == .started {
        DropStartRow(d: d)
          .padding(.top, 2)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.horizontal, 6)
    .padding(.top, 2)
    .padding(.bottom, 10)
  }
}
