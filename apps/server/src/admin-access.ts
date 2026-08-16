#!/usr/bin/env node
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { UserStore, type SessionAccessState } from './auth.js';
import {
  acquireDatastoreLock,
  readDatastoreLockInfo,
  isProcessAlive,
  type DatastoreLock
} from './datastore-lock.js';

export const ALLOWED_SESSION_ACCESS_STATES: readonly SessionAccessState[] = ['blocked', 'beta', 'paid'] as const;

export interface AdminAccessResult {
  userId: string;
  username: string;
  email: string;
  previousAccess: SessionAccessState;
  newAccess: SessionAccessState;
}

export interface AdminRuntimeInfo {
  pid: number;
  port: number;
  adminToken: string;
  dataDir: string;
  createdAt: number;
}

export function getAdminRuntimeFilePath(dataDir: string): string {
  return path.join(dataDir, '.admin-runtime.json');
}

export function writeAdminRuntimeFile(dataDir: string, info: Omit<AdminRuntimeInfo, 'createdAt'>): void {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const filePath = getAdminRuntimeFilePath(dataDir);
  const content: AdminRuntimeInfo = { ...info, createdAt: Date.now() };
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch {}
  }
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2), { mode: 0o600, encoding: 'utf-8' });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Non-fatal on filesystems that do not support POSIX permissions
  }
}

export function cleanupAdminRuntimeFile(dataDir: string): void {
  try {
    const filePath = getAdminRuntimeFilePath(dataDir);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // ignore
  }
}

export function updateAccountSessionAccess(
  userStore: UserStore,
  identifier: string,
  newAccess: string
): AdminAccessResult {
  const trimmedIdentifier = identifier?.trim();
  if (!trimmedIdentifier) {
    throw new Error('Account identifier (username or email) is required.');
  }

  const normalizedAccess = newAccess?.trim().toLowerCase() as SessionAccessState;
  if (!ALLOWED_SESSION_ACCESS_STATES.includes(normalizedAccess)) {
    throw new Error(`Invalid sessionAccess: "${newAccess}". Allowed values: ${ALLOWED_SESSION_ACCESS_STATES.join(', ')}.`);
  }

  const profile = userStore.findByUsernameOrEmail(trimmedIdentifier);
  if (!profile) {
    throw new Error(`Account not found for identifier: "${trimmedIdentifier}".`);
  }

  const storedUser = userStore.getStoredUser(profile.id);
  const previousAccess: SessionAccessState = storedUser?.sessionAccess ?? 'blocked';

  userStore.setSessionAccess(profile.id, normalizedAccess);

  return {
    userId: profile.id,
    username: profile.username,
    email: profile.email,
    previousAccess,
    newAccess: normalizedAccess
  };
}

export interface CliOptions {
  identifier?: string;
  access?: string;
  dataDir?: string;
  help?: boolean;
}

export function parseCliArgs(args: string[]): CliOptions {
  const options: CliOptions = {};
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--data-dir' || arg === '-d') {
      options.dataDir = args[++i];
    } else if (arg === '--user' || arg === '-u') {
      options.identifier = args[++i];
    } else if (arg === '--access' || arg === '-a') {
      options.access = args[++i];
    } else if (!arg.startsWith('-')) {
      positionals.push(arg);
    }
  }

  if (!options.identifier && positionals.length > 0) {
    options.identifier = positionals[0];
  }
  if (!options.access && positionals.length > 1) {
    options.access = positionals[1];
  }

  return options;
}

