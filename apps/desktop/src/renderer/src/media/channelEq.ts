/**
 * JaMeet Built-in Channel EQ Plugin System
 *
 * 7-Band professional DAW EQ with AudioContext-isolated DSP instances,
 * true dry/wet global bypass, continuous AudioParam smoothing,
 * exact BiquadFilterNode.getFrequencyResponse curve measurement,
 * on-demand live spectrum analysis, and interactive plugin GUI.
 */

export type ChannelEqBandType = 'highpass' | 'lowshelf' | 'peaking' | 'highshelf' | 'lowpass';

export interface ChannelEqBandConfig {
  id: number; // 1 to 7
  type: ChannelEqBandType;
  frequency: number; // 20 to 20000 Hz
  gain: number; // -24 to +24 dB
  q: number; // 0.1 to 10.0
  enabled: boolean;
}

export interface ChannelEqConfig {
  globalBypass: boolean;
  bands: ChannelEqBandConfig[];
}

export const BAND_TYPE_NAMES: Record<ChannelEqBandType, string> = {
  highpass: 'High Pass',
  lowshelf: 'Low Shelf',
  peaking: 'Peaking',
  highshelf: 'High Shelf',
  lowpass: 'Low Pass'
};

export const BAND_COLORS: Record<number, string> = {
  1: '#06b6d4', // Cyan (HPF)
  2: '#3b82f6', // Blue (Low Shelf)
  3: '#8b5cf6', // Violet (Peak 1)
  4: '#d946ef', // Magenta (Peak 2)
  5: '#f43f5e', // Rose (Peak 3)
  6: '#f59e0b', // Amber (High Shelf)
  7: '#10b981'  // Emerald (LPF)
};

export function createDefaultChannelEqConfig(): ChannelEqConfig {
  return {
    globalBypass: false,
    bands: [
      { id: 1, type: 'highpass', frequency: 80, gain: 0, q: 0.707, enabled: false },
      { id: 2, type: 'lowshelf', frequency: 200, gain: 0, q: 0.707, enabled: true },
      { id: 3, type: 'peaking', frequency: 500, gain: 0, q: 1.0, enabled: true },
      { id: 4, type: 'peaking', frequency: 2000, gain: 0, q: 1.0, enabled: true },
      { id: 5, type: 'peaking', frequency: 5000, gain: 0, q: 1.0, enabled: true },
      { id: 6, type: 'highshelf', frequency: 10000, gain: 0, q: 0.707, enabled: true },
      { id: 7, type: 'lowpass', frequency: 18000, gain: 0, q: 0.707, enabled: false }
    ]
  };
}

export function cloneChannelEqConfig(src: ChannelEqConfig): ChannelEqConfig {
  return {
    globalBypass: Boolean(src.globalBypass),
    bands: (src.bands || []).map((b) => ({
      id: b.id,
      type: b.type,
      frequency: b.frequency,
      gain: b.gain,
      q: b.q,
      enabled: b.enabled
    }))
  };
}

// Global persistent configuration cache keyed by `${channelId}:${slotIndex}`
const channelEqPersistentConfigs = new Map<string, ChannelEqConfig>();

export function getChannelEqConfig(channelId: string, slotIndex: number): ChannelEqConfig {
  const key = `${channelId}:${slotIndex}`;
  let conf = channelEqPersistentConfigs.get(key);
  if (!conf) {
    conf = createDefaultChannelEqConfig();
    channelEqPersistentConfigs.set(key, conf);
  }
  return conf;
}

export function setChannelEqConfig(channelId: string, slotIndex: number, config: ChannelEqConfig): void {
  const key = `${channelId}:${slotIndex}`;
  channelEqPersistentConfigs.set(key, cloneChannelEqConfig(config));
}

export function removeChannelEqConfig(channelId: string, slotIndex: number): void {
  const key = `${channelId}:${slotIndex}`;
  channelEqPersistentConfigs.delete(key);
}

export function exportAllChannelEqConfigs(): Record<string, ChannelEqConfig> {
  const out: Record<string, ChannelEqConfig> = {};
  channelEqPersistentConfigs.forEach((val, key) => {
    out[key] = cloneChannelEqConfig(val);
  });
  return out;
}

export function importAllChannelEqConfigs(data: Record<string, ChannelEqConfig>): void {
  if (!data || typeof data !== 'object') return;
  for (const [key, conf] of Object.entries(data)) {
    if (conf && Array.isArray(conf.bands)) {
      channelEqPersistentConfigs.set(key, cloneChannelEqConfig(conf));
    }
  }
}

/**
 * ChannelEqDspInstance
 * AudioContext-isolated live DSP processing node graph for a single FX slot.
 */
export class ChannelEqDspInstance {
  readonly audioCtx: AudioContext;
  config: ChannelEqConfig;

  readonly inputNode: GainNode;
  readonly dryGainNode: GainNode;
  readonly wetGainNode: GainNode;
  readonly filterChainIn: GainNode;
  readonly outputNode: GainNode;

  readonly filterNodes = new Map<number, BiquadFilterNode>();
  readonly analyserNode: AnalyserNode;

  private isDisposed = false;

  constructor(audioCtx: AudioContext, initialConfig?: ChannelEqConfig) {
    this.audioCtx = audioCtx;
    this.config = initialConfig ? cloneChannelEqConfig(initialConfig) : createDefaultChannelEqConfig();

    const now = audioCtx.currentTime;

    this.inputNode = audioCtx.createGain();
    this.dryGainNode = audioCtx.createGain();
    this.wetGainNode = audioCtx.createGain();
    this.filterChainIn = audioCtx.createGain();
    this.outputNode = audioCtx.createGain();

    // Visual-only analyzer tapped from input
    this.analyserNode = audioCtx.createAnalyser();
    this.analyserNode.fftSize = 2048;
    this.analyserNode.smoothingTimeConstant = 0.8;

    this.inputNode.connect(this.dryGainNode);
    this.inputNode.connect(this.filterChainIn);
    this.inputNode.connect(this.analyserNode);

    this.dryGainNode.connect(this.outputNode);
    this.wetGainNode.connect(this.outputNode);

    // Create the 7 BiquadFilterNode instances
    for (const band of this.config.bands) {
      const filter = audioCtx.createBiquadFilter();
      filter.type = band.type;
      filter.frequency.setValueAtTime(Math.max(20, Math.min(20000, band.frequency)), now);
      filter.Q.setValueAtTime(Math.max(0.1, Math.min(10.0, band.q)), now);
      if (band.type === 'peaking' || band.type === 'lowshelf' || band.type === 'highshelf') {
        filter.gain.setValueAtTime(Math.max(-24, Math.min(24, band.gain)), now);
      }
      this.filterNodes.set(band.id, filter);
    }

    // Set initial dry/wet state
    this.applyGlobalBypassState(this.config.globalBypass, true);

    // Build the series filter chain topology
    this.rebuildFilterChainTopology();
  }

