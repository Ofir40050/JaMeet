import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UserStore } from './auth.js';
import {
  updateAccountSessionAccess,
  parseCliArgs,
  runCli,
  ALLOWED_SESSION_ACCESS_STATES
} from './admin-access.js';

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

  it('executes runCli successfully and handles error cases cleanly', async () => {
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
      // 1. Success execution
      const exitCode1 = await runCli(['cli_artist', 'beta', '--data-dir', testDir]);
      expect(exitCode1).toBe(0);
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Updated session access successfully'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('cli_artist@example.com'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Previous Access: blocked'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('New Access: beta'));

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
});
