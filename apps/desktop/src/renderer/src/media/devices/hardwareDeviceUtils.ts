export type HardwareAudioDeviceInfo = {
  id: number;
  name: string;
  uid: string;
  inputChannels: number;
  outputChannels: number;
  sampleRate: number;
  defaultInput: boolean;
  defaultOutput: boolean;
  inputChannelNames?: string[];
  outputChannelNames?: string[];
};

export type ChannelDropdownOption = {
  value: string;
  label: string;
  group?: string;
};

export function findHardwareDevice(
  deviceId: string | undefined,
  devices: MediaDeviceInfo[],
  cachedHardwareDevices: HardwareAudioDeviceInfo[]
): HardwareAudioDeviceInfo | undefined {
  if (!cachedHardwareDevices.length) return undefined;
  const mediaDevice = deviceId ? devices.find((d) => d.deviceId === deviceId) : undefined;
  if (!mediaDevice) {
    return cachedHardwareDevices.find((hw) => hw.defaultInput || hw.defaultOutput);
  }
  const label = (mediaDevice.label || '').toLowerCase();
  return cachedHardwareDevices.find((hw) =>
    (hw.uid && mediaDevice.deviceId && hw.uid === mediaDevice.deviceId) ||
    (hw.name && label && label.includes(hw.name.toLowerCase())) ||
    (hw.name && label && hw.name.toLowerCase().includes(label))
  );
}

export function formatDeviceDisplayName(rawName: string | undefined): string {
  if (!rawName) return 'Default Device';
  let name = rawName.trim();
  if (name === 'Universal Audio Thunderbolt' || name.toLowerCase().includes('uad2audioengine') || name.toLowerCase().includes('apollo')) {
    return 'Universal Audio Apollo';
  }
  if (name === 'BuiltInSpeakerDevice' || name === 'MacBook Pro Speakers') {
    return 'MacBook Pro Speakers';
  }
  if (name === 'BuiltInMicrophoneDevice' || name === 'MacBook Pro Microphone') {
    return 'MacBook Pro Microphone';
  }
  // Strip trailing device IDs, hex hashes, vendor IDs, and anything in parentheses like (5bc678), (05ac:8514), etc.
  name = name.replace(/\s*\([^)]*\)\s*$/g, '').trim();
  name = name.replace(/:\d+$/, '').replace(/_DeviceUID$/, '').trim();
  return name || rawName.trim();
}

export function formatOutputChannelName(rawName: string | undefined, chNumber: number): { name: string; isUnassigned: boolean } {
  if (!rawName || rawName.trim().length === 0) {
    return { name: `Output ${chNumber}`, isUnassigned: false };
  }
  const trimmed = rawName.trim();
  const lower = trimmed.toLowerCase();
  if (lower === 'none' || lower.startsWith('none (') || lower.startsWith('none(')) {
    return { name: `Output ${chNumber} (Unassigned)`, isUnassigned: true };
  }
  if (lower.startsWith('input ') || lower.startsWith('in ')) {
    return { name: `Output ${chNumber}`, isUnassigned: false };
  }
  return { name: trimmed, isUnassigned: false };
}

