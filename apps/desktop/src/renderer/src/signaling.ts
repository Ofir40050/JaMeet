import { io, type Socket } from 'socket.io-client';
import type { MediaMetadata, MeetingAck, SessionChatMessage } from '@musiczoom/shared';

type Listener = (...args: any[]) => void;

export class SignalingClient {
  private socket: Socket;
  private resume?: { code: string; participantId: string; media: MediaMetadata };
  private activeProjectWorkspace?: { projectId: string; authToken?: string };

  constructor(url: string) {
    this.socket = io(url, { autoConnect: false, reconnection: true, reconnectionDelayMax: 4000 });
    this.socket.on('connect', () => {
      if (this.resume) this.emitWithAck('meeting:join', this.resume).catch(() => undefined);
      if (this.activeProjectWorkspace) {
        this.socket.emit('project:workspace:join', this.activeProjectWorkspace, (_err: Error | null, res: any) => {
          if (res?.ok && res.workspace && this.activeProjectWorkspace) {
            this.socket.emit('project:workspace:synced', {
              projectId: this.activeProjectWorkspace.projectId,
              workspace: res.workspace
            });
          }
        });
      }
    });
  }

  on(event: string, listener: Listener): () => void {
    this.socket.on(event, listener);
    return () => this.socket.off(event, listener);
  }

  private async connect(): Promise<void> {
    if (this.socket.connected) return;
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => { cleanup(); reject(new Error('Could not reach the MusicZoom service.')); }, 10_000);
      const connected = () => { cleanup(); resolve(); };
      const failed = (error: Error) => { cleanup(); reject(error); };
      const cleanup = () => {
        window.clearTimeout(timer);
        this.socket.off('connect', connected);
        this.socket.off('connect_error', failed);
      };
      this.socket.once('connect', connected);
      this.socket.once('connect_error', failed);
      this.socket.connect();
    });
  }

  private async emitWithAck(event: string, payload: unknown): Promise<MeetingAck> {
    await this.connect();
    return new Promise((resolve, reject) => {
      this.socket.timeout(8_000).emit(event, payload, (error: Error | null, response: MeetingAck) => {
        if (error) reject(new Error('The signaling service did not respond.'));
        else resolve(response);
      });
    });
  }

  async create(participantId: string, media: MediaMetadata, authToken?: string, guestDisplayName?: string, projectId?: string, waitingRoomEnabled?: boolean): Promise<MeetingAck> {
    const ack = await this.emitWithAck('meeting:create', { participantId, media, authToken, guestDisplayName, projectId, waitingRoomEnabled });
    if (ack.ok) this.resume = { code: ack.code, participantId, media };
    return ack;
  }
  async join(code: string, participantId: string, media: MediaMetadata, authToken?: string, guestDisplayName?: string): Promise<MeetingAck> {
    const ack = await this.emitWithAck('meeting:join', { code, participantId, media, authToken, guestDisplayName });
    if (ack.ok && !ack.waiting) this.resume = { code: ack.code, participantId, media };
    return ack;
  }
  setResume(code: string, participantId: string, media: MediaMetadata): void {
    this.resume = { code, participantId, media };
  }
  updateResumeMedia(media: MediaMetadata): void { if (this.resume) this.resume.media = media; }
  sendDescription(code: string, description: RTCSessionDescriptionInit): void { this.socket.emit('signal:description', { code, description }); }
  sendCandidate(code: string, candidate: RTCIceCandidateInit | null): void { this.socket.emit('signal:candidate', { code, candidate }); }
  requestRenegotiation(code: string): void { this.socket.emit('signal:renegotiate', { code }); }
  updateMedia(code: string, media: MediaMetadata): void { this.updateResumeMedia(media); this.socket.emit('media:update', { code, media }); }
  async sendChatMessage(code: string, text: string): Promise<{ ok: boolean; message?: SessionChatMessage; error?: string }> {
    await this.connect();
    return new Promise((resolve) => {
      this.socket.timeout(5_000).emit('chat:send', { code, text }, (err: Error | null, res: any) => {
        if (err || !res) resolve({ ok: false, error: err?.message || 'Failed to send message' });
        else resolve(res);
      });
    });
  }
  async admitParticipant(code: string, participantId: string): Promise<{ ok: boolean; message?: string }> {
    await this.connect();
    return new Promise((resolve) => {
      this.socket.timeout(5_000).emit('waiting:admit', { code, participantId }, (err: Error | null, res: any) => {
        if (err || !res) resolve({ ok: false, message: err?.message || 'Failed to admit participant' });
        else resolve(res);
      });
    });
  }
  async setSessionLock(code: string, locked: boolean): Promise<{ ok: boolean; locked?: boolean; message?: string }> {
    await this.connect();
    return new Promise((resolve) => {
      this.socket.timeout(5_000).emit('meeting:lock', { code, locked }, (err: Error | null, res: any) => {
        if (err || !res) resolve({ ok: false, message: err?.message || 'Failed to update session lock' });
        else resolve(res);
      });
    });
  }
  async removeParticipant(code: string, participantId: string): Promise<{ ok: boolean; message?: string }> {
    await this.connect();
    return new Promise((resolve) => {
      this.socket.timeout(5_000).emit('meeting:removeParticipant', { code, participantId }, (err: Error | null, res: any) => {
        if (err || !res) resolve({ ok: false, message: err?.message || 'Failed to remove participant' });
        else resolve(res);
      });
    });
  }
  leave(): void { this.socket.emit('meeting:leave'); this.resume = undefined; }
  disconnect(): void { this.resume = undefined; this.socket.disconnect(); }

  getSocket(): Socket {
    return this.socket;
  }

  async joinProjectWorkspace(projectId: string, authToken?: string): Promise<{ ok: boolean; workspace?: any; message?: string }> {
    this.activeProjectWorkspace = { projectId, authToken };
    await this.connect();
    return new Promise((resolve) => {
      this.socket.timeout(5_000).emit('project:workspace:join', { projectId, authToken }, (err: Error | null, res: any) => {
        if (err || !res) resolve({ ok: false, message: err?.message || 'Timeout joining workspace' });
        else resolve(res);
      });
    });
  }

  leaveProjectWorkspace(projectId: string): void {
    if (this.activeProjectWorkspace?.projectId === projectId) {
      this.activeProjectWorkspace = undefined;
    }
    if (this.socket.connected) {
      this.socket.emit('project:workspace:leave', { projectId });
    }
  }

  async updateProjectWorkspace(projectId: string, updates: any, authToken?: string): Promise<{ ok: boolean; workspace?: any; message?: string }> {
    await this.connect();
    return new Promise((resolve) => {
      this.socket.timeout(5_000).emit('project:workspace:update', { projectId, authToken, updates }, (err: Error | null, res: any) => {
        if (err || !res) resolve({ ok: false, message: err?.message || 'Timeout updating workspace' });
        else resolve(res);
      });
    });
  }
}
