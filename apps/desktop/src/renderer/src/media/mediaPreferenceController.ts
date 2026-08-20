import type { PerformanceMode } from '@jameet/shared';
import type { Preferences } from '../core/preferences';

export function getMeterInterval(performanceMode: PerformanceMode): number {
  return performanceMode === 'low' ? 125 : performanceMode === 'quality' ? 40 : 66;
}

export function getEffectiveMusicBitrate(preferences: Pick<Preferences, 'musicBitrate' | 'performanceMode'>): number {
  const cap: Record<PerformanceMode, number> = { low: 192_000, balanced: 384_000, quality: 510_000 };
  return Math.min(preferences.musicBitrate, cap[preferences.performanceMode]);
}
