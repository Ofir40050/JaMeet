import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  UserProfile,
  ParticipantIdentity,
  RegisterRequest,
  LoginRequest,
  UpdateProfileRequest,
  ScheduledSession,
  FactualSessionSummary,
  SessionSummaryEvent,
  MeetingErrorCode
} from '@jameet/shared';
import { type ServerConfig, parseBetaEndAt } from './config.js';

export type SessionAccessState = 'beta' | 'paid' | 'blocked';

export type UserActivityType =
  | 'account_creation'
  | 'login'
  | 'session_hosted'
  | 'session_joined'
  | 'access_state_changed'
  | 'beta_expiration_changed';

export interface UserActivityEvent {
  id: string;
  type: UserActivityType;
  timestamp: number;
  description: string;
  clientVersion?: string;
  clientPlatform?: string;
}

export interface AdminUserSummary {
  id: string;
  displayName: string;
  username: string;
  email: string;
  createdAt: number;
  sessionsHostedCount: number;
  sessionAccess: SessionAccessState;
  accessUpdatedAt?: number;
  betaExpiresAt?: number | null;
  avatarColor: string;
  isOnline: boolean;
  lastLoginAt?: number;
  lastActiveAt?: number;
  clientVersion?: string;
  clientPlatform?: string;
  adminNote?: string;
}

export interface AdminUserDetail {
  id: string;
  displayName: string;
  username: string;
  email: string;
  createdAt: number;
  sessionsHostedCount: number;
  sessionAccess: SessionAccessState;
  accessUpdatedAt?: number;
  betaExpiresAt?: number | null;
  avatarColor: string;
  isOnline: boolean;
  lastLoginAt?: number;
  lastActiveAt?: number;
  clientVersion?: string;
  clientPlatform?: string;
  activityHistory: UserActivityEvent[];
  adminNote?: string;
}

export interface StoredUser {
  id: string;
  username: string;
  email: string;
  displayName: string;
  passwordHash: string; // salt:hashHex
  sessionAccess: SessionAccessState;
  accessUpdatedAt?: number;
  betaExpiresAt?: number | null;
  avatarColor: string;
  avatarUrl?: string;
  location?: string;
  role?: string;
  primaryDaw?: string;
  genres?: string[];
  bio?: string;
  website?: string;
  socialHandle?: string;
  createdAt: number;
  updatedAt: number;
  sessionsHostedCount: number;
  lastLoginAt?: number;
  lastActiveAt?: number;
  clientVersion?: string;
  clientPlatform?: string;
  activityHistory?: UserActivityEvent[];
  passwordChangedAt?: number;
  adminNote?: string;
  metadata?: Record<string, unknown>;
}

export interface StoredSessionToken {
  token: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
}

export interface StoredSessionRecord {
  id: string;
  sessionId?: string;
  code: string;
  userId: string;
  role: 'host' | 'participant';
  startedAt: number;
  endedAt?: number;
  durationSeconds?: number;
  collaborator: {
    id?: string;
    displayName: string;
    username?: string;
    isGuest: boolean;
    avatarColor?: string;
  } | null;
  summary?: FactualSessionSummary;
}

export interface StoredScheduledSession {
  id: string;
  userId: string;
  title: string;
  scheduledAt: string; // ISO 8601 UTC string
  createdAt: number;
  updatedAt: number;
}

export interface DatabaseSchema {
  users: StoredUser[];
  tokens: StoredSessionToken[];
  sessions?: StoredSessionRecord[];
  scheduledSessions?: StoredScheduledSession[];
  version: number;
}

export const MAX_SESSIONS_PER_USER = 50;

const AVATAR_COLORS = [
  '#06b6d4', // Cyan
  '#3b82f6', // Blue
  '#8b5cf6', // Purple
  '#ec4899', // Pink
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#6366f1'  // Indigo
];

function randomAvatarColor(): string {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)] ?? '#06b6d4';
}

function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const [salt, keyHex] = storedHash.split(':');
    if (!salt || !keyHex) return resolve(false);
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, derivedKey) => {
      if (err) return reject(err);
      const keyBuffer = Buffer.from(keyHex, 'hex');
      try {
        const match = crypto.timingSafeEqual(derivedKey, keyBuffer);
        resolve(match);
      } catch {
        resolve(false);
      }
    });
  });
}

export class UserStore {
  private users = new Map<string, StoredUser>(); // id -> user
  private usernameIndex = new Map<string, string>(); // lower(username) -> id
  private emailIndex = new Map<string, string>(); // lower(email) -> id
  private tokens = new Map<string, StoredSessionToken>(); // token -> session
  private sessions = new Map<string, StoredSessionRecord>(); // record id -> record
  private scheduledSessions = new Map<string, StoredScheduledSession>(); // scheduled id -> record
  private pendingUsernames = new Set<string>(); // lower(username) currently registering
  private pendingEmails = new Set<string>(); // lower(email) currently registering
  private dataFilePath: string;

