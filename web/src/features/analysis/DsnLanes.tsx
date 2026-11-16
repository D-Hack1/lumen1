// Owner: Ebin
// DSN lanes (PLAN_FINAL §5.5, §8.3): one lane per complex (Goldstone / Canberra / Madrid) across the scenario
// window, filled where the Moon is above that station's horizon (geometric, Moon-centre elevation — the same
// quantity data_dsn.md ships). A fourth lane shows the site's own link-up series so "Earth visible but no
// station" is readable at a glance. Crosshair is overlay-only (Fast Lane, bus-driven redraw).
import { useScenarioResult } from '../shared/scenarioResultContext';
import { crosshairBus } from '../../state/buses';
import { color } from '../../ui/tokens';
import { LayeredCanvas } from '../shared/LayeredCanvas';
import { useDsn } from './useDsn';

const OVERLAY_BUSES = [crosshairBus] as const;
const COMPLEX: Record<string, string> = { 'DSS-14': 'Goldstone', 'DSS-43': 'Canberra', 'DSS-63': 'Madrid' };
const LABEL_W = 62;

export function DsnLanes() {
  const result = useScenarioResult();
  const series = result.series;
  const { dsn, unavailable } = useDsn();

  if (!series) return null;
  const tEnd = series.t0 + (series.sunElevDeg.length - 1) * series.stepMs;
  const span = Math.max(1, tEnd - series.t0);
  const names = dsn ? dsn.stations.map((s) => COMPLEX[s] ?? s) : [];
  const lanes = names.length + 1; // + this site's link-up lane

  const xOf = (t: number, w: number) => LABEL_W + ((t - series.t0) / span) * (w - LABEL_W);

  return (
    <div style={{ position: 'relative', height: '100%', minHeight: 0 }} aria-label="DSN station visibility over the scenario window" role="img">
      {unavailable && (
        <div style={{ position: 'absolute', inset: 0, color: color.textFaint, fontSize: 'var(--fs-xs)' }}>No DSN data loaded.</div>
      )}
      <LayeredCanvas
        className="dsn-lanes"
        staticKey={`${dsn ? dsn.count : 0}:${series.t0}:${series.sunElevDeg.length}`}
        drawStatic={(ctx, w, h) => {
          const laneH = h / lanes;
          const gap = 3;
          ctx.font = '10px var(--font-mono)';
          ctx.textBaseline = 'middle';
          ctx.textAlign = 'left';

          const label = (i: number, text: string) => {
            ctx.fillStyle = color.textFaint;
            ctx.fillText(text, 0, i * laneH + laneH / 2);
          };
          const lane = (i: number, isUp: (t: number) => boolean, fill: string) => {
            const y = i * laneH + gap / 2;
            const bh = laneH - gap;
            ctx.fillStyle = color.blockedBg;
            ctx.fillRect(LABEL_W, y, w - LABEL_W, bh);
            ctx.fillStyle = fill;
            // Run-length fill per pixel column: cheap and avoids seams between samples.
            const cols = Math.max(1, Math.floor(w - LABEL_W));
            let runStart = -1;
            for (let c = 0; c <= cols; c++) {
              const up = c < cols && isUp(series.t0 + ((c + 0.5) / cols) * span);
              if (up && runStart < 0) runStart = c;
              if (!up && runStart >= 0) {
                ctx.fillRect(LABEL_W + runStart, y, c - runStart, bh);
                runStart = -1;
              }
            }
          };

          if (dsn) {
            names.forEach((n, k) => {
              label(k, n);
              lane(
                k,
                (t) => {
                  const i = Math.round((t - dsn.startMs) / dsn.cadenceMs);
                  return i >= 0 && i < dsn.count && dsn.elevDeg(k, i) > 0;
                },
                color.earth,
              );
            });
          }
          const li = lanes - 1;
          label(li, 'Link @ site');
          lane(
            li,
            (t) => {
              const i = Math.round((t - series.t0) / series.stepMs);
              return i >= 0 && i < series.linkUp.length && series.linkUp[i] === 1;
            },
            color.both,
          );
        }}
        drawOverlay={(ctx, w, h) => {
          const { tScrub, tHover } = crosshairBus.get();
          const line = (t: number, alpha: number, dashed: boolean) => {
            if (t < series.t0 || t > tEnd) return;
            const x = Math.round(xOf(t, w)) + 0.5;
            ctx.globalAlpha = alpha;
            ctx.strokeStyle = color.focus;
            ctx.lineWidth = 1;
            ctx.setLineDash(dashed ? [3, 3] : []);
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;
          };
          line(tScrub, 0.9, false);
          if (tHover != null) line(tHover, 0.5, true);
        }}
        overlayBuses={OVERLAY_BUSES}
      />
    </div>
  );
}
