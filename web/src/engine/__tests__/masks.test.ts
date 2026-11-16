// Owner: Nived
// Mask / sigma loaders against the contract (data_masks.md v1.0.0) using the mock files.
import { beforeAll, describe, expect, it } from 'vitest';
import { RangeExtrema } from '../data/rangeExtrema';
import { loadMask, parseMask } from '../data/masks';
import { loadSigma, parseSigma, checkSigmaMatchesMask } from '../data/sigma';
import { parseLumenHeader } from '../data/lumenBinary';
import { readMock, stubFetch } from './helpers';

beforeAll(() => stubFetch());

const clone = (b: ArrayBuffer) => b.slice(0);

describe('RangeExtrema', () => {
  it('matches brute force, ignores NaN, and wraps through zero', () => {
    const n = 3600;
    const v = new Float32Array(n);
    for (let i = 0; i < n; i++) v[i] = Math.sin(i / 37) * 3 + (i % 11) * 0.1;
    for (const i of [0, 1, 3598, 3599, 1500]) v[i] = NaN;
    const t = new RangeExtrema(v);
    const brute = (s: number, len: number) => {
      let mn = Infinity, mx = -Infinity;
      for (let k = 0; k < len; k++) {
        const x = v[(s + k) % n];
        if (Number.isFinite(x)) { mn = Math.min(mn, x); mx = Math.max(mx, x); }
      }
      return mn === Infinity ? { min: NaN, max: NaN } : { min: mn, max: mx };
    };
    for (const [s, len] of [[0, 10], [3590, 20], [3598, 4], [100, 2000], [3599, 3600], [1499, 3]] as const) {
      const got = t.queryBins(s, s + len);
      const exp = brute(s, len);
      if (Number.isNaN(exp.min)) expect(Number.isNaN(got.min)).toBe(true);
      else { expect(got.min).toBeCloseTo(exp.min, 5); expect(got.max).toBeCloseTo(exp.max, 5); }
    }
  });

  it('returns NaN when every bin in range is unavailable', () => {
    const v = new Float32Array(3600).fill(1);
    v.fill(NaN, 10, 20);
    const r = new RangeExtrema(v).queryBins(12, 18);
    expect(Number.isNaN(r.min) && Number.isNaN(r.max)).toBe(true);
  });

  it('azimuth query is conservative and wraps (359.9° → 0.2°)', () => {
    const v = new Float32Array(3600).fill(0);
    v[3599] = 5; // bin centred 359.95°
    v[2] = 7; // bin [0.2, 0.3)
    const t = new RangeExtrema(v);
    expect(t.queryAzimuth(359.92, 360.1, 0.1).max).toBe(5);
    expect(t.queryAzimuth(359.92, 360.25, 0.1).max).toBe(7);
    expect(t.queryAzimuth(-0.05, 0.05, 0.1).max).toBe(5); // negative az wraps
    expect(t.queryAzimuth(0, 400, 0.1).max).toBe(7); // >= 360° covers all
  });
});

describe('mask loader', () => {
  it('loads a mock Tier-A mask with contract shapes', async () => {
    const m = await loadMask('im2_athena');
    expect(m.elevDeg.length).toBe(4 * 3600);
    expect(m.distKm.length).toBe(4 * 3600);
    expect(m.meta.dMinM).toBe(3 * m.meta.nearFieldResolutionM);
    // sidecar global extrema agree with the payload (height 0)
    const r = m.range(0, 0, 360);
    expect(r.max).toBeCloseTo(m.meta.globalMaxDeg[0]!, 4);
    expect(r.min).toBeCloseTo(m.meta.globalMinDeg[0]!, 4);
  });

  it('preserves NaN and handles the range query across azimuth zero', async () => {
    const m = await loadMask('cy3_shiv_shakti');
    for (const bin of [3598, 3599, 0, 1]) expect(Number.isNaN(m.elevDeg[bin])).toBe(true); // never coerced to 0
    expect(Number.isNaN(m.elevDeg[2])).toBe(false);
    const r = m.range(0, 359.7, 360.5); // spans the NaN gap and finite bins on both sides of zero
    expect(Number.isFinite(r.min) && Number.isFinite(r.max)).toBe(true);
    const gapOnly = m.range(0, 359.82, 360.18); // bins 3598..3601 are all unavailable
    expect(Number.isNaN(gapOnly.min) && Number.isNaN(gapOnly.max)).toBe(true); // NaN, never 0
  });

  it('sigma is NaN exactly where the mask is, and checks pass', async () => {
    const [m, s] = [await loadMask('cy3_shiv_shakti'), await loadSigma('cy3_shiv_shakti')];
    expect(s.source).toBe('default');
    expect(s.cloneCount).toBeNull();
    expect(Number.isNaN(s.sigmaDeg[0])).toBe(true);
    expect(s.sigmaDeg[5]).toBeGreaterThan(0);
    expect(() => checkSigmaMatchesMask(m, s)).not.toThrow();
  });

  it('rejects malformed files rather than defaulting', async () => {
    const { buf, json } = await readMock('terrain/masks/im2_athena.bin').then(async (b) => ({
      buf: b.buf,
      json: (await readMock('terrain/masks/im2_athena.json')).json() as never,
    }));
    const ok = () => parseMask('im2_athena', clone(buf), { ...(json as object) } as never);
    expect(ok).not.toThrow();

    const badMagic = clone(buf);
    new Uint8Array(badMagic)[0] = 0x58;
    expect(() => parseMask('im2_athena', badMagic, json)).toThrow(/bad magic/);

    const badVer = clone(buf);
    new DataView(badVer).setUint16(8, 2, true);
    expect(() => parseMask('im2_athena', badVer, json)).toThrow(/format version/);

    const badRes = clone(buf);
    new DataView(badRes).setUint32(48, 1, true);
    expect(() => parseMask('im2_athena', badRes, json)).toThrow(/reserved/);

    expect(() => parseMask('im2_athena', buf.slice(0, 1000), json)).toThrow();
    expect(() => parseMask('im2_athena', clone(buf), { ...(json as object), version: '2.0.0' } as never)).toThrow(/version/);
    expect(() => parseMask('wrong_id', clone(buf), json)).toThrow(/site_id/);
    expect(() => parseMask('im2_athena', clone(buf), { ...(json as object), d_min_m: 1 } as never)).toThrow(/d_min_m/);

    const badDist = clone(buf);
    new DataView(badDist).setFloat32(57664, 999, true); // distance > 250 km
    expect(() => parseMask('im2_athena', badDist, json)).toThrow(/distance/);
  });

  it('sigma rules: clone_count and header', async () => {
    const bin = (await readMock('terrain/sigma/im2_athena.bin')).buf;
    const j = (await readMock('terrain/sigma/im2_athena.json')).json() as Record<string, unknown>;
    expect(() => parseSigma('im2_athena', clone(bin), { ...j, clone_count: 30 } as never)).toThrow(/forbidden/);
    expect(() => parseSigma('im2_athena', clone(bin), { ...j, source: 'monte_carlo' } as never)).toThrow(/clone_count/);
    expect(() => parseSigma('im2_athena', clone(bin), { ...j, source: 'monte_carlo', clone_count: 25 } as never)).not.toThrow();
    expect(() => parseSigma('im2_athena', clone(bin), { ...j, source: 'calibrated', notes: undefined } as never)).toThrow(/notes/);
    expect(() => parseLumenHeader('x', clone(bin), 'LUMENMSK')).toThrow(/bad magic/); // sigma file is not a mask
  });
});
