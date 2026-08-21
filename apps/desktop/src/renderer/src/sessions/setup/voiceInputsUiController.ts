import { $ } from '../../core/dom';
import { icons } from '../../core/icons';
import { LevelMeter, type LevelReading } from '../../media/audio/levelMeter';
import type { HardwareAudioDeviceInfo } from '../../media/devices/hardwareDeviceUtils';
import {
  findHardwareDevice,
  generateInputChannelOptions,
  formatDeviceDisplayName
} from '../../media/devices/hardwareDeviceUtils';
import type { Preferences } from '../../core/preferences';
import type { StudioMixerChannel } from '../../media/mixer/studioMixerLogic';
import type { LocalAudioSourceManager } from '../../media/audio/audioSources';

export interface VoiceInputsUiContext {
  getPreferences: () => Preferences;
  onSavePreferences: () => void;
  getVoiceMeters: () => Map<number, LevelMeter>;
  getActiveMicLevels: () => Map<number, number>;
  getActiveMicPeaks: () => Map<number, number>;
  isMuted: () => boolean;
  onSetLastLocalVoiceDb: (db: number) => void;
  onSetLastLocalMusicDb: (db: number) => void;
  onSetLastLocalMusicPeakDb: (db: number) => void;
  onCheckActiveSpeaker: () => void;
  getAudio: () => LocalAudioSourceManager;
  getCachedHardwareDevices: () => HardwareAudioDeviceInfo[];
  onSyncAllVoiceMics: () => Promise<void>;
  onEnumerateAndPopulate: () => Promise<void>;
  getStudioMixerChannels: () => StudioMixerChannel[];
  isStudioMixerOpen: () => boolean;
  onSaveStudioMixerConfig: (immediate?: boolean) => void;
  onRenderStudioMixer: () => void;
  onApplyMixerAudioRouting: () => void;
  isInCall: () => boolean;
  onSetMessage: (id: string, text: string, isError?: boolean) => void;
}

