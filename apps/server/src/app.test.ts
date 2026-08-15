import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { io as client, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import type { MeetingAck } from '@musiczoom/shared';
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

describe('signaling integration', () => {
  afterEach(() => { for (const socket of sockets.splice(0)) socket.disconnect(); });

  it('creates, joins, relays signaling, rejects a third person, and handles leave', async () => {
    const { app, io } = await createApp(loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'a-secure-test-secret' }));
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}`;
    try {
      const host = await connected(url);
      const guest = await connected(url);
      const third = await connected(url);
      const created = await ack(host, 'meeting:create', { participantId: '11111111-1111-4111-8111-111111111111', media });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const peerReady = new Promise<{ media: typeof media }>((resolve) => host.once('peer:ready', resolve));
      const joined = await ack(guest, 'meeting:join', { code: created.code, participantId: '22222222-2222-4222-8222-222222222222', media });
      expect(joined).toMatchObject({ ok: true, role: 'guest', peerPresent: true });
      expect((await peerReady).media.audioSources[0]?.mode).toBe('music');
      expect(await ack(third, 'meeting:join', { code: created.code, participantId: '33333333-3333-4333-8333-333333333333', media })).toMatchObject({ ok: false, code: 'ROOM_FULL' });

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
    const { app, io } = await createApp(loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'a-secure-test-secret' }));
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}`;
    try {
      const host = await connected(url);
      const guest = await connected(url);
      const guestId = '22222222-2222-4222-8222-222222222222';

      // 1. Host creates room with Waiting Room enabled
      const created = await ack(host, 'meeting:create', {
        participantId: '11111111-1111-4111-8111-111111111111',
        media,
        waitingRoomEnabled: true
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // 2. Guest joins - should receive waiting: true
      const waitingUpdatePromise = new Promise<any[]>((resolve) => host.once('waiting:update', resolve));
      const joined = await ack(guest, 'meeting:join', { code: created.code, participantId: guestId, media });
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
    const { app, io } = await createApp(loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'a-secure-test-secret' }));
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}`;
    try {
      const host = await connected(url);
      const guest = await connected(url);
      const third = await connected(url);
      const hostId = '11111111-1111-4111-8111-111111111111';
      const guestId = '22222222-2222-4222-8222-222222222222';
      const thirdId = '33333333-3333-4333-8333-333333333333';

      // 1. Host creates room
      const created = await ack(host, 'meeting:create', { participantId: hostId, media, waitingRoomEnabled: true });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // 2. Guest joins and is in waiting room
      const guestWaiting = await ack(guest, 'meeting:join', { code: created.code, participantId: guestId, media });
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
      const thirdJoin = await ack(third, 'meeting:join', { code: created.code, participantId: thirdId, media });
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
    const { app, io } = await createApp(loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'a-secure-test-secret' }));
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}`;
    try {
      const host = await connected(url);
      const guest = await connected(url);
      const hostId = '11111111-1111-4111-8111-111111111111';
      const guestId = '22222222-2222-4222-8222-222222222222';

      // 1. Host creates room with Waiting Room enabled
      const created = await ack(host, 'meeting:create', { participantId: hostId, media, waitingRoomEnabled: true });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // 2. Guest joins and is admitted by host
      await ack(guest, 'meeting:join', { code: created.code, participantId: guestId, media });
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
      const guestRejoin = await ack(guest, 'meeting:join', { code: created.code, participantId: guestId, media });
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
    const { app, io } = await createApp(loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'a-secure-test-secret' }));
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}`;
    try {
      const host = await connected(url);
      const guest = await connected(url);
      const attacker = await connected(url);

      const hostId = '11111111-1111-4111-8111-111111111111';
      const guestId = '22222222-2222-4222-8222-222222222222';
      const attackerId = '99999999-9999-4999-8999-999999999999';

      // 1. Host creates session
      const hostCreated = await ack(host, 'meeting:create', { participantId: hostId, media });
      expect(hostCreated.ok).toBe(true);
      if (!hostCreated.ok) return;
      expect(hostCreated.role).toBe('host');
      expect(hostCreated.reconnectToken).toBeDefined();
      const hostReconnectToken = hostCreated.reconnectToken;

      // 2. Guest joins session
      const guestPeerReadyPromise = new Promise<any>((resolve) => host.once('peer:ready', resolve));
      const guestJoined = await ack(guest, 'meeting:join', { code: hostCreated.code, participantId: guestId, media });
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
        media
      });
      expect(hijackHostNoToken).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });

      // 4. Attacker attempts to hijack host role with bogus token
      const hijackHostBogusToken = await ack(attacker, 'meeting:join', {
        code: hostCreated.code,
        participantId: hostId,
        media,
        reconnectToken: 'bogus-token-1234'
      });
      expect(hijackHostBogusToken).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });

      // 5. Attacker attempts to hijack guest slot with guest's participantId without token
      const hijackGuestNoToken = await ack(attacker, 'meeting:join', {
        code: hostCreated.code,
        participantId: guestId,
        media
      });
      expect(hijackGuestNoToken).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });

      // 6. Host temporarily disconnects
      host.disconnect();

      // Attacker attempts to hijack host slot while host is in disconnect grace period
      const hijackHostDuringDisconnect = await ack(attacker, 'meeting:join', {
        code: hostCreated.code,
        participantId: hostId,
        media
      });
      expect(hijackHostDuringDisconnect).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });

      // Legitimate host reconnects with valid reconnectToken -> succeeds and retains host role
      const hostReconnected = await connected(url);
      const hostRejoin = await ack(hostReconnected, 'meeting:join', {
        code: hostCreated.code,
        participantId: hostId,
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
        media
      });
      expect(hijackGuestDuringDisconnect).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });

      // Legitimate guest reconnects with valid reconnectToken -> succeeds and retains guest role
      const guestReconnected = await connected(url);
      const guestRejoin = await ack(guestReconnected, 'meeting:join', {
        code: hostCreated.code,
        participantId: guestId,
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
    const { app, io } = await createApp(loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'a-secure-test-secret' }));
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}`;
    try {
      const host = await connected(url);
      const guest = await connected(url);
      const outsider = await connected(url);
      const hostId = '11111111-1111-4111-8111-111111111111';
      const guestId = '22222222-2222-4222-8222-222222222222';

      const created = await ack(host, 'meeting:create', { participantId: hostId, media });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const joined = await ack(guest, 'meeting:join', { code: created.code, participantId: guestId, media });
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
      const guestUser = await userStore.register({
        username: `guitarist_bob_${suffix}`,
        email: `bob_${suffix}@test.com`,
        password: 'password123',
        displayName: 'Bob The Guitarist'
      });

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

  it('preserves unauthenticated guest custom display name across reconnections', async () => {
    const { app, io } = await createApp(loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'a-secure-test-secret' }));
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}`;
    try {
      const hostSocket = await connected(url);
      const guestSocket = await connected(url);
      const hostId = '11111111-1111-4111-8111-111111111111';
      const guestId = '22222222-2222-4222-8222-222222222222';

      // 1. Host creates meeting as guest with custom name
      const created = await ack(hostSocket, 'meeting:create', {
        participantId: hostId,
        guestDisplayName: 'Host Maestro',
        media
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const initialHostIdentityId = created.identity.id;
      expect(created.identity.displayName).toBe('Host Maestro');
      expect(created.identity.isHost).toBe(true);
      expect(created.identity.isGuest).toBe(true);

      // 2. Guest joins meeting with custom name
      const joined = await ack(guestSocket, 'meeting:join', {
        code: created.code,
        participantId: guestId,
        guestDisplayName: 'Session Drummer',
        media
      });
      expect(joined.ok).toBe(true);
      if (!joined.ok) return;
      const initialGuestIdentityId = joined.identity.id;
      expect(joined.identity.displayName).toBe('Session Drummer');
      expect(joined.identity.isGuest).toBe(true);

      // 3. Guest reconnects with guestDisplayName and reconnectToken
      guestSocket.disconnect();
      const guestReconnected = await connected(url);
      const hostPeerReadyPromise = new Promise<any>((resolve) => hostSocket.once('peer:ready', resolve));
      const rejoinAck = await ack(guestReconnected, 'meeting:join', {
        code: created.code,
        participantId: guestId,
        guestDisplayName: 'Session Drummer',
        reconnectToken: joined.reconnectToken,
        media
      });
      expect(rejoinAck.ok).toBe(true);
      if (!rejoinAck.ok) return;
      expect(rejoinAck.identity.id).toBe(initialGuestIdentityId); // Preserves original guest UUID
      expect(rejoinAck.identity.displayName).toBe('Session Drummer'); // Not downgraded to "Guest Musician"
      expect(rejoinAck.identity.isGuest).toBe(true);
      expect(rejoinAck.identity.isHost).toBe(false);

      const peerReady = await hostPeerReadyPromise;
      expect(peerReady.identity.displayName).toBe('Session Drummer');
      expect(peerReady.identity.id).toBe(initialGuestIdentityId);
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
        const guestReg = await userStore.register({
          username: 'guest_musician',
          email: 'guest@example.com',
          password: 'Password123!',
          displayName: 'Guest Musician'
        });

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
        const guestReg = await userStore.register({
          username: 'guest_waiting',
          email: 'admit_guest@example.com',
          password: 'Password123!',
          displayName: 'Admit Guest'
        });

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
        const guestReg = await userStore.register({
          username: 'cross_guest',
          email: 'cross_guest@example.com',
          password: 'Password123!',
          displayName: 'Cross Guest'
        });
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
    const { app, io } = await createApp(loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'a-secure-test-secret' }));
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}`;
    try {
      const hostSocket = await connected(url);
      const waitingSocket = await connected(url);
      const attackerSocket = await connected(url);

      const hostId = '11111111-1111-4111-8111-111111111111';
      const waitingId = '22222222-2222-4222-8222-222222222222';

      // 1. Host creates meeting with waiting room enabled
      const created = await ack(hostSocket, 'meeting:create', {
        participantId: hostId,
        guestDisplayName: 'Host Maestro',
        waitingRoomEnabled: true,
        media
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // 2. Participant joins waiting room and receives server-issued reconnectToken
      const waitingJoinAck = await ack(waitingSocket, 'meeting:join', {
        code: created.code,
        participantId: waitingId,
        guestDisplayName: 'Waiting Vocalist',
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
        guestDisplayName: 'Attacker',
        reconnectToken: 'bogus-attacker-token',
        media
      });
      expect(attackerBogus).toMatchObject({ ok: false, code: 'UNAUTHORIZED' });

      // 5. Attacker attempts to hijack waiting participant slot without any token -> rejected UNAUTHORIZED
      const attackerNoToken = await ack(attackerSocket, 'meeting:join', {
        code: created.code,
        participantId: waitingId,
        guestDisplayName: 'Attacker',
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
        guestDisplayName: 'Waiting Vocalist',
        reconnectToken: serverIssuedWaitingToken,
        media
      });
      expect(rejoinAck.ok).toBe(true);
      if (!rejoinAck.ok || !rejoinAck.waiting) return;
      expect(rejoinAck.waiting).toBe(true);
      expect(rejoinAck.identity.displayName).toBe('Waiting Vocalist');

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
    const { app, io } = await createApp(loadConfig({ NODE_ENV: 'test', TURN_SHARED_SECRET: 'a-secure-test-secret' }));
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address() as AddressInfo;
    const url = `http://127.0.0.1:${address.port}`;
    try {
      const hostSocket1 = await connected(url);
      const guestSocket = await connected(url);

      const hostId = '11111111-1111-4111-8111-111111111111';
      const guestId = '22222222-2222-4222-8222-222222222222';

      // 1. Host creates meeting
      const created = await ack(hostSocket1, 'meeting:create', {
        participantId: hostId,
        guestDisplayName: 'Host Maestro',
        media
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // 2. Guest joins
      const guestJoined = await ack(guestSocket, 'meeting:join', {
        code: created.code,
        participantId: guestId,
        guestDisplayName: 'Guest Musician',
        media
      });
      expect(guestJoined.ok).toBe(true);

      // 3. Host reconnects on hostSocket2
      const hostSocket2 = await connected(url);
      const hostReconnected = await ack(hostSocket2, 'meeting:join', {
        code: created.code,
        participantId: hostId,
        guestDisplayName: 'Host Maestro',
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
});





