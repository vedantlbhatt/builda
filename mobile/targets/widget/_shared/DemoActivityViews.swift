import SwiftUI
import WidgetKit

// A demo you asked your Mac for, on the Lock Screen and in the Dynamic Island
// (docs/demo-island.md). Plain SwiftUI, like DropActivityViews.swift, so the main app's debug
// renderer draws the exact views to PNGs; `BuilderDemoActivity.swift` only places them.
//
// What it says is the in-app island's demo (`src/island/Island.tsx DemoContent`): "Waiting for
// your Mac", "Your Mac is filming it", "The kit is up", "Tap to share it anywhere.", for a demo
// the Mac made and kept the in-app notice's "Made on your Mac. Publish it there to share it."
// (`src/island/feeds.ts trackDemo`), and for a failure the kit screen's own line
// (`src/shipkit/model.ts requestView`). Where the request
// stands comes from one rule on the phone, `demoStepFor`, which the in-app island reads too, and
// `__tests__/liveActivityAttributes.test.ts` holds the Swift words to the TypeScript ones, so the
// island inside the app and the one outside it cannot disagree.
//
// Colour is state (docs/motion.md): the record light is `BuilderPalette.demoInk` (spectrum.demo:
// faint, the data red while filming, the dim grey for made and kept, the data green once the kit
// is up), and the project's own
// hue is its title's colour, the hue the project page wears. Every one from the generated
// Palette.swift.

/// Everything the demo surfaces draw, derived once from the attributes and the state.
@available(iOS 16.1, *)
struct DemoDisplay {
  enum Phase: String {
    case asked, filming, made, ready, failed
  }

  let requestId: String
  let projectKey: String
  let title: String
  let hue: BuilderPalette.HueName?
  let phase: Phase
  let since: Date
  let failure: String?
  let updated: Date
  let isStale: Bool

  init(attributes a: BuilderDemoAttributes, state s: BuilderDemoAttributes.ContentState, isStale: Bool) {
    requestId = a.requestId
    projectKey = a.projectKey
    let t = a.title.trimmingCharacters(in: .whitespaces)
    title = t.isEmpty ? DemoCopy.yourProject : t
    hue = a.hue.flatMap { BuilderPalette.HueName(rawValue: $0) }
    // A phase this build does not know is drawn as the one that promises least.
    phase = Phase(rawValue: s.phase) ?? .asked
    since = Date(timeIntervalSince1970: s.sinceEpoch)
    failure = s.failure.flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : $0 }
    updated = Date(timeIntervalSince1970: s.updatedEpoch)
    self.isStale = isStale
  }

  /// The Mac has finished with it, one way or the other. Made counts: the Mac is done, and what
  /// is left is yours to do there (publish), so the card stops counting and says so.
  var answered: Bool { phase == .made || phase == .ready || phase == .failed }

  /// Past the stale date with no answer: the Mac is asleep, or the worker is not running. The
  /// card stops claiming anything is happening and says when it last heard.
  var waitingOnMac: Bool { isStale && !answered }

  /// The record light: `spectrum.demo` for the phase, and the faint grey once nothing is heard.
  var light: Color {
    if waitingOnMac { return BuilderPalette.textFaint }
    return BuilderPalette.demoInk(BuilderPalette.DemoState(rawValue: phase.rawValue) ?? .asked)
  }

  /// A word in the light's colour. Faint is a light, not a legible word, so the asked kicker is
  /// set in the dim grey instead (it still says the same thing: nothing has started).
  var kickerInk: Color {
    phase == .asked || waitingOnMac ? BuilderPalette.textDim : light
  }

  /// The project's title wears its hue, as the project page does; the warm grey without one.
  var titleInk: Color { hue.map { BuilderPalette.hue($0).ink } ?? BuilderPalette.text }

  /// Where the walk stands: 0 asked, 1 filming, 2 answered.
  var step: Int {
    switch phase {
    case .asked: return 0
    case .filming: return 1
    case .made, .ready, .failed: return 2
    }
  }

  /// asked, filming, kit up: the walk's three stops. The last is "made" for a demo the Mac kept
  /// and "no kit" for a failure: the stop says what happened, never what was hoped for.
  var stops: [String] {
    let last: String
    switch phase {
    case .made: last = DemoCopy.wordMade
    case .failed: last = DemoCopy.wordNoKit
    default: last = DemoCopy.wordKitUp
    }
    return [DemoCopy.wordAsked, DemoCopy.wordFilming, last]
  }

  /// The sentence for where it stands, the in-app island's kicker: what VoiceOver reads for the
  /// walk, and the line a quiet Mac gets. Not drawn over the walk, which says the same thing.
  var kicker: String {
    if waitingOnMac {
      // Asked and never picked up is still exactly "waiting"; filming and then silence is not,
      // and the card says when it last heard rather than that the Mac is still at it.
      return phase == .asked ? DemoCopy.waiting : LiveCopy.notUpdatingSince + " " + LiveClock.words(updated)
    }
    switch phase {
    case .asked: return DemoCopy.waiting
    case .filming: return DemoCopy.filming
    case .made: return DemoCopy.made
    case .ready: return DemoCopy.ready
    case .failed: return DemoCopy.failed
    }
  }

  /// A failure's own line, the kit screen's words.
  var failureLine: String { DemoCopy.didNotWork(failure) }

  /// Share opens the kit, where the files and the captions are: a tap on the whole card goes
  /// there too, as the in-app island's does (`Island.tsx open`).
  var url: URL? { URL(string: "builder://ship/\(projectKey)") }
}

