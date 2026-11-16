// Owner: Ebin
// One-time ImageBitmap decode of the Lens body imagery (web/public/content/bodies/): sun_sdo.webp (NASA/SDO) and
// earth_epic.webp (NASA EPIC/DSCOVR). Decoded once per page, never per frame. `getBodyBitmap` is synchronous and
// returns null until decoded (or if the file is missing) — callers fall back to the flat procedural disk, so a
// missing asset never breaks the Lens. `bodyImageReady` notifies subscribers (the Lens overlay) when a decode
// finishes, so the first image frame is painted through the frame bus — no React state involved.
export type BodyImageName = 'sun_sdo' | 'earth_epic';

const bitmaps: Partial<Record<BodyImageName, ImageBitmap>> = {};
const started = new Set<BodyImageName>();
const listeners = new Set<() => void>();

export const bodyImageReady = {
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

function baseUrl(): string {
  const b = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  return `${b.replace(/\/$/, '')}/content/bodies/`;
}

/** Start decoding (idempotent). Safe to call every render / every draw. */
export function ensureBodyBitmap(name: BodyImageName): void {
  if (started.has(name) || typeof createImageBitmap === 'undefined') return;
  started.add(name);
  fetch(`${baseUrl()}${name}.webp`)
    .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`${name}: HTTP ${r.status}`))))
    .then((blob) => createImageBitmap(blob))
    .then((bmp) => {
      bitmaps[name] = bmp;
      listeners.forEach((fn) => fn());
    })
    .catch(() => {
      /* missing/undecodable: stay on the procedural fallback */
    });
}

export function getBodyBitmap(name: BodyImageName): ImageBitmap | null {
  ensureBodyBitmap(name);
  return bitmaps[name] ?? null;
}
