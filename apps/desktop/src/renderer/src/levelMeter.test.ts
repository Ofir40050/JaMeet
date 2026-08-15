import { describe, expect, it } from 'vitest';
import { samplesToLevel } from './levelMeter';

describe('level meter calculations', () => {
  it('reports silence at the meter floor', () => {
    expect(samplesToLevel(new Float32Array(128)).rmsDb).toBe(-60);
  });
  it('reports RMS, peak hold, and clipping', () => {
    const reading = samplesToLevel(new Float32Array([1, -1, 0, 0]), -12);
    expect(reading.rmsDb).toBeCloseTo(-3.01, 1);
    expect(reading.peakDb).toBe(0);
    expect(reading.heldPeakDb).toBe(0);
    expect(reading.clipping).toBe(true);
  });
});
