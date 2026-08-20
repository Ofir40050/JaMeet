import { app, Menu, Tray, nativeImage, type NativeImage } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function getAppIconPath(): string | undefined {
  if (process.platform === 'win32') {
    const icoPackaged = join(process.resourcesPath, 'icon.ico');
    if (existsSync(icoPackaged)) return icoPackaged;
    const icoDev = join(__dirname, '../../resources/icon.ico');
    if (existsSync(icoDev)) return icoDev;
    const icoBuild = join(__dirname, '../../build/icon.ico');
    if (existsSync(icoBuild)) return icoBuild;
  }
  const pngPackaged = join(process.resourcesPath, 'icon.png');
  if (existsSync(pngPackaged)) return pngPackaged;
  const pngDev = join(__dirname, '../../resources/icon.png');
  if (existsSync(pngDev)) return pngDev;
  const pngBuild = join(__dirname, '../../build/icon.png');
  if (existsSync(pngBuild)) return pngBuild;
  return undefined;
}

export function getTrayIcon(): NativeImage | string | undefined {
  if (process.platform === 'darwin') {
    const templatePackaged = join(process.resourcesPath, 'trayTemplate.png');
    const templateDev = join(__dirname, '../../resources/trayTemplate.png');
    const templateBuild = join(__dirname, '../../build/trayTemplate.png');
    const candidate = existsSync(templatePackaged) ? templatePackaged : existsSync(templateDev) ? templateDev : existsSync(templateBuild) ? templateBuild : undefined;
    if (candidate) {
      const nImg = nativeImage.createFromPath(candidate);
      nImg.setTemplateImage(true);
      return nImg;
    }
  } else if (process.platform === 'win32') {
    const icoPackaged = join(process.resourcesPath, 'tray.ico');
    if (existsSync(icoPackaged)) return icoPackaged;
    const icoDev = join(__dirname, '../../resources/tray.ico');
    if (existsSync(icoDev)) return icoDev;
    const icoBuild = join(__dirname, '../../build/tray.ico');
    if (existsSync(icoBuild)) return icoBuild;
  } else {
    const pngPackaged = join(process.resourcesPath, 'icon.png');
    if (existsSync(pngPackaged)) return pngPackaged;
    const pngDev = join(__dirname, '../../resources/icon.png');
    if (existsSync(pngDev)) return pngDev;
    const pngBuild = join(__dirname, '../../build/icon.png');
    if (existsSync(pngBuild)) return pngBuild;
  }
  return undefined;
}

let appTray: Tray | null = null;

export function createTray(showMainWindow: () => void): Tray | null {
  if (appTray && !appTray.isDestroyed()) return appTray;
  try {
    const trayIcon = getTrayIcon();
    if (!trayIcon) return null;
    appTray = new Tray(trayIcon);
    appTray.setToolTip('JaMeet');

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Open JaMeet',
        click: () => {
          showMainWindow();
        }
      },
      {
        label: 'Quit JaMeet',
        click: () => {
          app.quit();
        }
      }
    ]);

    appTray.setContextMenu(contextMenu);

    appTray.on('click', () => {
      showMainWindow();
    });
    appTray.on('double-click', () => {
      showMainWindow();
    });
    return appTray;
  } catch (err) {
    console.warn('Could not create system tray:', err);
    return null;
  }
}
