import Foundation
import AppKit
import ScreenCaptureKit
import CoreMedia
import AVFoundation

struct AppInfo: Codable {
    let pid: Int32
    let name: String
    let bundleId: String
    let isDaw: Bool
    let category: String
    let iconDataUrl: String?
}

let knownStudioMusicBundles: [String: String] = [
    "com.apple.logic10": "Logic Pro",
    "com.ableton.live": "Ableton Live",
    "com.avid.ProTools": "Pro Tools",
    "com.image-line.flstudio": "FL Studio",
    "com.steinberg.cubase": "Cubase",
    "com.presonus.studioone": "Studio One",
    "com.cockos.reaper": "Reaper",
    "com.bitwig.studio": "Bitwig Studio",
    "com.spotify.client": "Spotify",
    "com.apple.Music": "Apple Music",
    "com.apple.garageband10": "GarageBand",
    "com.apple.mainstage3": "MainStage",
    "com.tidal.desktop": "TIDAL"
]

let knownMediaBundles: [String: String] = [
    "com.apple.Safari": "Safari",
    "com.google.Chrome": "Google Chrome",
    "company.thebrowser.Browser": "Arc",
    "org.mozilla.firefox": "Firefox",
    "com.brave.Browser": "Brave Browser",
    "com.microsoft.edgemac": "Microsoft Edge",
    "com.apple.quicktimeplayerX": "QuickTime Player",
    "org.videolan.vlc": "VLC",
    "com.colliderli.iina": "IINA"
]

func getAppIconDataUrl(app: NSRunningApplication) -> String? {
    guard let icon = app.icon else { return nil }
    let targetSize = NSSize(width: 32, height: 32)
    let resized = NSImage(size: targetSize)
    resized.lockFocus()
    icon.draw(in: NSRect(origin: .zero, size: targetSize), from: NSRect(origin: .zero, size: icon.size), operation: .copy, fraction: 1.0)
    resized.unlockFocus()
    guard let tiffData = resized.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: tiffData),
          let pngData = bitmap.representation(using: .png, properties: [:]) else {
        return nil
    }
    return "data:image/png;base64," + pngData.base64EncodedString()
}

func listRunningAudioApps() {
    let workspace = NSWorkspace.shared
    let runningApps = workspace.runningApplications

    var resultList: [AppInfo] = []

    for app in runningApps {
        guard app.activationPolicy == .regular else { continue }
        let pid = app.processIdentifier
        let rawName = app.localizedName ?? "Application"
        let bundleId = app.bundleIdentifier ?? ""
        let lowerName = rawName.lowercased()
        let lowerBundle = bundleId.lowercased()

        // Exclude JaMeet/MusicZoom processes, Electron runner, and Finder
        if lowerName.contains("jameet") ||
           lowerBundle.contains("jameet") ||
           lowerName.contains("musiczoom") ||
           lowerBundle.contains("musiczoom") ||
           lowerName == "electron" ||
           lowerBundle == "com.github.electron" ||
           lowerName == "finder" ||
           lowerBundle == "com.apple.finder" {
            continue
        }

        // Determine category
        let isMusic = knownStudioMusicBundles.keys.contains(bundleId) ||
                      lowerName.contains("logic") ||
                      lowerName.contains("ableton") ||
                      lowerName.contains("pro tools") ||
                      lowerName.contains("reaper") ||
                      lowerName.contains("fl studio") ||
                      lowerName.contains("cubase") ||
                      lowerName.contains("studio one") ||
                      lowerName.contains("bitwig") ||
                      lowerName.contains("garageband") ||
                      lowerName.contains("spotify") ||
                      lowerName == "music" ||
                      (lowerBundle.contains("music") && !lowerBundle.contains("amazon")) ||
                      lowerName.contains("tidal") ||
                      lowerName.contains("soundtrap") ||
                      lowerName.contains("mainstage")

        let isMedia = !isMusic && (
                      knownMediaBundles.keys.contains(bundleId) ||
                      lowerName.contains("safari") ||
                      lowerName.contains("chrome") ||
                      lowerName.contains("arc") ||
                      lowerName.contains("firefox") ||
                      lowerName.contains("brave") ||
                      lowerName.contains("edge") ||
                      lowerName.contains("quicktime") ||
                      lowerName.contains("vlc") ||
                      lowerName.contains("iina") ||
                      lowerName.contains("youtube") ||
                      lowerName.contains("podcast"))

        let category = isMusic ? "music" : isMedia ? "media" : "other"
        let iconUrl = getAppIconDataUrl(app: app)

        resultList.append(AppInfo(
            pid: pid,
            name: rawName,
            bundleId: bundleId,
            isDaw: isMusic,
            category: category,
            iconDataUrl: iconUrl
        ))
    }

    // Sort order: Music & DAWs first, then Media/Browsers, then Other, alphabetically within each group
    resultList.sort { (a, b) -> Bool in
        let rankA = a.category == "music" ? 0 : a.category == "media" ? 1 : 2
        let rankB = b.category == "music" ? 0 : b.category == "media" ? 1 : 2
        if rankA != rankB { return rankA < rankB }
        return a.name.localizedCompare(b.name) == .orderedAscending
    }

    let encoder = JSONEncoder()
    encoder.outputFormatting = .prettyPrinted
    if let data = try? encoder.encode(resultList), let jsonStr = String(data: data, encoding: .utf8) {
        print(jsonStr)
    }
}

func parseChannelRoute(route: String) -> (left: Int, right: Int) {
    let r = route.trimmingCharacters(in: .whitespaces)
    if r.contains("-") {
        let parts = r.split(separator: "-")
        if parts.count >= 2, let l = Int(parts[0]), let right = Int(parts[1]), l >= 1, right >= 1 {
            return (l - 1, right - 1)
        }
    }
    if let ch = Int(r), ch >= 1 {
        return (ch - 1, ch - 1)
    }
    return (0, 1)
}

