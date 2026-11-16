// Owner: Nived
// Seams: smallestExtentContaining(lat) (pure) and <Basemap sites selectedId extent/> rendered to HTML.
// UI critique M4: no fake terrain, no dead controls, the selected site must be visible and named, and the map must show
// the site you selected (IM-2 at 84.79 S is outside the 85-90 S extent, so that extent must not be the default for it).
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SiteRecord } from '../../engine/types';
import { Basemap } from './Basemap';
import { smallestExtentContaining } from './extent';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const site = (id: string, name: string, lat: number, lon: number) =>
  ({ id, name, lat, lon, landingCoords: { lat, lon, source: '' }, targetCoords: null }) as unknown as SiteRecord;
const IM2 = site('im2_athena', 'IM-2 Athena (Mons Mouton)', -84.7906, 29.1957);
const SHACK = site('shackleton_ridge', 'Shackleton connecting ridge', -89.54, 129);
const CY3 = site('cy3_shiv_shakti', 'Chandrayaan-3 Statio Shiv Shakti', -69.373, 32.319);

describe('smallestExtentContaining (the contract: 85S = 85-90 S, 80S = 80-90 S)', () => {
  it('picks the tightest map that shows the point', () => {
    expect(smallestExtentContaining(-89.54)).toBe('85S');
    expect(smallestExtentContaining(-85)).toBe('85S'); // boundary is inclusive
    expect(smallestExtentContaining(-84.7906)).toBe('80S'); // IM-2: just outside the inner map
    expect(smallestExtentContaining(-80)).toBe('80S');
  });
  it('null when the point is on neither map (CY-3 at 69 S, any northern site)', () => {
    expect(smallestExtentContaining(-79.9)).toBeNull();
    expect(smallestExtentContaining(-69.373)).toBeNull();
    expect(smallestExtentContaining(18.56)).toBeNull();
  });
});

describe('Basemap is honest', () => {
  it('draws no fake terrain: no canvas, and no "schematic relief" disclaimer needed', () => {
    const html = renderToStaticMarkup(<Basemap sites={[SHACK]} selectedId="shackleton_ridge" extent="85S" />);
    expect(html).not.toContain('<canvas');
    expect(text(html).toLowerCase()).not.toContain('schematic relief');
  });
  it('shows no layer controls while no layer exists (they would do nothing)', () => {
    const html = renderToStaticMarkup(<Basemap sites={[SHACK]} selectedId="shackleton_ridge" extent="85S" />);
    expect(html).not.toContain('<select');
    expect(html).not.toContain('type="range"');
  });
  it('labels the graticule rings and the Earth-facing meridian', () => {
    const t = text(renderToStaticMarkup(<Basemap sites={[SHACK]} selectedId="shackleton_ridge" extent="85S" />));
    for (const d of ['86', '87', '88', '89']) expect(t).toContain(`${d}°S`);
    expect(t).toContain('toward Earth');
  });
  it('the selected site is named on the map (visible text, not just a hover tooltip)', () => {
    const html = renderToStaticMarkup(<Basemap sites={[SHACK, IM2]} selectedId="shackleton_ridge" extent="85S" />);
    expect(html).toMatch(/<text[^>]*>[^<]*Shackleton connecting ridge/);
  });
  it('when the selected site is outside this view it says so in words, and offers the map that shows it', () => {
    const html = renderToStaticMarkup(<Basemap sites={[IM2, SHACK]} selectedId="im2_athena" extent="85S" />);
    expect(text(html)).toContain('IM-2 Athena (Mons Mouton) is outside this view');
    expect(text(html)).toContain('Show 80–90°S');
  });
  it('a site on neither map (Chandrayaan-3) is explained, not silently dropped, and no useless button is offered', () => {
    const html = renderToStaticMarkup(<Basemap sites={[CY3]} selectedId="cy3_shiv_shakti" extent="80S" />);
    expect(text(html)).toContain('Chandrayaan-3 Statio Shiv Shakti is not on the south-pole maps');
    expect(text(html)).toContain('69.4°S');
    expect(text(html)).not.toContain('Show 80');
  });
  it('no off-site clutter when the selected site is on the map', () => {
    const t = text(renderToStaticMarkup(<Basemap sites={[SHACK]} selectedId="shackleton_ridge" extent="85S" />));
    expect(t).not.toContain('outside this view');
  });

  it('labels are legible: at least 8% of the map radius, i.e. about 11 px at the smallest map (UI critique: nothing under 11-12 px)', () => {
    const html = renderToStaticMarkup(<Basemap sites={[SHACK]} selectedId="shackleton_ridge" extent="85S" />);
    const sizes = [...html.matchAll(/<text[^>]*class="basemap__(?:tick|earth)"[^>]*font-size="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(4);
    const half = 2 * 1737.4 * Math.tan((5 * Math.PI) / 360); // 85S extent radius in km (151.9)
    for (const fs of sizes) expect(fs).toBeGreaterThanOrEqual(0.08 * half);
  });
  it('a selected site on the right half has its name drawn to its LEFT (text-anchor end), so the label stays inside the map', () => {
    const right = site('r', 'Right site', -86, 60); // x > 0
    const left = site('l', 'Left site', -86, 300); // x < 0
    const hr = renderToStaticMarkup(<Basemap sites={[right]} selectedId="r" extent="85S" />);
    const hl = renderToStaticMarkup(<Basemap sites={[left]} selectedId="l" extent="85S" />);
    expect(hr).toMatch(/<text[^>]*class="basemap__name"[^>]*text-anchor="end"|<text[^>]*text-anchor="end"[^>]*class="basemap__name"/);
    expect(hl).toMatch(/<text[^>]*class="basemap__name"[^>]*text-anchor="start"|<text[^>]*text-anchor="start"[^>]*class="basemap__name"/);
  });
  it('never prints a raw escape sequence: degree signs render as real characters', () => {
    const t = text(renderToStaticMarkup(<Basemap sites={[SHACK, IM2]} selectedId="shackleton_ridge" extent="85S" />));
    expect(t).not.toMatch(/\\u[0-9a-f]{4}/i);
    expect(t).toContain('0\u00b0E');
  });
});