  constructor(storageDir?: string) {
    const baseDir = storageDir ?? process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
    if (!fs.existsSync(baseDir)) {
      try { fs.mkdirSync(baseDir, { recursive: true }); } catch { /* ignore */ }
    }
    const legacyPath = path.join(baseDir, 'musiczoom-accounts.json');
    const primaryPath = path.join(baseDir, 'jameet-accounts.json');
    this.dataFilePath = !fs.existsSync(primaryPath) && fs.existsSync(legacyPath) ? legacyPath : primaryPath;
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    if (!fs.existsSync(this.dataFilePath)) return;
    try {
      const raw = fs.readFileSync(this.dataFilePath, 'utf-8');
      const data = JSON.parse(raw) as DatabaseSchema;
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error(`Invalid account database structure in ${this.dataFilePath}: root must be an object`);
      }
      if (!Array.isArray(data.users)) {
        throw new Error(`Invalid account database structure in ${this.dataFilePath}: 'users' field must be an array`);
      }
      if (!Array.isArray(data.tokens)) {
        throw new Error(`Invalid account database structure in ${this.dataFilePath}: 'tokens' field must be an array`);
      }
      if (data.sessions !== undefined && !Array.isArray(data.sessions)) {
        throw new Error(`Invalid account database structure in ${this.dataFilePath}: 'sessions' field must be an array`);
      }
      if (data.scheduledSessions !== undefined && !Array.isArray(data.scheduledSessions)) {
        throw new Error(`Invalid account database structure in ${this.dataFilePath}: 'scheduledSessions' field must be an array`);
      }
      let needsSave = false;
      for (const u of data.users) {
        if (u.sessionAccess === undefined || u.sessionAccess === null) {
          u.sessionAccess = 'beta';
          needsSave = true;
        }
        if (u.accessUpdatedAt === undefined || u.accessUpdatedAt === null) {
          u.accessUpdatedAt = u.createdAt || Date.now();
        }
        if (!Array.isArray(u.activityHistory)) {
          u.activityHistory = [];
        }
        this.users.set(u.id, u);
        this.usernameIndex.set(u.username.toLowerCase(), u.id);
        this.emailIndex.set(u.email.toLowerCase(), u.id);
      }
      const now = Date.now();
      for (const t of data.tokens) {
        if (t.expiresAt > now) {
          const user = this.users.get(t.userId);
          if (!user?.passwordChangedAt || t.createdAt >= user.passwordChangedAt) {
            this.tokens.set(t.token, t);
          }
        }
      }
      if (Array.isArray(data.sessions)) {
        for (const s of data.sessions) {
          this.sessions.set(s.id, s);
        }
        this.sessions = this.getPrunedSessions();
      }
      if (Array.isArray(data.scheduledSessions)) {
        for (const s of data.scheduledSessions) {
          this.scheduledSessions.set(s.id, s);
        }
      }
      if (needsSave) {
        try {
          this.saveToDisk();
        } catch (err) {
          console.warn('Could not save migrated user access states to disk:', err);
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to load account datastore from ${this.dataFilePath}: ${message}`);
    }
  }

  private getPrunedSessions(): Map<string, StoredSessionRecord> {
    const userSessions = new Map<string, StoredSessionRecord[]>();
    for (const record of this.sessions.values()) {
      const uId = record.userId || 'unknown';
      let list = userSessions.get(uId);
      if (!list) {
        list = [];
        userSessions.set(uId, list);
      }
      list.push(record);
    }

    const retained = new Map<string, StoredSessionRecord>();
    for (const list of userSessions.values()) {
      list.sort((a, b) => (b.startedAt - a.startedAt) || b.id.localeCompare(a.id, undefined, { numeric: true }));
      const kept = list.slice(0, MAX_SESSIONS_PER_USER);
      for (const record of kept) {
        retained.set(record.id, record);
      }
    }
    return retained;
  }

  private saveToDisk(): void {
    const retainedSessions = this.getPrunedSessions();
    const schema: DatabaseSchema = {
      version: 1,
      users: Array.from(this.users.values()),
      tokens: Array.from(this.tokens.values()).filter((t) => t.expiresAt > Date.now()),
      sessions: Array.from(retainedSessions.values()).sort((a, b) => (b.startedAt - a.startedAt) || b.id.localeCompare(a.id, undefined, { numeric: true })),
      scheduledSessions: Array.from(this.scheduledSessions.values())
    };
    const dir = path.dirname(this.dataFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmpPath = `${this.dataFilePath}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(schema, null, 2), 'utf-8');
      fs.renameSync(tmpPath, this.dataFilePath);
      this.sessions = retainedSessions;
    } catch (err) {
      try {
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath);
        }
      } catch {
        // ignore tmp cleanup error
      }
      console.error('Failed to persist user database:', err);
      throw err;
    }
  }

  createSnapshot(): string {
    return JSON.stringify({
      users: Array.from(this.users.values()),
      tokens: Array.from(this.tokens.values()),
      sessions: Array.from(this.sessions.values()),
      scheduledSessions: Array.from(this.scheduledSessions.values())
    });
  }

  restoreSnapshot(snapshotJson: string): void {
    const data = JSON.parse(snapshotJson) as DatabaseSchema;
    this.users.clear();
    this.usernameIndex.clear();
    this.emailIndex.clear();
    this.tokens.clear();
    this.sessions.clear();
    this.scheduledSessions.clear();

    if (Array.isArray(data.users)) {
      for (const u of data.users) {
        if (u.sessionAccess === undefined || u.sessionAccess === null) {
          u.sessionAccess = 'beta';
        }
        this.users.set(u.id, u);
        this.usernameIndex.set(u.username.toLowerCase(), u.id);
        this.emailIndex.set(u.email.toLowerCase(), u.id);
      }
    }
    if (Array.isArray(data.tokens)) {
      for (const t of data.tokens) {
        this.tokens.set(t.token, t);
      }
    }
    if (Array.isArray(data.sessions)) {
      for (const s of data.sessions) {
        this.sessions.set(s.id, s);
      }
    }
    if (Array.isArray(data.scheduledSessions)) {
      for (const s of data.scheduledSessions) {
        this.scheduledSessions.set(s.id, s);
      }
    }
    this.saveToDisk();
  }

  revokeToken(token?: string): boolean {
    if (!token) return false;
    const session = this.tokens.get(token);
    if (!session) return false;
    this.tokens.delete(token);
    try {
      this.saveToDisk();
    } catch (err) {
      this.tokens.set(token, session);
      throw err;
    }
    return true;
  }

  revokeUserTokens(userId: string): void {
    const snapshots = new Map<string, StoredSessionToken>();
    for (const [tok, session] of this.tokens.entries()) {
      if (session.userId === userId) {
        snapshots.set(tok, session);
        this.tokens.delete(tok);
      }
    }
    if (snapshots.size === 0) return;
    try {
      this.saveToDisk();
    } catch (err) {
      for (const [tok, session] of snapshots) {
        this.tokens.set(tok, session);
      }
      throw err;
    }
  }

  private generateToken(userId: string): string {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
    const session: StoredSessionToken = {
      token,
      userId,
      createdAt: Date.now(),
      expiresAt
    };
    this.tokens.set(token, session);
    try {
      this.saveToDisk();
    } catch (err) {
      this.tokens.delete(token);
      throw err;
    }
    return token;
  }

  async register(req: RegisterRequest, clientInfo?: { version?: string; platform?: string }): Promise<{ token: string; user: UserProfile }> {
    const lowerUsername = req.username.toLowerCase();
    const lowerEmail = req.email.toLowerCase();

    if (this.usernameIndex.has(lowerUsername) || this.pendingUsernames.has(lowerUsername)) {
      throw new Error('This username is already taken.');
    }
    if (this.emailIndex.has(lowerEmail) || this.pendingEmails.has(lowerEmail)) {
      throw new Error('An account with this email already exists.');
    }

    this.pendingUsernames.add(lowerUsername);
    this.pendingEmails.add(lowerEmail);

    try {
      const passwordHash = await hashPassword(req.password);
      const id = crypto.randomUUID();
      const now = Date.now();

      const initialActivity: UserActivityEvent = {
        id: crypto.randomUUID(),
        type: 'account_creation',
        timestamp: now,
        description: 'Account created',
        clientVersion: clientInfo?.version,
        clientPlatform: clientInfo?.platform
      };

      const storedUser: StoredUser = {
        id,
        username: req.username,
        email: req.email,
        displayName: req.displayName,
        passwordHash,
        sessionAccess: 'blocked',
        accessUpdatedAt: now,
        avatarColor: randomAvatarColor(),
        createdAt: now,
        updatedAt: now,
        lastActiveAt: now,
        lastLoginAt: now,
        clientVersion: clientInfo?.version,
        clientPlatform: clientInfo?.platform,
        activityHistory: [initialActivity],
        sessionsHostedCount: 0
      };

      this.users.set(id, storedUser);
      this.usernameIndex.set(lowerUsername, id);
      this.emailIndex.set(lowerEmail, id);

      let token: string;
      try {
        token = this.generateToken(id);
      } catch (err) {
        this.users.delete(id);
        this.usernameIndex.delete(lowerUsername);
        this.emailIndex.delete(lowerEmail);
        throw err;
      }

      return {
        token,
        user: this.toProfile(storedUser)
      };
    } finally {
      this.pendingUsernames.delete(lowerUsername);
      this.pendingEmails.delete(lowerEmail);
    }
  }

  async login(req: LoginRequest): Promise<{ token: string; user: UserProfile }> {
    const identifier = req.usernameOrEmail.toLowerCase();
    const userId = this.usernameIndex.get(identifier) ?? this.emailIndex.get(identifier);
    if (!userId) {
      throw new Error('Invalid username or password.');
    }

    const stored = this.users.get(userId);
    if (!stored) {
      throw new Error('Invalid username or password.');
    }

    const valid = await verifyPassword(req.password, stored.passwordHash);
    if (!valid) {
      throw new Error('Invalid username or password.');
    }

    const token = this.generateToken(stored.id);
    return {
      token,
      user: this.toProfile(stored)
    };
  }

  verifyToken(token?: string): UserProfile | null {
    if (!token) return null;
    const session = this.tokens.get(token);
    if (!session || session.expiresAt <= Date.now()) {
      if (session) this.tokens.delete(token);
      return null;
    }
    const user = this.users.get(session.userId);
    if (!user) return null;
    if (user.passwordChangedAt && session.createdAt < user.passwordChangedAt) {
      this.tokens.delete(token);
      return null;
    }
    return this.toProfile(user);
  }

  findByUsernameOrEmail(identifier: string): UserProfile | null {
    const lower = identifier.trim().toLowerCase();
    const userId = this.usernameIndex.get(lower) ?? this.emailIndex.get(lower);
    if (!userId) return null;
    const user = this.users.get(userId);
    if (!user) return null;
    return this.toProfile(user);
  }

  getStoredUser(userId: string): StoredUser | null {
    const user = this.users.get(userId);
    return user ? { ...user } : null;
  }

  createGuestIdentity(guestName?: string): ParticipantIdentity {
    const name = guestName?.trim() || 'Guest Musician';
    return {
      id: crypto.randomUUID(),
      displayName: name,
      isGuest: true,
      isHost: false,
      avatarColor: '#64748b'
    };
  }

  getTrustedIdentity(authToken: string | undefined, guestName: string | undefined, isHost: boolean): ParticipantIdentity {
    const verifiedUser = this.verifyToken(authToken);
    if (verifiedUser) {
      return {
        id: verifiedUser.id,
        displayName: verifiedUser.displayName,
        username: verifiedUser.username,
        isGuest: false,
        isHost,
        avatarColor: verifiedUser.avatarColor,
        avatarUrl: verifiedUser.avatarUrl,
        role: verifiedUser.role,
        location: verifiedUser.location,
        primaryDaw: verifiedUser.primaryDaw
      };
    }
    const guest = this.createGuestIdentity(guestName);
    guest.isHost = isHost;
    return guest;
  }

  incrementHostedCount(userId: string, sessionCode?: string): void {
    const user = this.users.get(userId);
    if (user) {
      const prevCount = user.sessionsHostedCount;
      const prevUpdatedAt = user.updatedAt;
      const prevLastActive = user.lastActiveAt;
      const now = Date.now();
      user.sessionsHostedCount = (user.sessionsHostedCount || 0) + 1;
      user.updatedAt = now;
      user.lastActiveAt = now;

      const event: UserActivityEvent = {
        id: crypto.randomUUID(),
        type: 'session_hosted',
        timestamp: now,
        description: sessionCode ? `Hosted session ${sessionCode}` : 'Hosted a session'
      };
      if (!Array.isArray(user.activityHistory)) {
        user.activityHistory = [];
      }
      user.activityHistory.unshift(event);
      if (user.activityHistory.length > 50) {
        user.activityHistory = user.activityHistory.slice(0, 50);
      }

      try {
        this.saveToDisk();
      } catch (err) {
        user.sessionsHostedCount = prevCount;
        user.updatedAt = prevUpdatedAt;
        user.lastActiveAt = prevLastActive;
        user.activityHistory.shift();
        throw err;
      }
    }
  }

  recordSessionJoined(userId: string, sessionCode: string): void {
    const user = this.users.get(userId);
    if (!user) return;
    const now = Date.now();
    user.lastActiveAt = now;

    const event: UserActivityEvent = {
      id: crypto.randomUUID(),
      type: 'session_joined',
      timestamp: now,
      description: `Joined session ${sessionCode}`
    };
    if (!Array.isArray(user.activityHistory)) {
      user.activityHistory = [];
    }
    user.activityHistory.unshift(event);
    if (user.activityHistory.length > 50) {
      user.activityHistory = user.activityHistory.slice(0, 50);
    }
    try {
      this.saveToDisk();
    } catch (err) {
      console.warn('Could not save session joined activity:', err);
    }
  }

  recordLogin(userId: string, clientInfo?: { version?: string; platform?: string }): void {
    const user = this.users.get(userId);
    if (!user) return;
    const now = Date.now();
    user.lastLoginAt = now;
    user.lastActiveAt = now;
    if (clientInfo?.version && clientInfo.version !== 'Unknown') {
      user.clientVersion = clientInfo.version;
    } else if (!user.clientVersion && clientInfo?.version) {
      user.clientVersion = clientInfo.version;
    }
    if (clientInfo?.platform && clientInfo.platform !== 'Unknown') {
      user.clientPlatform = clientInfo.platform;
    } else if (!user.clientPlatform && clientInfo?.platform) {
      user.clientPlatform = clientInfo.platform;
    }

    const platformLabel = user.clientPlatform || 'Unknown';
    const versionLabel = user.clientVersion && user.clientVersion !== 'Unknown' ? `v${user.clientVersion}` : '';
    const desc = versionLabel && platformLabel !== 'Unknown'
      ? `Logged in (${platformLabel} • ${versionLabel})`
      : (versionLabel ? `Logged in (${versionLabel})` : `Logged in (${platformLabel})`);

    const event: UserActivityEvent = {
      id: crypto.randomUUID(),
      type: 'login',
      timestamp: now,
      description: desc,
      clientVersion: user.clientVersion,
      clientPlatform: user.clientPlatform
    };
    if (!Array.isArray(user.activityHistory)) {
      user.activityHistory = [];
    }
    user.activityHistory.unshift(event);
    if (user.activityHistory.length > 50) {
      user.activityHistory = user.activityHistory.slice(0, 50);
    }
    try {
      this.saveToDisk();
    } catch (err) {
      console.warn('Could not save login activity to disk:', err);
    }
  }

  setSessionAccess(userId: string, access: SessionAccessState, betaExpiresAt?: number | null): boolean {
    const user = this.users.get(userId);
    if (!user) return false;
    const prevAccess = user.sessionAccess;
    const prevAccessUpdatedAt = user.accessUpdatedAt;
    const prevBetaExpiresAt = user.betaExpiresAt;
    const prevUpdatedAt = user.updatedAt;
    const now = Date.now();

    user.sessionAccess = access;
    user.accessUpdatedAt = now;
    user.updatedAt = now;
    if (betaExpiresAt !== undefined) {
      user.betaExpiresAt = betaExpiresAt;
    }

    const event: UserActivityEvent = {
      id: crypto.randomUUID(),
      type: 'access_state_changed',
      timestamp: now,
      description: `Access state changed from ${prevAccess} to ${access}`
    };
    if (!Array.isArray(user.activityHistory)) {
      user.activityHistory = [];
    }
    user.activityHistory.unshift(event);
    if (user.activityHistory.length > 50) {
      user.activityHistory = user.activityHistory.slice(0, 50);
    }

    try {
      this.saveToDisk();
      return true;
    } catch (err) {
      user.sessionAccess = prevAccess;
      user.accessUpdatedAt = prevAccessUpdatedAt;
      user.betaExpiresAt = prevBetaExpiresAt;
      user.updatedAt = prevUpdatedAt;
      user.activityHistory.shift();
      throw err;
    }
  }

  setBetaExpiration(userId: string, betaExpiresAt: number | null): boolean {
    const user = this.users.get(userId);
    if (!user) return false;
    const prevBetaExpiresAt = user.betaExpiresAt;
    const prevUpdatedAt = user.updatedAt;
    const now = Date.now();

    user.betaExpiresAt = betaExpiresAt;
    user.updatedAt = now;

    const desc = betaExpiresAt
      ? `Beta expiration set to ${new Date(betaExpiresAt).toISOString().slice(0, 10)}`
      : 'Beta expiration cleared (no expiration)';

    const event: UserActivityEvent = {
      id: crypto.randomUUID(),
      type: 'beta_expiration_changed',
      timestamp: now,
      description: desc
    };
    if (!Array.isArray(user.activityHistory)) {
      user.activityHistory = [];
    }
    user.activityHistory.unshift(event);
    if (user.activityHistory.length > 50) {
      user.activityHistory = user.activityHistory.slice(0, 50);
    }

    try {
      this.saveToDisk();
      return true;
    } catch (err) {
      user.betaExpiresAt = prevBetaExpiresAt;
      user.updatedAt = prevUpdatedAt;
      user.activityHistory.shift();
      throw err;
    }
  }

  setAdminNote(userId: string, note: string | null | undefined): boolean {
    const user = this.users.get(userId);
    if (!user) return false;
    const prevNote = user.adminNote;
    const prevUpdatedAt = user.updatedAt;
    const now = Date.now();

    user.adminNote = (note && typeof note === 'string' && note.trim()) ? note.trim() : undefined;
    user.updatedAt = now;

    try {
      this.saveToDisk();
      return true;
    } catch (err) {
      user.adminNote = prevNote;
      user.updatedAt = prevUpdatedAt;
      throw err;
    }
  }

  listAdminUsers(onlineUserIds?: Set<string>): AdminUserSummary[] {
    return Array.from(this.users.values())
      .map((u) => ({
        id: u.id,
        displayName: u.displayName,
        username: u.username,
        email: u.email,
        createdAt: u.createdAt,
        sessionsHostedCount: u.sessionsHostedCount || 0,
        sessionAccess: u.sessionAccess ?? 'blocked',
        accessUpdatedAt: u.accessUpdatedAt || u.createdAt,
        betaExpiresAt: u.betaExpiresAt,
        avatarColor: u.avatarColor,
        isOnline: Boolean(onlineUserIds && onlineUserIds.has(u.id)),
        lastLoginAt: u.lastLoginAt,
        lastActiveAt: u.lastActiveAt,
        clientVersion: u.clientVersion,
        clientPlatform: u.clientPlatform,
        adminNote: u.adminNote
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  getAdminUserDetail(userId: string, isOnline: boolean = false): AdminUserDetail | null {
    const u = this.users.get(userId);
    if (!u) return null;
    return {
      id: u.id,
      displayName: u.displayName,
      username: u.username,
      email: u.email,
      createdAt: u.createdAt,
      sessionsHostedCount: u.sessionsHostedCount || 0,
      sessionAccess: u.sessionAccess ?? 'blocked',
      accessUpdatedAt: u.accessUpdatedAt || u.createdAt,
      betaExpiresAt: u.betaExpiresAt,
      avatarColor: u.avatarColor,
      isOnline,
      lastLoginAt: u.lastLoginAt,
      lastActiveAt: u.lastActiveAt,
      clientVersion: u.clientVersion,
      clientPlatform: u.clientPlatform,
      activityHistory: (u.activityHistory || []).map((e) => ({ ...e })),
      adminNote: u.adminNote
    };
  }

  recordSessionStart(
    sessionIdOrCode: string,
    codeOrUserId: string,
    userIdOrRole: string,
    roleOrCollab?: 'host' | 'participant' | ParticipantIdentity | null,
    collabMaybe?: ParticipantIdentity | null
  ): StoredSessionRecord {
    let sessionId: string;
    let code: string;
    let userId: string;
    let role: 'host' | 'participant';
    let collaborator: ParticipantIdentity | null | undefined;

    if (roleOrCollab === 'host' || roleOrCollab === 'participant') {
      sessionId = sessionIdOrCode;
      code = codeOrUserId;
      userId = userIdOrRole;
      role = roleOrCollab;
      collaborator = collabMaybe;
    } else {
      // 4 args: (code, userId, role, collaborator)
      sessionId = sessionIdOrCode;
      code = sessionIdOrCode;
      userId = codeOrUserId;
      role = userIdOrRole as 'host' | 'participant';
      collaborator = roleOrCollab as ParticipantIdentity | null | undefined;
    }

    const recordId = `${userId}_${sessionId}`;
    let existing = this.sessions.get(recordId);
    if (!existing) {
      existing = this.sessions.get(`${userId}_${code}`);
    }
    if (existing) {
      const existingSnapshot = JSON.parse(JSON.stringify(existing)) as StoredSessionRecord;
      if (!existing.sessionId) existing.sessionId = sessionId;
      if (collaborator) {
        existing.collaborator = {
          id: collaborator.isGuest ? undefined : collaborator.id,
          displayName: collaborator.displayName,
          username: collaborator.username,
          isGuest: collaborator.isGuest,
          avatarColor: collaborator.avatarColor
        };
      }
      try {
        this.saveToDisk();
      } catch (err) {
        this.sessions.set(existing.id, existingSnapshot);
        throw err;
      }
      return existing;
    }

    const record: StoredSessionRecord = {
      id: recordId,
      sessionId,
      code,
      userId,
      role,
      startedAt: Date.now(),
      collaborator: collaborator ? {
        id: collaborator.isGuest ? undefined : collaborator.id,
        displayName: collaborator.displayName,
        username: collaborator.username,
        isGuest: collaborator.isGuest,
        avatarColor: collaborator.avatarColor
      } : null
    };

    this.sessions.set(recordId, record);
    try {
      this.saveToDisk();
    } catch (err) {
      this.sessions.delete(recordId);
      throw err;
    }
    return record;
  }

  recordCollaboratorJoined(
    arg1: string,
    arg2: string | ParticipantIdentity,
    arg3: ParticipantIdentity,
    arg4?: ParticipantIdentity
  ): void {
    let sessionId: string;
    let code: string;
    let hostIdentity: ParticipantIdentity;
    let peerIdentity: ParticipantIdentity;

    if (typeof arg2 === 'string' && arg4) {
      sessionId = arg1;
      code = arg2;
      hostIdentity = arg3;
      peerIdentity = arg4;
    } else {
      sessionId = arg1;
      code = arg1;
      hostIdentity = arg2 as ParticipantIdentity;
      peerIdentity = arg3;
    }

    // If host is registered, update host's session record with peer
    if (!hostIdentity.isGuest && hostIdentity.id) {
      this.recordSessionStart(sessionId, code, hostIdentity.id, 'host', peerIdentity);
    }
    // If peer is registered, update peer's session record with host
    if (!peerIdentity.isGuest && peerIdentity.id) {
      this.recordSessionStart(sessionId, code, peerIdentity.id, 'participant', hostIdentity);
    }
  }

  recordSessionClose(
    sessionId: string,
    roomData?: {
      code: string;
      startedAt: number;
      allJoinedParticipants: Map<string, ParticipantIdentity>;
      chatMessagesCount: number;
      events: SessionSummaryEvent[];
      projectId?: string;
      projectName?: string;
    },
    userId?: string
  ): void {
    const snapshots = new Map<string, StoredSessionRecord>();
    const now = Date.now();
    for (const record of this.sessions.values()) {
      const match =
        (record.sessionId === sessionId || (!record.sessionId && record.code === sessionId)) &&
        (!userId || record.userId === userId);
      if (match) {
        if (record.endedAt !== undefined) {
          continue;
        }
        snapshots.set(record.id, JSON.parse(JSON.stringify(record)) as StoredSessionRecord);
        const endedAt = now;
        const durationSeconds = Math.max(1, Math.round((endedAt - record.startedAt) / 1000));
        record.endedAt = endedAt;
        record.durationSeconds = durationSeconds;

        if (roomData) {
          const participantsList = Array.from(roomData.allJoinedParticipants.values()).map((p) => ({
            id: p.isGuest ? undefined : p.id,
            displayName: p.displayName,
            username: p.username,
            role: p.isHost ? 'Host' : 'Collaborator',
            isHost: Boolean(p.isHost),
            isGuest: Boolean(p.isGuest),
            avatarColor: p.avatarColor
          }));
          const filteredEvents = (roomData.events || [])
            .filter((e) => !e.timestamp || e.timestamp <= endedAt)
            .map((e) => ({ ...e }));

          record.summary = {
            id: record.id,
            sessionId: record.sessionId || sessionId,
            code: record.code,
            startedAt: record.startedAt,
            endedAt,
            durationSeconds,
            role: record.role,
            participants: participantsList,
            projectId: roomData.projectId,
            projectName: roomData.projectName,
            events: filteredEvents,
            chatMessagesCount: roomData.chatMessagesCount || 0
          };
        }
      }
    }
    try {
      this.saveToDisk();
    } catch (err) {
      for (const [id, snap] of snapshots) {
        this.sessions.set(id, snap);
      }
      throw err;
    }
  }

  async updateProfile(userId: string, req: UpdateProfileRequest): Promise<{ user: UserProfile; token?: string }> {
    const user = this.users.get(userId);
    if (!user) {
      throw new Error('User not found.');
    }

    const userSnapshot: StoredUser = {
      ...user,
      genres: user.genres ? [...user.genres] : undefined,
      metadata: user.metadata ? { ...user.metadata } : undefined
    };
    const tokensSnapshot = new Map(this.tokens);

    let newToken: string | undefined;
    if (req.newPassword) {
      if (!req.currentPassword) {
        throw new Error('Current password is required to change password.');
      }
      const valid = await verifyPassword(req.currentPassword, user.passwordHash);
      if (!valid) {
        throw new Error('Incorrect current password.');
      }
      user.passwordHash = await hashPassword(req.newPassword);
      user.passwordChangedAt = Date.now();
      for (const [tok, session] of this.tokens.entries()) {
        if (session.userId === userId) {
          this.tokens.delete(tok);
        }
      }

      // Issue a fresh post-password-change token for the current client
      const rawToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
      this.tokens.set(rawToken, {
        token: rawToken,
        userId,
        createdAt: Date.now(),
        expiresAt
      });
      newToken = rawToken;
    }

    if (req.displayName !== undefined) user.displayName = req.displayName.trim();
    if (req.avatarColor !== undefined) user.avatarColor = req.avatarColor;
    if (req.avatarUrl !== undefined) user.avatarUrl = req.avatarUrl;
    if (req.location !== undefined) user.location = req.location.trim();
    if (req.role !== undefined) user.role = req.role.trim();
    if (req.primaryDaw !== undefined) user.primaryDaw = req.primaryDaw.trim();
    if (req.genres !== undefined) user.genres = req.genres;
    if (req.bio !== undefined) user.bio = req.bio.trim();
    if (req.website !== undefined) user.website = req.website.trim();
    if (req.socialHandle !== undefined) user.socialHandle = req.socialHandle.trim();

    user.updatedAt = Date.now();
    try {
      this.saveToDisk();
    } catch (err) {
      this.users.set(userId, userSnapshot);
      this.tokens = tokensSnapshot;
      throw err;
    }
    return { user: this.toProfile(user), token: newToken };
  }

  getSessionHistory(userId: string): StoredSessionRecord[] {
    const records = Array.from(this.sessions.values())
      .filter((s) => s.userId === userId)
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, MAX_SESSIONS_PER_USER);
    return records;
  }

  listScheduledSessions(userId: string): ScheduledSession[] {
    return Array.from(this.scheduledSessions.values())
      .filter((s) => s.userId === userId)
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
      .map((s) => ({ ...s }));
  }

  createScheduledSession(userId: string, title: string, scheduledAt: string): ScheduledSession {
    const id = crypto.randomUUID();
    const now = Date.now();
    const item: StoredScheduledSession = {
      id,
      userId,
      title: title.trim(),
      scheduledAt,
      createdAt: now,
      updatedAt: now
    };
    this.scheduledSessions.set(id, item);
    try {
      this.saveToDisk();
    } catch (err) {
      this.scheduledSessions.delete(id);
      throw err;
    }
    return { ...item };
  }

  updateScheduledSession(userId: string, id: string, updates: { title?: string; scheduledAt?: string }): ScheduledSession | null {
    const existing = this.scheduledSessions.get(id);
    if (!existing || existing.userId !== userId) return null;
    const snap: StoredScheduledSession = { ...existing };
    if (updates.title !== undefined) existing.title = updates.title.trim();
    if (updates.scheduledAt !== undefined) existing.scheduledAt = updates.scheduledAt;
    existing.updatedAt = Date.now();
    try {
      this.saveToDisk();
    } catch (err) {
      this.scheduledSessions.set(id, snap);
      throw err;
    }
    return { ...existing };
  }

  deleteScheduledSession(userId: string, id: string): boolean {
    const existing = this.scheduledSessions.get(id);
    if (!existing || existing.userId !== userId) return false;
    const snap: StoredScheduledSession = { ...existing };
    this.scheduledSessions.delete(id);
    try {
      this.saveToDisk();
    } catch (err) {
      this.scheduledSessions.set(id, snap);
      throw err;
    }
    return true;
  }

  private toProfile(stored: StoredUser): UserProfile {
    return {
      id: stored.id,
      username: stored.username,
      email: stored.email,
      displayName: stored.displayName,
      isGuest: false,
      avatarColor: stored.avatarColor,
      avatarUrl: stored.avatarUrl,
      location: stored.location,
      role: stored.role,
      primaryDaw: stored.primaryDaw,
      genres: stored.genres,
      bio: stored.bio,
      website: stored.website,
      socialHandle: stored.socialHandle,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt
    };
  }
}

export type SessionAuthResult =
  | {
      ok: true;
      user: StoredUser;
      identity: ParticipantIdentity;
    }
  | {
      ok: false;
      code: MeetingErrorCode;
      message: string;
    };

export function validateStoredUserSessionAccess(
  userStore: UserStore,
  userId: string,
  config: ServerConfig,
  isHost: boolean,
  now: number = Date.now(),
  authToken?: string
): SessionAuthResult {
  if (authToken !== undefined) {
    const verifiedProfile = userStore.verifyToken(authToken);
    if (!verifiedProfile || verifiedProfile.id !== userId) {
      return {
        ok: false,
        code: 'AUTH_REQUIRED',
        message: 'Authentication required to create or join a session.'
      };
    }
  }

  const storedUser = userStore.getStoredUser(userId);
  if (!storedUser) {
    return {
      ok: false,
      code: 'AUTH_REQUIRED',
      message: 'Authentication required to create or join a session.'
    };
  }

  // Session authorization must fail closed.
  // Only explicit stored sessionAccess value of 'beta' or 'paid' may authorize a live session.
  if (storedUser.sessionAccess === 'blocked') {
    return {
      ok: false,
      code: 'ACCESS_DENIED',
      message: 'Your account does not currently have access to JaMeet sessions.'
    };
  }

  if (storedUser.sessionAccess === 'beta') {
    if (storedUser.betaExpiresAt !== undefined && storedUser.betaExpiresAt !== null) {
      if (now >= storedUser.betaExpiresAt) {
        return {
          ok: false,
          code: 'BETA_ENDED',
          message: 'Your JaMeet Beta access has expired. A JaMeet subscription will be required to continue creating or joining sessions.'
        };
      }
    }
    if (config.BETA_END_AT && config.BETA_END_AT.trim()) {
      const betaEndMs = parseBetaEndAt(config.BETA_END_AT);
      if (betaEndMs !== null && now >= betaEndMs) {
        return {
          ok: false,
          code: 'BETA_ENDED',
          message: 'JaMeet Beta has ended. A JaMeet subscription will be required to continue creating or joining sessions.'
        };
      }
    }
  } else if (storedUser.sessionAccess === 'paid') {
    // Paid access authorized (bypasses BETA_END_AT)
  } else {
    // Unknown, malformed, or unsupported sessionAccess value -> fail closed with ACCESS_DENIED
    return {
      ok: false,
      code: 'ACCESS_DENIED',
      message: 'Your account does not currently have access to JaMeet sessions.'
    };
  }

  const identity: ParticipantIdentity = {
    id: storedUser.id,
    displayName: storedUser.displayName,
    username: storedUser.username,
    isGuest: false,
    isHost,
    avatarColor: storedUser.avatarColor,
    avatarUrl: storedUser.avatarUrl,
    role: storedUser.role,
    location: storedUser.location,
    primaryDaw: storedUser.primaryDaw
  };

  return {
    ok: true,
    user: storedUser,
    identity
  };
}

export function authorizeSessionAccess(
  userStore: UserStore,
  authToken: string | undefined,
  config: ServerConfig,
  isHost: boolean,
  now: number = Date.now()
): SessionAuthResult {
  if (!authToken || typeof authToken !== 'string' || !authToken.trim()) {
    return {
      ok: false,
      code: 'AUTH_REQUIRED',
      message: 'Authentication required to create or join a session.'
    };
  }

  const verifiedProfile = userStore.verifyToken(authToken);
  if (!verifiedProfile || !verifiedProfile.id) {
    return {
      ok: false,
      code: 'AUTH_REQUIRED',
      message: 'Authentication required to create or join a session.'
    };
  }

  return validateStoredUserSessionAccess(userStore, verifiedProfile.id, config, isHost, now, authToken);
}


