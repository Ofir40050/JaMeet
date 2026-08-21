import { app } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface ResolveBinaryOptions {
  isPackaged?: boolean;
  resourcesPath?: string;
  appPath?: string;
  baseDir?: string;
  platform?: string;
}

/**
 * Resolves the absolute path to a native helper binary.
 * In packaged Electron apps, binaries reside in process.resourcesPath/bin.
 * In development, binaries reside in the repository bin/ directory.
 */
export function getNativeBinaryPath(name: string, options?: ResolveBinaryOptions): string {
  const platform = options?.platform ?? process.platform;
  const binaryName = platform === 'win32' ? `${name}.exe` : name;
  const isPackaged = options?.isPackaged ?? (typeof app !== 'undefined' && app ? app.isPackaged : false);
  const resourcesPath = options?.resourcesPath ?? (typeof process !== 'undefined' ? process.resourcesPath : undefined);
  const appPath = options?.appPath ?? (typeof app !== 'undefined' && app?.getAppPath ? app.getAppPath() : undefined);
  const baseDir = options?.baseDir ?? __dirname;

  const candidates: string[] = [];

  if (isPackaged) {
    if (resourcesPath) {
      candidates.push(join(resourcesPath, 'bin', binaryName));
      candidates.push(join(resourcesPath, 'app.asar.unpacked', 'bin', binaryName));
    }
    if (appPath) {
      candidates.push(join(appPath, '..', 'bin', binaryName));
      candidates.push(join(appPath, 'bin', binaryName));
    }
  } else {
    candidates.push(join(baseDir, '../../../bin', binaryName));
    candidates.push(join(baseDir, '../../bin', binaryName));
    candidates.push(join(baseDir, '../bin', binaryName));
    if (!options?.baseDir) {
      if (typeof process !== 'undefined' && process.cwd) {
        candidates.push(join(process.cwd(), 'bin', binaryName));
        candidates.push(join(process.cwd(), 'apps/desktop/bin', binaryName));
      }
      if (appPath) {
        candidates.push(join(appPath, 'bin', binaryName));
      }
    }
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  // Fallback defaults
  if (isPackaged && resourcesPath) {
    return join(resourcesPath, 'bin', binaryName);
  }
  return join(baseDir, '../../../bin', binaryName);
}
