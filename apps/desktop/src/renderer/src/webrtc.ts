import type { AudioMode, IceServerConfig, MediaMetadata, MeetingRole, VideoQuality } from '@jameet/shared';
import { opusBitrate } from './audioProfiles';
import { LocalAudioSourceManager } from './audioSources';
import { applyOpusPolicy } from './opus';
import { SignalingClient } from './signaling';
import { lowerQuality, VIDEO_QUALITY } from './videoQuality';
import { logger } from './logger';

function parseSpropStereo(fmtpText: string): boolean {
  const params = fmtpText.split(';').map((p) => p.trim());
  for (const param of params) {
    const [key, val] = param.split('=', 2);
    if (key?.trim().toLowerCase() === 'sprop-stereo') {
      return val?.trim() === '1';
    }
  }
  return false;
}

function extractMediaSectionByMid(sdp: string, mid: string): string | null {
  if (!mid) return null;
  const lines = sdp.split(/\r?\n/);
  const sections: string[][] = [];
  let currentSection: string[] | null = null;

  for (const line of lines) {
    if (line.startsWith('m=')) {
      if (currentSection) sections.push(currentSection);
      currentSection = [line];
    } else if (currentSection) {
      currentSection.push(line);
    }
  }
  if (currentSection) sections.push(currentSection);

  for (const sec of sections) {
    if (sec.some((l) => l.trim() === `a=mid:${mid}`)) {
      return sec.join('\n');
    }
  }

  return null;
}

export class WebRtcSession {
  private pc?: RTCPeerConnection;
  private code = '';
  private role: MeetingRole = 'guest';
  private iceServers: IceServerConfig[] = [];
  private videoTrack?: MediaStreamTrack;
  private videoSender?: RTCRtpSender;
  private localMode: AudioMode = 'talk';
  private remoteMode: AudioMode = 'talk';
  private remoteHasMusic = false;
  private musicBitrate = 256_000;
  private localVideoQuality: VideoQuality = 'low';
  private remoteReceiveVideoQuality: VideoQuality = 'low';
  private remoteAudioOnly = false;
  private audioTransceivers = new Map<string, RTCRtpTransceiver>();
  private audioPurpose = new Map<RTCRtpTransceiver, { id: string; purpose: 'voice' | 'music' }>();
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private iceRestarted = false;
  private disconnectTimer?: number;
  private remoteStream = new MediaStream();

  private voiceStereo = false;
  private inboundStatsTimer?: number;

  constructor(
    private readonly signaling: SignalingClient,
    private readonly audio: LocalAudioSourceManager,
    private readonly onRemoteStream: (stream?: MediaStream) => void,
    private readonly onRemoteAudio: (id: string, purpose: 'voice' | 'music', track: MediaStreamTrack) => void,
    private readonly onRemoteMedia: (media: MediaMetadata) => void,
    private readonly onStatus: (status: string) => void,
    private readonly onVoiceStereoChange?: (isStereo: boolean) => void
  ) {
    signaling.on('signal:description', (description: RTCSessionDescriptionInit) => void this.receiveDescription(description));
    signaling.on('signal:candidate', (candidate: RTCIceCandidateInit | null) => void this.receiveCandidate(candidate));
    signaling.on('signal:renegotiate', () => { if (this.role === 'host') void this.negotiate(); });
    signaling.on('media:update', (media: MediaMetadata) => {
      this.remoteMode = media.audioSources[0]?.mode ?? 'talk';
      this.remoteHasMusic = media.audioSources.some((source) => source.purpose === 'music');
      this.remoteReceiveVideoQuality = media.preferredReceiveVideoQuality ?? 'low';
      this.remoteAudioOnly = media.audioOnly ?? false;
      if (this.videoTrack) void this.updateVideoSenderParameters(this.videoTrack);
      this.onRemoteMedia(media);
      if (this.role === 'host') void this.negotiate();
    });
  }

