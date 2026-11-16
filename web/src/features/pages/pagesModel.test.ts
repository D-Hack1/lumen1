// Owner: Abhinav
import { describe, expect, it } from 'vitest';
import { SITES } from '../orbit/orbitModel';
import {
  azToX,
  bestSlip,
  compassPoint,
  fmtDuration,
  fmtPoints,
  horizonPath,
  skyTrack,
  slipWindows,
  windowStats,
  xToAz,
} from './pagesModel';

const im2 = SITES[0];
const shack = SITES[1];

describe('pages model', () => {
  it('keeps window percentages within 0–100 and dark stretch within the window', () => {
    for (const s of SITES) {
      const w = windowStats(s, 2);
      for (const v of [w.sun, w.earth, w.dsn]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
      expect(w.dark).toBeGreaterThanOrEqual(0);
      expect(w.dark).toBeLessThanOrEqual(336);
    }
  });

  it('gives the connecting ridge more sunlight than a rim in shade, and a taller mast never hurts', () => {
    expect(windowStats(shack, 2).sun).toBeGreaterThan(windowStats(SITES[3], 2).sun);
    expect(windowStats(im2, 10).sun).toBeGreaterThanOrEqual(windowStats(im2, 0).sun);
  });

  it('produces one window per slip day and a best day inside the range', () => {
    const wins = slipWindows(im2, 2);
    expect(wins).toHaveLength(28);
    const best = bestSlip(wins);
    expect(best).toBeGreaterThanOrEqual(0);
    expect(best).toBeLessThan(28);
    expect(wins[best].sun).toBeGreaterThanOrEqual(Math.max(...wins.map((w) => w.sun)) - 0.05);
  });

  it('formats durations and deltas', () => {
    expect(fmtDuration(30)).toBe('1 d 6 h');
    expect(fmtDuration(5)).toBe('5 h');
    expect(fmtPoints(50, 50)).toBe('Same as on time');
    expect(fmtPoints(60, 50)).toBe('+10 points vs on time');
    expect(fmtPoints(40, 50)).toBe('-10 points vs on time');
  });

  it('maps azimuth to panorama x and back, and names compass points', () => {
    expect(azToX(180)).toBe(500);
    expect(xToAz(250)).toBe(90);
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(359)).toBe('N');
    expect(compassPoint(135)).toBe('SE');
  });

  it('builds closed horizon paths and broken sky tracks', () => {
    expect(horizonPath(im2, 2).startsWith('M0 300')).toBe(true);
    expect(horizonPath(im2, 2).endsWith('Z')).toBe(true);
    expect(skyTrack('sun', im2, 2).split('M').length).toBeGreaterThan(1);
  });
});