func getAppAudioObjectIDs(targetPID: pid_t) -> [AudioObjectID] {
    var pids = Set<pid_t>([targetPID])

    let workspace = NSWorkspace.shared
    var targetName = ""
    var targetBundle = ""
    if let app = workspace.runningApplications.first(where: { $0.processIdentifier == targetPID }) {
        targetName = (app.localizedName ?? "").lowercased()
        targetBundle = (app.bundleIdentifier ?? "").lowercased()
    }

    let isSafari = targetName.contains("safari") || targetBundle.contains("safari")
    let isChrome = targetName.contains("chrome") || targetBundle.contains("chrome")

    if isSafari {
        for app in workspace.runningApplications {
            let n = (app.localizedName ?? "").lowercased()
            let b = (app.bundleIdentifier ?? "").lowercased()
            if n.contains("safari") || b.contains("safari") {
                pids.insert(app.processIdentifier)
            }
        }
    } else if isChrome {
        for app in workspace.runningApplications {
            let n = (app.localizedName ?? "").lowercased()
            let b = (app.bundleIdentifier ?? "").lowercased()
            if n.contains("chrome") || b.contains("chrome") {
                pids.insert(app.processIdentifier)
            }
        }
    }

    let pipe = Pipe()
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/bin/ps")
    proc.arguments = ["-A", "-o", "pid,ppid,command"]
    proc.standardOutput = pipe
    try? proc.run()
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    proc.waitUntilExit()

    if let output = String(data: data, encoding: .utf8) {
        var parentToChildren: [pid_t: [pid_t]] = [:]
        var targetCommandKeywords: [String] = []
        if isSafari { targetCommandKeywords.append("safari") }
        if isChrome { targetCommandKeywords.append("chrome") }

        for line in output.split(separator: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty || trimmed.starts(with: "PID") { continue }
            let parts = trimmed.split(separator: " ", maxSplits: 2, omittingEmptySubsequences: true)
            guard parts.count >= 3,
                  let pid = pid_t(parts[0]),
                  let ppid = pid_t(parts[1]) else { continue }
            let cmd = String(parts[2]).lowercased()
            parentToChildren[ppid, default: []].append(pid)
            if pid == targetPID {
                if cmd.contains("spotify") { targetCommandKeywords.append("spotify") }
                if cmd.contains("safari") { targetCommandKeywords.append("safari") }
                if cmd.contains("logic") { targetCommandKeywords.append("logic") }
                if cmd.contains("ableton") { targetCommandKeywords.append("ableton") }
                if cmd.contains("chrome") { targetCommandKeywords.append("chrome") }
                if cmd.contains("protools") || cmd.contains("pro tools") { targetCommandKeywords.append("pro tools") }
                if cmd.contains("reaper") { targetCommandKeywords.append("reaper") }
                if cmd.contains("fl studio") { targetCommandKeywords.append("fl studio") }
                if cmd.contains("cubase") { targetCommandKeywords.append("cubase") }
                if cmd.contains("studio one") { targetCommandKeywords.append("studio one") }
            }
        }

        var toExplore = Array(pids)
        var visited = Set<pid_t>()
        while !toExplore.isEmpty {
            let current = toExplore.removeLast()
            if visited.contains(current) { continue }
            visited.insert(current)
            pids.insert(current)
            if let children = parentToChildren[current] {
                toExplore.append(contentsOf: children)
            }
        }

        if !targetCommandKeywords.isEmpty {
            for line in output.split(separator: "\n") {
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                let parts = trimmed.split(separator: " ", maxSplits: 2, omittingEmptySubsequences: true)
                guard parts.count >= 3, let pid = pid_t(parts[0]) else { continue }
                let cmd = String(parts[2]).lowercased()
                for keyword in targetCommandKeywords {
                    if cmd.contains(keyword) {
                        pids.insert(pid)
                    }
                }
            }
        }
    }

    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyProcessObjectList,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var size: UInt32 = 0
    AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size)
    let count = Int(size) / MemoryLayout<AudioObjectID>.size

    var matched = Set<AudioObjectID>()
    if count > 0 {
        var processObjects = [AudioObjectID](repeating: 0, count: count)
        AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &processObjects)
        for obj in processObjects {
            var pidAddress = AudioObjectPropertyAddress(
                mSelector: kAudioProcessPropertyPID,
                mScope: kAudioObjectPropertyScopeGlobal,
                mElement: kAudioObjectPropertyElementMain
            )
            var objPID: pid_t = 0
            var pidSize = UInt32(MemoryLayout<pid_t>.size)
            if AudioObjectGetPropertyData(obj, &pidAddress, 0, nil, &pidSize, &objPID) == noErr {
                if pids.contains(objPID) {
                    matched.insert(obj)
                }
            }
        }
    }

    for pid in pids {
        var trAddress = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyTranslatePIDToProcessObject,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var p = pid
        var obj: AudioObjectID = kAudioObjectUnknown
        var s = UInt32(MemoryLayout<AudioObjectID>.size)
        if AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &trAddress, UInt32(MemoryLayout<pid_t>.size), &p, &s, &obj) == noErr && obj != kAudioObjectUnknown {
            matched.insert(obj)
        }
    }

    return Array(matched)
}

class CoreAudioProcessTapRunner {
    private let targetPID: pid_t
    private let appName: String
    private let outputHandle = FileHandle.standardOutput
    private var tapID: AudioObjectID = kAudioObjectUnknown
    private var aggregateDeviceID: AudioObjectID = kAudioObjectUnknown
    private var ioProcID: AudioDeviceIOProcID?
    private var sampleRate: UInt32 = 48000

    init(targetPID: pid_t, appName: String) {
        self.targetPID = targetPID
        self.appName = appName
    }

