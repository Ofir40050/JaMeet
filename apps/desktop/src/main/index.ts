import { app, BrowserWindow, clipboard, ipcMain, net, protocol, session, Notification, dialog } from 'electron';
import { existsSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { pathToFileURL } from 'node:url';
import { logger } from './app/logger';
import { isTrustedOrigin, isTrustedSender, setupWebContentsSecurity } from './security/trustBoundary';
import { safeSend } from './app/windowUtils';
import { getAppIconPath, createTray } from './app/appIcon';
import { findDeepLink, deliverDeepLink, registerDeepLinkHandler } from './deepLink/deepLink';
import { getDesktopAppVersion, getDesktopAppPlatform } from './app/appInfo';
import { isPresenterActive, closePresenterWindows, registerPresenterIpc } from './native/presenter';
import { isNativeScreenCaptureActive, stopActiveNativeScreenCapture, registerScreenCaptureIpc } from './native/nativeMedia/screenCapture';
import { isAudioCaptureActive, stopActiveAudioTap, stopActiveHardwareAudio, registerAudioCaptureIpc } from './native/nativeMedia/audioCapture';
import { isRemoteVoiceActive, stopRemoteVoiceProducer, registerRemoteVoiceIpc } from './native/nativeMedia/remoteVoice';
import { registerAuthSessionIpc } from './auth/authSessionStorage';
import { setupDisplayMediaRequestHandler, registerDisplayMediaIpc } from './native/displayMedia';

protocol.registerSchemesAsPrivileged([
  { scheme: 'jameet-app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
  { scheme: 'musiczoom-app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);

let isAppQuitting = false;
let isRendererMediaActive = false;
let mainWindow: BrowserWindow | null = null;
let pendingDeepLink: string | null = null;

function stopAllNativeProcesses(): void {
  stopActiveAudioTap();
  stopActiveHardwareAudio();
  stopActiveNativeScreenCapture();
  stopRemoteVoiceProducer();
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
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

logger.setupGlobalHandlers();

function createWindow(): void {
  const windowTitle = instanceId ? `JaMeet [Instance ${instanceId}]` : 'JaMeet';
  const appIcon = getAppIconPath();
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 860,
    minHeight: 620,
    backgroundColor: '#111315',
    title: windowTitle,
    ...(appIcon ? { icon: appIcon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });

  logger.trackWebContents(mainWindow.webContents, 'mainWindow');
  setupWebContentsSecurity(mainWindow.webContents);

  // Content protection disabled to allow normal screenshots and screen recordings
  try {
    mainWindow.setContentProtection(false);
  } catch (e) {
    console.warn('Could not set content protection on main window:', e);
  }

  mainWindow.webContents.on('did-start-loading', stopAllNativeProcesses);
  mainWindow.webContents.on('render-process-gone', stopAllNativeProcesses);

  if (process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void mainWindow.loadURL('jameet-app://bundle/index.html');

  mainWindow.on('close', (event) => {
    if (isAppQuitting) {
      return;
    }
    event.preventDefault();

    const isMediaActive = Boolean(
      isRendererMediaActive ||
      isNativeScreenCaptureActive() ||
      isAudioCaptureActive() ||
      isRemoteVoiceActive() ||
      isPresenterActive()
    );

    if (isMediaActive) {
      const choice = dialog.showMessageBoxSync(mainWindow!, {
        type: 'info',
        title: 'JaMeet',
        message: 'JaMeet will continue running in the background.',
        detail: 'Live media capture or transmission (such as microphone, camera, screen sharing, or session audio) is active and may continue while JaMeet is hidden in the background.\n\nWould you like to keep running in the background or return to JaMeet?',
        buttons: ['Return to JaMeet', 'Keep Running in Background'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      });

      if (choice === 1) {
        mainWindow?.hide();
      }
    } else {
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    stopAllNativeProcesses();
    closePresenterWindows();
  });
}

const lock = app.requestSingleInstanceLock({ instanceId: instanceId || 'default' });
if (!lock) app.quit();
else {
  app.on('second-instance', (_event, argv) => {
    const link = findDeepLink(argv);
    if (link) {
      deliverDeepLink(link, () => mainWindow, (u) => { pendingDeepLink = u; });
    } else {
      showMainWindow();
    }
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    deliverDeepLink(url, () => mainWindow, (u) => { pendingDeepLink = u; });
  });

  void app.whenReady().then(() => {
    logger.info('app_startup', 'JaMeet desktop application ready', {
      instanceId: instanceId || undefined,
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch
    });
    registerDeepLinkHandler();
    pendingDeepLink = findDeepLink(process.argv);

    app.on('web-contents-created', (_event, contents) => {
      setupWebContentsSecurity(contents);
    });

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

    session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) =>
      isTrustedOrigin(requestingOrigin) && ['media', 'speaker-selection'].includes(permission));
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) =>
      callback(isTrustedOrigin(webContents.getURL()) && ['media', 'speaker-selection'].includes(permission)));

    setupDisplayMediaRequestHandler(session.defaultSession);

    ipcMain.on('set-media-active', (event, active: boolean) => {
      if (!isTrustedSender(event)) return;
      isRendererMediaActive = Boolean(active);
    });

    ipcMain.handle('get-app-info', (event) => {
      if (!isTrustedSender(event)) return null;
      return {
        version: getDesktopAppVersion(),
        platform: getDesktopAppPlatform()
      };
    });

    ipcMain.handle('get-initial-deep-link', (event) => {
      if (!isTrustedSender(event)) return null;
      const value = pendingDeepLink;
      pendingDeepLink = null;
      return value;
    });

    ipcMain.handle('copy-text', (event, value: string) => {
      if (!isTrustedSender(event) || typeof value !== 'string') return;
      clipboard.writeText(value);
    });

    registerDisplayMediaIpc();
    registerScreenCaptureIpc({ getMainWindow: () => mainWindow });
    registerPresenterIpc({ getMainWindow: () => mainWindow });
    registerAudioCaptureIpc({ getMainWindow: () => mainWindow });
    registerAuthSessionIpc();

    ipcMain.handle('show-scheduled-notification', async (event, payload: { title: string; body: string; sessionId: string }) => {
      if (!isTrustedSender(event)) return false;
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

    registerRemoteVoiceIpc();

    if (process.platform === 'darwin' && app.dock) {
      try {
        const iconPath = getAppIconPath();
        if (iconPath) {
          app.dock.setIcon(iconPath);
        }
      } catch (err) {
        console.warn('Could not set dock icon:', err);
      }
    }

    createTray(() => showMainWindow());
    createWindow();
    app.on('activate', () => { showMainWindow(); });
  });
}

app.on('before-quit', () => {
  logger.info('app_quitting', 'JaMeet desktop application shutting down');
  isAppQuitting = true;
  stopAllNativeProcesses();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin' && isAppQuitting) app.quit(); });
