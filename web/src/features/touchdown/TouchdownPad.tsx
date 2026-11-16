// Owner: Ebin
// Touchdown Pad widget: slope/aspect compass, panel preset + mast height, yaw, off-nominal tilt, power bars.
// Tilt/yaw drag writes padDragBus live (Fast Lane); release commits via useScenario (PLAN_FINAL §5.6, §8.3).
//
// Teammate review fix: the tilt slider used to be a controlled <input value={tilt.magnitudeDeg}> whose value
// never changed during drag (only padDragBus did) — React kept re-rendering it back to the stale committed
// value every tick, so the thumb would snap back instead of following the pointer. Switched to Abhinav's
// `Slider` (uncontrolled; onLive is bus-only, onCommit fires once on release) and the live label now paints
// from padDragBus via a ref instead of reading committed state.
import { useEffect, useRef } from 'react';
import { useResult } from '../../engine/hooks';
import { useScenario, type MastHeightM, type PanelPreset } from '../../state/scenarioStore';
import { padDragBus } from '../../state/buses';
import { useCopyFn } from '../../state/copy';
import { Segmented } from '../../ui/Segmented';
import { Slider } from '../../ui/Slider';
import { Badge } from '../../ui/Badge';
import { Chip } from '../../ui/Chip';
import { AngleDial } from './AngleDial';
import { SlopeCompass } from './SlopeCompass';
import { usePad } from './usePad';
import { useDispersion } from './useDispersion';
import { DispersionHistogram } from './DispersionHistogram';
import { summariseDispersion } from '../../engine/data/dispersion';
import { PanelPowerBars } from './PanelPowerBars';

const HEIGHTS: MastHeightM[] = [1, 2, 5, 10];
const PRESETS: PanelPreset[] = ['fourSide', 'singleHeading', 'horizontalDeck', 'trackingMast'];

export function TouchdownPad() {
  const result = useResult();
  const height = useScenario((s) => s.heightM);
  const setHeight = useScenario((s) => s.setHeight);
  const preset = useScenario((s) => s.panelPreset);
  const setPreset = useScenario((s) => s.setPanelPreset);
  const tilt = useScenario((s) => s.tilt);
  const setTilt = useScenario((s) => s.setTilt);
  const yaw = useScenario((s) => s.yawDeg);
  const setYaw = useScenario((s) => s.setYaw);
  const maxSlope = useScenario((s) => s.profile.maxPadSlopeDeg);
  const t = useCopyFn();
  const siteRef = useScenario((s) => s.site);
  const { pad } = usePad(siteRef.kind === 'site' ? siteRef.id : null);
  const dispersion = useDispersion(siteRef.kind === 'site' ? siteRef.id : null);
  const tiltLabelRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const paint = (deg: number) => {
      if (tiltLabelRef.current) tiltLabelRef.current.textContent = `${deg.toFixed(0)}°`;
    };
    paint(padDragBus.get().tiltMagDeg);
    return padDragBus.subscribe((v) => paint(v.tiltMagDeg));
  }, []);

  const slope = pad?.slopeDeg ?? result.metrics?.padSlopeDeg?.value ?? null;
  const downhill = pad?.downhillAspectDeg ?? null;
  const series = result.series;
  // One source of truth: when the grid is loaded, quote p95 from IT (same numbers as the histogram); pad.json's
  // precomputed stats are only the fallback while it loads or when no grid exists.
  const p95 = dispersion ? summariseDispersion(dispersion, maxSlope).p95 : (pad?.dispersionSlopeStats.p95 ?? null);

  // Pad risk flag: nominal slope vs the profile limit; p95 over dispersion catches "fine at the aim point, not
  // after a realistic miss" (PLAN_FINAL §5.6). Never colour alone — Badge carries a glyph.
  const risk: { tone: 'go' | 'marginal' | 'nogo' | 'pending'; text: string } =
    slope == null
      ? { tone: 'pending', text: 'pad slope n/a' }
      : slope > maxSlope
        ? { tone: 'nogo', text: `pad slope ${slope.toFixed(1)}° > ${maxSlope}°` }
        : p95 != null && p95 > maxSlope
          ? { tone: 'marginal', text: `p95 ${p95.toFixed(1)}° > ${maxSlope}° after dispersion` }
          : { tone: 'go', text: `pad slope ${slope.toFixed(1)}° ≤ ${maxSlope}°` };

  return (
    <div className="touchdown-pad" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)', height: '100%', minHeight: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: 'var(--sp-3)', height: 92, flexShrink: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <SlopeCompass slopeDeg={slope} downhillAzimuthDeg={downhill} series={series} />
        </div>
        <AngleDial field="yawDeg" label="Yaw" value={yaw ?? 0} onCommit={setYaw} />
        <AngleDial
          field="tiltDirDeg"
          label="Tilt dir"
          value={tilt.directionDeg}
          onCommit={(deg) => setTilt({ ...tilt, directionDeg: deg })}
          disabled={tilt.magnitudeDeg === 0}
        />
      </div>

      <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', alignItems: 'center' }}>
        <Badge tone={risk.tone}>{risk.text}</Badge>
        {pad && <Badge tone="neutral" glyph={null}>slope @ {pad.planeFit.baselineM} m baseline</Badge>}
        {pad && (
          <Badge tone="blocked">{pad.underResolved ? 'near zone N⁺ under-resolved' : `near zone ≥ ${pad.dMinM} m`}</Badge>
        )}
        <Chip selected={yaw == null} onChange={(on) => setYaw(on ? null : 0)} title="Auto = best of the 15° yaw sweep">
          Yaw auto
        </Chip>
      </div>

      <Segmented<PanelPreset>
        size="sm"
        ariaLabel={t('touchdown.preset')}
        value={preset}
        onChange={setPreset}
        options={PRESETS.map((p) => ({ value: p, label: t(`touchdown.preset.${p}`) }))}
      />

      <Segmented<MastHeightM>
        size="sm"
        ariaLabel={t('touchdown.height')}
        value={height}
        onChange={setHeight}
        options={HEIGHTS.map((h) => ({ value: h, label: `${h} m` }))}
      />

      <div>
        <label style={{ fontSize: 'var(--fs-xs)', color: 'var(--c-text-muted)' }}>
          Off-nominal tilt <span ref={tiltLabelRef} className="num" />
        </label>
        <Slider
          value={tilt.magnitudeDeg}
          min={0}
          max={30}
          ariaLabel="Off-nominal tilt magnitude"
          hotpath
          onLive={(v) => padDragBus.set({ tiltMagDeg: v, dragging: true })}
          onCommit={(v) => setTilt({ ...tilt, magnitudeDeg: v })}
        />
      </div>

      {dispersion && (
        <div style={{ height: 52, flexShrink: 0 }}>
          <DispersionHistogram dispersion={dispersion} toleranceDeg={maxSlope} />
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <PanelPowerBars preset={preset} series={series} slopeDeg={slope ?? 0} downhillAzDeg={downhill ?? 0} yawAuto={yaw == null} />
      </div>
    </div>
  );
}