  configure(code: string, role: MeetingRole, iceServers: IceServerConfig[], mode: AudioMode, localVideoQuality: VideoQuality, musicBitrate: number, remoteMedia?: MediaMetadata): void {
    this.code = code;
    this.role = role;
    this.iceServers = iceServers;
    this.localMode = mode;
    this.musicBitrate = musicBitrate;
    this.localVideoQuality = localVideoQuality;
    this.remoteMode = remoteMedia?.audioSources[0]?.mode ?? 'talk';
    this.remoteHasMusic = remoteMedia?.audioSources.some((source) => source.purpose === 'music') ?? false;
    this.remoteReceiveVideoQuality = remoteMedia?.preferredReceiveVideoQuality ?? 'low';
    this.remoteAudioOnly = remoteMedia?.audioOnly ?? false;
    if (remoteMedia) this.onRemoteMedia(remoteMedia);
    this.ensurePeer();
  }

  setVideoTrack(track: MediaStreamTrack | undefined): void { this.videoTrack = track; }

  isVoiceStereo(): boolean {
    return this.voiceStereo;
  }

  async updateVoiceStereoFromInboundStats(): Promise<boolean> {
    const result = await this.queryInboundVoiceStereo();
    if (result === 'unknown') {
      return this.voiceStereo;
    }
    const isStereo = result === 'stereo';
    if (this.voiceStereo !== isStereo) {
      this.voiceStereo = isStereo;
      this.onVoiceStereoChange?.(this.voiceStereo);
    }
    return this.voiceStereo;
  }

  private async queryInboundVoiceStereo(): Promise<'mono' | 'stereo' | 'unknown'> {
    const voiceTransceiver = this.audioTransceivers.get('voice') ??
      (this.pc?.getTransceivers() ?? []).find((t) => this.audioPurpose.get(t)?.id === 'voice');

    const mid = voiceTransceiver?.mid;
    if (!voiceTransceiver || !mid || !this.pc) {
      return 'unknown';
    }

    try {
      const statsReport = await (voiceTransceiver.receiver?.getStats?.() ?? this.pc.getStats());
      if (!statsReport) return 'unknown';

      let inboundAudioStat: any = null;
      for (const stat of statsReport.values()) {
        if (stat.type === 'inbound-rtp' && (stat.kind === 'audio' || stat.mediaType === 'audio')) {
          if (stat.mid === mid || (voiceTransceiver.receiver.track && stat.trackIdentifier === voiceTransceiver.receiver.track.id)) {
            inboundAudioStat = stat;
            break;
          }
        }
      }

      if (!inboundAudioStat) {
        return 'unknown';
      }

      // Resolve the codecId from the active inbound RTP stream
      const codecId = inboundAudioStat.codecId;
      const codecStat = codecId ? statsReport.get(codecId) : null;

      if (codecStat && codecStat.type === 'codec') {
        const mimeType = (codecStat.mimeType || '').toLowerCase();
        if (mimeType.includes('opus')) {
          if (codecStat.sdpFmtpLine) {
            return parseSpropStereo(codecStat.sdpFmtpLine) ? 'stereo' : 'mono';
          }
          const payloadType = codecStat.payloadType ?? inboundAudioStat.payloadType;
          if (typeof payloadType === 'number') {
            const remoteSdp = this.pc.currentRemoteDescription?.sdp || this.pc.remoteDescription?.sdp;
            if (remoteSdp) {
              const mediaSection = extractMediaSectionByMid(remoteSdp, mid);
              if (mediaSection) {
                const lines = mediaSection.split(/\r?\n/);
                const fmtpLine = lines.find((l) => l.startsWith(`a=fmtp:${payloadType} `) || l.startsWith(`a=fmtp:${payloadType}:`));
                if (fmtpLine) {
                  const fmtpText = fmtpLine.slice(fmtpLine.indexOf(' ') + 1);
                  return parseSpropStereo(fmtpText) ? 'stereo' : 'mono';
                }
              }
            }
          }
          return 'mono';
        }
        return 'mono';
      } else if (typeof inboundAudioStat.payloadType === 'number') {
        const remoteSdp = this.pc.currentRemoteDescription?.sdp || this.pc.remoteDescription?.sdp;
        if (remoteSdp) {
          const mediaSection = extractMediaSectionByMid(remoteSdp, mid);
          if (mediaSection) {
            const lines = mediaSection.split(/\r?\n/);
            const isOpus = lines.some((l) => {
              const match = l.match(new RegExp(`^a=rtpmap:${inboundAudioStat.payloadType}\\s+opus/48000(?:/2)?$`, 'i'));
              return Boolean(match);
            });
            if (isOpus) {
              const fmtpLine = lines.find((l) => l.startsWith(`a=fmtp:${inboundAudioStat.payloadType} `) || l.startsWith(`a=fmtp:${inboundAudioStat.payloadType}:`));
              if (fmtpLine) {
                const fmtpText = fmtpLine.slice(fmtpLine.indexOf(' ') + 1);
                return parseSpropStereo(fmtpText) ? 'stereo' : 'mono';
              }
              return 'mono';
            }
          }
        }
      }
    } catch {
      return 'unknown';
    }

    return 'unknown';
  }

