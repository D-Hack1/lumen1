// Owner: Ebin
// Real LROC south-polar imagery for the Basemap's L0 (web/public/content/moon/south_pole_lroc.{webp,json}).
// The picture is a south-polar stereographic export (lon 0 = up, same as engine/projection.ts), so a map canvas
// that spans ±halfKm around the pole maps to a centred square crop of the image — no rotation or resampling maths.
// Returns false (and draws nothing) if the file is missing, so the procedural relief underneath stays the fallback.
interface Manifest {
  file: string;
  sizePx: [number, number];
  metresPerPixel: number;
  poleAtPixel: [number, number];
  credit: string;
}

let cache: Promise<{ bmp: ImageBitmap; m: Manifest } | null> | null = null;

function base(): string {
  const b = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  return `${b.replace(/\/$/, '')}/content/moon/`;
}

function load() {
  cache ??= (async () => {
    try {
      const m: Manifest = await (await fetch(`${base()}south_pole_lroc.json`)).json();
      const r = await fetch(`${base()}${m.file}`);
      if (!r.ok) return null;
      return { bmp: await createImageBitmap(await r.blob()), m };
    } catch {
      return null;
    }
  })();
  return cache;
}

/** Draw the pole imagery filling a `size`×`size` canvas that spans ±halfKm. Resolves true if drawn; `isCurrent` lets a caller drop a stale draw. */
export async function drawMoonImagery(ctx: CanvasRenderingContext2D, size: number, halfKm: number, isCurrent: () => boolean = () => true): Promise<boolean> {
  const got = await load();
  if (!got || !isCurrent()) return false; // missing file, or the caller re-rendered for another extent meanwhile
  const { bmp, m } = got;
  const halfPx = (halfKm * 1000) / m.metresPerPixel;
  const [px, py] = m.poleAtPixel;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, px - halfPx, py - halfPx, 2 * halfPx, 2 * halfPx, 0, 0, size, size);
  ctx.fillStyle = 'rgba(230, 235, 242, 0.55)';
  ctx.font = '9px var(--font-mono)';
  ctx.textAlign = 'left';
  ctx.fillText('LROC · NASA/GSFC/ASU', 6, size - 6);
  ctx.restore();
  return true;
}
