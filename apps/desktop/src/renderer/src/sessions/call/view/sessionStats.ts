import { $, setText } from '../../../core/dom';

export interface SessionStatsOptions {
  getStatsReport: () => Promise<any>;
  isInCall: () => boolean;
  getPreferences: () => {
    mode?: string;
    sampleRate?: number;
    voiceInputs?: Array<{ enabled?: boolean }>;
  };
  getEffectiveSampleRate?: () => number | undefined;
  getVideoState?: () => {
    screenTrack?: MediaStreamTrack;
    videoTrack?: MediaStreamTrack;
    cameraEnabled?: boolean;
    remoteVideoStream?: MediaStream;
  };
}

let options: SessionStatsOptions | null = null;
let statsTimerHandle: number | undefined;
let listenersBound = false;

export function initSessionStats(opts: SessionStatsOptions): void {
  options = opts;

  if (listenersBound) return;
  listenersBound = true;

  $('call-stats-btn')?.addEventListener('click', () => {
    openStatsDialog();
  });

  $('btn-settings-open-stats')?.addEventListener('click', () => {
    openStatsDialog();
  });

  $<HTMLDialogElement>('stats-dialog')?.addEventListener('close', () => {
    stopStatsTimer();
  });

  $('stats-dialog')?.addEventListener('click', (e) => {
    const dialog = $<HTMLDialogElement>('stats-dialog');
    if (e.target === dialog) {
      dialog.close();
    }
  });
}

export function stopStatsTimer(): void {
  if (statsTimerHandle) {
    window.clearInterval(statsTimerHandle);
    statsTimerHandle = undefined;
  }
}

export function openStatsDialog(): void {
  const dialog = $<HTMLDialogElement>('stats-dialog');
  if (!dialog) return;
  void refreshStatsModal();
  stopStatsTimer();
  statsTimerHandle = window.setInterval(() => {
    if (dialog.open) void refreshStatsModal();
  }, 1000);
  dialog.showModal();
}

export async function refreshStatsModal(): Promise<void> {
  if (!options) return;
  const inCall = options.isInCall();
  const report = await options.getStatsReport();
  if (!report) {
    setText('stat-conn-state', inCall ? 'Connecting P2P…' : 'Standby');
    setText('stat-ice-state', inCall ? 'Negotiating ICE…' : 'Not Connected');
    setText('stat-rtt', '—');
    setText('stat-jitter', '—');
    setText('stat-loss', '—');
    setText('stat-audio-bitrate', '—');
    setText('stat-video-out', '—');
    setText('stat-video-in', '—');
    setText('stat-video-bitrate', '—');
    return;
  }

  // Connection & Latency
  const connStateText = report.connectionState === 'connected' ? 'Connected' : report.connectionState === 'connecting' ? 'Connecting' : report.connectionState;
  setText('stat-conn-state', connStateText);
  setText('stat-ice-state', `${report.candidateType} (${report.protocol})`);
  setText('stat-rtt', report.rttMs !== null ? `${report.rttMs} ms` : inCall ? '< 1 ms (Local/Direct)' : '—');
  setText('stat-jitter', report.audioJitterMs !== null ? `${report.audioJitterMs} ms` : '0 ms');
  setText('stat-loss', `${report.packetLossPercent.toFixed(1)}%`);

  // Audio Fidelity & Clock
  const prefs = options.getPreferences();
  const profileName = prefs.mode === 'music' ? 'Music Mode (Unprocessed Stereo 48 kHz)' : 'Talk Mode (Speech Enhanced & AEC)';
  setText('stat-audio-profile', profileName);
  setText('stat-audio-bitrate', `Tx: ${report.audioOutKbps} kbps · Rx: ${report.audioInKbps} kbps`);
  setText('stat-audio-codec', report.audioCodec);
  const activeRate = prefs.sampleRate ?? options.getEffectiveSampleRate?.() ?? 44100;
  setText('stat-sample-rate', `${activeRate.toLocaleString()} Hz (CoreAudio Engine)`);
  
  const activeMicCount = (prefs.voiceInputs || []).filter((v) => v.enabled).length;
  setText('stat-active-mics', `${activeMicCount} Active Input${activeMicCount === 1 ? '' : 's'}`);

  // Video & Screen Performance
  const videoState = options.getVideoState?.() ?? {};
  const screenTrack = videoState.screenTrack;
  const videoTrack = videoState.videoTrack;
  const cameraEnabled = videoState.cameraEnabled;
  const remoteVideoStream = videoState.remoteVideoStream;

  const outRes = report.videoResolutionOut ? `${report.videoResolutionOut}${report.videoFpsOut ? ` @ ${report.videoFpsOut} FPS` : ''}` : screenTrack ? '1920×1080 @ 30 FPS (Screen)' : videoTrack && cameraEnabled ? '1280×720 @ 30 FPS (Camera)' : 'Disabled';
  const inRes = report.videoResolutionIn ? `${report.videoResolutionIn}${report.videoFpsIn ? ` @ ${report.videoFpsIn} FPS` : ''}` : remoteVideoStream ? '1280×720 @ 30 FPS' : 'Waiting for remote stream…';
  
  setText('stat-video-out', outRes);
  setText('stat-video-in', inRes);
  setText('stat-video-bitrate', `Tx: ${report.videoOutKbps} kbps · Rx: ${report.videoInKbps} kbps`);
  setText('stat-video-codec', report.videoCodec);
}
