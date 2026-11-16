// Owner: Ebin
// Tiny area/line chart for site cards (Abhinav's SiteCard imports this). Static only — no Fast Lane overlay.
// Redraw key includes a content signature, so changed values (e.g. a shifted window) redraw without callers re-keying.
import { color } from '../../ui/tokens';
import { LayeredCanvas } from '../shared/LayeredCanvas';

export interface SparklineProps {
  /** 0–100 per sample (e.g. daily sunlit % or link %), oldest first. */
  values: ArrayLike<number>;
  /** Index range to highlight (e.g. the current scenario window), inclusive. */
  highlight?: [number, number];
  tone?: 'sun' | 'earth';
  className?: string;
}

/** Cheap content signature (FNV-1a over the values), so a shifted window with the same length still redraws. */
function signature(values: ArrayLike<number>): number {
  let h = 2166136261;
  for (let i = 0; i < values.length; i++) h = Math.imul(h ^ (Math.round(values[i] * 4) & 0xffff), 16777619);
  return h >>> 0;
}

export function Sparkline({ values, highlight, tone = 'sun', className }: SparklineProps) {
  return (
    <LayeredCanvas
      className={['sparkline', className].filter(Boolean).join(' ')}
      staticKey={`${values.length}:${signature(values)}:${tone}:${highlight?.join(',')}`}
      drawStatic={(ctx, w, h) => {
        const n = values.length;
        if (n < 2) return;
        // Fixed 0–100 domain: every card shares one scale, so a 20 % site never looks like a 90 % site.
        const max = 100;

        const xAt = (i: number) => (i / (n - 1)) * w;
        const yAt = (v: number) => h - (v / max) * (h - 2) - 1;

        if (highlight) {
          const [a, b] = highlight;
          ctx.fillStyle = color.surface4;
          ctx.fillRect(xAt(Math.max(0, a)), 0, xAt(Math.min(n - 1, b)) - xAt(Math.max(0, a)), h);
        }

        const stroke = tone === 'sun' ? color.sun : color.earth;
        ctx.fillStyle = tone === 'sun' ? color.sunSoft : color.earthSoft;
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let i = 0; i < n; i++) ctx.lineTo(xAt(i), yAt(values[i]));
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const x = xAt(i);
          const y = yAt(values[i]);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }}
    />
  );
}
