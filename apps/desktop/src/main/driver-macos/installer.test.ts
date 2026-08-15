import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, readFileSync, rmSync } from 'node:fs';

describe('JaMeet Remote macOS Installer Packaging', () => {
  it('builds a valid macOS installer package installing JaMeet.app to /Applications and JaMeetRemote.driver to /Library/Audio/Plug-Ins/HAL', () => {
    if (process.platform !== 'darwin') {
      return;
    }

    const desktopDir = join(__dirname, '..', '..', '..');
    const releaseDir = join(desktopDir, 'release');
    const pkgScript = join(desktopDir, 'scripts', 'build-macos-pkg.cjs');

    expect(() => {
      execSync(`node "${pkgScript}"`, { cwd: desktopDir, stdio: 'pipe' });
    }).not.toThrow();

    const installerPkg = join(releaseDir, 'JaMeet-Installer.pkg');
    expect(existsSync(installerPkg)).toBe(true);

    // Expand package to verify distribution configuration and component payloads
    const expandDir = join(tmpdir(), `jameet_pkg_expand_${Date.now()}`);
    try {
      execSync(`pkgutil --expand "${installerPkg}" "${expandDir}"`, { stdio: 'pipe' });

      const distFile = join(expandDir, 'Distribution');
      expect(existsSync(distFile)).toBe(true);

      const distContent = readFileSync(distFile, 'utf-8');
      expect(distContent).toContain('com.jameet.app');
      expect(distContent).toContain('com.jameet.audio.driver.JaMeetRemote');
      expect(distContent).toContain('Library/Audio/Plug-Ins/HAL/JaMeetRemote.driver');
      expect(distContent).toContain('auth="Root"');
      expect(distContent).toContain('RequireRestart');

      const appPkg = join(expandDir, 'jameet-app.pkg');
      const driverPkg = join(expandDir, 'jameet-driver.pkg');
      expect(existsSync(appPkg)).toBe(true);
      expect(existsSync(driverPkg)).toBe(true);

      // Verify driver package has postinstall script with coreaudiod kickstart and permissions
      const driverScriptsDir = join(expandDir, 'jameet-driver.pkg', 'Scripts');
      if (existsSync(driverScriptsDir)) {
        const postinstall = join(driverScriptsDir, 'postinstall');
        expect(existsSync(postinstall)).toBe(true);
        const scriptContent = readFileSync(postinstall, 'utf-8');
        expect(scriptContent).toContain('/Library/Audio/Plug-Ins/HAL/JaMeetRemote.driver');
        expect(scriptContent).toContain('coreaudiod');
      }
    } finally {
      rmSync(expandDir, { recursive: true, force: true });
    }
  }, 30000);
});
