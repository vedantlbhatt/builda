// The demo generator's one native helper, compiled on first use with /usr/bin/swiftc into
// ~/.builder/tools (capture/demo/tools.py). Two verbs:
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
        request.minimumTextHeight = 0.008
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

let argv = Array(CommandLine.arguments.dropFirst())
guard let verb = argv.first else { fail("usage: builder-demo-helper ocr FILE... | caption --text T --width W --out FILE | find-color ...") }
switch verb {
case "ocr": ocr(Array(argv.dropFirst()))
case "caption": caption(Array(argv.dropFirst()))
case "find-color": findColor(Array(argv.dropFirst()))
case "dhash": dhash(Array(argv.dropFirst()))
case "version": print("builder-demo-helper 1")
default: fail("unknown verb \(verb)")
}
