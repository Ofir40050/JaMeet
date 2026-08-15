import { app, BrowserWindow, clipboard, desktopCapturer, ipcMain, net, protocol, screen, session, safeStorage, Notification } from 'electron';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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
let activeAudioTapProcess: any = null;
let activeHardwareAudioProcess: any = null;
let activeHardwareDeviceId: string | undefined = undefined;
let pendingDeepLink: string | null = null;
let pendingDisplaySource: { id: string; expiresAt: number } | null = null;

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

  // Enable window content protection as defense-in-depth safeguard
  try {
    mainWindow.setContentProtection(true);
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
    if (activeNativeScreenCaptureProcess) {
      try { activeNativeScreenCaptureProcess.kill('SIGTERM'); } catch { }
      activeNativeScreenCaptureProcess = null;
    }
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
    if (activeNativeScreenCaptureProcess) {
      try { activeNativeScreenCaptureProcess.kill('SIGTERM'); } catch { }
      activeNativeScreenCaptureProcess = null;
    }
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
    if (activeNativeScreenCaptureProcess) {
      try { activeNativeScreenCaptureProcess.kill('SIGTERM'); } catch { }
      activeNativeScreenCaptureProcess = null;
    }
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
    presenterToolbarWindow.setContentProtection(true);
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
    presenterVideoWindow.setContentProtection(true);
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
      if (activeNativeScreenCaptureProcess) {
        try { activeNativeScreenCaptureProcess.kill('SIGTERM'); } catch { }
        activeNativeScreenCaptureProcess = null;
      }

      const { spawn, execSync } = await import('child_process');
      const { join } = await import('path');
      const { existsSync } = await import('fs');
      const binPath = join(__dirname, '../../bin/musiczoom-screen-capture');
      const srcPath = join(__dirname, '../../src/main/musiczoom-screen-capture.swift');

      if (!existsSync(binPath) && existsSync(srcPath)) {
        try {
          execSync(`mkdir -p "${join(__dirname, '../../bin')}" && swiftc -O "${srcPath}" -o "${binPath}"`);
        } catch (e) {
          console.error('Failed to compile musiczoom-screen-capture:', e);
          return false;
        }
      }

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

        let accum = Buffer.alloc(0);

        child.stdout.on('data', (chunk: Buffer) => {
          accum = Buffer.concat([accum, chunk]);

          while (accum.length >= 24) {
            // Check Magic 'MZFR'
            if (accum[0] !== 0x4D || accum[1] !== 0x5A || accum[2] !== 0x46 || accum[3] !== 0x52) {
              const nextMagicIndex = accum.indexOf(Buffer.from([0x4D, 0x5A, 0x46, 0x52]), 1);
              if (nextMagicIndex !== -1) {
                accum = accum.subarray(nextMagicIndex);
              } else {
                accum = Buffer.alloc(0);
                break;
              }
              continue;
            }

            const width = accum.readUInt32LE(4);
            const height = accum.readUInt32LE(8);
            const bytesPerRow = accum.readUInt32LE(12);
            const payloadLength = accum.readUInt32LE(16);
            const timestamp = accum.readUInt32LE(20);

            if (accum.length < 24 + payloadLength) {
              break;
            }

            const frameData = accum.subarray(24, 24 + payloadLength);
            accum = accum.subarray(24 + payloadLength);

            if (mainWindow && !mainWindow.isDestroyed()) {
              safeSend(mainWindow, 'native-screen-capture-frame', {
                width,
                height,
                bytesPerRow,
                data: frameData,
                timestamp
              });
            }
          }
        });

        child.stderr.on('data', (data: Buffer) => {
          console.log('[NativeScreenCapture]', data.toString().trim());
        });

        child.on('close', () => {
          if (activeNativeScreenCaptureProcess === child) {
            activeNativeScreenCaptureProcess = null;
          }
          if (mainWindow && !mainWindow.isDestroyed()) {
            safeSend(mainWindow, 'native-screen-capture-stopped');
          }
        });

        return true;
      } catch (err) {
        console.error('Failed to spawn native screen capture:', err);
        return false;
      }
    });

    ipcMain.handle('stop-native-screen-capture', async () => {
      if (activeNativeScreenCaptureProcess) {
        try { activeNativeScreenCaptureProcess.kill('SIGTERM'); } catch { }
        activeNativeScreenCaptureProcess = null;
      }
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
        const { existsSync } = await import('fs');
        const binPath = join(__dirname, '../../bin/set-rate');
        const srcPath = join(__dirname, '../../src/main/set-rate.c');
        if (!existsSync(binPath) && existsSync(srcPath)) {
          try {
            execSync(`mkdir -p "${join(__dirname, '../../bin')}" && clang -O2 -framework CoreAudio "${srcPath}" -o "${binPath}"`);
          } catch (e) {
            console.error('Failed to compile set-rate:', e);
          }
        }
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
        const { existsSync } = await import('fs');
        const binPath = join(__dirname, '../../bin/set-rate');
        const srcPath = join(__dirname, '../../src/main/set-rate.c');
        if (!existsSync(binPath) && existsSync(srcPath)) {
          try {
            execSync(`mkdir -p "${join(__dirname, '../../bin')}" && clang -O2 -framework CoreAudio -framework CoreFoundation "${srcPath}" -o "${binPath}"`);
          } catch (e) {
            console.error('Failed to compile set-rate:', e);
          }
        }
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
        const { existsSync } = await import('fs');
        const binPath = join(__dirname, '../../bin/set-rate');
        const srcPath = join(__dirname, '../../src/main/set-rate.c');
        if (!existsSync(binPath) && existsSync(srcPath)) {
          try {
            execSync(`mkdir -p "${join(__dirname, '../../bin')}" && clang -O2 -framework CoreAudio -framework CoreFoundation "${srcPath}" -o "${binPath}"`);
          } catch (e) {
            console.error('Failed to compile set-rate:', e);
          }
        }
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
        const { existsSync } = await import('fs');
        const binPath = join(__dirname, '../../bin/musiczoom-app-audio-tap');
        const srcPath = join(__dirname, '../../src/main/musiczoom-app-audio-tap.swift');
        if (!existsSync(binPath) && existsSync(srcPath)) {
          try {
            execSync(`mkdir -p "${join(__dirname, '../../bin')}" && swiftc -O "${srcPath}" -o "${binPath}"`);
          } catch (e) {
            console.error('Failed to compile musiczoom-app-audio-tap:', e);
          }
        }
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
        const { existsSync } = await import('fs');
        const binPath = join(__dirname, '../../bin/musiczoom-app-audio-tap');
        const srcPath = join(__dirname, '../../src/main/musiczoom-app-audio-tap.swift');
        if (!existsSync(binPath) && existsSync(srcPath)) {
          try {
            execSync(`mkdir -p "${join(__dirname, '../../bin')}" && swiftc -O "${srcPath}" -o "${binPath}"`);
          } catch (e) {
            console.error('Failed to compile musiczoom-app-audio-tap:', e);
          }
        }

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
        const { existsSync } = await import('fs');
        const binPath = join(__dirname, '../../bin/musiczoom-hardware-input');
        const srcPath = join(__dirname, '../../src/main/musiczoom-hardware-input.c');
        if (!existsSync(binPath) && existsSync(srcPath)) {
          try {
            execSync(`mkdir -p "${join(__dirname, '../../bin')}" && clang -O2 -framework CoreAudio -framework AudioToolbox -framework CoreFoundation "${srcPath}" -o "${binPath}"`);
          } catch (e) {
            console.error('Failed to compile musiczoom-hardware-input:', e);
          }
        }

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

    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
