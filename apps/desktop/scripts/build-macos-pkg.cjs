const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const rootDir = path.join(__dirname, '..');
const releaseDir = path.join(rootDir, 'release');
const binDir = path.join(rootDir, 'bin');
const driverBundlePath = path.join(binDir, 'JaMeetRemote.driver');

if (process.platform !== 'darwin') {
  console.log('[build-macos-pkg] Skipping macOS package creation on ' + process.platform);
  process.exit(0);
}

// 1. Ensure JaMeetRemote.driver is built
if (!fs.existsSync(driverBundlePath)) {
  console.log('[build-macos-pkg] JaMeetRemote.driver not found. Building native binaries...');
  execSync('node scripts/build-native.cjs', { cwd: rootDir, stdio: 'inherit' });
}

if (!fs.existsSync(driverBundlePath)) {
  console.error('[build-macos-pkg] Error: Failed to find JaMeetRemote.driver at ' + driverBundlePath);
  process.exit(1);
}

// 2. Locate or package JaMeet.app
let appPath = null;
const candidatePaths = [
  path.join(releaseDir, 'mac-arm64', 'JaMeet.app'),
  path.join(releaseDir, 'mac', 'JaMeet.app'),
  path.join(releaseDir, 'JaMeet.app')
];

for (const p of candidatePaths) {
  if (fs.existsSync(p)) {
    appPath = p;
    break;
  }
}

if (!appPath) {
  console.log('[build-macos-pkg] Packaging JaMeet.app directory bundle via electron-builder...');
  try {
    execSync('npx electron-builder --mac dir --publish never', { cwd: rootDir, stdio: 'inherit' });
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        appPath = p;
        break;
      }
    }
  } catch (err) {
    console.error('[build-macos-pkg] electron-builder error:', err.message);
  }
}

if (!appPath || !fs.existsSync(appPath)) {
  console.error('[build-macos-pkg] Error: Could not locate built JaMeet.app');
  process.exit(1);
}

console.log('[build-macos-pkg] Found JaMeet.app at: ' + appPath);

// 3. Create temporary work directory for pkgbuild / productbuild
const tmpWorkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-pkg-'));
const appPkgPath = path.join(tmpWorkDir, 'jameet-app.pkg');
const driverPkgPath = path.join(tmpWorkDir, 'jameet-driver.pkg');
const distributionXmlPath = path.join(tmpWorkDir, 'distribution.xml');
const finalPkgPath = path.join(releaseDir, 'JaMeet-Installer.pkg');

fs.mkdirSync(releaseDir, { recursive: true });

try {
  // 4. Build Application Component Package
  console.log('[build-macos-pkg] Building JaMeet application component package...');
  execSync(
    `pkgbuild --component "${appPath}" --install-location "/Applications" --identifier "com.jameet.app.pkg" --version "0.1.0" "${appPkgPath}"`,
    { stdio: 'inherit' }
  );

  // 5. Build Driver Component Package
  console.log('[build-macos-pkg] Building JaMeet Remote AudioServerPlugIn component package...');
  const driverPayloadRoot = path.join(tmpWorkDir, 'driver-root');
  const targetDriverDir = path.join(driverPayloadRoot, 'Library', 'Audio', 'Plug-Ins', 'HAL', 'JaMeetRemote.driver');
  fs.mkdirSync(path.dirname(targetDriverDir), { recursive: true });

  // Copy driver bundle into payload root
  execSync(`cp -R "${driverBundlePath}" "${targetDriverDir}"`);

  // Create postinstall script
  const scriptsDir = path.join(tmpWorkDir, 'driver-scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  const postinstallScript = path.join(scriptsDir, 'postinstall');

  const postinstallContent = `#!/bin/bash
set -e

DRIVER_PATH="/Library/Audio/Plug-Ins/HAL/JaMeetRemote.driver"

# Set standard permissions for HAL driver
if [ -d "$DRIVER_PATH" ]; then
    chown -R root:wheel "$DRIVER_PATH" 2>/dev/null || true
    chmod -R 755 "$DRIVER_PATH" 2>/dev/null || true
fi

# Attempt to restart CoreAudio daemon
# Note: macOS AudioServerPlugIn documentation notes a system restart may be required on some macOS versions
if command -v launchctl >/dev/null 2>&1; then
    launchctl kickstart -k system/com.apple.audio.coreaudiod 2>/dev/null || true
fi
killall -9 coreaudiod 2>/dev/null || true

exit 0
`;
  fs.writeFileSync(postinstallScript, postinstallContent, { mode: 0o755 });

  execSync(
    `pkgbuild --root "${driverPayloadRoot}" --scripts "${scriptsDir}" --identifier "com.jameet.audio.driver.JaMeetRemote.pkg" --version "1.0.0" "${driverPkgPath}"`,
    { stdio: 'inherit' }
  );

  // 6. Generate Distribution XML
  const distXmlContent = `<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
    <title>JaMeet &amp; JaMeet Remote Audio Driver</title>
    <options hostArchitectures="arm64,x86_64" customize="never" require-scripts="true"/>
    <domains enable_anywhere="false" enable_currentUserHome="false" enable_localSystem="true"/>
    <choices-outline>
        <line choice="com.jameet.app"/>
        <line choice="com.jameet.audio.driver.JaMeetRemote"/>
    </choices-outline>
    <choice id="com.jameet.app" title="JaMeet Application" description="Installs JaMeet into /Applications">
        <pkg-ref id="com.jameet.app.pkg"/>
    </choice>
    <choice id="com.jameet.audio.driver.JaMeetRemote" title="JaMeet Remote AudioServerPlugIn" description="Installs JaMeet Remote virtual audio input into /Library/Audio/Plug-Ins/HAL">
        <pkg-ref id="com.jameet.audio.driver.JaMeetRemote.pkg"/>
    </choice>
    <pkg-ref id="com.jameet.app.pkg" version="0.1.0" auth="Root">jameet-app.pkg</pkg-ref>
    <pkg-ref id="com.jameet.audio.driver.JaMeetRemote.pkg" version="1.0.0" auth="Root" onConclusion="RequireRestart">jameet-driver.pkg</pkg-ref>
</installer-gui-script>
`;
  fs.writeFileSync(distributionXmlPath, distXmlContent);

  // 7. Build Product Package via productbuild
  console.log('[build-macos-pkg] Synthesizing final installer package via productbuild...');
  execSync(
    `productbuild --distribution "${distributionXmlPath}" --package-path "${tmpWorkDir}" "${finalPkgPath}"`,
    { stdio: 'inherit' }
  );

  console.log('[build-macos-pkg] Successfully created installer: ' + finalPkgPath);
} finally {
  fs.rmSync(tmpWorkDir, { recursive: true, force: true });
}