  private startInboundStatsPolling(): void {
    if (this.inboundStatsTimer) return;
    void this.updateVoiceStereoFromInboundStats();
    this.inboundStatsTimer = window.setInterval(() => {
      void this.updateVoiceStereoFromInboundStats();
    }, 1000);
  }

  private stopInboundStatsPolling(): void {
    if (this.inboundStatsTimer) {
      window.clearInterval(this.inboundStatsTimer);
      this.inboundStatsTimer = undefined;
    }
  }

  private sessionMode(): AudioMode { return this.localMode === 'music' || this.remoteMode === 'music' || Boolean(this.audio.music) || this.remoteHasMusic ? 'music' : 'talk'; }

  private ensurePeer(): RTCPeerConnection {
    if (this.pc && this.pc.signalingState !== 'closed') return this.pc;
    const policy = import.meta.env.VITE_ICE_TRANSPORT_POLICY === 'relay' ? 'relay' : 'all';
    const pc = new RTCPeerConnection({ iceServers: this.iceServers, iceTransportPolicy: policy });
    this.pc = pc;
    this.pendingCandidates = [];
    this.iceRestarted = false;
    this.createAudioTransceiver(pc, 'voice', 'voice');
    this.createAudioTransceiver(pc, 'music', 'music');
    this.createAudioTransceiver(pc, 'screen-audio', 'music');
    if (this.videoTrack) {
      this.videoSender = pc.addTrack(this.videoTrack, new MediaStream([this.videoTrack]));
      void this.updateVideoSenderParameters(this.videoTrack);
    }

    const capabilities = RTCRtpSender.getCapabilities?.('audio');
    if (capabilities) for (const audioTransceiver of this.audioTransceivers.values()) {
      const opus = capabilities.codecs.filter((codec) => codec.mimeType.toLowerCase() === 'audio/opus');
      const rest = capabilities.codecs.filter((codec) => codec.mimeType.toLowerCase() !== 'audio/opus');
      audioTransceiver.setCodecPreferences([...opus, ...rest]);
    }
    void this.updateAllAudioSenderParameters();

    pc.onicecandidate = (event) => this.signaling.sendCandidate(this.code, event.candidate?.toJSON() ?? null);
    pc.ontrack = (event) => {
      if (event.track.kind === 'audio') {
        const source = this.getAudioTransceiverPurpose(event.transceiver);
        this.onRemoteAudio(source.id, source.purpose, event.track);
        return;
      }
      for (const existing of this.remoteStream.getVideoTracks()) {
        existing.onended = null;
        this.remoteStream.removeTrack(existing);
      }
      this.remoteStream.addTrack(event.track);
      event.track.onended = () => {
        if (this.remoteStream.getVideoTracks().includes(event.track)) {
          this.remoteStream.removeTrack(event.track);
          this.onRemoteStream(this.remoteStream.getTracks().length ? this.remoteStream : undefined);
        }
      };
      this.onRemoteStream(this.remoteStream);
    };
    pc.onconnectionstatechange = () => this.handleConnectionState();
    pc.oniceconnectionstatechange = () => {
      logger.info('webrtc_ice_state_changed', `ICE connection state: ${pc.iceConnectionState}`, { iceConnectionState: pc.iceConnectionState }, { sessionCode: this.code });
    };
    return pc;
  }