    func start() -> Bool {
        if #available(macOS 14.2, *) {
            let processObjs = getAppAudioObjectIDs(targetPID: targetPID)
            guard !processObjs.isEmpty else {
                fputs("WARN: No CoreAudio process objects found for \(appName) (PID \(targetPID)). Will fallback to ScreenCaptureKit.\n", stderr)
                return false
            }

            guard let defaultUID = getDefaultOutputDeviceUID() else {
                fputs("WARN: Could not get default CoreAudio output device UID.\n", stderr)
                return false
            }

            let desc = CATapDescription(stereoMixdownOfProcesses: processObjs)
            var createdTapID: AudioObjectID = kAudioObjectUnknown
            let tapErr = AudioHardwareCreateProcessTap(desc, &createdTapID)
            guard tapErr == noErr && createdTapID != kAudioObjectUnknown else {
                fputs("WARN: AudioHardwareCreateProcessTap failed with code \(tapErr).\n", stderr)
                return false
            }
            self.tapID = createdTapID

            var format = AudioStreamBasicDescription()
            var formatSize = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
            var formatAddress = AudioObjectPropertyAddress(
                mSelector: kAudioTapPropertyFormat,
                mScope: kAudioObjectPropertyScopeGlobal,
                mElement: kAudioObjectPropertyElementMain
            )
            if AudioObjectGetPropertyData(createdTapID, &formatAddress, 0, nil, &formatSize, &format) == noErr {
                let sr = UInt32(format.mSampleRate)
                if sr >= 8000 && sr <= 192000 {
                    self.sampleRate = sr
                }
            }

            var tapUID: CFString = "" as CFString
            var uidSize = UInt32(MemoryLayout<CFString>.size)
            var uidAddress = AudioObjectPropertyAddress(
                mSelector: kAudioTapPropertyUID,
                mScope: kAudioObjectPropertyScopeGlobal,
                mElement: kAudioObjectPropertyElementMain
            )
            _ = withUnsafeMutablePointer(to: &tapUID) { ptr in
                AudioObjectGetPropertyData(createdTapID, &uidAddress, 0, nil, &uidSize, ptr)
            }

            let aggregateDesc: [String: Any] = [
                kAudioAggregateDeviceNameKey: "JaMeet Process Tap (\(appName))",
                kAudioAggregateDeviceUIDKey: "com.musiczoom.apptap.\(UUID().uuidString)",
                kAudioAggregateDeviceMainSubDeviceKey: defaultUID,
                kAudioAggregateDeviceSubDeviceListKey: [defaultUID],
                kAudioAggregateDeviceTapListKey: [
                    [kAudioSubTapDriftCompensationKey: 1, kAudioSubTapUIDKey: tapUID as String]
                ],
                kAudioAggregateDeviceIsPrivateKey: 1
            ]

            var aggID: AudioObjectID = kAudioObjectUnknown
            let aggErr = AudioHardwareCreateAggregateDevice(aggregateDesc as CFDictionary, &aggID)
            guard aggErr == noErr && aggID != kAudioObjectUnknown else {
                fputs("WARN: AudioHardwareCreateAggregateDevice failed with code \(aggErr).\n", stderr)
                AudioHardwareDestroyProcessTap(createdTapID)
                self.tapID = kAudioObjectUnknown
                return false
            }
            self.aggregateDeviceID = aggID

            let clientData = Unmanaged.passUnretained(self).toOpaque()
            var proc: AudioDeviceIOProcID?
            let procErr = AudioDeviceCreateIOProcID(aggID, processTapIOProc, clientData, &proc)
            guard procErr == noErr, let validProc = proc else {
                fputs("WARN: AudioDeviceCreateIOProcID failed with code \(procErr).\n", stderr)
                AudioHardwareDestroyAggregateDevice(aggID)
                AudioHardwareDestroyProcessTap(createdTapID)
                self.aggregateDeviceID = kAudioObjectUnknown
                self.tapID = kAudioObjectUnknown
                return false
            }
            self.ioProcID = validProc

            let startErr = AudioDeviceStart(aggID, validProc)
            guard startErr == noErr else {
                fputs("WARN: AudioDeviceStart failed with code \(startErr).\n", stderr)
                AudioDeviceDestroyIOProcID(aggID, validProc)
                AudioHardwareDestroyAggregateDevice(aggID)
                AudioHardwareDestroyProcessTap(createdTapID)
                self.ioProcID = nil
                self.aggregateDeviceID = kAudioObjectUnknown
                self.tapID = kAudioObjectUnknown
                return false
            }

            fputs("READY: CoreAudio Process Tap active for \(appName) (PID \(targetPID)) at \(sampleRate) Hz Stereo Float32 (Strict App Isolation)\n", stderr)
            fflush(stderr)
            return true
        }
        return false
    }

    fileprivate func handleIO(inInputData: UnsafePointer<AudioBufferList>) {
        let bufferList = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inInputData))
        guard bufferList.count > 0 else { return }

        if bufferList.count == 2 {
            let leftBuf = bufferList[0]
            let rightBuf = bufferList[1]
            guard let leftPtr = leftBuf.mData?.assumingMemoryBound(to: Float32.self),
                  let rightPtr = rightBuf.mData?.assumingMemoryBound(to: Float32.self) else { return }
            let frameCount = Int(leftBuf.mDataByteSize) / MemoryLayout<Float32>.size
            guard frameCount > 0 else { return }

            let header: [UInt32] = [sampleRate, 2, UInt32(frameCount), 0]
            var interleaved = [Float32](repeating: 0, count: frameCount * 2)
            for f in 0..<frameCount {
                interleaved[f * 2] = leftPtr[f]
                interleaved[f * 2 + 1] = rightPtr[f]
            }

            var packetData = Data()
            header.withUnsafeBytes { packetData.append(contentsOf: $0) }
            interleaved.withUnsafeBytes { packetData.append(contentsOf: $0) }
            outputHandle.write(packetData)
        } else if bufferList.count == 1 {
            let buf = bufferList[0]
            let channels = Int(buf.mNumberChannels)
            guard let ptr = buf.mData?.assumingMemoryBound(to: Float32.self) else { return }

            if channels == 2 {
                let frameCount = Int(buf.mDataByteSize) / (MemoryLayout<Float32>.size * 2)
                guard frameCount > 0 else { return }
                let header: [UInt32] = [sampleRate, 2, UInt32(frameCount), 0]
                var packetData = Data()
                header.withUnsafeBytes { packetData.append(contentsOf: $0) }
                packetData.append(Data(bytes: ptr, count: Int(buf.mDataByteSize)))
                outputHandle.write(packetData)
            } else if channels == 1 {
                let frameCount = Int(buf.mDataByteSize) / MemoryLayout<Float32>.size
                guard frameCount > 0 else { return }
                let header: [UInt32] = [sampleRate, 2, UInt32(frameCount), 0]
                var stereo = [Float32](repeating: 0, count: frameCount * 2)
                for f in 0..<frameCount {
                    let sample = ptr[f]
                    stereo[f * 2] = sample
                    stereo[f * 2 + 1] = sample
                }
                var packetData = Data()
                header.withUnsafeBytes { packetData.append(contentsOf: $0) }
                stereo.withUnsafeBytes { packetData.append(contentsOf: $0) }
                outputHandle.write(packetData)
            }
        }
    }

    func stop() {
        if aggregateDeviceID != kAudioObjectUnknown, let proc = ioProcID {
            AudioDeviceStop(aggregateDeviceID, proc)
            AudioDeviceDestroyIOProcID(aggregateDeviceID, proc)
            ioProcID = nil
        }
        if aggregateDeviceID != kAudioObjectUnknown {
            AudioHardwareDestroyAggregateDevice(aggregateDeviceID)
            aggregateDeviceID = kAudioObjectUnknown
        }
        if tapID != kAudioObjectUnknown {
            if #available(macOS 14.2, *) {
                AudioHardwareDestroyProcessTap(tapID)
            }
            tapID = kAudioObjectUnknown
        }
    }

    deinit {
        stop()
    }
}

func processTapIOProc(
    inDevice: AudioObjectID,
    inNow: UnsafePointer<AudioTimeStamp>,
    inInputData: UnsafePointer<AudioBufferList>,
    inInputTime: UnsafePointer<AudioTimeStamp>,
    outOutputData: UnsafeMutablePointer<AudioBufferList>,
    inOutputTime: UnsafePointer<AudioTimeStamp>,
    inClientData: UnsafeMutableRawPointer?
) -> OSStatus {
    guard let clientData = inClientData else { return noErr }
    let runner = Unmanaged<CoreAudioProcessTapRunner>.fromOpaque(clientData).takeUnretainedValue()
    runner.handleIO(inInputData: inInputData)
    return noErr
}

