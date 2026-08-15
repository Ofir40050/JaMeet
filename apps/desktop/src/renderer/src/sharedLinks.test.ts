import { describe, expect, it } from 'vitest';
import { normalizeMeetingCode, meetingCodeSchema } from '@jameet/shared';

describe('Shared Session Links', () => {
  it('extracts and normalizes valid session code from deep link URL', () => {
    const rawUrl = 'musiczoom://join/ABCDEFGH';
    const normalized = normalizeMeetingCode(rawUrl);
    expect(normalized).toBe('ABCDEFGH');
    expect(meetingCodeSchema.safeParse(normalized).success).toBe(true);
  });

  it('extracts and normalizes lowercase session code from deep link URL', () => {
    const rawUrl = 'musiczoom://join/k7m9pq2w';
    const normalized = normalizeMeetingCode(rawUrl);
    expect(normalized).toBe('K7M9PQ2W');
    expect(meetingCodeSchema.safeParse(normalized).success).toBe(true);
  });

  it('rejects invalid or malformed deep link codes', () => {
    const badCode = normalizeMeetingCode('musiczoom://join/too-short');
    expect(meetingCodeSchema.safeParse(badCode).success).toBe(false);

    const empty = normalizeMeetingCode('musiczoom://join/');
    expect(meetingCodeSchema.safeParse(empty).success).toBe(false);
  });

  it('constructs a clean unauthenticated shareable link format', () => {
    const sessionCode = '7H9K2M4P';
    const shareLink = `jameet://join/${sessionCode}`;
    expect(shareLink).toBe('jameet://join/7H9K2M4P');
    expect(normalizeMeetingCode(shareLink)).toBe(sessionCode);
    expect(shareLink).not.toContain('token');
    expect(shareLink).not.toContain('auth');
  });
});
