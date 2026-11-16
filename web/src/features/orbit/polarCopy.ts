// Owner: Abhinav
// Orbit page — the south-pole view's words: hover tooltip, key, layer names. Wording is the approved design's; kept pure so it
// can move into content/personaCopy.ts without touching the components.
import type { PolarLayer, PolarSample } from './polarTerrain';

export interface TooltipCopy {
  title: string;
  body: string;
  coords: string;
}

export const LAYER_LABELS: Record<PolarLayer, string> = { live: 'Live light', earth: 'Earth view', month: 'Month map' };

export const fmtPolarCoords = (s: Pick<PolarSample, 'lat' | 'lon' | 'heightM'>): string =>
  `${Math.abs(s.lat).toFixed(2)}°S ${Math.abs(s.lon).toFixed(1)}°${s.lon < 0 ? 'W' : 'E'} · ${(s.heightM / 1000).toFixed(1)} km`;

export function tooltipCopy(s: PolarSample, layer: PolarLayer, showAlwaysDark: boolean): TooltipCopy {
  const mon = Math.round(s.monthLitPct);
  let title: string;
  let body: string;
  if (s.alwaysDark && showAlwaysDark) {
    title = 'Permanently dark';
    body = 'A cold trap. The Sun never clears the surrounding terrain here, so it stays in shadow all year.';
    if (layer === 'earth') body += ` Earth is ${s.earthVisible ? 'in view' : 'hidden'} from here right now.`;
  } else if (layer === 'live') {
    title = s.sunlit ? 'Sunlit now' : 'In shadow now';
    body = `Sunlit about ${mon}% of this lunar month.`;
  } else if (layer === 'earth') {
    title = s.earthVisible ? 'Earth in view' : 'Earth hidden by terrain';
    body = s.earthVisible
      ? 'A direct line to Earth is open from here right now.'
      : 'Terrain blocks the view of Earth from here right now.';
  } else {
    title = `${mon}% of the month in sunlight`;
    body = mon < 20 ? 'Mostly dark.' : mon > 60 ? 'Mostly sunlit.' : 'Alternates between sun and shadow.';
  }
  return { title, body, coords: fmtPolarCoords(s) };
}

export interface KeyRow {
  swatch: string;
  label: string;
}

const VIOLET = '#7E4E9A';

export function keyRows(layer: PolarLayer, showAlwaysDark: boolean): KeyRow[] {
  if (layer === 'live') {
    return [
      { swatch: '#B8B0A0', label: 'Sunlit now' },
      { swatch: '#0B0A09', label: 'In shadow now' },
      ...(showAlwaysDark ? [{ swatch: VIOLET, label: 'Always dark (cold trap)' }] : []),
    ];
  }
  if (layer === 'earth') {
    return [
      { swatch: '#7FB5A3', label: 'Earth above the horizon' },
      { swatch: '#2E3438', label: 'Earth hidden by terrain' },
    ];
  }
  return [
    { swatch: '#16181E', label: 'Mostly dark' },
    { swatch: '#96581E', label: 'Half the month' },
    { swatch: '#FFDE8C', label: 'Mostly sunlit' },
    ...(showAlwaysDark ? [{ swatch: VIOLET, label: 'Never lit' }] : []),
  ];
}

export const layerDescription = (layer: PolarLayer): string =>
  layer === 'live'
    ? 'live light and shadow'
    : layer === 'earth'
      ? 'where Earth is above the horizon'
      : 'share of the month in sunlight (violet = never lit when always-dark areas are on)';

const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const lightDirection = (azDeg: number): string =>
  `${Math.round(azDeg)}° (${DIRS[Math.round(azDeg / 45) % 8]} on the map)`;
