// Owner: Nived
// First-pass, geometry-only metrics (Python twin: reference/metrics.py). Anything that needs terrain-sigma, DSN, power or
// the PSR raster stays null, never a made-up number. Bounds are null until the three-pass uncertainty (N-6) exists.
import type { Bounded } from '../types';

const bounded = (value: number | null): Bounded => ({ value, lo: null, hi: null });

export function longestFalseRunHours(times: ArrayLike<number>, values: ArrayLike<boolean>): number {
  let longest = 0;
  let start: number | null = null;
  for (let i = 0; i < values.length; i++) {
    if (!values[i] && start === null) start = times[i];
    if (start !== null && (values[i] || i === values.length - 1)) {
      longest = Math.max(longest, (times[i] - start) / 3_600_000);
      start = null;
    }
  }
  return longest;
}

export interface FirstPassInput {
  times: ArrayLike<number>;
  sunVisible: ArrayLike<boolean>;
  earthVisible: ArrayLike<boolean>;
  sunElevationDeg: ArrayLike<number>;
  earthElevationDeg: ArrayLike<number>;
  sunClearanceDeg: ArrayLike<number>;
  earthClearanceDeg: ArrayLike<number>;
  sunDiskFraction: ArrayLike<number>;
}

export interface FirstPassMetrics {
  sunElevationDeg: Bounded;
  sunClearanceDeg: Bounded;
  sunDiskPct: Bounded;
  earthElevationDeg: Bounded;
  dteMarginDeg: Bounded;
  sunlitPct: Bounded;
  earthVisiblePct: Bounded;
  linkPct: Bounded;
  longestNightH: Bounded;
  longestCommGapH: Bounded;
  opsHours: Bounded;
  energyPerDayWh: Bounded;
  sunElevationAtTouchdownDeg: Bounded;
}

export function firstPassMetrics(x: FirstPassInput): FirstPassMetrics {
  const n = x.times.length;
  const duration = x.times[n - 1] - x.times[0];
  if (!(duration > 0)) throw new RangeError('metric range must have positive duration');
  let sunMs = 0;
  let earthMs = 0;
  for (let i = 0; i < n - 1; i++) {
    const dt = x.times[i + 1] - x.times[i];
    if (x.sunVisible[i]) sunMs += dt;
    if (x.earthVisible[i]) earthMs += dt;
  }
  return {
    sunElevationDeg: bounded(x.sunElevationDeg[0]),
    sunClearanceDeg: bounded(x.sunClearanceDeg[0]),
    sunDiskPct: bounded(100 * x.sunDiskFraction[0]),
    earthElevationDeg: bounded(x.earthElevationDeg[0]),
    dteMarginDeg: bounded(x.earthClearanceDeg[0]),
    sunlitPct: bounded((100 * sunMs) / duration),
    earthVisiblePct: bounded((100 * earthMs) / duration),
    linkPct: bounded(null),
    longestNightH: bounded(longestFalseRunHours(x.times, x.sunVisible)),
    longestCommGapH: bounded(null),
    opsHours: bounded(null),
    energyPerDayWh: bounded(null),
    sunElevationAtTouchdownDeg: bounded(x.sunElevationDeg[0]),
  };
}
