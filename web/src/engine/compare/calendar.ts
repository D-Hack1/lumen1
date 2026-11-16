// Owner: Nived
// 12-month Feasibility Calendar (PLAN_FINAL 8.6, R3 delta D-15: "Calendar uses stage 1 only, with a provisional legend; clicking a
// cell runs stage 2 for that cell"). One cell per landing date: verdict + sunlit % / link % / longest night for the window that
// starts on that date. Computed in the background in chunks so the UI can show progress and cancel.
//   buildCalendar(...)  pure, synchronous (tests, the worker)
//   startCalendar(...)  real mode: one worker job per (site, 30-day chunk), progress after each; mock mode: a fake set
import { runStage1Offsets } from '../client';
import { loadCatalog } from '../data/catalog';
import { dataMode } from '../data/source';
import { makeRequest } from '../requests';
import { getScenario } from '../../state/scenarioStore';
import { mockScan } from '../../mocks/mockResult';
import type { Ephemeris } from '../data/ephem';
import type { ScenarioRequest } from '../core/buildResult';
import type { ScanCandidate } from '../types';
import { stage1ForOffsets } from './scanEngine';

export const CALENDAR_CHUNK_DAYS = 30;
const DAY = 86_400_000;

/** A calendar cell is a stage-1 candidate: provisional until the user clicks it (then `refineCandidate`). */
export type CalendarCell = ScanCandidate;

export interface CalendarInput {
  /** `startMs` = first landing date; `durationDays` = the surface window judged for every cell. */
  request: ScenarioRequest;
  days: number;
}

export function buildCalendar(eph: Ephemeris, input: CalendarInput): CalendarCell[] {
  const offsets = Array.from({ length: input.days }, (_, i) => i);
  return stage1ForOffsets(eph, input.request, offsets);
}

export interface CalendarParams {
  siteIds: string[];
  baseLandingUtc: number;
  days: number;
  durationDays: number;
}

export interface CalendarProgress {
  /** 0..1 over all (site, chunk) jobs. */
  fraction: number;
  done: boolean;
  cells: CalendarCell[];
}

export interface CalendarHandle {
  cancel(): void;
  done: Promise<CalendarProgress>;
}

export function startCalendar(params: CalendarParams, onUpdate: (p: CalendarProgress) => void): CalendarHandle {
  let cancelled = false;
  let latest: CalendarProgress = { fraction: 0, done: false, cells: [] };
  const done = (async (): Promise<CalendarProgress> => {
    const { sites } = await loadCatalog();
    if (cancelled) return latest;
    if (dataMode() === 'mock') {
      const cells = mockScan({ mode: 'dates', baseLandingUtc: params.baseLandingUtc, plusMinusDays: params.days, siteIds: params.siteIds, durationDays: 14 }, sites)
        .filter((c) => c.landingUtc >= params.baseLandingUtc && c.landingUtc < params.baseLandingUtc + params.days * DAY)
        .sort((a, b) => a.landingUtc - b.landingUtc);
      latest = { fraction: 1, done: true, cells };
      onUpdate(latest);
      return latest;
    }
    const s = getScenario();
    const requests = params.siteIds.map((id) => ({
      ...makeRequest(s, sites, { siteRef: { kind: 'site', id }, landingUtc: params.baseLandingUtc, heightM: s.heightM, scrubUtc: params.baseLandingUtc }),
      durationDays: params.durationDays,
    }));
    const chunksPerSite = Math.ceil(params.days / CALENDAR_CHUNK_DAYS);
    const total = requests.length * chunksPerSite;
    let finished = 0;
    const cells: CalendarCell[] = [];
    for (const r of requests) {
      for (let c = 0; c < chunksPerSite; c++) {
        const from = c * CALENDAR_CHUNK_DAYS;
        const offsets = Array.from({ length: Math.min(CALENDAR_CHUNK_DAYS, params.days - from) }, (_, i) => from + i);
        const chunk = await runStage1Offsets(r, offsets);
        if (cancelled) return latest;
        cells.push(...chunk);
        finished++;
        latest = { fraction: finished / total, done: finished === total, cells: [...cells] };
        onUpdate(latest);
      }
    }
    return latest;
  })();
  return {
    cancel: () => {
      cancelled = true;
    },
    done,
  };
}