  private getAudioTransceiverPurpose(transceiver: RTCRtpTransceiver): { id: string; purpose: 'voice' | 'music' } {
    const existing = this.audioPurpose.get(transceiver);
    if (existing) return existing;

    const audioTransceivers = (this.pc?.getTransceivers() ?? []).filter((t) => t.receiver.track.kind === 'audio');
    const idx = audioTransceivers.indexOf(transceiver);

    let info: { id: string; purpose: 'voice' | 'music' };
    if (idx === 0) {
      info = { id: 'voice', purpose: 'voice' };
    } else if (idx === 1) {
      info = { id: 'music', purpose: 'music' };
    } else if (idx === 2) {
      info = { id: 'screen-audio', purpose: 'music' };
    } else {
      const mid = transceiver.mid;
      if (mid === '0') info = { id: 'voice', purpose: 'voice' };
      else if (mid === '1') info = { id: 'music', purpose: 'music' };
      else if (mid === '2') info = { id: 'screen-audio', purpose: 'music' };
      else info = { id: 'music', purpose: 'music' };
    }

    this.audioPurpose.set(transceiver, info);
    return info;
  }

  async peerReady(media: MediaMetadata): Promise<void> {
    this.remoteMode = media.audioSources[0]?.mode ?? 'talk';
    this.remoteHasMusic = media.audioSources.some((source) => source.purpose === 'music');
    this.remoteReceiveVideoQuality = media.preferredReceiveVideoQuality ?? 'low';
    this.remoteAudioOnly = media.audioOnly ?? false;
    this.onRemoteMedia(media);
    this.remoteReceiveVideoQuality = media.preferredReceiveVideoQuality ?? 'low';
    this.ensurePeer();
    if (this.role === 'host') await this.negotiate();
  }

  private createAudioTransceiver(pc: RTCPeerConnection, id: string, purpose: 'voice' | 'music'): void {
    const track = this.audio.get(id)?.track;
    const transceiver = pc.addTransceiver(track ?? 'audio', {
      direction: track ? 'sendrecv' : 'recvonly',
      streams: track ? [new MediaStream([track])] : []
    });
    this.audioTransceivers.set(id, transceiver);
    this.audioPurpose.set(transceiver, { id, purpose });
    this.audio.attachSender(id, transceiver.sender);
  }

  async replaceVideoTrack(track: MediaStreamTrack): Promise<void> {
    this.videoTrack = track;
    const pc = this.ensurePeer();
    const sender = this.videoSender ?? pc.getSenders().find((value) => value.track?.kind === 'video');
    if (sender) await sender.replaceTrack(track);
    else this.videoSender = pc.addTrack(track, new MediaStream([track]));
    if (sender) this.videoSender = sender;
    await this.updateVideoSenderParameters(track);
    if (this.role === 'host') await this.negotiate();
    else this.signaling.requestRenegotiation(this.code);
  }

  async removeVideoTrack(): Promise<void> {
    this.videoTrack = undefined;
    await this.videoSender?.replaceTrack(null);
  }

