// Owner: Abhinav
// Holds the loaded real ephemeris so the (synchronous) Orbit geometry in ephemeris.ts can use it. Set by realModel.ts once the
// data has loaded; stays null in mock mode, where ephemeris.ts keeps its analytic stand-in.
import type { Ephemeris } from '../../engine/data/ephem';

let eph: Ephemeris | null = null;
export const setRealEphemeris = (e: Ephemeris | null): void => {
  eph = e;
};
export const getRealEphemeris = (): Ephemeris | null => eph;
