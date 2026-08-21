import { app, ipcMain, type BrowserWindow } from 'electron';
import { getNativeBinaryPath } from '../binaryUtils';
import { isTrustedSender } from '../../security/trustBoundary';
import { safeSend } from '../../app/windowUtils';

let activeNativeScreenCaptureProcess: any = null;
let activeNativeScreenCaptureSessionId = 0;

export function isNativeScreenCaptureActive(): boolean {
  return Boolean(activeNativeScreenCaptureProcess);
}

export function stopActiveNativeScreenCapture(): void {
  activeNativeScreenCaptureSessionId++;
  if (activeNativeScreenCaptureProcess) {
    const proc = activeNativeScreenCaptureProcess;
    activeNativeScreenCaptureProcess = null;
    try {
      proc.stdout?.removeAllListeners();
      proc.stderr?.removeAllListeners();
      proc.removeAllListeners();
      proc.kill('SIGTERM');
    } catch { }
  }
}

export function registerScreenCaptureIpc(context: { getMainWindow: () => BrowserWindow | null }): void {
  const { getMainWindow } = context;

  // Native ScreenCaptureKit Screen Capture (macOS)
  ipcMain.handle('start-native-screen-capture', async (event, displayId?: number, options?: { fps?: number; width?: number; height?: number }) => {
    if (!isTrustedSender(event)) return false;
    if (process.platform !== 'darwin') return false;
    stopActiveNativeScreenCapture();
    const currentSessionId = ++activeNativeScreenCaptureSessionId;

    const { spawn, execSync } = await import('child_process');
    const { join } = await import('path');
    const { existsSync, chmodSync } = await import('fs');
    if (currentSessionId !== activeNativeScreenCaptureSessionId) {
      return false;
    }
    const binPath = getNativeBinaryPath('jameet-screen-capture');
    const srcPath = join(__dirname, '../../src/main/jameet-screen-capture.swift');

    if (!existsSync(binPath) && !app.isPackaged && existsSync(srcPath)) {
      try {
        execSync(`mkdir -p "${join(__dirname, '../../bin')}" && swiftc -O "${srcPath}" -o "${binPath}"`);
      } catch (e) {
        console.error('Failed to compile jameet-screen-capture:', e);
        return false;
      }
    }
    if (currentSessionId !== activeNativeScreenCaptureSessionId) {
      return false;
    }

    if (!existsSync(binPath)) {
      console.error(`Native ScreenCaptureKit helper binary not found: ${binPath}`);
      return false;
    }
    try { chmodSync(binPath, 0o755); } catch { }
    if (currentSessionId !== activeNativeScreenCaptureSessionId) {
      return false;
    }

    const args = ['capture-display', '--app-pid', String(process.pid), '--bundle-id', 'com.jameet.app'];
    if (displayId !== undefined && displayId !== null) {
      args.push('--display', String(displayId));
    }
    const fps = options?.fps || 15;
    args.push('--fps', String(fps));
    if (options?.width) args.push('--width', String(options.width));
    if (options?.height) args.push('--height', String(options.height));

    let child: any = null;
    try {
      if (currentSessionId !== activeNativeScreenCaptureSessionId) {
        return false;
      }
      child = spawn(binPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      if (currentSessionId !== activeNativeScreenCaptureSessionId) {
        try {
          child.stdout?.removeAllListeners();
          child.stderr?.removeAllListeners();
          child.removeAllListeners();
          child.kill('SIGTERM');
        } catch { }
        return false;
      }
      activeNativeScreenCaptureProcess = child;

      let chunks: Buffer[] = [];
      let totalBuffered = 0;

      function readByte(offset: number): number {
        let cur = 0;
        for (let i = 0; i < chunks.length; i++) {
          const c = chunks[i];
          if (c && offset < cur + c.length) {
            return c[offset - cur] ?? 0;
          }
          if (c) cur += c.length;
        }
        return 0;
      }

      function readUInt32(offset: number): number {
        let cur = 0;
        for (let i = 0; i < chunks.length; i++) {
          const c = chunks[i];
          if (c && offset < cur + c.length) {
            const local = offset - cur;
            if (local + 4 <= c.length) {
              return c.readUInt32LE(local);
            }
            const b = Buffer.allocUnsafe(4);
            for (let j = 0; j < 4; j++) {
              b[j] = readByte(offset + j);
            }
            return b.readUInt32LE(0);
          }
          if (c) cur += c.length;
        }
        return 0;
      }

      function consumeBytes(count: number): Buffer {
        if (count <= 0) return Buffer.alloc(0);
        const first = chunks[0];
        if (chunks.length === 1 && first && first.length === count) {
          const buf = first;
          chunks = [];
          totalBuffered = 0;
          return buf;
        }
        if (chunks.length === 1 && first && first.length > count) {
          const buf = first.subarray(0, count);
          chunks[0] = first.subarray(count);
          totalBuffered -= count;
          return buf;
        }
        const result = Buffer.allocUnsafe(count);
        let copied = 0;
        while (copied < count && chunks.length > 0) {
          const head = chunks[0];
          if (!head) break;
          const needed = count - copied;
          if (head.length <= needed) {
            head.copy(result, copied);
            copied += head.length;
            chunks.shift();
          } else {
            head.copy(result, copied, 0, needed);
            chunks[0] = head.subarray(needed);
            copied += needed;
          }
        }
        totalBuffered -= count;
        return result;
      }

      child.stdout.on('data', (chunk: Buffer) => {
        if (currentSessionId !== activeNativeScreenCaptureSessionId || activeNativeScreenCaptureProcess !== child) {
          return;
        }
        chunks.push(chunk);
        totalBuffered += chunk.length;

        let latestFrame: {
          width: number;
          height: number;
          bytesPerRow: number;
          data: Buffer;
          timestamp: number;
        } | null = null;

        while (totalBuffered >= 24) {
          if (currentSessionId !== activeNativeScreenCaptureSessionId || activeNativeScreenCaptureProcess !== child) {
            chunks = [];
            totalBuffered = 0;
            break;
          }

          // Check Magic 'MZFR'
          const m0 = readByte(0);
          const m1 = readByte(1);
          const m2 = readByte(2);
          const m3 = readByte(3);
          if (m0 !== 0x4D || m1 !== 0x5A || m2 !== 0x46 || m3 !== 0x52) {
            let found = -1;
            for (let o = 1; o <= totalBuffered - 4; o++) {
              if (readByte(o) === 0x4D && readByte(o + 1) === 0x5A && readByte(o + 2) === 0x46 && readByte(o + 3) === 0x52) {
                found = o;
                break;
              }
            }
            if (found !== -1) {
              consumeBytes(found);
            } else {
              if (totalBuffered > 3) {
                consumeBytes(totalBuffered - 3);
              }
              break;
            }
            continue;
          }

          const width = readUInt32(4);
          const height = readUInt32(8);
          const bytesPerRow = readUInt32(12);
          const payloadLength = readUInt32(16);
          const timestamp = readUInt32(20);

          const totalFrameSize = 24 + payloadLength;
          if (totalBuffered < totalFrameSize) {
            break;
          }

          const frameRaw = consumeBytes(totalFrameSize);
          const frameData = frameRaw.subarray(24);

          latestFrame = {
            width,
            height,
            bytesPerRow,
            data: frameData,
            timestamp
          };
        }

        const mainWindow = getMainWindow();
        if (latestFrame && mainWindow && !mainWindow.isDestroyed() && currentSessionId === activeNativeScreenCaptureSessionId && activeNativeScreenCaptureProcess === child) {
          safeSend(mainWindow, 'native-screen-capture-frame', latestFrame);
        }
      });

      child.stderr.on('data', (data: Buffer) => {
        console.log('[NativeScreenCapture]', data.toString().trim());
      });

      child.on('close', () => {
        if (currentSessionId === activeNativeScreenCaptureSessionId && activeNativeScreenCaptureProcess === child) {
          activeNativeScreenCaptureProcess = null;
          const mainWindow = getMainWindow();
          if (mainWindow && !mainWindow.isDestroyed()) {
            safeSend(mainWindow, 'native-screen-capture-stopped');
          }
        }
      });

      child.on('error', (err: any) => {
        console.error('[NativeScreenCapture] Child process error:', err);
        if (currentSessionId === activeNativeScreenCaptureSessionId && activeNativeScreenCaptureProcess === child) {
          activeNativeScreenCaptureProcess = null;
          const mainWindow = getMainWindow();
          if (mainWindow && !mainWindow.isDestroyed()) {
            safeSend(mainWindow, 'native-screen-capture-stopped');
          }
        }
      });

      return true;
    } catch (err) {
      console.error('Failed to spawn native screen capture:', err);
      if (currentSessionId === activeNativeScreenCaptureSessionId) {
        if (child) {
          try {
            child.stdout?.removeAllListeners();
            child.stderr?.removeAllListeners();
            child.removeAllListeners();
            child.kill('SIGTERM');
          } catch { }
        }
        if (activeNativeScreenCaptureProcess === child) {
          activeNativeScreenCaptureProcess = null;
        }
      }
      return false;
    }
  });

  ipcMain.handle('stop-native-screen-capture', async (event) => {
    if (!isTrustedSender(event)) return false;
    stopActiveNativeScreenCapture();
    return true;
  });
}
