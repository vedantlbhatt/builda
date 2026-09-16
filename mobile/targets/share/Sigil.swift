import Foundation

/// The sigil generator, in Swift. The reference is `mobile/src/drops/sigil.ts`; this is here
/// because the share extension cannot run JavaScript and the sheet it shows has to draw the same
/// glyph the board will.
///
/// EVERY CONSTANT AND EVERY STEP IS THE TypeScript's, in the same order, including the growth
/// order and the thinning pass. `mobile/__tests__/dropsSigilParity.test.ts` runs both over the
/// corpus's links and fails on any cell that differs: a sigil that changes between the share
/// sheet and the board would make the one thing this feature is built on, that a drop is
/// recognisably itself, quietly false.
enum Sigil {
  static let size = 13
  static let margin = 1
  static let targetFill = 0.33
  static let partnerShare = 0.3

  static func fnv1a32(_ s: String) -> UInt32 {
    var h: UInt32 = 0x811c9dc5
    // The TypeScript reads `charCodeAt(i) & 0xff`, which is UTF-16 code units masked to a byte.
    // `s.utf8` would differ on every non ASCII character, and these seeds are URLs that can
    // carry one.
    for unit in s.utf16 {
      h ^= UInt32(unit & 0xff)
      h = h &* 0x01000193
    }
    return h
  }

  struct Stream {
    private var x: UInt32
    init(seed: UInt32) { x = seed == 0 ? 0x9e3779b9 : seed }
    mutating func next() -> UInt32 {
      x ^= x << 13
      x ^= x >> 17
      x ^= x << 5
      return x
    }
  }

  static func grow(seed: String) -> [[Int]] {
    var stream = Stream(seed: fnv1a32(seed))
    var g = [[Int]](repeating: [Int](repeating: 0, count: size), count: size)
    let mid = (size - 1) / 2
    let lo = margin
    let hi = size - 1 - margin
    let live = (hi - lo + 1) * (hi - lo + 1)
    let target = Int((Double(live) * targetFill).rounded())

    func put(_ r: Int, _ c: Int, _ tone: Int) {
      guard r >= 0, r < size, c >= 0, c < size else { return }
      g[r][c] = tone
      g[r][size - 1 - c] = tone
    }

    for r in [mid - 1, mid] { for c in [mid - 1, mid] { put(r, c, 1) } }

    let dirs = [(-1, 0), (1, 0), (0, -1), (0, 1)]
    var filled = g.reduce(0) { $0 + $1.filter { $0 != 0 }.count }
    var guardCount = target * 20
    var frontier: [(Int, Int)] = [(mid - 1, mid - 1), (mid, mid - 1)]

    while filled < target, guardCount > 0, !frontier.isEmpty {
      guardCount -= 1
      let from = frontier[Int(stream.next()) % frontier.count]
      let (dr, dc) = dirs[Int(stream.next()) % 4]
      let r = from.0 + dr
      let c = from.1 + dc
      if r < lo || r > hi || c < lo || c > mid { continue }
      if g[r][c] != 0 { continue }
      let tone = Double(stream.next()) / Double(UInt32.max) < partnerShare ? 2 : 1
      put(r, c, tone)
      frontier.append((r, c))
      filled += c == mid ? 1 : 2
    }

    return thin(g)
  }

  static func thin(_ input: [[Int]]) -> [[Int]] {
    var g = input
    let mid = (size - 1) / 2
    func core(_ r: Int, _ c: Int) -> Bool { r >= mid - 1 && r <= mid && c >= mid - 1 && c <= mid }
    var changed = true
    var guardCount = size * size
    while changed, guardCount > 0 {
      guardCount -= 1
      changed = false
      let before = g
      for r in 0..<size {
        for c in 0..<size where before[r][c] != 0 && !core(r, c) {
          var n = 0
          if r > 0, before[r - 1][c] != 0 { n += 1 }
          if r < size - 1, before[r + 1][c] != 0 { n += 1 }
          if c > 0, before[r][c - 1] != 0 { n += 1 }
          if c < size - 1, before[r][c + 1] != 0 { n += 1 }
          if n < 1 { g[r][c] = 0; changed = true }
        }
      }
    }
    return g
  }
}
