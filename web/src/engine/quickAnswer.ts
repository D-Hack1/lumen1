// Owner: Nived
// Single-point answer from lat/lon/UTC/duration/height. Real mode: the same engine as the Cockpit (core/quick.ts), on the
// real ephemeris; a curated site is recognised within 1 km, anything else is a smooth-Moon (Tier C) answer. Mock mode: fake numbers.
import { buildQuickAnswer } from './core/quick';
import { loadCatalog } from './data/catalog';
import { loadDsnOrNull } from './data/dsn';
import { loadEphem } from './data/ephem';
import { dataMode } from './data/source';
import { mockQuickAnswer } from '../mocks/mockResult';
import { perf } from './perf';
import type { QuickAnswerInput, QuickAnswerResult } from './types';

export function quickAnswer(input: QuickAnswerInput): Promise<QuickAnswerResult> {
  return perf.timeAsync('quickAnswer', async () => {
    const { sites } = await loadCatalog();
    if (dataMode() === 'mock') return mockQuickAnswer(input, sites);
    return buildQuickAnswer(await loadEphem(), input, sites, await loadDsnOrNull());
  });
}