export async function runCli(args: string[] = process.argv.slice(2)): Promise<number> {
  const options = parseCliArgs(args);

  if (options.help || !options.identifier || !options.access) {
    console.log(`JaMeet Admin Session Access Tool

Usage:
  npm run admin:access -- <username-or-email> <blocked|beta|paid>
  node dist/admin-access.js <username-or-email> <blocked|beta|paid>

Options:
  --user, -u <string>       Username or email address of the account
  --access, -a <string>     Target access state: blocked, beta, or paid
  --data-dir, -d <path>     Custom data directory path (defaults to DATA_DIR or ./data)
  --help, -h                Show this help message

Examples:
  npm run admin:access -- dan@example.com beta
  npm run admin:access -- producer_dan paid
  npm run admin:access -- producer_dan blocked`);
    return options.help ? 0 : 1;
  }

  const dataDir = options.dataDir ?? process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
  const lockInfo = readDatastoreLockInfo(dataDir);
  const isLockOwnerAlive = lockInfo !== null && isProcessAlive(lockInfo.pid);

  if (isLockOwnerAlive && lockInfo.owner === 'server') {
    // Live JaMeet server owns the datastore lock. Route request to live server.
    const runtimeFilePath = getAdminRuntimeFilePath(dataDir);
    let runtimeInfo: AdminRuntimeInfo | null = null;
    if (fs.existsSync(runtimeFilePath)) {
      try {
        const raw = fs.readFileSync(runtimeFilePath, 'utf-8');
        runtimeInfo = JSON.parse(raw);
      } catch {}
    }

    if (!runtimeInfo || !runtimeInfo.port || !runtimeInfo.adminToken) {
      console.error(
        `Error: Datastore lock is held by a live JaMeet server (PID ${lockInfo.pid}), but runtime discovery information could not be read. Cannot safely modify datastore without the running server.`
      );
      return 1;
    }

    try {
      const url = `http://127.0.0.1:${runtimeInfo.port}/api/internal/admin/session-access`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${runtimeInfo.adminToken}`
        },
        body: JSON.stringify({
          identifier: options.identifier,
          access: options.access
        })
      });

      const data = (await response.json()) as any;
      if (!response.ok || !data.ok) {
        console.error(`Error: ${data.message || `Server administration error (${response.status})`}`);
        return 1;
      }

      console.log(`Updated session access successfully (live server):`);
      console.log(`  Account: ${data.email} (Username: ${data.username})`);
      console.log(`  User ID: ${data.userId}`);
      console.log(`  Previous Access: ${data.previousAccess}`);
      console.log(`  New Access: ${data.newAccess}`);
      return 0;
    } catch (err: any) {
      console.error(
        `Error: Datastore lock is held by a live JaMeet server (PID ${lockInfo.pid}), but connecting to the administration endpoint failed (${err.message || err}).`
      );
      return 1;
    }
  }

  if (isLockOwnerAlive && lockInfo.owner === 'admin-cli' && lockInfo.pid !== process.pid) {
    console.error(
      `Error: Datastore lock is currently held by another live administration process (PID ${lockInfo.pid}).`
    );
    return 1;
  }

  // Safe offline mode: acquire exclusive shared datastore lock before initializing UserStore
  let datastoreLock: DatastoreLock;
  try {
    datastoreLock = acquireDatastoreLock(dataDir, 'admin-cli');
  } catch (err: any) {
    console.error(`Error: Could not acquire exclusive datastore lock: ${err.message || err}`);
    return 1;
  }

  try {
    const userStore = new UserStore(dataDir);
    const result = updateAccountSessionAccess(userStore, options.identifier, options.access);

    console.log(`Updated session access successfully:`);
    console.log(`  Account: ${result.email} (Username: ${result.username})`);
    console.log(`  User ID: ${result.userId}`);
    console.log(`  Previous Access: ${result.previousAccess}`);
    console.log(`  New Access: ${result.newAccess}`);
    return 0;
  } catch (err: any) {
    console.error(`Error: ${err.message || err}`);
    return 1;
  } finally {
    datastoreLock.release();
  }
}

const isDirectExecution = (): boolean => {
  if (!process.argv[1]) return false;
  try {
    const currentFilePath = fileURLToPath(import.meta.url);
    const executedPath = fs.realpathSync(process.argv[1]);
    return currentFilePath === executedPath || process.argv[1].endsWith('admin-access.ts') || process.argv[1].endsWith('admin-access.js');
  } catch {
    return false;
  }
};

if (isDirectExecution()) {
  runCli().then((code) => {
    if (code !== 0) process.exit(code);
  });
}
