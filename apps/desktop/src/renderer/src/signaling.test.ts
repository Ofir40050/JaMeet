import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SignalingClient } from './signaling';

const mockSocket = {
  connected: false,
  on: vi.fn(),
  off: vi.fn(),
  once: vi.fn(),
  emit: vi.fn(),
  timeout: vi.fn().mockReturnThis(),
  connect: vi.fn(),
  disconnect: vi.fn()
};

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => mockSocket)
}));

describe('SignalingClient Reconnect Identity Preservation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSocket.connected = true;
    mockSocket.timeout.mockReturnValue({
      emit: vi.fn((event: string, payload: any, callback: (err: any, res: any) => void) => {
        if (event === 'meeting:create') {
          callback(null, {
            ok: true,
            code: 'SESSION12',
            role: 'host',
            iceServers: [],
            peerPresent: false,
            identity: { id: 'host-id', displayName: 'Dan Beats', isGuest: false, isHost: true, avatarColor: '#06b6d4' },
            hostIdentity: { id: 'host-id', displayName: 'Dan Beats', isGuest: false, isHost: true, avatarColor: '#06b6d4' },
            reconnectToken: 'host-reconnect-token-123'
          });
        } else if (event === 'meeting:join') {
          callback(null, {
            ok: true,
            code: payload.code,
            role: 'guest',
            iceServers: [],
            peerPresent: true,
            identity: { id: 'guest-id', displayName: payload.guestDisplayName || 'Sarah Vocals', isGuest: !payload.authToken, isHost: false, avatarColor: '#64748b' },
            hostIdentity: { id: 'host-id', displayName: 'Dan Beats', isGuest: false, isHost: true, avatarColor: '#06b6d4' },
            reconnectToken: 'guest-reconnect-token-456'
          });
        }
      })
    });
  });

  const media = {
    audioSources: [{ id: 'primary', purpose: 'primary' as const, mode: 'talk' as const, enabled: true }],
    cameraEnabled: true
  };

  it('preserves registered user authToken and reconnectToken in resume state on create', async () => {
    const client = new SignalingClient('http://localhost:3000');
    const connectHandler = mockSocket.on.mock.calls.find(([event]) => event === 'connect')?.[1];
    expect(connectHandler).toBeDefined();

    const ack = await client.create('participant-host', media, 'auth-token-host', undefined, undefined, false);
    expect(ack.ok).toBe(true);

    // Simulate socket reconnect
    mockSocket.timeout.mockReturnValue({
      emit: vi.fn((event: string, payload: any, callback: any) => {
        expect(event).toBe('meeting:join');
        expect(payload).toMatchObject({
          code: 'SESSION12',
          participantId: 'participant-host',
          authToken: 'auth-token-host',
          reconnectToken: 'host-reconnect-token-123'
        });
        callback(null, { ok: true });
      })
    });

    connectHandler();
  });

  it('preserves guest display name and reconnectToken in resume state on join', async () => {
    const client = new SignalingClient('http://localhost:3000');
    const connectHandler = mockSocket.on.mock.calls.find(([event]) => event === 'connect')?.[1];

    const ack = await client.join('SESSION12', 'participant-guest', media, undefined, 'Guest Guitarist');
    expect(ack.ok).toBe(true);

    // Simulate socket reconnect
    mockSocket.timeout.mockReturnValue({
      emit: vi.fn((event: string, payload: any, callback: any) => {
        expect(event).toBe('meeting:join');
        expect(payload).toMatchObject({
          code: 'SESSION12',
          participantId: 'participant-guest',
          guestDisplayName: 'Guest Guitarist',
          reconnectToken: 'guest-reconnect-token-456'
        });
        callback(null, { ok: true });
      })
    });

    connectHandler();
  });

  it('preserves identity on setResume for admitted waiting room participants', async () => {
    const client = new SignalingClient('http://localhost:3000');
    const connectHandler = mockSocket.on.mock.calls.find(([event]) => event === 'connect')?.[1];

    client.setResume('SESSION12', 'participant-waiting', media, 'user-token-789', undefined, 'reconnect-token-789');

    // Simulate socket reconnect
    mockSocket.timeout.mockReturnValue({
      emit: vi.fn((event: string, payload: any, callback: any) => {
        expect(event).toBe('meeting:join');
        expect(payload).toMatchObject({
          code: 'SESSION12',
          participantId: 'participant-waiting',
          authToken: 'user-token-789',
          reconnectToken: 'reconnect-token-789'
        });
        callback(null, { ok: true });
      })
    });

    connectHandler();
  });

  it('preserves resume state and reconnects while participant is in waiting room', async () => {
    mockSocket.timeout.mockReturnValue({
      emit: vi.fn((event: string, payload: any, callback: any) => {
        if (event === 'meeting:join') {
          callback(null, {
            ok: true,
            code: payload.code,
            role: 'guest',
            waiting: true,
            iceServers: [],
            peerPresent: false,
            identity: { id: 'waiting-guest-id', displayName: payload.guestDisplayName || 'Waiting Musician', isGuest: true, isHost: false, avatarColor: '#64748b' },
            hostIdentity: { id: 'host-id', displayName: 'Dan Beats', isGuest: false, isHost: true, avatarColor: '#06b6d4' },
            reconnectToken: 'waiting-server-token-999'
          });
        }
      })
    });

    const client = new SignalingClient('http://localhost:3000');
    const connectHandler = mockSocket.on.mock.calls.find(([event]) => event === 'connect')?.[1];

    const ack = await client.join('SESSION12', 'participant-waiting-guest', media, undefined, 'Waiting Musician');
    expect(ack.ok).toBe(true);
    expect((ack as any).waiting).toBe(true);

    // Simulate socket reconnect while still waiting
    mockSocket.timeout.mockReturnValue({
      emit: vi.fn((event: string, payload: any, callback: any) => {
        expect(event).toBe('meeting:join');
        expect(payload).toMatchObject({
          code: 'SESSION12',
          participantId: 'participant-waiting-guest',
          guestDisplayName: 'Waiting Musician',
          reconnectToken: 'waiting-server-token-999'
        });
        callback(null, { ok: true, waiting: true, reconnectToken: 'waiting-server-token-999' });
      })
    });

    connectHandler();
  });

  it('clears resume on leave and disconnect', async () => {
    const client = new SignalingClient('http://localhost:3000');
    const connectHandler = mockSocket.on.mock.calls.find(([event]) => event === 'connect')?.[1];

    await client.create('participant-host', media, 'token', 'Host');
    client.leave();

    const emitSpy = vi.fn();
    mockSocket.timeout.mockReturnValue({ emit: emitSpy });

    connectHandler();
    expect(emitSpy).not.toHaveBeenCalledWith('meeting:join', expect.anything(), expect.anything());
  });
});
