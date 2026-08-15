import { randomInt, randomUUID } from 'node:crypto';
import type { MediaMetadata, MeetingRole, ParticipantIdentity, SessionSummaryEvent } from '@musiczoom/shared';

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export type Participant = {
  id: string;
  role: MeetingRole;
  socketId: string | null;
  media: MediaMetadata;
  identity: ParticipantIdentity;
  timer?: NodeJS.Timeout;
};
export type Room = {
  sessionId: string;
  code: string;
  startedAt: number;
  projectId?: string;
  waitingRoomEnabled?: boolean;
  isLocked?: boolean;
  hostIdentity: ParticipantIdentity;
  participants: Map<string, Participant>;
  waitingParticipants: Map<string, Participant>;
  allJoinedParticipants: Map<string, ParticipantIdentity>;
  chatMessagesCount: number;
  events: SessionSummaryEvent[];
  expiresAt: number;
};

export class RoomStore {
  readonly rooms = new Map<string, Room>();
  constructor(private readonly graceMs: number, private readonly ttlMs: number) {}

  private code(): string {
    let result = '';
    for (let i = 0; i < 8; i += 1) result += ALPHABET[randomInt(ALPHABET.length)];
    return result;
  }

  create(participantId: string, socketId: string, media: MediaMetadata, identity: ParticipantIdentity, projectId?: string, waitingRoomEnabled?: boolean): Room {
    let code = this.code();
    while (this.rooms.has(code)) code = this.code();
    const hostParticipant: Participant = { id: participantId, role: 'host', socketId, media, identity };
    const room: Room = {
      sessionId: randomUUID(),
      code,
      startedAt: Date.now(),
      projectId,
      waitingRoomEnabled: Boolean(waitingRoomEnabled),
      isLocked: false,
      hostIdentity: identity,
      participants: new Map([[participantId, hostParticipant]]),
      waitingParticipants: new Map(),
      allJoinedParticipants: new Map([[participantId, identity]]),
      chatMessagesCount: 0,
      events: [],
      expiresAt: Date.now() + this.ttlMs
    };
    this.rooms.set(code, room);
    return room;
  }

  join(code: string, participantId: string, socketId: string, media: MediaMetadata, identity: ParticipantIdentity):
    | { ok: true; room: Room; participant: Participant; reconnected: boolean; waiting?: false }
    | { ok: true; room: Room; participant: Participant; waiting: true }
    | { ok: false; reason: 'INVALID_CODE' | 'ROOM_FULL' | 'ROOM_LOCKED' } {
    const room = this.rooms.get(code);
    if (!room || room.expiresAt < Date.now()) {
      if (room) this.close(code);
      return { ok: false, reason: 'INVALID_CODE' };
    }
    const existing = room.participants.get(participantId);
    if (existing) {
      if (existing.timer) clearTimeout(existing.timer);
      existing.timer = undefined;
      existing.socketId = socketId;
      existing.media = media;
      existing.identity = identity;
      room.allJoinedParticipants.set(participantId, identity);
      return { ok: true, room, participant: existing, reconnected: true, waiting: false };
    }

    if (room.isLocked) {
      return { ok: false, reason: 'ROOM_LOCKED' };
    }

    if (room.waitingRoomEnabled) {
      const waitingParticipant: Participant = { id: participantId, role: 'guest', socketId, media, identity };
      room.waitingParticipants.set(participantId, waitingParticipant);
      return { ok: true, room, participant: waitingParticipant, waiting: true };
    }

    if (room.participants.size >= 2) return { ok: false, reason: 'ROOM_FULL' };
    const participant: Participant = { id: participantId, role: 'guest', socketId, media, identity };
    room.participants.set(participantId, participant);
    room.allJoinedParticipants.set(participantId, identity);
    return { ok: true, room, participant, reconnected: false, waiting: false };
  }

  admit(code: string, participantId: string):
    | { ok: true; room: Room; participant: Participant }
    | { ok: false; reason: 'NOT_FOUND' | 'ROOM_FULL' } {
    const room = this.rooms.get(code);
    if (!room) return { ok: false, reason: 'NOT_FOUND' };
    const waiting = room.waitingParticipants.get(participantId);
    if (!waiting) return { ok: false, reason: 'NOT_FOUND' };
    if (room.participants.size >= 2) return { ok: false, reason: 'ROOM_FULL' };

    room.waitingParticipants.delete(participantId);
    room.participants.set(participantId, waiting);
    room.allJoinedParticipants.set(participantId, waiting.identity);
    return { ok: true, room, participant: waiting };
  }

  incrementChat(code: string): void {
    const room = this.rooms.get(code);
    if (room) room.chatMessagesCount = (room.chatMessagesCount || 0) + 1;
  }

  recordActivity(code: string, event: SessionSummaryEvent): void {
    const room = this.rooms.get(code);
    if (room) room.events.push(event);
  }

  removeWaiting(code: string, participantId: string): boolean {
    const room = this.rooms.get(code);
    if (!room) return false;
    return room.waitingParticipants.delete(participantId);
  }

  setLocked(code: string, locked: boolean): { ok: true; room: Room } | { ok: false; reason: 'NOT_FOUND' } {
    const room = this.rooms.get(code);
    if (!room) return { ok: false, reason: 'NOT_FOUND' };
    room.isLocked = Boolean(locked);
    return { ok: true, room };
  }

  removeParticipant(code: string, participantId: string):
    | { ok: true; room: Room; removed: Participant; peer?: Participant }
    | { ok: false; reason: 'NOT_FOUND' | 'CANNOT_REMOVE_HOST' } {
    const room = this.rooms.get(code);
    if (!room) return { ok: false, reason: 'NOT_FOUND' };
    const target = room.participants.get(participantId);
    if (!target) return { ok: false, reason: 'NOT_FOUND' };
    if (target.role === 'host') return { ok: false, reason: 'CANNOT_REMOVE_HOST' };

    if (target.timer) clearTimeout(target.timer);
    room.participants.delete(participantId);
    const peer = this.peer(room, participantId);
    return { ok: true, room, removed: target, peer };
  }

  peer(room: Room, participantId: string): Participant | undefined {
    return [...room.participants.values()].find((participant) => participant.id !== participantId);
  }

  disconnect(code: string, participantId: string, onExpired: (role: MeetingRole, peer?: Participant) => void): void {
    const room = this.rooms.get(code);
    const participant = room?.participants.get(participantId);
    if (!room || !participant) return;
    participant.socketId = null;
    if (participant.timer) clearTimeout(participant.timer);
    participant.timer = setTimeout(() => {
      const current = room.participants.get(participantId);
      if (!current || current.socketId) return;
      const peer = this.peer(room, participantId);
      if (current.role === 'host') this.close(code);
      else room.participants.delete(participantId);
      onExpired(current.role, peer);
    }, this.graceMs);
  }

  leave(code: string, participantId: string): { role: MeetingRole; peer?: Participant } | undefined {
    const room = this.rooms.get(code);
    const participant = room?.participants.get(participantId);
    if (!room || !participant) return undefined;
    if (participant.timer) clearTimeout(participant.timer);
    const peer = this.peer(room, participantId);
    if (participant.role === 'host') this.close(code);
    else room.participants.delete(participantId);
    return { role: participant.role, peer };
  }

  close(code: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    for (const participant of room.participants.values()) if (participant.timer) clearTimeout(participant.timer);
    for (const participant of room.waitingParticipants.values()) if (participant.timer) clearTimeout(participant.timer);
    this.rooms.delete(code);
  }
}
