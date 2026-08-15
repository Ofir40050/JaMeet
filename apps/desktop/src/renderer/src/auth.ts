import type { UserProfile, RegisterRequest, LoginRequest, UpdateProfileRequest, SessionHistoryItem } from '@musiczoom/shared';

export type AuthStateListener = (user: UserProfile | null, guestName?: string) => void;

export class AuthManager {
  private serverUrl: string;
  private currentUser: UserProfile | null = null;
  private currentToken: string | null = null;
  private currentGuestName: string = '';
  private listeners = new Set<AuthStateListener>();

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl.replace(/\/$/, '');
  }

  getUser(): UserProfile | null {
    return this.currentUser;
  }

  getToken(): string | null {
    return this.currentToken;
  }

  getGuestName(): string {
    return this.currentGuestName;
  }

  setGuestName(name: string): void {
    this.currentGuestName = name.trim();
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('musiczoom_guest_name', this.currentGuestName);
      }
    } catch {
      // ignore
    }
    this.notify();
  }

  onStateChange(listener: AuthStateListener): () => void {
    this.listeners.add(listener);
    listener(this.currentUser, this.currentGuestName);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of this.listeners) {
      try {
        l(this.currentUser, this.currentGuestName);
      } catch (err) {
        console.error('Error in auth listener:', err);
      }
    }
  }

  private async persistSession(token: string, user: UserProfile): Promise<void> {
    try {
      if (typeof window !== 'undefined' && window.musiczoom?.auth?.setSession) {
        await window.musiczoom.auth.setSession({ token, user });
      }
    } catch (err) {
      console.warn('Could not persist session via safeStorage:', err);
    }
  }

  private async readPersistedSession(): Promise<{ token?: string; user?: unknown } | null> {
    try {
      if (typeof window !== 'undefined' && window.musiczoom?.auth?.getSession) {
        return await window.musiczoom.auth.getSession();
      }
    } catch (err) {
      console.warn('Could not read persisted session from safeStorage:', err);
    }
    return null;
  }

  private async clearPersistedSession(): Promise<void> {
    try {
      if (typeof window !== 'undefined' && window.musiczoom?.auth?.clearSession) {
        await window.musiczoom.auth.clearSession();
      }
    } catch (err) {
      console.warn('Could not clear persisted session from safeStorage:', err);
    }
  }

  async init(): Promise<void> {
    try {
      if (typeof localStorage !== 'undefined') {
        this.currentGuestName = localStorage.getItem('musiczoom_guest_name') || '';
      }
    } catch {
      // ignore
    }

    try {
      const saved = await this.readPersistedSession();
      if (saved?.token) {
        this.currentToken = saved.token;
        let res: Response;
        try {
          res = await fetch(`${this.serverUrl}/api/auth/me`, {
            headers: { Authorization: `Bearer ${saved.token}` }
          });
        } catch {
          // If network is offline, maintain local cached identity
          if (saved.user && typeof saved.user === 'object') {
            this.currentUser = saved.user as UserProfile;
          }
          this.notify();
          return;
        }

        if (res.ok) {
          const data = (await res.json()) as { ok: boolean; user?: UserProfile };
          if (data.ok && data.user) {
            this.currentUser = data.user;
            await this.persistSession(saved.token, data.user);
          } else {
            await this.logout();
          }
        } else {
          await this.logout();
        }
      }
    } catch (err) {
      console.warn('Auth session restoration warning:', err);
    }

    this.notify();
  }

  async register(req: RegisterRequest): Promise<UserProfile> {
    let res: Response;
    try {
      res = await fetch(`${this.serverUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req)
      });
    } catch {
      throw new Error('Unable to connect to the authentication server. Please check your connection.');
    }

    let data: { ok: boolean; token?: string; user?: UserProfile; message?: string };
    try {
      data = (await res.json()) as { ok: boolean; token?: string; user?: UserProfile; message?: string };
    } catch {
      throw new Error(`Server returned status ${res.status}. Registration could not be completed.`);
    }

    if (!res.ok || !data.ok || !data.token || !data.user) {
      throw new Error(data.message || 'Registration failed.');
    }

    this.currentToken = data.token;
    this.currentUser = data.user;
    await this.persistSession(data.token, data.user);
    this.notify();
    return data.user;
  }

  async login(req: LoginRequest): Promise<UserProfile> {
    let res: Response;
    try {
      res = await fetch(`${this.serverUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req)
      });
    } catch {
      throw new Error('Unable to connect to the authentication server. Please check your connection.');
    }

    let data: { ok: boolean; token?: string; user?: UserProfile; message?: string };
    try {
      data = (await res.json()) as { ok: boolean; token?: string; user?: UserProfile; message?: string };
    } catch {
      throw new Error(`Server returned status ${res.status}. Sign in could not be completed.`);
    }

    if (!res.ok || !data.ok || !data.token || !data.user) {
      throw new Error(data.message || 'Invalid username or password.');
    }

    this.currentToken = data.token;
    this.currentUser = data.user;
    await this.persistSession(data.token, data.user);
    this.notify();
    return data.user;
  }

  async updateProfile(req: UpdateProfileRequest): Promise<UserProfile> {
    if (!this.currentToken) {
      throw new Error('You must be signed in to update your profile.');
    }
    let res: Response;
    try {
      res = await fetch(`${this.serverUrl}/api/auth/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.currentToken}`
        },
        body: JSON.stringify(req)
      });
    } catch {
      throw new Error('Unable to connect to the server. Please check your connection.');
    }

    let data: { ok: boolean; user?: UserProfile; message?: string };
    try {
      data = (await res.json()) as { ok: boolean; user?: UserProfile; message?: string };
    } catch {
      throw new Error(`Server returned status ${res.status}. Profile update could not be completed.`);
    }

    if (!res.ok || !data.ok || !data.user) {
      throw new Error(data.message || 'Profile update failed.');
    }

    this.currentUser = data.user;
    await this.persistSession(this.currentToken, data.user);
    this.notify();
    return data.user;
  }

  async logout(): Promise<void> {
    this.currentToken = null;
    this.currentUser = null;
    await this.clearPersistedSession();
    this.notify();
  }

  async getRecentSessions(): Promise<SessionHistoryItem[]> {
    if (!this.currentToken) return [];
    try {
      const res = await fetch(`${this.serverUrl}/api/sessions/history`, {
        headers: { Authorization: `Bearer ${this.currentToken}` }
      });
      if (res.ok) {
        const data = (await res.json()) as { ok: boolean; sessions?: SessionHistoryItem[] };
        return data.sessions || [];
      }
    } catch (err) {
      console.warn('Failed to fetch recent sessions:', err);
    }
    return [];
  }

  getEffectiveDisplayName(): string {
    if (this.currentUser) return this.currentUser.displayName;
    return this.currentGuestName || 'Guest Musician';
  }
}
