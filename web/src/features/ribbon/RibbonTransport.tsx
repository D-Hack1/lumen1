// Owner: Ebin
// Scrub bar + play/speed transport (PLAN_FINAL §8.3, guide §6 Phase 2). Playback is a linear time advance
// per frame (no easing — matrix §1.4 "Play/scrub transport"); live drag writes crosshairBus only, release
// commits via useScenario().commitScrub. The readout chip updates via ref/textContent, never React state.
import { useEffect, useRef, useState } from 'react';
import { formatMet, formatUtc } from '../../app/time';
import { frameBus } from '../../state/frameBus';
import { crosshairBus } from '../../state/buses';
import { useScenario } from '../../state/scenarioStore';
import { useResult } from '../../engine/hooks';
import { COACH, coachAnchor } from '../shared/coachAnchors';

const SPEEDS = [0.5, 1, 2, 6, 24] as const; // simulated days per real second

export function RibbonTransport() {
  const series = useResult().series;
  const landingUtc = useScenario((s) => s.landingUtc);
  const scrubUtc = useScenario((s) => s.scrubUtc);
  const commitScrub = useScenario((s) => s.commitScrub);
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1);
  const chipRef = useRef<HTMLSpanElement>(null);
  const draggingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const t0 = series?.t0 ?? landingUtc;
  const t1 = series ? series.t0 + series.stepMs * (series.sunElevDeg.length - 1) : landingUtc + 14 * 86_400_000;

  // Reflect crosshairBus into the readout chip and the slider position every frame — zero React commits.
  useEffect(
    () =>
      crosshairBus.subscribe(({ tScrub }) => {
        if (chipRef.current) chipRef.current.textContent = `${formatUtc(tScrub)}  ${formatMet(tScrub, landingUtc)}`;
        if (inputRef.current && !draggingRef.current) inputRef.current.value = String(tScrub);
      }),
    [landingUtc],
  );

  useEffect(() => {
    if (!playing) return;
    const msPerDay = 86_400_000;
    return frameBus.loop((_now, dt) => {
      const cur = crosshairBus.get().tScrub;
      const next = cur + dt * SPEEDS[speedIdx] * (msPerDay / 1000);
      if (next >= t1) {
        crosshairBus.set({ tScrub: t1, source: 'transport' });
        setPlaying(false);
      } else {
        crosshairBus.set({ tScrub: next, source: 'transport' });
      }
    });
  }, [playing, speedIdx, t1]);

  return (
    <div className="ribbon-transport" {...coachAnchor(COACH.ribbonTransport)} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', height: 32 }}>
      <button type="button" aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying((p) => !p)}>
        {playing ? '⏸' : '▶'}
      </button>
      <select value={speedIdx} onChange={(e) => setSpeedIdx(Number(e.target.value))} aria-label="Playback speed">
        {SPEEDS.map((s, i) => (
          <option key={s} value={i}>
            {s}×
          </option>
        ))}
      </select>
      <input
        ref={inputRef}
        type="range"
        min={t0}
        max={t1}
        step={60_000}
        defaultValue={scrubUtc}
        aria-label="Scrub time"
        style={{ flex: 1 }}
        onChange={(e) => {
          draggingRef.current = true;
          crosshairBus.set({ tScrub: Number(e.target.value), source: 'transport' });
        }}
        onPointerUp={(e) => {
          draggingRef.current = false;
          commitScrub(Number((e.target as HTMLInputElement).value));
        }}
      />
      <span ref={chipRef} className="num ribbon-transport__chip" style={{ minWidth: 190 }} />
    </div>
  );
}
