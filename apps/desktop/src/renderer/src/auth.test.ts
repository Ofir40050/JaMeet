import { describe, expect, it, beforeEach, vi } from 'vitest';
import { AuthManager } from './auth';

class MockLocalStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

describe('AuthManager', () => {
  let auth: AuthManager;

  beforeEach(() => {
    (globalThis as any).localStorage = new MockLocalStorage();
    auth = new AuthManager('http://localhost:3000');
    vi.restoreAllMocks();
  });

  it('manages guest display name', () => {
    expect(auth.getEffectiveDisplayName()).toBe('Guest Musician');
    auth.setGuestName('Sarah Vocals');
    expect(auth.getGuestName()).toBe('Sarah Vocals');
    expect(auth.getEffectiveDisplayName()).toBe('Sarah Vocals');
  });

  it('handles registration success and notifies listeners', async () => {
    const userProfile = {
      id: 'usr_1',
      username: 'sarah',
      email: 'sarah@music.com',
      displayName: 'Sarah Vocals',
      avatarColor: '#06b6d4',
      createdAt: new Date().toISOString()
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, token: 'jwt_token_123', user: userProfile })
    } as Response);

    let notifiedUser = null;
    auth.onStateChange((u) => { notifiedUser = u; });

    const registered = await auth.register({
      displayName: 'Sarah Vocals',
      username: 'sarah',
      email: 'sarah@music.com',
      password: 'password123'
    });

    expect(registered.username).toBe('sarah');
    expect(auth.getUser()?.displayName).toBe('Sarah Vocals');
    expect(auth.getToken()).toBe('jwt_token_123');
    expect(notifiedUser).toEqual(userProfile);
  });

  it('handles registration failure with server error message', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ ok: false, message: 'Username is already registered.' })
    } as Response);

    await expect(auth.register({
      displayName: 'Sarah Vocals',
      username: 'sarah',
      email: 'sarah@music.com',
      password: 'password123'
    })).rejects.toThrow('Username is already registered.');
  });

  it('logs out and clears session state', async () => {
    const userProfile = {
      id: 'usr_1',
      username: 'sarah',
      email: 'sarah@music.com',
      displayName: 'Sarah Vocals',
      avatarColor: '#06b6d4',
      createdAt: new Date().toISOString()
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, token: 'jwt_token_123', user: userProfile })
    } as Response);

    await auth.login({ usernameOrEmail: 'sarah', password: 'password123' });
    expect(auth.getUser()).not.toBeNull();

    await auth.logout();
    expect(auth.getUser()).toBeNull();
    expect(auth.getToken()).toBeNull();
    expect(global.fetch).toHaveBeenCalledWith('http://localhost:3000/api/auth/logout', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer jwt_token_123'
      }
    });
  });

  it('fetches recent sessions for authenticated user', async () => {
    const userProfile = {
      id: 'usr_1',
      username: 'sarah',
      email: 'sarah@music.com',
      displayName: 'Sarah Vocals',
      avatarColor: '#06b6d4',
      createdAt: new Date().toISOString()
    };

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, token: 'jwt_token_123', user: userProfile })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          sessions: [{
            id: 'usr_1_ABC1DEF2',
            code: 'ABC1DEF2',
            role: 'host',
            startedAt: Date.now(),
            collaborator: { displayName: 'Dan Beats', username: 'dan', isGuest: false }
          }]
        })
      } as Response);

    await auth.login({ usernameOrEmail: 'sarah', password: 'password123' });
    const sessions = await auth.getRecentSessions();
    expect(sessions.length).toBe(1);
    expect(sessions[0]?.code).toBe('ABC1DEF2');
    expect(sessions[0]?.collaborator?.displayName).toBe('Dan Beats');
  });

  it('updates profile and notifies listeners', async () => {
    const initialUser = {
      id: 'usr_1',
      username: 'dan',
      email: 'dan@music.com',
      displayName: 'Dan',
      avatarColor: '#06b6d4',
      createdAt: Date.now()
    };

    const updatedUser = {
      ...initialUser,
      displayName: 'Dan Producer',
      role: 'Music Producer',
      location: 'Tel Aviv',
      primaryDaw: 'Ableton Live'
    };

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, token: 'jwt_token_123', user: initialUser })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, user: updatedUser })
      } as Response);

    await auth.login({ usernameOrEmail: 'dan', password: 'password123' });

    let notifiedDisplayName = '';
    auth.onStateChange((u) => {
      if (u) notifiedDisplayName = u.displayName;
    });

    const res = await auth.updateProfile({
      displayName: 'Dan Producer',
      role: 'Music Producer',
      location: 'Tel Aviv',
      primaryDaw: 'Ableton Live'
    });

    expect(res.displayName).toBe('Dan Producer');
    expect(res.role).toBe('Music Producer');
    expect(auth.getUser()?.displayName).toBe('Dan Producer');
    expect(notifiedDisplayName).toBe('Dan Producer');
  });

  it('updates token and persists session when server returns new token on password change', async () => {
    const initialUser = {
      id: 'usr_1',
      username: 'dan',
      email: 'dan@music.com',
      displayName: 'Dan',
      avatarColor: '#06b6d4',
      createdAt: Date.now()
    };

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, token: 'initial_token_123', user: initialUser })
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, user: initialUser, token: 'post_pwd_token_456' })
      } as Response);

    await auth.login({ usernameOrEmail: 'dan', password: 'oldPassword123!' });
    expect(auth.getToken()).toBe('initial_token_123');

    await auth.updateProfile({
      currentPassword: 'oldPassword123!',
      newPassword: 'newPassword456!'
    });

    expect(auth.getToken()).toBe('post_pwd_token_456');
    expect(auth.getUser()?.username).toBe('dan');
  });

  it('persists guest name only under canonical jameet_guest_name in localStorage', () => {
    localStorage.clear();
    auth.setGuestName('Canonical Artist');
    expect(localStorage.getItem('jameet_guest_name')).toBe('Canonical Artist');
    expect(localStorage.getItem('musiczoom_guest_name')).toBeNull();
  });

  it('loads guest name from legacy musiczoom_guest_name fallback when jameet_guest_name is absent', async () => {
    localStorage.clear();
    localStorage.setItem('musiczoom_guest_name', 'Legacy Musician');
    const legacyAuth = new AuthManager('http://localhost:3000');
    await legacyAuth.init();
    expect(legacyAuth.getGuestName()).toBe('Legacy Musician');
    expect(legacyAuth.getEffectiveDisplayName()).toBe('Legacy Musician');
  });
});
