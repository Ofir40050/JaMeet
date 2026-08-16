import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { io as client, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import type { MeetingAck } from '@jameet/shared';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { UserStore } from './auth.js';

const sockets: Socket[] = [];
const media = { audioSources: [{ id: 'primary', purpose: 'primary' as const, mode: 'music' as const, enabled: true, channels: 2 }], cameraEnabled: true };

async function connected(url: string): Promise<Socket> {
  const socket = client(url, { transports: ['websocket'], forceNew: true });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => { socket.once('connect', () => resolve()); socket.once('connect_error', reject); });
  return socket;
}
function ack(socket: Socket, event: string, payload: unknown): Promise<MeetingAck> {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

async function createTestAccount(url: string, username: string, access: 'beta' | 'paid' | 'blocked' = 'beta', userStore?: UserStore) {
  const suffix = `${Date.now().toString(36).slice(-4)}_${Math.random().toString(36).slice(2, 6)}`;
  const cleanPrefix = username.slice(0, 12);
  const uName = `${cleanPrefix}_${suffix}`;
  const uEmail = `${cleanPrefix}_${suffix}@test.com`;
  const res = await fetch(`${url}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: uName,
      email: uEmail,
      password: 'StrongPassword123!',
      displayName: `User ${username}`
    })
  });
  const data = await res.json() as any;
  if (!data.user) {
    throw new Error(`Failed to create test account ${uName}: ${JSON.stringify(data)}`);
  }
  if (access !== 'blocked' && userStore) {
    userStore.setSessionAccess(data.user.id, access);
  }
  return { token: data.token as string, user: data.user };
}

describe('signaling integration', () => {
  afterEach(() => { for (const socket of sockets.splice(0)) socket.disconnect(); });

  it('creates, joins, relays signaling, rejects a third person, and handles leave', async () => {
    const { app, io, userStore } = await createApp(loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'a-secure-test-secret' }));
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}`;
    try {
      const hostUser = await createTestAccount(url, 'host_u1', 'beta', userStore);
      const guestUser = await createTestAccount(url, 'guest_u1', 'beta', userStore);
      const thirdUser = await createTestAccount(url, 'third_u1', 'beta', userStore);
      const host = await connected(url);
      const guest = await connected(url);
      const third = await connected(url);
      const created = await ack(host, 'meeting:create', { participantId: '11111111-1111-4111-8111-111111111111', authToken: hostUser.token, media });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const peerReady = new Promise<{ media: typeof media }>((resolve) => host.once('peer:ready', resolve));
      const joined = await ack(guest, 'meeting:join', { code: created.code, participantId: '22222222-2222-4222-8222-222222222222', authToken: guestUser.token, media });
      expect(joined).toMatchObject({ ok: true, role: 'guest', peerPresent: true });
      expect((await peerReady).media.audioSources[0]?.mode).toBe('music');
      expect(await ack(third, 'meeting:join', { code: created.code, participantId: '33333333-3333-4333-8333-333333333333', authToken: thirdUser.token, media })).toMatchObject({ ok: false, code: 'ROOM_FULL' });

      const description = new Promise<{ type: string; sdp: string }>((resolve) => guest.once('signal:description', resolve));
      host.emit('signal:description', { code: created.code, description: { type: 'offer', sdp: 'v=0' } });
      const chatReceived = new Promise<{ senderName: string; text: string }>((resolve) => guest.once('chat:message', resolve));
      const chatAck = await new Promise<{ ok: boolean; message?: any }>((resolve) => {
        host.emit('chat:send', { code: created.code, text: 'Hello live session' }, resolve);
      });
      expect(chatAck.ok).toBe(true);
      expect(chatAck.message?.text).toBe('Hello live session');
      const receivedMsg = await chatReceived;
      expect(receivedMsg.text).toBe('Hello live session');

      const left = new Promise<void>((resolve) => host.once('peer:left', () => resolve()));
      guest.emit('meeting:leave');
      await left;
    } finally {
      io.close();
      await app.close();
    }
  });

  it('isolates waiting room participant until host admits them', async () => {
    const { app, io, userStore } = await createApp(loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'a-secure-test-secret' }));
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}`;
    try {
      const hostUser = await createTestAccount(url, 'host_w1', 'beta', userStore);
      const guestUser = await createTestAccount(url, 'guest_w1', 'beta', userStore);
      const host = await connected(url);
      const guest = await connected(url);
      const guestId = '22222222-2222-4222-8222-222222222222';

      // 1. Host creates room with Waiting Room enabled
      const created = await ack(host, 'meeting:create', {
        participantId: '11111111-1111-4111-8111-111111111111',
        authToken: hostUser.token,
        media,
        waitingRoomEnabled: true
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // 2. Guest joins - should receive waiting: true
      const waitingUpdatePromise = new Promise<any[]>((resolve) => host.once('waiting:update', resolve));
      const joined = await ack(guest, 'meeting:join', { code: created.code, participantId: guestId, authToken: guestUser.token, media });
      expect(joined).toMatchObject({ ok: true, waiting: true, role: 'guest' });

      // 3. Host receives waiting list notification with guest
      const waitingList = await waitingUpdatePromise;
      expect(waitingList.length).toBe(1);
      expect(waitingList[0]?.participantId).toBe(guestId);

      // 4. Verify guest does NOT receive live session chat while waiting
      let guestReceivedPrematureChat = false;
      guest.on('chat:message', () => { guestReceivedPrematureChat = true; });
      await new Promise<{ ok: boolean }>((resolve) => {
        host.emit('chat:send', { code: created.code, text: 'Secret in-call chat' }, resolve);
      });
      // Brief tick to ensure no leak
      await new Promise((r) => setTimeout(r, 20));
      expect(guestReceivedPrematureChat).toBe(false);

      // 5. Host admits the waiting guest
      const admittedPromise = new Promise<MeetingAck>((resolve) => guest.once('waiting:admitted', resolve));
      const hostPeerReady = new Promise<any>((resolve) => host.once('peer:ready', resolve));
      const hostWaitingUpdated = new Promise<any[]>((resolve) => host.once('waiting:update', resolve));

      const admitAck = await new Promise<{ ok: boolean }>((resolve) => {
        host.emit('waiting:admit', { code: created.code, participantId: guestId }, resolve);
      });
      expect(admitAck.ok).toBe(true);

      // 6. Guest receives admitted payload with full session access
      const admittedAck = await admittedPromise;
      expect(admittedAck.ok).toBe(true);
      if (admittedAck.ok) {
        expect(admittedAck.peerPresent).toBe(true);
      }
      expect((await hostPeerReady).identity).toBeDefined();
      expect((await hostWaitingUpdated).length).toBe(0);

      // 7. Now guest receives live chat
      const chatAfterAdmit = new Promise<{ text: string }>((resolve) => guest.once('chat:message', resolve));
      host.emit('chat:send', { code: created.code, text: 'Welcome to the session!' });
      const received = await chatAfterAdmit;
      expect(received.text).toBe('Welcome to the session!');
    } finally {
      io.close();
      await app.close();
    }
  });

  it('handles locking and unlocking session with server-side authorization and reconnects', async () => {
    const { app, io, userStore } = await createApp(loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'a-secure-test-secret' }));
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}`;
    try {
      const hostUser = await createTestAccount(url, 'host_lock', 'beta', userStore);
      const guestUser = await createTestAccount(url, 'guest_lock', 'beta', userStore);
      const thirdUser = await createTestAccount(url, 'third_lock', 'beta', userStore);
      const host = await connected(url);
      const guest = await connected(url);
      const third = await connected(url);
      const hostId = '11111111-1111-4111-8111-111111111111';
      const guestId = '22222222-2222-4222-8222-222222222222';
      const thirdId = '33333333-3333-4333-8333-333333333333';

      // 1. Host creates room
      const created = await ack(host, 'meeting:create', { participantId: hostId, authToken: hostUser.token, media, waitingRoomEnabled: true });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // 2. Guest joins and is in waiting room
      const guestWaiting = await ack(guest, 'meeting:join', { code: created.code, participantId: guestId, authToken: guestUser.token, media });
      expect(guestWaiting).toMatchObject({ ok: true, waiting: true });

      // 3. Host locks session
      const lockedEventPromise = new Promise<any>((resolve) => guest.once('session:locked', resolve));
      const lockRes = await new Promise<{ ok: boolean; locked?: boolean }>((resolve) => {
        host.emit('meeting:lock', { code: created.code, locked: true }, resolve);
      });
      expect(lockRes).toMatchObject({ ok: true, locked: true });

      // 4. Non-host (guest) tries to unlock -> fails authorization
      const unauthorizedUnlock = await new Promise<{ ok: boolean; message?: string }>((resolve) => {
        guest.emit('meeting:lock', { code: created.code, locked: false }, resolve);
      });
      expect(unauthorizedUnlock.ok).toBe(false);

      // 5. New participant (third) tries to join while locked -> rejected with ROOM_LOCKED
      const thirdJoin = await ack(third, 'meeting:join', { code: created.code, participantId: thirdId, authToken: thirdUser.token, media });
      expect(thirdJoin).toMatchObject({ ok: false, code: 'ROOM_LOCKED' });

      // 6. Already waiting guest can still be admitted while locked
      const admittedPromise = new Promise<MeetingAck>((resolve) => guest.once('waiting:admitted', resolve));
      const admitRes = await new Promise<{ ok: boolean }>((resolve) => {
        host.emit('waiting:admit', { code: created.code, participantId: guestId }, resolve);
      });
      expect(admitRes.ok).toBe(true);
      const admittedAck = await admittedPromise;
      expect(admittedAck.ok).toBe(true);

      // 7. Previously admitted guest temporarily disconnects and reconnects while still locked
      guest.disconnect();
      // Reconnect guest socket
      const guestReconnected = await connected(url);
      const rejoinAck = await ack(guestReconnected, 'meeting:join', {
        code: created.code,
        participantId: guestId,
        authToken: guestUser.token,
        media,
        reconnectToken: (admittedAck as any).reconnectToken
      });
      expect(rejoinAck).toMatchObject({ ok: true, role: 'guest', peerPresent: true });

      // 8. Host unlocks session -> new participant (third) can now enter
      const unlockRes = await new Promise<{ ok: boolean; locked?: boolean }>((resolve) => {
        host.emit('meeting:lock', { code: created.code, locked: false }, resolve);
      });
      expect(unlockRes).toMatchObject({ ok: true, locked: false });
    } finally {
      io.close();
      await app.close();
    }
  });

  it('handles host removing participant, revoking reconnect bypass, and notifying remaining peers', async () => {
    const { app, io, userStore } = await createApp(loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'a-secure-test-secret' }));
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}`;
    try {
      const hostUser = await createTestAccount(url, 'host_rem', 'beta', userStore);
      const guestUser = await createTestAccount(url, 'guest_rem', 'beta', userStore);
      const host = await connected(url);
      const guest = await connected(url);
      const hostId = '11111111-1111-4111-8111-111111111111';
      const guestId = '22222222-2222-4222-8222-222222222222';

      // 1. Host creates room with Waiting Room enabled
      const created = await ack(host, 'meeting:create', { participantId: hostId, authToken: hostUser.token, media, waitingRoomEnabled: true });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // 2. Guest joins and is admitted by host
      await ack(guest, 'meeting:join', { code: created.code, participantId: guestId, authToken: guestUser.token, media });
      const admittedPromise = new Promise<MeetingAck>((resolve) => guest.once('waiting:admitted', resolve));
      await new Promise<{ ok: boolean }>((resolve) => {
        host.emit('waiting:admit', { code: created.code, participantId: guestId }, resolve);
      });
      const admittedAck = await admittedPromise;
      expect(admittedAck.ok).toBe(true);

      // 3. Guest tries to remove host -> unauthorized
      const guestRemoveRes = await new Promise<{ ok: boolean; message?: string }>((resolve) => {
        guest.emit('meeting:removeParticipant', { code: created.code, participantId: hostId }, resolve);
      });
      expect(guestRemoveRes.ok).toBe(false);

      // 4. Host tries to remove self -> cannot remove host
      const hostSelfRemove = await new Promise<{ ok: boolean; message?: string }>((resolve) => {
        host.emit('meeting:removeParticipant', { code: created.code, participantId: hostId }, resolve);
      });
      expect(hostSelfRemove.ok).toBe(false);

      // 5. Host removes guest using canonical participantId
      const removedPromise = new Promise<{ code: string; message: string }>((resolve) => guest.once('meeting:removed', resolve));
      const hostPeerLeftPromise = new Promise<void>((resolve) => host.once('peer:left', resolve));

      const removeAck = await new Promise<{ ok: boolean }>((resolve) => {
        host.emit('meeting:removeParticipant', { code: created.code, participantId: guestId }, resolve);
      });
      expect(removeAck.ok).toBe(true);

      // 6. Guest receives meeting:removed event and host receives peer:left
      const removedPayload = await removedPromise;
      expect(removedPayload.message).toContain('removed from the session by the host');
      await hostPeerLeftPromise;

      // 7. Removed guest tries to send chat message -> fails because socket session data is wiped
      const chatRes = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
        guest.emit('chat:send', { code: created.code, text: 'Hello?' }, resolve);
      });
      expect(chatRes.ok).toBe(false);

      // 8. Removed guest attempts to reconnect -> NOT treated as reconnected bypass; enters waiting room as fresh join
      const guestRejoin = await ack(guest, 'meeting:join', { code: created.code, participantId: guestId, authToken: guestUser.token, media });
      expect(guestRejoin).toMatchObject({ ok: true, waiting: true });
    } finally {
      io.close();
      await app.close();
    }
  });

  it('supports JaMeet and legacy MusicZoom application origins for REST CORS and Socket.IO signaling', async () => {
    const { app, io } = await createApp(loadConfig({
      NODE_ENV: 'test',
      ALLOWED_ORIGINS: 'jameet-app://bundle,musiczoom-app://bundle',
      TURN_SHARED_SECRET: 'a-secure-test-secret'
    }));
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}`;
    try {
      // Test REST CORS with jameet-app://bundle
      const jameetRestRes = await app.inject({
        method: 'GET',
        url: '/healthz',
        headers: { origin: 'jameet-app://bundle' }
      });
      expect(jameetRestRes.statusCode).toBe(200);
      expect(jameetRestRes.headers['access-control-allow-origin']).toBe('jameet-app://bundle');

      // Test REST CORS with legacy musiczoom-app://bundle
      const legacyRestRes = await app.inject({
        method: 'GET',
        url: '/healthz',
        headers: { origin: 'musiczoom-app://bundle' }
      });
      expect(legacyRestRes.statusCode).toBe(200);
      expect(legacyRestRes.headers['access-control-allow-origin']).toBe('musiczoom-app://bundle');

      // Test Socket.IO polling connection with jameet-app://bundle origin
      const jameetSocket = client(url, {
        transports: ['polling'],
        forceNew: true,
        extraHeaders: {
          Origin: 'jameet-app://bundle'
        }
      });
      sockets.push(jameetSocket);
      await new Promise<void>((resolve, reject) => {
        jameetSocket.once('connect', () => resolve());
        jameetSocket.once('connect_error', reject);
      });
      expect(jameetSocket.connected).toBe(true);

      // Test Socket.IO polling connection with legacy musiczoom-app://bundle origin
      const legacySocket = client(url, {
        transports: ['polling'],
        forceNew: true,
        extraHeaders: {
          Origin: 'musiczoom-app://bundle'
        }
      });
      sockets.push(legacySocket);
      await new Promise<void>((resolve, reject) => {
        legacySocket.once('connect', () => resolve());
        legacySocket.once('connect_error', reject);
      });
      expect(legacySocket.connected).toBe(true);
    } finally {
      io.close();
      await app.close();
    }
  });

  it('strictly enforces ALLOWED_ORIGINS as authoritative in production mode', async () => {
    const { app, io } = await createApp(loadConfig({
      NODE_ENV: 'production',
      ALLOWED_ORIGINS: 'jameet-app://bundle,musiczoom-app://bundle,http://localhost:5173',
      TURN_SHARED_SECRET: 'a-secure-test-secret-at-least-32-chars!'
    }));
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}`;
    try {
      // 1. Configured origins are allowed
      const jameetRes = await app.inject({
        method: 'GET',
        url: '/healthz',
        headers: { origin: 'jameet-app://bundle' }
      });
      expect(jameetRes.statusCode).toBe(200);
      expect(jameetRes.headers['access-control-allow-origin']).toBe('jameet-app://bundle');

      const legacyRes = await app.inject({
        method: 'GET',
        url: '/healthz',
        headers: { origin: 'musiczoom-app://bundle' }
      });
      expect(legacyRes.statusCode).toBe(200);
      expect(legacyRes.headers['access-control-allow-origin']).toBe('musiczoom-app://bundle');

      const localhostRes = await app.inject({
        method: 'GET',
        url: '/healthz',
        headers: { origin: 'http://localhost:5173' }
      });
      expect(localhostRes.statusCode).toBe(200);
      expect(localhostRes.headers['access-control-allow-origin']).toBe('http://localhost:5173');

      // 2. Unconfigured origins are rejected (even if they start with localhost or jameet-app://)
      const unconfiguredLocalhostRes = await app.inject({
        method: 'GET',
        url: '/healthz',
        headers: { origin: 'http://localhost:3000' }
      });
      expect(unconfiguredLocalhostRes.statusCode).toBe(200);
      expect(unconfiguredLocalhostRes.headers['access-control-allow-origin']).toBeUndefined();

      const unconfiguredAppRes = await app.inject({
        method: 'GET',
        url: '/healthz',
        headers: { origin: 'jameet-app://malicious' }
      });
      expect(unconfiguredAppRes.statusCode).toBe(200);
      expect(unconfiguredAppRes.headers['access-control-allow-origin']).toBeUndefined();

      const evilRes = await app.inject({
        method: 'GET',
        url: '/healthz',
        headers: { origin: 'https://evil.com' }
      });
      expect(evilRes.statusCode).toBe(200);
      expect(evilRes.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      io.close();
      await app.close();
    }
  });

  it('validates Socket.IO workspace updates against shared schema, rejects invalid payloads cleanly, and syncs valid updates', async () => {
    const { app, io, userStore, projectStore } = await createApp(loadConfig({
      NODE_ENV: 'test',
      TURN_SHARED_SECRET: 'a-secure-test-secret'
    }));
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}`;

    try {
      // 1. Create owner, collaborator, and unauthorized stranger
      const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const ownerAuth = await userStore.register({
        username: `owner_${suffix}`,
        email: `owner_${suffix}@example.com`,
        password: 'password123',
        displayName: 'Socket Owner'
      });
      const collabAuth = await userStore.register({
        username: `collab_${suffix}`,
        email: `collab_${suffix}@example.com`,
        password: 'password123',
        displayName: 'Socket Collab'
      });
      const strangerAuth = await userStore.register({
        username: `stranger_${suffix}`,
        email: `stranger_${suffix}@example.com`,
        password: 'password123',
        displayName: 'Socket Stranger'
      });

      const project = projectStore.createProject(ownerAuth.user, { name: 'Socket Sync Project' }, [collabAuth.user]);
      expect(project).toBeDefined();

      const ownerSocket = await connected(url);
      const collabSocket = await connected(url);
      const strangerSocket = await connected(url);

      // Join workspace rooms
      const ownerJoin = await new Promise<{ ok: boolean; workspace?: any }>((resolve) => {
        ownerSocket.emit('project:workspace:join', { projectId: project.id, authToken: ownerAuth.token }, resolve);
      });
      expect(ownerJoin.ok).toBe(true);

      const collabJoin = await new Promise<{ ok: boolean; workspace?: any }>((resolve) => {
        collabSocket.emit('project:workspace:join', { projectId: project.id, authToken: collabAuth.token }, resolve);
      });
      expect(collabJoin.ok).toBe(true);

      // 2. Reject unauthorized user (stranger)
      const strangerUpdateRes = await new Promise<{ ok: boolean; message?: string }>((resolve) => {
        strangerSocket.emit('project:workspace:update', {
          projectId: project.id,
          authToken: strangerAuth.token,
          updates: { notes: { content: 'Hacked by stranger' } }
        }, resolve);
      });
      expect(strangerUpdateRes.ok).toBe(false);
      expect(strangerUpdateRes.message).toBe('Unauthorized');

      // 3. Reject invalid payload: missing projectId or updates
      const missingPayloadRes = await new Promise<{ ok: boolean; message?: string }>((resolve) => {
        ownerSocket.emit('project:workspace:update', {
          authToken: ownerAuth.token
        }, resolve);
      });
      expect(missingPayloadRes.ok).toBe(false);
      expect(missingPayloadRes.message).toBe('Invalid payload');

      // 4. Reject invalid schema payload: invalid task status
      const invalidTaskStatusRes = await new Promise<{ ok: boolean; message?: string }>((resolve) => {
        ownerSocket.emit('project:workspace:update', {
          projectId: project.id,
          authToken: ownerAuth.token,
          updates: {
            tasks: {
              tasks: [{ id: 'task-1', title: 'Task 1', status: 'invalid_status', createdAt: Date.now(), updatedAt: Date.now() }]
            }
          }
        }, resolve);
      });
      expect(invalidTaskStatusRes.ok).toBe(false);
      expect(invalidTaskStatusRes.message).toBe('Invalid workspace update payload.');

      // 5. Reject invalid schema payload: empty task title
      const emptyTaskTitleRes = await new Promise<{ ok: boolean; message?: string }>((resolve) => {
        ownerSocket.emit('project:workspace:update', {
          projectId: project.id,
          authToken: ownerAuth.token,
          updates: {
            tasks: {
              tasks: [{ id: 'task-1', title: '', status: 'todo', createdAt: Date.now(), updatedAt: Date.now() }]
            }
          }
        }, resolve);
      });
      expect(emptyTaskTitleRes.ok).toBe(false);
      expect(emptyTaskTitleRes.message).toBe('Invalid workspace update payload.');

      // 6. Reject invalid schema payload: structure section with negative bars
      const negativeBarsRes = await new Promise<{ ok: boolean; message?: string }>((resolve) => {
        ownerSocket.emit('project:workspace:update', {
          projectId: project.id,
          authToken: ownerAuth.token,
          updates: {
            structure: {
              sections: [{ id: 'sec-1', name: 'Verse 1', type: 'verse', bars: -5, updatedAt: Date.now() }]
            }
          }
        }, resolve);
      });
      expect(negativeBarsRes.ok).toBe(false);
      expect(negativeBarsRes.message).toBe('Invalid workspace update payload.');

      // 7. Reject invalid schema payload: non-array tasks
      const nonArrayTasksRes = await new Promise<{ ok: boolean; message?: string }>((resolve) => {
        ownerSocket.emit('project:workspace:update', {
          projectId: project.id,
          authToken: ownerAuth.token,
          updates: {
            tasks: {
              tasks: 'not-an-array'
            }
          }
        }, resolve);
      });
      expect(nonArrayTasksRes.ok).toBe(false);
      expect(nonArrayTasksRes.message).toBe('Invalid workspace update payload.');

      // 8. Verify project store state remains clean and uncorrupted after invalid attempts
      const projectAfterInvalid = projectStore.getProject(project.id, ownerAuth.user.id);
      expect(projectAfterInvalid?.workspace.notes.content).toBe('');
      expect(projectAfterInvalid?.workspace.tasks.tasks.length).toBe(0);
      expect(projectAfterInvalid?.workspace.structure.sections.length).toBe(0);

      // 9. Send valid updates: lyrics and notes by Owner -> Collab receives sync event
      const collabSyncedPromise = new Promise<any>((resolve) => collabSocket.once('project:workspace:synced', resolve));

      const validUpdateRes = await new Promise<{ ok: boolean; workspace?: any }>((resolve) => {
        ownerSocket.emit('project:workspace:update', {
          projectId: project.id,
          authToken: ownerAuth.token,
          updates: {
            lyrics: {
              documentId: 'doc-main',
              title: 'Main Lyrics',
              content: '[Verse 1]\nLate night studio session'
            },
            notes: {
              content: 'Mix revisions notes',
              bpm: '124',
              key: 'A minor'
            }
          }
        }, resolve);
      });

      expect(validUpdateRes.ok).toBe(true);
      expect(validUpdateRes.workspace.lyrics.content).toContain('Late night studio session');
      expect(validUpdateRes.workspace.notes.bpm).toBe('124');

      const syncedEvent = await collabSyncedPromise;
      expect(syncedEvent.projectId).toBe(project.id);
      expect(syncedEvent.workspace.lyrics.content).toContain('Late night studio session');
      expect(syncedEvent.workspace.notes.bpm).toBe('124');
      expect(syncedEvent.updatedBy).toBe(ownerAuth.user.id);

      // 10. Send valid updates: Structure and Tasks by Collaborator -> Owner receives sync event
      const ownerSyncedPromise = new Promise<any>((resolve) => ownerSocket.once('project:workspace:synced', resolve));

      const validCollabRes = await new Promise<{ ok: boolean; workspace?: any }>((resolve) => {
        collabSocket.emit('project:workspace:update', {
          projectId: project.id,
          authToken: collabAuth.token,
          updates: {
            structure: {
              sections: [
                { id: 'sec-1', type: 'intro', name: 'Intro', bars: 8, updatedAt: Date.now() },
                { id: 'sec-2', type: 'verse', name: 'Verse 1', bars: 16, updatedAt: Date.now() }
              ]
            },
            tasks: {
              tasks: [
                {
                  id: 'task-1',
                  title: 'Record Acoustic Guitar',
                  status: 'in_progress',
                  assigneeId: collabAuth.user.id,
                  assigneeName: collabAuth.user.displayName,
                  createdAt: Date.now(),
                  updatedAt: Date.now()
                }
              ]
            }
          }
        }, resolve);
      });

      expect(validCollabRes.ok).toBe(true);
      expect(validCollabRes.workspace.structure.sections.length).toBe(2);
      expect(validCollabRes.workspace.tasks.tasks.length).toBe(1);

      const ownerReceivedSync = await ownerSyncedPromise;
      expect(ownerReceivedSync.projectId).toBe(project.id);
      expect(ownerReceivedSync.workspace.structure.sections.length).toBe(2);
      expect(ownerReceivedSync.workspace.tasks.tasks[0].title).toBe('Record Acoustic Guitar');
      expect(ownerReceivedSync.updatedBy).toBe(collabAuth.user.id);

      // 11. Verify final project state in store
      const finalProject = projectStore.getProject(project.id, ownerAuth.user.id);
      expect(finalProject?.workspace.lyrics.content).toContain('Late night studio session');
      expect(finalProject?.workspace.notes.key).toBe('A minor');
      expect(finalProject?.workspace.structure.sections[0].name).toBe('Intro');
      expect(finalProject?.workspace.tasks.tasks[0].status).toBe('in_progress');
    } finally {
      io.close();
      await app.close();
    }
  });

  it('prevents role hijacking via participantId and enforces server-authoritative reconnect identity', async () => {
    const { app, io, userStore } = await createApp(loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'a-secure-test-secret' }));
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}`;
    try {
      const hostUser = await createTestAccount(url, 'host_rec', 'beta', userStore);
      const guestUser = await createTestAccount(url, 'guest_rec', 'beta', userStore);
      const attackerUser = await createTestAccount(url, 'attacker_rec', 'beta', userStore);
      const host = await connected(url);
      const guest = await connected(url);
      const attacker = await connected(url);

      const hostId = '11111111-1111-4111-8111-111111111111';
      const guestId = '22222222-2222-4222-8222-222222222222';
      const attackerId = '99999999-9999-4999-8999-999999999999';

      // 1. Host creates session
      const hostCreated = await ack(host, 'meeting:create', { participantId: hostId, authToken: hostUser.token, media });
      expect(hostCreated.ok).toBe(true);
      if (!hostCreated.ok) return;
      expect(hostCreated.role).toBe('host');
      expect(hostCreated.reconnectToken).toBeDefined();
      const hostReconnectToken = hostCreated.reconnectToken;

      // 2. Guest joins session
      const guestPeerReadyPromise = new Promise<any>((resolve) => host.once('peer:ready', resolve));
      const guestJoined = await ack(guest, 'meeting:join', { code: hostCreated.code, participantId: guestId, authToken: guestUser.token, media });
      expect(guestJoined.ok).toBe(true);
      if (!guestJoined.ok) return;
      expect(guestJoined.role).toBe('guest');
      expect(guestJoined.reconnectToken).toBeDefined();
      const guestReconnectToken = guestJoined.reconnectToken;

      // Ensure peer:ready does NOT leak host's or guest's reconnectToken
      const hostPeerReadyPayload = await guestPeerReadyPromise;
      expect(hostPeerReadyPayload.reconnectToken).toBeUndefined();

      // 3. Attacker attempts to hijack host role by supplying host's participantId without token
      const hijackHostNoToken = await ack(attacker, 'meeting:join', {
        code: hostCreated.code,
        participantId: hostId,
        authToken: attackerUser.token,
        media
      });
      expect(hijackHostNoToken).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });

      // 4. Attacker attempts to hijack host role with bogus token
      const hijackHostBogusToken = await ack(attacker, 'meeting:join', {
        code: hostCreated.code,
        participantId: hostId,
        authToken: attackerUser.token,
        media,
        reconnectToken: 'bogus-token-1234'
      });
      expect(hijackHostBogusToken).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });

      // 5. Attacker attempts to hijack guest slot with guest's participantId without token
      const hijackGuestNoToken = await ack(attacker, 'meeting:join', {
        code: hostCreated.code,
        participantId: guestId,
        authToken: attackerUser.token,
        media
      });
      expect(hijackGuestNoToken).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });

      // 6. Host temporarily disconnects
      host.disconnect();

      // Attacker attempts to hijack host slot while host is in disconnect grace period
      const hijackHostDuringDisconnect = await ack(attacker, 'meeting:join', {
        code: hostCreated.code,
        participantId: hostId,
        authToken: attackerUser.token,
        media
      });
      expect(hijackHostDuringDisconnect).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });

      // Legitimate host reconnects with valid reconnectToken -> succeeds and retains host role
      const hostReconnected = await connected(url);
      const hostRejoin = await ack(hostReconnected, 'meeting:join', {
        code: hostCreated.code,
        participantId: hostId,
        authToken: hostUser.token,
        media,
        reconnectToken: hostReconnectToken
      });
      expect(hostRejoin).toMatchObject({ ok: true, role: 'host', peerPresent: true });

      // 7. Guest temporarily disconnects
      guest.disconnect();

      // Attacker attempts to hijack guest slot while guest is in disconnect grace period
      const hijackGuestDuringDisconnect = await ack(attacker, 'meeting:join', {
        code: hostCreated.code,
        participantId: guestId,
        authToken: attackerUser.token,
        media
      });
      expect(hijackGuestDuringDisconnect).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });

      // Legitimate guest reconnects with valid reconnectToken -> succeeds and retains guest role
      const guestReconnected = await connected(url);
      const guestRejoin = await ack(guestReconnected, 'meeting:join', {
        code: hostCreated.code,
        participantId: guestId,
        authToken: guestUser.token,
        media,
        reconnectToken: guestReconnectToken
      });
      expect(guestRejoin).toMatchObject({ ok: true, role: 'guest', peerPresent: true });
    } finally {
      io.close();
      await app.close();
    }
  });

  it('enforces server-side project authorization across REST APIs and real-time WebSockets', async () => {
    const { app, io, userStore, projectStore } = await createApp(loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'a-secure-test-secret' }));
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}`;
    try {
      const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      // 1. Register Owner, Collaborator/Viewer, and Stranger
      const ownerReg = await userStore.register({
        username: `prodowner_${suffix}`,
        email: `prodowner_${suffix}@test.com`,
        password: 'password123',
        displayName: 'Producer Owner'
      });
      const viewerReg = await userStore.register({
        username: `viewer_${suffix}`,
        email: `viewer_${suffix}@test.com`,
        password: 'password123',
        displayName: 'Viewer User'
      });
      const strangerReg = await userStore.register({
        username: `stranger_${suffix}`,
        email: `stranger_${suffix}@test.com`,
        password: 'password123',
        displayName: 'Stranger User'
      });

      // 2. Owner creates a project
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/projects',
        headers: { authorization: `Bearer ${ownerReg.token}` },
        payload: { name: 'Studio Single Track' }
      });
      expect(createRes.statusCode).toBe(201);
      const project = JSON.parse(createRes.body).project;
      expect(project.id).toBeDefined();

      // 3. Stranger (not in project) receives 404 when trying to access or administer
      const strangerAddRes = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/collaborators`,
        headers: { authorization: `Bearer ${strangerReg.token}` },
        payload: { usernameOrEmail: `viewer_${suffix}`, role: 'viewer' }
      });
      expect(strangerAddRes.statusCode).toBe(404);

      // 4. Owner attempts to assign 'owner' role to collaborator -> 400 Bad Request
      const rejectOwnerRoleRes = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/collaborators`,
        headers: { authorization: `Bearer ${ownerReg.token}` },
        payload: { usernameOrEmail: `viewer_${suffix}`, role: 'owner' }
      });
      expect(rejectOwnerRoleRes.statusCode).toBe(400);

      // 4b. Owner adds viewerReg with 'viewer' role
      const addViewerRes = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/collaborators`,
        headers: { authorization: `Bearer ${ownerReg.token}` },
        payload: { usernameOrEmail: `viewer_${suffix}`, role: 'viewer' }
      });
      expect(addViewerRes.statusCode).toBe(200);
      const projectWithViewer = JSON.parse(addViewerRes.body).project;
      expect(projectWithViewer.collaborators[0].role).toBe('viewer');

      // 5. Non-owner (viewerReg) tries to add a collaborator -> 403 Forbidden
      const unauthorizedAddRes = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/collaborators`,
        headers: { authorization: `Bearer ${viewerReg.token}` },
        payload: { usernameOrEmail: `stranger_${suffix}`, role: 'viewer' }
      });
      expect(unauthorizedAddRes.statusCode).toBe(403);

      // 6. Viewer tries to modify workspace via REST -> 403 Forbidden
      const viewerWorkspaceRes = await app.inject({
        method: 'PUT',
        url: `/api/projects/${project.id}/workspace`,
        headers: { authorization: `Bearer ${viewerReg.token}` },
        payload: { lyrics: { content: 'Malicious REST lyrics update' } }
      });
      expect(viewerWorkspaceRes.statusCode).toBe(403);
      expect(JSON.parse(viewerWorkspaceRes.body).message).toContain('Viewers');

      // 7. Viewer tries to update project settings via REST -> 403 Forbidden
      const viewerProjectUpdateRes = await app.inject({
        method: 'PATCH',
        url: `/api/projects/${project.id}`,
        headers: { authorization: `Bearer ${viewerReg.token}` },
        payload: { name: 'Hacked Project Name' }
      });
      expect(viewerProjectUpdateRes.statusCode).toBe(403);

      // 8. Viewer tries to delete project via REST -> 403 Forbidden
      const viewerDeleteRes = await app.inject({
        method: 'DELETE',
        url: `/api/projects/${project.id}`,
        headers: { authorization: `Bearer ${viewerReg.token}` }
      });
      expect(viewerDeleteRes.statusCode).toBe(403);

      // 9. Viewer connects via WebSocket and tries real-time workspace update -> rejected
      const viewerSocket = await connected(url);
      const joinAck = await new Promise<any>((resolve) => {
        viewerSocket.emit('project:workspace:join', { projectId: project.id, authToken: viewerReg.token }, resolve);
      });
      expect(joinAck.ok).toBe(true);

      const socketUpdateAck = await new Promise<any>((resolve) => {
        viewerSocket.emit('project:workspace:update', {
          projectId: project.id,
          authToken: viewerReg.token,
          updates: { notes: { content: 'Viewer socket edit attempt' } }
        }, resolve);
      });
      expect(socketUpdateAck.ok).toBe(false);
      expect(socketUpdateAck.message).toContain('Viewers');

      // 10. Owner promotes viewer to 'editor'
      const promoteRes = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/collaborators`,
        headers: { authorization: `Bearer ${ownerReg.token}` },
        payload: { usernameOrEmail: `viewer_${suffix}`, role: 'editor' }
      });
      expect(promoteRes.statusCode).toBe(200);

      // 11. Editor now successfully updates workspace via REST & WebSocket
      const editorRestRes = await app.inject({
        method: 'PUT',
        url: `/api/projects/${project.id}/workspace`,
        headers: { authorization: `Bearer ${viewerReg.token}` },
        payload: { lyrics: { content: 'Authorized lyrics by editor' } }
      });
      expect(editorRestRes.statusCode).toBe(200);
      expect(JSON.parse(editorRestRes.body).workspace.lyrics.content).toBe('Authorized lyrics by editor');

      const editorSocketAck = await new Promise<any>((resolve) => {
        viewerSocket.emit('project:workspace:update', {
          projectId: project.id,
          authToken: viewerReg.token,
          updates: { notes: { bpm: '124', key: 'C major' } }
        }, resolve);
      });
      expect(editorSocketAck.ok).toBe(true);
      expect(editorSocketAck.workspace.notes.bpm).toBe('124');

      // 12. Stranger cannot access project -> 404 / unauthorized
      const strangerRes = await app.inject({
        method: 'GET',
        url: `/api/projects/${project.id}`,
        headers: { authorization: `Bearer ${strangerReg.token}` }
      });
      expect(strangerRes.statusCode).toBe(404);

      // 13. Editor leaves project (removes self) -> 200 OK
      const editorLeaveRes = await app.inject({
        method: 'DELETE',
        url: `/api/projects/${project.id}/collaborators/${viewerReg.user.id}`,
        headers: { authorization: `Bearer ${viewerReg.token}` }
      });
      expect(editorLeaveRes.statusCode).toBe(200);

      // 14. Owner deletes project -> 200 OK
      const ownerDeleteRes = await app.inject({
        method: 'DELETE',
        url: `/api/projects/${project.id}`,
        headers: { authorization: `Bearer ${ownerReg.token}` }
      });
      expect(ownerDeleteRes.statusCode).toBe(200);
    } finally {
      io.close();
      await app.close();
    }
  });

  it('relays signal:renegotiate from guest to host and rejects unauthorized renegotiation', async () => {
    const { app, io, userStore } = await createApp(loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'a-secure-test-secret' }));
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}`;
    try {
      const hostUser = await createTestAccount(url, 'host_reneg', 'beta', userStore);
      const guestUser = await createTestAccount(url, 'guest_reneg', 'beta', userStore);
      const host = await connected(url);
      const guest = await connected(url);
      const outsider = await connected(url);
      const hostId = '11111111-1111-4111-8111-111111111111';
      const guestId = '22222222-2222-4222-8222-222222222222';

      const created = await ack(host, 'meeting:create', { participantId: hostId, authToken: hostUser.token, media });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const joined = await ack(guest, 'meeting:join', { code: created.code, participantId: guestId, authToken: guestUser.token, media });
      expect(joined.ok).toBe(true);

      // Outsider emits signal:renegotiate -> host does not receive it
      let hostReceivedUnauth = false;
      host.on('signal:renegotiate', () => { hostReceivedUnauth = true; });
      outsider.emit('signal:renegotiate', { code: created.code });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(hostReceivedUnauth).toBe(false);

      // Legitimate guest emits signal:renegotiate -> host receives it
      const hostRenegotiatePromise = new Promise<void>((resolve) => host.once('signal:renegotiate', () => resolve()));
      guest.emit('signal:renegotiate', { code: created.code });
      await hostRenegotiatePromise;
    } finally {
      io.close();
      await app.close();
    }
  });

  it('preserves registered and guest identity across Socket.IO reconnections without downgrading to generic guest', async () => {
    const { app, io, userStore } = await createApp(loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'a-secure-test-secret' }));
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}`;
    try {
      const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const hostUser = await userStore.register({
        username: `producer_alice_${suffix}`,
        email: `alice_${suffix}@test.com`,
        password: 'password123',
        displayName: 'Alice In Studio'
      });
      userStore.setSessionAccess(hostUser.user.id, 'beta');
      const guestUser = await userStore.register({
        username: `guitarist_bob_${suffix}`,
        email: `bob_${suffix}@test.com`,
        password: 'password123',
        displayName: 'Bob The Guitarist'
      });
      userStore.setSessionAccess(guestUser.user.id, 'beta');

      const hostSocket = await connected(url);
      const guestSocket = await connected(url);
      const hostId = '11111111-1111-4111-8111-111111111111';
      const guestId = '22222222-2222-4222-8222-222222222222';

      // 1. Registered Host creates session with authToken
      const created = await ack(hostSocket, 'meeting:create', {
        participantId: hostId,
        authToken: hostUser.token,
        media
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.identity).toMatchObject({
        id: hostUser.user.id,
        displayName: 'Alice In Studio',
        username: `producer_alice_${suffix}`,
        isGuest: false,
        isHost: true
      });

      // 2. Registered Guest joins session with authToken
      const hostPeerReadyPromise1 = new Promise<any>((resolve) => hostSocket.once('peer:ready', resolve));
      const joined = await ack(guestSocket, 'meeting:join', {
        code: created.code,
        participantId: guestId,
        authToken: guestUser.token,
        media
      });
      expect(joined.ok).toBe(true);
      if (!joined.ok) return;
      expect(joined.identity).toMatchObject({
        id: guestUser.user.id,
        displayName: 'Bob The Guitarist',
        username: `guitarist_bob_${suffix}`,
        isGuest: false,
        isHost: false
      });
      expect(joined.hostIdentity).toMatchObject({
        id: hostUser.user.id,
        displayName: 'Alice In Studio',
        isGuest: false,
        isHost: true
      });

      const peerReady1 = await hostPeerReadyPromise1;
      expect(peerReady1.identity).toMatchObject({
        id: guestUser.user.id,
        displayName: 'Bob The Guitarist',
        username: `guitarist_bob_${suffix}`,
        isGuest: false
      });

      // 3. Registered Guest temporarily disconnects and reconnects with authToken
      guestSocket.disconnect();
      const guestReconnectedSocket = await connected(url);
      const hostPeerReadyPromise2 = new Promise<any>((resolve) => hostSocket.once('peer:ready', resolve));
      const guestRejoinAck = await ack(guestReconnectedSocket, 'meeting:join', {
        code: created.code,
        participantId: guestId,
        authToken: guestUser.token,
        reconnectToken: joined.reconnectToken,
        media
      });
      expect(guestRejoinAck.ok).toBe(true);
      if (!guestRejoinAck.ok) return;
      expect(guestRejoinAck.identity).toMatchObject({
        id: guestUser.user.id,
        displayName: 'Bob The Guitarist',
        username: `guitarist_bob_${suffix}`,
        isGuest: false,
        isHost: false
      });

      const peerReady2 = await hostPeerReadyPromise2;
      expect(peerReady2.identity).toMatchObject({
        id: guestUser.user.id,
        displayName: 'Bob The Guitarist',
        isGuest: false
      });
      expect(peerReady2.reconnected).toBe(true);

      // 4. Registered Host temporarily disconnects and reconnects with authToken
      hostSocket.disconnect();
      const hostReconnectedSocket = await connected(url);
      const guestPeerReadyPromise3 = new Promise<any>((resolve) => guestReconnectedSocket.once('peer:ready', resolve));
      const hostRejoinAck = await ack(hostReconnectedSocket, 'meeting:join', {
        code: created.code,
        participantId: hostId,
        authToken: hostUser.token,
        reconnectToken: created.reconnectToken,
        media
      });
      expect(hostRejoinAck.ok).toBe(true);
      if (!hostRejoinAck.ok) return;
      expect(hostRejoinAck.role).toBe('host');
      expect(hostRejoinAck.identity).toMatchObject({
        id: hostUser.user.id,
        displayName: 'Alice In Studio',
        username: `producer_alice_${suffix}`,
        isGuest: false,
        isHost: true
      });
      expect(hostRejoinAck.hostIdentity).toMatchObject({
        id: hostUser.user.id,
        displayName: 'Alice In Studio',
        isHost: true
      });

      const peerReady3 = await guestPeerReadyPromise3;
      expect(peerReady3.identity).toMatchObject({
        id: hostUser.user.id,
        displayName: 'Alice In Studio',
        isHost: true,
        isGuest: false
      });
    } finally {
      io.close();
      await app.close();
    }
  });

  it('rejects unauthenticated meeting creation and joins with AUTH_REQUIRED', async () => {
    const { app, io } = await createApp(loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'a-secure-test-secret' }));
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}`;
    try {
      const hostSocket = await connected(url);
      const guestSocket = await connected(url);
      const hostId = '11111111-1111-4111-8111-111111111111';
      const guestId = '22222222-2222-4222-8222-222222222222';

      // 1. Anonymous create attempt is rejected
      const created = await ack(hostSocket, 'meeting:create', {
        participantId: hostId,
        guestDisplayName: 'Host Maestro',
        media
      });
      expect(created).toMatchObject({ ok: false, code: 'AUTH_REQUIRED' });

      // 2. Anonymous join attempt is rejected
      const joined = await ack(guestSocket, 'meeting:join', {
        code: 'ABC2DEF3',
        participantId: guestId,
        guestDisplayName: 'Session Drummer',
        media
      });
      expect(joined).toMatchObject({ ok: false, code: 'AUTH_REQUIRED' });
    } finally {
      io.close();
      await app.close();
    }
  });

  it('preserves all user accounts, active tokens, projects, workspaces, and scheduled sessions across server restarts via DATA_DIR', async () => {
    const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-persistence-test-'));
    try {
      // 1. Start Server Instance 1
      const config1 = loadConfig({
        NODE_ENV: 'test',
        TURN_SHARED_SECRET: 'a-secure-test-secret',
        DATA_DIR: tmpDataDir
      });
      const instance1 = await createApp(config1);
      await instance1.app.listen({ host: '127.0.0.1', port: 0 });
      const addr1 = instance1.app.server.address() as AddressInfo;
      const url1 = `http://127.0.0.1:${addr1.port}`;

      // Register User
      const regRes = await fetch(`${url1}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'beatmaker_alex',
          email: 'alex@beats.com',
          password: 'Password123!',
          displayName: 'Alex Beats'
        })
      });
      const regData = (await regRes.json()) as any;
      expect(regRes.status).toBe(201);
      expect(regData.ok).toBe(true);
      const token = regData.token;
      const userId = regData.user.id;

      // Create Project
      const projRes = await fetch(`${url1}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: 'Collab Album 2026',
          description: 'Production in progress'
        })
      });
      const projData = (await projRes.json()) as any;
      expect(projRes.status).toBe(201);
      const projectId = projData.project.id;

      // Update Project Workspace (Lyrics, BPM, Structure, Tasks)
      const wsRes = await fetch(`${url1}/api/projects/${projectId}/workspace`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          lyrics: {
            content: 'Verse 1: Beat drops in 4 bars'
          },
          notes: {
            content: 'Use analog compressor on bus',
            bpm: '130',
            key: 'A minor'
          },
          structure: {
            sections: [
              { id: 'sec_intro', type: 'intro', name: 'Intro', bars: 8, note: 'Drum loop', updatedAt: Date.now() }
            ]
          },
          tasks: {
            tasks: [
              { id: 'task_mix', title: 'Final Mixdown', status: 'in_progress', createdAt: Date.now(), updatedAt: Date.now() }
            ]
          }
        })
      });
      const wsData = (await wsRes.json()) as any;
      expect(wsRes.status).toBe(200);
      expect(wsData.ok).toBe(true);

      // Create Scheduled Session
      const schedRes = await fetch(`${url1}/api/sessions/scheduled`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title: 'Album Mixing Session',
          scheduledAt: new Date(Date.now() + 86400000).toISOString()
        })
      });
      const schedData = (await schedRes.json()) as any;
      expect(schedRes.status).toBe(201);
      const scheduledId = schedData.session.id;

      // Stop Server Instance 1
      instance1.io.close();
      await instance1.app.close();

      // 2. Start Server Instance 2 (Simulating Container Restart with same DATA_DIR volume)
      const config2 = loadConfig({
        NODE_ENV: 'test',
        TURN_SHARED_SECRET: 'a-secure-test-secret',
        DATA_DIR: tmpDataDir
      });
      const instance2 = await createApp(config2);
      await instance2.app.listen({ host: '127.0.0.1', port: 0 });
      const addr2 = instance2.app.server.address() as AddressInfo;
      const url2 = `http://127.0.0.1:${addr2.port}`;

      try {
        // Verify Authentication Token Survives Restart
        const meRes = await fetch(`${url2}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const meData = (await meRes.json()) as any;
        expect(meRes.status).toBe(200);
        expect(meData.ok).toBe(true);
        expect(meData.user.username).toBe('beatmaker_alex');
        expect(meData.user.displayName).toBe('Alex Beats');

        // Verify Login with Credentials Survives Restart
        const loginRes = await fetch(`${url2}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            usernameOrEmail: 'alex@beats.com',
            password: 'Password123!'
          })
        });
        const loginData = (await loginRes.json()) as any;
        expect(loginRes.status).toBe(200);
        expect(loginData.ok).toBe(true);

        // Verify Project & Full Workspace Survives Restart
        const getProjRes = await fetch(`${url2}/api/projects/${projectId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const getProjData = (await getProjRes.json()) as any;
        expect(getProjRes.status).toBe(200);
        expect(getProjData.project.name).toBe('Collab Album 2026');
        expect(getProjData.project.workspace.lyrics.content).toContain('Beat drops in 4 bars');
        expect(getProjData.project.workspace.notes.bpm).toBe('130');
        expect(getProjData.project.workspace.notes.key).toBe('A minor');
        expect(getProjData.project.workspace.structure.sections.length).toBe(1);
        expect(getProjData.project.workspace.tasks.tasks.length).toBe(1);
        expect(getProjData.project.workspace.tasks.tasks[0].title).toBe('Final Mixdown');

        // Verify Scheduled Sessions Survive Restart
        const getSchedRes = await fetch(`${url2}/api/sessions/scheduled`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const getSchedData = (await getSchedRes.json()) as any;
        expect(getSchedRes.status).toBe(200);
        expect(getSchedData.sessions.length).toBe(1);
        expect(getSchedData.sessions[0].id).toBe(scheduledId);
        expect(getSchedData.sessions[0].title).toBe('Album Mixing Session');
      } finally {
        instance2.io.close();
        await instance2.app.close();
      }
    } finally {
      if (fs.existsSync(tmpDataDir)) {
        fs.rmSync(tmpDataDir, { recursive: true, force: true });
      }
    }
  });

  it('returns 500 / error response and does not report success when persistence fails on REST endpoints', async () => {
    const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-fail-test-'));
    try {
      const blockerFile = path.join(tmpDataDir, 'blocker');
      fs.writeFileSync(blockerFile, 'blocking file');
      const unwritableDir = path.join(blockerFile, 'sub');

      const config = loadConfig({
        NODE_ENV: 'test',
        TURN_SHARED_SECRET: 'a-secure-test-secret',
        DATA_DIR: unwritableDir
      });
      const { app, io } = await createApp(config);
      await app.listen({ host: '127.0.0.1', port: 0 });
      const addr = app.server.address() as AddressInfo;
      const url = `http://127.0.0.1:${addr.port}`;

      try {
        // Register should return 500 because persistence cannot be completed
        const regRes = await fetch(`${url}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: 'fail_writer',
            email: 'fail@writer.com',
            password: 'Password123!',
            displayName: 'Fail Writer'
          })
        });
        const regData = (await regRes.json()) as any;
        expect(regRes.status).toBe(500);
        expect(regData.ok).toBe(false);
      } finally {
        io.close();
        await app.close();
      }
    } finally {
      if (fs.existsSync(tmpDataDir)) {
        fs.rmSync(tmpDataDir, { recursive: true, force: true });
      }
    }
  });

  it('handles persistence failures safely during meeting:create without leaving dangling room state', async () => {
    const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-fail-create-'));
    try {
      const config = loadConfig({
        NODE_ENV: 'test',
        TURN_SHARED_SECRET: 'a-secure-test-secret',
        DATA_DIR: tmpDataDir
      });
      const { app, io, rooms, userStore } = await createApp(config);
      await app.listen({ host: '127.0.0.1', port: 0 });
      const addr = app.server.address() as AddressInfo;
      const url = `http://127.0.0.1:${addr.port}`;

      try {
        // Register an account first so identity is an authenticated user
        const reg = await userStore.register({
          username: 'host_creator',
          email: 'creator@example.com',
          password: 'Password123!',
          displayName: 'Host Creator'
        });
        userStore.setSessionAccess(reg.user.id, 'beta');

        // Now break persistence on userStore by creating a regular file blocker
        const blockerFile = path.join(tmpDataDir, 'blocker');
        fs.writeFileSync(blockerFile, 'blocking file');
        (userStore as any).dataFilePath = path.join(blockerFile, 'sub', 'accounts.json');

        const hostSocket = await connected(url);
        const hostId = '11111111-1111-4111-8111-111111111111';

        const createRes = await ack(hostSocket, 'meeting:create', {
          participantId: hostId,
          authToken: reg.token,
          media
        });

        // 1. Client receives meaningful error ack
        expect(createRes.ok).toBe(false);
        if (!createRes.ok) {
          expect(createRes.code).toBe('SERVER_ERROR');
        }

        // 2. Room store has NO dangling rooms
        expect(rooms.rooms.size).toBe(0);
      } finally {
        io.close();
        await app.close();
      }
    } finally {
      if (fs.existsSync(tmpDataDir)) {
        fs.rmSync(tmpDataDir, { recursive: true, force: true });
      }
    }
  });

  it('handles persistence failures safely during meeting:join and rolls back room state', async () => {
    const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-fail-join-'));
    try {
      const config = loadConfig({
        NODE_ENV: 'test',
        TURN_SHARED_SECRET: 'a-secure-test-secret',
        DATA_DIR: tmpDataDir
      });
      const { app, io, rooms, userStore } = await createApp(config);
      await app.listen({ host: '127.0.0.1', port: 0 });
      const addr = app.server.address() as AddressInfo;
      const url = `http://127.0.0.1:${addr.port}`;

      try {
        const hostReg = await userStore.register({
          username: 'host_musician',
          email: 'host@example.com',
          password: 'Password123!',
          displayName: 'Host Musician'
        });
        userStore.setSessionAccess(hostReg.user.id, 'beta');
        const guestReg = await userStore.register({
          username: 'guest_musician',
          email: 'guest@example.com',
          password: 'Password123!',
          displayName: 'Guest Musician'
        });
        userStore.setSessionAccess(guestReg.user.id, 'beta');

        const hostSocket = await connected(url);
        const guestSocket = await connected(url);
        const hostId = '11111111-1111-4111-8111-111111111111';
        const guestId = '22222222-2222-4222-8222-222222222222';

        const created = await ack(hostSocket, 'meeting:create', {
          participantId: hostId,
          authToken: hostReg.token,
          media
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;

        // Break userStore persistence before guest joins
        const blockerFile = path.join(tmpDataDir, 'blocker');
        fs.writeFileSync(blockerFile, 'blocking file');
        (userStore as any).dataFilePath = path.join(blockerFile, 'sub', 'accounts.json');

        let peerReadyReceived = false;
        hostSocket.on('peer:ready', () => { peerReadyReceived = true; });

        const joinRes = await ack(guestSocket, 'meeting:join', {
          code: created.code,
          participantId: guestId,
          authToken: guestReg.token,
          media
        });

        // 1. Guest receives error ack
        expect(joinRes.ok).toBe(false);
        if (!joinRes.ok) {
          expect(joinRes.code).toBe('SERVER_ERROR');
        }

        // 2. Room in memory only has the host (guest was rolled back)
        const room = rooms.rooms.get(created.code);
        expect(room?.participants.size).toBe(1);
        expect(room?.participants.has(guestId)).toBe(false);

        // 3. Host did not receive peer:ready
        expect(peerReadyReceived).toBe(false);
      } finally {
        io.close();
        await app.close();
      }
    } finally {
      if (fs.existsSync(tmpDataDir)) {
        fs.rmSync(tmpDataDir, { recursive: true, force: true });
      }
    }
  });

  it('handles persistence failures safely during waiting:admit and restores waiting room state', async () => {
    const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-fail-admit-'));
    try {
      const config = loadConfig({
        NODE_ENV: 'test',
        TURN_SHARED_SECRET: 'a-secure-test-secret',
        DATA_DIR: tmpDataDir
      });
      const { app, io, rooms, userStore } = await createApp(config);
      await app.listen({ host: '127.0.0.1', port: 0 });
      const addr = app.server.address() as AddressInfo;
      const url = `http://127.0.0.1:${addr.port}`;

      try {
        const hostReg = await userStore.register({
          username: 'host_admits',
          email: 'admit_host@example.com',
          password: 'Password123!',
          displayName: 'Admit Host'
        });
        userStore.setSessionAccess(hostReg.user.id, 'beta');
        const guestReg = await userStore.register({
          username: 'guest_waiting',
          email: 'admit_guest@example.com',
          password: 'Password123!',
          displayName: 'Admit Guest'
        });
        userStore.setSessionAccess(guestReg.user.id, 'beta');

        const hostSocket = await connected(url);
        const guestSocket = await connected(url);
        const hostId = '11111111-1111-4111-8111-111111111111';
        const guestId = '22222222-2222-4222-8222-222222222222';

        const created = await ack(hostSocket, 'meeting:create', {
          participantId: hostId,
          authToken: hostReg.token,
          waitingRoomEnabled: true,
          media
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;

        const joined = await ack(guestSocket, 'meeting:join', {
          code: created.code,
          participantId: guestId,
          authToken: guestReg.token,
          media
        });
        expect(joined.ok).toBe(true);
        expect((joined as any).waiting).toBe(true);

        // Break userStore persistence before admit
        const blockerFile = path.join(tmpDataDir, 'blocker');
        fs.writeFileSync(blockerFile, 'blocking file');
        (userStore as any).dataFilePath = path.join(blockerFile, 'sub', 'accounts.json');

        let waitingAdmittedReceived = false;
        guestSocket.on('waiting:admitted', () => { waitingAdmittedReceived = true; });

        const admitRes = await new Promise<{ ok: boolean; message?: string }>((resolve) => {
          hostSocket.emit('waiting:admit', { code: created.code, participantId: guestId }, resolve);
        });

        // 1. Host receives ok: false in ack callback
        expect(admitRes.ok).toBe(false);

        // 2. Room in memory restored guest back to waitingParticipants and did NOT move to active participants
        const room = rooms.rooms.get(created.code);
        expect(room?.participants.size).toBe(1);
        expect(room?.participants.has(guestId)).toBe(false);
        expect(room?.waitingParticipants.has(guestId)).toBe(true);

        // 3. Guest did not receive waiting:admitted
        expect(waitingAdmittedReceived).toBe(false);
      } finally {
        io.close();
        await app.close();
      }
    } finally {
      if (fs.existsSync(tmpDataDir)) {
        fs.rmSync(tmpDataDir, { recursive: true, force: true });
      }
    }
  });

  it('handles persistence failures gracefully during explicit leave and disconnect expiry', async () => {
    const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-fail-leave-'));
    try {
      const config = loadConfig({
        NODE_ENV: 'test',
        TURN_SHARED_SECRET: 'a-secure-test-secret',
        DISCONNECT_GRACE_MS: 1000,
        DATA_DIR: tmpDataDir
      });
      const { app, io, rooms, userStore } = await createApp(config);
      await app.listen({ host: '127.0.0.1', port: 0 });
      const addr = app.server.address() as AddressInfo;
      const url = `http://127.0.0.1:${addr.port}`;

      try {
        const hostReg = await userStore.register({
          username: 'host_leaving',
          email: 'leave_host@example.com',
          password: 'Password123!',
          displayName: 'Leave Host'
        });
        userStore.setSessionAccess(hostReg.user.id, 'beta');
        const peerReg = await userStore.register({
          username: 'peer_leaving',
          email: 'leave_peer@example.com',
          password: 'Password123!',
          displayName: 'Leave Peer'
        });
        userStore.setSessionAccess(peerReg.user.id, 'beta');

        const hostSocket = await connected(url);
        const peerSocket = await connected(url);
        const hostId = '11111111-1111-4111-8111-111111111111';
        const peerId = '22222222-2222-4222-8222-222222222222';

        const created = await ack(hostSocket, 'meeting:create', {
          participantId: hostId,
          authToken: hostReg.token,
          media
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;

        await ack(peerSocket, 'meeting:join', {
          code: created.code,
          participantId: peerId,
          authToken: peerReg.token,
          media
        });

        // Break userStore persistence before host leaves
        const blockerFile = path.join(tmpDataDir, 'blocker');
        fs.writeFileSync(blockerFile, 'blocking file');
        (userStore as any).dataFilePath = path.join(blockerFile, 'sub', 'accounts.json');

        const peerMeetingEndedPromise = new Promise<void>((resolve) => peerSocket.once('meeting:ended', () => resolve()));

        // Host emits explicit meeting:leave -> should not crash or throw uncaught exception
        hostSocket.emit('meeting:leave');

        await peerMeetingEndedPromise;
        expect(rooms.rooms.has(created.code)).toBe(false);
      } finally {
        io.close();
        await app.close();
      }
    } finally {
      if (fs.existsSync(tmpDataDir)) {
        fs.rmSync(tmpDataDir, { recursive: true, force: true });
      }
    }
  });

  it('guarantees cross-store failure consistency when ProjectStore fails after UserStore succeeds during meeting creation', async () => {
    const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-cross-create-'));
    try {
      const config = loadConfig({
        NODE_ENV: 'test',
        TURN_SHARED_SECRET: 'a-secure-test-secret',
        DATA_DIR: tmpDataDir
      });
      const { app, io, rooms, userStore, projectStore } = await createApp(config);
      await app.listen({ host: '127.0.0.1', port: 0 });
      const addr = app.server.address() as AddressInfo;
      const url = `http://127.0.0.1:${addr.port}`;

      try {
        const hostReg = await userStore.register({
          username: 'project_host',
          email: 'proj_host@example.com',
          password: 'Password123!',
          displayName: 'Project Host'
        });
        userStore.setSessionAccess(hostReg.user.id, 'beta');
        const project = projectStore.createProject(hostReg.user, { name: 'Consistency Test Project' });

        expect(userStore.getStoredUser(hostReg.user.id)?.sessionsHostedCount).toBe(0);
        expect(userStore.getSessionHistory(hostReg.user.id).length).toBe(0);

        // Break only projectStore persistence
        const blockerFile = path.join(tmpDataDir, 'blocker_proj');
        fs.writeFileSync(blockerFile, 'blocking file');
        (projectStore as any).dataFilePath = path.join(blockerFile, 'sub', 'projects.json');

        const hostSocket = await connected(url);
        const hostId = '11111111-1111-4111-8111-111111111111';

        const createRes = await ack(hostSocket, 'meeting:create', {
          participantId: hostId,
          authToken: hostReg.token,
          projectId: project.id,
          media
        });

        // 1. Returns error ack
        expect(createRes.ok).toBe(false);
        if (!createRes.ok) {
          expect(createRes.code).toBe('SERVER_ERROR');
        }

        // 2. UserStore rolled back hosted count and session record in memory and on disk
        expect(userStore.getStoredUser(hostReg.user.id)?.sessionsHostedCount).toBe(0);
        expect(userStore.getSessionHistory(hostReg.user.id).length).toBe(0);

        const reloadedUserStore = new UserStore(tmpDataDir);
        expect(reloadedUserStore.getStoredUser(hostReg.user.id)?.sessionsHostedCount).toBe(0);
        expect(reloadedUserStore.getSessionHistory(hostReg.user.id).length).toBe(0);

        // 3. RoomStore cleaned up created room
        expect(rooms.rooms.size).toBe(0);
      } finally {
        io.close();
        await app.close();
      }
    } finally {
      if (fs.existsSync(tmpDataDir)) {
        fs.rmSync(tmpDataDir, { recursive: true, force: true });
      }
    }
  });

  it('guarantees cross-store failure consistency when ProjectStore fails after UserStore succeeds during fresh join', async () => {
    const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-cross-join-'));
    try {
      const config = loadConfig({
        NODE_ENV: 'test',
        TURN_SHARED_SECRET: 'a-secure-test-secret',
        DATA_DIR: tmpDataDir
      });
      const { app, io, rooms, userStore, projectStore } = await createApp(config);
      await app.listen({ host: '127.0.0.1', port: 0 });
      const addr = app.server.address() as AddressInfo;
      const url = `http://127.0.0.1:${addr.port}`;

      try {
        const hostReg = await userStore.register({
          username: 'cross_host',
          email: 'cross_host@example.com',
          password: 'Password123!',
          displayName: 'Cross Host'
        });
        userStore.setSessionAccess(hostReg.user.id, 'beta');
        const guestReg = await userStore.register({
          username: 'cross_guest',
          email: 'cross_guest@example.com',
          password: 'Password123!',
          displayName: 'Cross Guest'
        });
        userStore.setSessionAccess(guestReg.user.id, 'beta');
        const project = projectStore.createProject(hostReg.user, { name: 'Cross Join Project' });

        const hostSocket = await connected(url);
        const guestSocket = await connected(url);
        const hostId = '11111111-1111-4111-8111-111111111111';
        const guestId = '22222222-2222-4222-8222-222222222222';

        const created = await ack(hostSocket, 'meeting:create', {
          participantId: hostId,
          authToken: hostReg.token,
          projectId: project.id,
          media
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;

        // Break only projectStore persistence before guest joins
        const blockerFile = path.join(tmpDataDir, 'blocker_proj2');
        fs.writeFileSync(blockerFile, 'blocking file');
        (projectStore as any).dataFilePath = path.join(blockerFile, 'sub', 'projects.json');

        const joinRes = await ack(guestSocket, 'meeting:join', {
          code: created.code,
          participantId: guestId,
          authToken: guestReg.token,
          media
        });

        // 1. Guest receives error ack
        expect(joinRes.ok).toBe(false);
        if (!joinRes.ok) {
          expect(joinRes.code).toBe('SERVER_ERROR');
        }

        // 2. Guest has no recorded collaborator session start
        expect(userStore.getSessionHistory(guestReg.user.id).length).toBe(0);
        // Host has no collaborator attached
        const hostHistory = userStore.getSessionHistory(hostReg.user.id);
        expect(hostHistory[0]?.collaborator).toBeNull();

        // 3. Room does not contain guest
        const room = rooms.rooms.get(created.code);
        expect(room?.participants.size).toBe(1);
        expect(room?.participants.has(guestId)).toBe(false);
      } finally {
        io.close();
        await app.close();
      }
    } finally {
      if (fs.existsSync(tmpDataDir)) {
        fs.rmSync(tmpDataDir, { recursive: true, force: true });
      }
    }
  });

  it('explicitly surfaces rollback failure when snapshot restoration fails during session lifecycle error handling', async () => {
    const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-fail-rollback-'));
    try {
      const config = loadConfig({
        NODE_ENV: 'test',
        TURN_SHARED_SECRET: 'a-secure-test-secret',
        DATA_DIR: tmpDataDir
      });
      const { app, io, rooms, userStore } = await createApp(config);
      await app.listen({ host: '127.0.0.1', port: 0 });
      const addr = app.server.address() as AddressInfo;
      const url = `http://127.0.0.1:${addr.port}`;

      try {
        const hostReg = await userStore.register({
          username: 'rollback_host',
          email: 'rb_host@example.com',
          password: 'Password123!',
          displayName: 'Rollback Host'
        });
        userStore.setSessionAccess(hostReg.user.id, 'beta');

        // Test direct restoreSnapshot throw behavior
        const snapshot = userStore.createSnapshot();
        const blockerFile = path.join(tmpDataDir, 'blocker_rb');
        fs.writeFileSync(blockerFile, 'blocking file');
        (userStore as any).dataFilePath = path.join(blockerFile, 'sub', 'accounts.json');

        expect(() => userStore.restoreSnapshot(snapshot)).toThrow();

        // Test lifecycle handler returning user-safe message while logging detailed diagnostics
        const hostSocket = await connected(url);
        const hostId = '11111111-1111-4111-8111-111111111111';

        const createRes = await ack(hostSocket, 'meeting:create', {
          participantId: hostId,
          authToken: hostReg.token,
          media
        });

        expect(createRes.ok).toBe(false);
        if (!createRes.ok) {
          expect(createRes.code).toBe('SERVER_ERROR');
          expect(createRes.message).toBe('Failed to initialize session');
          // Must not leak filesystem or internal exception details to client
          expect(createRes.message).not.toContain('ENOTDIR');
          expect(createRes.message).not.toContain('blocker');
          expect(createRes.message).not.toContain('accounts.json');
        }
      } finally {
        io.close();
        await app.close();
      }
    } finally {
      if (fs.existsSync(tmpDataDir)) {
        fs.rmSync(tmpDataDir, { recursive: true, force: true });
      }
    }
  });

  it('handles waiting room participant reconnect securely, allows reconnect when locked, and admits into call', async () => {
    const { app, io, userStore } = await createApp(loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'a-secure-test-secret' }));
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}`;
    try {
      const hostUser = await createTestAccount(url, 'host_waitrec', 'beta', userStore);
      const waitingUser = await createTestAccount(url, 'wait_waitrec', 'beta', userStore);
      const attackerUser = await createTestAccount(url, 'att_waitrec', 'beta', userStore);

      const hostSocket = await connected(url);
      const waitingSocket = await connected(url);
      const attackerSocket = await connected(url);

      const hostId = '11111111-1111-4111-8111-111111111111';
      const waitingId = '22222222-2222-4222-8222-222222222222';

      // 1. Host creates meeting with waiting room enabled
      const created = await ack(hostSocket, 'meeting:create', {
        participantId: hostId,
        authToken: hostUser.token,
        waitingRoomEnabled: true,
        media
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // 2. Participant joins waiting room and receives server-issued reconnectToken
      const waitingJoinAck = await ack(waitingSocket, 'meeting:join', {
        code: created.code,
        participantId: waitingId,
        authToken: waitingUser.token,
        media
      });
      expect(waitingJoinAck.ok).toBe(true);
      if (!waitingJoinAck.ok || !waitingJoinAck.waiting) return;
      expect(waitingJoinAck.waiting).toBe(true);
      expect(waitingJoinAck.reconnectToken).toBeDefined();
      const serverIssuedWaitingToken = waitingJoinAck.reconnectToken;

      // 3. Host locks the session
      const lockRes = await new Promise<{ ok: boolean; locked?: boolean }>((resolve) => {
        hostSocket.emit('meeting:lock', { code: created.code, locked: true }, resolve);
      });
      expect(lockRes.ok).toBe(true);

      // 4. Attacker attempts to hijack waiting participant slot with bogus token -> rejected UNAUTHORIZED
      const attackerBogus = await ack(attackerSocket, 'meeting:join', {
        code: created.code,
        participantId: waitingId,
        authToken: attackerUser.token,
        reconnectToken: 'bogus-attacker-token',
        media
      });
      expect(attackerBogus).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });

      // 5. Attacker attempts to hijack waiting participant slot without any token -> rejected UNAUTHORIZED
      const attackerNoToken = await ack(attackerSocket, 'meeting:join', {
        code: created.code,
        participantId: waitingId,
        authToken: attackerUser.token,
        media
      });
      expect(attackerNoToken).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });

      // 6. Waiting participant disconnects temporarily
      waitingSocket.disconnect();

      // 7. Legitimate waiting participant reconnects with server-issued reconnectToken while locked -> SUCCEEDS
      const reconnectedWaitingSocket = await connected(url);
      const rejoinAck = await ack(reconnectedWaitingSocket, 'meeting:join', {
        code: created.code,
        participantId: waitingId,
        authToken: waitingUser.token,
        reconnectToken: serverIssuedWaitingToken,
        media
      });
      expect(rejoinAck.ok).toBe(true);
      if (!rejoinAck.ok || !rejoinAck.waiting) return;
      expect(rejoinAck.waiting).toBe(true);
      expect(rejoinAck.identity.displayName).toBe('User wait_waitrec');

      // 8. Host admits the waiting participant
      const admittedPromise = new Promise<MeetingAck>((resolve) => reconnectedWaitingSocket.once('waiting:admitted', resolve));
      const admitRes = await new Promise<{ ok: boolean; message?: string }>((resolve) => {
        hostSocket.emit('waiting:admit', { code: created.code, participantId: waitingId }, resolve);
      });
      expect(admitRes.ok).toBe(true);

      const admittedAck = await admittedPromise;
      expect(admittedAck.ok).toBe(true);
      if (admittedAck.ok) {
        expect(admittedAck.waiting).toBe(false);
        expect(admittedAck.peerPresent).toBe(true);
        expect(admittedAck.role).toBe('guest');
      }
    } finally {
      io.close();
      await app.close();
    }
  });

  it('rejects privileged actions and signaling from stale replaced socket and prevents stale disconnect from affecting participant', async () => {
    const { app, io, userStore } = await createApp(loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'a-secure-test-secret' }));
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}`;
    try {
      const hostUser = await createTestAccount(url, 'host_stale', 'beta', userStore);
      const guestUser = await createTestAccount(url, 'guest_stale', 'beta', userStore);

      const hostSocket1 = await connected(url);
      const guestSocket = await connected(url);

      const hostId = '11111111-1111-4111-8111-111111111111';
      const guestId = '22222222-2222-4222-8222-222222222222';

      // 1. Host creates meeting
      const created = await ack(hostSocket1, 'meeting:create', {
        participantId: hostId,
        authToken: hostUser.token,
        media
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // 2. Guest joins
      const guestJoined = await ack(guestSocket, 'meeting:join', {
        code: created.code,
        participantId: guestId,
        authToken: guestUser.token,
        media
      });
      expect(guestJoined.ok).toBe(true);

      // 3. Host reconnects on hostSocket2
      const hostSocket2 = await connected(url);
      const hostReconnected = await ack(hostSocket2, 'meeting:join', {
        code: created.code,
        participantId: hostId,
        authToken: hostUser.token,
        reconnectToken: created.reconnectToken,
        media
      });
      expect(hostReconnected.ok).toBe(true);

      // 4. Stale hostSocket1 attempts privileged host action -> rejected
      const staleLockRes = await new Promise<{ ok: boolean; message?: string }>((resolve) => {
        hostSocket1.emit('meeting:lock', { code: created.code, locked: true }, resolve);
      });
      expect(staleLockRes.ok).toBe(false);
      expect(staleLockRes.message).toBe('Only the host can lock or unlock the session');

      // 5. Stale hostSocket1 attempts chat:send -> rejected
      const staleChatRes = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
        hostSocket1.emit('chat:send', { code: created.code, text: 'Stale message' }, resolve);
      });
      expect(staleChatRes.ok).toBe(false);
      expect(staleChatRes.error).toBe('Unauthorized participant socket');

      // 6. Active hostSocket2 attempts chat:send -> succeeds
      const activeChatRes = await new Promise<{ ok: boolean; message?: any }>((resolve) => {
        hostSocket2.emit('chat:send', { code: created.code, text: 'Active message' }, resolve);
      });
      expect(activeChatRes.ok).toBe(true);

      // 7. Stale hostSocket1 disconnects -> must NOT trigger peer:disconnected or end session on guestSocket
      let peerDisconnectedEmitted = false;
      guestSocket.on('peer:disconnected', () => { peerDisconnectedEmitted = true; });
      let meetingEndedEmitted = false;
      guestSocket.on('meeting:ended', () => { meetingEndedEmitted = true; });

      hostSocket1.disconnect();
      await new Promise((r) => setTimeout(r, 100));

      expect(peerDisconnectedEmitted).toBe(false);
      expect(meetingEndedEmitted).toBe(false);

      // 8. Active hostSocket2 can still successfully send actions
      const activeLockRes = await new Promise<{ ok: boolean; locked?: boolean }>((resolve) => {
        hostSocket2.emit('meeting:lock', { code: created.code, locked: true }, resolve);
      });
      expect(activeLockRes.ok).toBe(true);
      expect(activeLockRes.locked).toBe(true);
    } finally {
      io.close();
      await app.close();
    }
  });

  it('revokes session token upon logout so it can no longer authenticate REST or Socket.IO requests', async () => {
    const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-logout-test-'));
    const { app, io } = await createApp(loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'a-secure-test-secret', DATA_DIR: tmpDataDir }));
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}`;
    try {
      // 1. Register a user and create a project
      const regRes = await fetch(`${url}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'logout_tester',
          email: 'logout_tester@music.com',
          password: 'Password123!',
          displayName: 'Logout Tester'
        })
      });
      const regData = (await regRes.json()) as { ok: boolean; token: string; user: { id: string } };
      expect(regRes.status).toBe(201);
      const token = regData.token;

      const projRes = await fetch(`${url}/api/projects`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ name: 'Logout Test Track' })
      });
      const projData = (await projRes.json()) as { ok: boolean; project: { id: string } };
      expect(projRes.status).toBe(201);
      const projectId = projData.project.id;

      // 2. Verify token works on REST /api/auth/me
      const meBefore = await fetch(`${url}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      expect(meBefore.status).toBe(200);

      // 3. Verify token works on Socket.IO project:workspace:join
      const testSocket = await connected(url);
      const joinBefore = await new Promise<{ ok: boolean; message?: string }>((resolve) => {
        testSocket.emit('project:workspace:join', { projectId, authToken: token }, resolve);
      });
      expect(joinBefore.ok).toBe(true);

      // 4. Logout via POST /api/auth/logout
      const logoutRes = await fetch(`${url}/api/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      expect(logoutRes.status).toBe(200);
      const logoutData = (await logoutRes.json()) as { ok: boolean };
      expect(logoutData.ok).toBe(true);

      // 5. Verify token is rejected on REST /api/auth/me
      const meAfter = await fetch(`${url}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      expect(meAfter.status).toBe(401);

      // 6. Verify token is rejected on REST /api/projects
      const projAfter = await fetch(`${url}/api/projects`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      expect(projAfter.status).toBe(401);

      // 7. Verify token is rejected on Socket.IO project:workspace:join
      const joinAfter = await new Promise<{ ok: boolean; message?: string }>((resolve) => {
        testSocket.emit('project:workspace:join', { projectId, authToken: token }, resolve);
      });
      expect(joinAfter.ok).toBe(false);
      expect(joinAfter.message).toBe('Unauthorized');

      // 8. Verify token is rejected on Socket.IO project:workspace:update
      const updateAfter = await new Promise<{ ok: boolean; message?: string }>((resolve) => {
        testSocket.emit('project:workspace:update', {
          projectId,
          authToken: token,
          updates: { notes: { content: 'Hacked note' } }
        }, resolve);
      });
      expect(updateAfter.ok).toBe(false);
      expect(updateAfter.message).toBe('Unauthorized');

      testSocket.disconnect();
    } finally {
      io.close();
      await app.close();
      if (fs.existsSync(tmpDataDir)) {
        fs.rmSync(tmpDataDir, { recursive: true, force: true });
      }
    }
  });

  it('invalidates all tokens issued prior to password change across REST and Socket.IO while allowing new logins', async () => {
    const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-pwd-revoc-test-'));
    const { app, io } = await createApp(loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'a-secure-test-secret', DATA_DIR: tmpDataDir }));
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}`;
    try {
      // 1. Register a user (token 1)
      const regRes = await fetch(`${url}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'pwd_revocation_user',
          email: 'pwd_revocation@music.com',
          password: 'OriginalPassword123!',
          displayName: 'Pwd User'
        })
      });
      const regData = (await regRes.json()) as { ok: boolean; token: string; user: { id: string } };
      expect(regRes.status).toBe(201);
      const token1 = regData.token;

      // 2. Create project
      const projRes = await fetch(`${url}/api/projects`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token1}`
        },
        body: JSON.stringify({ name: 'Password Revocation Project' })
      });
      const projData = (await projRes.json()) as { ok: boolean; project: { id: string } };
      expect(projRes.status).toBe(201);
      const projectId = projData.project.id;

      // 3. Login from another session (token 2)
      const loginRes = await fetch(`${url}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          usernameOrEmail: 'pwd_revocation_user',
          password: 'OriginalPassword123!'
        })
      });
      const loginData = (await loginRes.json()) as { ok: boolean; token: string };
      expect(loginRes.status).toBe(200);
      const token2 = loginData.token;

      // 4. Change password using token 1
      const updatePwdRes = await fetch(`${url}/api/auth/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token1}`
        },
        body: JSON.stringify({
          currentPassword: 'OriginalPassword123!',
          newPassword: 'BrandNewSecurePassword99!'
        })
      });
      expect(updatePwdRes.status).toBe(200);
      const updatePwdData = (await updatePwdRes.json()) as { ok: boolean; user: any; token: string };
      expect(updatePwdData.token).toBeDefined();
      const newSessionToken = updatePwdData.token;

      // 5. Verify both token1 and token2 are rejected on REST
      const meToken1 = await fetch(`${url}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token1}` }
      });
      expect(meToken1.status).toBe(401);

      const meToken2 = await fetch(`${url}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token2}` }
      });
      expect(meToken2.status).toBe(401);

      const projToken1 = await fetch(`${url}/api/projects`, {
        headers: { Authorization: `Bearer ${token1}` }
      });
      expect(projToken1.status).toBe(401);

      // Verify the new token issued to the client on password change works on REST
      const meNewSession = await fetch(`${url}/api/auth/me`, {
        headers: { Authorization: `Bearer ${newSessionToken}` }
      });
      expect(meNewSession.status).toBe(200);

      // 6. Verify both token1 and token2 are rejected on Socket.IO
      const socket = await connected(url);
      const joinToken1 = await new Promise<{ ok: boolean; message?: string }>((resolve) => {
        socket.emit('project:workspace:join', { projectId, authToken: token1 }, resolve);
      });
      expect(joinToken1.ok).toBe(false);
      expect(joinToken1.message).toBe('Unauthorized');

      const joinToken2 = await new Promise<{ ok: boolean; message?: string }>((resolve) => {
        socket.emit('project:workspace:join', { projectId, authToken: token2 }, resolve);
      });
      expect(joinToken2.ok).toBe(false);
      expect(joinToken2.message).toBe('Unauthorized');

      // Verify the new token issued to the client on password change works on Socket.IO
      const joinNewSession = await new Promise<{ ok: boolean; message?: string }>((resolve) => {
        socket.emit('project:workspace:join', { projectId, authToken: newSessionToken }, resolve);
      });
      expect(joinNewSession.ok).toBe(true);

      // 7. Login with new password (token 3)
      const loginAfterRes = await fetch(`${url}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          usernameOrEmail: 'pwd_revocation_user',
          password: 'BrandNewSecurePassword99!'
        })
      });
      expect(loginAfterRes.status).toBe(200);
      const loginAfterData = (await loginAfterRes.json()) as { ok: boolean; token: string };
      const token3 = loginAfterData.token;

      // 8. Verify token3 works on REST and Socket.IO
      const meToken3 = await fetch(`${url}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token3}` }
      });
      expect(meToken3.status).toBe(200);

      const joinToken3 = await new Promise<{ ok: boolean; message?: string }>((resolve) => {
        socket.emit('project:workspace:join', { projectId, authToken: token3 }, resolve);
      });
      expect(joinToken3.ok).toBe(true);

      socket.disconnect();
    } finally {
      io.close();
      await app.close();
      if (fs.existsSync(tmpDataDir)) {
        fs.rmSync(tmpDataDir, { recursive: true, force: true });
      }
    }
  });

  it('guarantees exactly one registration succeeds with 201 and conflicting requests fail with 409 concurrently', async () => {
    const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-race-reg-'));
    try {
      const config = loadConfig({
        NODE_ENV: 'test',
        TURN_SHARED_SECRET: 'a-secure-test-secret',
        DATA_DIR: tmpDataDir
      });
      const { app, io } = await createApp(config);
      await app.listen({ host: '127.0.0.1', port: 0 });
      const addr = app.server.address() as AddressInfo;
      const url = `http://127.0.0.1:${addr.port}`;

      try {
        const [res1, res2] = await Promise.all([
          fetch(`${url}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username: 'ConcurrentHTTPUser',
              email: 'http1@music.com',
              password: 'Password123!',
              displayName: 'User 1'
            })
          }),
          fetch(`${url}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              username: 'concurrenthttpuser',
              email: 'http2@music.com',
              password: 'Password123!',
              displayName: 'User 2'
            })
          })
        ]);

        const statuses = [res1.status, res2.status].sort();
        expect(statuses).toEqual([201, 409]);

        const body1 = (await res1.json()) as any;
        const body2 = (await res2.json()) as any;
        const bodies = [body1, body2];
        const successBody = bodies.find((b) => b.ok === true);
        const conflictBody = bodies.find((b) => b.ok === false);

        expect(successBody).toBeDefined();
        expect(successBody.token).toBeDefined();
        expect(conflictBody).toBeDefined();
        expect(conflictBody.message).toMatch(/already taken/i);
      } finally {
        io.close();
        await app.close();
      }
    } finally {
      if (fs.existsSync(tmpDataDir)) {
        fs.rmSync(tmpDataDir, { recursive: true, force: true });
      }
    }
  });

  it('enforces chat rate limiting without corrupting room state or affecting other participants', async () => {
    const { app, io, rooms, userStore } = await createApp(
      loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'a-secure-test-secret' }),
      { chat: { capacity: 3, refillRate: 1 } }
    );
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}`;
    try {
      const hostUser = await createTestAccount(url, 'host_chatrate', 'beta', userStore);
      const guestUser = await createTestAccount(url, 'guest_chatrate', 'beta', userStore);
      const host = await connected(url);
      const guest = await connected(url);
      const created = await ack(host, 'meeting:create', { participantId: '11111111-1111-4111-8111-111111111111', authToken: hostUser.token, media });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await ack(guest, 'meeting:join', { code: created.code, participantId: '22222222-2222-4222-8222-222222222222', authToken: guestUser.token, media });

      const guestReceivedMessages: string[] = [];
      guest.on('chat:message', (msg: { text: string }) => {
        guestReceivedMessages.push(msg.text);
      });

      // 1. Send 3 messages within burst capacity
      for (let i = 1; i <= 3; i++) {
        const chatAck = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
          host.emit('chat:send', { code: created.code, text: `Message ${i}` }, resolve);
        });
        expect(chatAck.ok).toBe(true);
      }

      // 2. 4th message exceeds capacity and is rejected
      const blockedAck = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
        host.emit('chat:send', { code: created.code, text: 'Spam message 4' }, resolve);
      });
      expect(blockedAck.ok).toBe(false);
      expect(blockedAck.error).toBe('Too many messages. Please slow down.');

      // Wait a brief tick for events to settle
      await new Promise((resolve) => setTimeout(resolve, 30));

      // Guest only received the 3 allowed messages
      expect(guestReceivedMessages).toEqual(['Message 1', 'Message 2', 'Message 3']);

      // Room chat message count is exactly 3 (uncorrupted)
      const room = rooms.rooms.get(created.code);
      expect(room?.chatMessagesCount).toBe(3);

      // 3. Guest can still send messages normally (per-socket rate limiter isolation)
      const hostReceivedMessages: string[] = [];
      host.on('chat:message', (msg: { text: string }) => {
        hostReceivedMessages.push(msg.text);
      });

      const guestAck = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
        guest.emit('chat:send', { code: created.code, text: 'Guest message 1' }, resolve);
      });
      expect(guestAck.ok).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(hostReceivedMessages).toEqual(['Guest message 1']);
      expect(room?.chatMessagesCount).toBe(4);
    } finally {
      io.close();
      await app.close();
    }
  });

  it('enforces workspace mutation rate limiting and prevents flood attacks', async () => {
    const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-ws-abuse-'));
    const { app, io } = await createApp(
      loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'a-secure-test-secret', DATA_DIR: tmpDataDir }),
      { workspace: { capacity: 2, refillRate: 1 } }
    );
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}`;
    try {
      // 1. Register user and create project
      const regRes = await fetch(`${url}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'ws_tester',
          email: 'ws_tester@music.com',
          password: 'Password123!',
          displayName: 'WS Tester'
        })
      });
      const regData = (await regRes.json()) as { ok: boolean; token: string; user: { id: string } };
      const token = regData.token;

      const projRes = await fetch(`${url}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: 'Abuse Test Track' })
      });
      const projData = (await projRes.json()) as { ok: boolean; project: { id: string } };
      const projectId = projData.project.id;

      const socket = await connected(url);
      await new Promise<{ ok: boolean }>((resolve) => {
        socket.emit('project:workspace:join', { projectId, authToken: token }, resolve);
      });

      // 2. First 2 updates succeed
      const up1 = await new Promise<{ ok: boolean; message?: string }>((resolve) => {
        socket.emit('project:workspace:update', {
          projectId,
          authToken: token,
          updates: { notes: { content: 'Note 1' } }
        }, resolve);
      });
      expect(up1.ok).toBe(true);

      const up2 = await new Promise<{ ok: boolean; message?: string }>((resolve) => {
        socket.emit('project:workspace:update', {
          projectId,
          authToken: token,
          updates: { notes: { content: 'Note 2' } }
        }, resolve);
      });
      expect(up2.ok).toBe(true);

      // 3. 3rd immediate update is throttled
      const up3 = await new Promise<{ ok: boolean; message?: string }>((resolve) => {
        socket.emit('project:workspace:update', {
          projectId,
          authToken: token,
          updates: { notes: { content: 'Spam Note 3' } }
        }, resolve);
      });
      expect(up3.ok).toBe(false);
      expect(up3.message).toBe('Too many requests. Please slow down.');

      // 4. Verify project on disk reflects Note 2, not Spam Note 3
      const projCheck = await fetch(`${url}/api/projects`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const projCheckData = (await projCheck.json()) as { ok: boolean; projects: Array<{ id: string; workspace: { notes: { content: string } } }> };
      const proj = projCheckData.projects.find((p) => p.id === projectId);
      expect(proj?.workspace.notes.content).toBe('Note 2');

      socket.disconnect();
    } finally {
      io.close();
      await app.close();
      if (fs.existsSync(tmpDataDir)) {
        fs.rmSync(tmpDataDir, { recursive: true, force: true });
      }
    }
  });

  it('allows realistic bursts of WebRTC ICE candidates and legitimate media updates while dropping excessive spam', async () => {
    const { app, io, userStore } = await createApp(
      loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'a-secure-test-secret' }),
      { ice: { capacity: 20, refillRate: 5 }, media: { capacity: 5, refillRate: 2 } }
    );
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}`;
    try {
      const hostUser = await createTestAccount(url, 'host_iceburst', 'beta', userStore);
      const guestUser = await createTestAccount(url, 'guest_iceburst', 'beta', userStore);
      const host = await connected(url);
      const guest = await connected(url);
      const created = await ack(host, 'meeting:create', { participantId: '11111111-1111-4111-8111-111111111111', authToken: hostUser.token, media });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await ack(guest, 'meeting:join', { code: created.code, participantId: '22222222-2222-4222-8222-222222222222', authToken: guestUser.token, media });

      const guestReceivedCandidates: any[] = [];
      guest.on('signal:candidate', (cand) => {
        guestReceivedCandidates.push(cand);
      });

      // 1. Send burst of 15 ICE candidates (within 20 capacity)
      for (let i = 0; i < 15; i++) {
        host.emit('signal:candidate', {
          code: created.code,
          candidate: { candidate: `candidate:1 1 UDP 2130706431 192.168.1.${i} 50000 typ host` }
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(guestReceivedCandidates.length).toBe(15);

      // 2. Spam 20 more ICE candidates immediately (should exceed remaining 5 tokens and drop extras safely)
      for (let i = 15; i < 35; i++) {
        host.emit('signal:candidate', {
          code: created.code,
          candidate: { candidate: `candidate:1 1 UDP 2130706431 192.168.1.${i} 50000 typ host` }
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
      // Total received capped around 20 (exact bucket capacity + any minimal fractional refill)
      expect(guestReceivedCandidates.length).toBeGreaterThanOrEqual(20);
      expect(guestReceivedCandidates.length).toBeLessThan(25);

      // 3. Test media updates: rapid legitimate toggling (3 updates) succeeds
      const guestReceivedMedia: any[] = [];
      guest.on('media:update', (m) => {
        guestReceivedMedia.push(m);
      });

      for (let i = 1; i <= 3; i++) {
        host.emit('media:update', {
          code: created.code,
          media: {
            audioSources: [{ id: 'primary', purpose: 'primary' as const, mode: 'talk' as const, enabled: i % 2 === 0, channels: 2 }],
            cameraEnabled: true
          }
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(guestReceivedMedia.length).toBe(3);
    } finally {
      io.close();
      await app.close();
    }
  });

  it('enforces rate limiting on session actions and lifecycle controls', async () => {
    const { app, io, userStore } = await createApp(
      loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'a-secure-test-secret' }),
      { session: { capacity: 2, refillRate: 1 } }
    );
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}`;
    try {
      const hostUser = await createTestAccount(url, 'host_sessrate', 'beta', userStore);
      const socket = await connected(url);

      // 1. First session create succeeds
      const created = await ack(socket, 'meeting:create', { participantId: '11111111-1111-4111-8111-111111111111', authToken: hostUser.token, media });
      expect(created.ok).toBe(true);

      // 2. Second session control succeeds
      const lockRes1 = await new Promise<{ ok: boolean; message?: string }>((resolve) => {
        socket.emit('meeting:lock', { code: created.ok ? created.code : 'TEST1234', locked: true }, resolve);
      });
      expect(lockRes1.ok).toBe(true);

      // 3. Third immediate session control is throttled
      const lockRes2 = await new Promise<{ ok: boolean; message?: string }>((resolve) => {
        socket.emit('meeting:lock', { code: created.ok ? created.code : 'TEST1234', locked: false }, resolve);
      });
      expect(lockRes2.ok).toBe(false);
      expect(lockRes2.message).toBe('Too many requests. Please slow down.');
    } finally {
      io.close();
      await app.close();
    }
  });

  it('finalizes participant session history upon explicit leave and protects it from later room activity', async () => {
    const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-explicit-leave-'));
    try {
      const config = loadConfig({
        NODE_ENV: 'test',
        TURN_SHARED_SECRET: 'a-secure-test-secret',
        DATA_DIR: tmpDataDir
      });
      const { app, io, userStore, projectStore } = await createApp(config);
      await app.listen({ host: '127.0.0.1', port: 0 });
      const addr = app.server.address() as AddressInfo;
      const url = `http://127.0.0.1:${addr.port}`;

      try {
        const hostReg = await userStore.register({
          username: 'host_dan',
          email: 'host_dan@example.com',
          password: 'Password123!',
          displayName: 'Dan Host'
        });
        userStore.setSessionAccess(hostReg.user.id, 'beta');
        const guestReg = await userStore.register({
          username: 'guest_sarah',
          email: 'guest_sarah@example.com',
          password: 'Password123!',
          displayName: 'Sarah Guest'
        });
        userStore.setSessionAccess(guestReg.user.id, 'beta');
        const project = projectStore.createProject(hostReg.user, { name: 'EP Production' });

        const hostSocket = await connected(url);
        const guestSocket = await connected(url);
        const hostId = '11111111-1111-4111-8111-111111111111';
        const guestId = '22222222-2222-4222-8222-222222222222';

        const created = await ack(hostSocket, 'meeting:create', {
          participantId: hostId,
          authToken: hostReg.token,
          projectId: project.id,
          media
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;

        const joined = await ack(guestSocket, 'meeting:join', {
          code: created.code,
          participantId: guestId,
          authToken: guestReg.token,
          media
        });
        expect(joined.ok).toBe(true);

        // Send 1 chat message while guest is present
        await new Promise((resolve) => hostSocket.emit('chat:send', { code: created.code, text: 'Welcome Sarah' }, resolve));

        // Mutate workspace while guest is present (generates session summary event)
        await new Promise((resolve) => {
          hostSocket.emit('project:workspace:update', {
            projectId: project.id,
            authToken: hostReg.token,
            updates: {
              tasks: {
                tasks: [{ id: 'task_1', title: 'Record Vocals', status: 'done', priority: 'high', assignedTo: guestReg.user.id, createdAt: Date.now(), updatedAt: Date.now() }]
              }
            }
          }, resolve);
        });

        // Guest explicitly leaves
        const hostPeerLeft = new Promise<void>((resolve) => hostSocket.once('peer:left', () => resolve()));
        guestSocket.emit('meeting:leave');
        await hostPeerLeft;

        // Verify guest's session history record is finalized immediately
        const guestHistoryAfterLeave = userStore.getSessionHistory(guestReg.user.id);
        expect(guestHistoryAfterLeave.length).toBe(1);
        expect(guestHistoryAfterLeave[0]?.endedAt).toBeDefined();
        const guestEndedAt = guestHistoryAfterLeave[0]?.endedAt;
        const guestDuration = guestHistoryAfterLeave[0]?.durationSeconds;
        expect(guestHistoryAfterLeave[0]?.summary?.events.length).toBe(1);
        expect(guestHistoryAfterLeave[0]?.summary?.chatMessagesCount).toBe(1);

        // Host is still in the room and continues working
        await new Promise((resolve) => setTimeout(resolve, 50));
        await new Promise((resolve) => hostSocket.emit('chat:send', { code: created.code, text: 'Continuing solo' }, resolve));
        await new Promise((resolve) => hostSocket.emit('chat:send', { code: created.code, text: 'Wrapping up' }, resolve));

        await new Promise((resolve) => {
          hostSocket.emit('project:workspace:update', {
            projectId: project.id,
            authToken: hostReg.token,
            updates: {
              tasks: {
                tasks: [
                  { id: 'task_1', title: 'Record Vocals', status: 'done', priority: 'high', assignedTo: guestReg.user.id, createdAt: Date.now(), updatedAt: Date.now() },
                  { id: 'task_2', title: 'Mix Track', status: 'in_progress', priority: 'medium', createdAt: Date.now(), updatedAt: Date.now() }
                ]
              }
            }
          }, resolve);
        });

        // Host closes the meeting
        hostSocket.emit('meeting:leave');
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Verify guest's session history was completely untouched by later host activity
        const guestHistoryFinal = userStore.getSessionHistory(guestReg.user.id);
        expect(guestHistoryFinal[0]?.endedAt).toBe(guestEndedAt);
        expect(guestHistoryFinal[0]?.durationSeconds).toBe(guestDuration);
        expect(guestHistoryFinal[0]?.summary?.events.length).toBe(1);
        expect(guestHistoryFinal[0]?.summary?.events[0]?.description).toContain('Record Vocals');
        expect(guestHistoryFinal[0]?.summary?.chatMessagesCount).toBe(1);

        // Verify host's session history contains all events and chat messages
        const hostHistoryFinal = userStore.getSessionHistory(hostReg.user.id);
        expect(hostHistoryFinal[0]?.endedAt).toBeDefined();
        expect(hostHistoryFinal[0]?.summary?.events.length).toBe(2);
        expect(hostHistoryFinal[0]?.summary?.chatMessagesCount).toBe(3);
      } finally {
        io.close();
        await app.close();
      }
    } finally {
      if (fs.existsSync(tmpDataDir)) {
        fs.rmSync(tmpDataDir, { recursive: true, force: true });
      }
    }
  });

  it('finalizes participant session history upon host removal and protects it from later room activity', async () => {
    const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-remove-part-'));
    try {
      const config = loadConfig({
        NODE_ENV: 'test',
        TURN_SHARED_SECRET: 'a-secure-test-secret',
        DATA_DIR: tmpDataDir
      });
      const { app, io, userStore, projectStore } = await createApp(config);
      await app.listen({ host: '127.0.0.1', port: 0 });
      const addr = app.server.address() as AddressInfo;
      const url = `http://127.0.0.1:${addr.port}`;

      try {
        const hostReg = await userStore.register({
          username: 'host_kick',
          email: 'host_kick@example.com',
          password: 'Password123!',
          displayName: 'Host Kick'
        });
        userStore.setSessionAccess(hostReg.user.id, 'beta');
        const guestReg = await userStore.register({
          username: 'guest_kicked',
          email: 'guest_kicked@example.com',
          password: 'Password123!',
          displayName: 'Guest Kicked'
        });
        userStore.setSessionAccess(guestReg.user.id, 'beta');
        const project = projectStore.createProject(hostReg.user, { name: 'Kicked Test EP' });

        const hostSocket = await connected(url);
        const guestSocket = await connected(url);
        const hostId = '11111111-1111-4111-8111-111111111111';
        const guestId = '22222222-2222-4222-8222-222222222222';

        const created = await ack(hostSocket, 'meeting:create', {
          participantId: hostId,
          authToken: hostReg.token,
          projectId: project.id,
          media
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;

        const joined = await ack(guestSocket, 'meeting:join', {
          code: created.code,
          participantId: guestId,
          authToken: guestReg.token,
          media
        });
        expect(joined.ok).toBe(true);

        await new Promise((resolve) => hostSocket.emit('chat:send', { code: created.code, text: 'Message before kick' }, resolve));

        const guestRemovedPromise = new Promise<{ code: string; message: string }>((resolve) => guestSocket.once('meeting:removed', resolve));
        const removeRes = await new Promise<{ ok: boolean }>((resolve) => {
          hostSocket.emit('meeting:removeParticipant', { code: created.code, participantId: guestId }, resolve);
        });
        expect(removeRes.ok).toBe(true);
        await guestRemovedPromise;

        // Verify guest session is finalized immediately
        const guestHistory = userStore.getSessionHistory(guestReg.user.id);
        expect(guestHistory.length).toBe(1);
        expect(guestHistory[0]?.endedAt).toBeDefined();
        const guestEndedAt = guestHistory[0]?.endedAt;
        expect(guestHistory[0]?.summary?.chatMessagesCount).toBe(1);

        // Host performs more actions later
        await new Promise((resolve) => hostSocket.emit('chat:send', { code: created.code, text: 'After kick message' }, resolve));
        hostSocket.emit('meeting:leave');
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Verify guest record is unchanged
        const guestHistoryFinal = userStore.getSessionHistory(guestReg.user.id);
        expect(guestHistoryFinal[0]?.endedAt).toBe(guestEndedAt);
        expect(guestHistoryFinal[0]?.summary?.chatMessagesCount).toBe(1);
      } finally {
        io.close();
        await app.close();
      }
    } finally {
      if (fs.existsSync(tmpDataDir)) {
        fs.rmSync(tmpDataDir, { recursive: true, force: true });
      }
    }
  });

  it('finalizes participant session history when disconnect grace period expires without extending on later host activity', async () => {
    const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-disc-expire-'));
    try {
      const config = loadConfig({
        NODE_ENV: 'test',
        TURN_SHARED_SECRET: 'a-secure-test-secret',
        DISCONNECT_GRACE_MS: 1000,
        DATA_DIR: tmpDataDir
      });
      const { app, io, userStore } = await createApp(config);
      await app.listen({ host: '127.0.0.1', port: 0 });
      const addr = app.server.address() as AddressInfo;
      const url = `http://127.0.0.1:${addr.port}`;

      try {
        const hostReg = await userStore.register({
          username: 'host_disc_exp',
          email: 'host_disc_exp@example.com',
          password: 'Password123!',
          displayName: 'Host Disc Exp'
        });
        userStore.setSessionAccess(hostReg.user.id, 'beta');
        const guestReg = await userStore.register({
          username: 'guest_disc_exp',
          email: 'guest_disc_exp@example.com',
          password: 'Password123!',
          displayName: 'Guest Disc Exp'
        });
        userStore.setSessionAccess(guestReg.user.id, 'beta');

        const hostSocket = await connected(url);
        const guestSocket = await connected(url);
        const hostId = '11111111-1111-4111-8111-111111111111';
        const guestId = '22222222-2222-4222-8222-222222222222';

        const created = await ack(hostSocket, 'meeting:create', {
          participantId: hostId,
          authToken: hostReg.token,
          media
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;

        await ack(guestSocket, 'meeting:join', {
          code: created.code,
          participantId: guestId,
          authToken: guestReg.token,
          media
        });

        await new Promise((resolve) => hostSocket.emit('chat:send', { code: created.code, text: 'Hello before disconnect' }, resolve));

        // Guest disconnects
        const hostPeerLeft = new Promise<void>((resolve) => hostSocket.once('peer:left', () => resolve()));
        guestSocket.disconnect();
        await hostPeerLeft;

        // Verify guest record finalized upon expiry
        const guestHistory = userStore.getSessionHistory(guestReg.user.id);
        expect(guestHistory.length).toBe(1);
        expect(guestHistory[0]?.endedAt).toBeDefined();
        const guestEndedAt = guestHistory[0]?.endedAt;
        expect(guestHistory[0]?.summary?.chatMessagesCount).toBe(1);

        // Host sends more chat and closes
        await new Promise((resolve) => hostSocket.emit('chat:send', { code: created.code, text: 'Later host chat' }, resolve));
        hostSocket.emit('meeting:leave');
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Verify guest history not altered
        const guestHistoryFinal = userStore.getSessionHistory(guestReg.user.id);
        expect(guestHistoryFinal[0]?.endedAt).toBe(guestEndedAt);
        expect(guestHistoryFinal[0]?.summary?.chatMessagesCount).toBe(1);
      } finally {
        io.close();
        await app.close();
      }
    } finally {
      if (fs.existsSync(tmpDataDir)) {
        fs.rmSync(tmpDataDir, { recursive: true, force: true });
      }
    }
  });

  it('preserves active participant session history across temporary socket disconnect and reconnect within grace period', async () => {
    const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jameet-reconnect-grace-'));
    try {
      const config = loadConfig({
        NODE_ENV: 'test',
        TURN_SHARED_SECRET: 'a-secure-test-secret',
        DISCONNECT_GRACE_MS: 1000,
        DATA_DIR: tmpDataDir
      });
      const { app, io, userStore } = await createApp(config);
      await app.listen({ host: '127.0.0.1', port: 0 });
      const addr = app.server.address() as AddressInfo;
      const url = `http://127.0.0.1:${addr.port}`;

      try {
        const hostReg = await userStore.register({
          username: 'host_reconn',
          email: 'host_reconn@example.com',
          password: 'Password123!',
          displayName: 'Host Reconn'
        });
        userStore.setSessionAccess(hostReg.user.id, 'beta');
        const guestReg = await userStore.register({
          username: 'guest_reconn',
          email: 'guest_reconn@example.com',
          password: 'Password123!',
          displayName: 'Guest Reconn'
        });
        userStore.setSessionAccess(guestReg.user.id, 'beta');

        const hostSocket = await connected(url);
        const guestSocket1 = await connected(url);
        const hostId = '11111111-1111-4111-8111-111111111111';
        const guestId = '22222222-2222-4222-8222-222222222222';

        const created = await ack(hostSocket, 'meeting:create', {
          participantId: hostId,
          authToken: hostReg.token,
          media
        });
        expect(created.ok).toBe(true);
        if (!created.ok) return;

        const joined1 = await ack(guestSocket1, 'meeting:join', {
          code: created.code,
          participantId: guestId,
          authToken: guestReg.token,
          media
        });
        expect(joined1.ok).toBe(true);
        const reconnectToken = joined1.ok ? joined1.reconnectToken : undefined;

        // Guest disconnects temporarily
        const hostPeerDiscPromise = new Promise<void>((resolve) => hostSocket.once('peer:disconnected', () => resolve()));
        guestSocket1.disconnect();
        await hostPeerDiscPromise;

        // Check that session is NOT prematurely finalized during grace period
        const guestHistoryDuringGrace = userStore.getSessionHistory(guestReg.user.id);
        expect(guestHistoryDuringGrace.length).toBe(1);
        expect(guestHistoryDuringGrace[0]?.endedAt).toBeUndefined();

        // Guest reconnects with new socket before grace period expires
        const guestSocket2 = await connected(url);
        const hostPeerReadyPromise = new Promise<void>((resolve) => hostSocket.once('peer:ready', resolve));
        const joined2 = await ack(guestSocket2, 'meeting:join', {
          code: created.code,
          participantId: guestId,
          authToken: guestReg.token,
          reconnectToken,
          media
        });
        expect(joined2.ok).toBe(true);
        await hostPeerReadyPromise;

        // Still not ended
        const guestHistoryAfterReconn = userStore.getSessionHistory(guestReg.user.id);
        expect(guestHistoryAfterReconn[0]?.endedAt).toBeUndefined();

        // Send chat and host closes
        await new Promise((resolve) => guestSocket2.emit('chat:send', { code: created.code, text: 'Back online!' }, resolve));
        hostSocket.emit('meeting:leave');
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Both sessions are finalized properly upon host session close
        const guestHistoryFinal = userStore.getSessionHistory(guestReg.user.id);
        expect(guestHistoryFinal[0]?.endedAt).toBeDefined();
        expect(guestHistoryFinal[0]?.summary?.chatMessagesCount).toBe(1);

        const hostHistoryFinal = userStore.getSessionHistory(hostReg.user.id);
        expect(hostHistoryFinal[0]?.endedAt).toBeDefined();
        expect(hostHistoryFinal[0]?.summary?.chatMessagesCount).toBe(1);
      } finally {
        io.close();
        await app.close();
      }
    } finally {
      if (fs.existsSync(tmpDataDir)) {
        fs.rmSync(tmpDataDir, { recursive: true, force: true });
      }
    }
  });
});

describe('Server Enforced Session Access & Entitlement Foundation', () => {
  afterEach(() => { for (const socket of sockets.splice(0)) socket.disconnect(); });

  it('strictly denies unauthenticated meeting:create and meeting:join with AUTH_REQUIRED and zero side effects', async () => {
    const { app, io, rooms, userStore } = await createApp(loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'a-secure-test-secret' }));
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}`;
    try {
      const socket = await connected(url);

      // 1. Anonymous create attempt
      const createRes = await ack(socket, 'meeting:create', {
        participantId: '11111111-1111-4111-8111-111111111111',
        guestDisplayName: 'Anonymous Host',
        media
      });
      expect(createRes).toEqual({
        ok: false,
        code: 'AUTH_REQUIRED',
        message: 'Authentication required to create or join a session.'
      });
      // Zero side effects: no room created in memory
      expect(rooms.rooms.size).toBe(0);

      // 2. Anonymous join attempt
      const joinRes = await ack(socket, 'meeting:join', {
        code: 'ABC2DEF3',
        participantId: '22222222-2222-4222-8222-222222222222',
        guestDisplayName: 'Anonymous Guest',
        media
      });
      expect(joinRes).toEqual({
        ok: false,
        code: 'AUTH_REQUIRED',
        message: 'Authentication required to create or join a session.'
      });

      // 3. Invalid/malformed auth token attempt
      const invalidTokenRes = await ack(socket, 'meeting:create', {
        participantId: '11111111-1111-4111-8111-111111111111',
        authToken: 'malicious-invalid-token-here',
        media
      });
      expect(invalidTokenRes).toEqual({
        ok: false,
        code: 'AUTH_REQUIRED',
        message: 'Authentication required to create or join a session.'
      });
      expect(rooms.rooms.size).toBe(0);
    } finally {
      io.close();
      await app.close();
    }
  });

  it('strictly denies blocked accounts from creating or joining sessions with ACCESS_DENIED and zero side effects', async () => {
    const { app, io, rooms, userStore } = await createApp(loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'a-secure-test-secret' }));
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}`;
    try {
      // Newly registered accounts default to blocked
      const blockedUser = await createTestAccount(url, 'blocked_artist', 'blocked', userStore);
      const validHost = await createTestAccount(url, 'valid_host', 'beta', userStore);

      const blockedSocket = await connected(url);
      const hostSocket = await connected(url);

      // 1. Blocked account cannot create session
      const createRes = await ack(blockedSocket, 'meeting:create', {
        participantId: '11111111-1111-4111-8111-111111111111',
        authToken: blockedUser.token,
        media
      });
      expect(createRes).toEqual({
        ok: false,
        code: 'ACCESS_DENIED',
        message: 'Your account does not currently have access to JaMeet sessions.'
      });
      expect(rooms.rooms.size).toBe(0);
      expect(userStore.getStoredUser(blockedUser.user.id)?.sessionsHostedCount).toBe(0);

      // 2. Valid beta host creates a session
      const hostCreated = await ack(hostSocket, 'meeting:create', {
        participantId: '22222222-2222-4222-8222-222222222222',
        authToken: validHost.token,
        media
      });
      expect(hostCreated.ok).toBe(true);
      if (!hostCreated.ok) return;

      // 3. Blocked account cannot join session
      const joinRes = await ack(blockedSocket, 'meeting:join', {
        code: hostCreated.code,
        participantId: '33333333-3333-4333-8333-333333333333',
        authToken: blockedUser.token,
        media
      });
      expect(joinRes).toEqual({
        ok: false,
        code: 'ACCESS_DENIED',
        message: 'Your account does not currently have access to JaMeet sessions.'
      });

      // Verify room only contains host and collaborator session was not recorded
      const room = rooms.rooms.get(hostCreated.code);
      expect(room?.participants.size).toBe(1);
      expect(userStore.getSessionHistory(blockedUser.user.id).length).toBe(0);
    } finally {
      io.close();
      await app.close();
    }
  });

  it('allows blocked users to log in, view/update profile, and manage projects, but denies live sessions', async () => {
    const { app, io, userStore } = await createApp(loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'a-secure-test-secret' }));
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}`;
    try {
      const blockedAcct = await createTestAccount(url, 'acct_only', 'blocked', userStore);
      const token = blockedAcct.token;

      // 1. Can log in and fetch me profile
      const meRes = await fetch(`${url}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const meData = await meRes.json() as any;
      expect(meRes.status).toBe(200);
      expect(meData.user.id).toBe(blockedAcct.user.id);

      // 2. Can create a project
      const projRes = await fetch(`${url}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: 'Solo Project' })
      });
      const projData = await projRes.json() as any;
      expect(projRes.status).toBe(201);
      expect(projData.project.name).toBe('Solo Project');

      // 3. Socket session creation is denied with ACCESS_DENIED
      const socket = await connected(url);
      const createRes = await ack(socket, 'meeting:create', {
        participantId: '11111111-1111-4111-8111-111111111111',
        authToken: token,
        media
      });
      expect(createRes).toEqual({
        ok: false,
        code: 'ACCESS_DENIED',
        message: 'Your account does not currently have access to JaMeet sessions.'
      });
    } finally {
      io.close();
      await app.close();
    }
  });

  it('rejects beta users with BETA_ENDED when BETA_END_AT is expired, but allows paid users', async () => {
    const betaEndIso = '2026-06-01T00:00:00Z';
    const { app, io, userStore } = await createApp(loadConfig({
      NODE_ENV: 'test',
      TURN_SHARED_SECRET: 'a-secure-test-secret',
      BETA_END_AT: betaEndIso
    }));
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}`;
    try {
      const betaUser = await createTestAccount(url, 'beta_exp_user', 'beta', userStore);
      const paidUser = await createTestAccount(url, 'paid_subscriber', 'paid', userStore);

      const betaSocket = await connected(url);
      const paidSocket = await connected(url);

      // 1. Beta user is rejected with BETA_ENDED
      const betaCreateRes = await ack(betaSocket, 'meeting:create', {
        participantId: '11111111-1111-4111-8111-111111111111',
        authToken: betaUser.token,
        media
      });
      expect(betaCreateRes).toEqual({
        ok: false,
        code: 'BETA_ENDED',
        message: 'JaMeet Beta has ended. A JaMeet subscription will be required to continue creating or joining sessions.'
      });

      // 2. Paid subscriber creates session successfully even with expired BETA_END_AT
      const paidCreateRes = await ack(paidSocket, 'meeting:create', {
        participantId: '22222222-2222-4222-8222-222222222222',
        authToken: paidUser.token,
        media
      });
      expect(paidCreateRes.ok).toBe(true);
      if (!paidCreateRes.ok) return;
      expect(paidCreateRes.identity.username).toBe(paidUser.user.username);
      expect(paidCreateRes.identity.isGuest).toBe(false);

      // 3. Beta user trying to join paid session is also rejected with BETA_ENDED
      const betaJoinRes = await ack(betaSocket, 'meeting:join', {
        code: paidCreateRes.code,
        participantId: '33333333-3333-4333-8333-333333333333',
        authToken: betaUser.token,
        media
      });
      expect(betaJoinRes).toEqual({
        ok: false,
        code: 'BETA_ENDED',
        message: 'JaMeet Beta has ended. A JaMeet subscription will be required to continue creating or joining sessions.'
      });
    } finally {
      io.close();
      await app.close();
    }
  });

  it('fails closed if sessionAccess in storage contains unknown or malformed value', async () => {
    const { app, io, userStore } = await createApp(loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'a-secure-test-secret' }));
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}`;
    try {
      const user = await createTestAccount(url, 'corrupted_state_user', 'beta', userStore);
      userStore.setSessionAccess(user.user.id, 'unrecognized_tier' as any);

      const socket = await connected(url);
      const createRes = await ack(socket, 'meeting:create', {
        participantId: '11111111-1111-4111-8111-111111111111',
        authToken: user.token,
        media
      });
      expect(createRes).toEqual({
        ok: false,
        code: 'ACCESS_DENIED',
        message: 'Your account does not currently have access to JaMeet sessions.'
      });
    } finally {
      io.close();
      await app.close();
    }
  });
});








