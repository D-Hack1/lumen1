// Owner: Abhinav
// Slider — native <input type=range> (thumb native, no spring). Hot-path sliders (Slip, tilt) are tagged
// data-hotpath: `onLive` fires at pointer rate and must only write a transient bus (slipBus/padDragBus), never
// React state; `onCommit` fires once on release/keyboard change and may write the committed store.
import { useEffect, useRef, type InputHTMLAttributes } from 'react';

export interface SliderProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'onChange' | 'value' | 'defaultValue' | 'type'
> {
  value: number;
  min: number;
  max: number;
  step?: number;
  ariaLabel: string;
  /** Pointer-rate callback (hot path: write a bus only). */
  onLive?: (v: number) => void;
  /** Human-rate callback on release / keyboard step. */
  onCommit?: (v: number) => void;
  hotpath?: boolean;
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  ariaLabel,
  onLive,
  onCommit,
  hotpath = false,
  className,
  ...rest
}: SliderProps) {
  const dragging = useRef(false);
  const el = useRef<HTMLInputElement>(null);
  const commit = (input: HTMLInputElement) => onCommit?.(input.valueAsNumber);

  // Uncontrolled so React never re-renders at pointer rate; resync from the committed value when not dragging.
  useEffect(() => {
    if (!dragging.current && el.current && el.current.valueAsNumber !== value) el.current.value = String(value);
  }, [value]);

  return (
    <input
      ref={el}
      type="range"
      className={['ui-slider', className].filter(Boolean).join(' ')}
      aria-label={ariaLabel}
      min={min}
      max={max}
      step={step}
      defaultValue={value}
      data-hotpath={hotpath ? '' : undefined}
      onPointerDown={() => (dragging.current = true)}
      onPointerUp={(e) => {
        dragging.current = false;
        commit(e.currentTarget);
      }}
      onInput={(e) => onLive?.(e.currentTarget.valueAsNumber)}
      onKeyUp={(e) => commit(e.currentTarget)}
      {...rest}
    />
  );
}
