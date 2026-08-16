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

function sleepSync(ms: number): void {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {}
  }
}

export function readDatastoreLockInfoWithRetry(
  dataDir: string,
  maxAttempts = 5,
  delayMs = 15
): DatastoreLockInfo | null {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const info = readDatastoreLockInfo(dataDir);
    if (info) return info;
    const lockFilePath = getDatastoreLockPath(dataDir);
    if (!fs.existsSync(lockFilePath)) return null;
    if (attempt < maxAttempts) {
      sleepSync(delayMs);
    }
  }
  return null;
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
  let lockFd: number | undefined;

  try {
    lockFd = fs.openSync(lockFilePath, 'wx', 0o600);
  } catch (err: any) {
    if (err.code !== 'EEXIST') {
      throw new DatastoreLockError(`Failed to acquire datastore lock at ${lockFilePath}: ${err.message || err}`);
    }

    // Lock file exists: check if holding process is alive with retries to allow concurrent metadata writing
    const lockInfo = readDatastoreLockInfoWithRetry(dataDir, 5, 20);
    if (lockInfo) {
      if (isProcessAlive(lockInfo.pid)) {
        throw new DatastoreLockError(
          `Account datastore lock is already held by live ${lockInfo.owner} (PID ${lockInfo.pid}) at ${lockFilePath}.`,
          lockInfo
        );
      }

      // Recorded process is confirmed dead (ESRCH): safely remove stale lock and retry atomic creation
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
    } else {
      // Lock file exists but metadata could not be parsed after retries.
      // Refuse to treat a newly created or unverified lock as stale.
      let stat: fs.Stats | undefined;
      try {
        stat = fs.statSync(lockFilePath);
      } catch (statErr: any) {
        if (statErr.code === 'ENOENT') {
          // Lock was released in the interim; retry open
          try {
            lockFd = fs.openSync(lockFilePath, 'wx', 0o600);
          } catch (retryErr: any) {
            throw new DatastoreLockError(`Failed to acquire datastore lock: ${retryErr.message || retryErr}`);
          }
        } else {
          throw new DatastoreLockError(`Failed to inspect datastore lock at ${lockFilePath}: ${statErr.message || statErr}`);
        }
      }

      if (stat && lockFd === undefined) {
        const fileAgeMs = Date.now() - stat.mtimeMs;
        const STALE_CORRUPT_THRESHOLD_MS = 5000;
        if (fileAgeMs < STALE_CORRUPT_THRESHOLD_MS) {
          throw new DatastoreLockError(
            `Account datastore lock at ${lockFilePath} is held or initializing. Refusing to remove unverified lock.`
          );
        }

        // Abandoned corrupt file older than threshold: clean up and retry
        try {
          if (fs.existsSync(lockFilePath)) {
            fs.unlinkSync(lockFilePath);
          }
        } catch (unlinkErr: any) {
          if (unlinkErr.code !== 'ENOENT') {
            throw new DatastoreLockError(`Failed to clean up abandoned datastore lock at ${lockFilePath}: ${unlinkErr.message || unlinkErr}`);
          }
        }

        try {
          lockFd = fs.openSync(lockFilePath, 'wx', 0o600);
        } catch (retryErr: any) {
          throw new DatastoreLockError(`Failed to acquire datastore lock after removing abandoned lock: ${retryErr.message || retryErr}`);
        }
      }
    }
  }

  if (lockFd === undefined) {
    throw new DatastoreLockError(`Failed to obtain file descriptor for datastore lock at ${lockFilePath}.`);
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