  private async updateVideoSenderParameters(track: MediaStreamTrack): Promise<void> {
    const sender = this.pc?.getSenders().find((value) => value.track === track || value.track?.kind === 'video');
    if (!sender) return;
    const parameters = sender.getParameters();
    if (!parameters.encodings?.length) parameters.encodings = [{}];
    const quality = lowerQuality(this.localVideoQuality, this.remoteReceiveVideoQuality);
    const profile = VIDEO_QUALITY[quality] ?? VIDEO_QUALITY.high;
    const screen = track.contentHint === 'detail' || track.contentHint === 'text';
    const isAuto = this.localVideoQuality === 'auto';

    parameters.encodings[0]!.maxBitrate = screen 
      ? Math.min(1_500_000, profile.maxBitrate) 
      : isAuto 
        ? 4_000_000 
        : profile.maxBitrate;
    parameters.encodings[0]!.maxFramerate = screen ? Math.min(12, profile.frameRate) : profile.frameRate;
    parameters.encodings[0]!.scaleResolutionDownBy = screen
      ? Math.max(1, 1920 / profile.width)
      : isAuto 
        ? 1 
        : Math.max(1, (VIDEO_QUALITY[this.localVideoQuality]?.width ?? 1280) / profile.width);
    parameters.encodings[0]!.active = screen || !this.remoteAudioOnly;
    parameters.degradationPreference = screen ? 'maintain-resolution' : 'balanced';
    try { await sender.setParameters(parameters); } catch { /* Applied after negotiation if Chromium defers it. */ }
  }

  async audioChanged(mode: AudioMode): Promise<void> {
    this.localMode = mode;
    await this.updateAudioSenderParameters('voice', opusBitrate(this.localMode));
    if (this.role === 'host') await this.negotiate();
    else this.signaling.requestRenegotiation(this.code);
  }

  async audioSourceChanged(id: 'music' | 'screen-audio'): Promise<void> {
    const transceiver = this.audioTransceivers.get(id);
    if (!transceiver) return;
    const track = this.audio.get(id)?.track ?? null;
    await transceiver.sender.replaceTrack(track);
    transceiver.direction = track ? 'sendrecv' : 'recvonly';
    await this.updateAudioSenderParameters(id, this.musicBitrate);
    if (this.role === 'host') await this.negotiate();
    else this.signaling.requestRenegotiation(this.code);
  }

  async musicQualityChanged(bitrate: number): Promise<void> {
    this.musicBitrate = bitrate;
    await Promise.all(['music', 'screen-audio'].map((id) => this.updateAudioSenderParameters(id, bitrate)));
  }

  async videoQualityChanged(quality: VideoQuality): Promise<void> {
    this.localVideoQuality = quality;
    if (this.videoTrack) await this.updateVideoSenderParameters(this.videoTrack);
  }

  private async updateAudioSenderParameters(id: string, bitrate: number): Promise<void> {
    const sender = this.audioTransceivers.get(id)?.sender;
    if (!sender) return;
    const parameters = sender.getParameters();
    if (!parameters.encodings?.length) parameters.encodings = [{}];
    parameters.encodings[0]!.maxBitrate = bitrate;
    try { await sender.setParameters(parameters); } catch { /* Chromium may reject until negotiation begins. */ }
  }

  private async updateAllAudioSenderParameters(): Promise<void> {
    await this.updateAudioSenderParameters('voice', opusBitrate(this.localMode));
    await this.updateAudioSenderParameters('music', this.musicBitrate);
    await this.updateAudioSenderParameters('screen-audio', this.musicBitrate);
  }

  private isNegotiating = false;
  private queuedNegotiation = false;

