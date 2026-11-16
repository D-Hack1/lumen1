# Data Contracts

Binary artifacts are little-endian `float32`, `int16`, or `uint8` files with a JSON sidecar. Every sidecar contains `version`, `shape`, `dtype`, `fields`, `units`, `scale`, `offset`, `producer`, `created_utc`, and `sha256`. `scale` and `offset` are null for unquantised values. UTC values are ISO-8601 with `Z`.

Coordinates use the DE421-consistent `MOON_ME` frame and east-positive longitude. Consumers must reject unknown contract versions and SHA mismatches.
