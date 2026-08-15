import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { UserStore } from './auth.js';

describe('UserStore & Password Hashing', () => {
  const testDir = path.join(process.cwd(), 'data', 'test-auth');

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
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

    expect(updated.displayName).toBe('Mike Shredder');
    expect(updated.role).toBe('Lead Guitarist & Producer');
    expect(updated.location).toBe('Tel Aviv, Israel');
    expect(updated.primaryDaw).toBe('Logic Pro');
    expect(updated.genres).toEqual(['Rock', 'Blues', 'Metal']);
    expect(updated.avatarColor).toBe('#ec4899');

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
});
