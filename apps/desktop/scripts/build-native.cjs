const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const binDir = path.join(__dirname, '../bin');
fs.mkdirSync(binDir, { recursive: true });

if (process.platform === 'darwin') {
  try {
    execSync(
      'clang -O2 -framework CoreAudio -framework CoreFoundation src/main/set-rate.c -o bin/set-rate && ' +
      'clang -O2 -framework CoreAudio -framework AudioToolbox -framework CoreFoundation src/main/musiczoom-hardware-input.c -o bin/musiczoom-hardware-input && ' +
      'swiftc -O src/main/musiczoom-app-audio-tap.swift -o bin/musiczoom-app-audio-tap',
      { cwd: path.join(__dirname, '..'), stdio: 'inherit' }
    );
  } catch (err) {
    console.warn('Native macOS build failed or skipped:', err.message);
  }
} else {
  console.log('Skipping macOS-specific native compilation on ' + process.platform);
}
