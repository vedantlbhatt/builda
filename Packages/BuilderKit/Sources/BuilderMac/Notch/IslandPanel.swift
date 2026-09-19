import AppKit
import BuilderSync
import BuilderUI
import SwiftUI

/// The window the island lives in.
///
/// Borderless and non-activating, so touching the island never takes focus from what you are
/// typing in; one level above the status bar, so it draws over the menu bar the notch sits in;
/// on every space and over full-screen apps, because the notch is. The window is a fixed size,
/// big enough for the largest mode plus its overshoot and the agent rail
/// (`IslandLayout.canvas`), and it never resizes: the black shape inside it does. A window
/// resized every frame of a spring stutters; a SwiftUI shape does not.
///
/// It is transparent everywhere except the island, and it ignores the mouse everywhere except
/// over the island (`IslandController.track`), so the menu bar items either side of the notch
/// stay clickable while the island is collapsed.
final class IslandPanel: NSPanel {

    init(size: NSSize) {
        super.init(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        isFloatingPanel = true
        level = NSWindow.Level(rawValue: NSWindow.Level.statusBar.rawValue + 1)
        collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .ignoresCycle]
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        isMovable = false
        hidesOnDeactivate = false
        isReleasedWhenClosed = false
        ignoresMouseEvents = true
        animationBehavior = .none
    }

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }

    /// AppKit keeps windows out from under the menu bar. This one belongs there.
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}

/// The panel's content: the SwiftUI island, and the drop target for a dragged link.
///
/// The drag is handled here, in AppKit, because SwiftUI's `onDrop` answers only after the
/// drop and the island has to open the moment a link is dragged OVER it, and say whether what
/// is being dragged has a link in it at all.
final class IslandContainerView: NSView {

    weak var controller: IslandController?

    init(controller: IslandController, root: some View) {
        self.controller = controller
        super.init(frame: .zero)
        let host = NSHostingView(rootView: root)
        host.translatesAutoresizingMaskIntoConstraints = false
        addSubview(host)
        NSLayoutConstraint.activate([
            host.leadingAnchor.constraint(equalTo: leadingAnchor),
            host.trailingAnchor.constraint(equalTo: trailingAnchor),
            host.topAnchor.constraint(equalTo: topAnchor),
            host.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
        registerForDraggedTypes([.URL, .string, NSPasteboard.PasteboardType("public.url")])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    /// Whatever the drag carries, as text: a URL object first (Safari and Chrome put one on the
    /// pasteboard when a link or the address bar is dragged), then plain text with a link in it.
    static func payload(_ pb: NSPasteboard) -> String? {
        if let urls = pb.readObjects(forClasses: [NSURL.self], options: nil) as? [URL],
           let url = urls.first(where: { $0.scheme == "https" || $0.scheme == "http" }) {
            return url.absoluteString
        }
        return pb.string(forType: .string)
    }

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        let text = Self.payload(sender.draggingPasteboard)
        let ok = text.flatMap(DropLink.normalize) != nil
        controller?.dragEntered(hasLink: ok)
        return ok ? .copy : []
    }

    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation {
        Self.payload(sender.draggingPasteboard).flatMap(DropLink.normalize) != nil ? .copy : []
    }

    override func draggingExited(_ sender: NSDraggingInfo?) {
        controller?.dragExited()
    }

    override func prepareForDragOperation(_ sender: NSDraggingInfo) -> Bool { true }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        guard let text = Self.payload(sender.draggingPasteboard) else { return false }
        controller?.dropped(payload: text)
        return true
    }
}
