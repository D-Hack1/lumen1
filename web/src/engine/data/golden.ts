// Owner: Nived
// Loader: golden/golden_set{1,2}.json (envelope written by pipeline/validation/golden.py: version, set, tolerances, provenance,
// cases[]). The case body is kept opaque here; core.parity.test.ts reads set 1 directly. Tests skip while `cases` is empty.
import { fetchJson } from './source';

export interface GoldenSet {
  set: 1 | 2;
  cases: unknown[];
  /** Real names from golden.py: azimuth_deg, elevation_deg, event_time_s, metric_percent. */
  tolerances: { azimuth_deg?: number; elevation_deg?: number; event_time_s?: number; metric_percent?: number };
  empty: boolean;
  mock: boolean;
}

export async function loadGolden(set: 1 | 2): Promise<GoldenSet> {
  const j = await fetchJson<{ cases?: unknown[]; tolerances?: GoldenSet['tolerances']; mock?: boolean }>(`golden/golden_set${set}.json`, [1, '1', '1.0.0']);
  const cases = Array.isArray(j.cases) ? j.cases : [];
  return { set, cases, tolerances: j.tolerances ?? {}, empty: cases.length === 0, mock: j.mock === true };
}
