import { app } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function getDesktopAppVersion(): string {
  try {
    const v = app.getVersion();
    if (typeof v === 'string' && v.trim() && v.trim() !== 'Unknown' && !v.includes('Electron')) {
      return v.trim();
    }
  } catch {}
  try {
    const pkgPath = join(app.getAppPath(), 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      if (pkg && typeof pkg.version === 'string' && pkg.version.trim()) {
        return pkg.version.trim();
      }
    }
  } catch {}
  try {
    const pkgPath = join(__dirname, '../../package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      if (pkg && typeof pkg.version === 'string' && pkg.version.trim()) {
        return pkg.version.trim();
      }
    }
  } catch {}
  return 'Unknown';
}

export function getDesktopAppPlatform(): string {
  if (process.platform === 'darwin') return 'macOS';
  if (process.platform === 'win32') return 'Windows';
  return 'Unknown';
}