  private async negotiate(iceRestart = false): Promise<void> {
    const pc = this.ensurePeer();
    if (this.role !== 'host') return;
    if (pc.signalingState !== 'stable' || this.isNegotiating) {
      this.queuedNegotiation = true;
      return;
    }
    this.isNegotiating = true;
    try {
      const offer = await pc.createOffer({ iceRestart });
      const description = { type: 'offer' as const, sdp: applyOpusPolicy(offer.sdp ?? '', this.sessionMode(), this.musicBitrate) };
      await pc.setLocalDescription(description);
      this.signaling.sendDescription(this.code, description);
    } catch (err) {
      logger.warn('webrtc_negotiation_failure', 'WebRTC negotiation failed', { code: this.code, role: this.role }, err, { sessionCode: this.code });
      console.warn('Negotiation error:', err);
    } finally {
      this.isNegotiating = false;
    }
  }

  private async receiveDescription(description: RTCSessionDescriptionInit): Promise<void> {
    const pc = this.ensurePeer();
    await pc.setRemoteDescription(description);
    for (const candidate of this.pendingCandidates.splice(0)) await pc.addIceCandidate(candidate);
    if (description.type === 'offer') {
      const answer = await pc.createAnswer();
      const local = { type: 'answer' as const, sdp: applyOpusPolicy(answer.sdp ?? '', this.sessionMode(), this.musicBitrate) };
      await pc.setLocalDescription(local);
      this.signaling.sendDescription(this.code, local);
      await this.updateAllAudioSenderParameters();
    } else if (description.type === 'answer') {
      await this.updateAllAudioSenderParameters();
      if (this.queuedNegotiation) {
        this.queuedNegotiation = false;
        void this.negotiate();
      }
    }
  }

  private async receiveCandidate(candidate: RTCIceCandidateInit | null): Promise<void> {
    if (!candidate) return;
    const pc = this.ensurePeer();
    if (!pc.remoteDescription) this.pendingCandidates.push(candidate);
    else await pc.addIceCandidate(candidate);
  }

  private handleConnectionState(): void {
    const state = this.pc?.connectionState;
    if (!state) return;
    logger.info('webrtc_connection_state_changed', `WebRTC connection state: ${state}`, { connectionState: state }, { sessionCode: this.code });
    if (state === 'connected') {
      if (this.disconnectTimer) window.clearTimeout(this.disconnectTimer);
      this.iceRestarted = false;
      this.onStatus('Connected');
      this.startInboundStatsPolling();
    } else if (state === 'connecting' || state === 'new') {
      this.onStatus('Connecting…');
    } else if (state === 'disconnected' || state === 'failed') {
      this.stopInboundStatsPolling();
      this.onStatus('Reconnecting…');
      if (!this.disconnectTimer) this.disconnectTimer = window.setTimeout(() => void this.tryIceRestart(), 4_000);
    } else if (state === 'closed') {
      this.stopInboundStatsPolling();
      this.onStatus('Session ended');
    }
  }

  private async tryIceRestart(): Promise<void> {
    this.disconnectTimer = undefined;
    logger.info('webrtc_ice_restart_attempt', 'Attempting WebRTC ICE restart reconnect', { code: this.code, alreadyRestarted: this.iceRestarted }, { sessionCode: this.code });
    if (this.iceRestarted) { this.onStatus('Connection failed — check your network'); return; }
    this.iceRestarted = true;
    if (this.role === 'host') await this.negotiate(true);
    else this.signaling.requestRenegotiation(this.code);
  }

  resetPeer(): void {
    if (this.disconnectTimer) window.clearTimeout(this.disconnectTimer);
    this.disconnectTimer = undefined;
    this.stopInboundStatsPolling();
    const hadStereo = this.voiceStereo;
    this.voiceStereo = false;
    if (hadStereo) {
      this.onVoiceStereoChange?.(false);
    }
    for (const track of this.remoteStream.getTracks()) {
      track.onended = null;
    }
    this.pc?.close();
    this.pc = undefined;
    for (const id of this.audioTransceivers.keys()) this.audio.attachSender(id, undefined);
    this.audioTransceivers.clear();
    this.audioPurpose.clear();
    this.videoSender = undefined;
    this.pendingCandidates = [];
    this.remoteStream = new MediaStream();
    this.onRemoteStream(undefined);
  }

