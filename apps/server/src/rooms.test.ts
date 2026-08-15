import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomStore } from './rooms.js';

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
});
