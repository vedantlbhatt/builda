// The demo generator's one native helper, compiled on first use with /usr/bin/swiftc into
// ~/.builder/tools (capture/demo/tools.py). The two first verbs, then find-color and dhash, then
// the ship kit's drawing (backdrop, mask, ring, stats) further down:
//
//   builder-demo-helper ocr FILE...
//       Apple Vision text recognition (VNRecognizeTextRequest, accurate, language correction
//       OFF so a key shaped string is read as it is drawn rather than "corrected" into words).
//       Prints one JSON document: [{"file", "width", "height", "lines": [{"text", "confidence",
//       "box": [x, y, w, h]}]}], boxes in PIXELS from the top left.
//
//   builder-demo-helper caption --text T --width W --out FILE [--size PT] [--bottom]
//       A caption pill as a transparent PNG as wide as the video, for ffmpeg's overlay filter.
//       Needed because the ffmpeg this machine has (Homebrew 8.1.1) is built without libfreetype
//       and so has no drawtext filter; compose.py uses drawtext wherever it exists.
//
// Nothing here touches the network. Frameworks only: Foundation, Vision, CoreGraphics,
// CoreText, ImageIO.

import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers
import Vision

func fail(_ message: String) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(2)
}

func loadImage(_ path: String) -> CGImage? {
    let url = URL(fileURLWithPath: path) as CFURL
    guard let src = CGImageSourceCreateWithURL(url, nil) else { return nil }
    return CGImageSourceCreateImageAtIndex(src, 0, nil)
}

func ocr(_ files: [String]) {
    var out: [[String: Any]] = []
    for file in files {
        guard let image = loadImage(file) else {
            out.append(["file": file, "error": "unreadable image"])
            continue
        }
        let w = Double(image.width), h = Double(image.height)
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        // 0.004 of the frame height: about 10 px on a 2622 px tall screen. Lower than the old
        // 0.008 (about 21 px), which skipped a tab bar label or a small caption, so a private
        // name drawn small was never read (the review's item 7). Smaller means stricter.
        request.minimumTextHeight = 0.004
        let handler = VNImageRequestHandler(cgImage: image, options: [:])
        do {
            try handler.perform([request])
        } catch {
            out.append(["file": file, "error": "\(error)"])
            continue
        }
        var lines: [[String: Any]] = []
        for obs in request.results ?? [] {
            guard let best = obs.topCandidates(1).first else { continue }
            let b = obs.boundingBox  // normalised, origin bottom left
            let box = [
                (b.minX * w).rounded(), ((1 - b.maxY) * h).rounded(),
                (b.width * w).rounded(), (b.height * h).rounded(),
            ]
            lines.append(["text": best.string, "confidence": Double(best.confidence), "box": box])
        }
        out.append(["file": file, "width": Int(w), "height": Int(h), "lines": lines])
    }
    let data = try! JSONSerialization.data(withJSONObject: out, options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}

func caption(_ args: [String]) {
    var text = "", out = "", width = 1206.0, size = 0.0
    var i = 0
    while i < args.count {
        let a = args[i]
        let v = i + 1 < args.count ? args[i + 1] : ""
        switch a {
        case "--text": text = v; i += 2
        case "--out": out = v; i += 2
        case "--width": width = Double(v) ?? width; i += 2
        case "--size": size = Double(v) ?? 0; i += 2
        default: fail("caption: unknown argument \(a)")
        }
    }
    if text.isEmpty || out.isEmpty { fail("caption: --text and --out are required") }
    // Type scale from the frame: 4.1% of the width reads as body copy on a phone held upright.
    let pt = size > 0 ? size : (width * 0.041).rounded()
    let font = CTFontCreateUIFontForLanguage(.system, pt, nil)
        .map { CTFontCreateCopyWithSymbolicTraits($0, pt, nil, .boldTrait, .boldTrait) ?? $0 }!
    let attrs: [NSAttributedString.Key: Any] = [
        NSAttributedString.Key(kCTFontAttributeName as String): font,
        NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(red: 1, green: 1, blue: 1, alpha: 1),
    ]
    let maxText = width * 0.84
    let framesetter = CTFramesetterCreateWithAttributedString(NSAttributedString(string: text, attributes: attrs))
    let fit = CTFramesetterSuggestFrameSizeWithConstraints(
        framesetter, CFRange(location: 0, length: 0), nil, CGSize(width: maxText, height: .greatestFiniteMagnitude), nil)
    let padX = pt * 0.9, padY = pt * 0.55
    let pillW = min(width - pt, ceil(fit.width) + padX * 2)
    let pillH = ceil(fit.height) + padY * 2
    let canvasH = pillH + pt  // room for the soft shadow
    let cs = CGColorSpace(name: CGColorSpace.sRGB)!
    guard let ctx = CGContext(
        data: nil, width: Int(width), height: Int(canvasH), bitsPerComponent: 8, bytesPerRow: 0,
        space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { fail("caption: no bitmap context") }
    let pill = CGRect(x: (width - pillW) / 2, y: (canvasH - pillH) / 2, width: pillW, height: pillH)
    let path = CGPath(roundedRect: pill, cornerWidth: pillH / 2, cornerHeight: pillH / 2, transform: nil)
    ctx.setShadow(offset: CGSize(width: 0, height: -pt * 0.08), blur: pt * 0.5, color: CGColor(red: 0, green: 0, blue: 0, alpha: 0.35))
    ctx.addPath(path)
    ctx.setFillColor(CGColor(red: 0.07, green: 0.07, blue: 0.08, alpha: 0.78))
    ctx.fillPath()
    ctx.setShadow(offset: .zero, blur: 0, color: nil)
    ctx.addPath(path)
    ctx.setStrokeColor(CGColor(red: 1, green: 1, blue: 1, alpha: 0.14))
    ctx.setLineWidth(max(1, pt * 0.04))
    ctx.strokePath()
    let textRect = CGRect(
        x: pill.midX - ceil(fit.width) / 2, y: pill.midY - ceil(fit.height) / 2,
        width: ceil(fit.width) + 1, height: ceil(fit.height) + 1)
    let frame = CTFramesetterCreateFrame(framesetter, CFRange(location: 0, length: 0), CGPath(rect: textRect, transform: nil), nil)
    CTFrameDraw(frame, ctx)
    guard let image = ctx.makeImage(),
          let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: out) as CFURL, UTType.png.identifier as CFString, 1, nil)
    else { fail("caption: could not write \(out)") }
    CGImageDestinationAddImage(dest, image, nil)
    if !CGImageDestinationFinalize(dest) { fail("caption: could not write \(out)") }
    print("{\"width\": \(Int(width)), \"height\": \(Int(canvasH))}")
}

