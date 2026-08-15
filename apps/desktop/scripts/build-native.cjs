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
      name: 'musiczoom-hardware-input',
      cmd: 'clang -O2 -framework CoreAudio -framework AudioToolbox -framework CoreFoundation src/main/musiczoom-hardware-input.c -o bin/musiczoom-hardware-input'
    },
    {
      name: 'musiczoom-app-audio-tap',
      cmd: 'swiftc -O src/main/musiczoom-app-audio-tap.swift -o bin/musiczoom-app-audio-tap'
    },
    {
      name: 'musiczoom-screen-capture',
      cmd: 'swiftc -O src/main/musiczoom-screen-capture.swift -o bin/musiczoom-screen-capture'
    }
  ];

  for (const build of builds) {
    try {
      console.log(`[build-native] Compiling ${build.name}...`);
      execSync(build.cmd, { cwd: rootDir, stdio: 'inherit' });
      const dest = path.join(binDir, build.name);
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
} else {
  console.log('Skipping macOS-specific native compilation on ' + process.platform);
}

