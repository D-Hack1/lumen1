// Owner: Abhinav
// Worst-case content fixture (FRONTEND_BUILD_GUIDE §5.1), loaded only with `?fixture=worst-case`.
// Stand-in content only for MY slots that are not built yet (Slot applies it to status 'later' only).
// Phase 3: the Site Explorer and Definitions Bar are live — the fixture now feeds them real worst-case data
// (`sites`: 30 cards; scenario: Educator copy + ISRO preset chip) instead of stand-in markup.
// Teammate slots render their real components; their worst-case strings (No sunrise before window end (+60 d),
// grazing ranges, 9-row Windows Table, 30 Scan rows…) must arrive through Nived's forced-state mock engine.
// The fixture scenario (Educator, 60 d, 4 Compare rows, ISRO preset, slip +30 d) still applies to every slot.
// Phase 4: Scenario rows, Mission Profile and Profile & Battery are live — they get worst-case data (4 rows, longest
// site names, global slip +30 d with row C at −12 d, tilted rows, "selected row" slip mode) instead of stand-ins.
import type { Fixture } from '../layout/fixture';
import type { SiteCategory, SiteRecord, Tier } from '../../engine/types';
import { customPointRecord } from '../../features/sidebar/siteModel';
import { DEFAULT_LANDING_UTC, type CompareRow } from '../../state/scenarioStore';
import './worstCase.css';

export const LONG_SITE =
  'Shackleton–de Gerlache connecting ridge · Artemis III candidate region “Nobile Rim 2” (as published 2024-10-28)';
const DAY = 86_400_000;

// ---- Site Explorer worst case: 30 cards, every category + agency + tier, longest names, both coordinate pairs,
// touchdown at minute and second precision, "as published" with and without a date. Ids `<real id>~<n>` reuse the
// real site's sparkline (Sidebar strips `~n`).
type SiteSeed = [
  id: string,
  name: string,
  cat: SiteCategory,
  agency: string | null,
  lat: number,
  lon: number,
  tier: Tier,
];
const SEEDS: SiteSeed[] = [
  ['cy3_shiv_shakti', 'Chandrayaan-3 Statio Shiv Shakti', 'historical_landing', 'ISRO', -69.373, 32.319, 'A'],
  [
    'im2_athena',
    'IM-2 Athena (Mons Mouton) — tipped inside a crater, last contact 2025-03-07 06:15 UTC',
    'historical_landing',
    'NASA / Intuitive Machines',
    -84.7906,
    29.1957,
    'A',
  ],
  ['shackleton_ridge', LONG_SITE, 'published_target', 'NASA', -89.45, -137.31, 'A'],
  [
    'blue_ghost_m1',
    'Blue Ghost Mission 1 (Mare Crisium, near Mons Latreille) — target centre, landed within 100 m',
    'historical_landing',
    'Firefly Aerospace',
    18.56,
    61.81,
    'C',
  ],
  [
    'artemis_r1',
    'Artemis III candidate region “Peak near Shackleton” (approximate centre)',
    'artemis_candidate_region',
    'NASA',
    -89.2,
    129.2,
    'B',
  ],
  [
    'artemis_r2',
    'Artemis III candidate region “Connecting Ridge Extension”',
    'artemis_candidate_region',
    'NASA',
    -89.0,
    -80.0,
    'B',
  ],
  ['artemis_r3', 'Artemis III candidate region “Malapert Massif”', 'artemis_candidate_region', 'NASA', -86.0, 2.8, 'B'],
  [
    'chang_e4',
    'Chang’e-4 Statio Tianhe (far side — Earth never visible)',
    'contrast_site',
    'CNSA',
    45.4446,
    177.5991,
    'C',
  ],
  ['chang_e6', 'Chang’e-6 (Apollo basin, far side)', 'historical_landing', 'CNSA', -41.6385, -153.9852, 'C'],
  ['slim', 'SLIM (Shioli crater) — landed nose-down', 'historical_landing', 'JAXA', -13.316, 25.251, 'C'],
  ['apollo11', 'Apollo 11 Tranquility Base', 'contrast_site', 'NASA', 0.67416, 23.47314, 'C'],
  [
    'chang_e7',
    'Chang’e-7 published target (rim of Shackleton, as reported in the site paper)',
    'published_target',
    'CNSA',
    -88.8,
    123.4,
    'pending',
  ],
];
const pick = <T,>(i: number, xs: readonly T[]) => xs[i % xs.length];
const fxSites: SiteRecord[] = Array.from({ length: 30 }, (_, i) => {
  const [id, name, category, agency, lat, lon, tier] = SEEDS[i % SEEDS.length];
  const base = customPointRecord({ lat, lon });
  const cy3 = id === 'cy3_shiv_shakti';
  return {
    ...base,
    id: i < SEEDS.length ? id : `${id}~${i}`,
    name: i < SEEDS.length ? name : `${name} · variant ${i + 1}`,
    category,
    agency,
    tier,
    targetCoords: cy3 ? { lat: -69.367621, lon: 32.348126, source: 'PRL, Current Science' } : null,
    touchdownUtc: category === 'historical_landing' ? Date.UTC(2023, 7, 23, 12, 33, i % 2 ? 0 : 17) : null,
    touchdownPrecision: category === 'historical_landing' ? pick(i, ['minute', 'second'] as const) : null,
    asPublishedDate: category === 'published_target' && i % 2 === 0 ? '2024-10-28' : null,
    sigmaSource: 'default',
    mock: i % 5 === 4,
  };
});

const rowsAD: CompareRow[] = (['A', 'B', 'C', 'D'] as const).map((id, i) => ({
  id,
  site: { kind: 'site', id: ['shackleton_ridge', 'im2_athena', 'cy3_shiv_shakti', 'blue_ghost_m1'][i] },
  landingUtc: DEFAULT_LANDING_UTC + i * 9 * DAY,
  slipDays: i === 2 ? -12 : 0,
  panelPreset: 'fourSide',
  yawDeg: null,
  tilt: { magnitudeDeg: i * 10, directionDeg: 90 },
  heightM: 2,
  baseline: i === 0,
}));

export const worstCaseFixture: Fixture = {
  name: 'worst-case',
  scenario: {
    persona: 'educator',
    durationDays: 60,
    definitionsPreset: 'isroVikramOps',
    definitions: {
      sunDiskThresholdPct: 50,
      earthMarginDeg: 1,
      dteDiskThresholdPct: 50,
      dsnMode: 'dsnAware',
      dsnMaskDeg: 10,
      minSunElevationOps: 6,
    },
    compareRows: rowsAD,
    compareSelected: 'C',
    compareSlipTarget: 'selected',
    slipDays: 30,
  },
  sites: fxSites,
  missionBar: { siteLabel: LONG_SITE, tierLabel: 'Tier B · snap 1.8 km', verdict: 'MARGINAL', provisional: true },
  slots: {
    methodology: (
      <div className="fx-pad fx-stack">
        {Array.from({ length: 40 }, (_, i) => (
          <p key={i} className="fx-faint">
            §{i + 1} Lorem-free placeholder paragraph for the reading view — this container is whitelisted to scroll
            internally, so long content here must never scroll the page.
          </p>
        ))}
      </div>
    ),
  },
};
