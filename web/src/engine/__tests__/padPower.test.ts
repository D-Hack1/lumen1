// Owner: Nived
// Seam: core/padPower.ts - what the Touchdown Pad and Power curve show: generation of the configured panels on the actual (sloped, tilted,
// yawed) pad vs the flat-ground baseline, per face and in total, from the Sun's az/el. Built on Gowri's power.py twin (parity-tested separately).
// Oracles are hand-computed trigonometry, not this code: W = S0 * (A * eta) * cos(angle of incidence) * disk, S0 = 1361 W/m2 at 1 AU.
// Panel physics are NOT defined by R3: ASSUMED_PANEL is a declared placeholder (1 m2, eta 1) so the numbers are "W per m2 of panel aperture".
import { describe, expect, it } from 'vitest';
import { AU_KM } from '../core/constants';
import { ASSUMED_PANEL, energyPerDayWh, generationAt, groundNormalFromPad, powerSeries, type PowerConfig, type SunSample } from '../core/padPower';

const S0 = 1361;
const sin = (d: number) => Math.sin((d * Math.PI) / 180);
const cos = (d: number) => Math.cos((d * Math.PI) / 180);
const cfg = (o: Partial<PowerConfig> = {}): PowerConfig => ({ preset: 'horizontalDeck', yawDeg: 0, tiltMagDeg: 0, tiltDirDeg: 0, groundNormal: null, ...ASSUMED_PANEL, ...o });
const sun = (azimuthDeg: number, elevationDeg: number, diskFraction = 1): SunSample => ({ azimuthDeg, elevationDeg, distanceKm: AU_KM, diskFraction });

describe('generationAt', () => {
  it('flat deck: S0 * sin(elevation)', () => {
    expect(generationAt(cfg(), sun(0, 30)).watts).toBeCloseTo(S0 * sin(30), 9);
  });
  it('is zero when the Sun disk is fully hidden, whatever the geometry', () => {
    for (const preset of ['fourSide', 'singleHeading', 'horizontalDeck', 'trackingMast'] as const) expect(generationAt(cfg({ preset }), sun(90, 5, 0)).watts).toBe(0);
  });
  it('scales with the visible disk fraction', () => {
    expect(generationAt(cfg(), sun(0, 30, 0.5)).watts).toBeCloseTo(0.5 * S0 * sin(30), 9);
  });
  it('a 10 deg slope tilted toward the Sun (downhill 180, Sun due south at 30 deg): S0 * sin(40 deg)', () => {
    const ground = groundNormalFromPad(10, 180);
    expect(generationAt(cfg({ groundNormal: ground }), sun(180, 30)).watts).toBeCloseTo(S0 * sin(40), 9);
    // the same slope with the Sun on the uphill side: S0 * sin(20 deg)
    expect(generationAt(cfg({ groundNormal: ground }), sun(0, 30)).watts).toBeCloseTo(S0 * sin(20), 9);
  });
  it('the flat-ground baseline ignores the slope but keeps the controls', () => {
    const r = generationAt(cfg({ groundNormal: groundNormalFromPad(10, 180) }), sun(180, 30));
    expect(r.flatWatts).toBeCloseTo(S0 * sin(30), 9);
    expect(generationAt(cfg(), sun(180, 30)).flatWatts).toBeCloseTo(generationAt(cfg(), sun(180, 30)).watts, 12);
  });
  it('four-side: only the face turned toward the Sun produces: Sun due east at 30 deg => S0 * cos(30 deg), split per face', () => {
    const r = generationAt(cfg({ preset: 'fourSide' }), sun(90, 30));
    expect(r.watts).toBeCloseTo(S0 * cos(30), 9);
    expect(r.faces.length).toBe(4);
    expect(r.faces[1].watts).toBeCloseTo(S0 * cos(30), 9); // face 1 = east (heading 90)
    expect(r.faces[0].watts).toBeCloseTo(0, 9);
    expect(r.faces[3].watts).toBe(0);
  });
  it('tracking mast turns to the Sun azimuth each sample: S0 * cos(elevation)', () => {
    for (const az of [0, 77, 200, 359]) expect(generationAt(cfg({ preset: 'trackingMast' }), sun(az, 30)).watts).toBeCloseTo(S0 * cos(30), 9);
  });
  it('single heading faces north (heading 0): Sun due north at 20 deg => S0 * cos(20); a fixed yaw of 90 turns it east', () => {
    expect(generationAt(cfg({ preset: 'singleHeading' }), sun(0, 20)).watts).toBeCloseTo(S0 * cos(20), 9);
    expect(generationAt(cfg({ preset: 'singleHeading' }), sun(90, 20)).watts).toBeCloseTo(0, 9);
    expect(generationAt(cfg({ preset: 'singleHeading', yawDeg: 90 }), sun(90, 20)).watts).toBeCloseTo(S0 * cos(20), 9);
  });
  it('yaw "auto" (null) picks the best 15 deg yaw, so it is never worse than any fixed yaw and reports the yaw it chose', () => {
    const auto = generationAt(cfg({ preset: 'singleHeading', yawDeg: null }), sun(90, 20));
    expect(auto.watts).toBeCloseTo(S0 * cos(20), 9);
    expect(auto.yawDeg).toBe(90);
    for (const yaw of [0, 45, 135, 200]) expect(auto.watts).toBeGreaterThanOrEqual(generationAt(cfg({ preset: 'singleHeading', yawDeg: yaw }), sun(90, 20)).watts - 1e-9);
  });
  it('off-nominal tilt: a deck tilted 30 deg toward east (dir 90) with the Sun due east at 60 deg faces it head-on: S0', () => {
    expect(generationAt(cfg({ tiltMagDeg: 30, tiltDirDeg: 90 }), sun(90, 60)).watts).toBeCloseTo(S0, 9);
  });
  it('face watts add up to the total', () => {
    const r = generationAt(cfg({ preset: 'fourSide', groundNormal: groundNormalFromPad(8, 40), tiltMagDeg: 10, tiltDirDeg: 200 }), sun(120, 12, 0.8));
    expect(r.faces.reduce((a, f) => a + f.watts, 0)).toBeCloseTo(r.watts, 9);
  });
  it('panel area and efficiency scale it linearly (they are explicit inputs, not hidden constants)', () => {
    expect(generationAt(cfg({ panelAreaM2: 3, efficiency: 0.2 }), sun(0, 30)).watts).toBeCloseTo(0.6 * S0 * sin(30), 9);
  });
});

