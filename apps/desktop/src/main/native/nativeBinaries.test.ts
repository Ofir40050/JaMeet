import { describe, it, expect } from 'vitest';
import { getNativeBinaryPath } from './binaryUtils';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

describe('Native Binary Path Resolution', () => {
  it('resolves packaged production paths to process.resourcesPath/bin', () => {
    const mockResourcesPath = '/Applications/JaMeet.app/Contents/Resources';
    const resolved = getNativeBinaryPath('jameet-screen-capture', {
      isPackaged: true,
      resourcesPath: mockResourcesPath,
      platform: 'darwin'
    });

    expect(resolved).toBe(join(mockResourcesPath, 'bin', 'jameet-screen-capture'));
  });

  it('resolves packaged Windows production paths with .exe extension', () => {
    const mockResourcesPath = 'C:\\Program Files\\JaMeet\\resources';
    for (const bin of ['set-rate', 'jameet-hardware-input', 'jameet-app-audio-tap', 'jameet-remote-producer', 'jameet-device-installer']) {
      const resolved = getNativeBinaryPath(bin, {
        isPackaged: true,
        resourcesPath: mockResourcesPath,
        platform: 'win32'
      });
      expect(resolved).toBe(join(mockResourcesPath, 'bin', `${bin}.exe`));
    }
  });

  it('resolves development paths relative to workspace bin directory', () => {
    const resolved = getNativeBinaryPath('jameet-screen-capture', {
      isPackaged: false,
      baseDir: __dirname,
      platform: 'darwin'
    });

    expect(resolved).toBe(join(__dirname, '../../../bin', 'jameet-screen-capture'));
  });


  if (process.platform === 'darwin') {
    it('verifies that all native helpers are compiled in apps/desktop/bin on macOS', () => {
      const binDir = join(__dirname, '../../../bin');
      const expectedHelpers = [
        'set-rate',
        'jameet-hardware-input',
        'jameet-app-audio-tap',
        'jameet-screen-capture',
        'jameet-remote-producer'
      ];

      for (const helper of expectedHelpers) {
        const helperPath = join(binDir, helper);
        expect(existsSync(helperPath), `Expected ${helper} to exist at ${helperPath}`).toBe(true);
      }
    });
  }
});
