import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

describe('JaMeet Remote macOS Installer Packaging', () => {
  it('builds a valid macOS local preview installer package installing JaMeet.app to /Applications and JaMeetRemote.driver to /Library/Audio/Plug-Ins/HAL', () => {
    if (process.platform !== 'darwin') {
      return;
    }

    const desktopDir = join(__dirname, '..', '..', '..');
    const releaseDir = join(desktopDir, 'release');
    const pkgScript = join(desktopDir, 'scripts', 'build-macos-pkg.cjs');

    expect(() => {
      execSync(`node "${pkgScript}" --preview`, { cwd: desktopDir, stdio: 'pipe' });
    }).not.toThrow();

    const previewPkg = join(releaseDir, 'JaMeet-Preview-Unsigned.pkg');
    const officialPkg = join(releaseDir, 'JaMeet-Installer.pkg');
    expect(existsSync(previewPkg)).toBe(true);
    expect(existsSync(officialPkg)).toBe(false);
    expect(existsSync(join(releaseDir, 'JaMeet-0.1.0-mac-arm64.dmg'))).toBe(false);

    // Expand package to verify distribution configuration and component payloads
    const expandDir = join(tmpdir(), `jameet_pkg_expand_${Date.now()}`);
    try {
      execSync(`pkgutil --expand "${previewPkg}" "${expandDir}"`, { stdio: 'pipe' });

      const distFile = join(expandDir, 'Distribution');
      expect(existsSync(distFile)).toBe(true);

      const distContent = readFileSync(distFile, 'utf-8');
      expect(distContent).toContain('com.jameet.app');
      expect(distContent).toContain('com.jameet.audio.driver.JaMeetRemote');
      expect(distContent).toContain('Library/Audio/Plug-Ins/HAL/JaMeetRemote.driver');
      expect(distContent).toContain('auth="Root"');
      expect(distContent).toContain('RequireRestart');

      // Verify architecture is dynamically specified based on actual build (e.g. arm64 or x86_64, never generic Intel on arm64 build)
      expect(distContent).toMatch(/hostArchitectures="[^"]*"/);

      const appPkg = join(expandDir, 'jameet-app.pkg');
      const driverPkg = join(expandDir, 'jameet-driver.pkg');
      expect(existsSync(appPkg)).toBe(true);
      expect(existsSync(driverPkg)).toBe(true);

      // Verify that JaMeet.app package is explicitly non-relocatable to prevent PackageKit relocation
      const appPackageInfoFile = join(appPkg, 'PackageInfo');
      expect(existsSync(appPackageInfoFile)).toBe(true);
      const appPackageInfo = readFileSync(appPackageInfoFile, 'utf-8');
      expect(appPackageInfo).toContain('relocatable="false"');
      expect(appPackageInfo).toContain('install-location="/Applications"');

      // Verify driver package has clean postinstall script setting permissions without forced process kills
      const driverScriptsDir = join(expandDir, 'jameet-driver.pkg', 'Scripts');
      if (existsSync(driverScriptsDir)) {
        const postinstall = join(driverScriptsDir, 'postinstall');
        expect(existsSync(postinstall)).toBe(true);
        const scriptContent = readFileSync(postinstall, 'utf-8');
        expect(scriptContent).toContain('/Library/Audio/Plug-Ins/HAL/JaMeetRemote.driver');
        expect(scriptContent).toContain('root:wheel');
        expect(scriptContent).not.toContain('coreaudiod');
      }

      // Verify JaMeet.app bundle in release does not redundantly package JaMeetRemote.driver in Resources/bin
      const candidateAppPaths = [
        join(releaseDir, 'mac-arm64', 'JaMeet.app', 'Contents', 'Resources', 'bin', 'JaMeetRemote.driver'),
        join(releaseDir, 'mac', 'JaMeet.app', 'Contents', 'Resources', 'bin', 'JaMeetRemote.driver')
      ];
      for (const p of candidateAppPaths) {
        expect(existsSync(p)).toBe(false);
      }
    } finally {
      rmSync(expandDir, { recursive: true, force: true });
    }
  }, 30000);

  it('ensures preview packaging never deletes or modifies an existing JaMeet-Installer.pkg', () => {
    if (process.platform !== 'darwin') {
      return;
    }

    const desktopDir = join(__dirname, '..', '..', '..');
    const releaseDir = join(desktopDir, 'release');
    const pkgScript = join(desktopDir, 'scripts', 'build-macos-pkg.cjs');

    const officialPkg = join(releaseDir, 'JaMeet-Installer.pkg');
    const mockContent = 'OFFICIAL_RELEASE_PACKAGE_MOCK_DATA';
    writeFileSync(officialPkg, mockContent, 'utf-8');

    try {
      execSync(`node "${pkgScript}" --preview`, { cwd: desktopDir, stdio: 'pipe' });

      // Verify that official package is preserved and unmodified
      expect(existsSync(officialPkg)).toBe(true);
      expect(readFileSync(officialPkg, 'utf-8')).toBe(mockContent);
    } finally {
      if (existsSync(officialPkg)) {
        rmSync(officialPkg, { force: true });
      }
    }
  }, 30000);

  it('strictly rejects official release packaging when Apple Developer credentials are missing', () => {
    if (process.platform !== 'darwin') {
      return;
    }

    const desktopDir = join(__dirname, '..', '..', '..');
    const pkgScript = join(desktopDir, 'scripts', 'build-macos-pkg.cjs');

    let failed = false;
    let output = '';
    try {
      // Execute in isolated clean env without Apple signing identities
      execSync(`node "${pkgScript}"`, {
        cwd: desktopDir,
        stdio: 'pipe',
        env: {
          ...process.env,
          APPLE_SIGNING_IDENTITY: '',
          DEVELOPER_ID_APPLICATION: '',
          CSC_NAME: '',
          APPLE_INSTALLER_IDENTITY: '',
          DEVELOPER_ID_INSTALLER: '',
          APPLE_ID: '',
          APPLE_APP_SPECIFIC_PASSWORD: '',
          APPLE_ID_PASSWORD: '',
          APPLE_TEAM_ID: '',
          JAMEET_BUILD_PREVIEW: ''
        }
      });
    } catch (err: any) {
      failed = true;
      output = `${err.stdout || ''} ${err.stderr || ''}`;
    }

    expect(failed).toBe(true);
    expect(output).toContain('Official macOS release packaging requires complete Apple Developer credentials');
  });
});
