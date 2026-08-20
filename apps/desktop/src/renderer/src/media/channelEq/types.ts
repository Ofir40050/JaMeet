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
