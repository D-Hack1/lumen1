// Owner: Abhinav
// Orbit page — the whole-Moon renderer, ported from the approved design: a CPU raster of the Moon (Lommel–Seeliger shading on
// the LROC colour map, earthshine), a spinning lit Earth, the Sun on its ring (passing behind the Moon), edge chips when
// either leaves the frame, and the pin. Pure drawing — camera state and input live in OrbitGlobe.tsx.
import { DEFAULT_SUBSOLAR_LAT_DEG, earthLibration, latLonToVec, sunVector, vecToLatLon } from './ephemeris';
import { SUN_PHASE_OFFSET_H } from './orbitModel';

export interface Texture {
  w: number;
  h: number;
  data: Uint8ClampedArray;
}

export interface GlobeCam {
  lon: number;
  lat: number;
  z: number;
}

export interface GlobeScratch {
  buf: ImageData;
  moonCv: HTMLCanvasElement;
  mctx: CanvasRenderingContext2D;
}

export function makeScratch(w: number, h: number): GlobeScratch | null {
  const moonCv = document.createElement('canvas');
  moonCv.width = w;
  moonCv.height = h;
  const mctx = moonCv.getContext('2d');
  if (!mctx) return null;
  return { buf: mctx.createImageData(w, h), moonCv, mctx };
}

const PI = Math.PI;
const RS = 2.55; // Sun ring radius, in Moon radii
const ED = 1.85; // Earth distance, in Moon radii
const ZOOM_DIV = 2.9;

/** Moon disc radius in canvas pixels. Uses the canvas's SHORTER side, so a canvas that fills a wide stage shows the same Moon size at zoom 1
 *  and zooming in grows into the whole stage (no square inner frame). For a square canvas this equals the original W / 2 / ZOOM_DIV * z. */
export const discRadius = (W: number, H: number, z: number): number => (Math.min(W, H) / 2 / ZOOM_DIV) * z;

interface Basis {
  d: [number, number, number];
  r: [number, number, number];
  u: [number, number, number];
}

function basis(cam: GlobeCam): Basis {
  const lam = (cam.lon * PI) / 180;
  const phi = (cam.lat * PI) / 180;
  return {
    d: [Math.cos(phi) * Math.cos(lam), Math.cos(phi) * Math.sin(lam), Math.sin(phi)],
    r: [-Math.sin(lam), Math.cos(lam), 0],
    u: [-Math.sin(phi) * Math.cos(lam), -Math.sin(phi) * Math.sin(lam), Math.cos(phi)],
  };
}

/** Lat/lon under a canvas pixel, or null when the pixel is off the Moon's disc (used for click-to-pin). */
export function globePick(
  cam: GlobeCam,
  W: number,
  H: number,
  px: number,
  py: number,
): { lat: number; lon: number } | null {
  const R = discRadius(W, H, cam.z);
  const sx = (px - W / 2) / R;
  const sy = (H / 2 - py) / R;
  const rr = sx * sx + sy * sy;
  if (rr >= 1) return null;
  const z = Math.sqrt(1 - rr);
  const { d, r, u } = basis(cam);
  const n: [number, number, number] = [
    sx * r[0] + sy * u[0] + z * d[0],
    sx * r[1] + sy * u[1] + z * d[1],
    sy * u[2] + z * d[2],
  ];
  return vecToLatLon(n);
}

