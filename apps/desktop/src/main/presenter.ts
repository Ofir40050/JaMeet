import { BrowserWindow, ipcMain, screen } from 'electron';
import { join } from 'node:path';
import { getAppIconPath } from './appIcon';
import { logger } from './logger';
import { isTrustedSender, setupWebContentsSecurity } from './trustBoundary';
import { safeSend } from './windowUtils';

let presenterToolbarWindow: BrowserWindow | null = null;
let presenterVideoWindow: BrowserWindow | null = null;
let savedMainWindowBounds: Electron.Rectangle | null = null;
let isPresenterModeActive = false;

export function isPresenterActive(): boolean {
  return isPresenterModeActive;
}

export function closePresenterWindows(): void {
  if (presenterToolbarWindow && !presenterToolbarWindow.isDestroyed()) {
    presenterToolbarWindow.close();
    presenterToolbarWindow = null;
  }
  if (presenterVideoWindow && !presenterVideoWindow.isDestroyed()) {
    presenterVideoWindow.close();
    presenterVideoWindow = null;
  }
}

export function createOrGetPresenterToolbarWindow(): BrowserWindow {
  if (presenterToolbarWindow && !presenterToolbarWindow.isDestroyed()) {
    return presenterToolbarWindow;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const tbWidth = 660;
  const tbHeight = 340;
  const tbX = Math.round(primaryDisplay.bounds.x + (primaryDisplay.bounds.width - tbWidth) / 2);
  const tbY = primaryDisplay.bounds.y + 10;
  const appIcon = getAppIconPath();

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
    ...(appIcon ? { icon: appIcon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });

  logger.trackWebContents(presenterToolbarWindow.webContents, 'presenterToolbarWindow');
  setupWebContentsSecurity(presenterToolbarWindow.webContents);

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

export function createOrGetPresenterVideoWindow(): BrowserWindow {
  if (presenterVideoWindow && !presenterVideoWindow.isDestroyed()) {
    return presenterVideoWindow;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const vidWidth = 280;
  const vidHeight = 175;
  const vidX = primaryDisplay.bounds.x + primaryDisplay.bounds.width - vidWidth - 20;
  const vidY = primaryDisplay.bounds.y + 70;

  const appIcon = getAppIconPath();
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
    ...(appIcon ? { icon: appIcon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });

  logger.trackWebContents(presenterVideoWindow.webContents, 'presenterVideoWindow');
  setupWebContentsSecurity(presenterVideoWindow.webContents);

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

export function registerPresenterIpc(context: { getMainWindow: () => BrowserWindow | null }): void {
  const { getMainWindow } = context;

  // Presenter Mode IPC
  ipcMain.handle('enter-presenter-mode', async (event, initialState: unknown) => {
    if (!isTrustedSender(event)) return false;
    isPresenterModeActive = true;
    const mainWindow = getMainWindow();
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

  ipcMain.handle('exit-presenter-mode', async (event) => {
    if (!isTrustedSender(event)) return false;
    isPresenterModeActive = false;
    if (presenterToolbarWindow && !presenterToolbarWindow.isDestroyed()) {
      presenterToolbarWindow.hide();
    }
    if (presenterVideoWindow && !presenterVideoWindow.isDestroyed()) {
      presenterVideoWindow.hide();
    }
    const mainWindow = getMainWindow();
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

  ipcMain.handle('show-main-window', async (event) => {
    if (!isTrustedSender(event)) return false;
    const mainWindow = getMainWindow();
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

  ipcMain.handle('update-presenter-state', async (event, state: unknown) => {
    if (!isTrustedSender(event)) return;
    if (presenterToolbarWindow && !presenterToolbarWindow.isDestroyed()) {
      safeSend(presenterToolbarWindow, 'presenter-state-update', state);
    }
  });

  ipcMain.handle('send-presenter-action', async (event, action: string, data?: unknown) => {
    if (!isTrustedSender(event)) return;
    if (action === 'toggle-floating-video') {
      if (presenterVideoWindow && !presenterVideoWindow.isDestroyed()) {
        if (presenterVideoWindow.isVisible()) presenterVideoWindow.hide();
        else presenterVideoWindow.show();
      }
    }
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      safeSend(mainWindow, 'presenter-action', action, data);
    }
  });

  // Forward video frame to floating participant window
  ipcMain.on('presenter-video-frame', (event, frame: unknown) => {
    if (!isTrustedSender(event)) return;
    if (presenterVideoWindow && !presenterVideoWindow.isDestroyed()) {
      safeSend(presenterVideoWindow, 'presenter-video-frame', frame);
    }
  });

  // Allow toolbar renderer to toggle click-through for transparent areas
  ipcMain.on('set-presenter-mouse-ignore', (event, ignore: boolean) => {
    if (!isTrustedSender(event)) return;
    if (presenterToolbarWindow && !presenterToolbarWindow.isDestroyed()) {
      presenterToolbarWindow.setIgnoreMouseEvents(ignore, { forward: true });
    }
  });
}
