import { $ } from '../core/dom';
import type { VoiceInputConfig } from '../core/preferences';
import {
  channelEqDspRegistry,
  openChannelEqPlugin,
  removeChannelEqConfig
} from './channelEq';
import {
  dbToFaderTopPercent,
  dbToGain,
  faderTopPercentToDb,
  formatDbText,
  getPanBackground,
  panToReadout
} from './studioMixerFaderMath';
import type { StudioMixerChannel } from './studioMixerLogic';
import { saveStudioMixerConfig } from './studioMixerStorage';

export const STUDIO_ICONS: Record<string, { label: string; svg: string }> = {
  mic: {
    label: 'Studio Condenser Mic',
    svg: `<svg viewBox="0 0 24 36" width="20" height="32" fill="none">
      <path d="M7 14V8a5 5 0 0 1 10 0v6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
      <line x1="7" y1="14" x2="17" y2="14" stroke="currentColor" stroke-width="2.2"/>
      <path d="M7 14h10v12a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2V14Z" fill="currentColor"/>
      <path d="M10 28h4v3a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-3Z" fill="currentColor"/>
    </svg>`
  },
  guitar: {
    label: 'Acoustic / Electric Guitar',
    svg: `<svg viewBox="0 0 36 36" width="30" height="30" fill="currentColor">
      <rect x="24" y="3" width="2.5" height="3.5" rx="0.8"/>
      <path d="M24.5 6.5l-8 8 1.8 1.8 8-8z"/>
      <path d="M16 15.5c-1-.5-2.2-.4-3.2.3-1.8 1.2-2.8 1.4-4.2.8-1.5-.7-3.2 0-3.9 1.5-.8 1.7-.3 3.6 1.2 4.6l.8.5c-.8 1.5-.5 3.4.8 4.6 1.4 1.3 3.5 1.5 5 .5l.5-.3c1.1 1.4 3 1.8 4.6 1 1.6-.8 2.3-2.6 1.5-4.2-.5-1.3-.2-2.3.8-3.9.7-.9.9-2.2.3-3.2l-4.2-2.2Z"/>
      <circle cx="12" cy="21.5" r="1.6" fill="#464649"/>
    </svg>`
  },
  waves: {
    label: 'Waveform Track',
    svg: `<svg viewBox="0 0 32 32" width="28" height="28" fill="currentColor">
      <rect x="3" y="10" width="3.6" height="12" rx="1.8"/>
      <rect x="9" y="6" width="3.6" height="20" rx="1.8"/>
      <rect x="15" y="2" width="3.6" height="28" rx="1.8"/>
      <rect x="21" y="6" width="3.6" height="20" rx="1.8"/>
      <rect x="27" y="10" width="3.6" height="12" rx="1.8"/>
    </svg>`
  },
  fader: {
    label: 'Track Channel Fader',
    svg: `<svg viewBox="0 0 32 32" width="28" height="28">
      <circle cx="16" cy="16" r="14" fill="currentColor"/>
      <line x1="16" x2="16" y1="7" y2="25" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/>
      <rect x="11.5" y="12" width="9" height="7" rx="1.8" fill="#ffffff"/>
      <line x1="12" x2="20" y1="15.5" x2="20" stroke="currentColor" stroke-width="1.5"/>
    </svg>`
  },
  headphones: {
    label: 'Headphones / Monitor',
    svg: `<svg viewBox="0 0 30 30" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 17v-4a11 11 0 0 1 22 0v4"/>
      <rect x="2" y="15" width="5.5" height="10" rx="2.5" fill="currentColor"/>
      <rect x="22.5" y="15" width="5.5" height="10" rx="2.5" fill="currentColor"/>
    </svg>`
  },
  speaker: {
    label: 'Speaker / Monitor Out',
    svg: `<svg viewBox="0 0 30 30" width="28" height="28" fill="currentColor">
      <path d="M13 5L6.5 10H2v10h4.5L13 25V5z"/>
      <path d="M18 10a7 7 0 0 1 0 10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
      <path d="M22 6a12.5 12.5 0 0 1 0 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
    </svg>`
  },
  piano: {
    label: 'Piano / Keys',
    svg: `<svg viewBox="0 0 30 26" width="30" height="26" fill="currentColor">
      <rect x="2" y="3" width="26" height="20" rx="3" fill="none" stroke="currentColor" stroke-width="2"/>
      <path d="M2 13h26" stroke="currentColor" stroke-width="1.8"/>
      <rect x="6.5" y="4" width="3.2" height="8" rx="0.8" fill="currentColor"/>
      <rect x="11.5" y="4" width="3.2" height="8" rx="0.8" fill="currentColor"/>
      <rect x="18.5" y="4" width="3.2" height="8" rx="0.8" fill="currentColor"/>
      <rect x="23.5" y="4" width="3.2" height="8" rx="0.8" fill="currentColor"/>
    </svg>`
  },
  drums: {
    label: 'Drums / Beat',
    svg: `<svg viewBox="0 0 30 30" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <ellipse cx="15" cy="9" rx="11" ry="5" fill="currentColor" fill-opacity="0.25"/>
      <path d="M4 9v11c0 2.8 5 5 11 5s11-2.2 11-5V9"/>
      <line x1="8" y1="12" x2="8" y2="23"/>
      <line x1="15" y1="14" x2="15" y2="25"/>
      <line x1="22" y1="12" x2="22" y2="23"/>
    </svg>`
  },
  synth: {
    label: 'Synth / Hardware',
    svg: `<svg viewBox="0 0 30 30" width="28" height="28" fill="currentColor">
      <rect x="3" y="4" width="24" height="22" rx="3" fill="none" stroke="currentColor" stroke-width="2"/>
      <line x1="8" y1="8" x2="8" y2="22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <line x1="15" y1="8" x2="15" y2="22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <line x1="22" y1="8" x2="22" y2="22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <rect x="5.5" y="11" width="5" height="3" rx="1.2" fill="currentColor"/>
      <rect x="12.5" y="16" width="5" height="3" rx="1.2" fill="currentColor"/>
      <rect x="19.5" y="9" width="5" height="3" rx="1.2" fill="currentColor"/>
    </svg>`
  },
  screen: {
    label: 'Screen / App Capture',
    svg: `<svg viewBox="0 0 30 30" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="4" width="24" height="17" rx="3" fill="currentColor" fill-opacity="0.25"/>
      <line x1="10" y1="26" x2="20" y2="26"/>
      <line x1="15" y1="21" x2="15" y2="26"/>
    </svg>`
  },
  crown: {
    label: 'Master / Bus',
    svg: `<svg viewBox="0 0 30 30" width="28" height="28" fill="currentColor">
      <path d="M3 7l5 13h14l5-13-7 5.5-5-8.5-5 8.5L3 7z"/>
      <rect x="5" y="22" width="20" height="3" rx="1.5"/>
    </svg>`
  },
  radio: {
    label: 'Broadcast Stream',
    svg: `<svg viewBox="0 0 30 30" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
      <circle cx="15" cy="15" r="3" fill="currentColor"/>
      <path d="M20.3 9.7a7.5 7.5 0 0 1 0 10.6m-10.6 0a7.5 7.5 0 0 1 0-10.6"/>
      <path d="M24.5 5.5a13.5 13.5 0 0 1 0 19m-19 0a13.5 13.5 0 0 1 0-19"/>
    </svg>`
  }
};

