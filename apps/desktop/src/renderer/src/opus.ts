import type { AudioMode } from '@jameet/shared';

const POLICY: Record<AudioMode, Record<string, string>> = {
  talk: { stereo: '0', 'sprop-stereo': '0', maxaveragebitrate: '96000', maxplaybackrate: '48000', useinbandfec: '1', usedtx: '1' },
  music: { stereo: '1', 'sprop-stereo': '1', maxaveragebitrate: '256000', maxplaybackrate: '48000', useinbandfec: '1', usedtx: '0', cbr: '0' }
};

export function applyOpusPolicy(sdp: string, mode: AudioMode, customBitrate?: number): string {
  const newline = sdp.includes('\r\n') ? '\r\n' : '\n';
  const lines = sdp.split(/\r?\n/);
  const payloads = new Set<string>();
  for (const line of lines) {
    const match = line.match(/^a=rtpmap:(\d+)\s+opus\/48000\/2$/i);
    if (match?.[1]) payloads.add(match[1]);
  }
  if (!payloads.size) return sdp;

  const bitrate = customBitrate && mode === 'music' ? String(customBitrate) : (POLICY[mode].maxaveragebitrate ?? '256000');

  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    let handled = false;
    for (const payload of payloads) {
      if (line.startsWith(`a=fmtp:${payload} `)) {
        const existing = line.slice(line.indexOf(' ') + 1).split(';');
        const parameters = new Map<string, string>();
        for (const item of existing) {
          const [key, value] = item.trim().split('=', 2);
          if (key && value !== undefined) parameters.set(key, value);
        }
        for (const [key, value] of Object.entries(POLICY[mode])) {
          parameters.set(key, (key === 'maxaveragebitrate' ? bitrate : value) ?? '');
        }
        const updated = `a=fmtp:${payload} ${[...parameters].map(([key, value]) => `${key}=${value}`).join(';')}`;
        result.push(updated);
        handled = true;
        break;
      }
    }
    if (!handled) {
      result.push(line);
      for (const payload of payloads) {
        if (line.toLowerCase().startsWith(`a=rtpmap:${payload} `)) {
          const nextLine = lines[i + 1];
          if (!nextLine || !nextLine.startsWith(`a=fmtp:${payload} `)) {
            const parameters = new Map<string, string>();
            for (const [key, value] of Object.entries(POLICY[mode])) {
              parameters.set(key, (key === 'maxaveragebitrate' ? bitrate : value) ?? '');
            }
            const newLine = `a=fmtp:${payload} ${[...parameters].map(([key, value]) => `${key}=${value}`).join(';')}`;
            result.push(newLine);
          }
        }
      }
    }
  }
  return result.join(newline);
}
