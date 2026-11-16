// Owner: Abhinav
// Segmented — single-choice control (radiogroup) with a sliding thumb (emil: 180 ms, transform only, no bounce).
// The thumb is measured at human speed (value/size change), never during a drag.
import { useLayoutEffect, useRef, type ReactNode } from 'react';

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: ReactNode;
  /** Accessible / tooltip name when `label` is abbreviated. */
  title?: string;
  disabled?: boolean;
}

export interface SegmentedProps<T extends string | number> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
  size?: 'sm' | 'md';
  className?: string;
  /** Use tab semantics (view tabs) instead of radio semantics. */
  as?: 'radio' | 'tabs';
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
  size = 'md',
  className,
  as = 'radio',
}: SegmentedProps<T>) {
  const root = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  const first = useRef(true);

  useLayoutEffect(() => {
    const r = root.current;
    const t = thumb.current;
    if (!r || !t) return;
    const place = () => {
      const el = r.querySelector<HTMLElement>('[data-active="true"]');
      if (!el) {
        t.style.opacity = '0';
        return;
      }
      t.style.opacity = '1';
      // translateX + scaleX of a 1 px-wide element: width changes stay on the compositor.
      t.style.transform = `translateX(${el.offsetLeft}px) scaleX(${el.offsetWidth})`;
    };
    if (first.current) {
      t.style.transition = 'none';
      place();
      void t.offsetWidth;
      t.style.transition = '';
      first.current = false;
    } else place();
    const ro = new ResizeObserver(() => {
      t.style.transition = 'none';
      place();
      void t.offsetWidth;
      t.style.transition = '';
    });
    ro.observe(r);
    return () => ro.disconnect();
  }, [value, options]);

  const tabs = as === 'tabs';
  const idx = options.findIndex((o) => o.value === value);
  const move = (dir: 1 | -1) => {
    for (let i = 1; i <= options.length; i++) {
      const o = options[(idx + dir * i + options.length) % options.length];
      if (!o.disabled) return onChange(o.value);
    }
  };

  return (
    <div
      ref={root}
      className={['ui-seg', `ui-seg--${size}`, className].filter(Boolean).join(' ')}
      role={tabs ? 'tablist' : 'radiogroup'}
      aria-label={ariaLabel}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        move(e.key === 'ArrowRight' ? 1 : -1);
      }}
    >
      <span ref={thumb} className="ui-seg__thumb motion-slide" aria-hidden="true" />
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role={tabs ? 'tab' : 'radio'}
            aria-checked={tabs ? undefined : active}
            aria-selected={tabs ? active : undefined}
            aria-label={o.title}
            title={o.title}
            tabIndex={active ? 0 : -1}
            disabled={o.disabled}
            data-active={active}
            className="ui-seg__opt"
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
