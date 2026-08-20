import { getChannelEqConfig } from './config';
import { ChannelEqDspInstance } from './dspInstance';

/**
 * ChannelEqDspRegistry
 * Tracks live AudioContext-isolated DSP instances.
 */
export class ChannelEqDspRegistry {
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
