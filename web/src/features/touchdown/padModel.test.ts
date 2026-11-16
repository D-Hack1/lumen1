import { describe, expect, it } from 'vitest';
import { panelFaces } from './padModel';

const flat = { slopeDeg: 0, downhillAzDeg: 0, tiltMagDeg: 0, tiltDirDeg: 0, yawDeg: 0 };

describe('panelFaces', () => {
  it('flat ground matches its own baseline and sums to the engine total', () => {
    const f = panelFaces('fourSide', flat, 30, 20, 100);
    f.forEach((p) => expect(p.watts).toBeCloseTo(p.baselineWatts, 9));
    expect(f.reduce((a, p) => a + p.baselineWatts, 0)).toBeCloseTo(100, 6);
  });
  it('Sun below the horizon gives zero everywhere', () => {
    expect(panelFaces('fourSide', flat, 30, -2, 100).every((p) => p.watts === 0)).toBe(true);
  });
  it('leaning the lander away from the Sun lifts the sun-facing side toward it', () => {
    const base = panelFaces('fourSide', flat, 0, 10, 100); // Sun due north, low
    const tilted = panelFaces('fourSide', { ...flat, tiltMagDeg: 15, tiltDirDeg: 180 }, 0, 10, 100);
    const north = (r: typeof base) => r.reduce((m, p) => Math.max(m, p.watts), 0);
    expect(north(tilted)).toBeGreaterThan(north(base));
  });
  it('tracking mast is at least as good as any fixed preset at the same instant', () => {
    const t = panelFaces('trackingMast', flat, 40, 25, 100)[0].watts;
    expect(t).toBeCloseTo(100, 6);
  });
});
