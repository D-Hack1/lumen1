// Owner: Nived
// DSN visibility on the Moon-elevation series (data_dsn.md: geometric Moon-centre elevation at DSS-14 Goldstone, DSS-43 Canberra, DSS-63 Madrid,
// 10-minute nodes, 0.5 deg quantised). The DSN-aware link (PLAN_FINAL: default ON) is "Earth visible AND >= 1 complex sees the Moon at or above
// its mask (default 10 deg)". Elevation moves ~15 deg/h, so between nodes it is interpolated linearly; outside the series nothing is known,
// so the answer is "not up" (an unknown is never reported as a link).
import type { DsnSeries } from '../data/dsn';

/** Moon elevation (deg) at every station at `tMs`, linearly interpolated; null outside [first node, last node]. */
export function dsnElevationsAt(dsn: DsnSeries, tMs: number): number[] | null {
  const x = (tMs - dsn.startMs) / dsn.cadenceMs;
  if (!(x >= 0) || x > dsn.count - 1) return null;
  const k = Math.min(Math.floor(x), dsn.count - 2);
  const f = x - k;
  return dsn.stations.map((_, s) => (f === 0 ? dsn.elevDeg(s, k) : (1 - f) * dsn.elevDeg(s, k) + f * dsn.elevDeg(s, k + 1)));
}

/** Which complexes see the Moon at or above `maskDeg` (all false outside the series). */
export function dsnStationsUp(dsn: DsnSeries, tMs: number, maskDeg: number): boolean[] {
  const e = dsnElevationsAt(dsn, tMs);
  return dsn.stations.map((_, s) => e != null && e[s] >= maskDeg);
}

/** At least one complex sees the Moon at or above `maskDeg`. */
export function dsnLinkUp(dsn: DsnSeries, tMs: number, maskDeg: number): boolean {
  // Allocation-free (called for every sample of every evaluation); same rule as dsnElevationsAt + dsnStationsUp.
  const x = (tMs - dsn.startMs) / dsn.cadenceMs;
  if (!(x >= 0) || x > dsn.count - 1) return false;
  const k = Math.min(Math.floor(x), dsn.count - 2);
  const f = x - k;
  for (let s = 0; s < dsn.stations.length; s++) {
    if ((f === 0 ? dsn.elevDeg(s, k) : (1 - f) * dsn.elevDeg(s, k) + f * dsn.elevDeg(s, k + 1)) >= maskDeg) return true;
  }
  return false;
}