export interface StudioMixerUiContext {
  getChannels: () => StudioMixerChannel[];
  getVoiceInputs: () => VoiceInputConfig[];
  onApplyMixerAudioRouting: () => void;
  onSavePreferences: () => void;
  onSetInputGain?: (val: number) => void;
  getVoiceMicEqDsp: (micIdx: number, slotIdx: number) => any;
  getMusicEqDsp: (slotIdx: number) => any;
  onToggleStudioMixer: (forceOpen?: boolean) => void;
}

let activeFxTarget: { channelId: string; slotIndex: number } | null = null;
let activeIconTarget: string | null = null;

export function openFxPopover(channelId: string, slotIndex: number, anchorEl: HTMLElement): void {
  activeFxTarget = { channelId, slotIndex };
  const popover = $('mixer-fx-picker-popover');
  if (!popover) return;
  const rect = anchorEl.getBoundingClientRect();
  const top = rect.bottom + 6;
  const left = Math.max(12, Math.min(window.innerWidth - 232, rect.left - 70));
  popover.style.top = `${Math.min(window.innerHeight - 300, top)}px`;
  popover.style.left = `${left}px`;
  popover.classList.remove('hidden');
  $('mixer-icon-picker-popover')?.classList.add('hidden');
}

export function openIconPopover(
  channelId: string,
  anchorEl: HTMLElement,
  studioMixerChannels: StudioMixerChannel[]
): void {
  activeIconTarget = channelId;
  const popover = $('mixer-icon-picker-popover');
  if (!popover) return;

  const channel = studioMixerChannels.find((c) => c.id === channelId);
  const grid = popover.querySelector('.mixer-icon-grid');
  if (grid) {
    grid.innerHTML = Object.entries(STUDIO_ICONS).map(([key, data]) => `
      <button type="button" class="icon-option ${channel?.icon === key ? 'active' : ''}" data-icon="${key}" title="${data.label}" style="color: ${channel?.color || '#38bdf8'}">
        ${data.svg}
      </button>
    `).join('');
  }

  const colorRow = popover.querySelector<HTMLElement>('.mixer-color-row');
  if (colorRow) {
    colorRow.style.display = (channel?.isMaster || channel?.id === 'master-out') ? 'none' : 'flex';
  }

  const rect = anchorEl.getBoundingClientRect();
  const top = rect.bottom + 6;
  const left = Math.max(12, Math.min(window.innerWidth - 232, rect.left - 70));
  popover.style.top = `${Math.min(window.innerHeight - 280, Math.max(10, top))}px`;
  popover.style.left = `${left}px`;
  popover.classList.remove('hidden');
  $('mixer-fx-picker-popover')?.classList.add('hidden');
}

