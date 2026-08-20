import { app, ipcMain, type BrowserWindow } from 'electron';
import { getNativeBinaryPath } from '../binaryUtils';
import { isTrustedSender } from '../trustBoundary';
import { safeSend } from '../windowUtils';

let activeAudioTapProcess: any = null;
let activeHardwareAudioProcess: any = null;
let activeHardwareDeviceId: string | undefined = undefined;

export function isAudioCaptureActive(): boolean {
  return Boolean(activeAudioTapProcess || activeHardwareAudioProcess);
}

export function stopActiveAudioTap(): void {
  if (activeAudioTapProcess) {
    try { activeAudioTapProcess.kill('SIGTERM'); } catch { }
    activeAudioTapProcess = null;
  }
}

export function stopActiveHardwareAudio(): void {
  if (activeHardwareAudioProcess) {
    try { activeHardwareAudioProcess.kill('SIGTERM'); } catch { }
    activeHardwareAudioProcess = null;
    activeHardwareDeviceId = undefined;
  }
}

export function registerAudioCaptureIpc(context: { getMainWindow: () => BrowserWindow | null }): void {
  const { getMainWindow } = context;

  ipcMain.handle('open-system-audio-settings', async (event) => {
    if (!isTrustedSender(event)) return;
    const { exec } = await import('child_process');
    if (process.platform === 'darwin') {
      exec('open "/System/Applications/Utilities/Audio MIDI Setup.app" || open -b com.apple.audio.AudioMIDISetup');
    } else if (process.platform === 'win32') {
      exec('control mmsys.cpl sounds');
    }
  });

  ipcMain.handle('set-system-sample-rate', async (event, sampleRate: number, deviceName?: string) => {
    if (!isTrustedSender(event)) return false;
    if (process.platform === 'darwin' && sampleRate > 0) {
      const { execFile, execSync } = await import('child_process');
      const { join } = await import('path');
      const { existsSync, chmodSync } = await import('fs');
      const binPath = getNativeBinaryPath('set-rate');
      const srcPath = join(__dirname, '../../src/main/set-rate.c');
      if (!existsSync(binPath) && !app.isPackaged && existsSync(srcPath)) {
        try {
          execSync(`mkdir -p "${join(__dirname, '../../bin')}" && clang -O2 -framework CoreAudio "${srcPath}" -o "${binPath}"`);
        } catch (e) {
          console.error('Failed to compile set-rate:', e);
        }
      }
      if (!existsSync(binPath)) {
        console.error(`set-rate binary not found: ${binPath}`);
        return false;
      }
      try { chmodSync(binPath, 0o755); } catch { }
      return new Promise<boolean>((resolve) => {
        execFile(binPath, [String(sampleRate), deviceName ?? ''], (error, stdout) => {
          if (error) {
            console.error('CoreAudio set-rate error:', error);
            resolve(false);
          } else {
            console.log('CoreAudio rate change:', stdout.trim());
            resolve(true);
          }
        });
      });
    }
    return false;
  });

  ipcMain.handle('set-system-input-volume', async (event, volume: number) => {
    if (!isTrustedSender(event)) return false;
    if (process.platform === 'darwin' && typeof volume === 'number') {
      const { execFile, execSync } = await import('child_process');
      const { join } = await import('path');
      const { existsSync, chmodSync } = await import('fs');
      const binPath = getNativeBinaryPath('set-rate');
      const srcPath = join(__dirname, '../../src/main/set-rate.c');
      if (!existsSync(binPath) && !app.isPackaged && existsSync(srcPath)) {
        try {
          execSync(`mkdir -p "${join(__dirname, '../../bin')}" && clang -O2 -framework CoreAudio -framework CoreFoundation "${srcPath}" -o "${binPath}"`);
        } catch (e) {
          console.error('Failed to compile set-rate:', e);
        }
      }
      if (!existsSync(binPath)) {
        console.error(`set-rate binary not found: ${binPath}`);
        return false;
      }
      try { chmodSync(binPath, 0o755); } catch { }
      return new Promise<boolean>((resolve) => {
        execFile(binPath, ['volume', String(volume)], (error) => {
          resolve(!error);
        });
      });
    }
    return false;
  });

  ipcMain.handle('get-hardware-audio-devices', async (event) => {
    if (!isTrustedSender(event)) return [];
    if (process.platform === 'darwin') {
      const { execFile, execSync } = await import('child_process');
      const { join } = await import('path');
      const { existsSync, chmodSync } = await import('fs');
      const binPath = getNativeBinaryPath('set-rate');
      const srcPath = join(__dirname, '../../src/main/set-rate.c');
      if (!existsSync(binPath) && !app.isPackaged && existsSync(srcPath)) {
        try {
          execSync(`mkdir -p "${join(__dirname, '../../bin')}" && clang -O2 -framework CoreAudio -framework CoreFoundation "${srcPath}" -o "${binPath}"`);
        } catch (e) {
          console.error('Failed to compile set-rate:', e);
        }
      }
      if (!existsSync(binPath)) {
        console.error(`set-rate binary not found: ${binPath}`);
        return [];
      }
      try { chmodSync(binPath, 0o755); } catch { }
      return new Promise<unknown[]>((resolve) => {
        execFile(binPath, ['devices'], (error, stdout) => {
          if (error) {
            console.error('CoreAudio list-devices error:', error);
            resolve([]);
          } else {
            try {
              resolve(JSON.parse(stdout.trim()));
            } catch {
              resolve([]);
            }
          }
        });
      });
    }
    return [];
  });

  ipcMain.handle('list-audio-applications', async (event) => {
    if (!isTrustedSender(event)) return [];
    if (process.platform === 'darwin') {
      const { execFile, execSync } = await import('child_process');
      const { join } = await import('path');
      const { existsSync, chmodSync } = await import('fs');
      const binPath = getNativeBinaryPath('jameet-app-audio-tap');
      const srcPath = join(__dirname, '../../src/main/jameet-app-audio-tap.swift');
      if (!existsSync(binPath) && !app.isPackaged && existsSync(srcPath)) {
        try {
          execSync(`mkdir -p "${join(__dirname, '../../bin')}" && swiftc -O "${srcPath}" -o "${binPath}"`);
        } catch (e) {
          console.error('Failed to compile jameet-app-audio-tap:', e);
        }
      }
      if (!existsSync(binPath)) {
        console.error(`jameet-app-audio-tap binary not found: ${binPath}`);
        return [];
      }
      try { chmodSync(binPath, 0o755); } catch { }
      return new Promise<unknown[]>((resolve) => {
        execFile(binPath, ['list'], (error, stdout) => {
          if (error) {
            console.error('App list error:', error);
            resolve([]);
          } else {
            try {
              resolve(JSON.parse(stdout.trim()));
            } catch {
              resolve([]);
            }
          }
        });
      });
    }
    return [];
  });

  ipcMain.handle('start-app-audio-capture', async (event, target: number | string, channelRoute?: string) => {
    if (!isTrustedSender(event)) return false;
    if (process.platform === 'darwin' && target !== undefined && target !== null) {
      const targetStr = String(target).trim();
      if (targetStr.length === 0) return false;
      if (activeAudioTapProcess) {
        try { activeAudioTapProcess.kill('SIGTERM'); } catch { }
        activeAudioTapProcess = null;
      }
      const { spawn, execSync } = await import('child_process');
      const { join } = await import('path');
      const { existsSync, chmodSync } = await import('fs');
      const binPath = getNativeBinaryPath('jameet-app-audio-tap');
      const srcPath = join(__dirname, '../../src/main/jameet-app-audio-tap.swift');
      if (!existsSync(binPath) && !app.isPackaged && existsSync(srcPath)) {
        try {
          execSync(`mkdir -p "${join(__dirname, '../../bin')}" && swiftc -O "${srcPath}" -o "${binPath}"`);
        } catch (e) {
          console.error('Failed to compile jameet-app-audio-tap:', e);
        }
      }
      if (!existsSync(binPath)) {
        console.error(`jameet-app-audio-tap binary not found: ${binPath}`);
        return false;
      }
      try { chmodSync(binPath, 0o755); } catch { }

      const args = ['capture'];
      if (targetStr === 'global' || targetStr === 'system') {
        args.push('global');
      } else if (targetStr.startsWith('device:')) {
        args.push('device');
        args.push(targetStr.slice(7));
        if (channelRoute) args.push(channelRoute);
      } else {
        args.push('app');
        args.push(targetStr);
      }

      try {
        const child = spawn(binPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        activeAudioTapProcess = child;

        child.stdout.on('data', (chunk: Buffer) => {
          const mainWindow = getMainWindow();
          if (mainWindow && !mainWindow.isDestroyed()) {
            safeSend(mainWindow, 'app-audio-chunk', chunk);
          }
        });

        child.stderr.on('data', (data: Buffer) => {
          console.log('[AppAudioTap]', data.toString().trim());
        });

        child.on('close', (code) => {
          console.log('[AppAudioTap] Process exited with code', code);
          if (activeAudioTapProcess === child) activeAudioTapProcess = null;
          const mainWindow = getMainWindow();
          if (mainWindow && !mainWindow.isDestroyed()) {
            safeSend(mainWindow, 'app-audio-stopped');
          }
        });

        child.on('error', (err) => {
          console.error('[AppAudioTap] Error:', err);
          if (activeAudioTapProcess === child) activeAudioTapProcess = null;
          const mainWindow = getMainWindow();
          if (mainWindow && !mainWindow.isDestroyed()) {
            safeSend(mainWindow, 'app-audio-stopped');
          }
        });

        return true;
      } catch (e) {
        console.error('[AppAudioTap] Spawn error:', e);
        return false;
      }
    }
    return false;
  });

  ipcMain.handle('stop-app-audio-capture', async (event) => {
    if (!isTrustedSender(event)) return false;
    if (activeAudioTapProcess) {
      try { activeAudioTapProcess.kill('SIGTERM'); } catch { }
      activeAudioTapProcess = null;
      return true;
    }
    return false;
  });

  ipcMain.handle('start-hardware-audio-capture', async (event, deviceId?: string) => {
    if (!isTrustedSender(event)) return false;
    if (process.platform === 'darwin') {
      const targetArg = deviceId && deviceId.length > 0 ? deviceId : 'default';
      if (activeHardwareAudioProcess && activeHardwareDeviceId === targetArg) {
        return true;
      }
      if (activeHardwareAudioProcess) {
        try { activeHardwareAudioProcess.kill('SIGTERM'); } catch { }
        activeHardwareAudioProcess = null;
      }

      const { spawn, execSync } = await import('child_process');
      const { join } = await import('path');
      const { existsSync, chmodSync } = await import('fs');
      const binPath = getNativeBinaryPath('jameet-hardware-input');
      const srcPath = join(__dirname, '../../src/main/jameet-hardware-input.c');
      if (!existsSync(binPath) && !app.isPackaged && existsSync(srcPath)) {
        try {
          execSync(`mkdir -p "${join(__dirname, '../../bin')}" && clang -O2 -framework CoreAudio -framework AudioToolbox -framework CoreFoundation "${srcPath}" -o "${binPath}"`);
        } catch (e) {
          console.error('Failed to compile jameet-hardware-input:', e);
        }
      }
      if (!existsSync(binPath)) {
        console.error(`jameet-hardware-input binary not found: ${binPath}`);
        return false;
      }
      try { chmodSync(binPath, 0o755); } catch { }

      try {
        const child = spawn(binPath, [targetArg], { stdio: ['ignore', 'pipe', 'pipe'] });
        activeHardwareAudioProcess = child;
        activeHardwareDeviceId = targetArg;

        child.stdout.on('data', (chunk: Buffer) => {
          const mainWindow = getMainWindow();
          if (mainWindow && !mainWindow.isDestroyed()) {
            safeSend(mainWindow, 'hardware-audio-chunk', chunk);
          }
        });

        child.stderr.on('data', (data: Buffer) => {
          console.log('[HardwareAudioCapture]', data.toString().trim());
        });

        child.on('close', (code) => {
          console.log('[HardwareAudioCapture] Process exited with code', code);
          if (activeHardwareAudioProcess === child) {
            activeHardwareAudioProcess = null;
            activeHardwareDeviceId = undefined;
          }
          const mainWindow = getMainWindow();
          if (mainWindow && !mainWindow.isDestroyed()) {
            safeSend(mainWindow, 'hardware-audio-stopped');
          }
        });

        child.on('error', (err) => {
          console.error('[HardwareAudioCapture] Error:', err);
          if (activeHardwareAudioProcess === child) {
            activeHardwareAudioProcess = null;
            activeHardwareDeviceId = undefined;
          }
          const mainWindow = getMainWindow();
          if (mainWindow && !mainWindow.isDestroyed()) {
            safeSend(mainWindow, 'hardware-audio-stopped');
          }
        });

        return true;
      } catch (e) {
        console.error('[HardwareAudioCapture] Spawn error:', e);
        return false;
      }
    }
    return false;
  });

  ipcMain.handle('stop-hardware-audio-capture', async (event) => {
    if (!isTrustedSender(event)) return false;
    if (activeHardwareAudioProcess) {
      try { activeHardwareAudioProcess.kill('SIGTERM'); } catch { }
      activeHardwareAudioProcess = null;
      activeHardwareDeviceId = undefined;
      return true;
    }
    return false;
  });
}
