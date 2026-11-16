// Owner: Nived
// South-polar stereographic projection used by the map layers, regions and pins (all in km, true scale at the pole):
//   r = 2R * tan(colatitude / 2),  x = r * sin(lon_east),  y = r * cos(lon_east)
// 0 deg E points up (+y). SVG y is flipped (svg_y = -y). Parameters are DRAFT until the layer contract is frozen
// (data_terrain_misc.md 5.4); layers.json carries the real values and the Basemap prefers them when present.
export const MOON_RADIUS_KM = 1737.4;
const RAD = Math.PI / 180;

export interface Point {
  x: number;
  y: number;
}

export function project(latDeg: number, lonDeg: number): Point {
  const colat = (90 + latDeg) * RAD; // lat is negative in the south
  const r = 2 * MOON_RADIUS_KM * Math.tan(colat / 2);
  return { x: r * Math.sin(lonDeg * RAD), y: r * Math.cos(lonDeg * RAD) };
}

export function unproject(xKm: number, yKm: number): { lat: number; lon: number } {
  const r = Math.hypot(xKm, yKm);
  const colat = 2 * Math.atan(r / (2 * MOON_RADIUS_KM));
  const lon = r === 0 ? 0 : ((Math.atan2(xKm, yKm) / RAD + 360) % 360);
  return { lat: -(90 - colat / RAD), lon };
}

/** Radius (km) of the map edge at a given southern latitude limit (e.g. 80 -> 304 km). */
export const halfExtentKm = (latLimitDegS: number): number => 2 * MOON_RADIUS_KM * Math.tan(((90 - latLimitDegS) * RAD) / 2);

/** Ground distance (km) from the pole; <= r because the projection stretches away from the pole. */
export const colatKm = (latDeg: number): number => (90 + latDeg) * RAD * MOON_RADIUS_KM;
