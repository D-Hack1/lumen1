// Owner: Abhinav
// State shared by the four Lumen pages (Orbit, Stand here, Compare, Slip explorer): theme, the selected site, array height,
// the clock and the compare list. One hook builds it; PagesApp provides it; each page reads it from context. A page rendered
// on its own (no provider) falls back to its own copy, so OrbitPage still works alone.
import { createContext, useCallback, useMemo, useState } from 'react';
import { SITES, customSite, type Site } from './orbitModel';

/** Slip explorer range: 0 … SLIP_MAX days (28 windows, matches pagesModel.SLIP_DAYS − 1). */
export const SLIP_MAX = 27;
export const DEFAULT_SLIP = 6;

const THEME_KEY = 'lumen-theme';
const readLight = (): boolean => {
  try {
    return window.localStorage.getItem(THEME_KEY) === 'light';
  } catch {
    return false;
  }
};

export const MAX_COMPARE = 4;

export interface LumenState {
  light: boolean;
  toggleTheme: () => void;
  site: Site;
  /** Pick a catalogue site by id. */
  selectSite: (id: string) => void;
  /** Pin arbitrary coordinates (becomes the "Custom pin" site). */
  dropCustom: (lat: number, lon: number) => void;
  /** Every site that can be shown or compared: the catalogue plus the custom pin if there is one. */
  allSites: readonly Site[];
  mast: number;
  setMast: (m: number) => void;
  /** Hours since 2027-02-08 00:00 UTC. */
  t: number;
  /** Landing slip in whole days (0 … SLIP_MAX). Shared so the Slip explorer and commands ("slip 9 days") agree. */
  slip: number;
  /** Clamped and rounded to a whole day in 0 … SLIP_MAX. */
  setSlip: (days: number) => void;
  setT: (v: number | ((prev: number) => number)) => void;
  picked: readonly string[];
  togglePick: (id: string) => void;
  addPick: (id: string) => void;
}

export const LumenContext = createContext<LumenState | null>(null);

export function useLumenState(): LumenState {
  const [light, setLight] = useState(readLight);
  const [siteId, setSiteId] = useState(() => SITES[0].id);
  const [custom, setCustom] = useState<Site | null>(null);
  const [mast, setMast] = useState(2);
  const [t, setT] = useState(96);
  const [slip, setSlipRaw] = useState(DEFAULT_SLIP);
  const setSlip = useCallback((days: number) => {
    if (Number.isFinite(days)) setSlipRaw(Math.max(0, Math.min(SLIP_MAX, Math.round(days))));
  }, []);
  const [picked, setPicked] = useState<string[]>(() => SITES.slice(0, 3).map((s) => s.id));

  const toggleTheme = useCallback(() => {
    setLight((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(THEME_KEY, next ? 'light' : 'dark');
      } catch {
        /* the theme still switches for this visit */
      }
      return next;
    });
  }, []);

  const selectSite = useCallback((id: string) => setSiteId(id), []);
  const dropCustom = useCallback((lat: number, lon: number) => {
    setCustom(customSite(lat, lon));
    setSiteId('custom');
  }, []);

  const addPick = useCallback((id: string) => {
    setPicked((p) => {
      if (p.includes(id)) return p;
      const next = p.length >= MAX_COMPARE ? p.slice(1) : p.slice();
      next.push(id);
      return next;
    });
  }, []);
  const togglePick = useCallback((id: string) => {
    setPicked((p) => {
      const i = p.indexOf(id);
      if (i >= 0) return p.length > 1 ? p.filter((x) => x !== id) : p;
      const next = p.length >= MAX_COMPARE ? p.slice(1) : p.slice();
      next.push(id);
      return next;
    });
  }, []);

  const allSites = useMemo<readonly Site[]>(() => (custom ? [...SITES, custom] : SITES), [custom]);
  const site = (siteId === 'custom' && custom ? custom : SITES.find((s) => s.id === siteId)) ?? SITES[0];

  return useMemo(
    () => ({
      light,
      toggleTheme,
      site,
      selectSite,
      dropCustom,
      allSites,
      mast,
      setMast,
      t,
      setT,
      slip,
      setSlip,
      picked,
      togglePick,
      addPick,
    }),
    [light, toggleTheme, site, selectSite, dropCustom, allSites, mast, t, slip, setSlip, picked, togglePick, addPick],
  );
}