  private applyGlobalBypassState(bypass: boolean, immediate = false): void {
    if (this.isDisposed || this.audioCtx.state === 'closed') return;
    const now = this.audioCtx.currentTime;
    const dryTarget = bypass ? 1.0 : 0.0;
    const wetTarget = bypass ? 0.0 : 1.0;

    if (immediate) {
      try {
        this.dryGainNode.gain.setValueAtTime(dryTarget, now);
        this.wetGainNode.gain.setValueAtTime(wetTarget, now);
      } catch {
        this.dryGainNode.gain.value = dryTarget;
        this.wetGainNode.gain.value = wetTarget;
      }
    } else {
      try {
        this.dryGainNode.gain.setTargetAtTime(dryTarget, now, 0.015);
        this.wetGainNode.gain.setTargetAtTime(wetTarget, now, 0.015);
      } catch {
        this.dryGainNode.gain.value = dryTarget;
        this.wetGainNode.gain.value = wetTarget;
      }
    }
  }

  setGlobalBypass(bypass: boolean): void {
    this.config.globalBypass = bypass;
    this.applyGlobalBypassState(bypass, false);
  }

  /**
   * Reconnects only the active (enabled) filter nodes in series between filterChainIn and wetGainNode.
   */
  private rebuildFilterChainTopology(): void {
    if (this.isDisposed || this.audioCtx.state === 'closed') return;

    try { this.filterChainIn.disconnect(); } catch {}
    for (const filter of this.filterNodes.values()) {
      try { filter.disconnect(); } catch {}
    }

    const activeFilters: BiquadFilterNode[] = [];
    for (const band of this.config.bands) {
      if (band.enabled) {
        const filter = this.filterNodes.get(band.id);
        if (filter) activeFilters.push(filter);
      }
    }

    if (activeFilters.length === 0) {
      this.filterChainIn.connect(this.wetGainNode);
      return;
    }

    this.filterChainIn.connect(activeFilters[0]!);
    for (let i = 0; i < activeFilters.length - 1; i++) {
      activeFilters[i]!.connect(activeFilters[i + 1]!);
    }
    activeFilters[activeFilters.length - 1]!.connect(this.wetGainNode);
  }

  setBandEnabled(bandId: number, enabled: boolean): void {
    const band = this.config.bands.find((b) => b.id === bandId);
    if (!band) return;
    band.enabled = enabled;
    this.rebuildFilterChainTopology();
  }

  /**
   * Modulates AudioParams directly without breaking audio connections.
   */
  updateBandParam(bandId: number, params: Partial<ChannelEqBandConfig>, immediate = false): void {
    if (this.isDisposed || this.audioCtx.state === 'closed') return;

    const band = this.config.bands.find((b) => b.id === bandId);
    const filter = this.filterNodes.get(bandId);
    if (!band || !filter) return;

    const now = this.audioCtx.currentTime;

    if (typeof params.frequency === 'number' && !isNaN(params.frequency)) {
      band.frequency = Math.max(20, Math.min(20000, params.frequency));
      if (immediate) {
        try { filter.frequency.setValueAtTime(band.frequency, now); } catch { filter.frequency.value = band.frequency; }
      } else {
        try { filter.frequency.setTargetAtTime(band.frequency, now, 0.015); } catch { filter.frequency.value = band.frequency; }
      }
    }

    if (typeof params.gain === 'number' && !isNaN(params.gain) && (band.type === 'peaking' || band.type === 'lowshelf' || band.type === 'highshelf')) {
      band.gain = Math.max(-24, Math.min(24, params.gain));
      if (immediate) {
        try { filter.gain.setValueAtTime(band.gain, now); } catch { filter.gain.value = band.gain; }
      } else {
        try { filter.gain.setTargetAtTime(band.gain, now, 0.015); } catch { filter.gain.value = band.gain; }
      }
    }

    if (typeof params.q === 'number' && !isNaN(params.q)) {
      band.q = Math.max(0.1, Math.min(10.0, params.q));
      if (immediate) {
        try { filter.Q.setValueAtTime(band.q, now); } catch { filter.Q.value = band.q; }
      } else {
        try { filter.Q.setTargetAtTime(band.q, now, 0.015); } catch { filter.Q.value = band.q; }
      }
    }

    if (typeof params.enabled === 'boolean' && params.enabled !== band.enabled) {
      this.setBandEnabled(bandId, params.enabled);
    }
  }

  /**
   * Evaluates BiquadFilterNode.getFrequencyResponse across all active filter nodes.
   * Returns combined dB magnitude values in combinedDbArray.
   */
  getCombinedFrequencyResponse(frequencies: Float32Array, combinedDbArray: Float32Array): void {
    const len = frequencies.length;
    combinedDbArray.fill(0);

    if (this.config.globalBypass) {
      return;
    }

    const tempMag = new Float32Array(len);
    const tempPhase = new Float32Array(len);

    for (const band of this.config.bands) {
      if (!band.enabled) continue;
      const filter = this.filterNodes.get(band.id);
      if (!filter) continue;

      try {
        filter.getFrequencyResponse(frequencies, tempMag, tempPhase);
        for (let i = 0; i < len; i++) {
          const magVal = tempMag[i]!;
          if (magVal > 1e-6) {
            combinedDbArray[i] += 20 * Math.log10(magVal);
          } else {
            combinedDbArray[i] += -120;
          }
        }
      } catch {}
    }
  }

  getAnalyserByteFrequencyData(output: Uint8Array): void {
    if (this.isDisposed || !this.analyserNode) return;
    try {
      this.analyserNode.getByteFrequencyData(output);
    } catch {}
  }

  /**
   * Disconnects only the external output connection of the plugin instance.
   * Internal dry, wet, filter, and analyzer routing remains completely intact.
   */
  disconnectExternal(): void {
    if (this.isDisposed) return;
    try { this.outputNode.disconnect(); } catch {}
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    try { this.inputNode.disconnect(); } catch {}
    try { this.dryGainNode.disconnect(); } catch {}
    try { this.wetGainNode.disconnect(); } catch {}
    try { this.filterChainIn.disconnect(); } catch {}
    try { this.outputNode.disconnect(); } catch {}
    try { this.analyserNode.disconnect(); } catch {}
    for (const filter of this.filterNodes.values()) {
      try { filter.disconnect(); } catch {}
    }
    this.filterNodes.clear();
  }
}

