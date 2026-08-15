import Foundation
import AppKit
import ScreenCaptureKit
import CoreMedia
import CoreVideo

// ========================================================
// MusicZoom Native ScreenCaptureKit Display Capture Engine
// Excludes the exact MusicZoom application at capture level
// ========================================================

struct DisplayInfo: Codable {
    let id: UInt32
    let width: Int
    let height: Int
    let isMain: Bool
}

class CaptureStreamHandler: NSObject, SCStreamOutput, SCStreamDelegate {
    private var isWriting = false
    private let writeLock = NSLock()
    private let targetFps: Int
    private var lastEmittedTime: Double = 0
    private let minInterval: Double
    private let outHandle = FileHandle.standardOutput

    init(fps: Int) {
        self.targetFps = fps
        self.minInterval = 1.0 / Double(fps)
        super.init()
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen else { return }
        guard sampleBuffer.isValid else { return }

        let now = CACurrentMediaTime()
        if now - lastEmittedTime < (minInterval * 0.85) {
            return
        }

        guard let imageBuffer = sampleBuffer.imageBuffer else { return }

        guard writeLock.try() else { return }
        defer { writeLock.unlock() }

        CVPixelBufferLockBaseAddress(imageBuffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(imageBuffer, .readOnly) }

        guard let baseAddress = CVPixelBufferGetBaseAddress(imageBuffer) else { return }

        let width = CVPixelBufferGetWidth(imageBuffer)
        let height = CVPixelBufferGetHeight(imageBuffer)
        let bytesPerRow = CVPixelBufferGetBytesPerRow(imageBuffer)
        let totalBytes = bytesPerRow * height

        // 24-byte Binary Header:
        // [0..3]:   Magic "MZFR" (0x52465A4D)
        // [4..7]:   Width (UInt32 Little Endian)
        // [8..11]:  Height (UInt32 Little Endian)
        // [12..15]: BytesPerRow (UInt32 Little Endian)
        // [16..19]: TotalPayloadBytes (UInt32 Little Endian)
        // [20..23]: TimestampMs (UInt32 Little Endian)

        var header = [UInt8](repeating: 0, count: 24)
        header[0] = 0x4D // 'M'
        header[1] = 0x5A // 'Z'
        header[2] = 0x46 // 'F'
        header[3] = 0x52 // 'R'

        let uWidth = UInt32(width)
        let uHeight = UInt32(height)
        let uBytesPerRow = UInt32(bytesPerRow)
        let uPayload = UInt32(totalBytes)
        let uTimestamp = UInt32(truncatingIfNeeded: UInt64(now * 1000.0))

        withUnsafeBytes(of: uWidth.littleEndian) { header.replaceSubrange(4..<8, with: $0) }
        withUnsafeBytes(of: uHeight.littleEndian) { header.replaceSubrange(8..<12, with: $0) }
        withUnsafeBytes(of: uBytesPerRow.littleEndian) { header.replaceSubrange(12..<16, with: $0) }
        withUnsafeBytes(of: uPayload.littleEndian) { header.replaceSubrange(16..<20, with: $0) }
        withUnsafeBytes(of: uTimestamp.littleEndian) { header.replaceSubrange(20..<24, with: $0) }

        let headerData = Data(header)
        let pixelData = Data(bytes: baseAddress, count: totalBytes)

        try? outHandle.write(contentsOf: headerData)
        try? outHandle.write(contentsOf: pixelData)

        lastEmittedTime = now
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        fputs("ScreenCaptureKit stream stopped with error: \(error.localizedDescription)\n", stderr)
        exit(1)
    }
}

// Global strong references to prevent ARC deallocation while capturing
var globalActiveStream: SCStream?
var globalStreamHandler: CaptureStreamHandler?

func listDisplays() {
    SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: false) { content, error in
        if let error = error {
            fputs("Error getting shareable content: \(error.localizedDescription)\n", stderr)
            print("[]")
            exit(1)
        }
        guard let content = content else {
            print("[]")
            exit(0)
        }

        var displaysList: [DisplayInfo] = []
        let mainDisplayId = CGMainDisplayID()

        for display in content.displays {
            let isMain = display.displayID == mainDisplayId
            displaysList.append(DisplayInfo(
                id: display.displayID,
                width: display.width,
                height: display.height,
                isMain: isMain
            ))
        }

        if let jsonData = try? JSONEncoder().encode(displaysList),
           let jsonString = String(data: jsonData, encoding: .utf8) {
            print(jsonString)
        } else {
            print("[]")
        }
        exit(0)
    }
    RunLoop.main.run()
}

