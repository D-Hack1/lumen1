import { describe, expect, it } from 'vitest';
import { earthAppearance, visibleDiskFraction } from './lensGeometry';

describe('earthAppearance', () => {
  it('Sun behind Earth ⇒ new Earth; Sun opposite ⇒ full; 90° ⇒ half', () => {
    expect(earthAppearance(10, 5, 10, 5, -90).litFraction).toBeCloseTo(0, 6);
    expect(earthAppearance(190, 5, 10, 5, -90).litFraction).toBeGreaterThan(0.9);
    expect(earthAppearance(100, 0, 10, 0, -90).litFraction).toBeCloseTo(0.5, 6);
  });
  it('a north-up image is upside-down (rotated ~π) from the lunar south pole', () => {
    const r = earthAppearance(120, 2, 40, 6, -89.9).imageRotation;
    expect(Math.abs(Math.cos(r))).toBeGreaterThan(0.99);
    expect(Math.cos(r)).toBeLessThan(0);
  });
  it('from the north pole it is upright', () => {
    expect(Math.cos(earthAppearance(120, 2, 40, 6, 89.9).imageRotation)).toBeGreaterThan(0.99);
  });
  it('bright limb faces the Sun: Sun to the right of Earth ⇒ sunAngle ≈ 0', () => {
    const a = earthAppearance(100, 6, 90, 6, -90).sunAngle;
    expect(Math.abs(a)).toBeLessThan(0.05);
  });
});

describe('visibleDiskFraction', () => {
  it('fully above, fully below, and half-clipped by a flat horizon', () => {
    expect(visibleDiskFraction(0, 0, 10, () => 50)).toBeCloseTo(1, 6);
    expect(visibleDiskFraction(0, 0, 10, () => -50)).toBeCloseTo(0, 6);
    expect(visibleDiskFraction(0, 0, 10, () => 0)).toBeCloseTo(0.5, 2);
  });
});
