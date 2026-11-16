// Owner: Ebin
// Angle dial for yaw and off-nominal tilt direction (0° = up/North, clockwise). Fast Lane: pointer drag writes
// `padDragBus` only (overlay redraw + ref-painted label, no React state); release commits once via `onCommit`.
// No CSS transitions (guide §1.4: motion OFF for dial drags). Arrow keys nudge ±5° (Shift ±1°) and commit.
import { useEffect, useRef } from 'react';
import { padDragBus, type PadDragValue } from '../../state/buses';
import { color } from '../../ui/tokens';
import { LayeredCanvas } from '../shared/LayeredCanvas';

const OVERLAY_BUSES = [padDragBus] as const;
type Field = 'yawDeg' | 'tiltDirDeg';

export interface AngleDialProps {
  field: Field;
  label: string;
  /** Committed value (used only when not dragging). */
  value: number;
  onCommit: (deg: number) => void;
  disabled?: boolean;
}

const wrap = (d: number) => ((d % 360) + 360) % 360;

export function AngleDial({ field, label, value, onCommit, disabled }: AngleDialProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const paint = (v: Readonly<PadDragValue>) => {
      if (readoutRef.current) readoutRef.current.textContent = `${Math.round(wrap(v[field]))}°`;
    };
    // Follow committed value changes (preset load, share URL) unless a drag is in progress.
    if (!dragging.current && padDragBus.get()[field] !== value) padDragBus.set({ [field]: value });
    paint(padDragBus.get());
    return padDragBus.subscribe(paint);
  }, [field, value]);

  const angleFrom = (e: React.PointerEvent) => {
    const r = boxRef.current!.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    return wrap((Math.atan2(dx, -dy) * 180) / Math.PI);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, opacity: disabled ? 0.5 : 1 }}>
      <div
        ref={boxRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={Math.round(wrap(value))}
        aria-disabled={disabled}
        style={{ width: 52, height: 52, touchAction: 'none', cursor: disabled ? 'not-allowed' : 'grab' }}
        onPointerDown={(e) => {
          if (disabled) return;
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          padDragBus.set({ [field]: angleFrom(e), dragging: true });
        }}
        onPointerMove={(e) => {
          if (dragging.current) padDragBus.set({ [field]: angleFrom(e), dragging: true });
        }}
        onPointerUp={(e) => {
          if (!dragging.current) return;
          dragging.current = false;
          const deg = Math.round(angleFrom(e));
          padDragBus.set({ [field]: deg, dragging: false });
          onCommit(deg);
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 1 : 5;
          const dir = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
          if (!dir || disabled) return;
          e.preventDefault();
          const deg = wrap(Math.round(padDragBus.get()[field]) + dir * step);
          padDragBus.set({ [field]: deg });
          onCommit(deg);
        }}
      >
        <LayeredCanvas
          staticKey="dial"
          drawStatic={(ctx, w, h) => {
            const cx = w / 2;
            const cy = h / 2;
            const r = Math.min(w, h) / 2 - 3;
            ctx.strokeStyle = color.hairlineStrong;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.stroke();
            for (let k = 0; k < 4; k++) {
              const a = (k * Math.PI) / 2;
              ctx.beginPath();
              ctx.moveTo(cx + Math.sin(a) * (r - 4), cy - Math.cos(a) * (r - 4));
              ctx.lineTo(cx + Math.sin(a) * r, cy - Math.cos(a) * r);
              ctx.stroke();
            }
            ctx.fillStyle = color.textFaint;
            ctx.font = '8px var(--font-mono)';
            ctx.textAlign = 'center';
            ctx.fillText('N', cx, cy - r + 11);
          }}
          drawOverlay={(ctx, w, h) => {
            const cx = w / 2;
            const cy = h / 2;
            const r = Math.min(w, h) / 2 - 6;
            const a = (padDragBus.get()[field] * Math.PI) / 180;
            ctx.strokeStyle = color.focus;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.sin(a) * r, cy - Math.cos(a) * r);
            ctx.stroke();
            ctx.fillStyle = color.focus;
            ctx.beginPath();
            ctx.arc(cx + Math.sin(a) * r, cy - Math.cos(a) * r, 2.5, 0, Math.PI * 2);
            ctx.fill();
          }}
          overlayBuses={OVERLAY_BUSES}
        />
      </div>
      <span style={{ fontSize: 'var(--fs-2xs)', color: color.textMuted, lineHeight: 1 }}>
        {label} <span ref={readoutRef} className="num" />
      </span>
    </div>
  );
}