/// The words. `waiting`, `filming`, `ready` and `shareLine` are `Island.tsx DemoContent`'s and
/// `didNotWork` is `requestView`'s, held to them by a test.
enum DemoCopy {
  static let label = "Demo"
  static let yourProject = "your project"
  static let waiting = "Waiting for your Mac"
  static let filming = "Your Mac is filming it"
  static let ready = "The kit is up"
  /// The in-app notice's own sentence for a demo the Mac made and kept (`feeds.ts trackDemo`).
  static let made = "Made on your Mac. Publish it there to share it."
  static let failed = "No kit this time"
  static func didNotWork(_ why: String?) -> String {
    guard let why else { return "It did not work on your Mac." }
    return "It did not work: \(why)."
  }
  static let share = "Share"
  static let shareLine = "Tap to share it anywhere."

  static let wordAsked = "asked"
  static let wordFilming = "filming"
  static let wordKitUp = "kit up"
  static let wordNoKit = "no kit"
  static let wordMade = "made"
  static let wordKit = "kit"
}

// MARK: - Marks

/// The record light: a dot, faint while asked, red while the Mac films, green once the kit is
/// up. A failure is a cross in the red, so red alone never has to say which of the two it means.
@available(iOS 16.1, *)
struct DemoRecordDot: View {
  let d: DemoDisplay
  var size: CGFloat = 8

  var body: some View {
    Group {
      if d.phase == .failed {
        Image(systemName: "xmark")
          .font(LiveType.font(size + 1, .bold))
          .foregroundStyle(d.light)
      } else {
        Circle()
          .fill(d.light)
          .frame(width: size, height: size)
      }
    }
    .frame(width: size + 2, height: size + 2)
    .widgetAccentable()
    .accessibilityHidden(true)
  }
}

/// asked, filming, kit up: three stops on one hairline, the one it is at in the light's colour,
/// the ones behind it in the dim grey, the one ahead in the faint grey. `DropWalk`'s shape.
@available(iOS 17.0, *)
struct DemoWalk: View {
  let d: DemoDisplay
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
    .accessibilityLabel(d.kicker)
  }

  private func color(_ i: Int) -> Color {
    // The faint asked light is not a legible word; the stop it is at reads in the dim grey.
    if i == d.step { return d.kickerInk }
    return i < d.step ? BuilderPalette.textDim : BuilderPalette.textFaint
  }
}

/// Ready: Share, a link into the kit (`builder://ship/<key>`), and the in-app island's line
/// beside it. Made: where the kit is and what to do, with no Share, because nothing reached the
/// phone to share. Failed: the kit screen's sentence for why. Nothing while it is still going.
@available(iOS 17.0, *)
struct DemoAnswerRow: View {
  let d: DemoDisplay

  var body: some View {
    if d.phase == .ready, let url = d.url {
      HStack(spacing: 10) {
        Link(destination: url) {
          Text(DemoCopy.share)
            .font(LiveType.font(15, .semibold))
            .foregroundStyle(BuilderPalette.onFill)
            .padding(.horizontal, 16)
            .frame(height: 32)
            .background(Capsule().fill(d.light))
        }
        .accessibilityLabel("\(DemoCopy.share): \(d.title)")
        Text(DemoCopy.shareLine)
          .font(LiveType.font(13, .medium))
          .foregroundStyle(BuilderPalette.textDim)
          .lineLimit(1)
          .truncationMode(.tail)
      }
    } else if d.phase == .made {
      Text(DemoCopy.made)
        .font(LiveType.font(13, .medium))
        .foregroundStyle(BuilderPalette.textDim)
        .lineLimit(2)
        .fixedSize(horizontal: false, vertical: true)
    } else if d.phase == .failed {
      Text(d.failureLine)
        .font(LiveType.font(13, .medium))
        .foregroundStyle(BuilderPalette.textDim)
        .lineLimit(2)
        .fixedSize(horizontal: false, vertical: true)
    }
  }
}

/// Past the stale date with no answer, the one line that is news: "Waiting for your Mac" for a
/// request nobody picked up, "Not updating since 9:41pm" for one that went quiet while filming.
@available(iOS 17.0, *)
struct DemoQuietLine: View {
  let d: DemoDisplay
  var body: some View {
    Text(d.kicker)
      .font(LiveType.font(13, .semibold))
      .foregroundStyle(BuilderPalette.textDim)
      .lineLimit(1)
  }
}

// MARK: - Lock Screen

