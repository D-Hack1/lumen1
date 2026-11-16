# DSN Contract

`dsn.bin` stores geometric Moon-centre elevation for DSS-14, DSS-43, and DSS-63 from 2023 through 2030 at 600-second cadence. It is not a link budget or signal-margin product.

Values use little-endian signed int16 encoding: `round(elevation_deg * 2)`, with valid stored values in `[-180, 180]`. Decode as `stored_value / 2`, preserving the full -90 to +90 degree range at 0.5-degree resolution. The sidecar identifies station order, frame/kernel provenance, cadence, geometric-only mode, station-coordinate realization and retrieval provenance, coordinate epoch (or an explicit statement that it is unspecified), and standard binary metadata.