export function drawGlobe(
  ctx: CanvasRenderingContext2D,
  scratch: GlobeScratch,
  cam: GlobeCam,
  t: number,
  tex: Texture | null,
  etex: Texture | null,
  pin: { lat: number; lon: number },
): void {
  const cv = ctx.canvas;
  const W = cv.width;
  const H = cv.height;
  const R = discRadius(W, H, cam.z);
  const cx = W / 2;
  const cy = H / 2;
  const { d, r, u } = basis(cam);
  const sv = sunVector(t + SUN_PHASE_OFFSET_H);
  const sLat = (DEFAULT_SUBSOLAR_LAT_DEG * PI) / 180;
  const proj = (v: readonly number[], rad: number) => ({
    x: cx + (v[0] * r[0] + v[1] * r[1] + v[2] * r[2]) * rad * R,
    y: cy - (v[0] * u[0] + v[1] * u[1] + v[2] * u[2]) * rad * R,
    z: v[0] * d[0] + v[1] * d[1] + v[2] * d[2],
  });

  ctx.clearRect(0, 0, W, H);

  // orbit ring (dashed; the far half is dimmer)
  const ring: ReturnType<typeof proj>[] = [];
  for (let i = 0; i <= 120; i++) {
    const a = (i / 120) * 2 * PI;
    ring.push(proj([Math.cos(sLat) * Math.cos(a), Math.cos(sLat) * Math.sin(a), Math.sin(sLat)], RS));
  }
  const drawRing = (front: boolean) => {
    ctx.lineWidth = 1;
    ctx.strokeStyle = front ? 'rgba(237,231,219,0.35)' : 'rgba(237,231,219,0.16)';
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    let pen = false;
    for (const p of ring) {
      const ok = front ? p.z >= 0 : p.z < 0;
      if (ok) {
        if (!pen) {
          ctx.moveTo(p.x, p.y);
          pen = true;
        } else ctx.lineTo(p.x, p.y);
      } else pen = false;
    }
    ctx.stroke();
    ctx.setLineDash([]);
  };

  const el = earthLibration(t + SUN_PHASE_OFFSET_H);
  const ev = latLonToVec(el.lat, el.lon);
  const sunP = proj(sv, RS);
  const earthP = proj(ev, ED);

  const drawSun = () => {
    const g = ctx.createRadialGradient(sunP.x, sunP.y, 2, sunP.x, sunP.y, 46);
    g.addColorStop(0, 'rgba(255,231,176,0.95)');
    g.addColorStop(0.25, 'rgba(242,176,74,0.45)');
    g.addColorStop(1, 'rgba(242,176,74,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(sunP.x, sunP.y, 46, 0, 2 * PI);
    ctx.fill();
    ctx.fillStyle = '#FFE7B0';
    ctx.beginPath();
    ctx.arc(sunP.x, sunP.y, 11, 0, 2 * PI);
    ctx.fill();
    ctx.font = '600 12px Inter, sans-serif';
    ctx.fillStyle = '#F2B04A';
    ctx.textAlign = 'center';
    ctx.fillText('SUN', sunP.x, sunP.y + 30);
  };

  const drawEarth = () => {
    const RE = 0.27 * R;
    if (earthP.x < -RE * 1.5 || earthP.x > W + RE * 1.5 || earthP.y < -RE * 1.5 || earthP.y > H + RE * 1.5) return;
    const halo = ctx.createRadialGradient(earthP.x, earthP.y, RE * 0.95, earthP.x, earthP.y, RE * 1.35);
    halo.addColorStop(0, 'rgba(110,170,255,0.30)');
    halo.addColorStop(1, 'rgba(110,170,255,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(earthP.x, earthP.y, RE * 1.35, 0, 2 * PI);
    ctx.fill();
    const size = Math.max(6, Math.min(560, Math.ceil(RE * 2) + 2));
    const half = size / 2;
    const ec = document.createElement('canvas');
    ec.width = size;
    ec.height = size;
    const ex = ec.getContext('2d');
    if (!ex) return;
    const eid = ex.createImageData(size, size);
    const eo = eid.data;
    const ew = etex ? etex.w : 1;
    const eh = etex ? etex.h : 1;
    const ed = etex ? etex.data : null;
    const Ls = 25 - 15 * t; // Earth's spin under the Moon, degrees (unwrapped; the texture lookup wraps)
    for (let iy = 0; iy < size; iy++) {
      const ay = (half - iy - 0.5) / RE;
      for (let ix = 0; ix < size; ix++) {
        const ax = (ix + 0.5 - half) / RE;
        const q = ax * ax + ay * ay;
        if (q >= 1) continue;
        const ez = Math.sqrt(1 - q);
        const enx = ax * r[0] + ay * u[0] + ez * d[0];
        const eny = ax * r[1] + ay * u[1] + ez * d[1];
        const enz = ay * u[2] + ez * d[2];
        let ek = enx * sv[0] + eny * sv[1] + enz * sv[2];
        if (ek < 0) ek = 0;
        let cr: number;
        let cg: number;
        let cb: number;
        if (ed) {
          const la = Math.asin(enz > 1 ? 1 : enz < -1 ? -1 : enz);
          const lo = Ls + (Math.atan2(eny, -enx) * 180) / PI;
          const uu = (((lo / 360 + 0.5) % 1) + 1) % 1;
          let tx = (uu * ew) | 0;
          let ty = ((0.5 - la / PI) * eh) | 0;
          if (ty < 0) ty = 0;
          if (ty >= eh) ty = eh - 1;
          if (tx >= ew) tx = ew - 1;
          const ei = (ty * ew + tx) * 4;
          cr = ed[ei];
          cg = ed[ei + 1];
          cb = ed[ei + 2];
        } else {
          cr = 40;
          cg = 90;
          cb = 170;
        }
        const shade = 0.035 + 0.965 * Math.pow(ek, 0.75);
        const rim = Math.pow(1 - ez, 3) * (0.2 + 0.9 * ek);
        const o2 = (iy * size + ix) * 4;
        let v2 = cr * shade + 60 * rim;
        eo[o2] = v2 > 255 ? 255 : v2;
        v2 = cg * shade + 110 * rim;
        eo[o2 + 1] = v2 > 255 ? 255 : v2;
        v2 = cb * shade + 235 * rim;
        eo[o2 + 2] = v2 > 255 ? 255 : v2;
        let ca = 255;
        if (q > 0.96) ca = Math.min(255, Math.max(0, (1 - Math.sqrt(q)) * RE * 255));
        eo[o2 + 3] = ca;
      }
    }
    ex.putImageData(eid, 0, 0);
    ctx.drawImage(ec, earthP.x - half, earthP.y - half);
    ctx.font = '600 12px Inter, sans-serif';
    ctx.fillStyle = '#9ACDBB';
    ctx.textAlign = 'center';
    ctx.fillText('EARTH', earthP.x, earthP.y + RE + 18);
  };

  const layered = (front: boolean) => {
    const items: [number, () => void][] = [];
    if (front ? sunP.z >= 0 : sunP.z < 0) items.push([sunP.z, drawSun]);
    if (front ? earthP.z >= 0 : earthP.z < 0) items.push([earthP.z, drawEarth]);
    items.sort((a, b) => a[0] - b[0]).forEach((x) => x[1]());
  };

  // back layer
  drawRing(false);
  layered(false);

  // Moon pixels
  const out = scratch.buf.data;
  out.fill(0);
  const y0 = Math.max(0, Math.floor(cy - R) - 1);
  const y1 = Math.min(H - 1, Math.ceil(cy + R) + 1);
  const x0 = Math.max(0, Math.floor(cx - R) - 1);
  const x1 = Math.min(W - 1, Math.ceil(cx + R) + 1);
  const [s0, s1, s2] = sv;
  const earthK = 0.05 * (0.5 - 0.5 * (s0 * ev[0] + s1 * ev[1] + s2 * ev[2]));
  const tw = tex ? tex.w : 1;
  const th = tex ? tex.h : 1;
  const td = tex ? tex.data : null;
  for (let py = y0; py <= y1; py++) {
    const sy = (cy - py - 0.5) / R;
    for (let px = x0; px <= x1; px++) {
      const sx = (px + 0.5 - cx) / R;
      const rr = sx * sx + sy * sy;
      if (rr >= 1) continue;
      const z = Math.sqrt(1 - rr);
      const nx = sx * r[0] + sy * u[0] + z * d[0];
      const ny = sx * r[1] + sy * u[1] + z * d[1];
      const nz = sy * u[2] + z * d[2];
      const mu0 = nx * s0 + ny * s1 + nz * s2;
      let k = mu0 > 0 ? (mu0 / (mu0 + z)) * 2.0 : 0;
      k += 0.012;
      const es = nx * ev[0] + ny * ev[1] + nz * ev[2];
      if (es > 0) k += es * earthK;
      let rc: number;
      let gc: number;
      let bc: number;
      if (td) {
        const lat = Math.asin(nz > 1 ? 1 : nz < -1 ? -1 : nz);
        const lon = Math.atan2(ny, nx);
        let tx = ((lon / (2 * PI) + 0.5) * tw) | 0;
        let ty = ((0.5 - lat / PI) * th) | 0;
        if (tx >= tw) tx = tw - 1;
        if (ty >= th) ty = th - 1;
        if (ty < 0) ty = 0;
        const idx = (ty * tw + tx) * 4;
        rc = td[idx];
        gc = td[idx + 1];
        bc = td[idx + 2];
      } else {
        rc = gc = bc = 150;
      }
      const o = (py * W + px) * 4;
      let v = rc * k;
      out[o] = v > 255 ? 255 : v;
      v = gc * k;
      out[o + 1] = v > 255 ? 255 : v;
      v = bc * k;
      out[o + 2] = v > 255 ? 255 : v;
      let al = 255;
      if (rr > 0.97) al = Math.min(255, Math.max(0, (1 - Math.sqrt(rr)) * R * 255));
      out[o + 3] = al;
    }
  }
  scratch.mctx.putImageData(scratch.buf, 0, 0);
  ctx.drawImage(scratch.moonCv, 0, 0);

  // front layer
  drawRing(true);
  layered(true);

  // edge chips for Sun / Earth when out of frame
  const arrows = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];
  const edge = (P: { x: number; y: number }, label: string, col: string) => {
    const m = 30;
    if (P.x >= -m && P.x <= W + m && P.y >= -m && P.y <= H + m) return;
    const dx = P.x - cx;
    const dy = P.y - cy;
    const ang = Math.atan2(dy, dx);
    const txt = `${arrows[((Math.round(ang / (PI / 4)) % 8) + 8) % 8]} ${label}`;
    ctx.font = '600 12px Inter, sans-serif';
    const w = ctx.measureText(txt).width + 22;
    const hh = 26;
    const pad = 14;
    const kx = (W / 2 - pad - w / 2) / Math.max(Math.abs(dx), 1e-6);
    const ky = (H / 2 - pad - hh / 2) / Math.max(Math.abs(dy), 1e-6);
    const kk = Math.min(kx, ky);
    const ex = cx + dx * kk;
    let ey = cy + dy * kk;
    // Keep the chip clear of the stage's own controls, which sit over the canvas edges now that it fills the stage
    // (CSS px, scaled to canvas px): the view toggle / site card top-left, the caption box along the bottom, the zoom buttons bottom-right.
    const s = W / (cv.clientWidth || W);
    const bottom = H - (110 * s + hh / 2);
    if (ey > bottom) ey = bottom;
    if (ex < 270 * s && ey < 200 * s + hh / 2) ey = 200 * s + hh / 2;
    ctx.fillStyle = 'rgba(18,17,16,0.92)';
    ctx.strokeStyle = col;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(ex - w / 2, ey - hh / 2, w, hh);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.textAlign = 'center';
    ctx.fillText(txt, ex, ey + 4);
  };
  edge(sunP, 'SUN', '#F2B04A');
  edge(earthP, 'EARTH', '#9ACDBB');

  // pin
  const pv = latLonToVec(pin.lat, pin.lon);
  const pp = proj(pv, 1.0);
  if (pp.z > 0.03) {
    ctx.fillStyle = '#F2B04A';
    ctx.strokeStyle = '#0E0D0B';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pp.x, pp.y);
    ctx.bezierCurveTo(pp.x - 9, pp.y - 12, pp.x - 8, pp.y - 24, pp.x, pp.y - 24);
    ctx.bezierCurveTo(pp.x + 8, pp.y - 24, pp.x + 9, pp.y - 12, pp.x, pp.y);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#0E0D0B';
    ctx.beginPath();
    ctx.arc(pp.x, pp.y - 16, 3, 0, 2 * PI);
    ctx.fill();
  }
}