func resolveRealDeviceUID(inputUID: String) -> String {
    let trimmed = inputUID.trimmingCharacters(in: .whitespaces)
    if trimmed.isEmpty || trimmed == "default" {
        var defaultOutput: AudioObjectID = kAudioObjectUnknown
        var defSize = UInt32(MemoryLayout<AudioObjectID>.size)
        var defAddr = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultOutputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        if AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &defAddr, 0, nil, &defSize, &defaultOutput) == noErr {
            var uidAddress = AudioObjectPropertyAddress(
                mSelector: kAudioDevicePropertyDeviceUID,
                mScope: kAudioObjectPropertyScopeGlobal,
                mElement: kAudioObjectPropertyElementMain
            )
            var uid: CFString = "" as CFString
            var uidSize = UInt32(MemoryLayout<CFString>.size)
            let err = withUnsafeMutablePointer(to: &uid) { ptr in
                AudioObjectGetPropertyData(defaultOutput, &uidAddress, 0, nil, &uidSize, ptr)
            }
            if err == noErr && !((uid as String).isEmpty) {
                return uid as String
            }
        }
        return inputUID
    }

    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDevices,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var size: UInt32 = 0
    AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size)
    let count = Int(size) / MemoryLayout<AudioObjectID>.size
    var devices = [AudioObjectID](repeating: 0, count: count)
    AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &devices)

    // 1. Exact UID match
    for d in devices {
        var uidAddress = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyDeviceUID,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var uid: CFString = "" as CFString
        var uidSize = UInt32(MemoryLayout<CFString>.size)
        let err = withUnsafeMutablePointer(to: &uid) { ptr in
            AudioObjectGetPropertyData(d, &uidAddress, 0, nil, &uidSize, ptr)
        }
        if err == noErr && (uid as String) == trimmed {
            return trimmed
        }
    }

    // 2. Name match or partial match
    for d in devices {
        var nameAddress = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyDeviceNameCFString,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var name: CFString = "" as CFString
        var nameSize = UInt32(MemoryLayout<CFString>.size)
        _ = withUnsafeMutablePointer(to: &name) { ptr in
            AudioObjectGetPropertyData(d, &nameAddress, 0, nil, &nameSize, ptr)
        }

        var uidAddress = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyDeviceUID,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var uid: CFString = "" as CFString
        var uidSize = UInt32(MemoryLayout<CFString>.size)
        let err = withUnsafeMutablePointer(to: &uid) { ptr in
            AudioObjectGetPropertyData(d, &uidAddress, 0, nil, &uidSize, ptr)
        }

        let nameStr = (name as String).lowercased()
        let inputLower = trimmed.lowercased()
        if err == noErr && (nameStr.contains(inputLower) || inputLower.contains(nameStr) || (inputLower.contains("apollo") && nameStr.contains("universal"))) {
            return uid as String
        }
    }

    // 3. Fallback: Default output device UID
    var defaultOutput: AudioObjectID = kAudioObjectUnknown
    var defSize = UInt32(MemoryLayout<AudioObjectID>.size)
    var defAddr = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDefaultOutputDevice,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    if AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &defAddr, 0, nil, &defSize, &defaultOutput) == noErr {
        var uidAddress = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyDeviceUID,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        var uid: CFString = "" as CFString
        var uidSize = UInt32(MemoryLayout<CFString>.size)
        let err = withUnsafeMutablePointer(to: &uid) { ptr in
            AudioObjectGetPropertyData(defaultOutput, &uidAddress, 0, nil, &uidSize, ptr)
        }
        if err == noErr && !((uid as String).isEmpty) {
            return uid as String
        }
    }

    return trimmed
}

class CoreAudioDeviceOutputTapRunner {
    private let outputHandle = FileHandle.standardOutput
    private var tapID: AudioObjectID = kAudioObjectUnknown
    private var aggregateDeviceID: AudioObjectID = kAudioObjectUnknown
    private var ioProcID: AudioDeviceIOProcID?
    private var sampleRate: UInt32 = 48000
    private let deviceUID: String
    private let leftChannel: Int
    private let rightChannel: Int

    init(deviceUID: String, channelRoute: String = "1-2") {
        self.deviceUID = resolveRealDeviceUID(inputUID: deviceUID)
        let parsed = parseChannelRoute(route: channelRoute)
        self.leftChannel = parsed.left
        self.rightChannel = parsed.right
    }

