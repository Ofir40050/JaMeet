import { logger } from '../../core/logger';
import { getChannelEqConfig, setChannelEqConfig } from '../audio/eq/channelEq';
import {
  type PersistentStudioMixerMap,
  type StudioMixerChannel,
  serializeStudioMixerConfig
} from './studioMixerLogic';

export const STUDIO_MIXER_STORAGE_KEY = 'jameet-studio-mixer-config';

export function loadSavedStudioMixerConfig(): PersistentStudioMixerMap {
  try {
    const raw = localStorage.getItem(STUDIO_MIXER_STORAGE_KEY) ?? localStorage.getItem('musiczoom-studio-mixer-config');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as PersistentStudioMixerMap;
    }
  } catch (err) {
    logger.warn('mixer_storage', 'Failed to load persistent studio mixer configuration', {}, err);
  }
  return {};
}

export function hydrateStudioMixerEqPersistence(): void {
  const map = loadSavedStudioMixerConfig();
  for (const [channelId, chData] of Object.entries(map)) {
    if (chData && chData.eq && typeof chData.eq === 'object') {
      for (const [slotStr, eqConf] of Object.entries(chData.eq)) {
        const slotIdx = parseInt(slotStr, 10);
        if (!isNaN(slotIdx) && eqConf && Array.isArray(eqConf.bands)) {
          setChannelEqConfig(channelId, slotIdx, eqConf);
        }
      }
    }
  }
}

let mixerSaveDebounceTimer: ReturnType<typeof setTimeout> | null = null;

export function saveStudioMixerConfig(
  channels: StudioMixerChannel[],
  immediate = true
): void {
  if (!immediate) {
    if (mixerSaveDebounceTimer) clearTimeout(mixerSaveDebounceTimer);
    mixerSaveDebounceTimer = setTimeout(() => {
      mixerSaveDebounceTimer = null;
      saveStudioMixerConfig(channels, true);
    }, 300);
    return;
  }
  if (mixerSaveDebounceTimer) {
    clearTimeout(mixerSaveDebounceTimer);
    mixerSaveDebounceTimer = null;
  }
  try {
    const savedPrev = loadSavedStudioMixerConfig();
    const map = {
      ...savedPrev,
      ...serializeStudioMixerConfig(channels, (chId, slot) => getChannelEqConfig(chId, slot))
    };
    localStorage.setItem(STUDIO_MIXER_STORAGE_KEY, JSON.stringify(map));
  } catch (err) {
    logger.warn('mixer_storage', 'Failed to save persistent studio mixer configuration', {}, err);
  }
}
