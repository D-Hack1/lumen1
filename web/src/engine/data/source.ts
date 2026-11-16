// Owner: Nived
// The one place that decides where data comes from. Mock/real switch: VITE_LUMEN_DATA=mock|real
// (default: real; mock is opt-in). No component or loader hard-codes /data or /data-mock.

export type DataMode = 'mock' | 'real';

let modeOverride: DataMode | null = null;

/** Force mock/real at runtime (tests, a dev toggle). Pass null to go back to the VITE_LUMEN_DATA setting. */
export function setDataMode(mode: DataMode | null): void {
  modeOverride = mode;
}

export function dataMode(): DataMode {
  if (modeOverride) return modeOverride;
  const v = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_LUMEN_DATA;
  return v === 'mock' ? 'mock' : 'real';
}

function base(): string {
  const b = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  return `${b.replace(/\/$/, '')}/${dataMode() === 'real' ? 'data' : 'data-mock'}/`;
}

/** Resolve a path relative to the data root (e.g. "catalog/sites.json") to a URL. */
export function dataUrl(path: string): string {
  return base() + path.replace(/^\//, '');
}

export class DataError extends Error {}

const jsonCache = new Map<string, Promise<unknown>>();
const binCache = new Map<string, Promise<ArrayBuffer>>();

export function clearDataCache(): void {
  jsonCache.clear();
  binCache.clear();
}

/** Fetch + cache JSON. Optionally require a header `version` in `supportedVersions`. */
export function fetchJson<T>(path: string, supportedVersions?: Array<number | string>): Promise<T> {
  const url = dataUrl(path);
  let p = jsonCache.get(url);
  if (!p) {
    p = fetch(url).then(async (r) => {
      if (!r.ok) throw new DataError(`${url}: HTTP ${r.status}`);
      return r.json();
    });
    jsonCache.set(url, p);
    p.catch(() => jsonCache.delete(url));
  }
  return (p as Promise<T>).then((j) => {
    if (supportedVersions) checkVersion(url, j, supportedVersions);
    return j;
  });
}

/** Fetch + cache a binary file (little-endian by contract). */
export function fetchBuffer(path: string): Promise<ArrayBuffer> {
  const url = dataUrl(path);
  let p = binCache.get(url);
  if (!p) {
    p = fetch(url).then(async (r) => {
      if (!r.ok) throw new DataError(`${url}: HTTP ${r.status}`);
      return r.arrayBuffer();
    });
    binCache.set(url, p);
    p.catch(() => binCache.delete(url));
  }
  return p;
}

export function checkVersion(label: string, header: unknown, supported: Array<number | string>): void {
  const v = (header as { version?: unknown } | null)?.version;
  if ((typeof v !== 'number' && typeof v !== 'string') || !supported.includes(v)) {
    throw new DataError(`${label}: unsupported data version ${String(v)} (supported: ${supported.join(', ')})`);
  }
}
