# Ephemeris Contract

`ephem.bin` covers 2023-01-01T00:00:00Z through 2030-12-31T23:00:00Z at 3600-second cadence. Each little-endian float32 node has 12 fields: `sun_position_km[3]`, `sun_velocity_km_s[3]`, `earth_position_km[3]`, and `earth_velocity_km_s[3]` relative to the Moon centre in `MOON_ME`.

Both bodies use LT+S aberration correction. Consumers use cubic Hermite interpolation of positions with the stored velocities, then subtract the site position for topocentric directions. The sidecar records start UTC and ET, cadence, frame, body order, units, kernel provenance, and the common binary metadata.
