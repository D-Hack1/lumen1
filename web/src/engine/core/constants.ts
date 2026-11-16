// Owner: Nived
// Copied from pipeline/lumen_pipeline/common/constants.py. A test (core.parity.test.ts) parses that file and fails if
// any value here drifts, so the two can never silently disagree.
export const LUNAR_RADIUS_KM = 1737.4;
export const EARTH_RADIUS_KM = 6378.0;
export const AU_KM = 149_597_870.7;
export const SOLAR_CONSTANT_W_M2 = 1361.0;
export const SPEED_OF_LIGHT_KM_S = 299_792.458;
export const SUN_ANGULAR_RADIUS_DEG_AT_1_AU = 0.2666;

export const POLAR_REFERENCE_LATITUDE_DEG = 60.0;
export const DEFAULT_SUN_AVAILABLE_DISK_FRACTION = 0.5;
export const DEFAULT_EARTH_MARGIN_DEG = 1.0;
export const DEFAULT_DTE_DISK_FRACTION = 0.5;
export const DEFAULT_DSN_MASK_DEG = 10.0;
export const DEFAULT_MIN_SUN_ELEVATION_OPS_DEG = 0.0;

export const DEG = Math.PI / 180;