/**
 * ChannelEqDspRegistry
 * Tracks live AudioContext-isolated DSP instances.
 */
class ChannelEqDspRegistry {
  private instances = new Map<string, ChannelEqDspInstance>();

  getInstanceKey(channelId: string, slotIndex: number): string {
    return `${channelId}:${slotIndex}`;
  }

  get(channelId: string, slotIndex: number): ChannelEqDspInstance | undefined {
    return this.instances.get(this.getInstanceKey(channelId, slotIndex));
  }

  getOrCreate(channelId: string, slotIndex: number, audioCtx: AudioContext): ChannelEqDspInstance {
    const key = this.getInstanceKey(channelId, slotIndex);
    let inst = this.instances.get(key);
    if (!inst || inst.audioCtx !== audioCtx || inst.audioCtx.state === 'closed') {
      if (inst) inst.dispose();
      const savedConfig = getChannelEqConfig(channelId, slotIndex);
      inst = new ChannelEqDspInstance(audioCtx, savedConfig);
      this.instances.set(key, inst);
    }
    return inst;
  }

  remove(channelId: string, slotIndex: number): void {
    const key = this.getInstanceKey(channelId, slotIndex);
    const inst = this.instances.get(key);
    if (inst) {
      inst.dispose();
      this.instances.delete(key);
    }
  }

  disposeChannelInstances(channelId: string): void {
    for (let slot = 0; slot < 4; slot++) {
      this.remove(channelId, slot);
    }
  }
}

export const channelEqDspRegistry = new ChannelEqDspRegistry();

// ========================================================
// CHANNEL EQ PLUGIN MODAL UI & INTERACTIVE GRAPH CONTROLLER
// ========================================================

interface ChannelEqModalTarget {
  channelId: string;
  slotIndex: number;
  channelName: string;
  channelColor: string;
  dsp: ChannelEqDspInstance | null;
  onConfigChange: () => void;
}

class ChannelEqPluginModal {
  private modalEl: HTMLElement | null = null;
  private canvasEl: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private currentTarget: ChannelEqModalTarget | null = null;

  private selectedBandId = 4; // Default to Mid Band (Band 4)
  private hoveredBandId: number | null = null;
  private isDragging = false;
  private dragBandId: number | null = null;
  private dragStartY = 0;
  private dragStartVal = 0;

  private rtaEnabled = true;
  private animFrameId: number | null = null;

  private readonly NUM_POINTS = 512;
  private readonly freqs = new Float32Array(512);
  private readonly dbCurve = new Float32Array(512);
  private readonly rtaBuffer = new Uint8Array(1024);

  constructor() {
    // Generate 512 logarithmic frequency points from 20 Hz to 20000 Hz
    const minLog = Math.log10(20);
    const maxLog = Math.log10(20000);
    for (let i = 0; i < this.NUM_POINTS; i++) {
      const logF = minLog + (i / (this.NUM_POINTS - 1)) * (maxLog - minLog);
      this.freqs[i] = Math.pow(10, logF);
    }
  }

  private freqToX(freq: number, width: number): number {
    const minLog = Math.log10(20);
    const maxLog = Math.log10(20000);
    const logF = Math.log10(Math.max(20, Math.min(20000, freq)));
    return ((logF - minLog) / (maxLog - minLog)) * width;
  }

  private xToFreq(x: number, width: number): number {
    const minLog = Math.log10(20);
    const maxLog = Math.log10(20000);
    const norm = Math.max(0, Math.min(1, x / width));
    return Math.pow(10, minLog + norm * (maxLog - minLog));
  }

  private dbToY(db: number, height: number): number {
    // +24 dB is top (y=0), -24 dB is bottom (y=height), 0 dB is center (y=height/2)
    const norm = (24 - db) / 48; // 0 for +24, 0.5 for 0, 1.0 for -24
    return Math.max(0, Math.min(height, norm * height));
  }

  private yToDb(y: number, height: number): number {
    const norm = y / height;
    return Math.max(-24, Math.min(24, 24 - norm * 48));
  }

  open(
    channelId: string,
    slotIndex: number,
    channelName: string,
    channelColor: string,
    dspGetter: () => ChannelEqDspInstance | undefined,
    onConfigChange: () => void
  ): void {
    const dsp = dspGetter() || null;

    this.currentTarget = {
      channelId,
      slotIndex,
      channelName,
      channelColor,
      dsp,
      onConfigChange
    };

    this.ensureModalMarkup();
    this.updateHeaderVisuals();
    this.renderBandControls();
    this.showModal();
    this.startVisualizer();
  }

  close(): void {
    this.stopVisualizer();
    if (this.modalEl) {
      this.modalEl.classList.add('hidden');
    }
    this.currentTarget = null;
    this.isDragging = false;
    this.dragBandId = null;
  }

  isOpen(): boolean {
    return this.currentTarget !== null && !this.modalEl?.classList.contains('hidden');
  }

