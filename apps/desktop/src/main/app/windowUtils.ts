import type { BrowserWindow } from 'electron';

export function safeSend(win: BrowserWindow | null, channel: string, ...args: unknown[]): boolean {
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
