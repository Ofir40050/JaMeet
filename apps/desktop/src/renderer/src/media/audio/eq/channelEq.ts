/**
 * JaMeet Built-in Channel EQ Plugin System
 *
 * 7-Band professional DAW EQ with AudioContext-isolated DSP instances,
 * true dry/wet global bypass, continuous AudioParam smoothing,
 * exact BiquadFilterNode.getFrequencyResponse curve measurement,
 * on-demand live spectrum analysis, and interactive plugin GUI.
 */

export type {
  ChannelEqBandType,
  ChannelEqBandConfig,
  ChannelEqConfig
} from './types';

export {
  BAND_TYPE_NAMES,
  BAND_COLORS
} from './constants';

export {
  createDefaultChannelEqConfig,
  cloneChannelEqConfig,
  getChannelEqConfig,
  setChannelEqConfig,
  removeChannelEqConfig,
  exportAllChannelEqConfigs,
  importAllChannelEqConfigs
} from './config';

export { ChannelEqDspInstance } from './dspInstance';

export {
  ChannelEqDspRegistry,
  channelEqDspRegistry
} from './registry';

export {
  ChannelEqPluginModal,
  channelEqPluginModal,
  openChannelEqPlugin
} from './modalUi';