  private ensureModalMarkup(): void {
    if (this.modalEl) return;

    let el = document.getElementById('channel-eq-plugin-modal');
    if (!el) {
      el = document.createElement('div');
      el.id = 'channel-eq-plugin-modal';
      el.className = 'channel-eq-modal hidden';
      document.body.appendChild(el);
    }
    this.modalEl = el;

    this.modalEl.innerHTML = `
      <div class="channel-eq-dialog" role="dialog" aria-label="Channel EQ Plugin">
        <!-- Top Bar -->
        <div class="channel-eq-header">
          <div class="channel-eq-title-group">
            <span class="channel-eq-icon-badge">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/>
                <circle cx="4" cy="12" r="2"/><circle cx="12" cy="10" r="2"/><circle cx="20" cy="14" r="2"/>
              </svg>
            </span>
            <div class="channel-eq-titles">
              <div class="channel-eq-main-title">
                <span class="channel-eq-track-name">Track</span>
                <span class="channel-eq-slot-badge">Slot 1 - Channel EQ</span>
              </div>
              <div class="channel-eq-sub-title">7-Band Precision Audio Filter &amp; Spectrum Visualizer</div>
            </div>
          </div>

          <div class="channel-eq-header-actions">
            <button type="button" id="btn-eq-rta-toggle" class="btn-eq-tool active" title="Toggle Real-Time Spectrum Analyzer">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M2 12h3v8H2v-8Zm6-6h3v14H8V6Zm6-4h3v18h-3V2Zm6 9h3v9h-3v-9Z"/></svg>
              <span>RTA</span>
            </button>
            <button type="button" id="btn-eq-flat" class="btn-eq-tool" title="Reset All Bands to 0 dB Flat">
              <span>Flat</span>
            </button>
            <button type="button" id="btn-eq-global-bypass" class="btn-eq-bypass" title="Master EQ Bypass (Bypass all bands)">
              <span class="eq-power-dot"></span>
              <span>Bypass</span>
            </button>
            <button type="button" id="btn-close-channel-eq" class="eq-close-btn" aria-label="Close Channel EQ">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>
        </div>

        <!-- Central Display Viewport -->
        <div class="channel-eq-display-viewport">
          <canvas id="channel-eq-canvas" class="channel-eq-canvas"></canvas>
          <div id="channel-eq-readout-pill" class="channel-eq-readout-pill hidden"></div>
          <div id="channel-eq-bypass-overlay" class="channel-eq-bypass-overlay hidden">
            <span>MASTER EQ BYPASSED</span>
          </div>
        </div>

        <!-- Bottom 7-Band Parameter Strip -->
        <div id="channel-eq-bands-rack" class="channel-eq-bands-rack"></div>

        <!-- Footer Bar -->
        <div class="channel-eq-footer">
          <div id="channel-eq-status-hint" class="channel-eq-status-hint">
            Drag band handles to adjust Freq &amp; Gain &bull; Scroll wheel modifies Q &bull; Double-click resets band
          </div>
        </div>
      </div>
    `;

    this.canvasEl = this.modalEl.querySelector<HTMLCanvasElement>('#channel-eq-canvas');
    if (this.canvasEl) {
      this.ctx = this.canvasEl.getContext('2d');
    }

    this.bindEvents();
  }

  private updateHeaderVisuals(): void {
    if (!this.modalEl || !this.currentTarget) return;

    const trackNameEl = this.modalEl.querySelector<HTMLElement>('.channel-eq-track-name');
    const slotBadgeEl = this.modalEl.querySelector<HTMLElement>('.channel-eq-slot-badge');
    const bypassBtn = this.modalEl.querySelector<HTMLButtonElement>('#btn-eq-global-bypass');
    const rtaBtn = this.modalEl.querySelector<HTMLButtonElement>('#btn-eq-rta-toggle');
    const bypassOverlay = this.modalEl.querySelector<HTMLElement>('#channel-eq-bypass-overlay');

    const config = getChannelEqConfig(this.currentTarget.channelId, this.currentTarget.slotIndex);

    if (trackNameEl) {
      trackNameEl.textContent = this.currentTarget.channelName;
      trackNameEl.style.color = this.currentTarget.channelColor || '#38bdf8';
    }

    if (slotBadgeEl) {
      slotBadgeEl.textContent = `Slot ${this.currentTarget.slotIndex + 1} - Channel EQ`;
    }

    if (bypassBtn) {
      if (config.globalBypass) {
        bypassBtn.classList.add('is-bypassed');
      } else {
        bypassBtn.classList.remove('is-bypassed');
      }
    }

    if (bypassOverlay) {
      if (config.globalBypass) {
        bypassOverlay.classList.remove('hidden');
      } else {
        bypassOverlay.classList.add('hidden');
      }
    }

    if (rtaBtn) {
      if (this.rtaEnabled) {
        rtaBtn.classList.add('active');
      } else {
        rtaBtn.classList.remove('active');
      }
    }
  }