describe('groundNormalFromPad', () => {
  it('flat pad -> straight up; the normal tilts toward the downhill azimuth', () => {
    expect(groundNormalFromPad(0, 123)).toEqual([0, 0, 1]);
    const n = groundNormalFromPad(10, 90);
    expect(n[0]).toBeCloseTo(sin(10), 12);
    expect(n[1]).toBeCloseTo(0, 12);
    expect(n[2]).toBeCloseTo(cos(10), 12);
    expect(Math.hypot(...n)).toBeCloseTo(1, 12);
  });
});

describe('powerSeries (the fast path) equals generationAt sample by sample', () => {
  it('every preset, with and without auto yaw, slope, tilt, partial disks, and a Sun just below the horizon', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const samples: SunSample[] = Array.from({ length: 300 }, () => ({ azimuthDeg: rnd() * 360, elevationDeg: -2 + rnd() * 10, distanceKm: AU_KM * (0.98 + rnd() * 0.04), diskFraction: rnd() < 0.2 ? 0 : rnd() }));
    for (const preset of ['fourSide', 'singleHeading', 'horizontalDeck', 'trackingMast'] as const) {
      for (const yawDeg of [null, 0, 135]) {
        const c = cfg({ preset, yawDeg, groundNormal: groundNormalFromPad(9, 200), tiltMagDeg: 12, tiltDirDeg: 300, panelAreaM2: 2, efficiency: 0.3 });
        const fast = powerSeries(c, samples);
        samples.forEach((s, i) => {
          const r = s.diskFraction > 0 ? generationAt(c, s) : { watts: 0, flatWatts: 0 };
          expect(Math.abs(fast.powerW[i] - r.watts), `${preset} yaw ${yawDeg} #${i}`).toBeLessThanOrEqual(1e-3 + 1e-6 * r.watts); // float32 storage
          expect(Math.abs(fast.flatW[i] - r.flatWatts)).toBeLessThanOrEqual(1e-3 + 1e-6 * r.flatWatts);
        });
      }
    }
  });
});

describe('powerSeries and energyPerDayWh', () => {
  it('builds actual and flat series on the same grid', () => {
    const samples = [sun(180, 30), sun(180, 0, 0), sun(180, 30)];
    const s = powerSeries(cfg({ groundNormal: groundNormalFromPad(10, 180) }), samples);
    expect(s.powerW.length).toBe(3);
    expect(s.powerW[0]).toBeCloseTo(S0 * sin(40), 3);
    expect(s.flatW[0]).toBeCloseTo(S0 * sin(30), 3);
    expect(s.powerW[1]).toBe(0);
  });
  it('energy per day = mean power * 24 h (constant 100 W over 14 days at a 2 minute step = 2400 Wh/day)', () => {
    const n = 14 * 720 + 1;
    expect(energyPerDayWh(new Float32Array(n).fill(100), 120_000)).toBeCloseTo(2400, 6);
  });
  it('null for fewer than two samples', () => {
    expect(energyPerDayWh(new Float32Array(1), 120_000)).toBeNull();
  });
});
