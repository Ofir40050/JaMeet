const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const binDir = path.join(rootDir, 'bin');
fs.mkdirSync(binDir, { recursive: true });

if (process.platform === 'darwin') {
  const builds = [
    {
      name: 'set-rate',
      cmd: 'clang -O2 -framework CoreAudio -framework CoreFoundation src/main/set-rate.c -o bin/set-rate'
    },
    {
      name: 'jameet-hardware-input',
      cmd: 'clang -O2 -framework CoreAudio -framework AudioToolbox -framework CoreFoundation src/main/jameet-hardware-input.c -o bin/jameet-hardware-input'
    },
    {
      name: 'jameet-app-audio-tap',
      cmd: 'swiftc -O src/main/jameet-app-audio-tap.swift -o bin/jameet-app-audio-tap'
    },
    {
      name: 'jameet-screen-capture',
      cmd: 'swiftc -O src/main/jameet-screen-capture.swift -o bin/jameet-screen-capture'
    },
    {
      name: 'jameet-remote-producer',
      cmd: 'clang -O2 -framework CoreFoundation -Isrc/main/bridge src/main/bridge/jameet-remote-producer.c src/main/bridge/jameet_remote_bridge.c src/main/bridge/jameet_remote_transport_posix.c -o bin/jameet-remote-producer'
    },
    {
      name: 'JaMeetRemote.driver',
      cmd: 'bash src/main/driver-macos/build-driver.sh src/main/driver-macos/dist',
      dest: path.join(rootDir, 'src/main/driver-macos/dist/JaMeetRemote.driver')
    }
  ];

  for (const build of builds) {
    try {
      console.log(`[build-native] Compiling ${build.name}...`);
      execSync(build.cmd, { cwd: rootDir, stdio: 'inherit' });
      const dest = build.dest || path.join(binDir, build.name);
      if (!fs.existsSync(dest)) {
        throw new Error(`Binary ${build.name} was not found at ${dest} after compilation`);
      }
      fs.chmodSync(dest, 0o755);
    } catch (err) {
      console.error(`[build-native] Failed to compile ${build.name}:`, err.message);
      process.exit(1);
    }
  }
  console.log('[build-native] All macOS native binaries built successfully.');
} else if (process.platform === 'win32') {
  console.log('[build-native] Building Windows native binaries...');
  try {
    const bridgeDir = path.join(rootDir, 'src/main/bridge');
    // Try clang, gcc, or cl if available
    let buildCmd = `clang -O2 -I"${bridgeDir}" "${path.join(bridgeDir, 'jameet-remote-producer.c')}" "${path.join(bridgeDir, 'jameet_remote_bridge.c')}" "${path.join(bridgeDir, 'jameet_remote_transport_win32.c')}" "${path.join(bridgeDir, 'jameet_remote_transport_posix.c')}" -lcfgmgr32 -o bin/jameet-remote-producer.exe`;
    try {
      execSync(buildCmd, { cwd: rootDir, stdio: 'inherit' });
    } catch {
      // Fallback to gcc
      buildCmd = `gcc -O2 -I"${bridgeDir}" "${path.join(bridgeDir, 'jameet-remote-producer.c')}" "${path.join(bridgeDir, 'jameet_remote_bridge.c')}" "${path.join(bridgeDir, 'jameet_remote_transport_win32.c')}" "${path.join(bridgeDir, 'jameet_remote_transport_posix.c')}" -lcfgmgr32 -o bin/jameet-remote-producer.exe`;
      execSync(buildCmd, { cwd: rootDir, stdio: 'inherit' });
    }
    console.log('[build-native] Windows native binaries built successfully.');
  } catch (err) {
    console.warn('[build-native] Note: Windows native build skipped or requires Visual Studio / clang toolchain:', err.message);
  }
} else {
  console.log('Skipping native compilation on ' + process.platform);
}

