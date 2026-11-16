// Owner: Ebin
// What the Pointing & Link tab shows at the scrub time: nearest series sample, clamped to the series.
import type { Series } from '../../engine/types';

export function sampleAt(series: Series, t: number) {
  const i = Math.max(0, Math.min(series.sunElevDeg.length - 1, Math.round((t - series.t0) / series.stepMs)));
  return {
    sunElevDeg: series.sunElevDeg[i],
    sunAzDeg: series.sunAzDeg[i],
    earthElevDeg: series.earthElevDeg[i],
    earthAzDeg: series.earthAzDeg[i],
    earthDiskPct: series.earthDiskPct[i],
    earthRangeKm: series.earthRangeKm[i],
    linkUp: series.linkUp[i],
  };
}
