import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client';
import { UserStore } from './auth.js';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import {
  updateAccountSessionAccess,
  parseCliArgs,
  runCli,
  writeAdminRuntimeFile,
  getAdminRuntimeFilePath,
  cleanupAdminRuntimeFile,
  ALLOWED_SESSION_ACCESS_STATES
} from './admin-access.js';
import {
  acquireDatastoreLock,
  readDatastoreLockInfo,
  getDatastoreLockPath,
  DatastoreLockError
} from './datastore-lock.js';

describe('Admin Session Access CLI & Management Tool', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-admin-test-'));
  });

  afterEach(() => {
    if (testDir && fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('updates account session access by username and email across blocked, beta, and paid states', async () => {
    const store = new UserStore(testDir);

    // Register test account (defaults to blocked)
    const reg = await store.register({
      username: 'musician_dan',
      email: 'dan@example.com',
      password: 'StrongPassword123!',
      displayName: 'Dan Musician'
    });

    expect(store.getStoredUser(reg.user.id)?.sessionAccess).toBe('blocked');

    // 1. Promote from blocked to beta by username
    const res1 = updateAccountSessionAccess(store, 'musician_dan', 'beta');
    expect(res1).toEqual({
      userId: reg.user.id,
      username: 'musician_dan',
      email: 'dan@example.com',
      previousAccess: 'blocked',
      newAccess: 'beta'
    });
    expect(store.getStoredUser(reg.user.id)?.sessionAccess).toBe('beta');

    // Verify persisted on disk
    const reloadedStore1 = new UserStore(testDir);
    expect(reloadedStore1.getStoredUser(reg.user.id)?.sessionAccess).toBe('beta');

    // 2. Promote from beta to paid by email
    const res2 = updateAccountSessionAccess(reloadedStore1, 'DAN@EXAMPLE.COM', 'paid');
    expect(res2).toEqual({
      userId: reg.user.id,
      username: 'musician_dan',
      email: 'dan@example.com',
      previousAccess: 'beta',
      newAccess: 'paid'
    });
    expect(reloadedStore1.getStoredUser(reg.user.id)?.sessionAccess).toBe('paid');

    // Verify persisted on disk
    const reloadedStore2 = new UserStore(testDir);
    expect(reloadedStore2.getStoredUser(reg.user.id)?.sessionAccess).toBe('paid');

    // 3. Revoke from paid to blocked by username (case-insensitive)
    const res3 = updateAccountSessionAccess(reloadedStore2, 'MUSICIAN_DAN', 'blocked');
    expect(res3).toEqual({
      userId: reg.user.id,
      username: 'musician_dan',
      email: 'dan@example.com',
      previousAccess: 'paid',
      newAccess: 'blocked'
    });
    expect(reloadedStore2.getStoredUser(reg.user.id)?.sessionAccess).toBe('blocked');

    // Verify persisted on disk
    const reloadedStore3 = new UserStore(testDir);
    expect(reloadedStore3.getStoredUser(reg.user.id)?.sessionAccess).toBe('blocked');
  });

  it('rejects non-existent accounts and leaves database unmodified', async () => {
    const store = new UserStore(testDir);

    const reg = await store.register({
      username: 'existing_user',
      email: 'existing@example.com',
      password: 'StrongPassword123!',
      displayName: 'Existing User'
    });

    expect(() => updateAccountSessionAccess(store, 'ghost_user', 'beta')).toThrow(
      /Account not found for identifier: "ghost_user"/i
    );

    expect(() => updateAccountSessionAccess(store, 'ghost@example.com', 'paid')).toThrow(
      /Account not found for identifier: "ghost@example.com"/i
    );

    // Existing user remains untouched
    expect(store.getStoredUser(reg.user.id)?.sessionAccess).toBe('blocked');
  });

  it('rejects invalid or arbitrary sessionAccess values', async () => {
    const store = new UserStore(testDir);

    await store.register({
      username: 'target_user',
      email: 'target@example.com',
      password: 'StrongPassword123!',
      displayName: 'Target User'
    });

    const invalidStates = ['admin', 'unlimited', 'vip', 'trial', 'active', '', '   '];

    for (const invalid of invalidStates) {
      expect(() => updateAccountSessionAccess(store, 'target_user', invalid)).toThrow(
        /Invalid sessionAccess:/i
      );
    }
  });

  it('rejects empty or missing identifiers', async () => {
    const store = new UserStore(testDir);

    expect(() => updateAccountSessionAccess(store, '', 'beta')).toThrow(
      /Account identifier.*is required/i
    );
    expect(() => updateAccountSessionAccess(store, '   ', 'beta')).toThrow(
      /Account identifier.*is required/i
    );
  });

  it('parses CLI positional and flag arguments properly', () => {
    expect(parseCliArgs(['dan@example.com', 'beta'])).toEqual({
      identifier: 'dan@example.com',
      access: 'beta'
    });

    expect(parseCliArgs(['--user', 'producer_dan', '--access', 'paid', '--data-dir', '/var/data'])).toEqual({
      identifier: 'producer_dan',
      access: 'paid',
      dataDir: '/var/data'
    });

    expect(parseCliArgs(['-u', 'producer_dan', '-a', 'blocked', '-d', '/var/data'])).toEqual({
      identifier: 'producer_dan',
      access: 'blocked',
      dataDir: '/var/data'
    });

    expect(parseCliArgs(['--help'])).toEqual({
      help: true
    });
  });

  it('executes runCli offline and safely acquires exclusive datastore lock', async () => {
    const store = new UserStore(testDir);
    await store.register({
      username: 'cli_artist',
      email: 'cli_artist@example.com',
      password: 'StrongPassword123!',
      displayName: 'CLI Artist'
    });

    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      // 1. Success execution offline
      const exitCode1 = await runCli(['cli_artist', 'beta', '--data-dir', testDir]);
      expect(exitCode1).toBe(0);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Updated session access successfully'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('cli_artist@example.com'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Previous Access: blocked'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('New Access: beta'));

      // Verify lock was cleanly released after command finished
      expect(fs.existsSync(getDatastoreLockPath(testDir))).toBe(false);

      // 2. Account not found
      const exitCode2 = await runCli(['nonexistent_user', 'beta', '--data-dir', testDir]);
      expect(exitCode2).toBe(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Account not found'));

      // 3. Invalid access state
      const exitCode3 = await runCli(['cli_artist', 'super_tier', '--data-dir', testDir]);
      expect(exitCode3).toBe(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid sessionAccess'));

      // 4. Help flag
      const exitCodeHelp = await runCli(['--help']);
      expect(exitCodeHelp).toBe(0);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('JaMeet Admin Session Access Tool'));

      // 5. No arguments (prints usage and returns 1)
      const exitCodeNoArgs = await runCli([]);
      expect(exitCodeNoArgs).toBe(1);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('JaMeet Admin Session Access Tool'));
    } finally {
      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });

  it('server startup fails closed when datastore lock is already held by another process', async () => {
    // Acquire datastore lock manually as another process
    const lock = acquireDatastoreLock(testDir, 'admin-cli');

    const config = loadConfig({
      NODE_ENV: 'test',
      DATA_DIR: testDir,
      TURN_SHARED_SECRET: 'test-secret-123456789'
    });

    try {
      // Attempting to start server must fail closed rather than becoming a second writer
      await expect(createApp(config)).rejects.toThrow(DatastoreLockError);
    } finally {
      lock.release();
    }

    // After release, server startup succeeds
    const serverInstance = await createApp(config);
    try {
      expect(serverInstance.datastoreLock).toBeDefined();
    } finally {
      await serverInstance.app.close();
    }
  });

  it('executes runCli against a live running server process, updating server in-memory state and disk', async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      DATA_DIR: testDir,
      TURN_SHARED_SECRET: 'test-secret-123456789'
    });

    const { app, userStore, runtimeAdminToken } = await createApp(config);
    await app.listen({ host: '127.0.0.1', port: 0 });

    try {
      // Register account on the running server
      const reg = await userStore.register({
        username: 'live_producer',
        email: 'live@example.com',
        password: 'LivePassword123!',
        displayName: 'Live Producer'
      });

      expect(userStore.getStoredUser(reg.user.id)?.sessionAccess).toBe('blocked');

      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      try {
        // Run CLI pointing to testDir where the live server holds the datastore lock
        const exitCode = await runCli(['live_producer', 'paid', '--data-dir', testDir]);
        expect(exitCode).toBe(0);
        expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Updated session access successfully'));
        expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('New Access: paid'));

        // Crucial test: verify the live server's in-memory UserStore immediately has 'paid'
        expect(userStore.getStoredUser(reg.user.id)?.sessionAccess).toBe('paid');

        // And verify persisted to disk
        const raw = fs.readFileSync(path.join(testDir, 'jameet-accounts.json'), 'utf-8');
        const diskDb = JSON.parse(raw);
        expect(diskDb.users[0].sessionAccess).toBe('paid');
      } finally {
        consoleLogSpy.mockRestore();
        consoleErrorSpy.mockRestore();
      }
    } finally {
      await app.close();
    }
  });

  it('fails closed when datastore lock is held by server but admin discovery file is unavailable', async () => {
    // Acquire lock pretending to be a running server
    const lock = acquireDatastoreLock(testDir, 'server');

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      // CLI must not open a second UserStore when server lock is held without discovery
      const exitCode = await runCli(['any_user', 'beta', '--data-dir', testDir]);
      expect(exitCode).toBe(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('runtime discovery information could not be read'));
    } finally {
      lock.release();
      consoleErrorSpy.mockRestore();
    }
  });

  it('strictly rejects unauthorized, invalid, or remote requests on internal admin route', async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      DATA_DIR: testDir,
      TURN_SHARED_SECRET: 'test-secret-123456789'
    });

    const { app, userStore, runtimeAdminToken } = await createApp(config);

    try {
      await userStore.register({
        username: 'target_user',
        email: 'target@example.com',
        password: 'Password123!',
        displayName: 'Target'
      });

      // 1. Missing Authorization header -> 401
      const resNoAuth = await app.inject({
        method: 'POST',
        url: '/api/internal/admin/session-access',
        payload: { identifier: 'target_user', access: 'beta' }
      });
      expect(resNoAuth.statusCode).toBe(401);

      // 2. Invalid token -> 401
      const resBadAuth = await app.inject({
        method: 'POST',
        url: '/api/internal/admin/session-access',
        headers: { authorization: 'Bearer bad-token' },
        payload: { identifier: 'target_user', access: 'beta' }
      });
      expect(resBadAuth.statusCode).toBe(401);

      // 3. Invalid payload / missing fields -> 400
      const resBadPayload = await app.inject({
        method: 'POST',
        url: '/api/internal/admin/session-access',
        headers: { authorization: `Bearer ${runtimeAdminToken}` },
        payload: { access: 'beta' }
      });
      expect(resBadPayload.statusCode).toBe(400);

      // 4. Invalid sessionAccess state -> 400
      const resInvalidState = await app.inject({
        method: 'POST',
        url: '/api/internal/admin/session-access',
        headers: { authorization: `Bearer ${runtimeAdminToken}` },
        payload: { identifier: 'target_user', access: 'unlimited' }
      });
      expect(resInvalidState.statusCode).toBe(400);

      // 5. Non-existent account -> 404
      const resNotFound = await app.inject({
        method: 'POST',
        url: '/api/internal/admin/session-access',
        headers: { authorization: `Bearer ${runtimeAdminToken}` },
        payload: { identifier: 'unknown_account', access: 'beta' }
      });
      expect(resNotFound.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('recovers conservatively from stale lock file when recorded owner PID is dead', async () => {
    const store = new UserStore(testDir);
    await store.register({
      username: 'offline_user',
      email: 'offline@example.com',
      password: 'Password123!',
      displayName: 'Offline User'
    });

    // Write a fake stale lock file with a dead PID (e.g. 9999999)
    const lockPath = getDatastoreLockPath(testDir);
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: 9999999, owner: 'admin-cli', createdAt: Date.now() }),
      { mode: 0o600, encoding: 'utf-8' }
    );

    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const exitCode = await runCli(['offline_user', 'beta', '--data-dir', testDir]);
      expect(exitCode).toBe(0);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Updated session access successfully'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('New Access: beta'));

      // Verify lock was cleanly released after successful offline execution
      expect(fs.existsSync(lockPath)).toBe(false);
    } finally {
      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });

  it('refuses to treat a newly created initializing lock file as stale and fails closed', () => {
    const lockPath = getDatastoreLockPath(testDir);
    // Create an empty lock file as if process A just called openSync('wx')
    fs.writeFileSync(lockPath, '', { mode: 0o600 });

    // Process B attempting to acquire lock must fail closed rather than deleting the initializing lock
    expect(() => acquireDatastoreLock(testDir, 'server')).toThrow(DatastoreLockError);

    // Initializing lock file must still exist untouched
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  it('fails closed and does not delete lock file when lock ownership cannot be safely established', () => {
    const lockPath = getDatastoreLockPath(testDir);
    // Create an unparseable lock file with mtime in the past
    fs.writeFileSync(lockPath, 'corrupted{data', { mode: 0o600 });
    const pastTime = new Date(Date.now() - 10000);
    fs.utimesSync(lockPath, pastTime, pastTime);

    // Process attempting to acquire lock must fail closed rather than deleting unverified lock
    expect(() => acquireDatastoreLock(testDir, 'server')).toThrow(DatastoreLockError);

    // Unverified lock file must still exist untouched
    expect(fs.existsSync(lockPath)).toBe(true);
    expect(fs.readFileSync(lockPath, 'utf-8')).toBe('corrupted{data');
  });

  it('guarantees exactly one owner when concurrent processes race to recover a stale lock', () => {
    const lockPath = getDatastoreLockPath(testDir);
    // Write a stale lock with confirmed dead PID (9999999)
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: 9999999, owner: 'server', createdAt: Date.now() - 5000 }),
      { mode: 0o600, encoding: 'utf-8' }
    );

    // Process 1 acquires lock recovering the stale lock
    const lock1 = acquireDatastoreLock(testDir, 'server');
    expect(lock1).toBeDefined();

    try {
      // Process 2 attempting to acquire lock must observe Process 1's live lock and fail closed
      expect(() => acquireDatastoreLock(testDir, 'server')).toThrow(DatastoreLockError);

      // Process 1's live lock must remain intact and valid
      const currentInfo = readDatastoreLockInfo(testDir);
      expect(currentInfo?.pid).toBe(process.pid);
      expect(currentInfo?.owner).toBe('server');
    } finally {
      lock1.release();
    }
  });

  it('safely recovers from an abandoned claim file left by a crashed recovery process', () => {
    const lockPath = getDatastoreLockPath(testDir);
    const staleCreatedAt = Date.now() - 10000;
    // Write stale lock with dead PID 9999999
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: 9999999, owner: 'server', createdAt: staleCreatedAt }),
      { mode: 0o600, encoding: 'utf-8' }
    );

    // Simulate an abandoned claim file from a crashed recovery process (dead PID 8888888)
    const claimPath = path.join(testDir, `.account-datastore.lock.claim.9999999.${staleCreatedAt}`);
    fs.writeFileSync(
      claimPath,
      JSON.stringify({
        recoveringPid: 8888888,
        targetPid: 9999999,
        targetCreatedAt: staleCreatedAt,
        createdAt: Date.now() - 5000
      }),
      { mode: 0o600, encoding: 'utf-8' }
    );

    // New process should detect the claim owner is dead, remove abandoned claim, and successfully acquire lock
    const lock = acquireDatastoreLock(testDir, 'server');
    expect(lock).toBeDefined();

    try {
      const currentInfo = readDatastoreLockInfo(testDir);
      expect(currentInfo?.pid).toBe(process.pid);
      expect(currentInfo?.owner).toBe('server');
      // Verify claim path was cleaned up
      expect(fs.existsSync(claimPath)).toBe(false);
    } finally {
      lock.release();
    }
  });

  it('preserves an active claim file from a live recovery process and fails closed', () => {
    const lockPath = getDatastoreLockPath(testDir);
    const staleCreatedAt = Date.now() - 10000;
    // Write stale lock with dead PID 9999999
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: 9999999, owner: 'server', createdAt: staleCreatedAt }),
      { mode: 0o600, encoding: 'utf-8' }
    );

    // Write an active claim file belonging to current live process PID
    const claimPath = path.join(testDir, `.account-datastore.lock.claim.9999999.${staleCreatedAt}`);
    fs.writeFileSync(
      claimPath,
      JSON.stringify({
        recoveringPid: process.pid,
        targetPid: 9999999,
        targetCreatedAt: staleCreatedAt,
        createdAt: Date.now()
      }),
      { mode: 0o600, encoding: 'utf-8' }
    );

    try {
      // Attempting to acquire lock while live claim exists must fail closed and preserve claim
      expect(() => acquireDatastoreLock(testDir, 'server')).toThrow(DatastoreLockError);
      expect(fs.existsSync(claimPath)).toBe(true);
    } finally {
      try { fs.unlinkSync(claimPath); } catch {}
    }
  });

  it('guarantees atomic takeover when multiple processes race to claim an abandoned claim', () => {
    const lockPath = getDatastoreLockPath(testDir);
    const staleCreatedAt = Date.now() - 10000;
    // Write stale lock with dead PID 9999999
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: 9999999, owner: 'server', createdAt: staleCreatedAt }),
      { mode: 0o600, encoding: 'utf-8' }
    );

    // Simulate abandoned claim from dead PID 8888888
    const claimPath = path.join(testDir, `.account-datastore.lock.claim.9999999.${staleCreatedAt}`);
    fs.writeFileSync(
      claimPath,
      JSON.stringify({
        recoveringPid: 8888888,
        targetPid: 9999999,
        targetCreatedAt: staleCreatedAt,
        createdAt: Date.now() - 5000
      }),
      { mode: 0o600, encoding: 'utf-8' }
    );

    // Process 1 takes over the abandoned claim and acquires datastore lock
    const lock1 = acquireDatastoreLock(testDir, 'server');
    expect(lock1).toBeDefined();

    try {
      // Process 2 attempting acquisition must observe Process 1's live lock and fail closed
      expect(() => acquireDatastoreLock(testDir, 'server')).toThrow(DatastoreLockError);

      const currentInfo = readDatastoreLockInfo(testDir);
      expect(currentInfo?.pid).toBe(process.pid);
      expect(currentInfo?.owner).toBe('server');
    } finally {
      lock1.release();
    }
  });

  it('enforces 0o600 permissions on runtime admin file even when replacing an existing file', () => {
    writeAdminRuntimeFile(testDir, {
      pid: process.pid,
      port: 3000,
      adminToken: 'initial-token',
      dataDir: testDir
    });

    const runtimeFilePath = getAdminRuntimeFilePath(testDir);
    expect(fs.existsSync(runtimeFilePath)).toBe(true);

    // Overwrite existing file
    writeAdminRuntimeFile(testDir, {
      pid: process.pid,
      port: 3001,
      adminToken: 'replaced-token',
      dataDir: testDir
    });

    const stat = fs.statSync(runtimeFilePath);
    // 0o600 in octal (user read/write only, no group/other)
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it('gracefully shuts down server on SIGTERM / SIGINT and releases datastore lock only in onClose', async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      DATA_DIR: testDir,
      TURN_SHARED_SECRET: 'test-secret-123456789'
    });

    const { app } = await createApp(config);
    await app.listen({ host: '127.0.0.1', port: 0 });

    const lockPath = getDatastoreLockPath(testDir);
    expect(fs.existsSync(lockPath)).toBe(true);

    // Emitting SIGTERM should trigger app.close() rather than immediately unlinking lock synchronously
    process.emit('SIGTERM', 'SIGTERM');

    // Wait for Fastify to finish its close lifecycle
    await new Promise((resolve) => setTimeout(resolve, 50));

    // After graceful close completes, lock and runtime file must be released
    expect(fs.existsSync(lockPath)).toBe(false);
    expect(fs.existsSync(getAdminRuntimeFilePath(testDir))).toBe(false);

    // Additional calls to app.close() must be safe and idempotent
    await expect(app.close()).resolves.not.toThrow();
  });

  it('closes active Socket.IO connections in live sessions on graceful shutdown and releases datastore lock without hanging or lingering timers', async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      DATA_DIR: testDir,
      TURN_SHARED_SECRET: 'test-secret-123456789'
    });

    const { app, rooms, userStore } = await createApp(config);
    await app.listen({ host: '127.0.0.1', port: 0 });

    const addr = app.server.address() as any;
    const url = `http://127.0.0.1:${addr.port}`;

    const lockPath = getDatastoreLockPath(testDir);
    expect(fs.existsSync(lockPath)).toBe(true);

    // Register host and guest accounts with beta session access
    const hostReg = await userStore.register({
      username: 'shutdown_host',
      email: 'host@shutdown.com',
      password: 'Password123!',
      displayName: 'Shutdown Host'
    });
    userStore.setSessionAccess(hostReg.user.id, 'beta');

    const guestReg = await userStore.register({
      username: 'shutdown_guest',
      email: 'guest@shutdown.com',
      password: 'Password123!',
      displayName: 'Shutdown Guest'
    });
    userStore.setSessionAccess(guestReg.user.id, 'beta');

    // Connect host and guest Socket.IO clients
    const hostSocket: ClientSocket = ioc(url, { transports: ['websocket'] });
    const guestSocket: ClientSocket = ioc(url, { transports: ['websocket'] });

    await Promise.all([
      new Promise<void>((resolve) => hostSocket.on('connect', () => resolve())),
      new Promise<void>((resolve) => guestSocket.on('connect', () => resolve()))
    ]);

    const media = {
      audioSources: [{ id: 'primary', purpose: 'primary' as const, mode: 'music' as const, enabled: true, channels: 2 }],
      cameraEnabled: true
    };

    // Host creates meeting
    const hostAck = await new Promise<any>((resolve) => {
      hostSocket.emit('meeting:create', {
        participantId: '11111111-1111-4111-8111-111111111111',
        authToken: hostReg.token,
        media
      }, resolve);
    });
    expect(hostAck.ok).toBe(true);

    // Guest joins meeting
    const guestAck = await new Promise<any>((resolve) => {
      guestSocket.emit('meeting:join', {
        code: hostAck.code,
        participantId: '22222222-2222-4222-8222-222222222222',
        authToken: guestReg.token,
        media
      }, resolve);
    });
    expect(guestAck.ok).toBe(true);

    // Verify session is actively alive in RoomStore
    expect(rooms.rooms.size).toBe(1);
    expect(rooms.rooms.get(hostAck.code)?.participants.size).toBe(2);

    // Trigger graceful shutdown while both clients are inside the live session
    const closePromise = app.close();

    // Verify shutdown resolves cleanly without hanging
    await expect(closePromise).resolves.not.toThrow();

    // Both sockets must be disconnected
    expect(hostSocket.connected).toBe(false);
    expect(guestSocket.connected).toBe(false);

    // Rooms and grace timers must be cleared
    expect(rooms.rooms.size).toBe(0);

    // Lock and runtime file must be released
    expect(fs.existsSync(lockPath)).toBe(false);
    expect(fs.existsSync(getAdminRuntimeFilePath(testDir))).toBe(false);

    hostSocket.disconnect();
    guestSocket.disconnect();
  });
});
