// Owner: Ebin
// Pointing & Link: Earth/Sun az/el/range/light-time/disk/margin at scrub time + DSN lanes (PLAN_FINAL §5.5, §8.3).
// Fast Lane fix (teammate review): this used to call React setState on every crosshairBus tick, so scrubbing
// re-rendered the whole tab every frame. Values now write straight into DOM refs from the bus subscription —
// `series` itself only changes at human rate (new scenario), so that part can stay a normal render.
import { useEffect, useRef } from 'react';
import { fmtLightTime, fmtRangeKm } from '../../engine/format';
import { useScenarioResult } from '../shared/scenarioResultContext';
import { crosshairBus } from '../../state/buses';
import { color } from '../../ui/tokens';
import { DsnLanes } from './DsnLanes';
import { sampleAt } from './pointingSample';

export function PointingLink() {
  const result = useScenarioResult();
  const series = result.series;
  const sunRef = useRef<HTMLElement>(null);
  const earthRef = useRef<HTMLElement>(null);
  const diskRef = useRef<HTMLElement>(null);
  const linkRef = useRef<HTMLElement>(null);
  const rangeRef = useRef<HTMLElement>(null);
  const lightRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!series) return;
    const paint = (t: number) => {
      const s = sampleAt(series, t);
      if (sunRef.current) sunRef.current.textContent = `${s.sunAzDeg.toFixed(1)}° / ${s.sunElevDeg.toFixed(1)}°`;
      if (earthRef.current) earthRef.current.textContent = `${s.earthAzDeg.toFixed(1)}° / ${s.earthElevDeg.toFixed(1)}°`;
      if (diskRef.current) diskRef.current.textContent = `${s.earthDiskPct.toFixed(0)}%`;
      if (rangeRef.current) rangeRef.current.textContent = fmtRangeKm(s.earthRangeKm);
      if (lightRef.current) lightRef.current.textContent = fmtLightTime(s.earthRangeKm);
      if (linkRef.current) {
        linkRef.current.textContent = s.linkUp ? 'UP' : 'DOWN';
        linkRef.current.style.color = s.linkUp ? color.go : color.nogo;
      }
    };
    paint(crosshairBus.get().tScrub);
    return crosshairBus.subscribe((v) => paint(v.tScrub));
  }, [series]);

  if (!series) return <div className="pointing-link">loading…</div>;

  return (
    <div className="pointing-link" style={{ display: 'flex', gap: 'var(--sp-7)', height: '100%', minHeight: 0, overflow: 'hidden' }}>
      {/* 2×2 grid (label above value) instead of 8 stacked lines: the stacked <dl> overflowed the Analysis slot
          (e2e "every tab fits"). Each label/value pair is wrapped in a <div>, which is valid inside <dl>. */}
      <dl
        className="num"
        style={{
          flex: 1,
          minWidth: 0,
          margin: 0,
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          alignContent: 'start',
          gap: 'var(--sp-2) var(--sp-5)',
        }}
      >
        {(
          [
            ['Sun az / el', sunRef],
            ['Earth az / el', earthRef],
            ['Earth range', rangeRef],
            ['Light time (1-way)', lightRef],
            ['Earth disk', diskRef],
            ['Link', linkRef],
          ] as const
        ).map(([label, ref]) => (
          <div key={label} style={{ minWidth: 0 }}>
            <dt style={{ color: color.textFaint, fontSize: 'var(--fs-2xs)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</dt>
            <dd ref={ref} style={{ margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} />
          </div>
        ))}
      </dl>
      <div style={{ flex: 2, minWidth: 0, minHeight: 0 }}>
        <DsnLanes />
      </div>
    </div>
  );
}
