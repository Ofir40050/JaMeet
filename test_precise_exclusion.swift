import Foundation
import AppKit

func getMusicZoomProcessPIDs() -> Set<pid_t> {
    var musicZoomPIDs = Set<pid_t>()
    
    // 1. Current process and parent chain
    let myPid = ProcessInfo.processInfo.processIdentifier
    let parentPid = getppid()
    musicZoomPIDs.insert(myPid)
    musicZoomPIDs.insert(parentPid)
    
    // 2. Read full process list with args: `ps -A -o pid,ppid,command`
    let pipe = Pipe()
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/bin/ps")
    proc.arguments = ["-A", "-o", "pid,ppid,command"]
    proc.standardOutput = pipe
    try? proc.run()
    proc.waitUntilExit()
    
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
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
        
        // Match if command/arguments reference JaMeet or legacy MusicZoom
        if cmd.contains("jameet") || cmd.contains("jameet-instance") || cmd.contains("musiczoom") || cmd.contains("musiczoom-instance") {
            identifiedRoots.insert(pid)
            identifiedRoots.insert(ppid)
        }
    }
    
    // 3. Find all descendant child/helper processes of any identified MusicZoom process
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

let pids = getMusicZoomProcessPIDs()
print("Identified exact MusicZoom PIDs:", pids)

// Verify other apps like Antigravity IDE, Spotify, ChatGPT are NOT in pids
let workspace = NSWorkspace.shared
for app in workspace.runningApplications {
    let name = app.localizedName ?? ""
    if pids.contains(app.processIdentifier) {
        print("  EXCLUDED:", name, "(PID \(app.processIdentifier))")
    } else {
        // print("  ALLOWED (Capturable):", name, "(PID \(app.processIdentifier))")
    }
}