// builder-demo-helper find-color --png FILE --color RRGGBB [--tolerance N] [--region x0,y0,x1,y1]
//     Where a colour is on screen, for a storyboard tap on a control no accessibility label
//     reaches (RideGT's gold "Open directions" chevron sits inside a bottom sheet that exposes
//     one element). Prints {"count", "x", "y"}: matching pixels inside the region (fractions of
//     the image) and their centroid as fractions, so the tap works at any screen size.
func findColor(_ args: [String]) {
    var png = "", hex = "", tol = 40.0
    var region = [0.0, 0.0, 1.0, 1.0]
    var i = 0
    while i < args.count {
        let v = i + 1 < args.count ? args[i + 1] : ""
        switch args[i] {
        case "--png": png = v
        case "--color": hex = v.replacingOccurrences(of: "#", with: "")
        case "--tolerance": tol = Double(v) ?? tol
        case "--region": region = v.split(separator: ",").compactMap { Double($0) }
        default: fail("find-color: unknown argument \(args[i])")
        }
        i += 2
    }
    guard let image = loadImage(png), hex.count == 6, let rgb = Int(hex, radix: 16), region.count == 4 else {
        fail("find-color: --png FILE --color RRGGBB [--region x0,y0,x1,y1]")
    }
    let (tr, tg, tb) = (Double((rgb >> 16) & 255), Double((rgb >> 8) & 255), Double(rgb & 255))
    let w = image.width, h = image.height
    var data = [UInt8](repeating: 0, count: w * h * 4)
    let cs = CGColorSpace(name: CGColorSpace.sRGB)!
    guard let ctx = CGContext(
        data: &data, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: cs,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { fail("find-color: no bitmap context") }
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
    // A bitmap context's buffer holds the image's top row first, as the region's fractions do.
    let x0 = Int(region[0] * Double(w)), x1 = Int(region[2] * Double(w))
    let y0 = Int(region[1] * Double(h)), y1 = Int(region[3] * Double(h))
    var count = 0, sx = 0.0, sy = 0.0
    var y = max(0, y0)
    while y < min(h, y1) {
        let row = y * w * 4
        var x = max(0, x0)
        while x < min(w, x1) {
            let o = row + x * 4
            if abs(Double(data[o]) - tr) <= tol && abs(Double(data[o + 1]) - tg) <= tol && abs(Double(data[o + 2]) - tb) <= tol {
                count += 1; sx += Double(x); sy += Double(y)
            }
            x += 2
        }
        y += 2
    }
    let fx = count > 0 ? sx / Double(count) / Double(w) : -1
    let fy = count > 0 ? sy / Double(count) / Double(h) : -1
    print("{\"count\": \(count), \"x\": \(fx), \"y\": \(fy)}")
}

// builder-demo-helper dhash FILE...
//     A 256 bit difference hash per image (grey, 17 by 16, each pixel against its right hand
//     neighbour), as 64 hex characters: two stills of one screen are a few bits apart, two
//     screens are dozens. How the generator refuses to keep the same picture twice under two
//     labels, and notices a beat whose link changed nothing.
func dhash(_ files: [String]) {
    var out: [[String: Any]] = []
    for file in files {
        guard let image = loadImage(file) else {
            out.append(["file": file, "error": "unreadable image"])
            continue
        }
        let w = 17, h = 16
        var px = [UInt8](repeating: 0, count: w * h)
        guard let ctx = CGContext(
            data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w,
            space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)
        else { fail("dhash: no bitmap context") }
        ctx.interpolationQuality = .high
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        var hex = ""
        var nibble = 0, bits = 0
        for y in 0..<h {
            for x in 0..<(w - 1) {
                nibble = (nibble << 1) | (px[y * w + x] > px[y * w + x + 1] ? 1 : 0)
                bits += 1
                if bits == 4 {
                    hex += String(nibble, radix: 16)
                    nibble = 0; bits = 0
                }
            }
        }
        out.append(["file": file, "hash": hex])
    }
    let data = try! JSONSerialization.data(withJSONObject: out, options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}

// ---------------------------------------------------------------- the ship kit's drawing
//
// capture/shipkit/frame.py composes a demo into the social formats with ffmpeg, and ffmpeg
// draws no rounded rectangle, no dither and (Homebrew's 8.1.1) no text. These verbs draw the
// still layers once per format; ffmpeg only moves pixels over them.

func argMap(_ args: [String], _ verb: String) -> [String: String] {
    var m: [String: String] = [:]
    var i = 0
    while i < args.count {
        guard args[i].hasPrefix("--"), i + 1 < args.count else { fail("\(verb): expected --name value at \(args[i])") }
        m[String(args[i].dropFirst(2))] = args[i + 1]
        i += 2
    }
    return m
}

func hexColor(_ hex: String, _ alpha: CGFloat = 1) -> CGColor {
    let h = hex.replacingOccurrences(of: "#", with: "")
    guard h.count == 6, let v = Int(h, radix: 16) else { fail("not a colour: \(hex)") }
    return CGColor(
        red: CGFloat((v >> 16) & 255) / 255, green: CGFloat((v >> 8) & 255) / 255,
        blue: CGFloat(v & 255) / 255, alpha: alpha)
}

func rgbaContext(_ w: Int, _ h: Int) -> CGContext {
    guard let ctx = CGContext(
        data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { fail("no bitmap context \(w)x\(h)") }
    // Top left origin, as every rectangle this file is handed is measured.
    ctx.translateBy(x: 0, y: CGFloat(h))
    ctx.scaleBy(x: 1, y: -1)
    return ctx
}

func writePNG(_ ctx: CGContext, _ out: String) {
    guard let image = ctx.makeImage(),
          let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: out) as CFURL, UTType.png.identifier as CFString, 1, nil)
    else { fail("could not write \(out)") }
    CGImageDestinationAddImage(dest, image, nil)
    if !CGImageDestinationFinalize(dest) { fail("could not write \(out)") }
}

func rectArg(_ s: String?) -> CGRect {
    let v = (s ?? "").split(separator: ",").compactMap { Double($0) }
    guard v.count == 4 else { fail("a rectangle is x,y,w,h") }
    return CGRect(x: v[0], y: v[1], width: v[2], height: v[3])
}

/// The ordered dither threshold at (x, y) of the 8 by 8 Bayer matrix, 0..63: the table
/// design/tokens.json `dither.bayer8` holds (gen_tokens.py checks the table against exactly
/// this arithmetic, bit interleaving of x XOR y and y).
func bayer8(_ x: Int, _ y: Int) -> Int {
    let a = x ^ y
    var v = 0
    for bit in 0..<3 {
        v |= ((y >> bit) & 1) << (2 * (2 - bit))
        v |= ((a >> bit) & 1) << (2 * (2 - bit) + 1)
    }
    return v
}

func drawText(_ ctx: CGContext, _ text: String, _ box: CGRect, _ size: CGFloat, _ color: CGColor, bold: Bool) {
    let base = CTFontCreateUIFontForLanguage(.system, size, nil)!
    let font = bold ? (CTFontCreateCopyWithSymbolicTraits(base, size, nil, .boldTrait, .boldTrait) ?? base) : base
    let attrs: [NSAttributedString.Key: Any] = [
        NSAttributedString.Key(kCTFontAttributeName as String): font,
        NSAttributedString.Key(kCTForegroundColorAttributeName as String): color,
    ]
    let setter = CTFramesetterCreateWithAttributedString(NSAttributedString(string: text, attributes: attrs))
    // CoreText draws in a y up space: flip back for the frame, then restore.
    ctx.saveGState()
    ctx.translateBy(x: 0, y: box.maxY + box.minY)
    ctx.scaleBy(x: 1, y: -1)
    let frame = CTFramesetterCreateFrame(setter, CFRange(location: 0, length: 0), CGPath(rect: box, transform: nil), nil)
    CTFrameDraw(frame, ctx)
    ctx.restoreGState()
}

// builder-demo-helper backdrop --width W --height H --ground HEX --band HEX --band-top Y
//     --screen x,y,w,h --radius R [--bezel PX] [--cell PX] [--title T --title-box x,y,w,h
//     --title-size PT --title-color HEX] [--sub T --sub-size PT --sub-color HEX] --out FILE
//     The format's still layer: a flat ground, the project's hue as a panel rising from
//     `band-top` past the bottom, inset from the sides with continuous top corners, the device's
//     shadow and bezel around the screen rectangle, and the title above. The screen rectangle
//     itself is left dark: the recording is laid over it.
//
//     The panel's edge was an ordered dither in square cells first, the app's old texture. The
//     app stopped fringing its bands with pixels (docs/motion.md, the pixel diet: a fringe on
//     every card was why every screen looked the same), so the kit that shows the app does too.
//     `--cell` is still read, as the panel's inset: every format already sizes it to the canvas.
/// A rounded rectangle with continuous (squircle like) corners, as SwiftUI's `.continuous` and
/// the app's `borderCurve: 'continuous'` draw them: each corner is a cubic whose handles run past
/// the quarter circle's, so the curvature ramps in instead of starting at the tangent point.
func continuousRect(_ r: CGRect, _ radius: CGFloat) -> CGPath {
    let p = CGMutablePath()
    let c = min(radius, r.width / 2, r.height / 2)
    let k: CGFloat = 1.28 // how far past the quarter circle the corner starts (Apple's is ~1.28)
    let e = min(c * k, r.width / 2, r.height / 2)
    p.move(to: CGPoint(x: r.minX + e, y: r.minY))
    p.addLine(to: CGPoint(x: r.maxX - e, y: r.minY))
    p.addCurve(to: CGPoint(x: r.maxX, y: r.minY + e), control1: CGPoint(x: r.maxX - e * 0.36, y: r.minY), control2: CGPoint(x: r.maxX, y: r.minY + e * 0.36))
    p.addLine(to: CGPoint(x: r.maxX, y: r.maxY - e))
    p.addCurve(to: CGPoint(x: r.maxX - e, y: r.maxY), control1: CGPoint(x: r.maxX, y: r.maxY - e * 0.36), control2: CGPoint(x: r.maxX - e * 0.36, y: r.maxY))
    p.addLine(to: CGPoint(x: r.minX + e, y: r.maxY))
    p.addCurve(to: CGPoint(x: r.minX, y: r.maxY - e), control1: CGPoint(x: r.minX + e * 0.36, y: r.maxY), control2: CGPoint(x: r.minX, y: r.maxY - e * 0.36))
    p.addLine(to: CGPoint(x: r.minX, y: r.minY + e))
    p.addCurve(to: CGPoint(x: r.minX + e, y: r.minY), control1: CGPoint(x: r.minX, y: r.minY + e * 0.36), control2: CGPoint(x: r.minX + e * 0.36, y: r.minY))
    p.closeSubpath()
    return p
}

func backdrop(_ args: [String]) {
    let a = argMap(args, "backdrop")
    guard let w = Int(a["width"] ?? ""), let h = Int(a["height"] ?? ""), let out = a["out"] else { fail("backdrop: --width --height --out") }
    let ctx = rgbaContext(w, h)
    ctx.setFillColor(hexColor(a["ground"] ?? "#141210"))
    ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    let bandTop = CGFloat(Double(a["band-top"] ?? "") ?? Double(h) * 0.7)
    let cell = max(2, Int(a["cell"] ?? "") ?? 12)
    if let band = a["band"] {
        ctx.setFillColor(hexColor(band))
        let inset = CGFloat(cell * 2)
        let corner = min(CGFloat(w), CGFloat(h)) * 0.06
        // The bottom corners fall below the canvas: a panel rising from below, not a floating card.
        let panel = CGRect(x: inset, y: bandTop, width: CGFloat(w) - inset * 2, height: CGFloat(h) - bandTop + corner * 2)
        ctx.addPath(continuousRect(panel, corner))
        ctx.fillPath()
    }
    let screen = rectArg(a["screen"])
    let radius = CGFloat(Double(a["radius"] ?? "0") ?? 0)
    let bezel = CGFloat(Double(a["bezel"] ?? "0") ?? 0)
    let body = screen.insetBy(dx: -bezel, dy: -bezel)
    let bodyPath = CGPath(roundedRect: body, cornerWidth: radius + bezel, cornerHeight: radius + bezel, transform: nil)
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: body.height * 0.012), blur: body.width * 0.07, color: CGColor(red: 0, green: 0, blue: 0, alpha: 0.55))
    ctx.addPath(bodyPath)
    ctx.setFillColor(hexColor(a["bezel-color"] ?? "#0B0A09"))
    ctx.fillPath()
    ctx.restoreGState()
    if bezel > 0 {
        // A hairline on the body's edge, the way a phone's frame catches the light.
        ctx.addPath(bodyPath)
        ctx.setStrokeColor(CGColor(red: 1, green: 1, blue: 1, alpha: 0.10))
        ctx.setLineWidth(max(1, bezel * 0.18))
        ctx.strokePath()
    }
    if let title = a["title"], !title.isEmpty {
        let size = CGFloat(Double(a["title-size"] ?? "") ?? Double(w) * 0.05)
        drawText(ctx, title, rectArg(a["title-box"]), size, hexColor(a["title-color"] ?? "#F5F1EA"), bold: true)
        if let sub = a["sub"], !sub.isEmpty, let subBox = a["sub-box"] {
            let s = CGFloat(Double(a["sub-size"] ?? "") ?? Double(size) * 0.55)
            drawText(ctx, sub, rectArg(subBox), s, hexColor(a["sub-color"] ?? "#A8A29A"), bold: false)
        }
    }
    writePNG(ctx, out)
    print("{\"width\": \(w), \"height\": \(h)}")
}

