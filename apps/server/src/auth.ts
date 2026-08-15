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
  SessionSummaryEvent
} from '@musiczoom/shared';

export interface StoredUser {
  id: string;
  username: string;
  email: string;
  displayName: string;
  passwordHash: string; // salt:hashHex
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
  private dataFilePath: string;

  constructor(storageDir?: string) {
    const baseDir = storageDir ?? path.join(process.cwd(), 'data');
    if (!fs.existsSync(baseDir)) {
      try { fs.mkdirSync(baseDir, { recursive: true }); } catch { /* ignore */ }
    }
    this.dataFilePath = path.join(baseDir, 'musiczoom-accounts.json');
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    if (!fs.existsSync(this.dataFilePath)) return;
    try {
      const raw = fs.readFileSync(this.dataFilePath, 'utf-8');
      const data = JSON.parse(raw) as DatabaseSchema;
      if (Array.isArray(data.users)) {
        for (const u of data.users) {
          this.users.set(u.id, u);
          this.usernameIndex.set(u.username.toLowerCase(), u.id);
          this.emailIndex.set(u.email.toLowerCase(), u.id);
        }
      }
      if (Array.isArray(data.tokens)) {
        const now = Date.now();
        for (const t of data.tokens) {
          if (t.expiresAt > now) {
            this.tokens.set(t.token, t);
          }
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
    } catch (err) {
      console.warn('Could not read user database, starting fresh:', err);
    }
  }

  private saveToDisk(): void {
    try {
      const schema: DatabaseSchema = {
        version: 1,
        users: Array.from(this.users.values()),
        tokens: Array.from(this.tokens.values()).filter((t) => t.expiresAt > Date.now()),
        sessions: Array.from(this.sessions.values()).slice(-200), // keep last 200 sessions
        scheduledSessions: Array.from(this.scheduledSessions.values())
      };
      const tmpPath = `${this.dataFilePath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(schema, null, 2), 'utf-8');
      fs.renameSync(tmpPath, this.dataFilePath);
    } catch (err) {
      console.error('Failed to persist user database:', err);
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
    this.saveToDisk();
    return token;
  }

  async register(req: RegisterRequest): Promise<{ token: string; user: UserProfile }> {
    const lowerUsername = req.username.toLowerCase();
    const lowerEmail = req.email.toLowerCase();

    if (this.usernameIndex.has(lowerUsername)) {
      throw new Error('This username is already taken.');
    }
    if (this.emailIndex.has(lowerEmail)) {
      throw new Error('An account with this email already exists.');
    }

    const passwordHash = await hashPassword(req.password);
    const id = crypto.randomUUID();
    const now = Date.now();

    const storedUser: StoredUser = {
      id,
      username: req.username,
      email: req.email,
      displayName: req.displayName,
      passwordHash,
      avatarColor: randomAvatarColor(),
      createdAt: now,
      updatedAt: now,
      sessionsHostedCount: 0
    };

    this.users.set(id, storedUser);
    this.usernameIndex.set(lowerUsername, id);
    this.emailIndex.set(lowerEmail, id);

    const token = this.generateToken(id);
    this.saveToDisk();

    return {
      token,
      user: this.toProfile(storedUser)
    };
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

  incrementHostedCount(userId: string): void {
    const user = this.users.get(userId);
    if (user) {
      user.sessionsHostedCount = (user.sessionsHostedCount || 0) + 1;
      user.updatedAt = Date.now();
      this.saveToDisk();
    }
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
      this.saveToDisk();
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
    this.saveToDisk();
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
    }
  ): void {
    const now = Date.now();
    for (const record of this.sessions.values()) {
      const match = record.sessionId === sessionId || (!record.sessionId && record.code === sessionId);
      if (match) {
        const endedAt = record.endedAt ?? now;
        const durationSeconds = record.durationSeconds ?? Math.max(1, Math.round((endedAt - record.startedAt) / 1000));
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
            events: roomData.events || [],
            chatMessagesCount: roomData.chatMessagesCount || 0
          };
        }
      }
    }
    this.saveToDisk();
  }

  async updateProfile(userId: string, req: UpdateProfileRequest): Promise<UserProfile> {
    const user = this.users.get(userId);
    if (!user) {
      throw new Error('User not found.');
    }

    if (req.newPassword) {
      if (!req.currentPassword) {
        throw new Error('Current password is required to change password.');
      }
      const valid = await verifyPassword(req.currentPassword, user.passwordHash);
      if (!valid) {
        throw new Error('Incorrect current password.');
      }
      user.passwordHash = await hashPassword(req.newPassword);
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
    this.saveToDisk();
    return this.toProfile(user);
  }

  getSessionHistory(userId: string): StoredSessionRecord[] {
    const records = Array.from(this.sessions.values())
      .filter((s) => s.userId === userId)
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, 20);
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
    this.saveToDisk();
    return { ...item };
  }

  updateScheduledSession(userId: string, id: string, updates: { title?: string; scheduledAt?: string }): ScheduledSession | null {
    const existing = this.scheduledSessions.get(id);
    if (!existing || existing.userId !== userId) return null;
    if (updates.title !== undefined) existing.title = updates.title.trim();
    if (updates.scheduledAt !== undefined) existing.scheduledAt = updates.scheduledAt;
    existing.updatedAt = Date.now();
    this.saveToDisk();
    return { ...existing };
  }

  deleteScheduledSession(userId: string, id: string): boolean {
    const existing = this.scheduledSessions.get(id);
    if (!existing || existing.userId !== userId) return false;
    const deleted = this.scheduledSessions.delete(id);
    if (deleted) this.saveToDisk();
    return deleted;
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
