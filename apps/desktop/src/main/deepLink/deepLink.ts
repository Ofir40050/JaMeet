import { app, type BrowserWindow } from 'electron';
import { resolve } from 'node:path';
import { safeSend } from '../app/windowUtils';

export function findDeepLink(args: string[]): string | null {
  return args.find((arg) => /^(jameet|musiczoom):\/\/join\/[a-z0-9]+/i.test(arg)) ?? null;
}

export function deliverDeepLink(
  url: string,
  getMainWindow: () => BrowserWindow | null,
  onPending: (url: string) => void
): void {
  onPending(url);
  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    safeSend(mainWindow, 'deep-link', url);
  }
}

export function registerDeepLinkHandler(): void {
  if (process.defaultApp && process.argv[1]) {
    app.setAsDefaultProtocolClient('jameet', process.execPath, [resolve(process.argv[1])]);
    app.setAsDefaultProtocolClient('musiczoom', process.execPath, [resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient('jameet');
    app.setAsDefaultProtocolClient('musiczoom');
  }
}
