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

  // 1. Prepare fully written lock metadata in a private temporary file first
  const payload: DatastoreLockInfo = {
    pid: process.pid,
    owner,
    createdAt: Date.now()
  };
  const tempPath = path.join(
    dataDir,
    `.account-datastore.lock.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
  );
  fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), { mode: 0o600, encoding: 'utf-8' });

  // 2. Attempt atomic link creation
  let acquired = false;
  try {
    fs.linkSync(tempPath, lockFilePath);
    acquired = true;
  } catch (err: any) {
    if (err.code !== 'EEXIST') {
      try { fs.unlinkSync(tempPath); } catch {}
      throw new DatastoreLockError(`Failed to acquire datastore lock at ${lockFilePath}: ${err.message || err}`);
    }
  }

  if (!acquired) {
    // Lock file already exists on disk.
    // Read its metadata with retries to protect any newly created lock.
    const lockInfo = readDatastoreLockInfoWithRetry(dataDir, 5, 20);
    if (!lockInfo) {
      // Unparseable / unverified metadata: fail closed without modifying disk
      try { fs.unlinkSync(tempPath); } catch {}
      throw new DatastoreLockError(
        `Account datastore lock at ${lockFilePath} is present but lock ownership could not be safely established.`
      );
    }

    if (isProcessAlive(lockInfo.pid)) {
      // Live process holds lock: fail closed
      try { fs.unlinkSync(tempPath); } catch {}
      throw new DatastoreLockError(
        `Account datastore lock is already held by live ${lockInfo.owner} (PID ${lockInfo.pid}) at ${lockFilePath}.`,
        lockInfo
      );
    }

    // Recorded owner is confirmed dead (ESRCH).
    // Atomically claim this exact dead lock using a deterministic hard link tied to its dead PID and creation timestamp.
    const claimPath = path.join(
      dataDir,
      `.account-datastore.lock.claim.${lockInfo.pid}.${lockInfo.createdAt}`
    );

    let claimed = false;
    try {
      fs.linkSync(lockFilePath, claimPath);
      claimed = true;
    } catch (claimErr: any) {
      // Another process already claimed or replaced this exact dead lock
      try { fs.unlinkSync(tempPath); } catch {}
      const liveLockInfo = readDatastoreLockInfoWithRetry(dataDir, 5, 20);
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

    if (claimed) {
      try {
        // Under atomic claim, verify lockFilePath is still the claimed dead file (same inode)
        const claimStat = fs.statSync(claimPath);
        const currentStat = fs.existsSync(lockFilePath) ? fs.statSync(lockFilePath) : null;
        if (currentStat && currentStat.ino === claimStat.ino) {
          // Remove the confirmed dead lock file
          fs.unlinkSync(lockFilePath);
          // Atomically link our fully written new lock
          fs.linkSync(tempPath, lockFilePath);
          acquired = true;
        } else {
          // The lock at lockFilePath was replaced in the interim! Do not touch it!
          const liveLockInfo = readDatastoreLockInfoWithRetry(dataDir, 5, 20);
          if (liveLockInfo && isProcessAlive(liveLockInfo.pid)) {
            throw new DatastoreLockError(
              `Account datastore lock is already held by live ${liveLockInfo.owner} (PID ${liveLockInfo.pid}) at ${lockFilePath}.`,
              liveLockInfo
            );
          }
          throw new DatastoreLockError(
            `Aborted stale datastore lock recovery: lock at ${lockFilePath} was modified concurrently.`
          );
        }
      } finally {
        try { fs.unlinkSync(claimPath); } catch {}
      }
    }
  }

  // Clean up private temporary file
  try { fs.unlinkSync(tempPath); } catch {}

  if (!acquired) {
    throw new DatastoreLockError(`Failed to acquire datastore lock at ${lockFilePath}.`);
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
