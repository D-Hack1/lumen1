// Owner: Ebin
// Survival Barcode — days since landing, 4 patterned states (PLAN_FINAL §8.1 #8: never colour alone):
//   Sun = amber solid · Sun+Earth = teal solid · Earth only = blue dots · blocked = grey hatch.
// Persona (guide Phase 5): the legend and day ticks use Planner wording ("Earth only", "d3") or Educator wording
// ("Earth in view, no Sun", "Day 3") from shared/visualCopy.ts. The legend is a thin strip under the bars.
// Coachmark anchors: the whole barcode, the legend, and a point anchor that follows the scrub crosshair.
// Fast Lane (guide §1.3, §1.4): hover writes crosshairBus only, no React state; overlay draws the crosshair line.
import { useRef } from 'react';
import { useScenarioResult } from '../shared/scenarioResultContext';
import { crosshairBus } from '../../state/buses';
import { createDotPattern, createHatchPattern } from '../../ui/patterns';
import { color } from '../../ui/tokens';
import { COACH, coachAnchor, placeAnchor, POINT_ANCHOR_STYLE } from '../shared/coachAnchors';
import { LayeredCanvas } from '../shared/LayeredCanvas';
import { chartPointer } from '../shared/chartPointer';
import { useVisualCopy } from '../shared/visualCopy';

// Module-level so the array reference is stable across renders (LayeredCanvas resubscribes when it changes).
const OVERLAY_BUSES = [crosshairBus] as const;

type State = 'sun' | 'earth' | 'both' | 'blocked';
function cellState(sunUp: number, earthUp: number): State {
  if (sunUp && earthUp) return 'both';
  if (sunUp) return 'sun';
  if (earthUp) return 'earth';
  return 'blocked';
}

const SWATCH: Record<State, string> = {
  sun: color.sun,
  both: color.both,
  earth: `radial-gradient(circle, ${color.earth} 1.2px, transparent 1.6px) 0 0 / 4px 4px, ${color.blockedBg}`,
  blocked: `repeating-linear-gradient(45deg, ${color.blocked} 0 1px, transparent 1px 4px), ${color.blockedBg}`,
};

export function Barcode() {
  const result = useScenarioResult();
  const series = result.series;
  const vc = useVisualCopy();
  const crossAnchor = useRef<HTMLDivElement>(null);
  const pointer = chartPointer(series, 'barcode', { mode: 'bars' });

  const days = series ? Math.round((series.stepMs * series.sunUp.length) / 86_400_000) : 0;

  return (
    <div
      {...coachAnchor(COACH.barcode)}
      role="img"
      aria-label={vc.t('barcode.aria')}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, gap: 2 }}
    >
      <div style={{ flex: 1, minHeight: 0, position: 'relative', cursor: 'crosshair' }} {...pointer}>
        <div ref={crossAnchor} {...coachAnchor(COACH.barcodeCrosshair)} style={POINT_ANCHOR_STYLE} aria-hidden />
        <LayeredCanvas
          className="barcode"
          staticKey={series}
          drawStatic={(ctx, w, h, dpr) => {
            if (!series) return;
            const n = series.sunUp.length;
            if (n < 1) return;
            const dots = createDotPattern(ctx, dpr) ?? color.earth;
            const hatch = createHatchPattern(ctx, dpr) ?? color.blocked;
            const fills: Record<State, string | CanvasPattern> = { sun: color.sun, both: color.both, earth: dots, blocked: hatch };
            const cw = w / n;
            for (let i = 0; i < n; i++) {
              ctx.fillStyle = fills[cellState(series.sunUp[i], series.earthUp[i])];
              ctx.fillRect(i * cw, 0, Math.max(1, cw), h);
            }
          }}
          drawOverlay={(ctx, w, h) => {
            if (!series) return;
            const { tHover, tScrub } = crosshairBus.get();
            const n = series.sunUp.length;
            const total = series.stepMs * n;
            const xFor = (t: number) => ((t - series.t0) / total) * w;

            ctx.strokeStyle = color.focus;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(xFor(tScrub), 0);
            ctx.lineTo(xFor(tScrub), h);
            ctx.stroke();
            placeAnchor(crossAnchor.current, xFor(tScrub), h / 2);

            if (tHover != null) {
              ctx.strokeStyle = color.textFaint;
              ctx.beginPath();
              ctx.moveTo(xFor(tHover), 0);
              ctx.lineTo(xFor(tHover), h);
              ctx.stroke();
            }
          }}
          overlayBuses={OVERLAY_BUSES}
        />
      </div>
      <div
        {...coachAnchor(COACH.barcodeLegend)}
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-4)', fontSize: 'var(--fs-2xs)', color: color.textMuted, lineHeight: 1, flexShrink: 0, overflow: 'hidden', whiteSpace: 'nowrap' }}
      >
        {(['sun', 'earth', 'both', 'blocked'] as const).map((s) => (
          <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span aria-hidden style={{ width: 10, height: 8, background: SWATCH[s], display: 'inline-block' }} />
            {vc.t(`barcode.${s}`)}
          </span>
        ))}
        {days > 0 && (
          <span className="num" style={{ marginLeft: 'auto', color: color.textFaint }}>
            {vc.t('barcode.day', { n: 0 })} → {vc.t('barcode.day', { n: days })}
          </span>
        )}
      </div>
    </div>
  );
}