export function renderStudioMixer(ctx: StudioMixerUiContext): void {
  const rack = $('mixer-channels-rack');
  if (!rack) return;
  rack.innerHTML = '';

  const studioMixerChannels = ctx.getChannels();
  const voiceInputs = ctx.getVoiceInputs();

  // 0. Left Parameters Ruler Column
  const labelsCol = document.createElement('div');
  labelsCol.className = 'mixer-labels-column';
  labelsCol.innerHTML = `
    <div class="mixer-label-item" style="height: 88px; margin-bottom: 12px;">Audio FX</div>
    <div class="mixer-label-item" style="height: 30px; margin-bottom: 12px;">Icon</div>
    <div class="mixer-label-item" style="height: 46px; margin-bottom: 12px;">Pan</div>
    <div class="mixer-label-item" style="height: 20px; margin-bottom: 8px;">dB</div>
    <div class="mixer-ruler-scale">
      <div class="ruler-num" style="top: 2%">6</div>
      <div class="ruler-num" style="top: 9%">3</div>
      <div class="ruler-num num-0" style="top: 16%">0</div>
      <div class="ruler-num" style="top: 24%">-3</div>
      <div class="ruler-num" style="top: 32%">-6</div>
      <div class="ruler-num" style="top: 48%">-12</div>
      <div class="ruler-num" style="top: 62%">-18</div>
      <div class="ruler-num" style="top: 74%">-24</div>
      <div class="ruler-num" style="top: 81%">-30</div>
      <div class="ruler-num" style="top: 92%">-40</div>
      <div class="ruler-num" style="top: 99%">-∞</div>
    </div>
    <div class="mixer-label-item" style="height: 22px; margin-bottom: 8px;"></div>
    <div class="mixer-label-item" style="height: 28px;"></div>
  `;
  rack.appendChild(labelsCol);

  const hasLocalSolo = studioMixerChannels.some((c) => !c.isMaster && (c.section === 'local' || c.id === 'music-stream' || c.id.startsWith('you-mic')) && c.soloed);
  const hasRemoteSolo = studioMixerChannels.some((c) => !c.isMaster && c.section === 'remote' && c.id !== 'master-out' && c.soloed);
  let renderedRemoteDivider = false;

  studioMixerChannels.forEach((channel) => {
    channel.volume = typeof channel.volume === 'number' && !isNaN(channel.volume) ? channel.volume : 1.0;
    channel.pan = typeof channel.pan === 'number' && !isNaN(channel.pan) ? channel.pan : 0;
    channel.muted = Boolean(channel.muted);
    channel.soloed = channel.isMaster ? false : Boolean(channel.soloed);
    channel.fx = Array.isArray(channel.fx) ? channel.fx : [];
    channel.color = channel.color || '#3b82f6';
    channel.icon = channel.icon || 'mic';
    channel.name = channel.name || 'Track';

    if (channel.section === 'remote' && !renderedRemoteDivider) {
      renderedRemoteDivider = true;
      const divider = document.createElement('div');
      divider.className = 'mixer-section-divider';
      divider.title = 'Remote Peer Monitor (מי שממול)';
      divider.innerHTML = `
        <div class="mixer-section-divider-line"></div>
        <span class="mixer-section-tag">REMOTE</span>
        <div class="mixer-section-divider-line"></div>
      `;
      rack.appendChild(divider);
    }

    const isLocal = channel.section === 'local' || channel.id.startsWith('you-mic') || channel.id === 'music-stream';
    const domainHasSolo = isLocal ? hasLocalSolo : hasRemoteSolo;
    const isDimmed = !channel.isMaster && domainHasSolo && !channel.soloed;
    const strip = document.createElement('div');
    strip.className = `mixer-strip ${channel.isMaster ? 'is-master' : ''} ${channel.section === 'remote' ? 'is-remote' : ''} ${isDimmed ? 'is-dimmed' : ''}`;
    strip.dataset.channelId = channel.id;

    // 1. Audio FX Plugin Rack (All channels except Master) vs Invisible Spacer (Master)
    if (channel.isMaster) {
      const topSpacer = document.createElement('div');
      topSpacer.className = 'mixer-remote-spacer-top';
      strip.appendChild(topSpacer);
    } else {
      const fxRack = document.createElement('div');
      fxRack.className = 'mixer-fx-rack';
      for (let i = 0; i < 4; i++) {
        const activeFx = channel.fx[i] || '';
        const fxSlot = document.createElement('button');
        fxSlot.type = 'button';
        fxSlot.className = `mixer-cell-btn ${activeFx ? 'btn-fx-active' : 'btn-fx-empty'}`;
        fxSlot.textContent = activeFx || '';
        fxSlot.title = activeFx === 'Chan EQ'
          ? `Channel EQ: Click to open EQ plugin window (Right-click to change/clear)`
          : activeFx
          ? `Plugin: ${activeFx} (Click to change/remove)`
          : `Slot ${i + 1}: Add Audio FX Plugin`;

        fxSlot.addEventListener('click', (e) => {
          e.stopPropagation();
          if (activeFx === 'Chan EQ') {
            openChannelEqPlugin(
              channel.id,
              i,
              channel.name,
              channel.color,
              () => {
                if (channel.id.startsWith('you-mic')) {
                  const micIdx = channel.id === 'you-mic' ? 1 : parseInt(channel.id.replace('you-mic-', ''), 10) || 1;
                  return ctx.getVoiceMicEqDsp(micIdx, i);
                } else if (channel.id === 'music-stream') {
                  return ctx.getMusicEqDsp(i);
                } else {
                  return channelEqDspRegistry.get(channel.id, i);
                }
              },
              () => saveStudioMixerConfig(studioMixerChannels, false)
            );
          } else {
            openFxPopover(channel.id, i, fxSlot);
          }
        });

        fxSlot.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          openFxPopover(channel.id, i, fxSlot);
        });

        fxRack.appendChild(fxSlot);
      }
      strip.appendChild(fxRack);
    }

    // 2. Track Icon (Logic Pro Instrument & Vocal Silhouettes)
    const iconBtn = document.createElement('button');
    iconBtn.type = 'button';
    iconBtn.className = 'mixer-icon-btn';
    iconBtn.style.color = channel.color;
    iconBtn.title = 'Change Channel Icon & Color';
    const iconKey = channel.icon || (channel.id === 'you-mic' ? 'mic' : channel.id === 'remote-voice' ? 'headphones' : channel.isMaster ? 'crown' : 'waves');
    const iconData = STUDIO_ICONS[iconKey] || STUDIO_ICONS.waves || { label: 'Track', svg: '' };
    iconBtn.innerHTML = iconData.svg;
    iconBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openIconPopover(channel.id, iconBtn, studioMixerChannels);
    });
    strip.appendChild(iconBtn);

    // 3. Pan Knob (All channels except Master) vs Invisible Spacer (Master)
    if (channel.isMaster) {
      const panSpacer = document.createElement('div');
      panSpacer.className = 'mixer-remote-spacer-pan';
      strip.appendChild(panSpacer);
    } else {
      const panWrap = document.createElement('div');
      panWrap.className = 'mixer-pan-wrap';
      panWrap.innerHTML = `
        <div class="mixer-pan-outer-ring" style="background: ${getPanBackground(channel.pan)}" title="Pan / Balance (Drag up/down, double-click to center)">
          <div class="mixer-pan-cap">
            <div class="mixer-pan-cap-notch"></div>
            <span class="mixer-pan-cap-text">${panToReadout(channel.pan)}</span>
          </div>
        </div>
      `;
      const panRing = panWrap.querySelector<HTMLElement>('.mixer-pan-outer-ring')!;
      const panText = panWrap.querySelector<HTMLElement>('.mixer-pan-cap-text')!;
      const panNotch = panWrap.querySelector<HTMLElement>('.mixer-pan-cap-notch')!;

      const updatePanVisuals = (pan: number) => {
        panRing.style.background = getPanBackground(pan);
        panText.textContent = panToReadout(pan);
        const deg = Math.round(pan * 140);
        if (panNotch) {
          panNotch.style.transform = `translate(-50%, -50%) rotate(${deg}deg) translateY(-15px)`;
        }
      };

      updatePanVisuals(channel.pan);

      panRing.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        panRing.setPointerCapture(e.pointerId);
        const startClientY = e.clientY;
        const startPan = channel.pan;

        const onPanMove = (pe: PointerEvent) => {
          const delta = (startClientY - pe.clientY) / 75;
          channel.pan = Math.max(-1, Math.min(1, startPan + delta));
          updatePanVisuals(channel.pan);
          ctx.onApplyMixerAudioRouting();
        };

        const onPanUp = (pe: PointerEvent) => {
          try { panRing.releasePointerCapture(pe.pointerId); } catch {}
          panRing.removeEventListener('pointermove', onPanMove);
          panRing.removeEventListener('pointerup', onPanUp);
          panRing.removeEventListener('pointercancel', onPanUp);
          saveStudioMixerConfig(studioMixerChannels, true);
        };

        panRing.addEventListener('pointermove', onPanMove);
        panRing.addEventListener('pointerup', onPanUp);
        panRing.addEventListener('pointercancel', onPanUp);
      });

      panRing.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        channel.pan = 0;
        updatePanVisuals(0);
        ctx.onApplyMixerAudioRouting();
        saveStudioMixerConfig(studioMixerChannels, true);
      });

      panRing.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.04 : -0.04;
        channel.pan = Math.max(-1, Math.min(1, channel.pan + delta));
        updatePanVisuals(channel.pan);
        ctx.onApplyMixerAudioRouting();
        saveStudioMixerConfig(studioMixerChannels, false);
      }, { passive: false });

      strip.appendChild(panWrap);
    }

    // 4. Digital Readout Boxes (Fader dB + Peak dB)
    const readoutRow = document.createElement('div');
    readoutRow.className = 'mixer-readout-row';
    const currentDb = channel.volume <= 0.0001 ? -Infinity : 20 * Math.log10(channel.volume);
    readoutRow.innerHTML = `
      <div class="mixer-fader-val" title="Double-click to reset to 0.0 dB">${formatDbText(currentDb)}</div>
      <div class="mixer-peak-val" title="Peak Meter Level"></div>
    `;
    const faderValEl = readoutRow.querySelector<HTMLElement>('.mixer-fader-val')!;
    faderValEl.addEventListener('dblclick', () => {
      channel.volume = 1.0;
      if (channel.id.startsWith('you-mic') || channel.id === 'you-mic') {
        const micIdx = channel.id === 'you-mic' ? 1 : parseInt(channel.id.replace('you-mic-', ''), 10) || 1;
        const mic = voiceInputs.find((m) => m.id === micIdx);
        if (mic) {
          mic.gain = 1.0;
          if (micIdx === 1 && ctx.onSetInputGain) ctx.onSetInputGain(1.0);
          ctx.onSavePreferences();
        }
      }
      renderStudioMixer(ctx);
      ctx.onApplyMixerAudioRouting();
      saveStudioMixerConfig(studioMixerChannels, true);
    });
    strip.appendChild(readoutRow);

    // 5. Vertical Fader, Logic Pro Scale & Live Dual VU Meter
    const faderArea = document.createElement('div');
    faderArea.className = 'mixer-fader-area';
    const topPct = dbToFaderTopPercent(currentDb);
    faderArea.innerHTML = `
      <div class="mixer-fader-column" data-channel-id="${channel.id}">
        <div class="fader-graduations">
          <div class="grad-line grad-0" style="top: 16%"></div>
          <div class="grad-line" style="top: 24%"></div>
          <div class="grad-line grad-major" style="top: 32%"></div>
          <div class="grad-line" style="top: 40%"></div>
          <div class="grad-line" style="top: 48%"></div>
          <div class="grad-line grad-major" style="top: 55%"></div>
          <div class="grad-line" style="top: 62%"></div>
          <div class="grad-line" style="top: 68%"></div>
          <div class="grad-line" style="top: 74%"></div>
          <div class="grad-line" style="top: 81%"></div>
          <div class="grad-line" style="top: 87%"></div>
          <div class="grad-line" style="top: 92%"></div>
          <div class="grad-line" style="top: 95%"></div>
          <div class="grad-line" style="top: 97.5%"></div>
          <div class="grad-line" style="top: 99%"></div>
        </div>
        <div class="logic-fader-groove">
          <div class="logic-fader-groove-line"></div>
          <div class="logic-fader-cap" style="top: ${topPct.toFixed(2)}%"></div>
        </div>
      </div>

      <div class="mixer-scale-column">
        <div class="scale-num num-0" style="top: 16%">0</div>
        <div class="scale-num" style="top: 24%">3</div>
        <div class="scale-num" style="top: 32%">6</div>
        <div class="scale-num" style="top: 40%">9</div>
        <div class="scale-num" style="top: 48%">12</div>
        <div class="scale-num" style="top: 55%">15</div>
        <div class="scale-num" style="top: 62%">18</div>
        <div class="scale-num" style="top: 68%">21</div>
        <div class="scale-num" style="top: 74%">24</div>
        <div class="scale-num" style="top: 81%">30</div>
        <div class="scale-num" style="top: 87%">35</div>
        <div class="scale-num" style="top: 92%">40</div>
        <div class="scale-num" style="top: 95%">45</div>
        <div class="scale-num" style="top: 97.5%">50</div>
        <div class="scale-num" style="top: 99%">60</div>
      </div>

      <div class="mixer-vu-meter">
        <div class="vu-bar"><div class="vu-fill vu-fill-l"></div></div>
        <div class="vu-bar"><div class="vu-fill vu-fill-r"></div></div>
      </div>
    `;

    const faderColumn = faderArea.querySelector<HTMLElement>('.mixer-fader-column')!;
    const faderCap = faderArea.querySelector<HTMLElement>('.logic-fader-cap')!;

    const setFaderByTopPercent = (pct: number) => {
      const clampedPct = Math.max(2.0, Math.min(98.5, pct));
      const db = faderTopPercentToDb(clampedPct);
      const gainVal = dbToGain(db);
      channel.volume = gainVal;
      faderCap.style.top = `${clampedPct.toFixed(2)}%`;
      faderValEl.textContent = formatDbText(db);
      if (channel.id.startsWith('you-mic') || channel.id === 'you-mic') {
        const micIdx = channel.id === 'you-mic' ? 1 : parseInt(channel.id.replace('you-mic-', ''), 10) || 1;
        const mic = voiceInputs.find((m) => m.id === micIdx);
        if (mic) {
          mic.gain = gainVal;
          if (micIdx === 1 && ctx.onSetInputGain) ctx.onSetInputGain(gainVal);
          ctx.onSavePreferences();
        }
      }
      ctx.onApplyMixerAudioRouting();
    };

    faderCap.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      faderCap.classList.add('is-dragging');
      faderCap.setPointerCapture(e.pointerId);

      const startClientY = e.clientY;
      const startTopPct = parseFloat(faderCap.style.top) || 16;
      const rect = faderColumn.getBoundingClientRect();
      const trackHeight = rect.height || 180;

      const onPointerMove = (pe: PointerEvent) => {
        const deltaY = pe.clientY - startClientY;
        const deltaPct = (deltaY / trackHeight) * 100;
        setFaderByTopPercent(startTopPct + deltaPct);
      };

      const onPointerUp = (pe: PointerEvent) => {
        faderCap.classList.remove('is-dragging');
        try { faderCap.releasePointerCapture(pe.pointerId); } catch {}
        faderCap.removeEventListener('pointermove', onPointerMove);
        faderCap.removeEventListener('pointerup', onPointerUp);
        faderCap.removeEventListener('pointercancel', onPointerUp);
        saveStudioMixerConfig(studioMixerChannels, true);
      };

      faderCap.addEventListener('pointermove', onPointerMove);
      faderCap.addEventListener('pointerup', onPointerUp);
      faderCap.addEventListener('pointercancel', onPointerUp);
    });

    faderColumn.addEventListener('pointerdown', (e) => {
      if (e.target === faderCap || faderCap.contains(e.target as Node)) return;
      e.preventDefault();
      faderColumn.setPointerCapture(e.pointerId);
      faderCap.classList.add('is-dragging');

      const rect = faderColumn.getBoundingClientRect();
      const trackHeight = rect.height || 180;
      const initialPct = ((e.clientY - rect.top) / trackHeight) * 100;
      setFaderByTopPercent(initialPct);

      const onTrackPointerMove = (pe: PointerEvent) => {
        const movePct = ((pe.clientY - rect.top) / trackHeight) * 100;
        setFaderByTopPercent(movePct);
      };

      const onTrackPointerUp = (pe: PointerEvent) => {
        faderCap.classList.remove('is-dragging');
        try { faderColumn.releasePointerCapture(pe.pointerId); } catch {}
        faderColumn.removeEventListener('pointermove', onTrackPointerMove);
        faderColumn.removeEventListener('pointerup', onTrackPointerUp);
        faderColumn.removeEventListener('pointercancel', onTrackPointerUp);
        saveStudioMixerConfig(studioMixerChannels, true);
      };

      faderColumn.addEventListener('pointermove', onTrackPointerMove);
      faderColumn.addEventListener('pointerup', onTrackPointerUp);
      faderColumn.addEventListener('pointercancel', onTrackPointerUp);
    });

    const handleFaderReset = (e: MouseEvent) => {
      e.stopPropagation();
      channel.volume = 1.0;
      faderCap.style.top = '16%';
      faderValEl.textContent = '0.0';
      if (channel.id.startsWith('you-mic') || channel.id === 'you-mic') {
        const micIdx = channel.id === 'you-mic' ? 1 : parseInt(channel.id.replace('you-mic-', ''), 10) || 1;
        const mic = voiceInputs.find((m) => m.id === micIdx);
        if (mic) {
          mic.gain = 1.0;
          if (micIdx === 1 && ctx.onSetInputGain) ctx.onSetInputGain(1.0);
          ctx.onSavePreferences();
        }
      }
      ctx.onApplyMixerAudioRouting();
      saveStudioMixerConfig(studioMixerChannels, true);
    };

    faderCap.addEventListener('dblclick', handleFaderReset);
    faderColumn.addEventListener('dblclick', handleFaderReset);

    faderColumn.addEventListener('wheel', (e) => {
      e.preventDefault();
      const curDb = channel.volume <= 0.0001 ? -60 : 20 * Math.log10(channel.volume);
      const deltaDb = e.deltaY < 0 ? 0.3 : -0.3;
      const newDb = Math.max(-65, Math.min(6.0, curDb + deltaDb));
      const gainVal = dbToGain(newDb);
      channel.volume = gainVal;
      faderCap.style.top = `${dbToFaderTopPercent(newDb).toFixed(2)}%`;
      faderValEl.textContent = formatDbText(newDb);
      if (channel.id.startsWith('you-mic') || channel.id === 'you-mic') {
        const micIdx = channel.id === 'you-mic' ? 1 : parseInt(channel.id.replace('you-mic-', ''), 10) || 1;
        const mic = voiceInputs.find((m) => m.id === micIdx);
        if (mic) {
          mic.gain = gainVal;
          if (micIdx === 1 && ctx.onSetInputGain) ctx.onSetInputGain(gainVal);
          ctx.onSavePreferences();
        }
      }
      ctx.onApplyMixerAudioRouting();
      saveStudioMixerConfig(studioMixerChannels, false);
    }, { passive: false });

    strip.appendChild(faderArea);

    // 6. Mute & Solo DAW Buttons
    const msGroup = document.createElement('div');
    msGroup.className = 'mixer-ms-group';
    if (channel.isMaster) {
      msGroup.innerHTML = `
        <button type="button" class="btn-mixer-ms btn-m ${channel.muted ? 'active' : ''}" style="width: 100%;" title="Mute Monitor Master (Remote Mix)">M</button>
      `;
      msGroup.querySelector('.btn-m')?.addEventListener('click', () => {
        channel.muted = !channel.muted;
        renderStudioMixer(ctx);
        ctx.onApplyMixerAudioRouting();
      });
    } else {
      msGroup.innerHTML = `
        <button type="button" class="btn-mixer-ms btn-m ${channel.muted ? 'active' : ''}" title="Mute Track">M</button>
        <button type="button" class="btn-mixer-ms btn-s ${channel.soloed ? 'active' : ''}" title="Solo Track">S</button>
      `;
      msGroup.querySelector('.btn-m')?.addEventListener('click', () => {
        channel.muted = !channel.muted;
        renderStudioMixer(ctx);
        ctx.onApplyMixerAudioRouting();
      });
      msGroup.querySelector('.btn-s')?.addEventListener('click', () => {
        channel.soloed = !channel.soloed;
        renderStudioMixer(ctx);
        ctx.onApplyMixerAudioRouting();
      });
    }
    strip.appendChild(msGroup);

    // 8. Bottom Solid Track Color Banner (With rename on double-click)
    const bottomBanner = document.createElement('div');
    bottomBanner.className = 'mixer-strip-bottom-banner';
    bottomBanner.style.background = channel.color;
    bottomBanner.textContent = channel.name;
    bottomBanner.title = 'Double click to rename channel';
    bottomBanner.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'mixer-track-name-input';
      input.value = channel.name;
      input.maxLength = 18;

      let isCommitted = false;
      const commit = () => {
        if (isCommitted) return;
        isCommitted = true;
        const val = input.value.trim();
        if (val) {
          channel.name = val;
          saveStudioMixerConfig(studioMixerChannels);
        }
        renderStudioMixer(ctx);
      };
      const cancel = () => {
        if (isCommitted) return;
        isCommitted = true;
        renderStudioMixer(ctx);
      };

      input.addEventListener('keydown', (ke) => {
        if (ke.key === 'Enter') {
          ke.preventDefault();
          commit();
        } else if (ke.key === 'Escape') {
          ke.preventDefault();
          cancel();
        }
      });
      input.addEventListener('blur', commit);

      bottomBanner.replaceWith(input);
      input.focus();
      input.select();
    });
    strip.appendChild(bottomBanner);

    rack.appendChild(strip);
  });
}