    func start() -> Bool {
        if #available(macOS 14.2, *) {
            let excluded = getExcludedAudioObjectIDs()
            let excludedNumbers = excluded.map { NSNumber(value: $0) }
            fputs("INFO: Multichannel Device Output Tap on \(deviceUID) [Channels L:\(leftChannel + 1) R:\(rightChannel + 1)] excluding \(excluded.count) MusicZoom objects.\n", stderr)

            let desc = CATapDescription(__excludingProcesses: excludedNumbers, andDeviceUID: deviceUID, withStream: 0)
            var createdTapID: AudioObjectID = kAudioObjectUnknown
            let tapErr = AudioHardwareCreateProcessTap(desc, &createdTapID)
            guard tapErr == noErr && createdTapID != kAudioObjectUnknown else {
                fputs("WARN: AudioHardwareCreateProcessTap failed with code \(tapErr).\n", stderr)
                return false
            }
            self.tapID = createdTapID

            var format = AudioStreamBasicDescription()
            var formatSize = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
            var formatAddress = AudioObjectPropertyAddress(
                mSelector: kAudioTapPropertyFormat,
                mScope: kAudioObjectPropertyScopeGlobal,
                mElement: kAudioObjectPropertyElementMain
            )
            if AudioObjectGetPropertyData(createdTapID, &formatAddress, 0, nil, &formatSize, &format) == noErr {
                let sr = UInt32(format.mSampleRate)
                if sr >= 8000 && sr <= 192000 {
                    self.sampleRate = sr
                }
            }

            var tapUID: CFString = "" as CFString
            var uidSize = UInt32(MemoryLayout<CFString>.size)
            var uidAddress = AudioObjectPropertyAddress(
                mSelector: kAudioTapPropertyUID,
                mScope: kAudioObjectPropertyScopeGlobal,
                mElement: kAudioObjectPropertyElementMain
            )
            _ = withUnsafeMutablePointer(to: &tapUID) { ptr in
                AudioObjectGetPropertyData(createdTapID, &uidAddress, 0, nil, &uidSize, ptr)
            }

            let aggregateDesc: [String: Any] = [
                kAudioAggregateDeviceNameKey: "JaMeet Device Output Tap",
                kAudioAggregateDeviceUIDKey: "com.musiczoom.devicetap.\(UUID().uuidString)",
                kAudioAggregateDeviceMainSubDeviceKey: deviceUID,
                kAudioAggregateDeviceSubDeviceListKey: [deviceUID],
                kAudioAggregateDeviceTapListKey: [
                    [kAudioSubTapDriftCompensationKey: 1, kAudioSubTapUIDKey: tapUID as String]
                ],
                kAudioAggregateDeviceIsPrivateKey: 1
            ]

            var aggID: AudioObjectID = kAudioObjectUnknown
            let aggErr = AudioHardwareCreateAggregateDevice(aggregateDesc as CFDictionary, &aggID)
            guard aggErr == noErr && aggID != kAudioObjectUnknown else {
                fputs("WARN: CreateAggregateDevice failed with code \(aggErr).\n", stderr)
                AudioHardwareDestroyProcessTap(createdTapID)
                self.tapID = kAudioObjectUnknown
                return false
            }
            self.aggregateDeviceID = aggID

            let clientData = Unmanaged.passUnretained(self).toOpaque()
            var proc: AudioDeviceIOProcID?
            let procErr = AudioDeviceCreateIOProcID(aggID, deviceTapIOProc, clientData, &proc)
            guard procErr == noErr, let validProc = proc else {
                fputs("WARN: CreateIOProcID failed with code \(procErr).\n", stderr)
                AudioHardwareDestroyAggregateDevice(aggID)
                AudioHardwareDestroyProcessTap(createdTapID)
                self.aggregateDeviceID = kAudioObjectUnknown
                self.tapID = kAudioObjectUnknown
                return false
            }
            self.ioProcID = validProc

            let startErr = AudioDeviceStart(aggID, validProc)
            guard startErr == noErr else {
                fputs("WARN: AudioDeviceStart failed with code \(startErr).\n", stderr)
                AudioDeviceDestroyIOProcID(aggID, validProc)
                AudioHardwareDestroyAggregateDevice(aggID)
                AudioHardwareDestroyProcessTap(createdTapID)
                self.ioProcID = nil
                self.aggregateDeviceID = kAudioObjectUnknown
                self.tapID = kAudioObjectUnknown
                return false
            }

            fputs("READY: Multichannel Device Output Tap active on \(deviceUID) [Channels L:\(leftChannel + 1) R:\(rightChannel + 1)] at \(sampleRate) Hz\n", stderr)
            fflush(stderr)
            return true
        }
        return false
    }

    fileprivate func handleIO(inInputData: UnsafePointer<AudioBufferList>) {
        let bufferList = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inInputData))
        guard bufferList.count > 0 else { return }

        if bufferList.count > 1 {
            let totalBuffers = bufferList.count
            let lBufIdx = leftChannel < totalBuffers ? leftChannel : -1
            let rBufIdx = rightChannel < totalBuffers ? rightChannel : -1

            let refBuf = bufferList[0]
            let frameCount = Int(refBuf.mDataByteSize) / MemoryLayout<Float32>.size
            guard frameCount > 0 else { return }

            let leftPtr = lBufIdx >= 0 ? bufferList[lBufIdx].mData?.assumingMemoryBound(to: Float32.self) : nil
            let rightPtr = rBufIdx >= 0 ? bufferList[rBufIdx].mData?.assumingMemoryBound(to: Float32.self) : nil

            let header: [UInt32] = [sampleRate, 2, UInt32(frameCount), 0]
            var interleaved = [Float32](repeating: 0, count: frameCount * 2)
            for f in 0..<frameCount {
                interleaved[f * 2] = leftPtr?[f] ?? 0.0
                interleaved[f * 2 + 1] = rightPtr?[f] ?? 0.0
            }

            var packetData = Data()
            header.withUnsafeBytes { packetData.append(contentsOf: $0) }
            interleaved.withUnsafeBytes { packetData.append(contentsOf: $0) }
            outputHandle.write(packetData)
        } else if bufferList.count == 1 {
            let buf = bufferList[0]
            let totalChannels = Int(buf.mNumberChannels)
            guard let ptr = buf.mData?.assumingMemoryBound(to: Float32.self) else { return }
            guard totalChannels > 0 else { return }

            let frameCount = Int(buf.mDataByteSize) / (MemoryLayout<Float32>.size * totalChannels)
            guard frameCount > 0 else { return }

            let lChan = leftChannel < totalChannels ? leftChannel : -1
            let rChan = rightChannel < totalChannels ? rightChannel : -1

            let header: [UInt32] = [sampleRate, 2, UInt32(frameCount), 0]
            var interleaved = [Float32](repeating: 0, count: frameCount * 2)
            for f in 0..<frameCount {
                interleaved[f * 2] = lChan >= 0 ? ptr[f * totalChannels + lChan] : 0.0
                interleaved[f * 2 + 1] = rChan >= 0 ? ptr[f * totalChannels + rChan] : 0.0
            }
            var packetData = Data()
            header.withUnsafeBytes { packetData.append(contentsOf: $0) }
            interleaved.withUnsafeBytes { packetData.append(contentsOf: $0) }
            outputHandle.write(packetData)
        }
    }

    func stop() {
        if aggregateDeviceID != kAudioObjectUnknown, let proc = ioProcID {
            AudioDeviceStop(aggregateDeviceID, proc)
            AudioDeviceDestroyIOProcID(aggregateDeviceID, proc)
            ioProcID = nil
        }
        if aggregateDeviceID != kAudioObjectUnknown {
            AudioHardwareDestroyAggregateDevice(aggregateDeviceID)
            aggregateDeviceID = kAudioObjectUnknown
        }
        if tapID != kAudioObjectUnknown {
            if #available(macOS 14.2, *) {
                AudioHardwareDestroyProcessTap(tapID)
            }
            tapID = kAudioObjectUnknown
        }
    }

    deinit {
        stop()
    }
}

func deviceTapIOProc(
    inDevice: AudioObjectID,
    inNow: UnsafePointer<AudioTimeStamp>,
    inInputData: UnsafePointer<AudioBufferList>,
    inInputTime: UnsafePointer<AudioTimeStamp>,
    outOutputData: UnsafeMutablePointer<AudioBufferList>,
    inOutputTime: UnsafePointer<AudioTimeStamp>,
    inClientData: UnsafeMutableRawPointer?
) -> OSStatus {
    guard let clientData = inClientData else { return noErr }
    let runner = Unmanaged<CoreAudioDeviceOutputTapRunner>.fromOpaque(clientData).takeUnretainedValue()
    runner.handleIO(inInputData: inInputData)
    return noErr
}

func getDefaultOutputDeviceUID() -> String? {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDefaultOutputDevice,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var deviceID: AudioObjectID = kAudioObjectUnknown
    var size = UInt32(MemoryLayout<AudioObjectID>.size)
    let status = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &deviceID)
    if status != noErr || deviceID == kAudioObjectUnknown { return nil }

    var uidAddress = AudioObjectPropertyAddress(
        mSelector: kAudioDevicePropertyDeviceUID,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var uid: CFString = "" as CFString
    var uidSize = UInt32(MemoryLayout<CFString>.size)
    let uidStatus = withUnsafeMutablePointer(to: &uid) { ptr in
        AudioObjectGetPropertyData(deviceID, &uidAddress, 0, nil, &uidSize, ptr)
    }
    if uidStatus == noErr {
        return uid as String
    }
    return nil
}

func getProcessAudioObjectID(pid: pid_t) -> AudioObjectID? {
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyTranslatePIDToProcessObject,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var targetPID = pid
    var processObjectID: AudioObjectID = kAudioObjectUnknown
    var size = UInt32(MemoryLayout<AudioObjectID>.size)

    let status = AudioObjectGetPropertyData(
        AudioObjectID(kAudioObjectSystemObject),
        &address,
        UInt32(MemoryLayout<pid_t>.size),
        &targetPID,
        &size,
        &processObjectID
    )

    if status == noErr && processObjectID != kAudioObjectUnknown {
        return processObjectID
    }
    return nil
}