  private renderBandControls(): void {
    if (!this.modalEl || !this.currentTarget) return;
    const rack = this.modalEl.querySelector<HTMLElement>('#channel-eq-bands-rack');
    if (!rack) return;

    const config = getChannelEqConfig(this.currentTarget.channelId, this.currentTarget.slotIndex);
    rack.innerHTML = '';

    config.bands.forEach((band) => {
      const isSelected = band.id === this.selectedBandId;
      const isHP = band.type === 'highpass';
      const isLP = band.type === 'lowpass';
      const isShelf = band.type === 'lowshelf' || band.type === 'highshelf';
      const hasGain = !isHP && !isLP;
      const hasQ = !isShelf;

      const bandColor = BAND_COLORS[band.id] || '#38bdf8';
      const typeLabel = isHP ? 'HPF' : isLP ? 'LPF' : band.type === 'lowshelf' ? 'Low Shelf' : band.type === 'highshelf' ? 'High Shelf' : `Bell ${band.id - 2}`;

      const card = document.createElement('div');
      card.className = `eq-band-card ${isSelected ? 'selected' : ''} ${band.enabled ? '' : 'is-disabled'}`;
      card.dataset.bandId = String(band.id);

      card.innerHTML = `
        <div class="eq-band-header">
          <div class="eq-band-badge" style="background: ${bandColor}20; color: ${bandColor}; border-color: ${bandColor}60;">
            ${band.id}
          </div>
          <span class="eq-band-type-label">${typeLabel}</span>
          <button type="button" class="eq-band-power-btn ${band.enabled ? 'active' : ''}" title="${band.enabled ? 'Bypass Band' : 'Enable Band'}">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M12 2a1 1 0 0 1 1 1v8a1 1 0 1 1-2 0V3a1 1 0 0 1 1-1Zm6.364 4.05a1 1 0 0 1 1.414 1.414A9 9 0 1 1 4.222 7.464a1 1 0 0 1 1.414-1.414 7 7 0 1 0 12.728 0Z"/></svg>
          </button>
        </div>

        <div class="eq-band-params">
          <!-- Frequency -->
          <div class="eq-param-row" data-param="frequency">
            <span class="eq-param-label">FREQ</span>
            <div class="eq-param-scrubber" title="Drag up/down or double click to edit">${this.formatFrequency(band.frequency)}</div>
          </div>

          <!-- Gain -->
          <div class="eq-param-row ${hasGain ? '' : 'disabled'}" data-param="gain">
            <span class="eq-param-label">GAIN</span>
            <div class="eq-param-scrubber" title="${hasGain ? 'Drag up/down or double click to edit' : 'Gain is fixed for cut filters'}">
              ${hasGain ? this.formatGain(band.gain) : '--'}
            </div>
          </div>

          <!-- Q Factor -->
          <div class="eq-param-row ${hasQ ? '' : 'disabled'}" data-param="q">
            <span class="eq-param-label">Q</span>
            <div class="eq-param-scrubber" title="${hasQ ? 'Drag up/down or double click to edit' : 'Q factor is fixed for shelf filters'}">${hasQ ? band.q.toFixed(2) : '--'}</div>
          </div>
        </div>
      `;

      // Select band on click
      card.addEventListener('pointerdown', (e) => {
        if ((e.target as HTMLElement).closest('.eq-band-power-btn') || (e.target as HTMLElement).closest('.eq-param-scrubber')) return;
        this.selectedBandId = band.id;
        this.renderBandControls();
      });

      // Band Power / Bypass toggle
      const pwrBtn = card.querySelector('.eq-band-power-btn');
      pwrBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleBandEnabled(band.id);
      });

      // Interactive parameter scrubbers
      const scrubbers = card.querySelectorAll<HTMLElement>('.eq-param-row:not(.disabled) .eq-param-scrubber');
      scrubbers.forEach((scrubber) => {
        const paramRow = scrubber.closest<HTMLElement>('.eq-param-row');
        const paramName = paramRow?.dataset.param as 'frequency' | 'gain' | 'q';
        if (!paramName) return;

        scrubber.addEventListener('pointerdown', (pe) => {
          pe.preventDefault();
          pe.stopPropagation();
          this.selectedBandId = band.id;
          scrubber.setPointerCapture(pe.pointerId);
          this.dragStartY = pe.clientY;
          this.dragStartVal = band[paramName];

          const onPointerMove = (me: PointerEvent) => {
            const deltaY = this.dragStartY - me.clientY;
            let newVal = this.dragStartVal;

            if (paramName === 'frequency') {
              const multiplier = Math.pow(1.015, deltaY);
              newVal = Math.max(20, Math.min(20000, this.dragStartVal * multiplier));
            } else if (paramName === 'gain') {
              newVal = Math.max(-24, Math.min(24, this.dragStartVal + deltaY * 0.2));
            } else if (paramName === 'q') {
              newVal = Math.max(0.1, Math.min(10.0, this.dragStartVal + deltaY * 0.03));
            }

            this.updateBandValue(band.id, paramName, newVal);
            this.updateScrubberReadout(card, band.id);
          };

          const onPointerUp = (me: PointerEvent) => {
            try { scrubber.releasePointerCapture(me.pointerId); } catch {}
            scrubber.removeEventListener('pointermove', onPointerMove);
            scrubber.removeEventListener('pointerup', onPointerUp);
            scrubber.removeEventListener('pointercancel', onPointerUp);
            this.renderBandControls();
          };

          scrubber.addEventListener('pointermove', onPointerMove);
          scrubber.addEventListener('pointerup', onPointerUp);
          scrubber.addEventListener('pointercancel', onPointerUp);
        });

        // Double click for direct text edit
        scrubber.addEventListener('dblclick', (de) => {
          de.stopPropagation();
          this.startInlineScrubberEdit(scrubber, band.id, paramName);
        });

        // Wheel scroll for precision stepping
        scrubber.addEventListener('wheel', (we) => {
          we.preventDefault();
          we.stopPropagation();
          const stepDir = we.deltaY < 0 ? 1 : -1;
          let curVal = band[paramName];
          if (paramName === 'frequency') {
            curVal = Math.max(20, Math.min(20000, curVal * (stepDir > 0 ? 1.05 : 0.95)));
          } else if (paramName === 'gain') {
            curVal = Math.max(-24, Math.min(24, curVal + stepDir * 0.5));
          } else if (paramName === 'q') {
            curVal = Math.max(0.1, Math.min(10.0, curVal + stepDir * 0.05));
          }
          this.updateBandValue(band.id, paramName, curVal);
          this.renderBandControls();
        }, { passive: false });
      });

      rack.appendChild(card);
    });
  }

  private updateScrubberReadout(card: HTMLElement, bandId: number): void {
    if (!this.currentTarget) return;
    const config = getChannelEqConfig(this.currentTarget.channelId, this.currentTarget.slotIndex);
    const band = config.bands.find((b) => b.id === bandId);
    if (!band) return;

    const freqEl = card.querySelector<HTMLElement>('[data-param="frequency"] .eq-param-scrubber');
    const gainEl = card.querySelector<HTMLElement>('[data-param="gain"] .eq-param-scrubber');
    const qEl = card.querySelector<HTMLElement>('[data-param="q"] .eq-param-scrubber');

    if (freqEl) freqEl.textContent = this.formatFrequency(band.frequency);
    if (gainEl && band.type !== 'highpass' && band.type !== 'lowpass') {
      gainEl.textContent = this.formatGain(band.gain);
    }
    if (qEl && band.type !== 'lowshelf' && band.type !== 'highshelf') {
      qEl.textContent = band.q.toFixed(2);
    }
  }

  private startInlineScrubberEdit(scrubberEl: HTMLElement, bandId: number, param: 'frequency' | 'gain' | 'q'): void {
    if (!this.currentTarget) return;
    const config = getChannelEqConfig(this.currentTarget.channelId, this.currentTarget.slotIndex);
    const band = config.bands.find((b) => b.id === bandId);
    if (!band) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'eq-param-inline-input';
    input.value = param === 'frequency'
      ? String(Math.round(band.frequency))
      : param === 'gain'
      ? band.gain.toFixed(1)
      : band.q.toFixed(2);

    let committed = false;
    const commit = () => {
      if (committed) return;
      committed = true;
      const raw = parseFloat(input.value);
      if (!isNaN(raw)) {
        let val = raw;
        if (param === 'frequency') val = Math.max(20, Math.min(20000, val));
        else if (param === 'gain') val = Math.max(-24, Math.min(24, val));
        else if (param === 'q') val = Math.max(0.1, Math.min(10.0, val));
        this.updateBandValue(bandId, param, val);
      }
      this.renderBandControls();
    };

    input.addEventListener('keydown', (ke) => {
      if (ke.key === 'Enter') {
        ke.preventDefault();
        commit();
      } else if (ke.key === 'Escape') {
        ke.preventDefault();
        committed = true;
        this.renderBandControls();
      }
    });
    input.addEventListener('blur', commit);

    scrubberEl.replaceWith(input);
    input.focus();
    input.select();
  }

  private toggleBandEnabled(bandId: number): void {
    if (!this.currentTarget) return;
    const config = getChannelEqConfig(this.currentTarget.channelId, this.currentTarget.slotIndex);
    const band = config.bands.find((b) => b.id === bandId);
    if (!band) return;

    band.enabled = !band.enabled;
    setChannelEqConfig(this.currentTarget.channelId, this.currentTarget.slotIndex, config);

    if (this.currentTarget.dsp) {
      this.currentTarget.dsp.setBandEnabled(bandId, band.enabled);
    }
    this.currentTarget.onConfigChange();
    this.renderBandControls();
  }

  private updateBandValue(bandId: number, param: 'frequency' | 'gain' | 'q', value: number): void {
    if (!this.currentTarget) return;
    const config = getChannelEqConfig(this.currentTarget.channelId, this.currentTarget.slotIndex);
    const band = config.bands.find((b) => b.id === bandId);
    if (!band) return;

    if (param === 'frequency') band.frequency = Math.max(20, Math.min(20000, value));
    else if (param === 'gain') band.gain = Math.max(-24, Math.min(24, value));
    else if (param === 'q') band.q = Math.max(0.1, Math.min(10.0, value));

    setChannelEqConfig(this.currentTarget.channelId, this.currentTarget.slotIndex, config);

    if (this.currentTarget.dsp) {
      this.currentTarget.dsp.updateBandParam(bandId, { [param]: band[param] }, false);
    }
    this.currentTarget.onConfigChange();
  }

  private formatFrequency(hz: number): string {
    if (hz >= 1000) {
      const khz = hz / 1000;
      return khz >= 10 ? `${khz.toFixed(1)} kHz` : `${khz.toFixed(2)} kHz`;
    }
    return `${Math.round(hz)} Hz`;
  }

  private formatGain(db: number): string {
    const rounded = Math.round(db * 10) / 10;
    if (rounded > 0) return `+${rounded.toFixed(1)} dB`;
    return `${rounded.toFixed(1)} dB`;
  }

  private bindEvents(): void {
    if (!this.modalEl || !this.canvasEl) return;

    // Close button & backdrop
    this.modalEl.querySelector('#btn-close-channel-eq')?.addEventListener('click', () => this.close());
    this.modalEl.addEventListener('click', (e) => {
      if (e.target === this.modalEl) this.close();
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen()) {
        this.close();
      }
    });

    // Global Bypass Button
    this.modalEl.querySelector('#btn-eq-global-bypass')?.addEventListener('click', () => {
      if (!this.currentTarget) return;
      const config = getChannelEqConfig(this.currentTarget.channelId, this.currentTarget.slotIndex);
      config.globalBypass = !config.globalBypass;
      setChannelEqConfig(this.currentTarget.channelId, this.currentTarget.slotIndex, config);

      if (this.currentTarget.dsp) {
        this.currentTarget.dsp.setGlobalBypass(config.globalBypass);
      }
      this.currentTarget.onConfigChange();
      this.updateHeaderVisuals();
    });

    // Flat Reset Button (True Flat: disables HP & LP cuts, sets shelf/bell gains to 0 dB, enables bands 2-6)
    this.modalEl.querySelector('#btn-eq-flat')?.addEventListener('click', () => {
      if (!this.currentTarget) return;
      const config = getChannelEqConfig(this.currentTarget.channelId, this.currentTarget.slotIndex);
      config.globalBypass = false;
      config.bands.forEach((b) => {
        if (b.type === 'highpass' || b.type === 'lowpass') {
          b.enabled = false;
        } else {
          b.enabled = true;
          b.gain = 0.0;
        }
      });
      setChannelEqConfig(this.currentTarget.channelId, this.currentTarget.slotIndex, config);

      if (this.currentTarget.dsp) {
        this.currentTarget.dsp.setGlobalBypass(false);
        config.bands.forEach((b) => {
          this.currentTarget!.dsp!.setBandEnabled(b.id, b.enabled);
          if (b.type !== 'highpass' && b.type !== 'lowpass') {
            this.currentTarget!.dsp!.updateBandParam(b.id, { gain: 0.0 }, true);
          }
        });
      }
      this.currentTarget.onConfigChange();
      this.updateHeaderVisuals();
      this.renderBandControls();
    });

    // RTA Toggle Button
    this.modalEl.querySelector('#btn-eq-rta-toggle')?.addEventListener('click', () => {
      this.rtaEnabled = !this.rtaEnabled;
      this.updateHeaderVisuals();
    });

    // Canvas Direct Graph Dragging & Wheel Interaction
    const canvas = this.canvasEl;
    const readoutPill = this.modalEl.querySelector<HTMLElement>('#channel-eq-readout-pill');

    const updateReadoutPill = (band: ChannelEqBandConfig, clientX: number, clientY: number) => {
      if (!readoutPill) return;
      const bandColor = BAND_COLORS[band.id] || '#38bdf8';
      const hasGain = band.type !== 'highpass' && band.type !== 'lowpass';
      const hasQ = band.type !== 'lowshelf' && band.type !== 'highshelf';
      readoutPill.innerHTML = `
        <span style="color: ${bandColor}; font-weight: 700;">Band ${band.id} (${BAND_TYPE_NAMES[band.type]})</span> &bull; 
        <span>${this.formatFrequency(band.frequency)}</span>
        ${hasGain ? ` &bull; <span>${this.formatGain(band.gain)}</span>` : ''}
        ${hasQ ? ` &bull; <span>Q ${band.q.toFixed(2)}</span>` : ''}
      `;
      const rect = canvas.getBoundingClientRect();
      const left = Math.max(10, Math.min(rect.width - 240, clientX - rect.left - 120));
      const top = Math.max(10, Math.min(rect.height - 40, clientY - rect.top - 46));
      readoutPill.style.left = `${left}px`;
      readoutPill.style.top = `${top}px`;
      readoutPill.classList.remove('hidden');
    };

    const hideReadoutPill = () => {
      if (readoutPill) readoutPill.classList.add('hidden');
    };

    const getPointerBandHandle = (e: PointerEvent): ChannelEqBandConfig | null => {
      if (!this.currentTarget) return null;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const width = rect.width;
      const height = rect.height;

      const config = getChannelEqConfig(this.currentTarget.channelId, this.currentTarget.slotIndex);
      const HANDLE_RADIUS = 16;

      for (let i = config.bands.length - 1; i >= 0; i--) {
        const band = config.bands[i]!;
        const hx = this.freqToX(band.frequency, width);
        const hy = (band.type === 'highpass' || band.type === 'lowpass')
          ? this.dbToY(0, height)
          : this.dbToY(band.gain, height);

        const dist = Math.hypot(x - hx, y - hy);
        if (dist <= HANDLE_RADIUS) {
          return band;
        }
      }
      return null;
    };

    canvas.addEventListener('pointermove', (e) => {
      if (this.isDragging) return;
      const targetBand = getPointerBandHandle(e);
      if (targetBand) {
        this.hoveredBandId = targetBand.id;
        canvas.style.cursor = targetBand.type === 'highpass' || targetBand.type === 'lowpass' ? 'ew-resize' : 'move';
      } else {
        this.hoveredBandId = null;
        canvas.style.cursor = 'default';
      }
    });

    canvas.addEventListener('pointerdown', (e) => {
      if (!this.currentTarget) return;
      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;

      const targetBand = getPointerBandHandle(e);
      if (targetBand) {
        this.isDragging = true;
        this.dragBandId = targetBand.id;
        this.selectedBandId = targetBand.id;
        canvas.setPointerCapture(e.pointerId);
        updateReadoutPill(targetBand, e.clientX, e.clientY);
        this.renderBandControls();
      } else {
        // Clicking on canvas selects the closest band
        const x = e.clientX - rect.left;
        const clickedFreq = this.xToFreq(x, width);
        const config = getChannelEqConfig(this.currentTarget.channelId, this.currentTarget.slotIndex);

        let closestBand = config.bands[0]!;
        let minDiff = Math.abs(Math.log10(clickedFreq) - Math.log10(closestBand.frequency));

        for (const b of config.bands) {
          const diff = Math.abs(Math.log10(clickedFreq) - Math.log10(b.frequency));
          if (diff < minDiff) {
            minDiff = diff;
            closestBand = b;
          }
        }

        this.selectedBandId = closestBand.id;
        this.renderBandControls();
      }

      const onGraphPointerMove = (me: PointerEvent) => {
        if (!this.isDragging || !this.currentTarget || !this.dragBandId) return;
        const config = getChannelEqConfig(this.currentTarget.channelId, this.currentTarget.slotIndex);
        const band = config.bands.find((b) => b.id === this.dragBandId);
        if (!band) return;

        const mx = me.clientX - rect.left;
        const my = me.clientY - rect.top;

        const newFreq = this.xToFreq(mx, width);
        band.frequency = Math.max(20, Math.min(20000, newFreq));

        if (band.type !== 'highpass' && band.type !== 'lowpass') {
          const newDb = this.yToDb(my, height);
          band.gain = Math.max(-24, Math.min(24, Math.round(newDb * 10) / 10));
        }

        setChannelEqConfig(this.currentTarget.channelId, this.currentTarget.slotIndex, config);

        if (this.currentTarget.dsp) {
          this.currentTarget.dsp.updateBandParam(band.id, { frequency: band.frequency, gain: band.gain }, false);
        }
        this.currentTarget.onConfigChange();
        updateReadoutPill(band, me.clientX, me.clientY);
        this.renderBandControls();
      };

      const onGraphPointerUp = (me: PointerEvent) => {
        this.isDragging = false;
        this.dragBandId = null;
        hideReadoutPill();
        try { canvas.releasePointerCapture(me.pointerId); } catch {}
        canvas.removeEventListener('pointermove', onGraphPointerMove);
        canvas.removeEventListener('pointerup', onGraphPointerUp);
        canvas.removeEventListener('pointercancel', onGraphPointerUp);
      };

      canvas.addEventListener('pointermove', onGraphPointerMove);
      canvas.addEventListener('pointerup', onGraphPointerUp);
      canvas.addEventListener('pointercancel', onGraphPointerUp);
    });

    // Mouse wheel over graph adjusts Q of selected band (only for HP, Bell, and LP bands)
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!this.currentTarget) return;
      const config = getChannelEqConfig(this.currentTarget.channelId, this.currentTarget.slotIndex);
      const band = config.bands.find((b) => b.id === this.selectedBandId);
      if (!band || band.type === 'lowshelf' || band.type === 'highshelf') return;

      const delta = e.deltaY < 0 ? 0.08 : -0.08;
      band.q = Math.max(0.1, Math.min(10.0, Math.round((band.q + delta) * 100) / 100));

      setChannelEqConfig(this.currentTarget.channelId, this.currentTarget.slotIndex, config);

      if (this.currentTarget.dsp) {
        this.currentTarget.dsp.updateBandParam(band.id, { q: band.q }, false);
      }
      this.currentTarget.onConfigChange();
      updateReadoutPill(band, e.clientX, e.clientY);
      this.renderBandControls();

      // Fade out pill after 1 second of wheel inactivity
      setTimeout(() => {
        if (!this.isDragging) hideReadoutPill();
      }, 1200);
    }, { passive: false });

    // Double click resets selected band gain
    canvas.addEventListener('dblclick', (e) => {
      const targetBand = getPointerBandHandle(e);
      if (targetBand && targetBand.type !== 'highpass' && targetBand.type !== 'lowpass') {
        targetBand.gain = 0.0;
        if (this.currentTarget) {
          const config = getChannelEqConfig(this.currentTarget.channelId, this.currentTarget.slotIndex);
          setChannelEqConfig(this.currentTarget.channelId, this.currentTarget.slotIndex, config);
          if (this.currentTarget.dsp) {
            this.currentTarget.dsp.updateBandParam(targetBand.id, { gain: 0.0 }, true);
          }
          this.currentTarget.onConfigChange();
          this.renderBandControls();
        }
      }
    });
  }

  private showModal(): void {
    if (!this.modalEl) return;
    this.modalEl.classList.remove('hidden');
  }

  private startVisualizer(): void {
    this.stopVisualizer();
    const renderFrame = () => {
      this.draw();
      if (this.isOpen()) {
        this.animFrameId = requestAnimationFrame(renderFrame);
      }
    };
    this.animFrameId = requestAnimationFrame(renderFrame);
  }

  private stopVisualizer(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  private draw(): void {
    if (!this.canvasEl || !this.ctx || !this.currentTarget) return;
    const canvas = this.canvasEl;
    const ctx = this.ctx;

    // Handle high-DPI retina display resolution
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = rect.width;
    const height = rect.height;

    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    // 1. Draw Background Grid
    this.drawGrid(ctx, width, height);

    // 2. Draw Real-Time Spectrum Analyzer (RTA)
    if (this.rtaEnabled && this.currentTarget.dsp) {
      this.drawSpectrum(ctx, width, height);
    }

    // 3. Draw DSP-Accurate Frequency Response Curve
    this.drawResponseCurve(ctx, width, height);

    // 4. Draw Interactive 7-Band Handles
    this.drawBandHandles(ctx, width, height);

    ctx.restore();
  }

  private drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.lineWidth = 1;
    ctx.font = '10px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    // Horizontal dB lines (+24, +18, +12, +6, 0, -6, -12, -18, -24)
    const dbLines = [24, 18, 12, 6, 0, -6, -12, -18, -24];
    dbLines.forEach((db) => {
      const y = Math.round(this.dbToY(db, height)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);

      if (db === 0) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
        ctx.lineWidth = 1.5;
      } else {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
        ctx.lineWidth = 1;
      }
      ctx.stroke();

      // Right-aligned dB label
      ctx.save();
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = db === 0 ? '#cbd5e1' : '#64748b';
      ctx.fillText(`${db > 0 ? `+${db}` : db}`, width - 8, y);
      ctx.restore();
    });

    // Vertical Frequency lines (20 Hz - 20 kHz log scale)
    const majorFreqs = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    const minorFreqs = [30, 40, 60, 70, 80, 90, 300, 400, 600, 700, 800, 900, 3000, 4000, 6000, 7000, 8000, 9000];

    // Minor lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    minorFreqs.forEach((f) => {
      const x = Math.round(this.freqToX(f, width)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    });

    // Major lines with text
    majorFreqs.forEach((f) => {
      const x = Math.round(this.freqToX(f, width)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height - 16);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 1;
      ctx.stroke();

      const label = f >= 1000 ? `${f / 1000}k` : `${f}`;
      ctx.fillStyle = '#64748b';
      ctx.fillText(label, x, height - 4);
    });
  }

  private drawSpectrum(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    if (!this.currentTarget?.dsp) return;

    this.currentTarget.dsp.getAnalyserByteFrequencyData(this.rtaBuffer);
    const bufferLen = this.rtaBuffer.length;
    const sampleRate = this.currentTarget.dsp.audioCtx.sampleRate || 48000;
    const nyquist = sampleRate / 2;

    ctx.beginPath();
    let hasDrawnFirst = false;

    for (let i = 0; i < this.NUM_POINTS; i += 2) {
      const freq = this.freqs[i]!;
      if (freq > nyquist) break;

      const binIndex = Math.round((freq / nyquist) * bufferLen);
      const byteVal = this.rtaBuffer[Math.min(bufferLen - 1, binIndex)] || 0;
      const normalized = byteVal / 255; // 0 to 1

      // Map normalized amplitude to height (0 = bottom, 1 = top - 10)
      const x = this.freqToX(freq, width);
      const y = height - (normalized * (height * 0.85));

      if (!hasDrawnFirst) {
        ctx.moveTo(x, y);
        hasDrawnFirst = true;
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();

    const spectrumGrad = ctx.createLinearGradient(0, 0, 0, height);
    spectrumGrad.addColorStop(0, 'rgba(56, 189, 248, 0.18)');
    spectrumGrad.addColorStop(0.7, 'rgba(56, 189, 248, 0.06)');
    spectrumGrad.addColorStop(1, 'rgba(56, 189, 248, 0.0)');
    ctx.fillStyle = spectrumGrad;
    ctx.fill();
  }

  private drawResponseCurve(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    if (!this.currentTarget) return;

    if (this.currentTarget.dsp) {
      this.currentTarget.dsp.getCombinedFrequencyResponse(this.freqs, this.dbCurve);
    } else {
      this.dbCurve.fill(0);
    }

    const config = getChannelEqConfig(this.currentTarget.channelId, this.currentTarget.slotIndex);
    const isBypassed = config.globalBypass;
    const zeroY = this.dbToY(0, height);

    // 1. Shaded Area Under the Curve to 0 dB Line
    ctx.beginPath();
    ctx.moveTo(this.freqToX(this.freqs[0]!, width), zeroY);

    for (let i = 0; i < this.NUM_POINTS; i++) {
      const x = this.freqToX(this.freqs[i]!, width);
      const y = this.dbToY(this.dbCurve[i]!, height);
      ctx.lineTo(x, y);
    }

    ctx.lineTo(this.freqToX(this.freqs[this.NUM_POINTS - 1]!, width), zeroY);
    ctx.closePath();

    const fillGrad = ctx.createLinearGradient(0, 0, 0, height);
    if (isBypassed) {
      fillGrad.addColorStop(0, 'rgba(148, 163, 184, 0.05)');
      fillGrad.addColorStop(1, 'rgba(148, 163, 184, 0.0)');
    } else {
      fillGrad.addColorStop(0, 'rgba(56, 189, 248, 0.16)');
      fillGrad.addColorStop(0.5, 'rgba(56, 189, 248, 0.08)');
      fillGrad.addColorStop(1, 'rgba(56, 189, 248, 0.02)');
    }
    ctx.fillStyle = fillGrad;
    ctx.fill();

    // 2. Crisp Precision Stroke (Restrained DAW curve without decorative blur)
    ctx.beginPath();
    for (let i = 0; i < this.NUM_POINTS; i++) {
      const x = this.freqToX(this.freqs[i]!, width);
      const y = this.dbToY(this.dbCurve[i]!, height);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    if (isBypassed) {
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
    } else {
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawBandHandles(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    if (!this.currentTarget) return;
    const config = getChannelEqConfig(this.currentTarget.channelId, this.currentTarget.slotIndex);

    config.bands.forEach((band) => {
      const x = this.freqToX(band.frequency, width);
      const y = (band.type === 'highpass' || band.type === 'lowpass')
        ? this.dbToY(0, height)
        : this.dbToY(band.gain, height);

      const isSelected = band.id === this.selectedBandId;
      const isHovered = band.id === this.hoveredBandId;
      const bandColor = BAND_COLORS[band.id] || '#38bdf8';
      const radius = isSelected ? 12 : isHovered ? 11 : 9;

      // Selection Ring
      if (isSelected) {
        ctx.beginPath();
        ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Main Handle Circle
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);

      if (band.enabled) {
        ctx.fillStyle = bandColor;
      } else {
        ctx.fillStyle = '#475569';
      }
      ctx.fill();

      ctx.lineWidth = 1.5;
      ctx.strokeStyle = isSelected ? '#ffffff' : 'rgba(0, 0, 0, 0.8)';
      ctx.stroke();

      // Band Number
      ctx.font = 'bold 9.5px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(band.id), x, y + 0.5);
    });
  }
}

export const channelEqPluginModal = new ChannelEqPluginModal();

export function openChannelEqPlugin(
  channelId: string,
  slotIndex: number,
  channelName: string,
  channelColor: string,
  dspGetter: () => ChannelEqDspInstance | undefined,
  onConfigChange: () => void
): void {
  channelEqPluginModal.open(channelId, slotIndex, channelName, channelColor, dspGetter, onConfigChange);
}
