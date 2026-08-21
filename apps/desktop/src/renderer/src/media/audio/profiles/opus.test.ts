import { describe, expect, it } from 'vitest';
import { applyOpusPolicy } from './opus';

const SDP = [
  'v=0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 0',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'm=video 9 UDP/TLS/RTP/SAVPF 96',
  'a=rtpmap:96 VP8/90000'
].join('\r\n');

const MULTI_AUDIO_SDP = [
  'v=0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=10;useinbandfec=1'
].join('\r\n');

describe('Opus SDP policy', () => {
  it('adds high quality stereo Music Mode parameters without changing video', () => {
    const result = applyOpusPolicy(SDP, 'music');
    expect(result).toContain('minptime=10');
    expect(result).toContain('stereo=1');
    expect(result).toContain('sprop-stereo=1');
    expect(result).toContain('maxaveragebitrate=256000');
    expect(result).toContain('usedtx=0');
    expect(result).toContain('a=rtpmap:96 VP8/90000');
  });

  it('uses mono DTX settings for Talk Mode', () => {
    const result = applyOpusPolicy(SDP, 'talk');
    expect(result).toContain('stereo=0');
    expect(result).toContain('maxaveragebitrate=96000');
    expect(result).toContain('usedtx=1');
  });

  it('updates all bundled audio m-lines consistently', () => {
    const result = applyOpusPolicy(MULTI_AUDIO_SDP, 'music');
    const matches = result.match(/maxaveragebitrate=256000/g);
    expect(matches?.length).toBe(2);
  });

  it('supports custom high-definition bitrates up to 510 kbps', () => {
    const result = applyOpusPolicy(SDP, 'music', 510000);
    expect(result).toContain('maxaveragebitrate=510000');
  });

  it('leaves SDP without Opus untouched', () => {
    const value = 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96';
    expect(applyOpusPolicy(value, 'music')).toBe(value);
  });
});
