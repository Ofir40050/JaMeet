export type LevelReading = { rmsDb: number; peakDb: number; heldPeakDb: number; clipping: boolean };

export function samplesToLevel(samples: Float32Array, heldPeakDb = -60): LevelReading {
  let sum = 0;
  let peak = 0;
  for (const value of samples) { sum += value * value; peak = Math.max(peak, Math.abs(value)); }
  const rms = Math.sqrt(sum / Math.max(samples.length, 1));
  const rmsDb = Math.max(-60, 20 * Math.log10(Math.max(rms, 0.001)));
  const peakDb = Math.max(-60, 20 * Math.log10(Math.max(peak, 0.001)));
  return { rmsDb, peakDb, heldPeakDb: Math.max(peakDb, heldPeakDb - 0.7), clipping: peak >= 0.98 };
}

export class LevelMeter {
  private analyser?: AnalyserNode;
  private sourceNode?: AudioNode;
  private timer?: number;
  private heldPeakDb = -60;
  private lastUpdate = 0;
  private localContext?: AudioContext;

  async startFromNode(node: AudioNode, updateIntervalMs = 66, onLevel: (reading: LevelReading) => void): Promise<void> {
    await this.stop();
    const ctx = node.context;
    if (ctx.state === 'suspended' && 'resume' in ctx && typeof (ctx as AudioContext).resume === 'function') {
      await (ctx as AudioContext).resume().catch(() => {});
    }
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    try {
      node.connect(this.analyser);
      this.sourceNode = node;
    } catch (e) {
      console.warn('Failed to connect AudioNode to AnalyserNode:', e);
    }

    const samples = new Float32Array(this.analyser.fftSize);
    const update = () => {
      if (!this.analyser) return;
      this.lastUpdate = performance.now();
      this.analyser.getFloatTimeDomainData(samples);
      const reading = samplesToLevel(samples, this.heldPeakDb);
      this.heldPeakDb = reading.heldPeakDb;
      onLevel(reading);
      this.timer = window.setTimeout(update, updateIntervalMs);
    };
    update();
  }

  async start(track: MediaStreamTrack, onLevel: (reading: LevelReading) => void, updateIntervalMs = 66): Promise<void> {
    await this.stop();
    this.localContext = new AudioContext();
    await this.localContext.resume().catch(() => {});
    const source = this.localContext.createMediaStreamSource(new MediaStream([track]));
    await this.startFromNode(source, updateIntervalMs, onLevel);
  }

  async stop(): Promise<void> {
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = undefined;
    if (this.sourceNode && this.analyser) {
      try { this.sourceNode.disconnect(this.analyser); } catch {}
    }
    try { this.analyser?.disconnect(); } catch {}
    this.sourceNode = undefined;
    this.analyser = undefined;
    if (this.localContext && this.localContext.state !== 'closed') {
      await this.localContext.close().catch(() => {});
    }
    this.localContext = undefined;
    this.heldPeakDb = -60;
    this.lastUpdate = 0;
  }
}
