import BuilderModel
import BuilderUI
import Foundation
import Testing

/// The motion constants, pinned, and held to the two places they must agree with.
///
/// A spring changed "to feel a bit snappier" is how eleven ad hoc springs happened. These tests
/// fail on any change to the numbers, so a change has to be made on purpose, in docs/motion.md
/// and the phone's spec at once.
@Suite("Island motion")
struct IslandMotionTests {

    static var repoRoot: URL {
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        while !FileManager.default.fileExists(atPath: dir.appendingPathComponent("docs/motion.md").path) {
            dir.deleteLastPathComponent()
            if dir.path == "/" { break }
        }
        return dir
    }

    @Test("the five springs are the numbers docs/motion.md gives")
    func pinned() {
        #expect(IslandMotion.island == SpringSpec(mass: 1, stiffness: 210, damping: 17))
        #expect(IslandMotion.content == SpringSpec(mass: 0.9, stiffness: 320, damping: 22))
        #expect(IslandMotion.pop == SpringSpec(mass: 0.7, stiffness: 260, damping: 14))
        #expect(IslandMotion.wheel == SpringSpec(mass: 1, stiffness: 190, damping: 20))
        #expect(IslandMotion.snap == SpringSpec(mass: 1, stiffness: 300, damping: 33))
        #expect(IslandMotion.chipStaggerMs == 45)
        #expect(IslandMotion.railStaggerMs == 60)
        #expect(IslandMotion.wordStaggerMs == 55)
        #expect(IslandMotion.exitMs == 120)
        #expect(IslandMotion.outgoingGoneAt == 0.28)
        #expect(IslandMotion.outgoingScale == 1.22)
        #expect(IslandMotion.incomingStartsAt == 0.34)
        #expect(IslandMotion.breatheOutMs == 1500 && IslandMotion.breatheBackMs == 1700)
        #expect(IslandMotion.blinkGapMinMs == 1800 && IslandMotion.blinkGapMaxMs == 5000)
        #expect(IslandMotion.blinkDoubleChance == 0.25)
        #expect(IslandMotion.wheelOpacity == [1, 0.34, 0.14, 0])
        #expect(IslandMotion.wheelScale == [1, 0.78, 0.66])
    }

