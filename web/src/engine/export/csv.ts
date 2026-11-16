// Owner: Nived
// CSV export with a header block (site, tier, sigma source, definitions, data versions) and a lossless round trip (gate G11):
// every time is an ISO-8601 UTC string with milliseconds, every number keeps full precision, nulls are empty cells.
//   header lines:  "# key: value"          (a `# MOCK DATA` line is added for mock data)
//   then one header row of column names, then the data rows. Fields with , " or newlines are quoted.
import type { Bounded, ScenarioResult, WindowRecord, WindowType } from '../types';

export type ExportKind = 'windows' | 'metrics';
export const EXPORT_VERSION = 1;

export function exportHeader(r: ScenarioResult, kind: ExportKind): Array<[string, string]> {
  const m = r.meta;
  const h: Array<[string, string]> = [
    ['lumen_export_version', String(EXPORT_VERSION)],
    ['kind', kind],
    ['site', m?.siteId ?? ''],
    ['tier', m?.tierBadge ?? ''],
    ['sigma_source', m?.sigmaSource ?? ''],
    ['definitions', m?.definitionsSummary ?? ''],
    ['data_versions', JSON.stringify(m?.dataVersions ?? {})],
    ['verdict', r.verdict],
  ];
  if (m?.mock) h.push(['mock', 'true']);
  return h;
}

const esc = (v: unknown): string => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
const iso = (ms: number): string => new Date(ms).toISOString();
const sec = (ms: number | null): number | null => (ms == null ? null : ms / 1000);

export const WINDOW_COLUMNS = ['type', 'start_utc', 'start_pm_s', 'end_utc', 'end_pm_s', 'duration_h', 'duration_lo_h', 'duration_hi_h', 'peak_elev_deg', 'grazing', 'partial_start', 'partial_end'] as const;
export const METRIC_COLUMNS = ['metric', 'value', 'lo', 'hi'] as const;

export function exportCsv(r: ScenarioResult, kind: ExportKind = 'windows'): string {
  const lines = exportHeader(r, kind).map(([k, v]) => `# ${k}: ${v}`);
  if (kind === 'windows') {
    lines.push(WINDOW_COLUMNS.join(','));
    for (const w of r.windows) {
      lines.push([w.type, iso(w.start), sec(w.startPmMs), iso(w.end), sec(w.endPmMs), w.durationH.value, w.durationH.lo, w.durationH.hi, w.peakElevDeg, w.flags.grazing, w.flags.partialStart, w.flags.partialEnd].map(esc).join(','));
    }
  } else {
    lines.push(METRIC_COLUMNS.join(','));
    for (const [k, v] of Object.entries(r.metrics ?? {})) {
      if (v == null) continue;
      if ('value' in v) lines.push([k, v.value, v.lo, v.hi].map(esc).join(','));
      else for (const [pk, pv] of Object.entries(v)) lines.push([`${k}.${pk}`, pv, null, null].map(esc).join(','));
    }
  }
  return lines.join('\n') + '\n';
}

/** Minimal RFC-4180 row splitter for one line (quotes, doubled quotes). */
function splitRow(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        q = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      q = true;
    } else if (c === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

export interface ParsedCsv {
  header: Record<string, string>;
  columns: string[];
  rows: string[][];
}

export function parseExportCsv(text: string): ParsedCsv {
  const header: Record<string, string> = {};
  const body: string[] = [];
  for (const line of text.split('\n')) {
    if (line === '') continue;
    if (line.startsWith('# ')) {
      const i = line.indexOf(': ');
      if (i > 0) header[line.slice(2, i)] = line.slice(i + 2);
    } else body.push(line);
  }
  const [cols, ...rows] = body;
  return { header, columns: splitRow(cols ?? ''), rows: rows.map(splitRow) };
}

const num = (s: string): number | null => (s === '' ? null : Number(s));

export function parseWindowsCsv(text: string): WindowRecord[] {
  const { columns, rows } = parseExportCsv(text);
  if (columns.join(',') !== WINDOW_COLUMNS.join(',')) throw new Error('not a LUMEN windows export (unexpected columns)');
  return rows.map((c) => ({
    type: c[0] as WindowType, start: Date.parse(c[1]), startPmMs: num(c[2]) == null ? null : num(c[2])! * 1000, end: Date.parse(c[3]),
    endPmMs: num(c[4]) == null ? null : num(c[4])! * 1000, durationH: { value: num(c[5]), lo: num(c[6]), hi: num(c[7]) } as Bounded,
    peakElevDeg: Number(c[8]), flags: { grazing: c[9] === 'true', partialStart: c[10] === 'true', partialEnd: c[11] === 'true' },
  }));
}
