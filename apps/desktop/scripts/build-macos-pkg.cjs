const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const rootDir = path.join(__dirname, '..');
const releaseDir = path.join(rootDir, 'release');
const driverDistDir = path.join(rootDir, 'src', 'main', 'driver-macos', 'dist');
const driverBundlePath = path.join(driverDistDir, 'JaMeetRemote.driver');

const isPreview = process.argv.includes('--preview') || process.env.JAMEET_BUILD_PREVIEW === '1';

if (process.platform !== 'darwin') {
  console.log('[build-macos-pkg] Skipping macOS package creation on ' + process.platform);
  process.exit(0);
}

// Validate Apple Developer credentials for official releases
const appSigningIdentity = process.env.APPLE_SIGNING_IDENTITY || process.env.DEVELOPER_ID_APPLICATION || process.env.CSC_NAME;
const installerSigningIdentity = process.env.APPLE_INSTALLER_IDENTITY || process.env.DEVELOPER_ID_INSTALLER;
const appleId = process.env.APPLE_ID;
const applePassword = process.env.APPLE_ID_PASSWORD || process.env.APPLE_APP_SPECIFIC_PASSWORD;
const appleTeamId = process.env.APPLE_TEAM_ID;

if (!isPreview) {
  const missing = [];
  if (!appSigningIdentity) {
    missing.push('APPLE_SIGNING_IDENTITY (or DEVELOPER_ID_APPLICATION / CSC_NAME) for application and driver signing');
  }
  if (!installerSigningIdentity) {
    missing.push('APPLE_INSTALLER_IDENTITY (or DEVELOPER_ID_INSTALLER) for installer package signing');
  }
  if (!appleId) {
    missing.push('APPLE_ID for Apple Notarization');
  }
  if (!applePassword) {
    missing.push('APPLE_APP_SPECIFIC_PASSWORD (or APPLE_ID_PASSWORD) for Apple Notarization');
  }
  if (!appleTeamId) {
    missing.push('APPLE_TEAM_ID for Apple Notarization');
  }

  if (missing.length > 0) {
    console.error('\n[build-macos-pkg] ERROR: Official macOS release packaging requires complete Apple Developer credentials.');
    console.error('[build-macos-pkg] Missing required configuration:\n  • ' + missing.join('\n  • '));
    console.error('\n[build-macos-pkg] To build an unsigned package for local preview and testing, run the separate preview command:');
    console.error('  npm run package:mac:preview -w @jameet/desktop');
    console.error('  (or pass --preview flag to build-macos-pkg.cjs)\n');
    process.exit(1);
  }
}

// 1. Ensure JaMeetRemote.driver is freshly compiled
console.log('[build-macos-pkg] Building fresh JaMeetRemote.driver bundle from source...');
const buildDriverScript = path.join(rootDir, 'src', 'main', 'driver-macos', 'build-driver.sh');
execSync(`"${buildDriverScript}" "${driverDistDir}"`, { cwd: rootDir, stdio: 'inherit' });

if (!fs.existsSync(driverBundlePath)) {
  console.error('[build-macos-pkg] Error: Failed to find freshly built JaMeetRemote.driver at ' + driverBundlePath);
  process.exit(1);
}

// 2. Always package a fresh JaMeet.app directory bundle from current source and compiled out/
console.log('[build-macos-pkg] Packaging fresh JaMeet.app directory bundle via electron-builder...');
const candidatePaths = [
  path.join(releaseDir, 'mac-arm64', 'JaMeet.app'),
  path.join(releaseDir, 'mac', 'JaMeet.app'),
  path.join(releaseDir, 'JaMeet.app')
];

// Remove existing directory bundles so stale versions are never reused
for (const p of candidatePaths) {
  if (fs.existsSync(p)) {
    try {
      execSync(`rm -rf "${p}"`);
    } catch {
      // Ignore
    }
  }
}

try {
  execSync('npx electron-builder --mac dir --publish never', { cwd: rootDir, stdio: 'inherit' });
} catch (err) {
  console.error('[build-macos-pkg] electron-builder error:', err.message);
  process.exit(1);
}

let appPath = null;
for (const p of candidatePaths) {
  if (fs.existsSync(p)) {
    appPath = p;
    break;
  }
}

if (!appPath || !fs.existsSync(appPath)) {
  console.error('[build-macos-pkg] Error: Could not locate freshly built JaMeet.app after packaging');
  process.exit(1);
}

console.log('[build-macos-pkg] Fresh JaMeet.app packaged at: ' + appPath);

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