export function initStudioMixerPopoversAndControls(ctx: StudioMixerUiContext): void {
  // Wire Popovers Event Delegation for 100% Reliable Clicks
  $('mixer-icon-picker-popover')?.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    if (!target || !activeIconTarget) return;

    const studioMixerChannels = ctx.getChannels();
    const iconBtn = target.closest<HTMLButtonElement>('.icon-option');
    if (iconBtn) {
      const selectedIcon = iconBtn.dataset.icon || iconBtn.getAttribute('data-icon');
      const channel = studioMixerChannels.find((c) => c.id === activeIconTarget);
      if (channel && selectedIcon) {
        channel.icon = selectedIcon;
        saveStudioMixerConfig(studioMixerChannels);
        renderStudioMixer(ctx);
      }
      $('mixer-icon-picker-popover')?.classList.add('hidden');
      activeIconTarget = null;
      return;
    }

    const colorSwatch = target.closest<HTMLElement>('.mixer-color-swatch');
    if (colorSwatch) {
      const selectedColor = colorSwatch.dataset.color || colorSwatch.getAttribute('data-color');
      const channel = studioMixerChannels.find((c) => c.id === activeIconTarget);
      if (channel && selectedColor && !channel.isMaster && channel.id !== 'master-out') {
        channel.color = selectedColor;
        saveStudioMixerConfig(studioMixerChannels);
        renderStudioMixer(ctx);
      }
      $('mixer-icon-picker-popover')?.classList.add('hidden');
      activeIconTarget = null;
      return;
    }
  });

  $('mixer-fx-picker-popover')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement)?.closest<HTMLButtonElement>('.fx-option');
    if (!btn || !activeFxTarget) return;
    const { channelId, slotIndex } = activeFxTarget;
    const studioMixerChannels = ctx.getChannels();
    const channel = studioMixerChannels.find((c) => c.id === channelId);
    if (channel) {
      const fx = btn.dataset.fx;
      if (fx === 'remove') {
        channel.fx[slotIndex] = '';
        channelEqDspRegistry.remove(channelId, slotIndex);
        removeChannelEqConfig(channelId, slotIndex);
      } else if (fx) {
        channel.fx[slotIndex] = fx;
        if (fx !== 'Chan EQ') {
          channelEqDspRegistry.remove(channelId, slotIndex);
          removeChannelEqConfig(channelId, slotIndex);
        }
      }
      saveStudioMixerConfig(studioMixerChannels);
      renderStudioMixer(ctx);
      ctx.onApplyMixerAudioRouting();
    }
    $('mixer-fx-picker-popover')?.classList.add('hidden');
    activeFxTarget = null;
  });

  $('btn-close-fx-popover')?.addEventListener('click', () => {
    $('mixer-fx-picker-popover')?.classList.add('hidden');
    activeFxTarget = null;
  });

  $('btn-close-icon-popover')?.addEventListener('click', () => {
    $('mixer-icon-picker-popover')?.classList.add('hidden');
    activeIconTarget = null;
  });

  // Close popovers on click outside
  window.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    if (!target?.closest('#mixer-fx-picker-popover') && !target?.closest('.mixer-fx-slot')) {
      $('mixer-fx-picker-popover')?.classList.add('hidden');
      activeFxTarget = null;
    }
    if (!target?.closest('#mixer-icon-picker-popover') && !target?.closest('.mixer-icon-btn')) {
      $('mixer-icon-picker-popover')?.classList.add('hidden');
      activeIconTarget = null;
    }
  });

  // Studio Mixer Controls & Shortcuts
  $('toggle-session-mixer')?.addEventListener('click', () => {
    ctx.onToggleStudioMixer();
  });

  $('btn-close-studio-mixer')?.addEventListener('click', () => {
    ctx.onToggleStudioMixer(false);
  });

  $('session-studio-mixer-modal')?.addEventListener('click', (e) => {
    if (e.target === $('session-studio-mixer-modal')) {
      ctx.onToggleStudioMixer(false);
    }
  });
}