export function generateInputChannelOptions(channelCount: number, channelNames?: string[]): ChannelDropdownOption[] {
  const names = channelNames || [];

  if (channelCount <= 2) {
    const ch1Name = names[0] ? ` (${names[0]})` : '';
    const ch2Name = names[1] ? ` (${names[1]})` : '';
    return [
      { value: 'all', label: 'All Channels (Default Mix)', group: 'Hardware Mix' },
      { value: '1', label: `Input 1${ch1Name} (Mono)`, group: 'Discrete Inputs' },
      { value: '2', label: `Input 2${ch2Name} (Mono)`, group: 'Discrete Inputs' },
      { value: '1-2', label: 'Inputs 1 & 2 (Stereo L/R)', group: 'Stereo Pairs' }
    ];
  }

  const options: ChannelDropdownOption[] = [];
  const discrete: ChannelDropdownOption[] = [];
  const pairs: ChannelDropdownOption[] = [];

  // Discrete Inputs
  for (let ch = 1; ch <= channelCount; ch++) {
    const rawName = names[ch - 1] || `Input ${ch}`;
    const isNone = rawName.toLowerCase().includes('none');
    if (isNone) continue;
    discrete.push({
      value: String(ch),
      label: `Input ${ch} (${rawName})`,
      group: 'Discrete Inputs'
    });
  }

  // Stereo Pairs
  for (let ch = 1; ch < channelCount; ch += 2) {
    const lName = names[ch - 1] || `In ${ch}`;
    const rName = names[ch] || `In ${ch + 1}`;
    const isNone = lName.toLowerCase().includes('none') && rName.toLowerCase().includes('none');
    if (isNone) continue;
    pairs.push({
      value: `${ch}-${ch + 1}`,
      label: `Inputs ${ch} & ${ch + 1} (${lName} / ${rName})`,
      group: 'Stereo Input Pairs'
    });
  }

  options.push(...pairs);
  options.push(...discrete);
  options.push({
    value: 'all',
    label: `All ${channelCount} Channels (Hardware Mix)`,
    group: 'Hardware Mix'
  });

  return options;
}

export function generateOutputChannelOptions(channelCount: number, channelNames?: string[]): ChannelDropdownOption[] {
  const names = channelNames || [];

  if (channelCount <= 2) {
    const lInfo = formatOutputChannelName(names[0], 1);
    const rInfo = formatOutputChannelName(names[1], 2);
    const hasNamed = names[0] && names[1] && names[0].trim().length > 0 && names[1].trim().length > 0 && !lInfo.isUnassigned && !rInfo.isUnassigned;
    const pairLabel = hasNamed ? `${lInfo.name} / ${rInfo.name}` : 'Outputs 1 & 2 (Main Stereo)';
    return [
      { value: '1-2', label: pairLabel, group: 'Stereo Output Pairs' },
      { value: '1', label: `${lInfo.name} (Output 1 · Left)`, group: 'Discrete Outputs' },
      { value: '2', label: `${rInfo.name} (Output 2 · Right)`, group: 'Discrete Outputs' },
      { value: 'all', label: 'All Active Outputs (Hardware Master Mix)', group: 'Hardware Sum' }
    ];
  }

  const options: ChannelDropdownOption[] = [];
  const stereoPairs: ChannelDropdownOption[] = [];
  const discreteMono: ChannelDropdownOption[] = [];

  // 1. Stereo Pairs (Primary)
  for (let ch = 1; ch < channelCount; ch += 2) {
    const lInfo = formatOutputChannelName(names[ch - 1], ch);
    const rInfo = formatOutputChannelName(names[ch], ch + 1);

    // Hide unassigned / NONE pairs from primary list by default
    if (lInfo.isUnassigned && rInfo.isUnassigned) {
      continue;
    }

    const pairLabel = `${lInfo.name} / ${rInfo.name}`;
    stereoPairs.push({
      value: `${ch}-${ch + 1}`,
      label: pairLabel,
      group: 'Stereo Output Pairs'
    });
  }

  if (stereoPairs.length === 0) {
    stereoPairs.push({
      value: '1-2',
      label: 'Outputs 1 & 2 (Main Stereo)',
      group: 'Stereo Output Pairs'
    });
  }

  // 2. Discrete Mono Outputs (Secondary / Advanced)
  for (let ch = 1; ch <= channelCount; ch++) {
    const info = formatOutputChannelName(names[ch - 1], ch);
    if (info.isUnassigned) {
      continue;
    }
    discreteMono.push({
      value: String(ch),
      label: info.name,
      group: 'Discrete Mono Outputs'
    });
  }

  options.push(...stereoPairs);
  options.push(...discreteMono);

  // 3. Hardware Sum / Master
  options.push({
    value: 'all',
    label: `All Active Outputs (Hardware Master Mix)`,
    group: 'Hardware Sum'
  });

  return options;
}