// builder-demo-helper mask --width W --height H --radius R --out FILE
//     A white rounded rectangle on black, grey, the screen's own size: the alpha ffmpeg's
//     alphamerge cuts the recording to, so its corners are the device's (the table's radius).
func mask(_ args: [String]) {
    let a = argMap(args, "mask")
    guard let w = Int(a["width"] ?? ""), let h = Int(a["height"] ?? ""), let out = a["out"] else { fail("mask: --width --height --out") }
    let r = CGFloat(Double(a["radius"] ?? "0") ?? 0)
    guard let ctx = CGContext(
        data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)
    else { fail("mask: no bitmap context") }
    ctx.setFillColor(gray: 0, alpha: 1)
    ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    ctx.setFillColor(gray: 1, alpha: 1)
    let rect = CGRect(x: 0, y: 0, width: w, height: h)
    ctx.addPath(CGPath(roundedRect: rect, cornerWidth: min(r, CGFloat(w) / 2), cornerHeight: min(r, CGFloat(h) / 2), transform: nil))
    ctx.fillPath()
    writePNG(ctx, out)
}

// builder-demo-helper ring --size S --out FILE
//     The tap mark: a white ring with a soft fill and a shadow, transparent around it, S pixels
//     square. Laid over the frame where a beat's first tap landed, as it starts.
func ring(_ args: [String]) {
    let a = argMap(args, "ring")
    guard let s = Int(a["size"] ?? ""), let out = a["out"] else { fail("ring: --size --out") }
    let ctx = rgbaContext(s, s)
    let d = CGFloat(s)
    let line = max(2, d * 0.06)
    let circle = CGRect(x: d * 0.18, y: d * 0.18, width: d * 0.64, height: d * 0.64)
    // Two tones, so the mark reads on a light app and a dark one alike. FOUND ON THE FIRST RIDEGT
    // KIT: a white ring on RideGT's white search sheet was a faint grey circle nobody would see.
    ctx.setFillColor(CGColor(red: 0.08, green: 0.07, blue: 0.06, alpha: 0.18))
    ctx.fillEllipse(in: circle)
    ctx.setStrokeColor(CGColor(red: 0.08, green: 0.07, blue: 0.06, alpha: 0.78))
    ctx.setLineWidth(line * 2.2)
    ctx.strokeEllipse(in: circle.insetBy(dx: line * 1.1, dy: line * 1.1))
    ctx.setStrokeColor(CGColor(red: 1, green: 1, blue: 1, alpha: 0.98))
    ctx.setLineWidth(line)
    ctx.strokeEllipse(in: circle.insetBy(dx: line * 1.1, dy: line * 1.1))
    writePNG(ctx, out)
}