func getAllMusicZoomAndSelfProcessPIDs() -> Set<pid_t> {
    var musicZoomPIDs = Set<pid_t>()
    let myPid = ProcessInfo.processInfo.processIdentifier
    let parentPid = getppid()
    musicZoomPIDs.insert(myPid)
    musicZoomPIDs.insert(parentPid)

    let workspace = NSWorkspace.shared
    for app in workspace.runningApplications {
        let name = (app.localizedName ?? "").lowercased()
        let bundle = (app.bundleIdentifier ?? "").lowercased()
        if name.contains("jameet") || bundle.contains("jameet") || name.contains("musiczoom") || bundle.contains("musiczoom") {
            musicZoomPIDs.insert(app.processIdentifier)
        }
    }

    let pipe = Pipe()
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/bin/ps")
    proc.arguments = ["-A", "-o", "pid,ppid,command"]
    proc.standardOutput = pipe
    try? proc.run()
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    proc.waitUntilExit()

    guard let output = String(data: data, encoding: .utf8) else { return musicZoomPIDs }

    var parentToChildren: [pid_t: [pid_t]] = [:]
    var identifiedRoots = Set<pid_t>()

    for line in output.split(separator: "\n") {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty || trimmed.starts(with: "PID") { continue }

        let parts = trimmed.split(separator: " ", maxSplits: 2, omittingEmptySubsequences: true)
        guard parts.count >= 3,
              let pid = pid_t(parts[0]),
              let ppid = pid_t(parts[1]) else { continue }

        let cmd = String(parts[2]).lowercased()
        parentToChildren[ppid, default: []].append(pid)

        if cmd.contains("jameet") || cmd.contains("jameet-instance") || cmd.contains("musiczoom") || cmd.contains("musiczoom-instance") {
            identifiedRoots.insert(pid)
        }
    }

    var toExplore = Array(identifiedRoots.union(musicZoomPIDs))
    var visited = Set<pid_t>()

    while !toExplore.isEmpty {
        let current = toExplore.removeLast()
        if visited.contains(current) { continue }
        visited.insert(current)
        musicZoomPIDs.insert(current)

        if let children = parentToChildren[current] {
            for child in children {
                if !visited.contains(child) {
                    toExplore.append(child)
                }
            }
        }
    }

    return musicZoomPIDs
}

func getExcludedAudioObjectIDs() -> [AudioObjectID] {
    let targetPIDs = getAllMusicZoomAndSelfProcessPIDs()
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyProcessObjectList,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var size: UInt32 = 0
    AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size)
    let count = Int(size) / MemoryLayout<AudioObjectID>.size

    var excluded = Set<AudioObjectID>()

    if count > 0 {
        var processObjects = [AudioObjectID](repeating: 0, count: count)
        AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &processObjects)

        for obj in processObjects {
            var pidAddress = AudioObjectPropertyAddress(
                mSelector: kAudioProcessPropertyPID,
                mScope: kAudioObjectPropertyScopeGlobal,
                mElement: kAudioObjectPropertyElementMain
            )
            var objPID: pid_t = 0
            var pidSize = UInt32(MemoryLayout<pid_t>.size)
            if AudioObjectGetPropertyData(obj, &pidAddress, 0, nil, &pidSize, &objPID) == noErr {
                if targetPIDs.contains(objPID) {
                    excluded.insert(obj)
                }
            }
        }
    }

    for pid in targetPIDs {
        if let obj = getProcessAudioObjectID(pid: pid) {
            excluded.insert(obj)
        }
    }

    return Array(excluded)
}

class CoreAudioGlobalTapRunner {
    private let outputHandle = FileHandle.standardOutput
    private var tapID: AudioObjectID = kAudioObjectUnknown
    private var aggregateDeviceID: AudioObjectID = kAudioObjectUnknown
    private var ioProcID: AudioDeviceIOProcID?
    private var sampleRate: UInt32 = 48000
    private let targetDeviceUID: String?

    init(targetDeviceUID: String? = nil) {
        self.targetDeviceUID = targetDeviceUID
    }