    /// The table in docs/motion.md is what the phone's spec copies too. Reading it, rather than
    /// restating it, is what makes this a parity test and not a second copy of the numbers.
    @Test("the Swift springs equal the table in docs/motion.md")
    func matchesTheDesignDoc() throws {
        let doc = try String(contentsOf: Self.repoRoot.appendingPathComponent("docs/motion.md"), encoding: .utf8)
        let pattern = try NSRegularExpression(
            pattern: #"\|\s*`(ISLAND|CONTENT|POP|WHEEL|SNAP)`\s*\|\s*damping ([\d.]+), stiffness ([\d.]+), mass ([\d.]+)"#)
        var found: [String: SpringSpec] = [:]
        for m in pattern.matches(in: doc, range: NSRange(doc.startIndex..., in: doc)) {
            func g(_ i: Int) -> String { String(doc[Range(m.range(at: i), in: doc)!]) }
            found[g(1)] = SpringSpec(mass: Double(g(4))!, stiffness: Double(g(3))!, damping: Double(g(2))!)
        }
        #expect(found.count == 5)
        #expect(found["ISLAND"] == IslandMotion.island)
        #expect(found["CONTENT"] == IslandMotion.content)
        #expect(found["POP"] == IslandMotion.pop)
        #expect(found["WHEEL"] == IslandMotion.wheel)
        #expect(found["SNAP"] == IslandMotion.snap)
    }

    /// When the phone's spec file exists on this branch, it must say the same. (It is written
    /// by the phone half of the overhaul; the doc table above holds both until then.)
    @Test("the phone's spec.ts, where present, agrees")
    func matchesThePhoneWherePresent() throws {
        let url = Self.repoRoot.appendingPathComponent("mobile/src/motion/spec.ts")
        guard let src = try? String(contentsOf: url, encoding: .utf8) else { return }
        for (name, spec) in [("ISLAND", IslandMotion.island), ("CONTENT", IslandMotion.content),
                             ("POP", IslandMotion.pop), ("WHEEL", IslandMotion.wheel), ("SNAP", IslandMotion.snap)] {
            guard let r = src.range(of: "\(name)[^}]*\\}", options: .regularExpression) else { continue }
            let block = String(src[r])
            #expect(block.contains("\(Int(spec.damping))"), "\(name) damping")
            #expect(block.contains("\(Int(spec.stiffness))"), "\(name) stiffness")
        }
    }

    /// The clip, read frame by frame: first peak ~300 ms, ~10% past target, settled ~450 ms.
    /// The closed form of ISLAND lands on all three, which is the evidence the conversion from
    /// damping and stiffness to SwiftUI kept the feel rather than the numbers.
    @Test("ISLAND overshoots about 10% and settles in about 450 ms")
    func islandFeel() {
        let peak = IslandMotion.island.firstPeak
        #expect(abs(peak.time - 0.268) < 0.01)
        #expect(abs(peak.overshoot - 0.103) < 0.005)
        #expect(abs(IslandMotion.island.dampingRatio - 0.59) < 0.01)
        let settle = IslandMotion.island.settleTime(tolerance: 0.02)
        #expect(settle > 0.40 && settle < 0.50, "settled at \(settle)")
    }

    @Test("content settles before its container does")
    func contentLeads() {
        #expect(IslandMotion.content.settleTime() < IslandMotion.island.settleTime())
        // And the choreography points are early in the morph, in that order.
        #expect(IslandMotion.outgoingSeconds < IslandMotion.incomingDelaySeconds)
        #expect(IslandMotion.incomingDelaySeconds < 0.1)
    }

    @Test("SNAP does not bounce visibly and WHEEL barely does")
    func snapAndWheel() {
        #expect(IslandMotion.snap.firstPeak.overshoot < 0.04)
        #expect(IslandMotion.wheel.firstPeak.overshoot < 0.05)
    }

    @Test("the wheel falls off by distance and interpolates between rows")
    func wheelFalloff() {
        #expect(IslandMotion.wheelOpacity(at: 0) == 1)
        #expect(IslandMotion.wheelOpacity(at: -1) == 0.34)
        #expect(IslandMotion.wheelOpacity(at: 2) == 0.14)
        #expect(IslandMotion.wheelOpacity(at: 5) == 0)
        #expect(abs(IslandMotion.wheelOpacity(at: 0.5) - 0.67) < 1e-9)
        #expect(IslandMotion.wheelScale(at: 1) == 0.78)
    }

    @Test("the breath is 1500 ms out and 1700 ms back")
    func breath() {
        #expect(FaceClock.breath(at: 0) == 0)
        #expect(abs(FaceClock.breath(at: 1.5) - 1) < 1e-9)
        #expect(abs(FaceClock.breath(at: 3.2)) < 1e-9)
        #expect(FaceClock.breath(at: 0.75) > 0.4 && FaceClock.breath(at: 0.75) < 0.6)
    }

    @Test("blinks land 1.8 to 5 s apart, about a quarter of them double")
    func blinks() {
        let s = BlinkSchedule(seed: 7)
        var doubles = 0
        for n in 1...2000 {
            let g = s.gap(UInt64(n))
            #expect(g >= 1.8 && g <= 5.0)
            if FaceClockProbe.isDouble(seed: 7, n: UInt64(n)) { doubles += 1 }
        }
        #expect(doubles > 400 && doubles < 600, "\(doubles) of 2000")
        // And the eyes actually close at some point in the first ten seconds.
        let live = BlinkSchedule(seed: 7)
        let peak = stride(from: 0.0, to: 10.0, by: 0.01).map { live.value(at: $0) }.max() ?? 0
        #expect(peak > 0.8)
    }

    // MARK: the crew rule, the phone's own vectors

    @Test("FNV-1a and the crew ring match the phone's test vectors")
    func crewHashMatchesThePhone() {
        #expect(CrewRule.fnv1a32("") == 0x811C_9DC5)
        #expect(CrewRule.fnv1a32("a") == 0xE40C_292C)
        #expect(CrewRule.fnv1a32("foobar") == 0xBF9C_F968)
        #expect(CrewRule.hashed("") == "dog")
        #expect(CrewRule.hashed("a") == "crab")
        #expect(CrewRule.hashed("foobar") == "fox")
    }

    @Test("a session that starts while another wears its creature steps along the ring")
    func crewSteps() {
        // Find two ids that hash to the same creature.
        let first = "session-0"
        let clash = (1...500).map { "session-\($0)" }.first { CrewRule.hashed($0) == CrewRule.hashed(first) }!
        let out = CrewRule.creatures(sessions: [(first, 100), (clash, 200)])
        #expect(out[first] == CrewRule.hashed(first))
        #expect(out[clash] != out[first])
        #expect(!out.values.contains("bit"))
        // A kept creature never changes, whatever arrives.
        let kept = CrewRule.creatures(sessions: [(clash, 50), (first, 100)], kept: out)
        #expect(kept == out)
    }

    @Test("no session wears the brand's amber")
    func noSessionIsAmber() {
        for i in 0..<64 {
            let c = CrewRule.hashed("s\(i)")
            #expect(DesignTokens.Spectrum.creature[c] != "amber")
        }
    }
}

/// The double-blink draw, read the way `BlinkSchedule` reads it.
enum FaceClockProbe {
    static func isDouble(seed: UInt64, n: UInt64) -> Bool {
        FaceClock.unit(seed, n, 2) < IslandMotion.blinkDoubleChance
    }
}
