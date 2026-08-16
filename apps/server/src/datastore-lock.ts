import fs from 'node:fs';
import path from 'node:path';

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

export function readDatastoreLockInfo(dataDir: string): DatastoreLockInfo | null {
  const lockFilePath = getDatastoreLockPath(dataDir);
  try {
    if (!fs.existsSync(lockFilePath)) return null;
    const raw = fs.readFileSync(lockFilePath, 'utf-8');
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
  let lockFd: number;

  try {
    lockFd = fs.openSync(lockFilePath, 'wx', 0o600);
  } catch (err: any) {
    if (err.code !== 'EEXIST') {
      throw new DatastoreLockError(`Failed to acquire datastore lock at ${lockFilePath}: ${err.message || err}`);
    }

    // Lock file exists: check if holding process is alive
    const lockInfo = readDatastoreLockInfo(dataDir);
    if (lockInfo && isProcessAlive(lockInfo.pid)) {
      throw new DatastoreLockError(
        `Account datastore lock is already held by live ${lockInfo.owner} (PID ${lockInfo.pid}) at ${lockFilePath}.`,
        lockInfo
      );
    }

    // Dead / stale lock detected: safely remove and retry atomic creation
    try {
      if (fs.existsSync(lockFilePath)) {
        fs.unlinkSync(lockFilePath);
      }
    } catch (unlinkErr: any) {
      if (unlinkErr.code !== 'ENOENT') {
        throw new DatastoreLockError(`Failed to clean up stale datastore lock at ${lockFilePath}: ${unlinkErr.message || unlinkErr}`);
      }
    }

    try {
      lockFd = fs.openSync(lockFilePath, 'wx', 0o600);
    } catch (retryErr: any) {
      throw new DatastoreLockError(`Failed to acquire datastore lock after removing stale lock: ${retryErr.message || retryErr}`);
    }
  }

  const payload: DatastoreLockInfo = {
    pid: process.pid,
    owner,
    createdAt: Date.now()
  };

  try {
    fs.writeFileSync(lockFd, JSON.stringify(payload, null, 2), 'utf-8');
  } finally {
    fs.closeSync(lockFd);
  }

  try {
    fs.chmodSync(lockFilePath, 0o600);
  } catch {}

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      if (fs.existsSync(lockFilePath)) {
        const currentInfo = readDatastoreLockInfo(dataDir);
        if (currentInfo?.pid === process.pid) {
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
