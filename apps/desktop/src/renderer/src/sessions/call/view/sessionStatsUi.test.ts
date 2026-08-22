import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { initSessionStats, refreshStatsModal, stopStatsTimer } from './sessionStatsUi';

describe('Session Stats & Connection Telemetry UI', () => {
  const elements = new Map<string, { id: string; textContent: string; open?: boolean }>();

  beforeEach(() => {
    elements.clear();

    const ids = [
      'call-stats-btn',
      'btn-settings-open-stats',
      'stats-dialog',
      'stat-conn-state',
      'stat-ice-state',
      'stat-rtt',
      'stat-loss',
      'stat-audio-bitrate',
      'stat-jitter',
      'stat-video-out',
      'stat-video-in',
      'stat-sample-rate',
      'stat-audio-profile',
      'stat-audio-codec',
      'stat-video-bitrate',
      'stat-video-codec',
      'stat-active-mics'
    ];

    ids.forEach((id) => {
      elements.set(id, {
        id,
        textContent: '',
        open: id === 'stats-dialog'
      });
    });

    (globalThis as any).document = {
      getElementById: (id: string) => {
        const el = elements.get(id);
        if (!el) return null;
        return {
          ...el,
          set textContent(val: string) {
            el.textContent = val;
          },
          get textContent() {
            return el.textContent;
          },
          addEventListener: () => {},
          showModal: () => { el.open = true; },
          close: () => { el.open = false; }
        };
      }
    };
  });

  afterEach(() => {
    stopStatsTimer();
    elements.clear();
    delete (globalThis as any).document;
  });

  it('renders standby / connecting placeholders when no active WebRTC stats report is available', async () => {
    initSessionStats({
      getStatsReport: async () => null,
      isInCall: () => true,
      getPreferences: () => ({ mode: 'talk', sampleRate: 48000 }),
      getEffectiveSampleRate: () => 48000,
      getVideoState: () => ({})
    });

    await refreshStatsModal();

    expect(elements.get('stat-conn-state')?.textContent).toBe('Connecting P2P…');
    expect(elements.get('stat-ice-state')?.textContent).toBe('Negotiating ICE…');
    expect(elements.get('stat-rtt')?.textContent).toBe('—');
    expect(elements.get('stat-loss')?.textContent).toBe('—');
    expect(elements.get('stat-audio-bitrate')?.textContent).toBe('—');
    expect(elements.get('stat-video-out')?.textContent).toBe('—');
    expect(elements.get('stat-video-in')?.textContent).toBe('—');
  });

  it('renders full live WebRTC telemetry report including TURN Relay, protocol, RTT, and bitrates', async () => {
    const mockReport = {
      connectionState: 'connected',
      iceState: 'connected',
      candidateType: 'TURN Relay',
      protocol: 'UDP',
      rttMs: 28,
      audioJitterMs: 2,
      packetLossPercent: 0.1,
      audioOutKbps: 256,
      audioInKbps: 256,
      videoOutKbps: 1200,
      videoInKbps: 1500,
      videoFpsIn: 30,
      videoFpsOut: 30,
      videoResolutionIn: '1280×720',
      videoResolutionOut: '1280×720',
      audioCodec: 'opus',
      videoCodec: 'VP8'
    };

    initSessionStats({
      getStatsReport: async () => mockReport,
      isInCall: () => true,
      getPreferences: () => ({
        mode: 'music',
        sampleRate: 48000,
        voiceInputs: [{ enabled: true }, { enabled: false }]
      }),
      getEffectiveSampleRate: () => 48000,
      getVideoState: () => ({})
    });

    await refreshStatsModal();

    expect(elements.get('stat-conn-state')?.textContent).toBe('Connected');
    expect(elements.get('stat-ice-state')?.textContent).toBe('TURN Relay (UDP)');
    expect(elements.get('stat-rtt')?.textContent).toBe('28 ms');
    expect(elements.get('stat-jitter')?.textContent).toBe('2 ms');
    expect(elements.get('stat-loss')?.textContent).toBe('0.1%');
    expect(elements.get('stat-audio-profile')?.textContent).toBe('Music Mode (Unprocessed Stereo 48 kHz)');
    expect(elements.get('stat-audio-bitrate')?.textContent).toBe('Tx: 256 kbps · Rx: 256 kbps');
    expect(elements.get('stat-audio-codec')?.textContent).toBe('opus');
    expect(elements.get('stat-sample-rate')?.textContent).toBe('48,000 Hz (CoreAudio Engine)');
    expect(elements.get('stat-active-mics')?.textContent).toBe('1 Active Input');
    expect(elements.get('stat-video-out')?.textContent).toBe('1280×720 @ 30 FPS');
    expect(elements.get('stat-video-in')?.textContent).toBe('1280×720 @ 30 FPS');
    expect(elements.get('stat-video-bitrate')?.textContent).toBe('Tx: 1200 kbps · Rx: 1500 kbps');
    expect(elements.get('stat-video-codec')?.textContent).toBe('VP8');
  });

  it('renders TCP TURN relay candidate type accurately', async () => {
    const mockReport = {
      connectionState: 'connected',
      iceState: 'connected',
      candidateType: 'TURN Relay',
      protocol: 'TCP',
      rttMs: 45,
      audioJitterMs: 4,
      packetLossPercent: 0.0,
      audioOutKbps: 64,
      audioInKbps: 64,
      videoOutKbps: 0,
      videoInKbps: 0,
      videoFpsIn: null,
      videoFpsOut: null,
      videoResolutionIn: null,
      videoResolutionOut: null,
      audioCodec: 'opus',
      videoCodec: 'VP8'
    };

    initSessionStats({
      getStatsReport: async () => mockReport,
      isInCall: () => true,
      getPreferences: () => ({ mode: 'talk', sampleRate: 48000 }),
      getEffectiveSampleRate: () => 48000,
      getVideoState: () => ({})
    });

    await refreshStatsModal();

    expect(elements.get('stat-ice-state')?.textContent).toBe('TURN Relay (TCP)');
    expect(elements.get('stat-rtt')?.textContent).toBe('45 ms');
  });
});
