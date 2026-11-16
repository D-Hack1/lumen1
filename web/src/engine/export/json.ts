// Owner: Nived
// JSON export: { header, windows | metrics }. Lossless: JSON.parse(exportJson(r)) gives back the same numbers (G11).
import type { ScenarioResult } from '../types';
import { exportHeader, type ExportKind } from './csv';

export function exportJson(r: ScenarioResult, kind: ExportKind = 'windows'): string {
  const header = Object.fromEntries(exportHeader(r, kind));
  return JSON.stringify({ header, [kind]: kind === 'windows' ? r.windows : r.metrics }, null, 2) + '\n';
}
