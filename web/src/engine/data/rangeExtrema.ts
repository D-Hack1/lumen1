// Owner: Nived
// Finite-only min/max segment tree over azimuth bins (data_masks.md §5.3 `range_extrema`).
// One tree per height. Queries use half-open bin ranges [start, end); a range crossing bin 0 is split in two.
// NaN (unavailable) bins are ignored; if every bin in the range is NaN, both results are NaN.

export interface Extrema {
  min: number;
  max: number;
}

export class RangeExtrema {
  private readonly n: number;
  private readonly size: number;
  private readonly mn: Float32Array;
  private readonly mx: Float32Array;

  /** @param values one height's elevations (length = bin count), NaN allowed. */
  constructor(values: Float32Array) {
    this.n = values.length;
    let size = 1;
    while (size < this.n) size <<= 1;
    this.size = size;
    this.mn = new Float32Array(2 * size).fill(Infinity);
    this.mx = new Float32Array(2 * size).fill(-Infinity);
    for (let i = 0; i < this.n; i++) {
      const v = values[i];
      if (Number.isFinite(v)) {
        this.mn[size + i] = v;
        this.mx[size + i] = v;
      }
    }
    for (let i = size - 1; i >= 1; i--) {
      this.mn[i] = Math.min(this.mn[2 * i], this.mn[2 * i + 1]);
      this.mx[i] = Math.max(this.mx[2 * i], this.mx[2 * i + 1]);
    }
  }

  /** Extrema over bins [start, end), 0 <= start <= end <= n. */
  private span(start: number, end: number, acc: { min: number; max: number }): void {
    let l = start + this.size;
    let r = end + this.size;
    while (l < r) {
      if (l & 1) {
        acc.min = Math.min(acc.min, this.mn[l]);
        acc.max = Math.max(acc.max, this.mx[l]);
        l++;
      }
      if (r & 1) {
        r--;
        acc.min = Math.min(acc.min, this.mn[r]);
        acc.max = Math.max(acc.max, this.mx[r]);
      }
      l >>= 1;
      r >>= 1;
    }
  }

  /** Circular query over half-open bin range [start, end) where end may exceed n (wraps) or be < start (wraps). */
  queryBins(start: number, end: number): Extrema {
    const n = this.n;
    const acc = { min: Infinity, max: -Infinity };
    const len = end >= start ? end - start : end + n - start;
    if (len >= n) {
      this.span(0, n, acc);
    } else if (len > 0) {
      const s = ((start % n) + n) % n;
      const e = s + len;
      if (e <= n) {
        this.span(s, e, acc);
      } else {
        this.span(s, n, acc);
        this.span(0, e - n, acc);
      }
    }
    return acc.min === Infinity ? { min: NaN, max: NaN } : { min: acc.min, max: acc.max };
  }

  /**
   * Query by azimuth interval [azLo, azHi] in degrees (any real numbers, azHi >= azLo; width >= 360 covers everything).
   * Returns extrema over every bin that overlaps the interval, so the result is conservative (never narrower than the
   * true interval). Bin i covers [i*w, (i+1)*w).
   */
  queryAzimuth(azLoDeg: number, azHiDeg: number, binWidthDeg: number): Extrema {
    if (azHiDeg - azLoDeg >= 360) return this.queryBins(0, this.n);
    const start = Math.floor(azLoDeg / binWidthDeg);
    const end = Math.floor(azHiDeg / binWidthDeg) + 1; // inclusive of the bin containing azHi
    return this.queryBins(start, end);
  }
}
