import SwiftUI

/// The island on a stand-in for the top of the screen: a menu bar strip with the notch drawn
/// where it is, for offscreen renders. The notch is black like the hardware; `outline` adds a
/// hairline around it, so a render can show whether the island's edges meet the notch's.
public struct IslandStage: View {
    let snapshot: IslandSnapshot
    let expanded: Bool
    let notch: NotchMetrics
    let outline: Bool
    let wheelIndex: Int

    public init(
        snapshot: IslandSnapshot, expanded: Bool, notch: NotchMetrics = .macBookPro14,
        outline: Bool = false, wheelIndex: Int = 0
    ) {
        self.snapshot = snapshot
        self.expanded = expanded
        self.notch = notch
        self.outline = outline
        self.wheelIndex = wheelIndex
    }

    public static let size = CGSize(width: 760, height: 190)

    public var body: some View {
        ZStack(alignment: .top) {
            // A dark wallpaper and the translucent menu bar over it.
            LinearGradient(
                colors: [Color(.sRGB, red: 0.13, green: 0.14, blue: 0.17), Color(.sRGB, red: 0.07, green: 0.07, blue: 0.09)],
                startPoint: .top, endPoint: .bottom)
            Rectangle()
                .fill(Color(.sRGB, red: 0.19, green: 0.19, blue: 0.22))
                .frame(height: notch.hasNotch ? notch.height + 2 : 24)
                .frame(maxHeight: .infinity, alignment: .top)
            if notch.hasNotch {
                IslandShape(bottomRadius: 8)
                    .fill(Color.black)
                    .frame(width: notch.width, height: notch.height)
                    .overlay {
                        if outline {
                            IslandShape(bottomRadius: 8).stroke(Color.red.opacity(0.7), lineWidth: 0.5)
                        }
                    }
            }
            IslandView(
                snapshot: snapshot, expanded: expanded, notch: notch, wheelIndex: wheelIndex,
                alive: false, now: Date())
                .padding(.top, notch.hasNotch ? 0 : 28)
            if outline && notch.hasNotch {
                IslandShape(bottomRadius: 8)
                    .stroke(Color.red.opacity(0.7), lineWidth: 0.5)
                    .frame(width: notch.width, height: notch.height)
            }
        }
        .frame(width: Self.size.width, height: Self.size.height)
        .environment(\.colorScheme, .dark)
    }
}
