import { io, type Socket } from 'socket.io-client';
import type { MediaMetadata, MeetingAck, SessionChatMessage, UpdateProjectWorkspaceRequest, UpdateProjectWorkspaceResponse } from '@jameet/shared';
import { logger } from './logger';

type Listener = (...args: any[]) => void;

export class SignalingClient {
  private socket: Socket;
  private resume?: { code: string; participantId: string; media: MediaMetadata; authToken?: string; guestDisplayName?: string; reconnectToken?: string };
  private activeProjectWorkspace?: { projectId: string; authToken?: string };

  constructor(url: string) {
    this.socket = io(url, { autoConnect: false, reconnection: true, reconnectionDelayMax: 4000 });
    
    this.socket.on('connect', () => {
      logger.info('signaling_connected', 'Signaling socket connected', { socketId: this.socket.id });
      if (this.resume) {
        logger.info('session_auto_reconnect_attempt', 'Attempting auto-reconnect after socket reconnection', { code: this.resume.code, participantId: this.resume.participantId }, { sessionCode: this.resume.code });
        this.emitWithAck('meeting:join', this.resume).then((res) => {
          if (res?.ok) {
            logger.info('session_auto_reconnect_success', 'Auto-reconnected to session successfully', { code: res.code }, { sessionCode: res.code });
            if (res.reconnectToken && this.resume) {
              this.resume.reconnectToken = res.reconnectToken;
            }
          } else {
            logger.warn('session_auto_reconnect_failure', 'Auto-reconnect failed', { code: this.resume?.code, reason: res?.message }, { sessionCode: this.resume?.code });
          }
        }).catch((err) => {
          logger.warn('session_auto_reconnect_error', 'Auto-reconnect error', { code: this.resume?.code }, err, { sessionCode: this.resume?.code });
        });
      }
      if (this.activeProjectWorkspace) {
        this.socket.emit('project:workspace:join', this.activeProjectWorkspace, (res: { ok: boolean; workspace?: any; message?: string }) => {
          if (res?.ok && res.workspace && this.activeProjectWorkspace) {
            const syncPayload = {
              projectId: this.activeProjectWorkspace.projectId,
              workspace: res.workspace
            };
            const listeners = (this.socket as any).listeners?.('project:workspace:synced') || [];
            listeners.forEach((listener: Listener) => {
              try { listener(syncPayload); } catch (e) { logger.warn('workspace_sync_listener_error', 'Error in workspace sync listener', undefined, e as Error); }
            });
          }
        });
      }
    });

    this.socket.on('disconnect', (reason) => {
      logger.info('signaling_disconnected', `Signaling socket disconnected: ${reason}`, { reason });
    });

    this.socket.io?.on?.('reconnect_attempt', (attempt: number) => {
      logger.info('signaling_reconnect_attempt', `Signaling socket reconnect attempt #${attempt}`, { attempt });
    });

    this.socket.io?.on?.('reconnect', (attempt: number) => {
      logger.info('signaling_reconnected', `Signaling socket reconnected after ${attempt} attempts`, { attempt });
    });

    this.socket.io?.on?.('reconnect_error', (err: Error) => {
      logger.warn('signaling_reconnect_error', 'Signaling socket reconnect error', undefined, err);
    });
  }

  on(event: string, listener: Listener): () => void {
    this.socket.on(event, listener);
    return () => this.socket.off(event, listener);
  }

  private async connect(): Promise<void> {
    if (this.socket.connected) return;
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => { cleanup(); reject(new Error('Could not reach the JaMeet service.')); }, 10_000);
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
    logger.info('session_create_attempt', 'Attempting to create session', { participantId, projectId, waitingRoomEnabled: Boolean(waitingRoomEnabled) });
    try {
      const ack = await this.emitWithAck('meeting:create', { participantId, media, authToken, guestDisplayName, projectId, waitingRoomEnabled });
      if (ack.ok) {
        logger.info('session_create_success', 'Session created successfully', { code: ack.code, role: ack.role, projectId }, { sessionCode: ack.code });
        this.resume = { code: ack.code, participantId, media, authToken, guestDisplayName, reconnectToken: ack.reconnectToken };
      } else {
        logger.warn('session_create_failure', 'Session creation failed', { code: ack.code, reason: ack.message });
      }
      return ack;
    } catch (err) {
      logger.error('session_create_error', 'Unexpected error creating session', { participantId }, err);
      throw err;
    }
  }

  async join(code: string, participantId: string, media: MediaMetadata, authToken?: string, guestDisplayName?: string): Promise<MeetingAck> {
    logger.info('session_join_attempt', 'Attempting to join session', { code, participantId }, { sessionCode: code });
    try {
      const ack = await this.emitWithAck('meeting:join', { code, participantId, media, authToken, guestDisplayName });
      if (ack.ok) {
        logger.info('session_join_success', 'Joined session successfully', { code: ack.code, role: ack.role, waiting: ack.waiting, peerPresent: ack.peerPresent }, { sessionCode: ack.code });
        this.resume = { code: ack.code, participantId, media, authToken, guestDisplayName, reconnectToken: ack.reconnectToken };
      } else {
        logger.warn('session_join_failure', 'Session join failed', { code, reason: (ack as any).code || (ack as any).reason, message: ack.message }, { sessionCode: code });
      }
      return ack;
    } catch (err) {
      logger.error('session_join_error', 'Unexpected error joining session', { code, participantId }, err, { sessionCode: code });
      throw err;
    }
  }

  setResume(code: string, participantId: string, media: MediaMetadata, authToken?: string, guestDisplayName?: string, reconnectToken?: string): void {
    this.resume = { code, participantId, media, authToken, guestDisplayName, reconnectToken };
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

  async updateProjectWorkspace(
    projectId: string,
    updates: UpdateProjectWorkspaceRequest,
    authToken?: string
  ): Promise<UpdateProjectWorkspaceResponse> {
    await this.connect();
    return new Promise((resolve) => {
      this.socket.timeout(5_000).emit('project:workspace:update', { projectId, authToken, updates }, (err: Error | null, res: any) => {
        if (err || !res) resolve({ ok: false, message: err?.message || 'Timeout updating workspace' });
        else resolve(res as UpdateProjectWorkspaceResponse);
      });
    });
  }
}
