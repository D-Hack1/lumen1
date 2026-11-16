// Owner: Abhinav
// Chip — toggle filter (aria-pressed). 120 ms press/toggle feedback, transform/colour only.
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  selected?: boolean;
  onChange?: (selected: boolean) => void;
  count?: number;
  children: ReactNode;
}

export function Chip({ selected = false, onChange, count, className, children, onClick, ...rest }: ChipProps) {
  return (
    <button
      type="button"
      className={['ui-chip', selected && 'is-selected', className].filter(Boolean).join(' ')}
      aria-pressed={selected}
      onClick={(e) => {
        onClick?.(e);
        onChange?.(!selected);
      }}
      {...rest}
    >
      <span className="truncate">{children}</span>
      {count != null && <span className="ui-chip__count num">{count}</span>}
    </button>
  );
}
