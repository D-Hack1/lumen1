# Lumen pages — integration notes

Status: **all four pages converted from the approved design (Orbit v5), not mounted anywhere.** Nothing outside
`features/orbit/` and `features/pages/` imports them. Run `npm run dev` and open `/`
(`#orbit`, `#stand-here`, `#compare`, `#slip`). `orbit-preview.html` and `orbit/preview.tsx` are dev-only.

## Layout
| Path | Role |
|---|---|
| `pages/PagesApp.tsx`, `pages/Shell.tsx`, `pages/nav.ts` | hash-routed shell: header, nav, clock, theme toggle |
| `orbit/lumenState.ts` | state shared by all pages: theme, selected site, array height, clock, compare list |
| `orbit/OrbitPage.tsx` (+ `OrbitGlobe`, `globeRender`, `PolarStage`, `polar*`) | Orbit — whole Moon + south pole |
| `pages/SurfacePage.tsx` | Stand here — horizon panorama |
| `pages/ComparePage.tsx` | Compare — up to 4 sites, 14-day window |
| `pages/SlipPage.tsx` | Slip explorer — 28 start days |
| `pages/pagesModel.ts` | window stats, best slip day, panorama geometry (tested) |
| `orbit/orbitModel.ts` | the design's **sample** model (sites, synthetic horizon, Sun/Earth/DSN) — replace with engine results |

## UX additions beyond the design
Stand here: hover crosshair with bearing + skyline height, Sun/Earth labels, path legend, rise/set countdowns.
Compare: best value per row marked, sticky label column, "Stand here →" per site, selection count and limit hint.
Slip: bars are clickable buttons, dashed on-time baseline, best-window summary with "Jump to it".
All pages: one shared site / array height / clock, so choices carry across pages; Add to compare / Compare this site navigate.

## Assets (`public/content/orbit/`)
`orbit.json`, `polar_dem.png`, `polar_horizon.png` (8.3 MB, fetched only when the pole view opens), `polar_illum.png`, `moon_map.jpg`, `earth_map.jpg`.
Regenerate the polar PNGs with `pipeline/scripts/orbit_polar_horizons.py`.

## To do when integrating
1. Fonts: the design uses Inter, DM Sans, JetBrains Mono (preview loads them from Google Fonts). The app needs `@fontsource/*` or a decision to use IBM Plex.
2. Replace `orbitModel.ts` with real engine results and the app's site catalogue; feed `lumenState` from the existing scenario store.
3. Swap hash links for the app's navigation; drop `Shell` if the app header is kept (pages only need `LumenContext`).
4. Credits (LOLA/LRO DEM, LROC colour map, NASA SVS, Blue Marble Earth) into `docs/credits`.
5. The pages use the design's palette (`--bg`, `--amber`, …) rather than `ui/tokens.ts`; reconcile if the rest of the app should match.
6. Playwright smoke tests per page.
