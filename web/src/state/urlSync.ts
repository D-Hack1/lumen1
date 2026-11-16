// Owner: Abhinav
// URL sync (skeleton). Format: `?s=<v>.<base64url(JSON)>` — versioned; unknown fields are ignored; fields with
// the wrong shape fall back to defaults. Written with history.replaceState at human speed (debounced), never
// from the hot path. Other query params (e.g. `fixture`) are preserved.
//
// TODO (A-5): compact key map + default-elision to shorten links; migration table for future versions.
import {
  DEFAULT_SCENARIO,
  MAX_COMPARE_ROWS,
  SCENARIO_KEYS,
  pickScenario,
  useScenario,
  type Scenario,
} from './scenarioStore';

export const URL_VERSION = 1;
export const URL_PARAM = 's';

// ---------- base64url (UTF-8 safe, no Buffer dependency) ----------
function toB64url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

// ---------- shape-checked merge ----------
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Keep `v` only if it has the same JSON shape as `ref` (recursively for plain objects); else `ref`. */
function conform<T>(ref: T, v: unknown): T {
  if (v === undefined) return ref;
  if (ref === null) return (v === null || typeof v === 'number' ? v : ref) as T; // nullable numbers (yaw)
  if (Array.isArray(ref)) return (Array.isArray(v) ? v : ref) as T;
  if (isObj(ref)) {
    if (!isObj(v)) return ref;
    // Union-shaped objects (SiteRef) — accept if the discriminant is known and fields have the right types.
    if ('kind' in ref) return (isSiteRef(v) ? v : ref) as T;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(ref)) out[k] = conform((ref as Record<string, unknown>)[k], v[k]);
    return out as T;
  }
  if (typeof ref === 'number') return (typeof v === 'number' && Number.isFinite(v) ? v : ref) as T;
  return (typeof v === typeof ref ? v : ref) as T;
}

function isSiteRef(v: Record<string, unknown>): boolean {
  if (v.kind === 'site') return typeof v.id === 'string' && v.id.length > 0;
  if (v.kind === 'point') return typeof v.lat === 'number' && typeof v.lon === 'number';
  return false;
}

const ENUMS: Partial<Record<keyof Scenario, readonly unknown[]>> = {
  view: ['cockpit', 'compare', 'methodology'],
  persona: ['planner', 'educator'],
  durationDays: [7, 14, 30, 60],
  heightM: [1, 2, 5, 10],
  panelPreset: ['fourSide', 'singleHeading', 'horizontalDeck', 'trackingMast'],
  definitionsPreset: ['default', 'isroVikramOps', 'custom'],
  analysisTab: ['power', 'windows', 'pointing'],
  compareTab: ['aligned', 'season', 'calendar'],
  compareSlipTarget: ['all', 'selected'],
};
const ROW_ID_LIST = ['A', 'B', 'C', 'D'];

// ---------- encode / decode ----------

export function encodeScenario(s: Scenario): string {
  return `${URL_VERSION}.${toB64url(JSON.stringify(pickScenario(s)))}`;
}

/** Returns a partial scenario (known, well-shaped fields only), or null if the token is unreadable/unsupported. */
export function decodeScenario(token: string): Partial<Scenario> | null {
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  const version = Number(token.slice(0, dot));
  if (version !== URL_VERSION) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(fromB64url(token.slice(dot + 1)));
  } catch {
    return null;
  }
  if (!isObj(raw)) return null;

  const out: Partial<Scenario> = {};
  for (const k of SCENARIO_KEYS) {
    if (!(k in raw)) continue;
    const allowed = ENUMS[k];
    if (allowed && !allowed.includes(raw[k])) continue;
    if (k === 'compareSelected') {
      // nullable string enum (conform() only knows nullable numbers)
      if (raw[k] === null || ROW_ID_LIST.includes(raw[k] as string)) out.compareSelected = raw[k] as Scenario['compareSelected'];
      continue;
    }
    (out as Record<string, unknown>)[k] = conform(DEFAULT_SCENARIO[k], raw[k]);
  }
  if (out.compareRows) {
    const rowRef = {
      site: DEFAULT_SCENARIO.site,
      landingUtc: DEFAULT_SCENARIO.landingUtc,
      slipDays: 0,
      panelPreset: DEFAULT_SCENARIO.panelPreset,
      yawDeg: DEFAULT_SCENARIO.yawDeg,
      tilt: DEFAULT_SCENARIO.tilt,
      heightM: DEFAULT_SCENARIO.heightM,
      baseline: false,
    };
    out.compareRows = (out.compareRows as unknown[])
      .filter((r): r is Record<string, unknown> => isObj(r) && ROW_ID_LIST.includes(r.id as string))
      .filter((r, i, all) => all.findIndex((x) => x.id === r.id) === i) // duplicate ids: keep the first
      .map((r) => {
        const row = { ...conform(rowRef, r), id: r.id as Scenario['compareRows'][number]['id'] };
        if (!ENUMS.panelPreset!.includes(row.panelPreset)) row.panelPreset = rowRef.panelPreset;
        if (!ENUMS.heightM!.includes(row.heightM)) row.heightM = rowRef.heightM;
        row.slipDays = Math.max(-30, Math.min(30, Math.round(row.slipDays ?? 0)));
        return row;
      })
      .slice(0, MAX_COMPARE_ROWS);
  }
  if (out.slipDays != null) out.slipDays = Math.max(-30, Math.min(30, Math.round(out.slipDays)));
  return out;
}

export function scenarioUrl(s: Scenario = useScenario.getState(), base: string = window.location.href): string {
  const url = new URL(base);
  url.searchParams.set(URL_PARAM, encodeScenario(s));
  return url.toString();
}

export function readScenarioFromUrl(search: string = window.location.search): Partial<Scenario> | null {
  const token = new URLSearchParams(search).get(URL_PARAM);
  return token ? decodeScenario(token) : null;
}

/** Keep the address bar in sync with the committed store. Returns a stop function. */
export function startUrlSync(debounceMs = 250): () => void {
  let timer: number | undefined;
  let last = '';
  const write = () => {
    const token = encodeScenario(useScenario.getState());
    if (token === last) return;
    last = token;
    const url = new URL(window.location.href);
    url.searchParams.set(URL_PARAM, token);
    window.history.replaceState(null, '', url);
  };
  const unsub = useScenario.subscribe(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(write, debounceMs);
  });
  return () => {
    window.clearTimeout(timer);
    unsub();
  };
}
