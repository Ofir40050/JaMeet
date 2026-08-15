const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const rootDir = path.join(__dirname, '..');
const releaseDir = path.join(rootDir, 'release');
const driverDistDir = path.join(rootDir, 'src', 'main', 'driver-macos', 'dist');
const driverBundlePath = path.join(driverDistDir, 'JaMeetRemote.driver');

if (process.platform !== 'darwin') {
  console.log('[build-macos-pkg] Skipping macOS package creation on ' + process.platform);
  process.exit(0);
}

// 1. Ensure JaMeetRemote.driver is built
if (!fs.existsSync(driverBundlePath)) {
  console.log('[build-macos-pkg] JaMeetRemote.driver not found. Building native driver...');
  const buildDriverScript = path.join(rootDir, 'src', 'main', 'driver-macos', 'build-driver.sh');
  execSync(`"${buildDriverScript}" "${driverDistDir}"`, { cwd: rootDir, stdio: 'inherit' });
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

// 3. Inspect architectures contained in the app and driver
function getArchitectures(binaryPath) {
  try {
    const output = execSync(`lipo -archs "${binaryPath}"`, { encoding: 'utf-8' }).trim();
    return output.split(/\s+/).filter(Boolean);
  } catch {
    return ['arm64'];
  }
}

const appBinary = path.join(appPath, 'Contents', 'MacOS', 'JaMeet');
const driverBinary = path.join(driverBundlePath, 'Contents', 'MacOS', 'JaMeetRemote');

const appArchs = fs.existsSync(appBinary) ? getArchitectures(appBinary) : ['arm64'];
const driverArchs = fs.existsSync(driverBinary) ? getArchitectures(driverBinary) : ['arm64'];

// Common supported architectures (e.g. 'arm64' or 'arm64,x86_64')
const commonArchs = appArchs.filter((a) => driverArchs.includes(a));
const hostArchString = commonArchs.length > 0 ? commonArchs.join(',') : appArchs.join(',');
console.log(`[build-macos-pkg] Detected architectures: App=[${appArchs.join(',')}], Driver=[${driverArchs.join(',')}]. Target=[${hostArchString}]`);

// 4. Developer ID Application Signing Hook (driver bundle)
const appSigningIdentity = process.env.APPLE_SIGNING_IDENTITY || process.env.DEVELOPER_ID_APPLICATION || process.env.CSC_NAME;
if (appSigningIdentity) {
  console.log(`[build-macos-pkg] Signing JaMeetRemote.driver with Developer ID Application (${appSigningIdentity})...`);
  try {
    execSync(`codesign --force --options runtime --timestamp --sign "${appSigningIdentity}" "${driverBundlePath}"`, { stdio: 'inherit' });
  } catch (err) {
    console.warn('[build-macos-pkg] Warning: Developer ID signing failed:', err.message);
  }
} else {
  // Ad-hoc sign for local development
  try {
    execSync(`codesign --force --sign - "${driverBundlePath}"`, { stdio: 'pipe' });
  } catch {
    // Ignore if codesign unavailable
  }
}

// 5. Create temporary work directory for pkgbuild / productbuild
const tmpWorkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-pkg-'));
const appPkgPath = path.join(tmpWorkDir, 'jameet-app.pkg');
const driverPkgPath = path.join(tmpWorkDir, 'jameet-driver.pkg');
const distributionXmlPath = path.join(tmpWorkDir, 'distribution.xml');
const finalPkgPath = path.join(releaseDir, 'JaMeet-Installer.pkg');
const unsignedPkgPath = path.join(tmpWorkDir, 'JaMeet-Unsigned.pkg');

fs.mkdirSync(releaseDir, { recursive: true });

try {
  // 6. Build Application Component Package
  console.log('[build-macos-pkg] Building JaMeet application component package...');
  execSync(
    `pkgbuild --component "${appPath}" --install-location "/Applications" --identifier "com.jameet.app.pkg" --version "0.1.0" "${appPkgPath}"`,
    { stdio: 'inherit' }
  );

  // 7. Build Driver Component Package
  console.log('[build-macos-pkg] Building JaMeet Remote AudioServerPlugIn component package...');
  const driverPayloadRoot = path.join(tmpWorkDir, 'driver-root');
  const targetDriverDir = path.join(driverPayloadRoot, 'Library', 'Audio', 'Plug-Ins', 'HAL', 'JaMeetRemote.driver');
  fs.mkdirSync(path.dirname(targetDriverDir), { recursive: true });

  // Copy driver bundle into payload root
  execSync(`cp -R "${driverBundlePath}" "${targetDriverDir}"`);

  // Create postinstall script (strictly sets permissions without invasive process kills)
  const scriptsDir = path.join(tmpWorkDir, 'driver-scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  const postinstallScript = path.join(scriptsDir, 'postinstall');

  const postinstallContent = `#!/bin/bash
set -e

DRIVER_PATH="/Library/Audio/Plug-Ins/HAL/JaMeetRemote.driver"

# Set standard root ownership and permissions for the HAL driver
if [ -d "$DRIVER_PATH" ]; then
    chown -R root:wheel "$DRIVER_PATH" 2>/dev/null || true
    chmod -R 755 "$DRIVER_PATH" 2>/dev/null || true
fi

exit 0
`;
  fs.writeFileSync(postinstallScript, postinstallContent, { mode: 0o755 });

  execSync(
    `pkgbuild --root "${driverPayloadRoot}" --scripts "${scriptsDir}" --identifier "com.jameet.audio.driver.JaMeetRemote.pkg" --version "1.0.0" "${driverPkgPath}"`,
    { stdio: 'inherit' }
  );

  // 8. Generate Distribution XML with exact declared architectures and restart requirement
  const distXmlContent = `<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
    <title>JaMeet &amp; JaMeet Remote Audio Driver</title>
    <options hostArchitectures="${hostArchString}" customize="never" require-scripts="true"/>
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

  // 9. Synthesize Product Package via productbuild
  console.log('[build-macos-pkg] Synthesizing installer package via productbuild...');
  const targetOutputForBuild = (process.env.APPLE_INSTALLER_IDENTITY || process.env.DEVELOPER_ID_INSTALLER) ? unsignedPkgPath : finalPkgPath;
  execSync(
    `productbuild --distribution "${distributionXmlPath}" --package-path "${tmpWorkDir}" "${targetOutputForBuild}"`,
    { stdio: 'inherit' }
  );

  // 10. Developer ID Installer Signing Hook
  const installerSigningIdentity = process.env.APPLE_INSTALLER_IDENTITY || process.env.DEVELOPER_ID_INSTALLER;
  if (installerSigningIdentity && fs.existsSync(unsignedPkgPath)) {
    console.log(`[build-macos-pkg] Signing installer with Developer ID Installer (${installerSigningIdentity})...`);
    try {
      execSync(`productsign --sign "${installerSigningIdentity}" "${unsignedPkgPath}" "${finalPkgPath}"`, { stdio: 'inherit' });
    } catch (err) {
      console.warn('[build-macos-pkg] Warning: productsign failed, copying unsigned package:', err.message);
      fs.copyFileSync(unsignedPkgPath, finalPkgPath);
    }
  }

  // 11. Apple Notarization Hook (Optional for Release Pipelines)
  const appleId = process.env.APPLE_ID;
  const applePassword = process.env.APPLE_ID_PASSWORD || process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const appleTeamId = process.env.APPLE_TEAM_ID;

  if (appleId && applePassword && appleTeamId && fs.existsSync(finalPkgPath)) {
    console.log('[build-macos-pkg] Submitting package for Apple Notarization...');
    try {
      execSync(
        `xcrun notarytool submit "${finalPkgPath}" --apple-id "${appleId}" --password "${applePassword}" --team-id "${appleTeamId}" --wait`,
        { stdio: 'inherit' }
      );
      console.log('[build-macos-pkg] Stapling notarization ticket to package...');
      execSync(`xcrun stapler staple "${finalPkgPath}"`, { stdio: 'inherit' });
    } catch (err) {
      console.warn('[build-macos-pkg] Warning: Notarization/stapling failed:', err.message);
    }
  }

  console.log('[build-macos-pkg] Successfully created installer package: ' + finalPkgPath);
} finally {
  fs.rmSync(tmpWorkDir, { recursive: true, force: true });
}
