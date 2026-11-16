// Owner: Abhinav
// Orbit page — the whole-Moon canvas: drag to rotate, wheel / buttons to zoom, eased camera moves, click to pin.
// The drawing itself is globeRender.ts; this owns the camera, the textures and the input.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { drawGlobe, globePick, makeScratch, type GlobeCam, type GlobeScratch, type Texture } from './globeRender';
import { loadOrbitManifest, orbitBase } from './polarAssets';

export interface OrbitGlobeHandle {
  zoomBy: (factor: number) => void;
  resetZoom: () => void;
  /** Swing to a point; `zoom` also eases the zoom level ("Face this site"). */
  focusOn: (lat: number, lon: number, zoom?: number) => void;
}

export interface OrbitGlobeProps {
  t: number;
  pin: { lat: number; lon: number };
  /** Changes whenever the selected site changes, so the camera follows it. */
  focusKey: string;
  onPick: (lat: number, lon: number) => void;
  hidden?: boolean;
}

const SIZE = 640;
const reducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const textureCache = new Map<string, Promise<Texture | null>>();
function loadTexture(url: string): Promise<Texture | null> {
  let p = textureCache.get(url);
  if (!p) {
    p = new Promise<Texture | null>((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          const x = c.getContext('2d', { willReadFrequently: true });
          if (!x) return resolve(null);
          x.drawImage(img, 0, 0);
          resolve({ w: c.width, h: c.height, data: x.getImageData(0, 0, c.width, c.height).data });
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
    textureCache.set(url, p);
  }
  return p;
}

interface Cam extends GlobeCam {
  tlon: number;
  tlat: number;
  tz: number;
  raf: number;
}

function OrbitGlobeImpl({ t, pin, focusKey, onPick, hidden }: OrbitGlobeProps, ref: Ref<OrbitGlobeHandle>) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scratch = useRef<GlobeScratch | null>(null);
  const tex = useRef<{ moon: Texture | null; earth: Texture | null }>({ moon: null, earth: null });
  const cam = useRef<Cam>({ lon: 0, lat: -40, tlon: 0, tlat: -40, z: 1, tz: 1, raf: 0 });
  const live = useRef({ t, pin, onPick });
  live.current = { t, pin, onPick };

  const draw = useCallback(() => {
    const cv = canvas.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    scratch.current ??= makeScratch(cv.width, cv.height);
    if (!scratch.current) return;
    const c = cam.current;
    drawGlobe(ctx, scratch.current, c, live.current.t, tex.current.moon, tex.current.earth, live.current.pin);
  }, []);

  const kick = useCallback(() => {
    const c = cam.current;
    if (reducedMotion()) {
      c.lon = c.tlon;
      c.lat = c.tlat;
      c.z = c.tz;
      draw();
      return;
    }
    if (c.raf) return;
    const step = () => {
      const dl = ((c.tlon - c.lon + 540) % 360) - 180;
      const dp = c.tlat - c.lat;
      const dz = c.tz - c.z;
      c.lon += dl * 0.1;
      c.lat += dp * 0.1;
      c.z += dz * 0.14;
      if (c.lon > 180) c.lon -= 360;
      if (c.lon < -180) c.lon += 360;
      draw();
      if (Math.abs(dl) < 0.05 && Math.abs(dp) < 0.05 && Math.abs(dz) < 0.002) {
        c.lon = c.tlon;
        c.lat = c.tlat;
        c.z = c.tz;
        c.raf = 0;
        draw();
        return;
      }
      c.raf = requestAnimationFrame(step);
    };
    c.raf = requestAnimationFrame(step);
  }, [draw]);

  const focusOn = useCallback(
    (lat: number, lon: number, zoom?: number) => {
      const c = cam.current;
      c.tlat = Math.max(-62, Math.min(80, lat));
      c.tlon = lon;
      if (zoom !== undefined) c.tz = zoom;
      kick();
    },
    [kick],
  );

  useImperativeHandle(
    ref,
    () => ({
      zoomBy: (f) => {
        cam.current.tz = Math.max(0.7, Math.min(8, cam.current.tz * f));
        kick();
      },
      resetZoom: () => {
        cam.current.tz = 1;
        kick();
      },
      focusOn,
    }),
    [kick, focusOn],
  );

  // Textures (the colour map and the Earth map), then repaint.
  useEffect(() => {
    let alive = true;
    void loadOrbitManifest().then(async (m) => {
      if (!m || !alive) return;
      const [moon, earth] = await Promise.all([
        loadTexture(`${orbitBase()}${m.globe.moonMap}`),
        loadTexture(`${orbitBase()}${m.globe.earthMap}`),
      ]);
      if (!alive) return;
      tex.current = { moon, earth };
      draw();
    });
    return () => {
      alive = false;
    };
  }, [draw]);

  // Input.
  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const camState = cam.current;
    let drag: { x: number; y: number; lon: number; lat: number; moved: boolean } | null = null;
    const down = (e: PointerEvent) => {
      drag = { x: e.clientX, y: e.clientY, lon: cam.current.tlon, lat: cam.current.tlat, moved: false };
      try {
        cv.setPointerCapture(e.pointerId);
      } catch {
        /* capture is best-effort */
      }
      cv.style.cursor = 'grabbing';
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 4) drag.moved = true;
      const c = cam.current;
      const k = 150 / cv.getBoundingClientRect().width / c.z;
      const lon = drag.lon - (e.clientX - drag.x) * k;
      const lat = Math.max(-89, Math.min(89, drag.lat + (e.clientY - drag.y) * k));
      c.tlon = c.lon = ((lon + 540) % 360) - 180;
      c.tlat = c.lat = lat;
      draw();
    };
    const up = (e: PointerEvent) => {
      const d = drag;
      drag = null;
      cv.style.cursor = 'grab';
      if (d && !d.moved && e.type === 'pointerup') {
        const r = cv.getBoundingClientRect();
        const hit = globePick(
          cam.current,
          cv.width,
          cv.height,
          ((e.clientX - r.left) / r.width) * cv.width,
          ((e.clientY - r.top) / r.height) * cv.height,
        );
        if (hit) live.current.onPick(hit.lat, hit.lon);
      }
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      cam.current.tz = Math.max(0.7, Math.min(8, cam.current.tz * Math.exp(-e.deltaY * 0.0015)));
      kick();
    };
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', wheel, { passive: false });
    return () => {
      cv.removeEventListener('pointerdown', down);
      cv.removeEventListener('pointermove', move);
      cv.removeEventListener('pointerup', up);
      cv.removeEventListener('pointercancel', up);
      cv.removeEventListener('wheel', wheel);
      cancelAnimationFrame(camState.raf);
      camState.raf = 0;
    };
  }, [draw, kick]);

  // Follow the selected site; repaint when time or pin change.
  useEffect(() => {
    focusOn(live.current.pin.lat, live.current.pin.lon);
  }, [focusKey, focusOn]);
  useEffect(() => {
    draw();
  }, [t, pin, draw, hidden]);

  return (
    <canvas
      ref={canvas}
      className="lm-globe"
      width={SIZE}
      height={SIZE}
      role="img"
      aria-label="3D Moon with the Sun orbiting it. Drag to rotate."
    />
  );
}

export const OrbitGlobe = forwardRef(OrbitGlobeImpl);