export function createVoiceInputsUiController(ctx: VoiceInputsUiContext) {
  function getOrCreateVoiceMeter(id: number): LevelMeter {
    const voiceMeters = ctx.getVoiceMeters();
    let m = voiceMeters.get(id);
    if (!m) {
      m = new LevelMeter();
      voiceMeters.set(id, m);
    }
    return m;
  }

  function updateVoiceInIndicator(): void {
    let anyActive = false;
    for (const db of ctx.getActiveMicLevels().values()) {
      if (db > -48) {
        anyActive = true;
        break;
      }
    }
    $('voice-in-indicator')?.classList.toggle('active', !ctx.isMuted() && anyActive);
  }

  function renderVoiceLevel(micId: number, reading: LevelReading): void {
    const numId = Number(micId);
    const width = `${Math.max(0, Math.min(100, ((reading.rmsDb + 60) / 60) * 100))}%`;
    for (const prefix of ['setup-meter', 'call-meter', 'topbar-meter', 'unit-meter']) {
      const bar = document.getElementById(`${prefix}-${numId}`);
      if (bar) {
        bar.style.width = width;
        bar.parentElement?.classList.toggle('clip', reading.clipping);
      }
    }
    for (const prefix of ['setup-db', 'call-db', 'topbar-db', 'unit-db']) {
      const el = document.getElementById(`${prefix}-${numId}`);
      if (el) el.textContent = `${Math.round(reading.rmsDb)} dB`;
    }
    ctx.getActiveMicLevels().set(numId, reading.rmsDb);
    ctx.getActiveMicPeaks().set(numId, reading.peakDb);

    let maxLocal = -60;
    for (const db of ctx.getActiveMicLevels().values()) {
      if (db > maxLocal) maxLocal = db;
    }
    ctx.onSetLastLocalVoiceDb(maxLocal);
    updateVoiceInIndicator();
    ctx.onCheckActiveSpeaker();
  }

  function renderMusicLevel(reading: LevelReading): void {
    ctx.onSetLastLocalMusicDb(reading.rmsDb);
    ctx.onSetLastLocalMusicPeakDb(reading.peakDb);
    const musicActive = Boolean(ctx.getAudio().music?.enabled) && reading.rmsDb > -48;
    $('music-in-indicator')?.classList.toggle('active', musicActive);
    const width = `${Math.max(0, Math.min(100, ((reading.rmsDb + 60) / 60) * 100))}%`;
    const bar = document.getElementById('topbar-music-meter');
    if (bar) {
      bar.style.width = width;
      bar.parentElement?.classList.toggle('clip', reading.clipping);
    }
    const dbEl = document.getElementById('topbar-music-db');
    if (dbEl) {
      dbEl.textContent = `${Math.round(reading.rmsDb)} dB`;
    }
  }

  function renderVoiceInputControls(audioInputs: MediaDeviceInfo[]): void {
    const prefs = ctx.getPreferences();
    const voiceMicsList = document.getElementById('voice-mics-list');
    const callVoiceMicsList = document.getElementById('call-voice-mics-list');
    const setupMetersList = document.getElementById('setup-meters-list');
    const inCallMetersList = document.getElementById('in-call-meters-list');
    const topbarMicsBar = document.getElementById('call-topbar-mics-bar');

    if (voiceMicsList) voiceMicsList.replaceChildren();
    if (callVoiceMicsList) callVoiceMicsList.replaceChildren();
    if (setupMetersList) setupMetersList.replaceChildren();
    if (inCallMetersList) inCallMetersList.replaceChildren();
    if (topbarMicsBar) topbarMicsBar.replaceChildren();

    const countBadge = document.getElementById('voice-count-badge');
    const callCountBadge = document.getElementById('call-voice-count-badge');
    const activeCount = prefs.voiceInputs.filter((v) => v.enabled).length;
    const countText = `${activeCount} Active ${activeCount === 1 ? 'Mic' : 'Mics'}`;
    if (countBadge) countBadge.textContent = countText;
    if (callCountBadge) callCountBadge.textContent = countText;

    const cachedHardwareDevices = ctx.getCachedHardwareDevices();

    prefs.voiceInputs.forEach((mic) => {
      const isPrimary = mic.id === 1;
      const badgeClass = isPrimary ? '' : mic.id === 2 ? 'secondary' : mic.id === 3 ? 'guest' : 'room';
      const shortTitle = isPrimary ? 'Microphone 1 (Lead)' : mic.id === 2 ? 'Microphone 2 (Singer / Co-Host)' : mic.id === 3 ? 'Microphone 3 (Guest)' : `Microphone ${mic.id} (Room)`;

      const hw = findHardwareDevice(mic.deviceId, audioInputs, cachedHardwareDevices);
      const channels = hw?.inputChannels ?? 2;
      const channelOptions = generateInputChannelOptions(channels, hw?.inputChannelNames);

      // 1. Setup & In-call Dialog Unit Cards
      for (const container of [voiceMicsList, callVoiceMicsList]) {
        if (!container) continue;
        const isCall = container === callVoiceMicsList;
        const card = document.createElement('div');
        card.className = `mic-unit ${isPrimary ? 'primary-mic-unit' : 'secondary-mic-unit'}`;

        const header = document.createElement('div');
        header.className = 'mic-unit-header';
        header.innerHTML = `
          <div class="mic-unit-title-wrap">
            <span class="mic-pill-badge ${badgeClass}">${icons.mic({ size: 13 })} Mic ${mic.id}</span>
            <span class="mic-unit-title">${shortTitle}</span>
          </div>
          ${!isPrimary ? `
            <button type="button" class="btn-remove-mic" data-mic-id="${mic.id}" title="Remove Microphone ${mic.id}">
              <span class="btn-remove-icon">${icons.x({ size: 13 })}</span>
            </button>
          ` : ''}
        `;
        card.appendChild(header);

        const body = document.createElement('div');
        body.className = 'field-wrap';

        // Device Select
        const devSelect = document.createElement('select');
        devSelect.className = 'custom-select mb-2';
        devSelect.id = `${isCall ? 'call-' : ''}voice-dev-${mic.id}`;
        if (!audioInputs.length) devSelect.add(new Option('Default Audio Input', ''));
        audioInputs.forEach((d, i) => devSelect.add(new Option(formatDeviceDisplayName(d.label) || `Audio Input ${i + 1}`, d.deviceId)));
        if (mic.deviceId && audioInputs.some((d) => d.deviceId === mic.deviceId)) devSelect.value = mic.deviceId;
        else if (audioInputs.length) devSelect.value = audioInputs[0]!.deviceId;

        devSelect.addEventListener('change', async () => {
          mic.deviceId = devSelect.value || undefined;
          if (isPrimary) prefs.audioInputId = mic.deviceId;
          ctx.onSavePreferences();
          await ctx.onSyncAllVoiceMics();
          await ctx.onEnumerateAndPopulate();
        });
        body.appendChild(devSelect);

        // Channel Select
        const chRow = document.createElement('div');
        chRow.className = 'channel-picker-row mb-2';
        chRow.innerHTML = `<span class="sub-field-label">Interface Channel:</span>`;
        const chSelect = document.createElement('select');
        chSelect.className = 'custom-select mini-channel-select';
        chSelect.id = `${isCall ? 'call-' : ''}voice-ch-${mic.id}`;
        channelOptions.forEach((opt) => chSelect.add(new Option(opt.label, opt.value)));
        if (channelOptions.some((opt) => opt.value === mic.channelRoute)) chSelect.value = mic.channelRoute;
        else chSelect.value = '1';

        chSelect.addEventListener('change', async () => {
          mic.channelRoute = chSelect.value;
          if (isPrimary) prefs.voiceChannel = chSelect.value;
          ctx.onSavePreferences();
          await ctx.onSyncAllVoiceMics();
          await ctx.onEnumerateAndPopulate();
        });
        chRow.appendChild(chSelect);
        body.appendChild(chRow);

        // Gain Slider (Both Sound Check & Settings!)
        const gainRow = document.createElement('div');
        gainRow.className = 'mic-gain-row';
        gainRow.innerHTML = `
          <div class="label-with-val">
            <span class="sub-field-label">Mic ${mic.id} Level (Gain):</span>
            <output id="${isCall ? 'call-' : ''}gain-val-${mic.id}" class="badge-value">${Math.round((mic.gain ?? 1) * 100)}%</output>
          </div>
          <input id="${isCall ? 'call-' : ''}gain-${mic.id}" type="range" min="0" max="2" step="0.01" value="${mic.gain ?? 1}" class="custom-slider mini-slider" />
        `;
        const slider = gainRow.querySelector<HTMLInputElement>(`#${isCall ? 'call-' : ''}gain-${mic.id}`);
        const valLabel = gainRow.querySelector<HTMLElement>(`#${isCall ? 'call-' : ''}gain-val-${mic.id}`);
        slider?.addEventListener('input', (event) => {
          const val = Number((event.currentTarget as HTMLInputElement).value);
          mic.gain = val;
          if (isPrimary) prefs.inputGain = val;
          ctx.onSavePreferences();
          if (valLabel) valLabel.textContent = `${Math.round(val * 100)}%`;
          for (const otherPrefix of ['', 'call-']) {
            const otherSlider = document.querySelector<HTMLInputElement>(`#${otherPrefix}gain-${mic.id}`);
            const otherValLabel = document.querySelector<HTMLElement>(`#${otherPrefix}gain-val-${mic.id}`);
            if (otherSlider && otherSlider !== event.currentTarget) otherSlider.value = String(val);
            if (otherValLabel && otherValLabel !== valLabel) otherValLabel.textContent = `${Math.round(val * 100)}%`;
          }
          if (isPrimary) {
            for (const otherId of ['input-gain', 'call-input-gain']) {
              const el = document.querySelector<HTMLInputElement>(`#${otherId}`);
              if (el) el.value = String(val);
            }
            for (const labelId of ['gain-value', 'call-gain-value']) {
              const el = document.getElementById(labelId);
              if (el) el.textContent = `${Math.round(val * 100)}%`;
            }
          }
          // SYNC WITH STUDIO MIXER
          const studioMixerChannels = ctx.getStudioMixerChannels();
          const chId = mic.id === 1 ? 'you-mic' : `you-mic-${mic.id}`;
          const micCh = studioMixerChannels.find((c) => c.id === chId || (mic.id === 1 && c.id === 'you-mic'));
          if (micCh) {
            micCh.volume = val;
            ctx.onSaveStudioMixerConfig(false);
            if (ctx.isStudioMixerOpen()) {
              ctx.onRenderStudioMixer();
            }
          }

          ctx.onApplyMixerAudioRouting();

          const desktopApi = typeof window !== 'undefined' ? ((window as any).jameet || (window as any).musiczoom) : undefined;
          if (desktopApi?.setSystemInputVolume && isPrimary) {
            void desktopApi.setSystemInputVolume(Math.min(1.0, val));
          }
        });
        body.appendChild(gainRow);

        card.appendChild(body);
        container.appendChild(card);
      }

      // 2. Setup & In-Call Left Column Studio Meter Card
      for (const metersList of [setupMetersList, inCallMetersList]) {
        if (!metersList) continue;
        const prefix = metersList === inCallMetersList ? 'call-' : 'setup-';
        const studioCard = document.createElement('div');
        studioCard.className = `studio-meter-card ${isPrimary ? '' : 'secondary-meter-card'}`;
        studioCard.innerHTML = `
          <div class="meter-header">
            <div class="meter-title-wrap">
              <span class="meter-dot ${isPrimary ? '' : 'mic2-dot'}"></span>
              <span class="meter-title">VOICE INPUT ${mic.id}</span>
            </div>
            <output id="${prefix}db-${mic.id}" class="db-readout">−60 dB</output>
          </div>
          <div class="meter-scale">
            <span>-60</span>
            <span>-36</span>
            <span>-24</span>
            <span>-12</span>
            <span>-6</span>
            <span>0 dB</span>
          </div>
          <div class="meter">
            <div id="${prefix}meter-${mic.id}" class="meter-fill"></div>
            <i class="clip" title="Clipping (Peak over 0 dBFS)"></i>
          </div>
        `;
        metersList.appendChild(studioCard);
      }

      // 3. Topbar Mini Meter Pill
      if (topbarMicsBar) {
        const topbarPill = document.createElement('div');
        topbarPill.className = 'topbar-meter-unit';
        topbarPill.innerHTML = `
          ${activeCount > 1 ? `<span class="topbar-mic-tag">M${mic.id}</span>` : ''}
          <div class="topbar-meter-track">
            <div id="topbar-meter-${mic.id}" class="meter-fill"></div>
            <i class="clip"></i>
          </div>
          <output id="topbar-db-${mic.id}" class="topbar-db-num">−60 dB</output>
        `;
        topbarMicsBar.appendChild(topbarPill);
      }
    });

    // Attach remove buttons listeners
    document.querySelectorAll<HTMLButtonElement>('.btn-remove-mic').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const micId = Number(btn.getAttribute('data-mic-id'));
        if (!micId || micId === 1) return;
        prefs.voiceInputs = prefs.voiceInputs.filter((m) => m.id !== micId);
        ctx.onSavePreferences();
        const voiceMeters = ctx.getVoiceMeters();
        const m = voiceMeters.get(micId);
        if (m) await m.stop();
        voiceMeters.delete(micId);
        ctx.getActiveMicLevels().delete(micId);
        ctx.getActiveMicPeaks().delete(micId);
        await ctx.getAudio().removeVoiceMic(micId);
        await ctx.onSyncAllVoiceMics();
        await ctx.onEnumerateAndPopulate();
        ctx.onSetMessage(ctx.isInCall() ? 'device-dialog-status' : 'setup-status', `Microphone ${micId} removed.`);
      });
    });
  }

  return {
    getOrCreateVoiceMeter,
    updateVoiceInIndicator,
    renderVoiceLevel,
    renderMusicLevel,
    renderVoiceInputControls
  };
}