@available(iOS 17.0, *)
struct DemoLockScreenView: View {
  let d: DemoDisplay

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      // The light and what this card is, and on the right how long since you asked while the Mac
      // has not finished: a system timer, because a "12m" written into the state froze on the
      // Lock Screen for as long as the app was away (LiveMarks.swift `ElapsedTimer`). Not the
      // state's sentence: the walk says where it stands, and the first render said "The kit is
      // up" over "kit up" a line apart (2026-09-19), the drop card's "3 moves" twice again.
      HStack(alignment: .center, spacing: 8) {
        DemoRecordDot(d: d, size: 8)
        Text(DemoCopy.label)
          .font(LiveType.font(14, .semibold))
          .foregroundStyle(BuilderPalette.textDim)
          .lineLimit(1)
        Spacer(minLength: 8)
        if !d.answered {
          ElapsedTimer(start: d.since, size: 14, weight: .medium, color: BuilderPalette.textFaint)
        }
      }
      Text(d.title)
        .font(LiveType.font(16, .semibold))
        .foregroundStyle(d.titleInk)
        .lineLimit(1)
        .truncationMode(.middle)
        .padding(.top, 8)
      DemoWalk(d: d, size: 13)
        .padding(.top, 8)
      if d.answered {
        DemoAnswerRow(d: d)
          .padding(.top, 10)
      } else if d.waitingOnMac {
        DemoQuietLine(d: d)
          .padding(.top, 8)
      }
    }
    .padding(14)
  }
}

// MARK: - Dynamic Island

/// Compact leading: the record light, snug to the camera.
@available(iOS 17.0, *)
struct DemoCompactLeading: View {
  let d: DemoDisplay
  var body: some View {
    DemoRecordDot(d: d, size: 10)
      .padding(.leading, 4)
  }
}

/// Compact trailing: how long since you asked, as a system timer (it keeps counting with the
/// app away, where a number in the state would freeze), or the answer in one word: "kit" in the
/// green, "made" in the dim grey, "no kit" in the red. 13pt, so "0:00:00" fits the 52pt slot.
@available(iOS 17.0, *)
struct DemoCompactTrailing: View {
  let d: DemoDisplay
  var body: some View {
    switch d.phase {
    case .made, .ready, .failed:
      Text(d.phase == .ready ? DemoCopy.wordKit : d.phase == .made ? DemoCopy.wordMade : DemoCopy.wordNoKit)
        .font(LiveType.font(13, .semibold))
        .foregroundStyle(d.light)
        .lineLimit(1)
        .minimumScaleFactor(0.8)
        .frame(maxWidth: 56, alignment: .trailing)
    case .asked, .filming:
      ElapsedTimer(start: d.since, size: 13, color: d.waitingOnMac ? BuilderPalette.textDim : BuilderPalette.text)
    }
  }
}

/// Minimal: the light alone, larger, in the middle of the system's circle.
@available(iOS 17.0, *)
struct DemoMinimal: View {
  let d: DemoDisplay
  var body: some View {
    DemoRecordDot(d: d, size: 12)
      .accessibilityElement(children: .ignore)
      .accessibilityLabel(d.kicker)
  }
}

/// Expanded leading: the light and the word "Demo", short enough to sit beside the camera.
@available(iOS 17.0, *)
struct DemoExpandedLeading: View {
  let d: DemoDisplay
  var body: some View {
    HStack(spacing: 7) {
      DemoRecordDot(d: d, size: 8)
      Text(DemoCopy.label)
        .font(LiveType.font(14, .semibold))
        .foregroundStyle(BuilderPalette.textDim)
        .lineLimit(1)
    }
    .frame(height: 22)
    .padding(.leading, 4)
    .frame(maxHeight: .infinity, alignment: .top)
  }
}

/// Expanded trailing: how long since you asked while it is going; once answered, the clock time
/// it landed ("9:41pm", `LiveClock`), dim, as the drop card does.
@available(iOS 17.0, *)
struct DemoExpandedTrailing: View {
  let d: DemoDisplay
  var body: some View {
    Group {
      if d.answered {
        Text(LiveClock.words(d.updated))
          .font(LiveType.font(14, .medium))
          .monospacedDigit()
          .foregroundStyle(BuilderPalette.textFaint)
          .lineLimit(1)
      } else {
        ElapsedTimer(start: d.since, size: 14, weight: .medium, color: BuilderPalette.textFaint)
      }
    }
    .frame(height: 22)
    .frame(maxHeight: .infinity, alignment: .topTrailing)
    .padding(.trailing, 4)
  }
}

/// Expanded bottom: the project, the walk, and Share or why not. Lifted off the
/// bottom and inset, for the clipping `IslandExpandedBottom` records: the system rounds this
/// region's lower corners and a row sitting low in them loses its first letter.
@available(iOS 17.0, *)
struct DemoExpandedBottom: View {
  let d: DemoDisplay
  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(d.title)
        .font(LiveType.font(15, .semibold))
        .foregroundStyle(d.titleInk)
        .lineLimit(1)
        .truncationMode(.middle)
      DemoWalk(d: d, size: 13)
      if d.answered {
        DemoAnswerRow(d: d)
          .padding(.top, 2)
      } else if d.waitingOnMac {
        DemoQuietLine(d: d)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.horizontal, 6)
    .padding(.top, 2)
    .padding(.bottom, 10)
  }
}