  private prevStatsTimestamp = 0;
  private prevAudioBytesSent = 0;
  private prevAudioBytesRecv = 0;
  private prevVideoBytesSent = 0;
  private prevVideoBytesRecv = 0;

  async getStatsReport(): Promise<{
    connectionState: string;
    iceState: string;
    candidateType: string;
    protocol: string;
    rttMs: number | null;
    audioJitterMs: number | null;
    packetLossPercent: number;
    audioOutKbps: number;
    audioInKbps: number;
    videoOutKbps: number;
    videoInKbps: number;
    videoFpsIn: number | null;
    videoFpsOut: number | null;
    videoResolutionIn: string | null;
    videoResolutionOut: string | null;
    audioCodec: string;
    videoCodec: string;
  } | null> {
    if (!this.pc) return null;
    const now = Date.now();
    const dt = this.prevStatsTimestamp ? (now - this.prevStatsTimestamp) / 1000 : 0;
    
    let curAudioBytesSent = 0;
    let curAudioBytesRecv = 0;
    let curVideoBytesSent = 0;
    let curVideoBytesRecv = 0;

    let rttMs: number | null = null;
    let audioJitterMs: number | null = null;
    let packetsLost = 0;
    let packetsReceived = 0;
    let videoFpsIn: number | null = null;
    let videoFpsOut: number | null = null;
    let videoResolutionIn: string | null = null;
    let videoResolutionOut: string | null = null;
    let candidateType = 'P2P Direct (Host)';
    let protocol = 'UDP';
    let audioCodec = 'Opus (48 kHz Stereo)';
    let videoCodec = 'VP8 / WebRTC';

    try {
      const stats = await this.pc.getStats();
      const codecMap = new Map<string, string>();
      const candidateMap = new Map<string, { candidateType?: string; protocol?: string }>();

      stats.forEach((report) => {
        if (report.type === 'codec' && report.mimeType) {
          codecMap.set(report.id, report.mimeType);
        }
        if (report.type === 'local-candidate' || report.type === 'remote-candidate') {
          candidateMap.set(report.id, { candidateType: report.candidateType, protocol: report.protocol });
        }
      });

      stats.forEach((report) => {
        if (report.type === 'candidate-pair' && (report.state === 'succeeded' || report.nominated || report.selected)) {
          if (typeof report.currentRoundTripTime === 'number') {
            rttMs = Math.round(report.currentRoundTripTime * 1000);
          } else if (typeof report.totalRoundTripTime === 'number' && report.responsesReceived > 0) {
            rttMs = Math.round((report.totalRoundTripTime / report.responsesReceived) * 1000);
          }
          if (report.localCandidateId) {
            const cand = candidateMap.get(report.localCandidateId);
            if (cand?.candidateType) {
              candidateType = cand.candidateType === 'host' ? 'Direct P2P (Local / LAN)' : cand.candidateType === 'srflx' ? 'Direct P2P (STUN Reflexive)' : cand.candidateType === 'relay' ? 'TURN Relay' : cand.candidateType;
            }
            if (cand?.protocol) protocol = cand.protocol.toUpperCase();
          }
        }

        if (report.type === 'outbound-rtp') {
          if (report.kind === 'audio' || report.mediaType === 'audio') {
            if (typeof report.bytesSent === 'number') curAudioBytesSent += report.bytesSent;
            if (report.codecId && codecMap.has(report.codecId)) audioCodec = codecMap.get(report.codecId)!.replace(/^audio\//i, '');
          }
          if (report.kind === 'video' || report.mediaType === 'video') {
            if (typeof report.bytesSent === 'number') curVideoBytesSent += report.bytesSent;
            if (typeof report.framesPerSecond === 'number') videoFpsOut = Math.round(report.framesPerSecond);
            if (report.frameWidth && report.frameHeight) videoResolutionOut = `${report.frameWidth}×${report.frameHeight}`;
            if (report.codecId && codecMap.has(report.codecId)) videoCodec = codecMap.get(report.codecId)!.replace(/^video\//i, '');
          }
        }

        if (report.type === 'inbound-rtp') {
          if (report.kind === 'audio' || report.mediaType === 'audio') {
            if (typeof report.bytesReceived === 'number') curAudioBytesRecv += report.bytesReceived;
            if (typeof report.jitter === 'number') audioJitterMs = Math.round(report.jitter * 1000);
            if (typeof report.packetsLost === 'number') packetsLost += report.packetsLost;
            if (typeof report.packetsReceived === 'number') packetsReceived += report.packetsReceived;
            if (report.codecId && codecMap.has(report.codecId)) audioCodec = codecMap.get(report.codecId)!.replace(/^audio\//i, '');
          }
          if (report.kind === 'video' || report.mediaType === 'video') {
            if (typeof report.bytesReceived === 'number') curVideoBytesRecv += report.bytesReceived;
            if (typeof report.framesPerSecond === 'number') videoFpsIn = Math.round(report.framesPerSecond);
            if (report.frameWidth && report.frameHeight) videoResolutionIn = `${report.frameWidth}×${report.frameHeight}`;
            if (report.codecId && codecMap.has(report.codecId)) videoCodec = codecMap.get(report.codecId)!.replace(/^video\//i, '');
          }
        }
      });
    } catch {
      // Return baseline metrics if getStats fails
    }

    let audioOutKbps = 0;
    let audioInKbps = 0;
    let videoOutKbps = 0;
    let videoInKbps = 0;

    if (dt > 0 && this.prevStatsTimestamp > 0) {
      if (curAudioBytesSent >= this.prevAudioBytesSent) audioOutKbps = Math.round(((curAudioBytesSent - this.prevAudioBytesSent) * 8) / (dt * 1000));
      if (curAudioBytesRecv >= this.prevAudioBytesRecv) audioInKbps = Math.round(((curAudioBytesRecv - this.prevAudioBytesRecv) * 8) / (dt * 1000));
      if (curVideoBytesSent >= this.prevVideoBytesSent) videoOutKbps = Math.round(((curVideoBytesSent - this.prevVideoBytesSent) * 8) / (dt * 1000));
      if (curVideoBytesRecv >= this.prevVideoBytesRecv) videoInKbps = Math.round(((curVideoBytesRecv - this.prevVideoBytesRecv) * 8) / (dt * 1000));
    }

    this.prevStatsTimestamp = now;
    this.prevAudioBytesSent = curAudioBytesSent;
    this.prevAudioBytesRecv = curAudioBytesRecv;
    this.prevVideoBytesSent = curVideoBytesSent;
    this.prevVideoBytesRecv = curVideoBytesRecv;

    const totalPackets = packetsLost + packetsReceived;
    const packetLossPercent = totalPackets > 0 ? Number(((packetsLost / totalPackets) * 100).toFixed(1)) : 0;

    return {
      connectionState: this.pc.connectionState || 'connected',
      iceState: this.pc.iceConnectionState || 'connected',
      candidateType,
      protocol,
      rttMs,
      audioJitterMs,
      packetLossPercent,
      audioOutKbps,
      audioInKbps,
      videoOutKbps,
      videoInKbps,
      videoFpsIn,
      videoFpsOut,
      videoResolutionIn,
      videoResolutionOut,
      audioCodec,
      videoCodec
    };
  }

  dispose(): void {
    this.resetPeer();
    this.code = '';
    this.prevStatsTimestamp = 0;
    this.prevAudioBytesSent = 0;
    this.prevAudioBytesRecv = 0;
    this.prevVideoBytesSent = 0;
    this.prevVideoBytesRecv = 0;
  }
}
