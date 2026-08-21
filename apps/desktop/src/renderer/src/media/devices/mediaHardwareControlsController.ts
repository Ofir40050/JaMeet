import { $, setMessage } from '../../core/dom';
import type { Preferences } from '../../core/preferences';
import { deviceError } from './deviceError';
import type { StudioMixerChannel } from '../mixer/studioMixerLogic';

export interface MediaHardwareControlsContext {
  getPreferences: () => Preferences;
  onSavePreferences: () => void;
  isInCall: () => boolean;
  onReplaceAudioInput: (deviceId: string | undefined) => Promise<void>;
  onReplaceMusicInput: () => Promise<void>;
  onSetOutputDevice: (deviceId?: string) => Promise<void>;
  onApplyAdvancedAudioSettings: () => Promise<void>;
  getPrimaryAudioChannels: () => number;
  onMusicQualityChanged: (bitrate: number) => void;
  getEffectiveMusicBitrate: () => number;
  onEnumerateAndPopulate: () => void;
  getStudioMixerChannels: () => StudioMixerChannel[];
  isStudioMixerOpen: () => boolean;
  onSaveStudioMixerConfig: (immediate?: boolean) => void;
  onRenderStudioMixer: () => void;
  onApplyMixerAudioRouting: () => void;
}

export function initMediaHardwareControlsController(ctx: MediaHardwareControlsContext): void {
  for (const id of ['voice-channel-select', 'call-voice-channel-select']) {
    $<HTMLSelectElement>(id)?.addEventListener('change', async (event) => {
      const prefs = ctx.getPreferences();
      const val = (event.currentTarget as HTMLSelectElement).value;
      prefs.voiceChannel = val;
      ctx.onSavePreferences();
      for (const other of ['voice-channel-select', 'call-voice-channel-select']) {
        const el = $<HTMLSelectElement>(other);
        if (el && el !== event.currentTarget) el.value = val;
      }
      try {
        await ctx.onReplaceAudioInput(prefs.audioInputId);
        setMessage(ctx.isInCall() ? 'device-dialog-status' : 'setup-status', `Voice Input routed to: ${val}`);
      } catch (error) {
        setMessage(ctx.isInCall() ? 'device-dialog-status' : 'setup-status', deviceError(error), true);
      }
    });
  }

  for (const id of ['music-channel-select', 'call-music-channel-select']) {
    $<HTMLSelectElement>(id)?.addEventListener('change', async (event) => {
      const prefs = ctx.getPreferences();
      const val = (event.currentTarget as HTMLSelectElement).value;
      prefs.musicChannel = val;
      ctx.onSavePreferences();
      for (const other of ['music-channel-select', 'call-music-channel-select']) {
        const el = $<HTMLSelectElement>(other);
        if (el && el !== event.currentTarget) el.value = val;
      }
      try {
        await ctx.onReplaceMusicInput();
        setMessage(ctx.isInCall() ? 'device-dialog-status' : 'setup-status', `Hardware Output routed to: Output ${val}`);
      } catch (error) {
        setMessage(ctx.isInCall() ? 'device-dialog-status' : 'setup-status', deviceError(error), true);
      }
    });
  }

  for (const id of ['output-channel-select', 'call-output-channel-select']) {
    $<HTMLSelectElement>(id)?.addEventListener('change', async (event) => {
      const prefs = ctx.getPreferences();
      const val = (event.currentTarget as HTMLSelectElement).value;
      prefs.outputChannel = val;
      ctx.onSavePreferences();
      for (const other of ['output-channel-select', 'call-output-channel-select']) {
        const el = $<HTMLSelectElement>(other);
        if (el && el !== event.currentTarget) el.value = val;
      }
      try {
        await ctx.onSetOutputDevice(prefs.audioOutputId);
        setMessage(ctx.isInCall() ? 'device-dialog-status' : 'setup-status', `Output routed to: ${val}`);
      } catch (error) {
        setMessage(ctx.isInCall() ? 'device-dialog-status' : 'setup-status', deviceError(error), true);
      }
    });
  }

  $('call-output-volume')?.addEventListener('input', (event) => {
    const prefs = ctx.getPreferences();
    const val = Number((event.currentTarget as HTMLInputElement).value);
    prefs.outputVolume = val;
    ctx.onSavePreferences();
    const label = document.getElementById('call-output-volume-val');
    if (label) label.textContent = `${Math.round(val * 100)}%`;
    ctx.onApplyMixerAudioRouting();
  });

  for (const id of ['channel-mode-select', 'call-channel-mode-select']) {
    $<HTMLSelectElement>(id)?.addEventListener('change', async (event) => {
      const prefs = ctx.getPreferences();
      const isStereo = (event.currentTarget as HTMLSelectElement).value === 'stereo';
      prefs.stereoMusic = isStereo;
      ctx.onSavePreferences();
      try {
        await ctx.onApplyAdvancedAudioSettings();
        const actualChannels = ctx.getPrimaryAudioChannels();
        setMessage(ctx.isInCall() ? 'device-dialog-status' : 'setup-status', `Hardware Channels: ${actualChannels === 1 ? 'Mono' : 'Stereo'}`);
      } catch (error) {
        setMessage(ctx.isInCall() ? 'device-dialog-status' : 'setup-status', deviceError(error), true);
      }
    });
  }

  for (const id of ['sample-rate-select', 'call-sample-rate-select']) {
    $<HTMLSelectElement>(id)?.addEventListener('change', async (event) => {
      const prefs = ctx.getPreferences();
      const value = Number((event.currentTarget as HTMLSelectElement).value);
      prefs.sampleRate = value || undefined;
      ctx.onSavePreferences();
      try {
        const desktopApi = typeof window !== 'undefined' ? ((window as any).jameet || (window as any).musiczoom) : undefined;
        if (value > 0 && desktopApi?.setSystemSampleRate) {
          await desktopApi.setSystemSampleRate(value);
        }
        await ctx.onApplyAdvancedAudioSettings();
        const rateLabel = value ? `${value.toLocaleString()} Hz` : 'Device Default';
        setMessage(ctx.isInCall() ? 'device-dialog-status' : 'setup-status', `Hardware & System Rate set to ${rateLabel}`);
      } catch (error) {
        setMessage(ctx.isInCall() ? 'device-dialog-status' : 'setup-status', deviceError(error), true);
      }
    });
  }

  for (const id of ['music-quality-select', 'call-music-quality-select']) {
    $<HTMLSelectElement>(id)?.addEventListener('change', (event) => {
      const prefs = ctx.getPreferences();
      prefs.musicBitrate = Number((event.currentTarget as HTMLSelectElement).value);
      ctx.onSavePreferences();
      if (ctx.isInCall()) ctx.onMusicQualityChanged(ctx.getEffectiveMusicBitrate());
      ctx.onEnumerateAndPopulate();
    });
  }

  for (const id of ['input-gain', 'call-input-gain']) {
    $<HTMLInputElement>(id)?.addEventListener('input', (event) => {
      const prefs = ctx.getPreferences();
      const val = Number((event.currentTarget as HTMLInputElement).value);
      prefs.inputGain = val;
      if (prefs.voiceInputs && prefs.voiceInputs.length > 0 && prefs.voiceInputs[0]) {
        prefs.voiceInputs[0].gain = val;
      }
      for (const labelId of ['gain-value', 'call-gain-value']) {
        const el = document.getElementById(labelId);
        if (el) el.textContent = `${Math.round(val * 100)}%`;
      }
      for (const otherId of ['input-gain', 'call-input-gain']) {
        const el = $<HTMLInputElement>(otherId);
        if (el && el !== event.currentTarget) el.value = String(val);
      }
      for (const prefix of ['', 'call-']) {
        const slider = document.querySelector<HTMLInputElement>(`#${prefix}gain-1`);
        const valLabel = document.querySelector<HTMLElement>(`#${prefix}gain-val-1`);
        if (slider) slider.value = String(val);
        if (valLabel) valLabel.textContent = `${Math.round(val * 100)}%`;
      }
      ctx.onSavePreferences();

      // SYNC WITH STUDIO MIXER
      const studioMixerChannels = ctx.getStudioMixerChannels();
      const micCh = studioMixerChannels.find((c) => c.id === 'you-mic');
      if (micCh) {
        micCh.volume = val;
        ctx.onSaveStudioMixerConfig(false);
        if (ctx.isStudioMixerOpen()) {
          ctx.onRenderStudioMixer();
        }
      }
      ctx.onApplyMixerAudioRouting();

      const desktopApi = typeof window !== 'undefined' ? ((window as any).jameet || (window as any).musiczoom) : undefined;
      if (desktopApi?.setSystemInputVolume) {
        void desktopApi.setSystemInputVolume(Math.min(1.0, val));
      }
    });
  }
}
