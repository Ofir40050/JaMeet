import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomStore, MAX_WAITING_PARTICIPANTS } from './rooms.js';

const media = { audioSources: [{ id: 'primary', purpose: 'primary' as const, mode: 'talk' as const, enabled: true }], cameraEnabled: true };
const hostIdentity = { id: 'host-user', displayName: 'Host User', isGuest: false, isHost: true, avatarColor: '#06b6d4' };
const guestIdentity = { id: 'guest-user', displayName: 'Guest Musician', isGuest: true, isHost: false, avatarColor: '#64748b' };
const thirdIdentity = { id: 'third-user', displayName: 'Third User', isGuest: true, isHost: false, avatarColor: '#64748b' };

describe('room lifecycle', () => {
  afterEach(() => vi.useRealTimers());
  it('limits a room to two people and frees a guest slot', () => {
    const store = new RoomStore(30_000, 60_000);
    const room = store.create('host', 'socket-h', media, hostIdentity);
    expect(store.join(room.code, 'guest', 'socket-g', media, guestIdentity).ok).toBe(true);
    expect(store.join(room.code, 'third', 'socket-3', media, thirdIdentity)).toEqual({ ok: false, reason: 'ROOM_FULL' });
    expect(store.leave(room.code, 'guest')?.role).toBe('guest');
    expect(store.join(room.code, 'third', 'socket-3', media, thirdIdentity).ok).toBe(true);
  });

  it('allows reconnect within the grace period and closes when host expires', () => {
    vi.useFakeTimers();
    const store = new RoomStore(30_000, 60_000);
    const room = store.create('host', 'socket-h', media, hostIdentity);
    store.disconnect(room.code, 'host', () => undefined);
    vi.advanceTimersByTime(20_000);
    expect(store.join(room.code, 'host', 'socket-h2', media, hostIdentity)).toMatchObject({ ok: true, reconnected: true });
    store.disconnect(room.code, 'host', () => undefined);
    vi.advanceTimersByTime(30_000);
    expect(store.rooms.has(room.code)).toBe(false);
  });

  it('authorizes reconnect with valid reconnectToken and rejects unauthorized reconnect attempts', () => {
    const store = new RoomStore(30_000, 60_000);
    const room = store.create('host-id', 'socket-h', media, hostIdentity);
    const hostToken = room.participants.get('host-id')?.reconnectToken;
    expect(hostToken).toBeDefined();

    // 1. Guest joins and receives a participant entry with server-issued reconnectToken
    const guestJoin = store.join(room.code, 'guest-id', 'socket-g', media, guestIdentity);
    expect(guestJoin.ok).toBe(true);
    if (!guestJoin.ok || guestJoin.waiting) return;
    const guestToken = guestJoin.participant.reconnectToken;
    expect(guestToken).toBeDefined();

    // 2. Attacker attempts to reconnect to host slot with wrong/no token as guest -> rejected with UNAUTHORIZED
    const attackerHostTakeover = store.join(room.code, 'host-id', 'socket-attacker', media, thirdIdentity, 'wrong-token');
    expect(attackerHostTakeover).toEqual({ ok: false, reason: 'UNAUTHORIZED' });

    // 3. Attacker attempts to reconnect to guest slot with wrong/no token -> rejected with UNAUTHORIZED
    const attackerGuestTakeover = store.join(room.code, 'guest-id', 'socket-attacker', media, thirdIdentity);
    expect(attackerGuestTakeover).toEqual({ ok: false, reason: 'UNAUTHORIZED' });

    // 4. Legitimate guest reconnects with valid reconnectToken -> succeeds
    const legitimateGuestReconnect = store.join(room.code, 'guest-id', 'socket-g2', media, guestIdentity, guestToken);
    expect(legitimateGuestReconnect).toMatchObject({ ok: true, reconnected: true });

    // 5. Legitimate host reconnects with valid reconnectToken -> succeeds as host
    const legitimateHostReconnect = store.join(room.code, 'host-id', 'socket-h2', media, guestIdentity, hostToken);
    expect(legitimateHostReconnect).toMatchObject({ ok: true, reconnected: true, participant: { role: 'host' } });
  });

  it('authorizes authenticated user reconnect by matching identity ID', () => {
    const store = new RoomStore(30_000, 60_000);
    const room = store.create('host-id', 'socket-h', media, hostIdentity);

    // Reconnect with same non-guest identity.id even if reconnectToken omitted
    const reconnect = store.join(room.code, 'host-id', 'socket-h2', media, hostIdentity);
    expect(reconnect).toMatchObject({ ok: true, reconnected: true, participant: { role: 'host' } });

    // Different user trying to claim host slot without token -> rejected
    const imposterIdentity = { id: 'imposter-user', displayName: 'Imposter', isGuest: false, isHost: false, avatarColor: '#ec4899' };
    const imposter = store.join(room.code, 'host-id', 'socket-imposter', media, imposterIdentity);
    expect(imposter).toEqual({ ok: false, reason: 'UNAUTHORIZED' });
  });

  it('preserves registered identity and guest identity fields across reconnections', () => {
    const store = new RoomStore(30_000, 60_000);
    const hostUser = { id: 'reg-host-1', displayName: 'Host Dan', username: 'dan', isGuest: false, isHost: true, avatarColor: '#06b6d4' };
    const guestUser = { id: 'guest-random-uuid', displayName: 'Custom Guest', isGuest: true, isHost: false, avatarColor: '#64748b' };
    
    const room = store.create('host-part-id', 'socket-h1', media, hostUser);
    const hostToken = room.participants.get('host-part-id')?.reconnectToken;
    const guestJoinRes = store.join(room.code, 'guest-part-id', 'socket-g1', media, guestUser);
    expect(guestJoinRes.ok).toBe(true);
    if (!guestJoinRes.ok || guestJoinRes.waiting) return;
    const guestToken = guestJoinRes.participant.reconnectToken;

    // 1. Registered host reconnects (incoming identity has isHost: false from join handler)
    const hostJoinIdentity = { ...hostUser, isHost: false };
    const hostReconnected = store.join(room.code, 'host-part-id', 'socket-h2', media, hostJoinIdentity, hostToken);
    expect(hostReconnected.ok).toBe(true);
    if (hostReconnected.ok) {
      expect(hostReconnected.participant.identity.isHost).toBe(true);
      expect(hostReconnected.participant.identity.displayName).toBe('Host Dan');
      expect(hostReconnected.participant.identity.isGuest).toBe(false);
      expect(room.hostIdentity.displayName).toBe('Host Dan');
    }

    // 2. Guest reconnects with updated display name
    const guestReconnectIdentity = { id: 'new-temp-uuid', displayName: 'Custom Guest Renamed', isGuest: true, isHost: false, avatarColor: '#64748b' };
    const guestReconnected = store.join(room.code, 'guest-part-id', 'socket-g2', media, guestReconnectIdentity, guestToken);
    expect(guestReconnected.ok).toBe(true);
    if (guestReconnected.ok) {
      expect(guestReconnected.participant.identity.id).toBe('guest-random-uuid'); // Original guest UUID preserved
      expect(guestReconnected.participant.identity.displayName).toBe('Custom Guest Renamed');
      expect(guestReconnected.participant.identity.isGuest).toBe(true);
      expect(guestReconnected.participant.identity.isHost).toBe(false);
    }
  });

  it('handles waiting room participant reconnect securely and allows reconnect while session is locked', () => {
    const store = new RoomStore(30_000, 60_000);
    const hostUser = { id: 'host-1', displayName: 'Host Dan', isGuest: false, isHost: true, avatarColor: '#06b6d4' };
    const waitingUser = { id: 'wait-1', displayName: 'Waiting Musician', isGuest: true, isHost: false, avatarColor: '#64748b' };
    const attackerUser = { id: 'attacker-1', displayName: 'Attacker', isGuest: true, isHost: false, avatarColor: '#ec4899' };

    const room = store.create('host-id', 'socket-h', media, hostUser, undefined, true);

    // 1. Participant joins waiting room
    const firstJoin = store.join(room.code, 'waiting-participant-id', 'socket-w1', media, waitingUser);
    expect(firstJoin.ok).toBe(true);
    if (!firstJoin.ok || !firstJoin.waiting) return;
    const serverIssuedToken = firstJoin.participant.reconnectToken;
    expect(serverIssuedToken).toBeDefined();

    // 2. Host locks session
    store.setLocked(room.code, true);

    // 3. Attacker attempts to overwrite waiting participant without valid token -> rejected UNAUTHORIZED
    const attackerOverwrite = store.join(room.code, 'waiting-participant-id', 'socket-att', media, attackerUser, 'invalid-token');
    expect(attackerOverwrite).toEqual({ ok: false, reason: 'UNAUTHORIZED' });

    // 4. Attacker attempts to overwrite without any token -> rejected UNAUTHORIZED
    const attackerNoToken = store.join(room.code, 'waiting-participant-id', 'socket-att', media, attackerUser);
    expect(attackerNoToken).toEqual({ ok: false, reason: 'UNAUTHORIZED' });

    // 5. Legitimate waiting participant reconnects with server-issued token while locked -> SUCCEEDS (not blocked by lock)
    const legitReconnect = store.join(room.code, 'waiting-participant-id', 'socket-w2', media, waitingUser, serverIssuedToken);
    expect(legitReconnect).toMatchObject({
      ok: true,
      waiting: true,
      reconnected: true,
      participant: {
        id: 'waiting-participant-id',
        socketId: 'socket-w2',
        role: 'guest'
      }
    });

    // 6. Host admits the waiting participant
    const admitRes = store.admit(room.code, 'waiting-participant-id');
    expect(admitRes.ok).toBe(true);
    if (admitRes.ok) {
      expect(room.participants.has('waiting-participant-id')).toBe(true);
      expect(room.waitingParticipants.has('waiting-participant-id')).toBe(false);
    }
  });

  it('ensures brand new participants cannot forge client-supplied reconnect tokens', () => {
    const store = new RoomStore(30_000, 60_000);
    const hostUser = { id: 'host-1', displayName: 'Host Dan', isGuest: false, isHost: true, avatarColor: '#06b6d4' };
    const guestUser = { id: 'guest-1', displayName: 'Guest Musician', isGuest: true, isHost: false, avatarColor: '#64748b' };

    const room = store.create('host-id', 'socket-h', media, hostUser);

    // Client attempts to pass its own client-supplied reconnectToken on fresh join
    const clientProvidedToken = 'client-forged-token-xyz';
    const joinRes = store.join(room.code, 'fresh-guest-id', 'socket-g', media, guestUser, clientProvidedToken);
    expect(joinRes.ok).toBe(true);
    if (joinRes.ok && !joinRes.waiting) {
      // The server must NOT adopt the client-provided token for a new participant
      expect(joinRes.participant.reconnectToken).not.toBe(clientProvidedToken);
      expect(joinRes.participant.reconnectToken).toBeDefined();
    }
  });

  it('ignores disconnect and leave events from stale replaced sockets', () => {
    const store = new RoomStore(30_000, 60_000);
    const hostUser = { id: 'host-1', displayName: 'Host Dan', isGuest: false, isHost: true, avatarColor: '#06b6d4' };
    const room = store.create('host-id', 'socket-old-1', media, hostUser);

    // 1. Host reconnects on new socket
    const reconnectRes = store.join(room.code, 'host-id', 'socket-new-2', media, hostUser);
    expect(reconnectRes.ok).toBe(true);
    expect(room.participants.get('host-id')?.socketId).toBe('socket-new-2');

    // 2. Stale old socket fires disconnect -> must NOT clear socketId or start timer
    const expiredFn = vi.fn();
    store.disconnect(room.code, 'host-id', expiredFn, 'socket-old-1');
    expect(room.participants.get('host-id')?.socketId).toBe('socket-new-2');
    expect(room.participants.get('host-id')?.timer).toBeUndefined();

    // 3. Stale old socket fires leave -> must NOT close room or remove participant
    const leaveRes = store.leave(room.code, 'host-id', 'socket-old-1');
    expect(leaveRes).toBeUndefined();
    expect(store.rooms.has(room.code)).toBe(true);
    expect(room.participants.get('host-id')?.socketId).toBe('socket-new-2');

    // 4. Stale socket in waiting room
    const waitingUser = { id: 'wait-1', displayName: 'Waiting Musician', isGuest: true, isHost: false, avatarColor: '#64748b' };
    const waitRoom = store.create('host-2', 'socket-h2', media, hostUser, undefined, true);
    const waitJoin = store.join(waitRoom.code, 'waiting-part-1', 'socket-wait-old', media, waitingUser);
    expect(waitJoin.ok).toBe(true);
    if (!waitJoin.ok || !waitJoin.waiting) return;
    const waitToken = waitJoin.participant.reconnectToken;

    // Waiting participant reconnects on new socket
    const waitReconnect = store.join(waitRoom.code, 'waiting-part-1', 'socket-wait-new', media, waitingUser, waitToken);
    expect(waitReconnect.ok).toBe(true);
    expect(waitRoom.waitingParticipants.get('waiting-part-1')?.socketId).toBe('socket-wait-new');

    // Old waiting socket disconnects -> ignored
    store.disconnectWaiting(waitRoom.code, 'waiting-part-1', undefined, 'socket-wait-old');
    expect(waitRoom.waitingParticipants.get('waiting-part-1')?.socketId).toBe('socket-wait-new');
    expect(waitRoom.waitingParticipants.get('waiting-part-1')?.timer).toBeUndefined();

    // Old waiting socket leaves -> ignored
    const removeRes = store.removeWaiting(waitRoom.code, 'waiting-part-1', 'socket-wait-old');
    expect(removeRes).toBe(false);
    expect(waitRoom.waitingParticipants.has('waiting-part-1')).toBe(true);
  });

  it('prevents an authenticated account from creating multiple waiting entries in the same meeting', () => {
    const store = new RoomStore(30_000, 60_000);
    const hostUser = { id: 'host-acc', displayName: 'Host', isGuest: false, isHost: true, avatarColor: '#06b6d4' };
    const authGuestUser = { id: 'auth-guest-acc', displayName: 'Musician John', isGuest: false, isHost: false, avatarColor: '#ec4899' };
    
    const room = store.create('host-part', 'socket-host', media, hostUser, undefined, true);

    // 1. Authenticated user joins waiting room with participantId 1
    const join1 = store.join(room.code, 'wait-part-1', 'socket-guest-1', media, authGuestUser);
    expect(join1.ok).toBe(true);
    expect(room.waitingParticipants.size).toBe(1);
    expect(room.waitingParticipants.has('wait-part-1')).toBe(true);

    // 2. Same authenticated user joins with different participantId and different socket
    const join2 = store.join(room.code, 'wait-part-2', 'socket-guest-2', media, authGuestUser);
    expect(join2.ok).toBe(true);
    expect(join2).toMatchObject({ ok: true, waiting: true, reconnected: true });
    
    // Room still has exactly 1 waiting entry, rebound to the new participantId and socket
    expect(room.waitingParticipants.size).toBe(1);
    expect(room.waitingParticipants.has('wait-part-1')).toBe(false);
    expect(room.waitingParticipants.has('wait-part-2')).toBe(true);
    expect(room.waitingParticipants.get('wait-part-2')?.socketId).toBe('socket-guest-2');

    // 3. Host admits the user
    const admitRes = store.admit(room.code, 'wait-part-2');
    expect(admitRes.ok).toBe(true);
    expect(room.participants.get('wait-part-2')?.socketId).toBe('socket-guest-2');
    expect(room.waitingParticipants.size).toBe(0);
  });

  it('enforces maximum waiting room capacity (MAX_WAITING_PARTICIPANTS)', () => {
    const store = new RoomStore(30_000, 60_000);
    const hostUser = { id: 'host-acc', displayName: 'Host', isGuest: false, isHost: true, avatarColor: '#06b6d4' };
    const room = store.create('host-part', 'socket-host', media, hostUser, undefined, true);

    // Fill waiting room up to MAX_WAITING_PARTICIPANTS
    for (let i = 0; i < MAX_WAITING_PARTICIPANTS; i++) {
      const guest = { id: `guest-acc-${i}`, displayName: `Guest ${i}`, isGuest: false, isHost: false, avatarColor: '#64748b' };
      const joinRes = store.join(room.code, `wait-${i}`, `socket-${i}`, media, guest);
      expect(joinRes.ok).toBe(true);
    }
    expect(room.waitingParticipants.size).toBe(MAX_WAITING_PARTICIPANTS);

    // Attempting to add one more waiting participant -> rejected with ROOM_FULL
    const overflowGuest = { id: 'overflow-guest', displayName: 'Overflow', isGuest: false, isHost: false, avatarColor: '#64748b' };
    const overflowJoin = store.join(room.code, 'wait-overflow', 'socket-overflow', media, overflowGuest);
    expect(overflowJoin).toEqual({ ok: false, reason: 'ROOM_FULL' });
    expect(room.waitingParticipants.size).toBe(MAX_WAITING_PARTICIPANTS);

    // An existing waiting participant can still reconnect
    const existingGuest = { id: 'guest-acc-0', displayName: 'Guest 0', isGuest: false, isHost: false, avatarColor: '#64748b' };
    const reconnectRes = store.join(room.code, 'wait-0', 'socket-0-new', media, existingGuest);
    expect(reconnectRes.ok).toBe(true);
    expect(room.waitingParticipants.size).toBe(MAX_WAITING_PARTICIPANTS);
  });
});
