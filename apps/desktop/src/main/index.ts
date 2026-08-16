import { app, BrowserWindow, clipboard, desktopCapturer, ipcMain, net, protocol, screen, session, safeStorage, Notification } from 'electron';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getNativeBinaryPath } from './binaryUtils';

protocol.registerSchemesAsPrivileged([
  { scheme: 'jameet-app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'musiczoom-app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);

let mainWindow: BrowserWindow | null = null;
let presenterToolbarWindow: BrowserWindow | null = null;
let presenterVideoWindow: BrowserWindow | null = null;
let savedMainWindowBounds: Electron.Rectangle | null = null;
let isPresenterModeActive = false;
let activeNativeScreenCaptureProcess: any = null;
let activeNativeScreenCaptureSessionId = 0;
let activeAudioTapProcess: any = null;
let activeHardwareAudioProcess: any = null;
let activeHardwareDeviceId: string | undefined = undefined;
let pendingDeepLink: string | null = null;
let pendingDisplaySource: { id: string; expiresAt: number } | null = null;

function stopActiveNativeScreenCapture(): void {
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

function safeSend(win: BrowserWindow | null, channel: string, ...args: unknown[]): boolean {
  if (!win || win.isDestroyed()) return false;
  const wc = win.webContents;
  if (!wc || wc.isDestroyed() || wc.isCrashed() || wc.isLoadingMainFrame()) return false;
  try {
    const frame = wc.mainFrame;
    if (!frame) return false;
    wc.send(channel, ...args);
    return true;
  } catch {
    return false;
  }
}

function findDeepLink(args: string[]): string | null {
  return args.find((arg) => /^(jameet|musiczoom):\/\/join\/[a-z0-9]+/i.test(arg)) ?? null;
}

function deliverDeepLink(url: string): void {
  pendingDeepLink = url;
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    safeSend(mainWindow, 'deep-link', url);
  }
}

function registerDeepLinkHandler(): void {
  if (process.defaultApp && process.argv[1]) {
    app.setAsDefaultProtocolClient('jameet', process.execPath, [resolve(process.argv[1])]);
    app.setAsDefaultProtocolClient('musiczoom', process.execPath, [resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient('jameet');
    app.setAsDefaultProtocolClient('musiczoom');
  }
}

const rawInstanceArg = process.argv.find((arg) => arg.startsWith('--instance=') || arg.startsWith('--profile='));
const instanceId = process.env.JAMEET_INSTANCE || process.env.MUSICZOOM_INSTANCE || process.env.JAMEET_PROFILE || process.env.MUSICZOOM_PROFILE || (rawInstanceArg ? rawInstanceArg.split('=')[1] : '') || '';

if (instanceId) {
  try {
    const customUserData = join(app.getPath('appData'), `JaMeet-Instance-${instanceId}`);
    app.setPath('userData', customUserData);
  } catch (err) {
    console.warn('Could not set custom userData path:', err);
  }
}

function createWindow(): void {
  const windowTitle = instanceId ? `JaMeet [Instance ${instanceId}]` : 'JaMeet';
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 860,
    minHeight: 620,
    backgroundColor: '#111315',
    title: windowTitle,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });

  // Content protection disabled to allow normal screenshots and screen recordings
  try {
    mainWindow.setContentProtection(false);
  } catch (e) {
    console.warn('Could not set content protection on main window:', e);
  }

  mainWindow.webContents.on('did-start-loading', () => {
    if (activeAudioTapProcess) {
      try { activeAudioTapProcess.kill('SIGTERM'); } catch { }
      activeAudioTapProcess = null;
    }
    if (activeHardwareAudioProcess) {
      try { activeHardwareAudioProcess.kill('SIGTERM'); } catch { }
      activeHardwareAudioProcess = null;
    }
    stopActiveNativeScreenCapture();
  });

  mainWindow.webContents.on('render-process-gone', () => {
    if (activeAudioTapProcess) {
      try { activeAudioTapProcess.kill('SIGTERM'); } catch { }
      activeAudioTapProcess = null;
    }
    if (activeHardwareAudioProcess) {
      try { activeHardwareAudioProcess.kill('SIGTERM'); } catch { }
      activeHardwareAudioProcess = null;
    }
    stopActiveNativeScreenCapture();
  });

  if (process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void mainWindow.loadURL('jameet-app://bundle/index.html');

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (activeAudioTapProcess) {
      try { activeAudioTapProcess.kill('SIGTERM'); } catch { }
      activeAudioTapProcess = null;
    }
    if (activeHardwareAudioProcess) {
      try { activeHardwareAudioProcess.kill('SIGTERM'); } catch { }
      activeHardwareAudioProcess = null;
    }
    stopActiveNativeScreenCapture();
    if (presenterToolbarWindow && !presenterToolbarWindow.isDestroyed()) {
      presenterToolbarWindow.close();
      presenterToolbarWindow = null;
    }
    if (presenterVideoWindow && !presenterVideoWindow.isDestroyed()) {
      presenterVideoWindow.close();
      presenterVideoWindow = null;
    }
  });
}

function createOrGetPresenterToolbarWindow(): BrowserWindow {
  if (presenterToolbarWindow && !presenterToolbarWindow.isDestroyed()) {
    return presenterToolbarWindow;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const tbWidth = 660;
  const tbHeight = 340;
  const tbX = Math.round(primaryDisplay.bounds.x + (primaryDisplay.bounds.width - tbWidth) / 2);
  const tbY = primaryDisplay.bounds.y + 10;

  presenterToolbarWindow = new BrowserWindow({
    width: tbWidth,
    height: tbHeight,
    x: tbX,
    y: tbY,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });

  try {
    presenterToolbarWindow.setContentProtection(false);
    presenterToolbarWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    presenterToolbarWindow.setAlwaysOnTop(true, 'screen-saver');
    // Transparent areas pass mouse events through to desktop/DAW.
    // The toolbar HTML disables this only when the cursor is over the pill.
    presenterToolbarWindow.setIgnoreMouseEvents(true, { forward: true });
  } catch (e) {
    console.warn('Could not configure presenter toolbar flags:', e);
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL);
    url.pathname = '/presenter-toolbar.html';
    void presenterToolbarWindow.loadURL(url.toString());
  } else {
    void presenterToolbarWindow.loadURL('jameet-app://bundle/presenter-toolbar.html');
  }

  presenterToolbarWindow.on('closed', () => {
    presenterToolbarWindow = null;
  });

  return presenterToolbarWindow;
}

function createOrGetPresenterVideoWindow(): BrowserWindow {
  if (presenterVideoWindow && !presenterVideoWindow.isDestroyed()) {
    return presenterVideoWindow;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const vidWidth = 280;
  const vidHeight = 175;
  const vidX = primaryDisplay.bounds.x + primaryDisplay.bounds.width - vidWidth - 20;
  const vidY = primaryDisplay.bounds.y + 70;

  presenterVideoWindow = new BrowserWindow({
    width: vidWidth,
    height: vidHeight,
    x: vidX,
    y: vidY,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    minWidth: 180,
    minHeight: 110,
    maxWidth: 640,
    maxHeight: 400,
    hasShadow: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });

  try {
    presenterVideoWindow.setContentProtection(false);
    presenterVideoWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    presenterVideoWindow.setAlwaysOnTop(true, 'screen-saver');
  } catch (e) {
    console.warn('Could not configure presenter video window flags:', e);
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL);
    url.pathname = '/presenter-video.html';
    void presenterVideoWindow.loadURL(url.toString());
  } else {
    void presenterVideoWindow.loadURL('jameet-app://bundle/presenter-video.html');
  }

  presenterVideoWindow.on('closed', () => {
    presenterVideoWindow = null;
  });

  return presenterVideoWindow;
}

const lock = app.requestSingleInstanceLock({ instanceId: instanceId || 'default' });
if (!lock) app.quit();
else {
  app.on('second-instance', (_event, argv) => {
    const link = findDeepLink(argv);
    if (link) deliverDeepLink(link);
    else if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
  app.on('open-url', (event, url) => { event.preventDefault(); deliverDeepLink(url); });

  void app.whenReady().then(() => {
    registerDeepLinkHandler();
    pendingDeepLink = findDeepLink(process.argv);

    const rendererRoot = normalize(join(__dirname, '../renderer'));
    const handleBundleProtocol = (request: Request) => {
      const requestUrl = new URL(request.url);
      const relative = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '') || 'index.html';
      const candidate = normalize(join(rendererRoot, relative));
      const target = candidate.startsWith(rendererRoot) && existsSync(candidate) ? candidate : join(rendererRoot, 'index.html');
      return net.fetch(pathToFileURL(target).toString());
    };
    protocol.handle('jameet-app', handleBundleProtocol);
    protocol.handle('musiczoom-app', handleBundleProtocol);

    const allowedOrigin = (url?: string) => !url || url.startsWith('jameet-app://bundle') || url.startsWith('musiczoom-app://bundle') || url.startsWith('http://localhost:') || url.startsWith('http://127.0.0.1:');
    session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) =>
      allowedOrigin(requestingOrigin) && ['media', 'speaker-selection'].includes(permission));
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) =>
      callback(allowedOrigin(webContents.getURL()) && ['media', 'speaker-selection'].includes(permission)));

    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
      if (!allowedOrigin(request.securityOrigin) || !request.videoRequested) {
        callback({});
        return;
      }
      const selection = pendingDisplaySource;
      pendingDisplaySource = null;
      if (!selection || selection.expiresAt < Date.now()) {
        callback({});
        return;
      }
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } });
      const source = sources.find((candidate) => candidate.id === selection.id);
      if (!source) {
        callback({});
        return;
      }
      const response: { video: Electron.DesktopCapturerSource; audio?: 'loopback' } = { video: source };
      if (request.audioRequested && process.platform === 'win32') {
        response.audio = 'loopback';
      }
      callback(response);
    });

    ipcMain.handle('get-initial-deep-link', () => { const value = pendingDeepLink; pendingDeepLink = null; return value; });
    ipcMain.handle('copy-text', (_event, value: string) => clipboard.writeText(value));
    ipcMain.handle('list-display-sources', async (event) => {
      if (!allowedOrigin(event.sender.getURL())) return [];
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: true
      });
      const filtered = sources.filter((source) => {
        if (source.id.startsWith('screen:')) return true;
        const name = (source.name || '').toLowerCase();
        if (name.includes('jameet') || name.includes('musiczoom') || name === 'electron' || name.startsWith('presenter') || name.startsWith('floating')) {
          return false;
        }
        return true;
      });
      return filtered.map((source) => ({ id: source.id, name: source.name, thumbnail: source.thumbnail.toDataURL() }));
    });
    ipcMain.on('select-display-source', (event, id: string) => {
      if (!allowedOrigin(event.sender.getURL()) || typeof id !== 'string' || id.length > 200) {
        event.returnValue = false;
        return;
      }
      pendingDisplaySource = { id, expiresAt: Date.now() + 30_000 };
      event.returnValue = true;
    });

    // Native ScreenCaptureKit Screen Capture (macOS)
    ipcMain.handle('start-native-screen-capture', async (_event, displayId?: number, options?: { fps?: number; width?: number; height?: number }) => {
      if (process.platform !== 'darwin') return false;
      stopActiveNativeScreenCapture();
      const currentSessionId = ++activeNativeScreenCaptureSessionId;

      const { spawn, execSync } = await import('child_process');
      const { join } = await import('path');
      const { existsSync, chmodSync } = await import('fs');
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

      if (!existsSync(binPath)) {
        console.error(`Native ScreenCaptureKit helper binary not found: ${binPath}`);
        return false;
      }
      try { chmodSync(binPath, 0o755); } catch { }

      const args = ['capture-display', '--app-pid', String(process.pid), '--bundle-id', 'com.jameet.app'];
      if (displayId !== undefined && displayId !== null) {
        args.push('--display', String(displayId));
      }
      const fps = options?.fps || 15;
      args.push('--fps', String(fps));
      if (options?.width) args.push('--width', String(options.width));
      if (options?.height) args.push('--height', String(options.height));

      try {
        const child = spawn(binPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        activeNativeScreenCaptureProcess = child;

        let chunks: Buffer[] = [];
        let totalBuffered = 0;

        function readByte(offset: number): number {
          let cur = 0;
          for (let i = 0; i < chunks.length; i++) {
            const c = chunks[i];
            if (offset < cur + c.length) {
              return c[offset - cur];
            }
            cur += c.length;
          }
          return 0;
        }

        function readUInt32(offset: number): number {
          let cur = 0;
          for (let i = 0; i < chunks.length; i++) {
            const c = chunks[i];
            if (offset < cur + c.length) {
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
            cur += c.length;
          }
          return 0;
        }

        function consumeBytes(count: number): Buffer {
          if (count <= 0) return Buffer.alloc(0);
          if (chunks.length === 1 && chunks[0].length === count) {
            const buf = chunks[0];
            chunks = [];
            totalBuffered = 0;
            return buf;
          }
          if (chunks.length === 1 && chunks[0].length > count) {
            const buf = chunks[0].subarray(0, count);
            chunks[0] = chunks[0].subarray(count);
            totalBuffered -= count;
            return buf;
          }
          const result = Buffer.allocUnsafe(count);
          let copied = 0;
          while (copied < count && chunks.length > 0) {
            const head = chunks[0];
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
            if (mainWindow && !mainWindow.isDestroyed()) {
              safeSend(mainWindow, 'native-screen-capture-stopped');
            }
          }
        });

        child.on('error', (err) => {
          console.error('[NativeScreenCapture] Child process error:', err);
          if (currentSessionId === activeNativeScreenCaptureSessionId && activeNativeScreenCaptureProcess === child) {
            activeNativeScreenCaptureProcess = null;
            if (mainWindow && !mainWindow.isDestroyed()) {
              safeSend(mainWindow, 'native-screen-capture-stopped');
            }
          }
        });

        return true;
      } catch (err) {
        console.error('Failed to spawn native screen capture:', err);
        if (currentSessionId === activeNativeScreenCaptureSessionId && activeNativeScreenCaptureProcess === child) {
          activeNativeScreenCaptureProcess = null;
        }
        return false;
      }
    });

    ipcMain.handle('stop-native-screen-capture', async () => {
      stopActiveNativeScreenCapture();
      return true;
    });

    // Presenter Mode IPC
    ipcMain.handle('enter-presenter-mode', async (_event, initialState: unknown) => {
      isPresenterModeActive = true;
      if (mainWindow && !mainWindow.isDestroyed()) {
        savedMainWindowBounds = mainWindow.getBounds();
        mainWindow.hide();
      }

      const tb = createOrGetPresenterToolbarWindow();
      tb.show();
      if (!tb.webContents.isLoading() && !tb.webContents.isDestroyed()) {
        safeSend(tb, 'presenter-state-update', initialState);
      } else {
        tb.webContents.once('did-finish-load', () => {
          safeSend(tb, 'presenter-state-update', initialState);
        });
      }

      const vid = createOrGetPresenterVideoWindow();
      vid.show();
      return true;
    });

    ipcMain.handle('exit-presenter-mode', async () => {
      isPresenterModeActive = false;
      if (presenterToolbarWindow && !presenterToolbarWindow.isDestroyed()) {
        presenterToolbarWindow.hide();
      }
      if (presenterVideoWindow && !presenterVideoWindow.isDestroyed()) {
        presenterVideoWindow.hide();
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        if (mainWindow.isMinimized()) mainWindow.restore();
        if (savedMainWindowBounds) {
          mainWindow.setBounds(savedMainWindowBounds);
        }
        mainWindow.focus();
      }
      return true;
    });

    ipcMain.handle('show-main-window', async () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        if (mainWindow.isMinimized()) mainWindow.restore();
        if (savedMainWindowBounds) {
          mainWindow.setBounds(savedMainWindowBounds);
        }
        mainWindow.focus();
      }
      return true;
    });

    ipcMain.handle('update-presenter-state', async (_event, state: unknown) => {
      if (presenterToolbarWindow && !presenterToolbarWindow.isDestroyed()) {
        safeSend(presenterToolbarWindow, 'presenter-state-update', state);
      }
    });

    ipcMain.handle('send-presenter-action', async (_event, action: string, data?: unknown) => {
      if (action === 'toggle-floating-video') {
        if (presenterVideoWindow && !presenterVideoWindow.isDestroyed()) {
          if (presenterVideoWindow.isVisible()) presenterVideoWindow.hide();
          else presenterVideoWindow.show();
        }
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        safeSend(mainWindow, 'presenter-action', action, data);
      }
    });

    // Forward video frame to floating participant window
    ipcMain.on('presenter-video-frame', (_event, frame: unknown) => {
      if (presenterVideoWindow && !presenterVideoWindow.isDestroyed()) {
        safeSend(presenterVideoWindow, 'presenter-video-frame', frame);
      }
    });

    // Allow toolbar renderer to toggle click-through for transparent areas
    ipcMain.on('set-presenter-mouse-ignore', (_event, ignore: boolean) => {
      if (presenterToolbarWindow && !presenterToolbarWindow.isDestroyed()) {
        presenterToolbarWindow.setIgnoreMouseEvents(ignore, { forward: true });
      }
    });
    ipcMain.handle('open-system-audio-settings', async () => {
      const { exec } = await import('child_process');
      if (process.platform === 'darwin') {
        exec('open "/System/Applications/Utilities/Audio MIDI Setup.app" || open -b com.apple.audio.AudioMIDISetup');
      } else if (process.platform === 'win32') {
        exec('control mmsys.cpl sounds');
      }
    });
    ipcMain.handle('set-system-sample-rate', async (_event, sampleRate: number, deviceName?: string) => {
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
    ipcMain.handle('set-system-input-volume', async (_event, volume: number) => {
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
    ipcMain.handle('get-hardware-audio-devices', async () => {
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

    ipcMain.handle('list-audio-applications', async () => {
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

    ipcMain.handle('start-app-audio-capture', async (_event, target: number | string, channelRoute?: string) => {
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
            if (mainWindow && !mainWindow.isDestroyed()) {
              safeSend(mainWindow, 'app-audio-stopped');
            }
          });

          child.on('error', (err) => {
            console.error('[AppAudioTap] Error:', err);
            if (activeAudioTapProcess === child) activeAudioTapProcess = null;
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

    ipcMain.handle('stop-app-audio-capture', async () => {
      if (activeAudioTapProcess) {
        try { activeAudioTapProcess.kill('SIGTERM'); } catch { }
        activeAudioTapProcess = null;
        return true;
      }
      return false;
    });

    ipcMain.handle('start-hardware-audio-capture', async (_event, deviceId?: string) => {
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

    ipcMain.handle('stop-hardware-audio-capture', async () => {
      if (activeHardwareAudioProcess) {
        try { activeHardwareAudioProcess.kill('SIGTERM'); } catch { }
        activeHardwareAudioProcess = null;
        activeHardwareDeviceId = undefined;
        return true;
      }
      return false;
    });

    const sessionPath = join(app.getPath('userData'), 'auth-session.bin');

    ipcMain.handle('auth:get-session', async () => {
      if (!existsSync(sessionPath)) return null;
      try {
        const raw = readFileSync(sessionPath);
        let jsonStr: string;
        if (safeStorage.isEncryptionAvailable()) {
          jsonStr = safeStorage.decryptString(raw);
        } else {
          jsonStr = Buffer.from(raw).toString('utf-8');
        }
        return JSON.parse(jsonStr);
      } catch (err) {
        console.warn('Failed to load secure auth session:', err);
        return null;
      }
    });

    ipcMain.handle('auth:set-session', async (_event, sessionData: unknown) => {
      try {
        const jsonStr = JSON.stringify(sessionData);
        let dataBuffer: Buffer;
        if (safeStorage.isEncryptionAvailable()) {
          dataBuffer = safeStorage.encryptString(jsonStr);
        } else {
          dataBuffer = Buffer.from(jsonStr, 'utf-8');
        }
        writeFileSync(sessionPath, dataBuffer);
        return true;
      } catch (err) {
        console.error('Failed to save secure auth session:', err);
        return false;
      }
    });

    ipcMain.handle('auth:clear-session', async () => {
      try {
        if (existsSync(sessionPath)) unlinkSync(sessionPath);
        return true;
      } catch (err) {
        console.error('Failed to clear secure auth session:', err);
        return false;
      }
    });

    ipcMain.handle('show-scheduled-notification', async (_event, payload: { title: string; body: string; sessionId: string }) => {
      try {
        if (!Notification.isSupported()) return false;
        const notification = new Notification({
          title: payload.title,
          body: payload.body,
          silent: false
        });
        notification.on('click', () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
            safeSend(mainWindow, 'scheduled-notification-clicked', payload.sessionId);
          }
        });
        notification.show();
        return true;
      } catch (err) {
        console.error('Failed to show scheduled notification:', err);
        return false;
      }
    });

    // =========================================================================
    // JaMeet Remote Bridge Producer Lifecycle & Bounded Flow Control (macOS)
    // =========================================================================
    let remoteVoiceProducerProcess: import('child_process').ChildProcess | null = null;
    let isRemoteVoiceProducerDraining = false;
    let pendingRemoteVoicePcmPacket: Buffer | null = null;

    const JAMEET_PRODUCER_MAGIC = 0x4A4D5250;
    const JAMEET_CMD_WRITE_FRAMES = 1;
    const JAMEET_CMD_STOP = 3;

    function writePcmToRemoteVoiceProducer(
      producer: import('child_process').ChildProcess,
      pcmFloat32: Float32Array,
      isVoiceActive: boolean
    ): void {
      if (!producer || !producer.stdin || producer.stdin.destroyed) return;

      const frameCount = Math.floor(pcmFloat32.length / 2);
      const pcmBytes = pcmFloat32.byteLength;
      const payloadSize = 8 + pcmBytes;
      const packetSize = 12 + payloadSize;

      const packet = Buffer.allocUnsafe(packetSize);
      packet.writeUInt32LE(JAMEET_PRODUCER_MAGIC, 0);
      packet.writeUInt32LE(JAMEET_CMD_WRITE_FRAMES, 4);
      packet.writeUInt32LE(payloadSize, 8);
      packet.writeUInt32LE(frameCount, 12);
      packet.writeUInt32LE(isVoiceActive ? 1 : 0, 16);
      Buffer.from(pcmFloat32.buffer, pcmFloat32.byteOffset, pcmFloat32.byteLength).copy(packet, 20);

      if (isRemoteVoiceProducerDraining) {
        // While waiting for drain, hold at most the single newest batch and discard older batches
        pendingRemoteVoicePcmPacket = packet;
        return;
      }

      const ok = producer.stdin.write(packet);
      if (!ok) {
        isRemoteVoiceProducerDraining = true;
        producer.stdin.once('drain', () => {
          isRemoteVoiceProducerDraining = false;
          if (pendingRemoteVoicePcmPacket && remoteVoiceProducerProcess === producer && !producer.stdin.destroyed) {
            const nextPacket = pendingRemoteVoicePcmPacket;
            pendingRemoteVoicePcmPacket = null;
            const writeOk = producer.stdin.write(nextPacket);
            if (!writeOk) {
              isRemoteVoiceProducerDraining = true;
              producer.stdin.once('drain', () => {
                isRemoteVoiceProducerDraining = false;
              });
            }
          }
        });
      }
    }

    function stopRemoteVoiceProducer(): void {
      pendingRemoteVoicePcmPacket = null;
      isRemoteVoiceProducerDraining = false;
      if (remoteVoiceProducerProcess) {
        const proc = remoteVoiceProducerProcess;
        remoteVoiceProducerProcess = null;
        try {
          if (proc.stdin && !proc.stdin.destroyed) {
            const stopPacket = Buffer.allocUnsafe(12);
            stopPacket.writeUInt32LE(JAMEET_PRODUCER_MAGIC, 0);
            stopPacket.writeUInt32LE(JAMEET_CMD_STOP, 4);
            stopPacket.writeUInt32LE(0, 8);
            proc.stdin.write(stopPacket);
            proc.stdin.end();
          }
        } catch {}
        setTimeout(() => {
          try { proc.kill('SIGTERM'); } catch {}
        }, 100);
      }
    }

    ipcMain.handle('start-remote-voice-bridge', async () => {
      if (process.platform !== 'darwin') return false;
      if (remoteVoiceProducerProcess && !remoteVoiceProducerProcess.killed) return true;

      const { spawn, execSync } = await import('child_process');
      const { join } = await import('path');
      const { existsSync, chmodSync } = await import('fs');
      const binPath = getNativeBinaryPath('jameet-remote-producer');
      const srcPath = join(__dirname, '../../src/main/bridge/jameet-remote-producer.c');
      const bridgeDir = join(__dirname, '../../src/main/bridge');

      if (!existsSync(binPath) && !app.isPackaged && existsSync(srcPath)) {
        try {
          execSync(
            `mkdir -p "${join(__dirname, '../../bin')}" && clang -O2 -framework CoreFoundation -I"${bridgeDir}" "${srcPath}" "${join(bridgeDir, 'jameet_remote_bridge.c')}" "${join(bridgeDir, 'jameet_remote_transport_posix.c')}" -o "${binPath}"`
          );
        } catch (e) {
          console.error('Failed to compile jameet-remote-producer:', e);
        }
      }

      if (!existsSync(binPath)) {
        console.error(`jameet-remote-producer binary not found: ${binPath}`);
        return false;
      }
      try { chmodSync(binPath, 0o755); } catch {}

      try {
        const child = spawn(binPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
        remoteVoiceProducerProcess = child;
        isRemoteVoiceProducerDraining = false;
        pendingRemoteVoicePcmPacket = null;

        child.stderr.on('data', (data: Buffer) => {
          console.log('[JaMeetProducer]', data.toString().trim());
        });

        child.on('close', () => {
          if (remoteVoiceProducerProcess === child) {
            remoteVoiceProducerProcess = null;
            pendingRemoteVoicePcmPacket = null;
            isRemoteVoiceProducerDraining = false;
          }
        });

        return true;
      } catch (err) {
        console.error('[JaMeetProducer] Spawn error:', err);
        return false;
      }
    });

    ipcMain.on('send-remote-voice-pcm', (_event, pcmData: Float32Array, isRouteActive: boolean) => {
      if (remoteVoiceProducerProcess) {
        writePcmToRemoteVoiceProducer(remoteVoiceProducerProcess, pcmData, isRouteActive);
      }
    });

    ipcMain.handle('stop-remote-voice-bridge', async () => {
      stopRemoteVoiceProducer();
      return true;
    });

    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
}

app.on('before-quit', () => {
  stopActiveNativeScreenCapture();
  if (process.platform === 'darwin') {
    try {
      const { execSync } = require('child_process');
      execSync('killall jameet-remote-producer 2>/dev/null || true');
    } catch {}
  }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
