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
  const bridgeDir = path.join(rootDir, 'src/main/bridge');
  const driverWinDir = path.join(rootDir, 'src/main/driver-windows');

  const winBuilds = [
    {
      name: 'set-rate.exe',
      msvcCmd: `cl /nologo /O2 /EHsc /std:c++17 /Fe:"bin/set-rate.exe" "${path.join(rootDir, 'src/main/set-rate-win.cpp')}" ole32.lib mmdevapi.lib avrt.lib ksuser.lib advapi32.lib psapi.lib`,
      cmd: `clang++ -O2 "${path.join(rootDir, 'src/main/set-rate-win.cpp')}" -lole32 -lmmdevapi -lavrt -lksuser -ladvapi32 -lpsapi -o bin/set-rate.exe`,
      fallbackCmd: `g++ -O2 "${path.join(rootDir, 'src/main/set-rate-win.cpp')}" -lole32 -lmmdevapi -lavrt -lksuser -ladvapi32 -lpsapi -o bin/set-rate.exe`
    },
    {
      name: 'jameet-hardware-input.exe',
      msvcCmd: `cl /nologo /O2 /EHsc /std:c++17 /Fe:"bin/jameet-hardware-input.exe" "${path.join(rootDir, 'src/main/jameet-hardware-input-win.cpp')}" ole32.lib mmdevapi.lib avrt.lib ksuser.lib advapi32.lib psapi.lib`,
      cmd: `clang++ -O2 "${path.join(rootDir, 'src/main/jameet-hardware-input-win.cpp')}" -lole32 -lmmdevapi -lavrt -lksuser -ladvapi32 -lpsapi -o bin/jameet-hardware-input.exe`,
      fallbackCmd: `g++ -O2 "${path.join(rootDir, 'src/main/jameet-hardware-input-win.cpp')}" -lole32 -lmmdevapi -lavrt -lksuser -ladvapi32 -lpsapi -o bin/jameet-hardware-input.exe`
    },
    {
      name: 'jameet-app-audio-tap.exe',
      msvcCmd: `cl /nologo /O2 /EHsc /std:c++17 /Fe:"bin/jameet-app-audio-tap.exe" "${path.join(rootDir, 'src/main/jameet-app-audio-tap-win.cpp')}" ole32.lib mmdevapi.lib avrt.lib ksuser.lib advapi32.lib psapi.lib`,
      cmd: `clang++ -O2 "${path.join(rootDir, 'src/main/jameet-app-audio-tap-win.cpp')}" -lole32 -lmmdevapi -lavrt -lksuser -ladvapi32 -lpsapi -o bin/jameet-app-audio-tap.exe`,
      fallbackCmd: `g++ -O2 "${path.join(rootDir, 'src/main/jameet-app-audio-tap-win.cpp')}" -lole32 -lmmdevapi -lavrt -lksuser -ladvapi32 -lpsapi -o bin/jameet-app-audio-tap.exe`
    },
    {
      name: 'jameet-remote-producer.exe',
      msvcCmd: `cl /nologo /O2 /I"${bridgeDir}" /Fe:"bin/jameet-remote-producer.exe" "${path.join(bridgeDir, 'jameet-remote-producer.c')}" "${path.join(bridgeDir, 'jameet_remote_bridge.c')}" "${path.join(bridgeDir, 'jameet_remote_transport_win32.c')}" cfgmgr32.lib advapi32.lib`,
      cmd: `clang -O2 -I"${bridgeDir}" "${path.join(bridgeDir, 'jameet-remote-producer.c')}" "${path.join(bridgeDir, 'jameet_remote_bridge.c')}" "${path.join(bridgeDir, 'jameet_remote_transport_win32.c')}" -lcfgmgr32 -ladvapi32 -o bin/jameet-remote-producer.exe`,
      fallbackCmd: `gcc -O2 -I"${bridgeDir}" "${path.join(bridgeDir, 'jameet-remote-producer.c')}" "${path.join(bridgeDir, 'jameet_remote_bridge.c')}" "${path.join(bridgeDir, 'jameet_remote_transport_win32.c')}" -lcfgmgr32 -ladvapi32 -o bin/jameet-remote-producer.exe`
    },
    {
      name: 'jameet-device-installer.exe',
      msvcCmd: `cl /nologo /O2 /I"${driverWinDir}" /Fe:"bin/jameet-device-installer.exe" "${path.join(driverWinDir, 'jameet-device-installer.c')}" setupapi.lib newdev.lib cfgmgr32.lib advapi32.lib`,
      cmd: `clang -O2 -I"${driverWinDir}" "${path.join(driverWinDir, 'jameet-device-installer.c')}" -lsetupapi -lnewdev -lcfgmgr32 -ladvapi32 -o bin/jameet-device-installer.exe`,
      fallbackCmd: `gcc -O2 -I"${driverWinDir}" "${path.join(driverWinDir, 'jameet-device-installer.c')}" -lsetupapi -lnewdev -lcfgmgr32 -ladvapi32 -o bin/jameet-device-installer.exe`
    }
  ];

  for (const build of winBuilds) {
    try {
      console.log(`[build-native] Compiling ${build.name}...`);
      let compiled = false;
      if (build.msvcCmd) {
        try {
          execSync(build.msvcCmd, { cwd: rootDir, stdio: 'ignore' });
          compiled = true;
        } catch { }
      }
      if (!compiled) {
        try {
          execSync(build.cmd, { cwd: rootDir, stdio: 'inherit' });
          compiled = true;
        } catch {
          execSync(build.fallbackCmd, { cwd: rootDir, stdio: 'inherit' });
          compiled = true;
        }
      }
      const dest = path.join(binDir, build.name);
      if (!fs.existsSync(dest)) {
        throw new Error(`Binary ${build.name} was not found at ${dest} after compilation`);
      }
    } catch (err) {
      console.error(`[build-native] Error: Failed to compile ${build.name}:`, err.message);
      process.exit(1);
    }
  }

  // 2. Build WDK Driver Project and Stage Package
  const packageDir = path.join(driverWinDir, 'package');
  if (fs.existsSync(packageDir)) {
    for (const f of ['JaMeetRemote.sys', 'JaMeetRemote.cat', 'JaMeetRemote.inf']) {
      const p = path.join(packageDir, f);
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
      }
    }
  } else {
    fs.mkdirSync(packageDir, { recursive: true });
  }

  console.log('[build-native] Building WDK driver JaMeetRemote.sys...');
  try {
    execSync(`msbuild "${path.join(driverWinDir, 'JaMeetRemote.vcxproj')}" /p:Configuration=Release /p:Platform=x64 /v:m`, {
      cwd: driverWinDir,
      stdio: 'inherit'
    });

    const builtSys = path.join(driverWinDir, 'dist/x64/Release/JaMeetRemote.sys');
    const builtCat = path.join(driverWinDir, 'dist/x64/Release/JaMeetRemote.cat');
    const srcInf = path.join(driverWinDir, 'JaMeetRemote.inf');

    const missing = [];
    if (!fs.existsSync(builtSys)) missing.push('JaMeetRemote.sys');
    if (!fs.existsSync(builtCat)) missing.push('JaMeetRemote.cat');
    if (!fs.existsSync(srcInf)) missing.push('JaMeetRemote.inf');

    if (missing.length > 0) {
      throw new Error(`WDK driver build completed but required package artifacts are missing: ${missing.join(', ')}`);
    }

    fs.copyFileSync(builtSys, path.join(packageDir, 'JaMeetRemote.sys'));
    fs.copyFileSync(builtCat, path.join(packageDir, 'JaMeetRemote.cat'));
    fs.copyFileSync(srcInf, path.join(packageDir, 'JaMeetRemote.inf'));
  } catch (err) {
    console.error('[build-native] Error: WDK driver compilation failed:', err.message);
    process.exit(1);
  }

  console.log('[build-native] All Windows native binaries and driver package staged successfully.');
} else {
  console.log('Skipping native compilation on ' + process.platform);
}
