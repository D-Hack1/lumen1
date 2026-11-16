// Owner: Nived
// Real LROC south-polar base image (from Ebin's export; public/content/moon/moon.jpeg, metadata in public/content/south_pole_lroc.json).
// South-polar stereographic, 0 deg E up (the same orientation as engine/projection.ts), pole at the image centre, 2387.36 m/px.
export const MOON_BASE_URL = `${import.meta.env.BASE_URL}content/moon/moon.jpeg`;
export const MOON_BASE_CREDIT = 'NASA/GSFC/Arizona State University (LROC)';
/** Radius of the image (to 60 deg S) in km: half of 780 px * 2.38736 km/px. */
export const MOON_BASE_RADIUS_KM = 931.07;

/** CSS box for the image so that the map square (+-halfKm around the pole) shows exactly the matching crop. */
export function baseImageStyle(halfKm: number): { width: string; height: string; left: string; top: string } {
  const side = (MOON_BASE_RADIUS_KM / halfKm) * 100; // image side as % of the square
  return { width: `${side}%`, height: `${side}%`, left: `${50 - side / 2}%`, top: `${50 - side / 2}%` };
}
