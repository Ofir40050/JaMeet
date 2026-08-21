import type { ChannelEqBandType } from './types';

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
