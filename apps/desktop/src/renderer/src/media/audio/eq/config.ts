import type { ChannelEqConfig } from './types';

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
