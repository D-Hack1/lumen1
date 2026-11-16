// Owner: Nived
// Pointing readouts: Earth range and one-way light time. Oracle: c = 299,792.458 km/s (exact by definition of the metre).
import { describe, expect, it } from 'vitest';
import { fmtLightTime, fmtRangeKm, lightTimeSeconds } from './format';

describe('Earth range and light time', () => {
  it('light time is range / c', () => {
    expect(lightTimeSeconds(299_792.458)).toBeCloseTo(1, 12);
    expect(lightTimeSeconds(384_400)).toBeCloseTo(1.28225, 4); // the textbook mean Earth-Moon light time
  });
  it('formats range with a thousands separator and light time to 0.01 s', () => {
    expect(fmtRangeKm(384_399.6)).toBe('384,400 km');
    expect(fmtLightTime(384_400)).toBe('1.28 s');
    expect(fmtLightTime(299_792.458)).toBe('1.00 s');
  });
  it('says "n/a", never NaN or 0, for a missing or non-physical range', () => {
    for (const bad of [0, -5, NaN, Infinity]) {
      expect(fmtRangeKm(bad)).toBe('n/a');
      expect(fmtLightTime(bad)).toBe('n/a');
    }
  });
});
