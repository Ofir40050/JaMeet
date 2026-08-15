import type { AddressInfo } from 'node:net';
import { io as client, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import type { MeetingAck } from '@musiczoom/shared';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

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
      expect(admittedAck.peerPresent).toBe(true);
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
      const rejoinAck = await ack(guestReconnected, 'meeting:join', { code: created.code, participantId: guestId, media });
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
});