// builder-demo-helper stats FILE...
//     Grey level mean and standard deviation (0 to 255) of each image, read at 96 pixels
//     across: how the kit tells a blank screen (one flat colour, a white page still loading)
//     from a screen with anything on it. [{"file", "mean", "std"}]
func stats(_ files: [String]) {
    var out: [[String: Any]] = []
    for file in files {
        guard let image = loadImage(file) else {
            out.append(["file": file, "error": "unreadable image"])
            continue
        }
        let w = 96, h = max(1, Int((Double(image.height) / Double(image.width) * 96).rounded()))
        var px = [UInt8](repeating: 0, count: w * h)
        guard let ctx = CGContext(
            data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w,
            space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)
        else { fail("stats: no bitmap context") }
        ctx.interpolationQuality = .medium
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        let n = Double(px.count)
        let mean = px.reduce(0.0) { $0 + Double($1) } / n
        let variance = px.reduce(0.0) { $0 + (Double($1) - mean) * (Double($1) - mean) } / n
        out.append(["file": file, "mean": (mean * 100).rounded() / 100, "std": (variance.squareRoot() * 100).rounded() / 100])
    }
    let data = try! JSONSerialization.data(withJSONObject: out, options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}

let argv = Array(CommandLine.arguments.dropFirst())
guard let verb = argv.first else { fail("usage: builder-demo-helper ocr FILE... | caption --text T --width W --out FILE | find-color ...") }
switch verb {
case "ocr": ocr(Array(argv.dropFirst()))
case "caption": caption(Array(argv.dropFirst()))
case "find-color": findColor(Array(argv.dropFirst()))
case "dhash": dhash(Array(argv.dropFirst()))
case "backdrop": backdrop(Array(argv.dropFirst()))
case "mask": mask(Array(argv.dropFirst()))
case "ring": ring(Array(argv.dropFirst()))
case "stats": stats(Array(argv.dropFirst()))
case "version": print("builder-demo-helper 2")
default: fail("unknown verb \(verb)")
}
