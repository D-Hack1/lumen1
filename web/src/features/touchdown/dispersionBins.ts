// Owner: Ebin
// Slope binning for the Dispersion Histogram (pure, so the component file only exports a component).
// Counts only — percentiles and the share under the limit come from Nived's `summariseDispersion` so the histogram,
// the pad badge and the engine all quote the same numbers from the same loaded grid.
export function binSlopes(slopesDeg: ArrayLike<number>, binWidthDeg: number): number[] {
  let max = 0;
  for (let i = 0; i < slopesDeg.length; i++) if (slopesDeg[i] > max) max = slopesDeg[i];
  const counts = new Array<number>(Math.max(1, Math.floor(max / binWidthDeg) + 1)).fill(0);
  for (let i = 0; i < slopesDeg.length; i++) counts[Math.floor(slopesDeg[i] / binWidthDeg)]++;
  return counts;
}
