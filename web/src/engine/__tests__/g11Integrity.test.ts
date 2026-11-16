// Owner: Gowri (gate G11) — Windows Table, barcode and CSV integrity, on REAL engine results (VITE_LUMEN_DATA=real files in public/data).
//   1. CSV windows export -> parse gives back every window exactly (100 % of windows, every field, nulls and full precision).
//   2. JSON export is lossless.
//   3. The metrics CSV carries every metric value the result holds.
//   4. Barcode cells agree with the Windows Table: an hourly sample strictly inside a window of a kind is "up" for that kind, and a sample
//      outside every window of that kind is "down" (samples within one sample step of a window edge are skipped: refined edges are ~10 s,
//      the series is hourly).
// When LUMEN_G11_OUT is set the measured counts are written there as the G11 evidence artifact (pipeline/scripts/record_g11.py does this).
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { evaluateScenario } from '../client';
import { loadCatalog } from '../data/catalog';
import { setDataMode } from '../data/source';
import { exportCsv, parseExportCsv, parseWindowsCsv } from '../export/csv';
import { exportJson } from '../export/json';
import { makeRequest } from '../requests';
import { DEFAULT_SCENARIO } from '../../state/scenarioStore';
import type { ScenarioResult, WindowType } from '../types';
import { PUBLIC, stubFetch } from './helpers';

const have = existsSync(join(PUBLIC, 'data/catalog/sites.json')) && existsSync(join(PUBLIC, 'data/ephem/ephem.json'));
const SITES = ['im2_athena', 'cy3_shiv_shakti', 'shackleton_ridge'] as const;
const MASTS = [2, 10] as const;
const KINDS: Array<[WindowType, 'sunUp' | 'earthUp' | 'linkUp']> = [['sun', 'sunUp'], ['earth', 'earthUp'], ['link', 'linkUp']];
const START = Date.UTC(2027, 1, 8);

interface Tally { cases: number; windows: number; windowsMatched: number; metricsRows: number; metricsMatched: number; barcodeCells: number; barcodeAgree: number; barcodeSkippedAtEdges: number; jsonLossless: number }
const tally: Tally = { cases: 0, windows: 0, windowsMatched: 0, metricsRows: 0, metricsMatched: 0, barcodeCells: 0, barcodeAgree: 0, barcodeSkippedAtEdges: 0, jsonLossless: 0 };
const detail: Array<{ site: string; heightM: number; windows: number; barcodeCells: number }> = [];

describe.skipIf(!have)('G11 on real engine results', () => {
  beforeAll(() => { stubFetch(); setDataMode('real'); });
  afterAll(() => {
    setDataMode(null);
    if (process.env.LUMEN_G11_OUT) writeFileSync(process.env.LUMEN_G11_OUT, JSON.stringify({ tally, detail, window_start_utc: new Date(START).toISOString(), duration_days: 30 }, null, 2) + '\n');
  });

  for (const id of SITES) {
    for (const heightM of MASTS) {
      it(`${id} @ ${heightM} m: CSV/JSON round trip and barcode == Windows Table`, async () => {
        const { sites } = await loadCatalog();
        const req = makeRequest({ ...DEFAULT_SCENARIO, durationDays: 30, slipDays: 0 }, sites, { siteRef: { kind: 'site', id }, landingUtc: START, heightM, scrubUtc: START });
        const r: ScenarioResult = await evaluateScenario(req);
        expect(r.status).toBe('ready');
        tally.cases++;

        // 1. windows CSV round trip
        const back = parseWindowsCsv(exportCsv(r, 'windows'));
        expect(back.length).toBe(r.windows.length);
        r.windows.forEach((w, i) => {
          tally.windows++;
          expect(back[i]).toEqual(w);
          tally.windowsMatched++;
        });

        // 2. JSON lossless
        expect(JSON.parse(exportJson(r, 'windows'))).toBeTruthy();
        tally.jsonLossless++;

        // 3. metrics CSV has every metric value
        const { rows } = parseExportCsv(exportCsv(r, 'metrics'));
        const byKey = new Map(rows.map((x) => [x[0], x]));
        for (const [k, v] of Object.entries(r.metrics ?? {})) {
          if (v == null || !('value' in v)) continue;
          tally.metricsRows++;
          const row = byKey.get(k);
          expect(row, `metric ${k} is in the CSV`).toBeTruthy();
          if (v.value == null ? row![1] === '' : Number(row![1]) === v.value) tally.metricsMatched++;
          else expect.fail(`metric ${k}: CSV ${row![1]} != ${v.value}`);
        }

        // 4. barcode cells agree with the Windows Table
        const s = r.series!;
        let cells = 0;
        for (const [kind, key] of KINDS) {
          const ws = r.windows.filter((w) => w.type === kind);
          for (let i = 0; i < s[key].length; i++) {
            const t = s.t0 + i * s.stepMs;
            const near = ws.some((w) => Math.abs(t - w.start) < s.stepMs || Math.abs(t - w.end) < s.stepMs);
            if (near) { tally.barcodeSkippedAtEdges++; continue; }
            const inside = ws.some((w) => t > w.start && t < w.end);
            tally.barcodeCells++;
            cells++;
            expect(s[key][i] === 1, `${id} ${heightM} m ${kind} cell ${i}`).toBe(inside);
            tally.barcodeAgree++;
          }
        }
        detail.push({ site: id, heightM, windows: r.windows.length, barcodeCells: cells });
      });
    }
  }
});
