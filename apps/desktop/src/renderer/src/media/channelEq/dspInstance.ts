import type { ChannelEqBandConfig, ChannelEqConfig } from './types';
import { cloneChannelEqConfig, createDefaultChannelEqConfig } from './config';

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
