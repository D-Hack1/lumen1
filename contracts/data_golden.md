# Golden Vector Contract

Golden scenarios pin a site, UTC range, profile, expected Sun/Earth vectors and elevations, and expected event/window outputs. A scenario includes `minSunElevationOps` (default 0 degrees) and `definitionsPreset` so the evaluator and browser use identical operational definitions.

Each event records `dt_method` (`fast` or `exact`) and, when applicable, `grazing_reason`. Scan rows record `bounds_status` (`nominal` or `bounded`).
