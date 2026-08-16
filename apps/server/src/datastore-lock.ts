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

const RECOVERY_LOCK_FILENAME = '.account-datastore-recovery.lock';

function getRecoveryLockPath(dataDir: string): string {
  return path.join(dataDir, RECOVERY_LOCK_FILENAME);
}

interface RecoveryLockHandle {
  fd: number;
  lockPath: string;
}

function tryAcquireRecoveryLock(dataDir: string): RecoveryLockHandle | null {
  const lockPath = getRecoveryLockPath(dataDir);
  try {
    const fd = fs.openSync(lockPath, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: Date.now() }), 'utf-8');
    return { fd, lockPath };
  } catch (err: any) {
    if (err.code !== 'EEXIST') {
      return null;
    }
    // Check if recovery lock itself is stale
    try {
      if (fs.existsSync(lockPath)) {
        const raw = fs.readFileSync(lockPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.pid === 'number' && !isProcessAlive(parsed.pid)) {
          try { fs.unlinkSync(lockPath); } catch {}
          const fd = fs.openSync(lockPath, 'wx', 0o600);
          fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: Date.now() }), 'utf-8');
          return { fd, lockPath };
        }
      }
    } catch {}
    return null;
  }
}

function releaseRecoveryLock(handle: RecoveryLockHandle | null): void {
  if (!handle) return;
  try {
    fs.closeSync(handle.fd);
  } catch {}
  try {
    if (fs.existsSync(handle.lockPath)) {
      const raw = fs.readFileSync(handle.lockPath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed?.pid === process.pid) {
        fs.unlinkSync(handle.lockPath);
      }
    }
  } catch {}
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
    if (!lockInfo) {
      // Lock file is present but ownership cannot be safely established.
      // Fail closed rather than deleting an unverified or initializing lock.
      throw new DatastoreLockError(
        `Account datastore lock at ${lockFilePath} is present but lock ownership could not be safely established.`
      );
    }

    if (isProcessAlive(lockInfo.pid)) {
      throw new DatastoreLockError(
        `Account datastore lock is already held by live ${lockInfo.owner} (PID ${lockInfo.pid}) at ${lockFilePath}.`,
        lockInfo
      );
    }

    // Recorded process is confirmed dead (ESRCH).
    // Capture snapshot of stale lock metadata to guarantee we only remove this exact dead lock.
    const targetPid = lockInfo.pid;
    const targetCreatedAt = lockInfo.createdAt;
    let targetStat: fs.Stats | null = null;
    try {
      targetStat = fs.existsSync(lockFilePath) ? fs.statSync(lockFilePath) : null;
    } catch {}
    const targetIno = targetStat?.ino;

    // Acquire exclusive recovery mutex to prevent concurrent stale recovery races
    const recoveryHandle = tryAcquireRecoveryLock(dataDir);
    if (!recoveryHandle) {
      // Another process is performing recovery. Wait and observe new live lock.
      const liveLockInfo = readDatastoreLockInfoWithRetry(dataDir, 10, 20);
      if (liveLockInfo && isProcessAlive(liveLockInfo.pid)) {
        throw new DatastoreLockError(
          `Account datastore lock is already held by live ${liveLockInfo.owner} (PID ${liveLockInfo.pid}) at ${lockFilePath}.`,
          liveLockInfo
        );
      }
      throw new DatastoreLockError(
        `Concurrent stale datastore lock recovery in progress at ${lockFilePath}.`
      );
    }

    try {
      // Under recovery mutex, re-verify lockFilePath is still the exact dead lock we verified
      const currentInfo = readDatastoreLockInfo(dataDir);
      let currentStat: fs.Stats | null = null;
      try {
        currentStat = fs.existsSync(lockFilePath) ? fs.statSync(lockFilePath) : null;
      } catch {}

      const isStillTargetStale = Boolean(
        currentInfo &&
        currentInfo.pid === targetPid &&
        currentInfo.createdAt === targetCreatedAt &&
        (targetIno === undefined || currentStat?.ino === targetIno)
      );

      if (!isStillTargetStale) {
        // The lock was replaced or modified by another process. Do not touch lockFilePath!
        if (currentInfo && isProcessAlive(currentInfo.pid)) {
          throw new DatastoreLockError(
            `Account datastore lock is already held by live ${currentInfo.owner} (PID ${currentInfo.pid}) at ${lockFilePath}.`,
            currentInfo
          );
        }
        throw new DatastoreLockError(
          `Aborted stale datastore lock recovery: lock at ${lockFilePath} was modified concurrently.`
        );
      }

      // Exact verified stale lock safely unlinked under recovery mutex
      try {
        if (fs.existsSync(lockFilePath)) {
          fs.unlinkSync(lockFilePath);
        }
      } catch (unlinkErr: any) {
        if (unlinkErr.code !== 'ENOENT') {
          throw new DatastoreLockError(`Failed to clean up verified stale lock at ${lockFilePath}: ${unlinkErr.message || unlinkErr}`);
        }
      }

      // Atomically create the new live lock file
      try {
        lockFd = fs.openSync(lockFilePath, 'wx', 0o600);
      } catch (retryErr: any) {
        const liveLockInfo = readDatastoreLockInfoWithRetry(dataDir, 5, 20);
        throw new DatastoreLockError(
          `Failed to acquire datastore lock after removing stale lock: ${retryErr.message || retryErr}`,
          liveLockInfo || undefined
        );
      }
    } finally {
      releaseRecoveryLock(recoveryHandle);
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
