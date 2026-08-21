import { desktopCapturer, ipcMain, type Session } from 'electron';
import { isTrustedOrigin, isTrustedSender } from '../security/trustBoundary';

let pendingDisplaySource: { id: string; expiresAt: number } | null = null;

export function setupDisplayMediaRequestHandler(ses: Session): void {
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    if (!isTrustedOrigin(request.securityOrigin) || !request.videoRequested) {
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
}

export function registerDisplayMediaIpc(): void {
  ipcMain.handle('list-display-sources', async (event) => {
    if (!isTrustedSender(event)) return [];
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
    if (!isTrustedSender(event) || typeof id !== 'string' || id.length > 200) {
      event.returnValue = false;
      return;
    }
    pendingDisplaySource = { id, expiresAt: Date.now() + 30_000 };
    event.returnValue = true;
  });
}
