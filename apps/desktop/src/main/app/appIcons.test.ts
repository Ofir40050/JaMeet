import { describe, it, expect } from 'vitest';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('JaMeet Official Application Icon Integration', () => {
  const desktopRoot = join(__dirname, '../../..');

  it('provides all macOS, Windows, Linux, and Electron build icon assets', () => {
    const buildIcns = join(desktopRoot, 'build/icon.icns');
    const buildIco = join(desktopRoot, 'build/icon.ico');
    const buildPng = join(desktopRoot, 'build/icon.png');

    expect(existsSync(buildIcns), 'build/icon.icns must exist').toBe(true);
    expect(statSync(buildIcns).size).toBeGreaterThan(100000);

    expect(existsSync(buildIco), 'build/icon.ico must exist').toBe(true);
    expect(statSync(buildIco).size).toBeGreaterThan(10000);

    expect(existsSync(buildPng), 'build/icon.png must exist').toBe(true);
    expect(statSync(buildPng).size).toBeGreaterThan(50000);
  });

  it('provides multi-resolution Linux png icons', () => {
    const requiredSizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
    for (const size of requiredSizes) {
      const p = join(desktopRoot, `build/icons/${size}x${size}.png`);
      expect(existsSync(p), `build/icons/${size}x${size}.png must exist`).toBe(true);
      expect(statSync(p).size).toBeGreaterThan(100);
    }
  });

  it('provides runtime Electron resource icons', () => {
    const resIcns = join(desktopRoot, 'resources/icon.icns');
    const resIco = join(desktopRoot, 'resources/icon.ico');
    const resPng = join(desktopRoot, 'resources/icon.png');

    expect(existsSync(resIcns), 'resources/icon.icns must exist').toBe(true);
    expect(existsSync(resIco), 'resources/icon.ico must exist').toBe(true);
    expect(existsSync(resPng), 'resources/icon.png must exist').toBe(true);
  });

  it('provides web renderer public favicons and logos', () => {
    const publicDir = join(desktopRoot, 'src/renderer/public');
    const faviconIco = join(publicDir, 'favicon.ico');
    const faviconPng = join(publicDir, 'favicon.png');
    const icon192 = join(publicDir, 'icon-192.png');
    const iconPng = join(publicDir, 'icon.png');
    const logoPng = join(publicDir, 'logo.png');

    expect(existsSync(faviconIco), 'public/favicon.ico must exist').toBe(true);
    expect(existsSync(faviconPng), 'public/favicon.png must exist').toBe(true);
    expect(existsSync(icon192), 'public/icon-192.png must exist').toBe(true);
    expect(existsSync(iconPng), 'public/icon.png must exist').toBe(true);
    expect(existsSync(logoPng), 'public/logo.png must exist').toBe(true);
  });

  it('configures icon in package.json build configurations', () => {
    const pkgPath = join(desktopRoot, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

    expect(pkg.build).toBeDefined();
    expect(pkg.build.icon).toBe('build/icon.png');
    expect(pkg.build.mac.icon).toBe('build/icon.icns');
    expect(pkg.build.win.icon).toBe('build/icon.ico');
    expect(pkg.build.linux.icon).toBe('build/icons');
  });

  it('provides dedicated system tray and macOS menu bar icon assets', () => {
    const trayTemplate = join(desktopRoot, 'build/trayTemplate.png');
    const trayTemplate2x = join(desktopRoot, 'build/trayTemplate@2x.png');
    const trayIco = join(desktopRoot, 'build/tray.ico');

    expect(existsSync(trayTemplate), 'build/trayTemplate.png must exist').toBe(true);
    expect(statSync(trayTemplate).size).toBeGreaterThan(100);

    expect(existsSync(trayTemplate2x), 'build/trayTemplate@2x.png must exist').toBe(true);
    expect(statSync(trayTemplate2x).size).toBeGreaterThan(100);

    expect(existsSync(trayIco), 'build/tray.ico must exist').toBe(true);
    expect(statSync(trayIco).size).toBeGreaterThan(500);
  });
});
