// Owner: Ebin
// Slip Bar — ±30 d, −1/+1 d, reset (PLAN_FINAL §8.3). Fast Lane fixes from teammate review:
//  - was calling setLive(v) on every onChange (pointer rate) → now uses Abhinav's `Slider` (ui/Slider.tsx),
//    which is already uncontrolled and only calls back at pointer rate via `onLive` (bus-write only) and once
//    on release via `onCommit`. No React state changes while dragging.
//  - plain <button>s → now `Chip` from the UI kit, consistent with the rest of the app.
import { useEffect, useRef } from 'react';
import { useScenario } from '../../state/scenarioStore';
import { slipBus } from '../../state/buses';
import { useCopy } from '../../state/copy';
import { Chip } from '../../ui/Chip';
import { Slider } from '../../ui/Slider';

export function SlipBar() {
  const committed = useScenario((s) => s.slipDays);
  const setSlip = useScenario((s) => s.setSlip);
  const chipRef = useRef<HTMLSpanElement>(null);
  const label = useCopy('slip.label');

  useEffect(() => {
    const paint = (days: number) => {
      if (chipRef.current) chipRef.current.textContent = days === 0 ? '' : `slipped ${days > 0 ? '+' : ''}${days} d`;
    };
    paint(slipBus.get().slipDays);
    return slipBus.subscribe((v) => paint(v.slipDays));
  }, []);

  return (
    <div className="slipbar" style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-4)', height: '100%' }}>
      <Chip aria-label="−1 day" onClick={() => setSlip(Math.max(-30, committed - 1))}>
        ◀
      </Chip>
      <Slider
        value={committed}
        min={-30}
        max={30}
        step={1}
        ariaLabel={label}
        hotpath
        onLive={(v) => slipBus.set({ slipDays: v, dragging: true })}
        onCommit={(v) => setSlip(v)}
        style={{ flex: 1 }}
      />
      <Chip aria-label="+1 day" onClick={() => setSlip(Math.min(30, committed + 1))}>
        ▶
      </Chip>
      <Chip onClick={() => setSlip(0)}>reset</Chip>
      <span ref={chipRef} className="num slipbar__chip" />
    </div>
  );
}