    func start() -> Bool {
        if #available(macOS 14.2, *) {
            guard let defaultUID = targetDeviceUID ?? getDefaultOutputDeviceUID() else {
                fputs("WARN: Could not resolve output device UID for global tap.\n", stderr)
                return false
            }

            let excluded = getExcludedAudioObjectIDs()
            fputs("INFO: CoreAudio Global Tap excluding \(excluded.count) MusicZoom/Electron process audio objects to prevent feedback.\n", stderr)

            let desc = CATapDescription(stereoGlobalTapButExcludeProcesses: excluded)
            var createdTapID: AudioObjectID = kAudioObjectUnknown
            let tapErr = AudioHardwareCreateProcessTap(desc, &createdTapID)
            guard tapErr == noErr && createdTapID != kAudioObjectUnknown else {
                fputs("WARN: Global AudioHardwareCreateProcessTap failed with code \(tapErr).\n", stderr)
                return false
            }
            self.tapID = createdTapID

            var format = AudioStreamBasicDescription()
            var formatSize = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
            var formatAddress = AudioObjectPropertyAddress(
                mSelector: kAudioTapPropertyFormat,
                mScope: kAudioObjectPropertyScopeGlobal,
                mElement: kAudioObjectPropertyElementMain
            )
            if AudioObjectGetPropertyData(createdTapID, &formatAddress, 0, nil, &formatSize, &format) == noErr {
                let sr = UInt32(format.mSampleRate)
                if sr >= 8000 && sr <= 192000 {
                    self.sampleRate = sr
                }
            }

            var tapUID: CFString = "" as CFString
            var uidSize = UInt32(MemoryLayout<CFString>.size)
            var uidAddress = AudioObjectPropertyAddress(
                mSelector: kAudioTapPropertyUID,
                mScope: kAudioObjectPropertyScopeGlobal,
                mElement: kAudioObjectPropertyElementMain
            )
            _ = withUnsafeMutablePointer(to: &tapUID) { ptr in
                AudioObjectGetPropertyData(createdTapID, &uidAddress, 0, nil, &uidSize, ptr)
            }

            let aggregateDesc: [String: Any] = [
                kAudioAggregateDeviceNameKey: "JaMeet Global Tap",
                kAudioAggregateDeviceUIDKey: "com.musiczoom.gtap.\(UUID().uuidString)",
                kAudioAggregateDeviceMainSubDeviceKey: defaultUID,
                kAudioAggregateDeviceSubDeviceListKey: [defaultUID],
                kAudioAggregateDeviceTapListKey: [
                    [kAudioSubTapDriftCompensationKey: 1, kAudioSubTapUIDKey: tapUID as String]
                ],
                kAudioAggregateDeviceIsPrivateKey: 1
            ]

            var aggID: AudioObjectID = kAudioObjectUnknown
            let aggErr = AudioHardwareCreateAggregateDevice(aggregateDesc as CFDictionary, &aggID)
            guard aggErr == noErr && aggID != kAudioObjectUnknown else {
                fputs("WARN: Global AudioHardwareCreateAggregateDevice failed with code \(aggErr).\n", stderr)
                AudioHardwareDestroyProcessTap(createdTapID)
                self.tapID = kAudioObjectUnknown
                return false
            }
            self.aggregateDeviceID = aggID

            let clientData = Unmanaged.passUnretained(self).toOpaque()
            var proc: AudioDeviceIOProcID?
            let procErr = AudioDeviceCreateIOProcID(aggID, globalTapIOProc, clientData, &proc)
            guard procErr == noErr, let validProc = proc else {
                fputs("WARN: Global AudioDeviceCreateIOProcID failed with code \(procErr).\n", stderr)
                AudioHardwareDestroyAggregateDevice(aggID)
                AudioHardwareDestroyProcessTap(createdTapID)
                self.aggregateDeviceID = kAudioObjectUnknown
                self.tapID = kAudioObjectUnknown
                return false
            }
            self.ioProcID = validProc

            let startErr = AudioDeviceStart(aggID, validProc)
            guard startErr == noErr else {
                fputs("WARN: Global AudioDeviceStart failed with code \(startErr).\n", stderr)
                AudioDeviceDestroyIOProcID(aggID, validProc)
                AudioHardwareDestroyAggregateDevice(aggID)
                AudioHardwareDestroyProcessTap(createdTapID)
                self.ioProcID = nil
                self.aggregateDeviceID = kAudioObjectUnknown
                self.tapID = kAudioObjectUnknown
                return false
            }

            fputs("READY: CoreAudio Global Tap active on \(defaultUID) at \(sampleRate) Hz Stereo Float32 (Excluding MusicZoom)\n", stderr)
            fflush(stderr)
            return true
        }
        return false
    }

    fileprivate func handleIO(inInputData: UnsafePointer<AudioBufferList>) {
        let bufferList = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inInputData))
        guard bufferList.count > 0 else { return }

        if bufferList.count == 2 {
            let leftBuf = bufferList[0]
            let rightBuf = bufferList[1]
            guard let leftPtr = leftBuf.mData?.assumingMemoryBound(to: Float32.self),
                  let rightPtr = rightBuf.mData?.assumingMemoryBound(to: Float32.self) else { return }
            let frameCount = Int(leftBuf.mDataByteSize) / MemoryLayout<Float32>.size
            guard frameCount > 0 else { return }

            let header: [UInt32] = [sampleRate, 2, UInt32(frameCount), 0]
            var interleaved = [Float32](repeating: 0, count: frameCount * 2)
            for f in 0..<frameCount {
                interleaved[f * 2] = leftPtr[f]
                interleaved[f * 2 + 1] = rightPtr[f]
            }

            var packetData = Data()
            header.withUnsafeBytes { packetData.append(contentsOf: $0) }
            interleaved.withUnsafeBytes { packetData.append(contentsOf: $0) }
            outputHandle.write(packetData)
        } else if bufferList.count == 1 {
            let buf = bufferList[0]
            let channels = Int(buf.mNumberChannels)
            guard let ptr = buf.mData?.assumingMemoryBound(to: Float32.self) else { return }

            if channels == 2 {
                let frameCount = Int(buf.mDataByteSize) / (MemoryLayout<Float32>.size * 2)
                guard frameCount > 0 else { return }
                let header: [UInt32] = [sampleRate, 2, UInt32(frameCount), 0]
                var packetData = Data()
                header.withUnsafeBytes { packetData.append(contentsOf: $0) }
                packetData.append(Data(bytes: ptr, count: Int(buf.mDataByteSize)))
                outputHandle.write(packetData)
            } else if channels == 1 {
                let frameCount = Int(buf.mDataByteSize) / MemoryLayout<Float32>.size
                guard frameCount > 0 else { return }
                let header: [UInt32] = [sampleRate, 2, UInt32(frameCount), 0]
                var stereo = [Float32](repeating: 0, count: frameCount * 2)
                for f in 0..<frameCount {
                    let sample = ptr[f]
                    stereo[f * 2] = sample
                    stereo[f * 2 + 1] = sample
                }
                var packetData = Data()
                header.withUnsafeBytes { packetData.append(contentsOf: $0) }
                stereo.withUnsafeBytes { packetData.append(contentsOf: $0) }
                outputHandle.write(packetData)
            }
        }
    }

    func stop() {
        if aggregateDeviceID != kAudioObjectUnknown, let proc = ioProcID {
            AudioDeviceStop(aggregateDeviceID, proc)
            AudioDeviceDestroyIOProcID(aggregateDeviceID, proc)
            ioProcID = nil
        }
        if aggregateDeviceID != kAudioObjectUnknown {
            AudioHardwareDestroyAggregateDevice(aggregateDeviceID)
            aggregateDeviceID = kAudioObjectUnknown
        }
        if tapID != kAudioObjectUnknown {
            if #available(macOS 14.2, *) {
                AudioHardwareDestroyProcessTap(tapID)
            }
            tapID = kAudioObjectUnknown
        }
    }

    deinit {
        stop()
    }
}

func globalTapIOProc(
    inDevice: AudioObjectID,
    inNow: UnsafePointer<AudioTimeStamp>,
    inInputData: UnsafePointer<AudioBufferList>,
    inInputTime: UnsafePointer<AudioTimeStamp>,
    outOutputData: UnsafeMutablePointer<AudioBufferList>,
    inOutputTime: UnsafePointer<AudioTimeStamp>,
    inClientData: UnsafeMutableRawPointer?
) -> OSStatus {
    guard let clientData = inClientData else { return noErr }
    let runner = Unmanaged<CoreAudioGlobalTapRunner>.fromOpaque(clientData).takeUnretainedValue()
    runner.handleIO(inInputData: inInputData)
    return noErr
}

class ScreenCaptureKitAudioTapRunner: NSObject, SCStreamOutput, SCStreamDelegate {
    private var stream: SCStream?
    private let targetPID: pid_t
    private let outputHandle = FileHandle.standardOutput

    init(targetPID: pid_t) {
        self.targetPID = targetPID
        super.init()
    }

    func start() async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        guard let app = content.applications.first(where: { $0.processID == targetPID }) else {
            fputs("ERROR: Target application (PID \(targetPID)) not found in shareable content.\n", stderr)
            exit(1)
        }

        guard let display = content.displays.first else {
            fputs("ERROR: No display found.\n", stderr)
            exit(1)
        }

