import { app, ipcMain, safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { isTrustedSender } from './trustBoundary';

export function registerAuthSessionIpc(): void {
  const sessionPath = join(app.getPath('userData'), 'auth-session.bin');

  ipcMain.handle('auth:get-session', async (event) => {
    if (!isTrustedSender(event)) return null;
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

  ipcMain.handle('auth:set-session', async (event, sessionData: unknown) => {
    if (!isTrustedSender(event)) return false;
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

  ipcMain.handle('auth:clear-session', async (event) => {
    if (!isTrustedSender(event)) return false;
    try {
      if (existsSync(sessionPath)) unlinkSync(sessionPath);
      return true;
    } catch (err) {
      console.error('Failed to clear secure auth session:', err);
      return false;
    }
  });
}
