import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UserStore, type StoredSessionRecord, type StoredScheduledSession } from './auth.js';
import type { FactualSessionSummary } from '@jameet/shared';

describe('UserStore & Password Hashing', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-auth-test-'));
  });

  afterEach(() => {
    if (testDir && fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('registers a new user and returns a profile and token', async () => {
    const store = new UserStore(testDir);
    const result = await store.register({
      username: 'producer_dan',
      email: 'dan@example.com',
      password: 'SuperSecretPassword123!',
      displayName: 'Dan Beats'
    });

    expect(result.token).toBeDefined();
    expect(result.user.username).toBe('producer_dan');
    expect(result.user.displayName).toBe('Dan Beats');
    expect(result.user.email).toBe('dan@example.com');
    expect(result.user.isGuest).toBe(false);
  });

  it('rejects duplicate usernames or emails', async () => {
    const store = new UserStore(testDir);
    await store.register({
      username: 'producer_dan',
      email: 'dan@example.com',
      password: 'Password123!',
      displayName: 'Dan'
    });

    await expect(store.register({
      username: 'producer_dan',
      email: 'different@example.com',
      password: 'Password123!',
      displayName: 'Dan 2'
    })).rejects.toThrow(/already taken/i);

    await expect(store.register({
      username: 'other_user',
      email: 'dan@example.com',
      password: 'Password123!',
      displayName: 'Dan 3'
    })).rejects.toThrow(/already exists/i);
  });

  it('authenticates user with login and verifies password with scrypt', async () => {
    const store = new UserStore(testDir);
    await store.register({
      username: 'producer_dan',
      email: 'dan@example.com',
      password: 'MyRealPassword99!',
      displayName: 'Dan'
    });

    const loginRes = await store.login({
      usernameOrEmail: 'dan@example.com',
      password: 'MyRealPassword99!'
    });
    expect(loginRes.token).toBeDefined();
    expect(loginRes.user.username).toBe('producer_dan');

    await expect(store.login({
      usernameOrEmail: 'dan@example.com',
      password: 'WrongPassword!'
    })).rejects.toThrow(/invalid/i);
  });

  it('persists accounts across server restart', async () => {
    const store1 = new UserStore(testDir);
    const reg = await store1.register({
      username: 'persistent_user',
      email: 'persist@example.com',
      password: 'SecretPassword123!',
      displayName: 'Persistent Musician'
    });

    // Reinstantiate from same directory
    const store2 = new UserStore(testDir);
    const verified = store2.verifyToken(reg.token);
    expect(verified).not.toBeNull();
    expect(verified?.username).toBe('persistent_user');
    expect(verified?.displayName).toBe('Persistent Musician');
  });

  it('creates guest identity properly', () => {
    const store = new UserStore(testDir);
    const guest = store.createGuestIdentity('Alex Keys');
    expect(guest.isGuest).toBe(true);
    expect(guest.displayName).toBe('Alex Keys');
    expect(guest.isHost).toBe(false);
  });

  it('records session history for registered accounts and pairs collaborators', async () => {
    const store = new UserStore(testDir);
    const hostUser = await store.register({
      username: 'host_dan',
      email: 'host@music.com',
      password: 'Password123!',
      displayName: 'Dan Host'
    });
    const peerUser = await store.register({
      username: 'sarah_vocals',
      email: 'sarah@music.com',
      password: 'Password123!',
      displayName: 'Sarah Vocals'
    });

    const hostIdentity = store.getTrustedIdentity(hostUser.token, undefined, true);
    const peerIdentity = store.getTrustedIdentity(peerUser.token, undefined, false);

    store.recordSessionStart('ABC1DEF2', hostUser.user.id, 'host', null);
    store.recordCollaboratorJoined('ABC1DEF2', hostIdentity, peerIdentity);
    store.recordSessionClose('ABC1DEF2');

    const hostHistory = store.getSessionHistory(hostUser.user.id);
    expect(hostHistory.length).toBe(1);
    expect(hostHistory[0]?.code).toBe('ABC1DEF2');
    expect(hostHistory[0]?.role).toBe('host');
    expect(hostHistory[0]?.collaborator?.displayName).toBe('Sarah Vocals');
    expect(hostHistory[0]?.collaborator?.username).toBe('sarah_vocals');
    expect(hostHistory[0]?.durationSeconds).toBeDefined();

    const peerHistory = store.getSessionHistory(peerUser.user.id);
    expect(peerHistory.length).toBe(1);
    expect(peerHistory[0]?.role).toBe('participant');
    expect(peerHistory[0]?.collaborator?.displayName).toBe('Dan Host');
  });

  it('updates profile fields and password securely', async () => {
    const store = new UserStore(testDir);
    const reg = await store.register({
      username: 'guitarist_mike',
      email: 'mike@guitar.com',
      password: 'OldPassword123!',
      displayName: 'Mike'
    });

    const updated = await store.updateProfile(reg.user.id, {
      displayName: 'Mike Shredder',
      role: 'Lead Guitarist & Producer',
      location: 'Tel Aviv, Israel',
      primaryDaw: 'Logic Pro',
      bio: 'Session guitarist and rock producer.',
      genres: ['Rock', 'Blues', 'Metal'],
      avatarColor: '#ec4899',
      currentPassword: 'OldPassword123!',
      newPassword: 'NewStrongPassword99!'
    });

    expect(updated.user.displayName).toBe('Mike Shredder');
    expect(updated.user.role).toBe('Lead Guitarist & Producer');
    expect(updated.user.location).toBe('Tel Aviv, Israel');
    expect(updated.user.primaryDaw).toBe('Logic Pro');
    expect(updated.user.genres).toEqual(['Rock', 'Blues', 'Metal']);
    expect(updated.user.avatarColor).toBe('#ec4899');
    expect(updated.token).toBeDefined();
    expect(store.verifyToken(updated.token)).not.toBeNull();

    // Verify login with new password succeeds and old password fails
    await expect(store.login({
      usernameOrEmail: 'guitarist_mike',
      password: 'OldPassword123!'
    })).rejects.toThrow(/invalid/i);

    const newLogin = await store.login({
      usernameOrEmail: 'guitarist_mike',
      password: 'NewStrongPassword99!'
    });
    expect(newLogin.user.displayName).toBe('Mike Shredder');
    expect(newLogin.user.role).toBe('Lead Guitarist & Producer');
  });

  it('creates, lists, updates, and deletes scheduled sessions with persistence', async () => {
    const store1 = new UserStore(testDir);
    const reg = await store1.register({
      username: 'arranger_sarah',
      email: 'sarah@music.com',
      password: 'StrongPassword123!',
      displayName: 'Sarah Arranger'
    });

    const nowIso = new Date(Date.now() + 86400000).toISOString();
    const futureIso = new Date(Date.now() + 172800000).toISOString();

    // 1. Create scheduled session
    const created = store1.createScheduledSession(reg.user.id, 'Vocal Tracking Session', nowIso);
    expect(created.id).toBeDefined();
    expect(created.userId).toBe(reg.user.id);
    expect(created.title).toBe('Vocal Tracking Session');
    expect(created.scheduledAt).toBe(nowIso);

    // 2. List scheduled sessions
    const list1 = store1.listScheduledSessions(reg.user.id);
    expect(list1.length).toBe(1);
    expect(list1[0]?.title).toBe('Vocal Tracking Session');

    // 3. Persist and reload in store2
    const store2 = new UserStore(testDir);
    const list2 = store2.listScheduledSessions(reg.user.id);
    expect(list2.length).toBe(1);
    expect(list2[0]?.id).toBe(created.id);

    // 4. Update scheduled session
    const updated = store2.updateScheduledSession(reg.user.id, created.id, {
      title: 'Vocal & Strings Session',
      scheduledAt: futureIso
    });
    expect(updated).not.toBeNull();
    expect(updated?.title).toBe('Vocal & Strings Session');
    expect(updated?.scheduledAt).toBe(futureIso);

    // 5. Delete scheduled session
    const deleted = store2.deleteScheduledSession(reg.user.id, created.id);
    expect(deleted).toBe(true);
    expect(store2.listScheduledSessions(reg.user.id).length).toBe(0);
  });

  it('retains session history predictably per user without other users evicting it', async () => {
    const store1 = new UserStore(testDir);
    const userA = await store1.register({
      username: 'artist_a',
      email: 'a@music.com',
      password: 'Password123!',
      displayName: 'Artist A'
    });
    const userB = await store1.register({
      username: 'artist_b',
      email: 'b@music.com',
      password: 'Password123!',
      displayName: 'Artist B'
    });

    // User A records 5 sessions with distinct chronological timestamps
    for (let i = 1; i <= 5; i++) {
      const rec = store1.recordSessionStart(`SES_A_${i}`, `CODEA${i}`, userA.user.id, 'host', null);
      rec.startedAt = 1000000 + i * 1000;
      store1.recordSessionClose(`SES_A_${i}`);
    }

    const historyAInitial = store1.getSessionHistory(userA.user.id);
    expect(historyAInitial.length).toBe(5);

    // User B records 70 sessions (exceeding MAX_SESSIONS_PER_USER = 50)
    for (let i = 1; i <= 70; i++) {
      const rec = store1.recordSessionStart(`SES_B_${i}`, `CODEB${i}`, userB.user.id, 'host', null);
      rec.startedAt = 2000000 + i * 1000;
      store1.recordSessionClose(`SES_B_${i}`);
    }

    // Verify User A's session history is still completely intact in memory
    const historyAAfterB = store1.getSessionHistory(userA.user.id);
    expect(historyAAfterB.length).toBe(5);
    expect(historyAAfterB.map((s) => s.sessionId)).toEqual([
      'SES_A_5', 'SES_A_4', 'SES_A_3', 'SES_A_2', 'SES_A_1'
    ]);

    // Verify User B's sessions are capped at 50
    const historyB = store1.getSessionHistory(userB.user.id);
    expect(historyB.length).toBe(50);
    // User B's newest sessions should be retained (70 down to 21)
    expect(historyB[0]?.sessionId).toBe('SES_B_70');
    expect(historyB[49]?.sessionId).toBe('SES_B_21');

    // Reload from disk into a fresh UserStore instance
    const store2 = new UserStore(testDir);
    const persistedA = store2.getSessionHistory(userA.user.id);
    expect(persistedA.length).toBe(5);
    expect(persistedA.map((s) => s.sessionId)).toEqual([
      'SES_A_5', 'SES_A_4', 'SES_A_3', 'SES_A_2', 'SES_A_1'
    ]);

    const persistedB = store2.getSessionHistory(userB.user.id);
    expect(persistedB.length).toBe(50);
    expect(persistedB[0]?.sessionId).toBe('SES_B_70');
    expect(persistedB[49]?.sessionId).toBe('SES_B_21');
  });

  it('fails and rolls back in-memory state when persistence write fails', async () => {
    // Point store to a path where data file cannot be created (e.g., inside an existing regular file)
    const blockerFile = path.join(testDir, 'blocker');
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(blockerFile, 'file blocking directory creation');
    const unwritableDir = path.join(blockerFile, 'sub');

    const store = new UserStore(unwritableDir);

    // 1. register should throw on persistence failure and not retain user in memory
    await expect(store.register({
      username: 'fail_user',
      email: 'fail@example.com',
      password: 'Password123!',
      displayName: 'Fail User'
    })).rejects.toThrow();

    expect(store.findByUsernameOrEmail('fail_user')).toBeNull();
    expect(store.findByUsernameOrEmail('fail@example.com')).toBeNull();

    // Now test with a writable store where we later break write permissions or mock write failure
    const writableStore = new UserStore(testDir);
    const reg = await writableStore.register({
      username: 'valid_user',
      email: 'valid@example.com',
      password: 'Password123!',
      displayName: 'Valid User'
    });

    // Make the data file unwritable by creating a directory with the tmp file name or making target directory read-only
    const dataFilePath = (writableStore as any).dataFilePath;
    // Replace dataFilePath with an invalid path that cannot be written
    (writableStore as any).dataFilePath = path.join(blockerFile, 'sub', 'jameet-accounts.json');

    // 2. updateProfile should throw and revert profile fields
    const prevDisplayName = reg.user.displayName;
    await expect(writableStore.updateProfile(reg.user.id, {
      displayName: 'Hacked Name'
    })).rejects.toThrow();
    const profileAfterFail = writableStore.findByUsernameOrEmail('valid_user');
    expect(profileAfterFail?.displayName).toBe(prevDisplayName);

    // 3. createScheduledSession should throw and not retain session
    await expect(async () => {
      writableStore.createScheduledSession(reg.user.id, 'Ghost Session', new Date().toISOString());
    }).rejects.toThrow();
    expect(writableStore.listScheduledSessions(reg.user.id).length).toBe(0);
  });

  it('revokes tokens upon explicit revocation and persists revocation across restarts', async () => {
    const store1 = new UserStore(testDir);
    const reg = await store1.register({
      username: 'logout_user',
      email: 'logout@music.com',
      password: 'Password123!',
      displayName: 'Logout User'
    });

    expect(store1.verifyToken(reg.token)).not.toBeNull();

    const revoked = store1.revokeToken(reg.token);
    expect(revoked).toBe(true);
    expect(store1.verifyToken(reg.token)).toBeNull();

    // Revoking non-existent token returns false
    expect(store1.revokeToken('non-existent-token')).toBe(false);

    // Reinstantiate from disk and verify token is still revoked
    const store2 = new UserStore(testDir);
    expect(store2.verifyToken(reg.token)).toBeNull();
  });

  it('invalidates all prior tokens upon password change and preserves new logins across restarts', async () => {
    const store1 = new UserStore(testDir);
    const reg = await store1.register({
      username: 'pwd_user',
      email: 'pwd@music.com',
      password: 'InitialPassword123!',
      displayName: 'Password User'
    });
    const token1 = reg.token;

    // Login a second time to simulate a second device/session
    const login1 = await store1.login({
      usernameOrEmail: 'pwd_user',
      password: 'InitialPassword123!'
    });
    const token2 = login1.token;

    expect(store1.verifyToken(token1)).not.toBeNull();
    expect(store1.verifyToken(token2)).not.toBeNull();

    // Change password
    const { token: newSessionToken } = await store1.updateProfile(reg.user.id, {
      currentPassword: 'InitialPassword123!',
      newPassword: 'BrandNewPassword99!'
    });
    expect(newSessionToken).toBeDefined();
    expect(store1.verifyToken(newSessionToken)).not.toBeNull();

    // All prior tokens must be invalid
    expect(store1.verifyToken(token1)).toBeNull();
    expect(store1.verifyToken(token2)).toBeNull();

    // New login succeeds and issues a new valid token
    const loginAfterPwd = await store1.login({
      usernameOrEmail: 'pwd_user',
      password: 'BrandNewPassword99!'
    });
    const token3 = loginAfterPwd.token;
    expect(store1.verifyToken(token3)).not.toBeNull();

    // Restart server and ensure old tokens remain invalid and token3 and newSessionToken remain valid
    const store2 = new UserStore(testDir);
    expect(store2.verifyToken(token1)).toBeNull();
    expect(store2.verifyToken(token2)).toBeNull();
    expect(store2.verifyToken(newSessionToken)).not.toBeNull();
    expect(store2.verifyToken(token3)).not.toBeNull();
    expect(store2.verifyToken(token3)?.username).toBe('pwd_user');
  });

  it('guarantees username uniqueness under concurrent registration race conditions (case insensitive)', async () => {
    const store = new UserStore(testDir);

    const [res1, res2] = await Promise.allSettled([
      store.register({
        username: 'Concurrent_Dan',
        email: 'dan1@music.com',
        password: 'Password123!',
        displayName: 'Dan 1'
      }),
      store.register({
        username: 'concurrent_dan',
        email: 'dan2@music.com',
        password: 'Password123!',
        displayName: 'Dan 2'
      })
    ]);

    const successes = [res1, res2].filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    const failures = [res1, res2].filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    expect(failures[0].reason.message).toMatch(/already taken/i);

    // Exactly the winning user exists in store
    const winningUser = store.findByUsernameOrEmail('concurrent_dan');
    expect(winningUser).not.toBeNull();
    expect(winningUser?.username.toLowerCase()).toBe('concurrent_dan');
  });

  it('guarantees email uniqueness under concurrent registration race conditions (case insensitive)', async () => {
    const store = new UserStore(testDir);

    const [res1, res2] = await Promise.allSettled([
      store.register({
        username: 'user_first',
        email: 'CommonEmail@Music.com',
        password: 'Password123!',
        displayName: 'User 1'
      }),
      store.register({
        username: 'user_second',
        email: 'commonemail@music.com',
        password: 'Password123!',
        displayName: 'User 2'
      })
    ]);

    const successes = [res1, res2].filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    const failures = [res1, res2].filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    expect(failures[0].reason.message).toMatch(/already exists/i);

    // Exactly the winning user exists in store
    const winningUser = store.findByUsernameOrEmail('commonemail@music.com');
    expect(winningUser).not.toBeNull();
    expect(winningUser?.email.toLowerCase()).toBe('commonemail@music.com');
  });

  it('allows exactly 1 registration to succeed among N concurrent identical requests', async () => {
    const store = new UserStore(testDir);

    const promises = Array.from({ length: 6 }).map((_, idx) =>
      store.register({
        username: 'race_dan',
        email: `race_${idx}@music.com`,
        password: 'Password123!',
        displayName: `Race Dan ${idx}`
      })
    );

    const results = await Promise.allSettled(promises);
    const successes = results.filter((r) => r.status === 'fulfilled');
    const failures = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(5);
    for (const fail of failures) {
      expect(fail.reason.message).toMatch(/already taken/i);
    }
  });

  it('releases temporary reservation when persistence fails, allowing subsequent registrations to succeed on the same UserStore instance', async () => {
    const blockerFile = path.join(testDir, 'blocker');
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(blockerFile, 'file blocking directory creation');

    const store = new UserStore(testDir);
    const validDataFilePath = (store as any).dataFilePath;

    // Temporarily point dataFilePath to an unwritable path to simulate persistence failure
    (store as any).dataFilePath = path.join(blockerFile, 'sub', 'jameet-accounts.json');

    // Attempt registration which fails at persistence
    await expect(store.register({
      username: 'temp_user',
      email: 'temp@music.com',
      password: 'Password123!',
      displayName: 'Temp User'
    })).rejects.toThrow();

    // In-memory indices and reservations must be clean
    expect(store.findByUsernameOrEmail('temp_user')).toBeNull();
    expect(store.findByUsernameOrEmail('temp@music.com')).toBeNull();

    // Restore writable dataFilePath on the EXACT SAME UserStore instance
    (store as any).dataFilePath = validDataFilePath;

    // Registering the same username and email on the same store instance now succeeds
    const successResult = await store.register({
      username: 'temp_user',
      email: 'temp@music.com',
      password: 'Password123!',
      displayName: 'Temp User'
    });

    expect(successResult.user.username).toBe('temp_user');
    expect(successResult.user.email).toBe('temp@music.com');
  });

  it('preserves in-flight registration reservations across unrelated restoreSnapshot rollback calls', async () => {
    const store = new UserStore(testDir);
    const snapshot = store.createSnapshot();

    // Start registration 1 (which hashes password asynchronously)
    const regPromise1 = store.register({
      username: 'inflight_user',
      email: 'inflight@music.com',
      password: 'Password123!',
      displayName: 'In Flight 1'
    });

    // Unrelated rollback occurs while regPromise1 is in flight
    store.restoreSnapshot(snapshot);

    // Concurrent conflicting registration arrives after restoreSnapshot but while regPromise1 is still in flight
    await expect(store.register({
      username: 'INFLIGHT_USER',
      email: 'other@music.com',
      password: 'Password123!',
      displayName: 'In Flight 2'
    })).rejects.toThrow(/already taken/i);

    // Initial in-flight registration completes successfully
    const result1 = await regPromise1;
    expect(result1.user.username).toBe('inflight_user');
    expect(store.findByUsernameOrEmail('inflight_user')).not.toBeNull();
  });

  it('finalizes a single participant record and prevents subsequent room closure from modifying it', async () => {
    const store = new UserStore(testDir);
    const hostUser = await store.register({
      username: 'host_early',
      email: 'host_early@music.com',
      password: 'Password123!',
      displayName: 'Host Early'
    });
    const guestUser = await store.register({
      username: 'guest_early',
      email: 'guest_early@music.com',
      password: 'Password123!',
      displayName: 'Guest Early'
    });

    const hostIdentity = store.getTrustedIdentity(hostUser.token, undefined, true);
    const guestIdentity = store.getTrustedIdentity(guestUser.token, undefined, false);

    const sessionId = 'SES_FINAL_123';
    const code = 'EARLY123';

    store.recordSessionStart(sessionId, code, hostUser.user.id, 'host', null);
    store.recordCollaboratorJoined(sessionId, code, hostIdentity, guestIdentity);

    // Initial event when guest is present
    const event1 = {
      id: 'ev_1',
      timestamp: 1000,
      category: 'task' as const,
      action: 'created',
      description: 'Initial task'
    };

    // Guest leaves at t=5000
    store.recordSessionClose(sessionId, {
      code,
      startedAt: 0,
      allJoinedParticipants: new Map([
        [hostUser.user.id, hostIdentity],
        [guestUser.user.id, guestIdentity]
      ]),
      chatMessagesCount: 2,
      events: [event1]
    }, guestUser.user.id);

    const guestHistoryAfterLeave = store.getSessionHistory(guestUser.user.id);
    expect(guestHistoryAfterLeave.length).toBe(1);
    expect(guestHistoryAfterLeave[0]?.endedAt).toBeDefined();
    const guestEndedAt = guestHistoryAfterLeave[0]?.endedAt;
    const guestDuration = guestHistoryAfterLeave[0]?.durationSeconds;
    expect(guestHistoryAfterLeave[0]?.summary?.events.length).toBe(1);
    expect(guestHistoryAfterLeave[0]?.summary?.chatMessagesCount).toBe(2);

    // Host session is still active (not ended yet)
    const hostHistoryActive = store.getSessionHistory(hostUser.user.id);
    expect(hostHistoryActive[0]?.endedAt).toBeUndefined();

    // Later room activity occurs at t=10000
    const event2 = {
      id: 'ev_2',
      timestamp: 8000,
      category: 'note' as const,
      action: 'created',
      description: 'Later note after guest left'
    };

    // Host closes room at t=12000
    store.recordSessionClose(sessionId, {
      code,
      startedAt: 0,
      allJoinedParticipants: new Map([
        [hostUser.user.id, hostIdentity],
        [guestUser.user.id, guestIdentity]
      ]),
      chatMessagesCount: 10,
      events: [event1, event2]
    });

    // Verify guest history was completely protected
    const guestHistoryFinal = store.getSessionHistory(guestUser.user.id);
    expect(guestHistoryFinal[0]?.endedAt).toBe(guestEndedAt);
    expect(guestHistoryFinal[0]?.durationSeconds).toBe(guestDuration);
    expect(guestHistoryFinal[0]?.summary?.events.length).toBe(1);
    expect(guestHistoryFinal[0]?.summary?.events[0]?.id).toBe('ev_1');
    expect(guestHistoryFinal[0]?.summary?.chatMessagesCount).toBe(2);

    // Verify host history was finalized with full room activity
    const hostHistoryFinal = store.getSessionHistory(hostUser.user.id);
    expect(hostHistoryFinal[0]?.endedAt).toBeDefined();
    expect(hostHistoryFinal[0]?.summary?.events.length).toBe(2);
    expect(hostHistoryFinal[0]?.summary?.chatMessagesCount).toBe(10);
  });
});

describe('Session Access State & Centralized Authorization', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-access-test-'));
  });

  afterEach(() => {
    if (testDir && fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('defaults newly registered accounts to blocked sessionAccess', async () => {
    const store = new UserStore(testDir);
    const reg = await store.register({
      username: 'new_artist',
      email: 'artist@example.com',
      password: 'StrongPassword123!',
      displayName: 'New Artist'
    });

    const stored = store.getStoredUser(reg.user.id);
    expect(stored).not.toBeNull();
    expect(stored?.sessionAccess).toBe('blocked');
  });

  it('safely migrates existing stored accounts without sessionAccess to beta on load', async () => {
    const dataFilePath = path.join(testDir, 'jameet-accounts.json');
    const legacyData = {
      version: 1,
      users: [
        {
          id: 'user-legacy-1',
          username: 'legacy_user',
          email: 'legacy@example.com',
          displayName: 'Legacy Musician',
          passwordHash: 'salt:hash',
          avatarColor: '#06b6d4',
          createdAt: 1000,
          updatedAt: 1000,
          sessionsHostedCount: 0
        }
      ],
      tokens: [],
      sessions: []
    };
    fs.writeFileSync(dataFilePath, JSON.stringify(legacyData, null, 2), 'utf-8');

    const store = new UserStore(testDir);
    const stored = store.getStoredUser('user-legacy-1');
    expect(stored).not.toBeNull();
    expect(stored?.sessionAccess).toBe('beta');

    // Verify migration was saved to disk
    const saved = JSON.parse(fs.readFileSync(dataFilePath, 'utf-8'));
    expect(saved.users[0]?.sessionAccess).toBe('beta');
  });

  it('allows updating sessionAccess via setSessionAccess and persists changes', async () => {
    const store = new UserStore(testDir);
    const reg = await store.register({
      username: 'upgraded_user',
      email: 'upgraded@example.com',
      password: 'StrongPassword123!',
      displayName: 'Upgraded User'
    });

    expect(store.getStoredUser(reg.user.id)?.sessionAccess).toBe('blocked');
    const updated = store.setSessionAccess(reg.user.id, 'paid');
    expect(updated).toBe(true);
    expect(store.getStoredUser(reg.user.id)?.sessionAccess).toBe('paid');

    // Reinstantiate to verify persistence
    const store2 = new UserStore(testDir);
    expect(store2.getStoredUser(reg.user.id)?.sessionAccess).toBe('paid');
  });

  it('denies unauthenticated or invalid tokens with AUTH_REQUIRED', async () => {
    const store = new UserStore(testDir);
    const { loadConfig } = await import('../core/config.js');
    const { authorizeSessionAccess } = await import('./auth.js');
    const config = loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'test-secret-at-least-16-chars' });

    expect(authorizeSessionAccess(store, undefined, config, true)).toEqual({
      ok: false,
      code: 'AUTH_REQUIRED',
      message: 'Authentication required to create or join a session.'
    });

    expect(authorizeSessionAccess(store, '', config, true)).toEqual({
      ok: false,
      code: 'AUTH_REQUIRED',
      message: 'Authentication required to create or join a session.'
    });

    expect(authorizeSessionAccess(store, 'invalid-random-token', config, false)).toEqual({
      ok: false,
      code: 'AUTH_REQUIRED',
      message: 'Authentication required to create or join a session.'
    });
  });

  it('denies blocked users with ACCESS_DENIED', async () => {
    const store = new UserStore(testDir);
    const { loadConfig } = await import('../core/config.js');
    const { authorizeSessionAccess } = await import('./auth.js');
    const config = loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'test-secret-at-least-16-chars' });

    const reg = await store.register({
      username: 'blocked_user',
      email: 'blocked@example.com',
      password: 'Password123!',
      displayName: 'Blocked Musician'
    });
    // New accounts default to blocked

    const result = authorizeSessionAccess(store, reg.token, config, true);
    expect(result).toEqual({
      ok: false,
      code: 'ACCESS_DENIED',
      message: 'Your account does not currently have access to JaMeet sessions.'
    });
  });

  it('denies unsupported or malformed sessionAccess values with ACCESS_DENIED (fail closed)', async () => {
    const store = new UserStore(testDir);
    const { loadConfig } = await import('../core/config.js');
    const { authorizeSessionAccess } = await import('./auth.js');
    const config = loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'test-secret-at-least-16-chars' });

    const reg = await store.register({
      username: 'malformed_user',
      email: 'malformed@example.com',
      password: 'Password123!',
      displayName: 'Malformed Musician'
    });
    store.setSessionAccess(reg.user.id, 'unsupported_state' as any);

    const result = authorizeSessionAccess(store, reg.token, config, true);
    expect(result).toEqual({
      ok: false,
      code: 'ACCESS_DENIED',
      message: 'Your account does not currently have access to JaMeet sessions.'
    });
  });

  it('authorizes active beta users when BETA_END_AT is unset', async () => {
    const store = new UserStore(testDir);
    const { loadConfig } = await import('../core/config.js');
    const { authorizeSessionAccess } = await import('./auth.js');
    const config = loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'test-secret-at-least-16-chars' });

    const reg = await store.register({
      username: 'beta_user',
      email: 'beta@example.com',
      password: 'Password123!',
      displayName: 'Beta Musician'
    });
    store.setSessionAccess(reg.user.id, 'beta');

    const result = authorizeSessionAccess(store, reg.token, config, true);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.username).toBe('beta_user');
      expect(result.identity.isGuest).toBe(false);
      expect(result.identity.isHost).toBe(true);
      expect(result.identity.displayName).toBe('Beta Musician');
    }
  });

  it('authorizes beta users before BETA_END_AT and denies them with BETA_ENDED after expiration', async () => {
    const store = new UserStore(testDir);
    const { loadConfig } = await import('../core/config.js');
    const { authorizeSessionAccess } = await import('./auth.js');
    const betaEndIso = '2026-12-31T23:59:59Z';
    const config = loadConfig({
      NODE_ENV: 'test',
      TURN_SHARED_SECRET: 'test-secret-at-least-16-chars',
      BETA_END_AT: betaEndIso
    });
    const betaEndMs = Date.parse(betaEndIso);

    const reg = await store.register({
      username: 'beta_user_timer',
      email: 'timer@example.com',
      password: 'Password123!',
      displayName: 'Timer Musician'
    });
    store.setSessionAccess(reg.user.id, 'beta');

    // Before expiration
    const beforeResult = authorizeSessionAccess(store, reg.token, config, true, betaEndMs - 1000);
    expect(beforeResult.ok).toBe(true);

    // At expiration
    const atResult = authorizeSessionAccess(store, reg.token, config, true, betaEndMs);
    expect(atResult).toEqual({
      ok: false,
      code: 'BETA_ENDED',
      message: 'JaMeet Beta has ended. A JaMeet subscription will be required to continue creating or joining sessions.'
    });

    // After expiration
    const afterResult = authorizeSessionAccess(store, reg.token, config, false, betaEndMs + 5000);
    expect(afterResult).toEqual({
      ok: false,
      code: 'BETA_ENDED',
      message: 'JaMeet Beta has ended. A JaMeet subscription will be required to continue creating or joining sessions.'
    });
  });

  it('authorizes paid users even when BETA_END_AT is expired', async () => {
    const store = new UserStore(testDir);
    const { loadConfig } = await import('../core/config.js');
    const { authorizeSessionAccess } = await import('./auth.js');
    const betaEndIso = '2026-01-01T00:00:00Z';
    const config = loadConfig({
      NODE_ENV: 'test',
      TURN_SHARED_SECRET: 'test-secret-at-least-16-chars',
      BETA_END_AT: betaEndIso
    });
    const now = Date.parse('2026-06-01T12:00:00Z');

    const reg = await store.register({
      username: 'paid_user',
      email: 'paid@example.com',
      password: 'Password123!',
      displayName: 'Paid Subscriber'
    });
    store.setSessionAccess(reg.user.id, 'paid');

    const result = authorizeSessionAccess(store, reg.token, config, false, now);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.user.username).toBe('paid_user');
      expect(result.identity.isGuest).toBe(false);
      expect(result.identity.isHost).toBe(false);
    }
  });

  it('validates ISO 8601 with timezone and rejects invalid or ambiguous formats in loadConfig', async () => {
    const { loadConfig } = await import('../core/config.js');

    // Valid formats
    expect(() => loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'secret-123456789012', BETA_END_AT: '2026-12-31T23:59:59Z' })).not.toThrow();
    expect(() => loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'secret-123456789012', BETA_END_AT: '2026-12-31T23:59:59.123Z' })).not.toThrow();
    expect(() => loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'secret-123456789012', BETA_END_AT: '2026-12-31T18:00:00-05:00' })).not.toThrow();
    expect(() => loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'secret-123456789012', BETA_END_AT: '2026-12-31T23:59:59+02:00' })).not.toThrow();
    // Valid leap year timestamp
    expect(() => loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'secret-123456789012', BETA_END_AT: '2024-02-29T23:59:59Z' })).not.toThrow();

    // Invalid formats: date-only
    expect(() => loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'secret-123456789012', BETA_END_AT: '2026-12-31' })).toThrow(/BETA_END_AT/i);

    // Invalid formats: local time without timezone
    expect(() => loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'secret-123456789012', BETA_END_AT: '2026-12-31T23:59:59' })).toThrow(/BETA_END_AT/i);

    // Invalid formats: numeric epoch
    expect(() => loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'secret-123456789012', BETA_END_AT: '1780000000' })).toThrow(/BETA_END_AT/i);

    // Invalid formats: random text
    expect(() => loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'secret-123456789012', BETA_END_AT: 'invalid-date-string' })).toThrow(/BETA_END_AT/i);

    // Invalid formats: impossible calendar dates
    expect(() => loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'secret-123456789012', BETA_END_AT: '2026-02-31T00:00:00Z' })).toThrow(/BETA_END_AT/i);
    expect(() => loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'secret-123456789012', BETA_END_AT: '2025-02-29T00:00:00Z' })).toThrow(/BETA_END_AT/i);
    expect(() => loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'secret-123456789012', BETA_END_AT: '2026-04-31T12:00:00Z' })).toThrow(/BETA_END_AT/i);
    expect(() => loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'secret-123456789012', BETA_END_AT: '2026-06-31T12:00:00Z' })).toThrow(/BETA_END_AT/i);
    expect(() => loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'secret-123456789012', BETA_END_AT: '2026-09-31T12:00:00Z' })).toThrow(/BETA_END_AT/i);
    expect(() => loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'secret-123456789012', BETA_END_AT: '2026-11-31T12:00:00Z' })).toThrow(/BETA_END_AT/i);
    expect(() => loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'secret-123456789012', BETA_END_AT: '2026-13-01T00:00:00Z' })).toThrow(/BETA_END_AT/i);
    expect(() => loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'secret-123456789012', BETA_END_AT: '2026-00-01T00:00:00Z' })).toThrow(/BETA_END_AT/i);
    expect(() => loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'secret-123456789012', BETA_END_AT: '2026-01-00T00:00:00Z' })).toThrow(/BETA_END_AT/i);
    expect(() => loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'secret-123456789012', BETA_END_AT: '2026-01-32T00:00:00Z' })).toThrow(/BETA_END_AT/i);
    expect(() => loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'secret-123456789012', BETA_END_AT: '2026-01-01T24:00:00Z' })).toThrow(/BETA_END_AT/i);
    expect(() => loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'secret-123456789012', BETA_END_AT: '2026-01-01T12:60:00Z' })).toThrow(/BETA_END_AT/i);
    expect(() => loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'secret-123456789012', BETA_END_AT: '2026-01-01T12:00:00+25:00' })).toThrow(/BETA_END_AT/i);
  });

  it('migrates legacy accounts missing sessionAccess to beta and preserves tokens, sessions, and scheduledSessions on disk', async () => {
    fs.mkdirSync(testDir, { recursive: true });
    const accountsPath = path.join(testDir, 'jameet-accounts.json');

    const legacyUser = {
      id: 'legacy-user-1',
      username: 'legacy_user',
      email: 'legacy@example.com',
      passwordHash: 'some_hash',
      displayName: 'Legacy User',
      createdAt: 1000,
      updatedAt: 1000,
      sessionsHostedCount: 5
      // sessionAccess completely missing
    };
    const validToken = {
      token: 'tok-legacy-123',
      userId: 'legacy-user-1',
      createdAt: Date.now() - 1000,
      expiresAt: Date.now() + 1000000
    };
    const sessionSummary: FactualSessionSummary = {
      id: 'sum-legacy-1',
      sessionId: 'ses-legacy-1',
      code: 'ABCD2345',
      startedAt: 5000,
      endedAt: 6000,
      durationSeconds: 1000,
      role: 'host',
      participants: [
        {
          displayName: 'Legacy User',
          username: 'legacy_user',
          isHost: true,
          isGuest: false,
          avatarColor: '#06b6d4'
        },
        {
          displayName: 'Legacy Collaborator',
          username: 'legacy_collab',
          isHost: false,
          isGuest: false,
          avatarColor: '#3b82f6'
        }
      ],
      events: [
        {
          id: 'ev-1',
          timestamp: 5500,
          category: 'task',
          action: 'created',
          description: 'Record acoustic guitar'
        }
      ],
      chatMessagesCount: 3
    };

    const sessionHistory: StoredSessionRecord = {
      id: 'ses-legacy-1',
      sessionId: 'ses-legacy-1',
      code: 'ABCD2345',
      userId: 'legacy-user-1',
      role: 'host',
      startedAt: 5000,
      endedAt: 6000,
      durationSeconds: 1000,
      collaborator: {
        id: 'legacy-collab-1',
        displayName: 'Legacy Collaborator',
        username: 'legacy_collab',
        isGuest: false,
        avatarColor: '#3b82f6'
      },
      summary: sessionSummary
    };
    const scheduledSession: StoredScheduledSession = {
      id: 'sched-legacy-1',
      userId: 'legacy-user-1',
      title: 'Legacy Jam Session',
      scheduledAt: '2026-12-31T20:00:00Z',
      createdAt: 1000,
      updatedAt: 1000
    };

    const initialDb = {
      version: 1,
      users: [legacyUser],
      tokens: [validToken],
      sessions: [sessionHistory],
      scheduledSessions: [scheduledSession]
    };

    fs.writeFileSync(accountsPath, JSON.stringify(initialDb, null, 2), 'utf-8');

    // Instantiate UserStore to trigger loadFromDisk and migration
    const store = new UserStore(testDir);

    // In-memory verification
    const migrated = store.getStoredUser('legacy-user-1');
    expect(migrated?.sessionAccess).toBe('beta');
    expect(store.verifyToken('tok-legacy-123')).not.toBeNull();

    const history = store.getSessionHistory('legacy-user-1');
    expect(history.length).toBe(1);
    expect(history[0]?.id).toBe('ses-legacy-1');
    expect(history[0]?.collaborator?.displayName).toBe('Legacy Collaborator');
    expect(history[0]?.summary).toEqual(sessionSummary);

    const scheduled = store.listScheduledSessions('legacy-user-1');
    expect(scheduled.length).toBe(1);
    expect(scheduled[0]).toEqual({
      id: 'sched-legacy-1',
      userId: 'legacy-user-1',
      title: 'Legacy Jam Session',
      scheduledAt: '2026-12-31T20:00:00Z',
      createdAt: 1000,
      updatedAt: 1000
    });

    // On-disk verification: verify migration was persisted without erasing other collections
    const rawDisk = fs.readFileSync(accountsPath, 'utf-8');
    const diskDb = JSON.parse(rawDisk);
    expect(diskDb.users[0].sessionAccess).toBe('beta');
    expect(diskDb.tokens.length).toBe(1);
    expect(diskDb.tokens[0].token).toBe('tok-legacy-123');
    expect(diskDb.sessions.length).toBe(1);
    expect(diskDb.sessions[0].id).toBe('ses-legacy-1');
    expect(diskDb.sessions[0].collaborator.displayName).toBe('Legacy Collaborator');
    expect(diskDb.sessions[0].summary).toEqual(sessionSummary);
    expect(diskDb.scheduledSessions.length).toBe(1);
    expect(diskDb.scheduledSessions[0]).toEqual({
      id: 'sched-legacy-1',
      userId: 'legacy-user-1',
      title: 'Legacy Jam Session',
      scheduledAt: '2026-12-31T20:00:00Z',
      createdAt: 1000,
      updatedAt: 1000
    });
  });

  it('initializes normally with an empty store when the accounts file does not exist', () => {
    const accountsPath = path.join(testDir, 'jameet-accounts.json');
    expect(fs.existsSync(accountsPath)).toBe(false);

    const store = new UserStore(testDir);
    expect(store.findByUsernameOrEmail('nonexistent')).toBeNull();
  });

  it('fails initialization and stops server startup when an existing accounts file is corrupted or unreadable', () => {
    const accountsPath = path.join(testDir, 'jameet-accounts.json');
    const corruptContent = '{"users": [unparseable corrupted json...';
    fs.writeFileSync(accountsPath, corruptContent, 'utf-8');

    // Must throw rather than silently resetting the database to an empty datastore
    expect(() => new UserStore(testDir)).toThrow(/Failed to load account datastore/i);

    // Verify the corrupted file was preserved untouched
    expect(fs.readFileSync(accountsPath, 'utf-8')).toBe(corruptContent);
  });

  it('fails initialization when the accounts datastore root is not an object or is an array', () => {
    const accountsPath = path.join(testDir, 'jameet-accounts.json');

    fs.writeFileSync(accountsPath, JSON.stringify([]), 'utf-8');
    expect(() => new UserStore(testDir)).toThrow(/root must be an object/i);

    fs.writeFileSync(accountsPath, JSON.stringify('plain-string'), 'utf-8');
    expect(() => new UserStore(testDir)).toThrow(/root must be an object/i);

    fs.writeFileSync(accountsPath, JSON.stringify(12345), 'utf-8');
    expect(() => new UserStore(testDir)).toThrow(/root must be an object/i);

    fs.writeFileSync(accountsPath, JSON.stringify(null), 'utf-8');
    expect(() => new UserStore(testDir)).toThrow(/root must be an object/i);
  });

  it('fails initialization when users or tokens fields are missing or not arrays', () => {
    const accountsPath = path.join(testDir, 'jameet-accounts.json');

    // Missing users
    fs.writeFileSync(accountsPath, JSON.stringify({ tokens: [] }), 'utf-8');
    expect(() => new UserStore(testDir)).toThrow(/'users' field must be an array/i);

    // Invalid users type
    fs.writeFileSync(accountsPath, JSON.stringify({ users: { id: 'bad' }, tokens: [] }), 'utf-8');
    expect(() => new UserStore(testDir)).toThrow(/'users' field must be an array/i);

    // Missing tokens
    fs.writeFileSync(accountsPath, JSON.stringify({ users: [] }), 'utf-8');
    expect(() => new UserStore(testDir)).toThrow(/'tokens' field must be an array/i);

    // Invalid tokens type
    fs.writeFileSync(accountsPath, JSON.stringify({ users: [], tokens: 'not-array' }), 'utf-8');
    expect(() => new UserStore(testDir)).toThrow(/'tokens' field must be an array/i);
  });

  it('fails initialization when optional sessions or scheduledSessions fields are present with invalid types', () => {
    const accountsPath = path.join(testDir, 'jameet-accounts.json');

    // Invalid sessions type
    fs.writeFileSync(accountsPath, JSON.stringify({ users: [], tokens: [], sessions: 'not-an-array' }), 'utf-8');
    expect(() => new UserStore(testDir)).toThrow(/'sessions' field must be an array/i);

    // Invalid scheduledSessions type
    fs.writeFileSync(accountsPath, JSON.stringify({ users: [], tokens: [], scheduledSessions: { id: 'invalid' } }), 'utf-8');
    expect(() => new UserStore(testDir)).toThrow(/'scheduledSessions' field must be an array/i);
  });

  it('loads successfully when accounts datastore has valid top-level structure with or without optional fields', () => {
    const accountsPath = path.join(testDir, 'jameet-accounts.json');

    // Minimal valid structure (sessions and scheduledSessions omitted)
    fs.writeFileSync(accountsPath, JSON.stringify({ users: [], tokens: [] }), 'utf-8');
    const store1 = new UserStore(testDir);
    expect(store1.findByUsernameOrEmail('test')).toBeNull();

    // Full valid structure with empty arrays
    fs.writeFileSync(accountsPath, JSON.stringify({ users: [], tokens: [], sessions: [], scheduledSessions: [] }), 'utf-8');
    const store2 = new UserStore(testDir);
    expect(store2.findByUsernameOrEmail('test')).toBeNull();
  });
});





