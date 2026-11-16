// Owner: Abhinav
// Slot registry: id → owner, component, budget, and whether the owner's stub is importable yet.
// `status`: 'stub'    = teammate stub exists and is imported (renders inside the slot)
//           'missing' = teammate file has no export yet → placeholder rendered in my layout (listed in report)
//           'later'   = my own component, built in a later phase (Phase N)
//           'live'    = built and wired
export type SlotId =
  | 'search'
  | 'map'
  | 'siteList'
  | 'answer'
  | 'definitions'
  | 'ribbon'
  | 'analysis'
  | 'barcode'
  | 'slip'
  | 'metricDeck'
  | 'touchdown'
  | 'profileBattery'
  | 'scenarioRows'
  | 'missionProfile'
  | 'compareSlip'
  | 'compareTabs'
  | 'compareVisual'
  | 'scan'
  | 'deltaTable'
  | 'compareWindows'
  | 'methodology';

export type Owner = 'Abhinav' | 'Ebin' | 'Nived';
export type SlotStatus = 'stub' | 'missing' | 'later' | 'live';

export interface SlotSpec {
  owner: Owner;
  /** Final component name + agreed import path (FRONTEND_BUILD_GUIDE §6 Phase 1 / WORK_DISTRIBUTION §5). */
  component: string;
  path: string;
  status: SlotStatus;
  /** Phase in which the real component lands (for 'later'). */
  phase?: number;
  /** Budget token in tokens.ts (slotBudget/sideBudget key); 'flex' = takes remaining height. */
  budget: string;
  /** Whitelisted internal scroll container (§4). */
  scroll?: boolean;
}

export const SLOTS: Record<SlotId, SlotSpec> = {
  // ---- Cockpit · left ----
  search: {
    owner: 'Abhinav',
    component: 'Search + FilterChips',
    path: 'features/sidebar',
    status: 'live',
    budget: 'search',
  },
  map: { owner: 'Nived', component: 'Basemap', path: 'features/map/Basemap', status: 'live', budget: 'map' },
  siteList: {
    owner: 'Abhinav',
    component: 'SiteCard list',
    path: 'features/sidebar/SiteCard',
    status: 'live',
    budget: 'flex',
    scroll: true,
  },
  // ---- Cockpit · centre ----
  answer: {
    owner: 'Nived',
    component: 'AnswerStrip',
    path: 'features/answer/AnswerStrip',
    status: 'live',
    budget: 'answer',
  },
  definitions: {
    owner: 'Abhinav',
    component: 'DefinitionsBar',
    path: 'features/definitions/DefinitionsBar',
    status: 'live',
    budget: 'definitions',
  },
  ribbon: {
    owner: 'Ebin',
    component: 'Ribbon',
    path: 'features/ribbon/Ribbon',
    status: 'stub',
    budget: 'ribbonMin',
  },
  analysis: {
    owner: 'Ebin',
    component: 'AnalysisPanel',
    path: 'features/analysis/AnalysisPanel',
    status: 'stub',
    budget: 'analysis',
  },
  barcode: {
    owner: 'Ebin',
    component: 'Barcode',
    path: 'features/barcode/Barcode',
    status: 'stub',
    budget: 'barcode',
  },
  slip: { owner: 'Ebin', component: 'SlipBar', path: 'features/barcode/SlipBar', status: 'stub', budget: 'slip' },
  // ---- Cockpit · right ----
  metricDeck: {
    owner: 'Nived',
    component: 'MetricDeck',
    path: 'features/metrics/MetricDeck',
    status: 'live',
    budget: 'metricDeck',
  },
  touchdown: {
    owner: 'Ebin',
    component: 'TouchdownPad',
    path: 'features/touchdown/TouchdownPad',
    status: 'stub',
    budget: 'flex',
  },
  profileBattery: {
    owner: 'Abhinav',
    component: 'ProfileBatteryAccordion',
    path: 'features/scenarios/ProfileBatteryAccordion',
    status: 'live',
    budget: 'accordionHeader',
  },
  // ---- Compare ----
  scenarioRows: {
    owner: 'Abhinav',
    component: 'ScenarioRows',
    path: 'features/scenarios/ScenarioRows',
    status: 'live',
    budget: 'compareRows',
  },
  missionProfile: {
    owner: 'Abhinav',
    component: 'MissionProfileForm',
    path: 'features/scenarios/MissionProfileForm',
    status: 'live',
    budget: 'flex',
  },
  compareSlip: {
    owner: 'Abhinav',
    component: 'CompareSlip (all rows | selected row)',
    path: 'features/scenarios/CompareSlip',
    status: 'live',
    budget: 'slip',
  },
  compareTabs: {
    owner: 'Abhinav',
    component: 'Centre toggle',
    path: 'app/views/CompareView',
    status: 'live',
    budget: 'compareTabs',
  },
  compareVisual: {
    owner: 'Ebin',
    component: 'AlignedBarcodes | SeasonStrip | FeasibilityCalendar',
    path: 'features/compareVisuals',
    status: 'stub',
    budget: 'flex',
  },
  scan: {
    owner: 'Nived',
    component: 'ScanPanel',
    path: 'features/compareResults/ScanPanel',
    status: 'live',
    budget: 'flex',
    scroll: true,
  },
  deltaTable: {
    owner: 'Nived',
    component: 'DeltaTable',
    path: 'features/compareResults/DeltaTable',
    status: 'live',
    budget: 'deltaTable',
  },
  compareWindows: {
    owner: 'Ebin',
    component: 'WindowsTable',
    path: 'features/analysis/WindowsTable',
    status: 'stub',
    budget: 'compareWindows',
    scroll: true,
  },
  // ---- Methodology ----
  methodology: {
    owner: 'Abhinav',
    component: 'MethodologySections',
    path: 'features/methodology/MethodologySections',
    status: 'later',
    phase: 6,
    budget: 'flex',
    scroll: true,
  },
};