// 4. Driver Bundle Code Signing
if (!isPreview) {
  console.log(`[build-macos-pkg] Signing JaMeetRemote.driver with Developer ID Application (${appSigningIdentity})...`);
  execSync(`codesign --force --options runtime --timestamp --sign "${appSigningIdentity}" "${driverBundlePath}"`, { stdio: 'inherit' });
} else {
  // Ad-hoc sign for local preview on Apple Silicon
  console.log('[build-macos-pkg] Ad-hoc signing JaMeetRemote.driver for local preview...');
  execSync(`codesign --force --sign - "${driverBundlePath}"`, { stdio: 'inherit' });
}

// 5. Create temporary work directory for pkgbuild / productbuild
const tmpWorkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-pkg-'));
const appPkgPath = path.join(tmpWorkDir, 'jameet-app.pkg');
const driverPkgPath = path.join(tmpWorkDir, 'jameet-driver.pkg');
const distributionXmlPath = path.join(tmpWorkDir, 'distribution.xml');

const finalPkgName = isPreview ? 'JaMeet-Preview-Unsigned.pkg' : 'JaMeet-Installer.pkg';
const finalPkgPath = path.join(releaseDir, finalPkgName);
const unsignedPkgPath = path.join(tmpWorkDir, 'JaMeet-Unsigned.pkg');

fs.mkdirSync(releaseDir, { recursive: true });

try {
  // 6. Build Application Component Package (Non-Relocatable)
  console.log('[build-macos-pkg] Building non-relocatable JaMeet application component package...');
  const appRootDir = path.dirname(appPath);
  const appComponentPlistPath = path.join(tmpWorkDir, 'app-component.plist');

  // Analyze bundle components and disable relocatability so PackageKit never redirects /Applications/JaMeet.app
  execSync(`pkgbuild --analyze --root "${appRootDir}" "${appComponentPlistPath}"`, { stdio: 'inherit' });

  try {
    execSync(`plutil -replace 0.BundleIsRelocatable -bool NO "${appComponentPlistPath}"`, { stdio: 'inherit' });
  } catch {
    // Fallback: update plist content directly in Node.js if plutil keypath differs
    let plistData = fs.readFileSync(appComponentPlistPath, 'utf-8');
    plistData = plistData.replace(
      /<key>BundleIsRelocatable<\/key>\s*<true\/>/g,
      '<key>BundleIsRelocatable</key>\n\t\t<false/>'
    );
    fs.writeFileSync(appComponentPlistPath, plistData, 'utf-8');
  }

  // Verify that BundleIsRelocatable is indeed false
  let finalPlistData = fs.readFileSync(appComponentPlistPath, 'utf-8');
  if (finalPlistData.includes('<key>BundleIsRelocatable</key>\n\t\t<true/>') || finalPlistData.includes('<key>BundleIsRelocatable</key><true/>')) {
    finalPlistData = finalPlistData.replace(
      /<key>BundleIsRelocatable<\/key>\s*<true\/>/g,
      '<key>BundleIsRelocatable</key>\n\t\t<false/>'
    );
    fs.writeFileSync(appComponentPlistPath, finalPlistData, 'utf-8');
  }

  execSync(
    `pkgbuild --root "${appRootDir}" --component-plist "${appComponentPlistPath}" --install-location "/Applications" --identifier "com.jameet.app.pkg" --version "0.1.0" "${appPkgPath}"`,
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
  const targetOutputForBuild = (!isPreview && installerSigningIdentity) ? unsignedPkgPath : finalPkgPath;
  execSync(
    `productbuild --distribution "${distributionXmlPath}" --package-path "${tmpWorkDir}" "${targetOutputForBuild}"`,
    { stdio: 'inherit' }
  );

  // 10. Developer ID Installer Signing Hook (Official Release)
  if (!isPreview) {
    console.log(`[build-macos-pkg] Signing installer package with Developer ID Installer (${installerSigningIdentity})...`);
    execSync(`productsign --sign "${installerSigningIdentity}" "${unsignedPkgPath}" "${finalPkgPath}"`, { stdio: 'inherit' });

    // 11. Apple Notarization & Stapling (Official Release)
    console.log('[build-macos-pkg] Submitting package for Apple Notarization...');
    execSync(
      `xcrun notarytool submit "${finalPkgPath}" --apple-id "${appleId}" --password "${applePassword}" --team-id "${appleTeamId}" --wait`,
      { stdio: 'inherit' }
    );
    console.log('[build-macos-pkg] Stapling notarization ticket to package...');
    execSync(`xcrun stapler staple "${finalPkgPath}"`, { stdio: 'inherit' });

    console.log('\n[build-macos-pkg] Successfully built and notarized official release package: ' + finalPkgPath);
  } else {
    console.log('\n[build-macos-pkg] NOTICE: Created unsigned local preview package at: ' + finalPkgPath);
    console.log('[build-macos-pkg] This package is for local testing only and cannot be distributed as an official release.\n');
  }
} finally {
  fs.rmSync(tmpWorkDir, { recursive: true, force: true });
}
