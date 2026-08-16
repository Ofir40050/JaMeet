import fs from 'node:fs';
import path from 'node:path';
import lockfile from 'proper-lockfile';

export const DATASTORE_LOCK_FILENAME = '.account-datastore.lock';

export interface DatastoreLockInfo {
  pid: number;
  owner: 'server' | 'admin-cli';
  createdAt: number;
}

export class DatastoreLockError extends Error {
  constructor(
    message: string,
    public readonly lockInfo?: DatastoreLockInfo
  ) {
    super(message);
    this.name = 'DatastoreLockError';
  }
}

export function getDatastoreLockPath(dataDir: string): string {
  return path.join(dataDir, DATASTORE_LOCK_FILENAME);
}

export function isProcessAlive(pid: number): boolean {
  if (typeof pid !== 'number' || isNaN(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    if (err.code === 'ESRCH') {
      return false;
    }
    // EPERM or other errors indicate the process exists
    return true;
  }
}

export function isDatastoreLocked(dataDir: string): boolean {
  const lockFilePath = getDatastoreLockPath(dataDir);
  try {
    if (!fs.existsSync(lockFilePath)) return false;
    return lockfile.checkSync(lockFilePath, { realpath: false });
  } catch {
    return false;
  }
}

export function readDatastoreLockInfo(dataDir: string): DatastoreLockInfo | null {
  const lockFilePath = getDatastoreLockPath(dataDir);
  try {
    if (!fs.existsSync(lockFilePath)) return null;
    const raw = fs.readFileSync(lockFilePath, 'utf-8');
    if (!raw || !raw.trim()) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.pid === 'number' && typeof parsed.owner === 'string') {
      return parsed as DatastoreLockInfo;
    }
    return null;
  } catch {
    return null;
  }
}

export interface DatastoreLock {
  dataDir: string;
  lockFilePath: string;
  release: () => void;
}

export function acquireDatastoreLock(dataDir: string, owner: 'server' | 'admin-cli'): DatastoreLock {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const lockFilePath = getDatastoreLockPath(dataDir);

  if (fs.existsSync(lockFilePath)) {
    const raw = fs.readFileSync(lockFilePath, 'utf-8');
    if (raw && raw.trim()) {
      let parsed: any = null;
      try {
        parsed = JSON.parse(raw);
      } catch {}
      if (!parsed || typeof parsed.pid !== 'number' || typeof parsed.owner !== 'string') {
        throw new DatastoreLockError(
          `Account datastore lock at ${lockFilePath} is present but lock ownership could not be safely established.`
        );
      }
      if (isProcessAlive(parsed.pid) && parsed.pid !== process.pid) {
        throw new DatastoreLockError(
          `Account datastore lock is already held by live ${parsed.owner} (PID ${parsed.pid}) at ${lockFilePath}.`,
          parsed as DatastoreLockInfo
        );
      }
    } else {
      // Empty or initializing file without parseable metadata: fail closed
      throw new DatastoreLockError(
        `Account datastore lock at ${lockFilePath} is present but lock ownership could not be safely established.`
      );
    }
  } else {
    try {
      fs.writeFileSync(lockFilePath, '', { mode: 0o600, flag: 'wx' });
    } catch (err: any) {
      if (err.code !== 'EEXIST') {
        throw new DatastoreLockError(`Failed to initialize datastore lock file at ${lockFilePath}: ${err.message || err}`);
      }
    }
  }

  let releaseLock: () => void;
  try {
    releaseLock = lockfile.lockSync(lockFilePath, {
      stale: 10000,
      update: 3000,
      retries: 0,
      realpath: false
    });
  } catch (err: any) {
    if (err.code === 'ELOCKED') {
      const lockInfo = readDatastoreLockInfo(dataDir);
      throw new DatastoreLockError(
        `Account datastore lock is already held by live ${lockInfo?.owner || 'process'} (PID ${lockInfo?.pid || 'unknown'}) at ${lockFilePath}.`,
        lockInfo || undefined
      );
    }
    throw new DatastoreLockError(`Failed to acquire datastore lock at ${lockFilePath}: ${err.message || err}`);
  }

  const payload: DatastoreLockInfo = {
    pid: process.pid,
    owner,
    createdAt: Date.now()
  };

  try {
    fs.writeFileSync(lockFilePath, JSON.stringify(payload, null, 2), { mode: 0o600, encoding: 'utf-8' });
  } catch (writeErr: any) {
    try { releaseLock(); } catch {}
    throw new DatastoreLockError(`Failed to write lock metadata to ${lockFilePath}: ${writeErr.message || writeErr}`);
  }

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      releaseLock();
    } catch {}
    try {
      if (fs.existsSync(lockFilePath)) {
        const info = readDatastoreLockInfo(dataDir);
        if (info?.pid === process.pid) {
          fs.unlinkSync(lockFilePath);
        }
      }
    } catch {}
  };

  return {
    dataDir,
    lockFilePath,
    release
  };
}