        let filter = SCContentFilter(display: display, including: [app], exceptingWindows: [])
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.sampleRate = 48000
        config.channelCount = 2
        config.excludesCurrentProcessAudio = true
        config.width = 4
        config.height = 4
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)

        let newStream = SCStream(filter: filter, configuration: config, delegate: self)
        try newStream.addStreamOutput(self, type: .audio, sampleHandlerQueue: DispatchQueue(label: "musiczoom.tap.audio", qos: .userInteractive))
        try await newStream.startCapture()
        self.stream = newStream
        fputs("READY: ScreenCaptureKit Audio Tap active for \(app.applicationName) (PID \(targetPID)) at 48000 Hz Stereo Float32\n", stderr)
        fflush(stderr)
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, sampleBuffer.isValid else { return }

        var blockBuffer: CMBlockBuffer?
        var audioBufferList = AudioBufferList()

        let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: nil,
            bufferListOut: &audioBufferList,
            bufferListSize: MemoryLayout<AudioBufferList>.size,
            blockBufferAllocator: nil,
            blockBufferMemoryAllocator: nil,
            flags: 0,
            blockBufferOut: &blockBuffer
        )

        guard status == noErr else { return }
        let bufferListPointer = UnsafeMutableAudioBufferListPointer(&audioBufferList)
        guard bufferListPointer.count > 0 else { return }

        var sampleRate: UInt32 = 48000
        if let formatDesc = CMSampleBufferGetFormatDescription(sampleBuffer),
           let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(formatDesc) {
            let sr = UInt32(asbd.pointee.mSampleRate)
            if sr >= 8000 && sr <= 192000 { sampleRate = sr }
        }

        if bufferListPointer.count == 2 {
            let leftBuf = bufferListPointer[0]
            let rightBuf = bufferListPointer[1]
            guard let leftPtr = leftBuf.mData?.assumingMemoryBound(to: Float32.self),
                  let rightPtr = rightBuf.mData?.assumingMemoryBound(to: Float32.self) else { return }

            let frameCount = Int(leftBuf.mDataByteSize) / MemoryLayout<Float32>.size
            guard frameCount > 0 else { return }

            let header: [UInt32] = [sampleRate, 2, UInt32(frameCount), 0]
            var interleaved = [Float32](repeating: 0, count: frameCount * 2)
            for f in 0..<frameCount {
                interleaved[f * 2] = leftPtr[f]
                interleaved[f * 2 + 1] = rightPtr[f]
            }

            var packetData = Data()
            header.withUnsafeBytes { packetData.append(contentsOf: $0) }
            interleaved.withUnsafeBytes { packetData.append(contentsOf: $0) }
            outputHandle.write(packetData)
        } else if bufferListPointer.count == 1 {
            let buf = bufferListPointer[0]
            let channels = Int(buf.mNumberChannels)
            guard let ptr = buf.mData?.assumingMemoryBound(to: Float32.self) else { return }

            if channels == 2 {
                let frameCount = Int(buf.mDataByteSize) / (MemoryLayout<Float32>.size * 2)
                guard frameCount > 0 else { return }
                let header: [UInt32] = [sampleRate, 2, UInt32(frameCount), 0]
                var packetData = Data()
                header.withUnsafeBytes { packetData.append(contentsOf: $0) }
                packetData.append(Data(bytes: ptr, count: Int(buf.mDataByteSize)))
                outputHandle.write(packetData)
            } else if channels == 1 {
                let frameCount = Int(buf.mDataByteSize) / MemoryLayout<Float32>.size
                guard frameCount > 0 else { return }
                let header: [UInt32] = [sampleRate, 2, UInt32(frameCount), 0]
                var stereo = [Float32](repeating: 0, count: frameCount * 2)
                for f in 0..<frameCount {
                    let sample = ptr[f]
                    stereo[f * 2] = sample
                    stereo[f * 2 + 1] = sample
                }
                var packetData = Data()
                header.withUnsafeBytes { packetData.append(contentsOf: $0) }
                stereo.withUnsafeBytes { packetData.append(contentsOf: $0) }
                outputHandle.write(packetData)
            }
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        fputs("STREAM_STOPPED: \(error.localizedDescription)\n", stderr)
        exit(0)
    }
}

let args = CommandLine.arguments
if args.count < 2 || args[1] == "list" {
    listRunningAudioApps()
    exit(0)
}

var activeGlobalRunner: CoreAudioGlobalTapRunner?
var activeDeviceRunner: CoreAudioDeviceOutputTapRunner?
var activeAppRunner: CoreAudioProcessTapRunner?

if args[1] == "capture" && args.count >= 2 {
    let mode = args.count >= 3 ? args[2] : "global"

    if mode == "app" && args.count >= 4, let targetPid = Int32(args[3]) {
        var appName = "Application"
        let runningApps = NSWorkspace.shared.runningApplications
        if let foundApp = runningApps.first(where: { $0.processIdentifier == targetPid }) {
            appName = foundApp.localizedName ?? "Application"
        }

        let appRunner = CoreAudioProcessTapRunner(targetPID: targetPid, appName: appName)
        if appRunner.start() {
            activeAppRunner = appRunner
        } else {
            fputs("INFO: Falling back to ScreenCaptureKit audio tap for \(appName) (PID \(targetPid))...\n", stderr)
            let fallbackRunner = ScreenCaptureKitAudioTapRunner(targetPID: targetPid)
            Task {
                do {
                    try await fallbackRunner.start()
                } catch {
                    fputs("ERROR: Failed to start app capture: \(error.localizedDescription)\n", stderr)
                    exit(1)
                }
            }
        }
    } else if mode == "device" && args.count >= 4 {
        let deviceUID = args[3]
        let channelRoute = args.count >= 5 ? args[4] : "1-2"
        let deviceRunner = CoreAudioDeviceOutputTapRunner(deviceUID: deviceUID, channelRoute: channelRoute)
        if deviceRunner.start() {
            activeDeviceRunner = deviceRunner
        } else {
            fputs("ERROR: Failed to start Device Output Tap on \(deviceUID)\n", stderr)
            exit(1)
        }
    } else if mode == "global" || mode == "system" {
        let globalRunner = CoreAudioGlobalTapRunner()
        if globalRunner.start() {
            activeGlobalRunner = globalRunner
        } else {
            fputs("ERROR: Failed to start Global Computer Audio Tap\n", stderr)
            exit(1)
        }
    } else if let targetPid = Int32(mode) {
        var appName = "Application"
        let runningApps = NSWorkspace.shared.runningApplications
        if let foundApp = runningApps.first(where: { $0.processIdentifier == targetPid }) {
            appName = foundApp.localizedName ?? "Application"
        }

        let appRunner = CoreAudioProcessTapRunner(targetPID: targetPid, appName: appName)
        if appRunner.start() {
            activeAppRunner = appRunner
        } else {
            let fallbackRunner = ScreenCaptureKitAudioTapRunner(targetPID: targetPid)
            Task {
                do {
                    try await fallbackRunner.start()
                } catch {
                    fputs("ERROR: Failed to start app capture: \(error.localizedDescription)\n", stderr)
                    exit(1)
                }
            }
        }
    }

    signal(SIGINT) { _ in
        activeGlobalRunner?.stop()
        activeDeviceRunner?.stop()
        activeAppRunner?.stop()
        exit(0)
    }
    signal(SIGTERM) { _ in
        activeGlobalRunner?.stop()
        activeDeviceRunner?.stop()
        activeAppRunner?.stop()
        exit(0)
    }
    dispatchMain()
} else {
    print("Usage: musiczoom-app-audio-tap list | capture [app <pid> | device <uid> [channelRoute] | global]")
    exit(1)
}
