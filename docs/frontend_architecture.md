# Frontend architecture (engine side)

_Owner: Nived. Draft; N-14 will finalise after the Tier-1 work._

## Data flow

```
web/public/data[-mock]/   ->   engine/data/*  loaders   ->   engine/core/*  math   ->   engine/resultStore   ->   hooks   ->   components
 (written by the pipeline)      validate + cache             pure TS twins of            one shared evaluation       useResult     AnswerStrip,
                                                             pipeline/.../reference      per scenario change         useCatalog    MetricDeck, Ribbon...
```

- **Mock/real switch:** `VITE_LUMEN_DATA=mock|real` (default `mock`), or `setDataMode()` at runtime. Same hooks, same shapes.
- **Loaders** (`engine/data/`) are strict: they reject a wrong header/magic/version/size/checksum rather than defaulting. NaN in masks is preserved.
- **Core math** (`engine/core/`) is float64 throughout (the Sun is ~1.5e8 km away; float32 would lose ~10 km).
  `constants` -> `interp` (cubic Hermite) -> `geometry` (site frame, topocentric az/el) -> `visibility` (horizon, near-zone occluder, disk fraction, availability) -> `events` (2-min grid + bisection) -> `windows` -> `metrics` -> `evaluate` -> `buildResult`.
- **Worker:** `worker.ts` (Comlink) runs `buildScenarioResult`; `client.ts` falls back to in-thread when there is no `Worker` (tests/SSR).
- **Result store** (`resultStore.ts`): subscribes to the scenario store once; recomputes only when an engine-relevant field changes (site, landing, slip, duration, scrub, height, definitions); latest-wins; keeps the previous ready result visible while recomputing.

## Python <-> TypeScript parity
`core/*.ts` mirror `pipeline/lumen_pipeline/reference/*.py` function-for-function. `__tests__/core.parity.test.ts` recomputes the real golden set and fails on drift; `constants.ts` is checked against `constants.py` by parsing the Python file. **Never change a formula here before the Python twin changes.**

## Panels owned here
`features/answer` (Answer Strip, D-14 state machine from the pure `engine/answerState.ts`), `features/metrics` (Metric Deck), `features/map` (Basemap: procedural relief, graticule, regions, pins, Site Inset), `features/compareResults` (Scan, Delta Table). All labels come from `useCopyFn`; all numerals are tabular monospace.

## Offline
`pwa.config.ts` precaches the app shell and the active data folder at install (Workbox via vite-plugin-pwa), so the app and every data file work with no network.

## Known gaps (tracked in the plan)
Terrain mask/sigma (Shiva Shakthi) -> ± and δt; DSN data -> DSN-aware link; power/pointing (golden set 2); two-stage Scan on real series; 12-month calendar; performance pass against the G8 budgets.
