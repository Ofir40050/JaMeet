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

  it('correctly resyncs project workspace on Socket.IO reconnect using single-argument ack callback', async () => {
    const client = new SignalingClient('http://localhost:3000');
    const connectHandler = mockSocket.on.mock.calls.find(([event]) => event === 'connect')?.[1];
    expect(connectHandler).toBeDefined();

    const mockWorkspace = {
      lyrics: { activeDocumentId: 'doc-main', documents: [{ id: 'doc-main', title: 'Main', content: 'Verse 1', updatedAt: 12345 }], revision: 3 },
      notes: { content: 'BPM 120 Key C Major', bpm: '120', key: 'C Major', revision: 2 },
      structure: { sections: [], revision: 1 },
      tasks: { tasks: [], revision: 1 }
    };

    // Join project workspace
    mockSocket.timeout.mockReturnValue({
      emit: vi.fn((event: string, payload: any, callback: any) => {
        if (event === 'project:workspace:join') {
          callback(null, { ok: true, workspace: mockWorkspace });
        }
      })
    });

    await client.joinProjectWorkspace('proj-123', 'auth-token-123');

    // Register a listener for 'project:workspace:synced'
    const syncedHandler = vi.fn();
    client.on('project:workspace:synced', syncedHandler);

    // Mock the standard socket.emit for reconnect
    const updatedServerWorkspace = {
      ...mockWorkspace,
      lyrics: { ...mockWorkspace.lyrics, content: 'Updated lyrics on server during reconnect', revision: 4 }
    };

    mockSocket.emit.mockImplementation((event: string, payload: any, callback: any) => {
      if (event === 'project:workspace:join') {
        expect(payload).toEqual({ projectId: 'proj-123', authToken: 'auth-token-123' });
        // Standard Socket.IO server ack invokes callback with single response argument
        callback({ ok: true, workspace: updatedServerWorkspace });
      }
    });

    // Mock listeners method on socket
    (mockSocket as any).listeners = vi.fn().mockImplementation((event: string) => {
      if (event === 'project:workspace:synced') return [syncedHandler];
      return [];
    });

    // Trigger reconnect
    connectHandler();

    // Verify the returned authoritative workspace is dispatched to the sync listener
    expect(syncedHandler).toHaveBeenCalledWith({
      projectId: 'proj-123',
      workspace: updatedServerWorkspace
    });
  });

  it('does not attempt workspace resync on reconnect after leaving project workspace', async () => {
    const client = new SignalingClient('http://localhost:3000');
    const connectHandler = mockSocket.on.mock.calls.find(([event]) => event === 'connect')?.[1];

    mockSocket.timeout.mockReturnValue({
      emit: vi.fn((event: string, payload: any, callback: any) => {
        if (event === 'project:workspace:join') {
          callback(null, { ok: true, workspace: {} });
        }
      })
    });

    await client.joinProjectWorkspace('proj-456', 'auth-token-456');
    client.leaveProjectWorkspace('proj-456');

    const emitSpy = vi.fn();
    mockSocket.emit = emitSpy;

    // Trigger reconnect
    connectHandler();

    expect(emitSpy).not.toHaveBeenCalledWith('project:workspace:join', expect.anything(), expect.anything());
  });
});
