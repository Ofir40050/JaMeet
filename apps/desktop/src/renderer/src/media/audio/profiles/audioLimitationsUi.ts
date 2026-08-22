import type { Preferences } from '../../../core/preferences';
import { audioLimitations } from './audioProfiles';

export interface AudioLimitationsUiOptions {
  getPrimaryAudioSource: () => { mode: any; effective: { sampleRate?: number; channelCount?: number } } | undefined;
  getPreferences: () => Preferences;
  onSetMessage: (id: string, text: string, isError?: boolean) => void;
}

export function renderAudioLimitations(options: AudioLimitationsUiOptions): void {
  const source = options.getPrimaryAudioSource();
  if (!source) return;
  const prefs = options.getPreferences();
  const effectiveHz = prefs.sampleRate ?? source.effective.sampleRate ?? 44_100;
  const hzText = `${effectiveHz.toLocaleString()} Hz`;
  const isStereo = prefs.stereoMusic !== false;
  const channelText = isStereo ? 'Stereo' : 'Mono';

  for (const id of ['active-sample-rate', 'call-active-sample-rate', 'advanced-quick-spec']) {
    const el = document.getElementById(id);
    if (el) el.textContent = `${hzText} · ${channelText}`;
  }

  const summary = `Hardware Stream: ${hzText} · ${channelText}`;
  const limits = audioLimitations(source.mode, { ...source.effective, channelCount: isStereo ? 2 : 1, sampleRate: effectiveHz });
  const desktopApi = typeof window !== 'undefined' ? ((window as any).jameet || (window as any).musiczoom) : undefined;
  if (desktopApi?.platform === 'win32' && (prefs.musicSourceType === 'app' || prefs.musicSourceType === 'interface')) {
    limits.push('Direct DAW tap is macOS-optimized; on Windows, use physical audio input device or virtual cable.');
  }
  options.onSetMessage('audio-limitations', [summary, ...limits].join('  '), limits.length > 0);
  for (const id of ['input-gain', 'call-input-gain']) {
    const control = document.getElementById(id) as HTMLInputElement | null;
    if (control) {
      control.disabled = false;
      control.title = 'Hardware & stream input gain';
    }
  }
}
