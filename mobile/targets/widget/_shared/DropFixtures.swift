import Foundation

/// Sample drops for the Xcode previews and the debug ImageRenderer pass, one per state the drop
/// card draws. The titles and moves are the kind the planner writes about the test corpus
/// (`server/tests/test_drops.py`, `drops/tests/corpus`): a reel about Claude skills, one about a
/// prompt technique, a recipe. Computed, not stored, as `LiveFixtures` is.
@available(iOS 16.1, *)
enum DropFixtures {
  typealias State = BuilderDropAttributes.ContentState

  static var t: Double { LiveFixtures.t }

  static var instagram: BuilderDropAttributes {
    BuilderDropAttributes(dropId: "fixture-drop-ig", host: "instagram.com", platform: "instagram")
  }

  static var tiktok: BuilderDropAttributes {
    BuilderDropAttributes(dropId: "fixture-drop-tt", host: "tiktok.com", platform: "tiktok")
  }

  static func state(_ phase: String, title: String? = nil, moves: Int = 0, first: String? = nil,
                    firstId: String? = nil, kind: String? = nil) -> State {
    State(phase: phase, title: title, moves: moves, firstMoveTitle: first, firstMoveId: firstId,
          kind: kind, updatedEpoch: t)
  }

  static var sent: State { state("sent") }
  static var reading: State { state("reading") }

  static var planned: State {
    state("planned", title: "5 beginner Claude Skills to install", moves: 3,
          first: "Go find the 5 skills", firstId: "fixture-move-1", kind: "skill")
  }

  static var plannedOne: State {
    state("planned", title: "A menu bar app that matches clipboard errors to past fixes", moves: 1,
          first: "Scaffold the app and its first slice", firstId: "fixture-move-2", kind: "project")
  }

  /// The top move runs in one of YOUR repositories, so the island cannot pick which: the server
  /// sends no id, and the card says to open Builda.
  static var plannedNeedsRepo: State {
    state("planned", title: "Stop Claude reading your whole repo on every turn", moves: 2,
          first: "Add the ignore rules to one of your repos", firstId: nil, kind: "technique")
  }

  static var plannedRecipe: State {
    state("planned", title: "One pan garlic butter shrimp pasta", moves: 2,
          first: "Keep the recipe card", firstId: "fixture-move-3", kind: "recipe")
  }

  static var plannedTool: State {
    state("planned", title: "A CLI that turns any repo into a single prompt", moves: 1,
          first: "Try it in a throwaway clone", firstId: "fixture-move-4", kind: "tool")
  }

  /// Read, and not any kind with a hue: the warm greys, so colour always means understood.
  static var plannedUnknown: State {
    state("planned", title: "A studio tour", moves: 0, kind: "unknown")
  }

  static var refused: State { state("refused") }

  static var started: State {
    state("started", title: "5 beginner Claude Skills to install", moves: 2,
          first: "Go find the 5 skills", firstId: "fixture-move-1", kind: "skill")
  }
}