func captureDisplay(targetDisplayId: UInt32?, targetAppPid: Int32?, targetBundleId: String?, fps: Int, maxWidth: Int?, maxHeight: Int?) {
    SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: false) { content, error in
        if let error = error {
            fputs("Error retrieving shareable content: \(error.localizedDescription)\n", stderr)
            exit(1)
        }
        guard let content = content else {
            fputs("No shareable content available.\n", stderr)
            exit(1)
        }

        // 1. Locate target SCDisplay (by direct CGDirectDisplayID or display index)
        let targetDisplay: SCDisplay
        if let displayId = targetDisplayId,
           let matched = content.displays.first(where: { $0.displayID == displayId }) {
            targetDisplay = matched
        } else if let displayId = targetDisplayId, Int(displayId) < content.displays.count {
            targetDisplay = content.displays[Int(displayId)]
        } else if let mainDisplay = content.displays.first(where: { $0.displayID == CGMainDisplayID() }) {
            targetDisplay = mainDisplay
        } else if let firstDisplay = content.displays.first {
            targetDisplay = firstDisplay
        } else {
            fputs("No display found to capture.\n", stderr)
            exit(1)
        }

        // 2. Identify the exact running MusicZoom application instance and its owned windows
        var excludedApplications: [SCRunningApplication] = []
        if let targetPid = targetAppPid {
            for app in content.applications {
                if app.processID == targetPid {
                    excludedApplications.append(app)
                }
            }
        }

        // Search for windows owned specifically by this target PID
        var excludedWindows: [SCWindow] = []
        if let targetPid = targetAppPid {
            for win in content.windows {
                if win.owningApplication?.processID == targetPid {
                    excludedWindows.append(win)
                }
            }
        }

        // If targetPid did not directly match any application in content.applications, fallback to exact bundle ID
        if excludedApplications.isEmpty {
            if let targetBundle = targetBundleId?.lowercased(), !targetBundle.isEmpty {
                for app in content.applications {
                    if app.bundleIdentifier.lowercased() == targetBundle {
                        excludedApplications.append(app)
                    }
                }
            }
        }

        // 3. Build the SCContentFilter strictly excluding the exact MusicZoom application
        let filter: SCContentFilter
        if !excludedApplications.isEmpty {
            filter = SCContentFilter(
                display: targetDisplay,
                excludingApplications: excludedApplications,
                exceptingWindows: []
            )
        } else if !excludedWindows.isEmpty {
            filter = SCContentFilter(
                display: targetDisplay,
                excludingWindows: excludedWindows
            )
        } else {
            filter = SCContentFilter(
                display: targetDisplay,
                excludingApplications: [],
                exceptingWindows: []
            )
        }

        // 4. Configure Stream parameters
        let config = SCStreamConfiguration()
        config.showsCursor = true
        config.pixelFormat = kCVPixelFormatType_32BGRA
        config.queueDepth = 3

        let captureWidth = maxWidth ?? min(1920, targetDisplay.width)
        let captureHeight = maxHeight ?? min(1080, targetDisplay.height)
        config.width = captureWidth
        config.height = captureHeight

        let frameInterval = CMTime(value: 1, timescale: Int32(fps))
        config.minimumFrameInterval = frameInterval

        let streamHandler = CaptureStreamHandler(fps: fps)
        globalStreamHandler = streamHandler
        let stream = SCStream(filter: filter, configuration: config, delegate: streamHandler)
        globalActiveStream = stream

        do {
            let queue = DispatchQueue(label: "com.musiczoom.screencapture.queue", qos: .userInteractive)
            try stream.addStreamOutput(streamHandler, type: .screen, sampleHandlerQueue: queue)
            stream.startCapture { startError in
                if let startError = startError {
                    fputs("Failed to start SCStream capture: \(startError.localizedDescription)\n", stderr)
                    exit(1)
                }
                fputs("READY: ScreenCaptureKit capture active for display \(targetDisplay.displayID) (excluding exact MusicZoom PID \(targetAppPid ?? 0))\n", stderr)
            }
        } catch {
            fputs("Failed to initialize SCStream: \(error.localizedDescription)\n", stderr)
            exit(1)
        }
    }
    RunLoop.main.run()
}

// ========================================================
// CLI Entry Point
// ========================================================
let args = CommandLine.arguments

if args.contains("list") || args.contains("list-displays") {
    listDisplays()
} else if args.count > 1 && (args[1] == "capture" || args[1] == "capture-display") {
    var displayId: UInt32? = nil
    var targetPid: Int32? = nil
    var targetBundleId: String? = nil
    var fps = 15
    var width: Int? = nil
    var height: Int? = nil

    var i = 2
    while i < args.count {
        let arg = args[i]
        if arg == "--display" && i + 1 < args.count {
            displayId = UInt32(args[i + 1])
            i += 2
        } else if arg == "--app-pid" && i + 1 < args.count {
            targetPid = Int32(args[i + 1])
            i += 2
        } else if arg == "--bundle-id" && i + 1 < args.count {
            targetBundleId = args[i + 1]
            i += 2
        } else if arg == "--fps" && i + 1 < args.count {
            fps = Int(args[i + 1]) ?? 15
            i += 2
        } else if arg == "--width" && i + 1 < args.count {
            width = Int(args[i + 1])
            i += 2
        } else if arg == "--height" && i + 1 < args.count {
            height = Int(args[i + 1])
            i += 2
        } else {
            if displayId == nil, let num = UInt32(arg) {
                displayId = num
            }
            i += 1
        }
    }

    captureDisplay(
        targetDisplayId: displayId,
        targetAppPid: targetPid,
        targetBundleId: targetBundleId,
        fps: fps,
        maxWidth: width,
        maxHeight: height
    )
} else {
    print("Usage:")
    print("  musiczoom-screen-capture list-displays")
    print("  musiczoom-screen-capture capture-display [--display <id>] --app-pid <pid> [--fps <15|30>] [--width <w>] [--height <h>]")
    exit(0)
}
